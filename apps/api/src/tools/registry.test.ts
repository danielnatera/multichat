import { describe, expect, it } from "vitest";
import {
  buildPromptWithToolResult,
  buildPromptWithToolResults,
  buildToolDecisionPrompt,
  buildToolsPrompt,
  parseToolCall,
  parseToolCalls
} from "./registry.js";

describe("AI tool registry", () => {
  it("generates tool documentation from registered metadata", () => {
    const prompt = buildToolsPrompt();

    expect(prompt).toContain("Tool: get_room_members");
    expect(prompt).toContain("Tool: get_recent_messages");
    expect(prompt).toContain("Tool: get_online_users");
    expect(prompt).toContain("Description:");
    expect(prompt).toContain("Arguments:");
  });

  it("builds a generic tool decision prompt without hardcoding individual tool text", () => {
    const prompt = buildToolDecisionPrompt("Base Gemini context");

    expect(prompt).toContain("Base Gemini context");
    expect(prompt).toContain("NO_TOOL");
    expect(prompt).toContain("<tool_call>");
    expect(prompt).toContain("</tool_call>");
    expect(prompt).toContain("Hidden tool routing step:");
    expect(prompt).toContain("You are preparing a conversational AI response inside a collaborative chat.");
    expect(prompt).toContain("decide whether backend tools can answer the latest user message more accurately or with fresher data");
    expect(prompt).toContain("Prefer tools whenever they can answer the latest user request more accurately than conversation history alone.");
    expect(prompt).toContain("If the latest user asks for multiple live-state facts, return multiple tool calls.");
    expect(prompt).toContain("Live backend state includes room members, online users, presence, recent messages, or room data.");
    expect(prompt).toContain("Never answer live-state questions from conversation history.");
    expect(prompt).toContain("Latest user message: \"@Gemini who is online?\"");
    expect(prompt).toContain('{ "tool": "get_online_users", "args": {} }');
    expect(prompt).toContain('Latest user message: "@Gemini who belongs to this room and summarize the conversation"');
    expect(prompt).toContain("Do not include Markdown fences");
    expect(prompt).toContain("Available tools:");
  });

  it("parses exact tagged tool call JSON", () => {
    const parsed = parseToolCall([
      "<tool_call>",
      '{ "tool": "get_online_users", "args": {} }',
      "</tool_call>"
    ].join("\n"));

    expect(parsed).toEqual({
      tool: "get_online_users",
      args: {}
    });
  });

  it("parses multiple tagged tool call JSON blocks", () => {
    const parsed = parseToolCalls([
      "<tool_call>",
      '{ "tool": "get_room_members", "args": {} }',
      "</tool_call>",
      "<tool_call>",
      '{ "tool": "get_recent_messages", "args": { "limit": 10 } }',
      "</tool_call>"
    ].join("\n"));

    expect(parsed).toEqual([
      {
        tool: "get_room_members",
        args: {}
      },
      {
        tool: "get_recent_messages",
        args: { limit: 10 }
      }
    ]);
  });

  it("deduplicates repeated tool calls", () => {
    const parsed = parseToolCalls([
      "<tool_call>",
      '{ "tool": "get_online_users", "args": {} }',
      "</tool_call>",
      "<tool_call>",
      '{ "tool": "get_online_users", "args": {} }',
      "</tool_call>"
    ].join("\n"));

    expect(parsed).toEqual([
      {
        tool: "get_online_users",
        args: {}
      }
    ]);
  });

  it("parses fenced tool call JSON", () => {
    const parsed = parseToolCall([
      "```tool_call",
      '{ "tool": "get_recent_messages", "args": { "limit": 5 } }',
      "```"
    ].join("\n"));

    expect(parsed).toEqual({
      tool: "get_recent_messages",
      args: { limit: 5 }
    });
  });

  it("parses generic fenced JSON when it has a valid tool shape", () => {
    const parsed = parseToolCall([
      "```json",
      '{ "tool": "get_online_users", "args": {} }',
      "```"
    ].join("\n"));

    expect(parsed).toEqual({
      tool: "get_online_users",
      args: {}
    });
  });

  it("parses unfenced tool_call JSON with extra model text", () => {
    const parsed = parseToolCalls([
      "tool_call",
      '{ "tool": "get_recent_messages", "args": { "limit": 10 } }',
      '{ "tool": "get_room_members", "args": {} }',
      "Sarah, aquí tienes un resumen de los últimos mensajes."
    ].join("\n"));

    expect(parsed).toEqual([
      {
        tool: "get_recent_messages",
        args: { limit: 10 }
      },
      {
        tool: "get_room_members",
        args: {}
      }
    ]);
  });

  it("parses direct JSON and ignores trailing text after the first object for singular compatibility", () => {
    const parsed = parseToolCall(
      '{ "tool": "get_online_users", "args": {} }\nThis extra text should be ignored by the internal parser.'
    );

    expect(parsed).toEqual({
      tool: "get_online_users",
      args: {}
    });
  });

  it("returns null when text is not a tool call", () => {
    expect(parseToolCall("NO_TOOL")).toBeNull();
    expect(parseToolCall("I can answer normally.")).toBeNull();
    expect(parseToolCalls("NO_TOOL")).toEqual([]);
  });

  it("adds tool result context for the final answer", () => {
    const prompt = buildPromptWithToolResult("Base Gemini context", {
      args: { limit: 3 },
      result: '{ "messages": [] }',
      tool: "get_recent_messages"
    });

    expect(prompt).toContain("Backend tool results:");
    expect(prompt).toContain("get_recent_messages");
    expect(prompt).toContain('{ "messages": [] }');
  });

  it("adds multiple tool results context for the final answer", () => {
    const prompt = buildPromptWithToolResults("Base Gemini context", [
      {
        args: {},
        result: '{ "members": ["Sarah"] }',
        tool: "get_room_members"
      },
      {
        args: { limit: 10 },
        result: '{ "messages": [] }',
        tool: "get_recent_messages"
      }
    ]);

    expect(prompt).toContain("Backend tool results:");
    expect(prompt).toContain("Result 1:");
    expect(prompt).toContain("get_room_members");
    expect(prompt).toContain("Result 2:");
    expect(prompt).toContain("get_recent_messages");
  });
});
