import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { AnyAiTool, ToolContext } from "./types.js";

export const MAX_TOOL_CALLS = 3;

// Tool modules are loaded dynamically, so we validate their shape before trusting any export.
function hasParse(value: unknown): value is { parse: (data: unknown) => unknown } {
  return Boolean(value) && typeof value === "object" && typeof (value as { parse?: unknown }).parse === "function";
}

function isAiTool(value: unknown): value is AnyAiTool {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AnyAiTool>;

  return typeof candidate.name === "string"
    && typeof candidate.description === "string"
    && typeof candidate.parametersDescription === "string"
    && typeof candidate.execute === "function"
    && hasParse(candidate.parameters);
}

async function loadAiTools() {
  // In dev this scans src/tools; after build the same code scans dist/tools for compiled .tool.js files.
  const toolsDirectory = dirname(fileURLToPath(import.meta.url));
  const toolFiles = (await readdir(toolsDirectory))
    .filter((fileName) => /\.tool\.(?:ts|js)$/.test(fileName))
    .sort();
  const tools: AnyAiTool[] = [];

  for (const fileName of toolFiles) {
    const moduleUrl = pathToFileURL(join(toolsDirectory, fileName)).href;
    const toolModule = await import(moduleUrl) as Record<string, unknown>;
    // A file may export helpers too; only values matching the AiTool contract are registered.
    const moduleTools = Object.values(toolModule).filter(isAiTool);

    if (moduleTools.length === 0) {
      console.warn("[ai-tools] No valid tool export found", { fileName });
      continue;
    }

    tools.push(...moduleTools);
  }

  return tools;
}

// The registry is ready before routes are imported, which keeps the rest of the API synchronous to use.
export const aiTools = await loadAiTools();
export const aiToolsByName = new Map(aiTools.map((tool) => [tool.name, tool]));

const toolCallSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.unknown()).default({})
});

export interface ParsedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolExecutionResult {
  args: Record<string, unknown>;
  result: string;
  tool: string;
}

export function buildToolsPrompt(tools: AnyAiTool[] = aiTools) {
  return tools
    .map((tool) =>
      [
        `Tool: ${tool.name}`,
        `Description: ${tool.description}`,
        `Arguments: ${tool.parametersDescription}`
      ].join("\n")
    )
    .join("\n\n");
}

export function buildToolDecisionPrompt(basePrompt: string) {
  return [
    basePrompt,
    "Hidden tool routing step:",
    "You are preparing a conversational AI response inside a collaborative chat.",
    "Before the conversational answer is generated, decide whether backend tools can answer the latest user message more accurately or with fresher data.",
    "Return exactly one of these two outputs and nothing else:",
    "A) If no tool is needed: NO_TOOL",
    `B) If tools are needed: one to ${MAX_TOOL_CALLS} <tool_call> blocks containing valid JSON.`,
    "Rules:",
    "- Do not answer the user.",
    "- Do not explain your decision.",
    "- Do not include Markdown fences.",
    "- Do not include any text before, between, or after the required output blocks.",
    `- Use at most ${MAX_TOOL_CALLS} tool calls.`,
    "- Prefer tools whenever they can answer the latest user request more accurately than conversation history alone.",
    "- Use tools when the latest user request needs live backend state.",
    "- Live backend state includes room members, online users, presence, recent messages, or room data.",
    "- Never answer live-state questions from conversation history.",
    "- If the latest user asks who is online, use get_online_users.",
    "- If the latest user asks who belongs to the room, use get_room_members.",
    "- If the latest user asks for recent messages or a summary of recent messages, use get_recent_messages.",
    "- If the latest user asks for multiple live-state facts, return multiple tool calls.",
    "Tool call format:",
    "<tool_call>",
    '{ "tool": "tool_name", "args": {} }',
    "</tool_call>",
    "Examples:",
    'Latest user message: "@Gemini who is online?"',
    "Output:",
    "<tool_call>",
    '{ "tool": "get_online_users", "args": {} }',
    "</tool_call>",
    'Latest user message: "@Gemini summarize the last messages"',
    "Output:",
    "<tool_call>",
    '{ "tool": "get_recent_messages", "args": { "limit": 10 } }',
    "</tool_call>",
    'Latest user message: "@Gemini who belongs to this room and summarize the conversation"',
    "Output:",
    "<tool_call>",
    '{ "tool": "get_room_members", "args": {} }',
    "</tool_call>",
    "<tool_call>",
    '{ "tool": "get_recent_messages", "args": { "limit": 10 } }',
    "</tool_call>",
    'Latest user message: "@Gemini explain what Redis is"',
    "Output:",
    "NO_TOOL",
    "Available tools:",
    buildToolsPrompt()
  ].join("\n\n");
}

export function buildPromptWithToolResults(basePrompt: string, toolResults: ToolExecutionResult[]) {
  if (toolResults.length === 0) {
    return basePrompt;
  }

  return [
    basePrompt,
    "Backend tool results:",
    ...toolResults.flatMap((toolResult, index) => [
      `Result ${index + 1}:`,
      `Tool: ${toolResult.tool}`,
      `Arguments: ${JSON.stringify(toolResult.args)}`,
      "Result:",
      toolResult.result
    ]),
    "Use the tool results naturally in your final answer. Do not mention internal JSON unless the user asks for it."
  ].join("\n\n");
}

export function buildPromptWithToolResult(basePrompt: string, toolResult: ToolExecutionResult) {
  return buildPromptWithToolResults(basePrompt, [toolResult]);
}

function extractJsonObjects(text: string) {
  const objects: string[] = [];
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  let startIndex = -1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (character === "\\") {
      isEscaped = true;
      continue;
    }

    if (character === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0 && startIndex !== -1) {
        objects.push(text.slice(startIndex, index + 1));
        startIndex = -1;

        if (objects.length >= MAX_TOOL_CALLS) {
          return objects;
        }
      }
    }
  }

  return objects;
}

function getRawToolCallJsonBlocks(text: string) {
  const taggedBlocks = [...text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)]
    .map((match) => match[1]?.trim())
    .filter((block): block is string => Boolean(block));

  if (taggedBlocks.length > 0) {
    return taggedBlocks.slice(0, MAX_TOOL_CALLS);
  }

  const fencedBlocks = [...text.matchAll(/```(?:tool_call|json)\s*([\s\S]*?)```/gi)]
    .map((match) => match[1]?.trim())
    .filter((block): block is string => Boolean(block));

  if (fencedBlocks.length > 0) {
    return fencedBlocks.slice(0, MAX_TOOL_CALLS);
  }

  const trimmedText = text.trim();
  const mayContainRawToolJson = trimmedText.startsWith("{") || /^tool_call\b/i.test(trimmedText);

  return mayContainRawToolJson ? extractJsonObjects(trimmedText) : [];
}

export function parseToolCalls(text: string): ParsedToolCall[] {
  // The model is instructed to use <tool_call>, but the parser accepts a few common fallback formats.
  const rawJsonBlocks = getRawToolCallJsonBlocks(text);

  if (rawJsonBlocks.length === 0) {
    console.log("[ai-tools] parseToolCalls skipped: no JSON block found", {
      textPreview: text.slice(0, 500)
    });
    return [];
  }

  const parsedToolCalls: ParsedToolCall[] = [];
  const seenToolCalls = new Set<string>();

  for (const rawJson of rawJsonBlocks) {
    try {
      const parsed = toolCallSchema.parse(JSON.parse(rawJson));
      const toolCallKey = `${parsed.tool}:${JSON.stringify(parsed.args)}`;

      // Repeated tool calls do not add useful context and can waste backend reads.
      if (seenToolCalls.has(toolCallKey)) {
        console.log("[ai-tools] parseToolCalls skipped duplicate", parsed);
        continue;
      }

      seenToolCalls.add(toolCallKey);
      parsedToolCalls.push(parsed);
    } catch (error) {
      console.error("[ai-tools] parseToolCalls failed", {
        rawJson,
        error
      });
    }
  }

  console.log("[ai-tools] parseToolCalls completed", {
    count: parsedToolCalls.length,
    toolCalls: parsedToolCalls
  });

  return parsedToolCalls;
}

export function parseToolCall(text: string): ParsedToolCall | null {
  return parseToolCalls(text)[0] ?? null;
}

export async function executeToolCall(toolCall: ParsedToolCall, context: ToolContext): Promise<ToolExecutionResult> {
  const tool = aiToolsByName.get(toolCall.tool);

  if (!tool) {
    console.error("[ai-tools] Unknown tool requested", {
      requestedTool: toolCall.tool,
      availableTools: [...aiToolsByName.keys()]
    });
    throw new Error(`Unknown AI tool requested: ${toolCall.tool}`);
  }

  // Tools are always validated server-side. The model can request a tool, but it cannot bypass schemas.
  const args = tool.parameters.parse(toolCall.args);
  console.log("[ai-tools] Executing tool", {
    tool: tool.name,
    args,
    orgId: context.orgId,
    roomId: context.roomId
  });
  const result = await tool.execute(args, context);

  return {
    args: args as Record<string, unknown>,
    result,
    tool: tool.name
  };
}



