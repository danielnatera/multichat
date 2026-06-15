import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertRoomAccess } from "../lib/access.js";
import { buildGeminiContext, type RoomData, type RoomMessageData } from "../lib/aiContext.js";
import { getAiErrorMessage, isDefinitiveAiError, serializeError, shouldRetryAiError } from "../lib/aiErrors.js";
import { logAiDebug } from "../lib/aiLogger.js";
import { firestore } from "../lib/firebaseAdmin.js";
import { generateGeminiText, streamGeminiResponse } from "../lib/gemini.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth.js";
import {
  buildPromptWithToolResults,
  buildToolDecisionPrompt,
  executeToolCall,
  parseToolCalls,
  type ToolExecutionResult
} from "../tools/registry.js";

const requestSchema = z.object({
  orgId: z.string().min(1),
  roomId: z.string().min(1)
});

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

const aiRetryDelaysMs = [600, 1400, 2800];
const historyLimit = Number(process.env.GEMINI_HISTORY_LIMIT ?? 40);

function wait(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export const aiRouter = Router();

aiRouter.post("/stream", requireAuth, async (request: AuthenticatedRequest, response) => {
  const parsed = requestSchema.safeParse(request.body);

  if (!parsed.success || !request.user) {
    response.status(400).json({ error: "Invalid request." });
    return;
  }

  const { orgId, roomId } = parsed.data;
  let aiMessageRef: FirebaseFirestore.DocumentReference | null = null;
  const requestId = randomUUID();

  try {
    // The backend repeats the membership check even though Firestore rules exist.
    // This keeps the Gemini proxy from becoming a cross-tenant data leak.
    await assertRoomAccess(request.user.uid, orgId, roomId);

    const roomSnapshot = await firestore
      .collection("organizations")
      .doc(orgId)
      .collection("rooms")
      .doc(roomId)
      .get();

    if (!roomSnapshot.exists) {
      response.status(404).json({ error: "Room not found." });
      return;
    }

    const room = roomSnapshot.data() as RoomData;

    // Read newest messages first for an efficient query, then reverse them back into conversation order.
    const messagesSnapshot = await firestore
      .collection("organizations")
      .doc(orgId)
      .collection("rooms")
      .doc(roomId)
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(historyLimit)
      .get();

    const messages = messagesSnapshot.docs
      .reverse()
      .map((doc) => doc.data() as RoomMessageData);
    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.type === "user" && message.content?.trim());

    aiMessageRef = await firestore
      .collection("organizations")
      .doc(orgId)
      .collection("rooms")
      .doc(roomId)
      .collection("messages")
      .add({
        orgId,
        roomId,
        senderId: "gemini",
        senderName: "Gemini AI",
        type: "ai",
        content: "",
        status: "streaming",
        ...(latestUserMessage?.parentMessageId
          ? {
              parentMessageId: latestUserMessage.parentMessageId,
              parentSenderName: latestUserMessage.parentSenderName,
              parentMessagePreview: latestUserMessage.parentMessagePreview
            }
          : {}),
        createdAt: new Date()
      });

    // Create the placeholder before calling Gemini so every participant sees the AI start responding.
    const geminiContext = buildGeminiContext(messages, room, roomId);
    // Context for the model. Uncomment locally to inspect exactly what Gemini receives.
    // console.log("[ai-debug] Context for the model", geminiContext.prompt);

    await logAiDebug("request-context", {
      orgId,
      roomId,
      roomName: room.name ?? null,
      hasRoomPersona: Boolean(room.aiPersonaPrompt?.trim()),
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
      mock: process.env.MOCK_GEMINI === "true",
      rawMessages: messages.length,
      usefulMessages: geminiContext.usefulMessages.length,
      contextCharacters: geminiContext.contextCharacters,
      truncatedMessages: geminiContext.truncatedMessages,
      participants: geminiContext.participants,
      lastUser: geminiContext.lastUserMessage?.senderName ?? null,
      prompt: geminiContext.prompt
    });

    let content = "";

    response.setHeader("Content-Type", "application/json");

    for (let attempt = 0; attempt <= aiRetryDelaysMs.length; attempt += 1) {
      try {
        content = "";

        if (attempt > 0) {
          await aiMessageRef.update({
            content: `Gemini hit a temporary issue. Retrying (${attempt}/${aiRetryDelaysMs.length})...`,
            status: "streaming"
          });
        }

        let finalPrompt = geminiContext.prompt;
        const toolExecutions: ToolExecutionResult[] = [];

        // The first model pass is hidden from the chat. It can request safe backend tools or say NO_TOOL.
        const toolDecision = await generateGeminiText(buildToolDecisionPrompt(geminiContext.prompt));
        console.log("[ai-tools] Tool decision response", {
          requestId,
          orgId,
          roomId,
          decision: toolDecision.slice(0, 1200)
        });
        const toolCalls = parseToolCalls(toolDecision);

        if (toolCalls.length === 0) {
          console.log("[ai-tools] No tool calls parsed", {
            requestId,
            orgId,
            roomId,
            decisionPreview: toolDecision.slice(0, 500)
          });
        }

        // Run tools in order so logs and partial failures are easy to follow during debugging.
        for (const [toolCallIndex, toolCall] of toolCalls.entries()) {
          console.log("[ai-tools] Parsed tool call", {
            requestId,
            orgId,
            roomId,
            tool: toolCall.tool,
            args: toolCall.args,
            index: toolCallIndex + 1,
            total: toolCalls.length
          });

          await aiMessageRef.update({
            content: `Gemini is checking ${toolCall.tool.replace(/_/g, " ")} (${toolCallIndex + 1}/${toolCalls.length})...`,
            status: "streaming"
          });

          try {
            const toolExecution = await executeToolCall(toolCall, {
              firestore,
              messages,
              orgId,
              room,
              roomId,
              uid: request.user.uid
            });

            toolExecutions.push(toolExecution);

            console.log("[ai-tools] Tool execution completed", {
              requestId,
              orgId,
              roomId,
              tool: toolExecution.tool,
              args: toolExecution.args,
              resultPreview: toolExecution.result.slice(0, 1200)
            });

            await logAiDebug("tool-executed", {
              requestId,
              orgId,
              roomId,
              tool: toolExecution.tool,
              args: toolExecution.args,
              resultCharacters: toolExecution.result.length
            });
          } catch (toolError) {
            console.error("[ai-tools] Tool execution failed", {
              requestId,
              orgId,
              roomId,
              tool: toolCall.tool,
              args: toolCall.args,
              error: serializeError(toolError)
            });

            // A bad tool request should not break the chat. Other requested tools can still provide useful context.
            await logAiDebug("tool-error", {
              requestId,
              orgId,
              roomId,
              tool: toolCall.tool,
              error: serializeError(toolError)
            });
          }
        }

        // Successful tool results are merged back into the normal conversational prompt.
        if (toolExecutions.length > 0) {
          finalPrompt = buildPromptWithToolResults(geminiContext.prompt, toolExecutions);
        } else if (toolCalls.length > 0) {
          finalPrompt = [
            geminiContext.prompt,
            "One or more backend tools were requested but could not be executed safely.",
            "Answer using the available conversation context without claiming the tools succeeded."
          ].join("\n\n");
        }

        const stream = await streamGeminiResponse(finalPrompt);

        for await (const chunk of stream.stream as AsyncIterable<GeminiStreamChunk>) {
          const text = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
          if (!text) {
            continue;
          }

          content += text;
          // Persist each chunk to Firestore. The browser sees streaming through its normal onSnapshot listener.
          await aiMessageRef.update({ content, status: "streaming" });
        }

        break;
      } catch (error) {
        const shouldRetry = attempt < aiRetryDelaysMs.length && shouldRetryAiError(error);

        console.error("[ai-error] Gemini stream attempt failed", {
          requestId,
          orgId,
          roomId,
          attempt: attempt + 1,
          willRetry: shouldRetry,
          error: serializeError(error)
        });

        await logAiDebug("stream-attempt-error", {
          requestId,
          orgId,
          roomId,
          attempt: attempt + 1,
          willRetry: shouldRetry,
          error: serializeError(error)
        });

        if (!shouldRetry) {
          throw error;
        }

        await wait(aiRetryDelaysMs[attempt]);
      }
    }

    if (!content.trim()) {
      await aiMessageRef.update({
        content: "Gemini could not generate a response. Please try again.",
        status: "error"
      });
      response.status(502).json({
        error: "Gemini could not generate a response. Please try again.",
        requestId
      });
      return;
    }

    await aiMessageRef.update({ content, status: "complete" });
    await logAiDebug("response-complete", {
      orgId,
      roomId,
      requestId,
      messageId: aiMessageRef.id,
      characters: content.length
    });
    response.json({ messageId: aiMessageRef.id, requestId });
  } catch (error) {
    const status = error instanceof Error && error.name === "ForbiddenError" ? 403 : 500;
    const publicMessage = getAiErrorMessage(error);
    const userMessage = status >= 500 && !isDefinitiveAiError(error)
      ? `Gemini is temporarily unavailable. Please retry in a moment. Reference: ${requestId}`
      : publicMessage;

    if (aiMessageRef && status >= 500) {
      await aiMessageRef.update({
        content: userMessage,
        status: "error"
      });
    }

    console.error("[ai-error] Gemini request failed", {
      requestId,
      orgId,
      roomId,
      status,
      publicMessage,
      error: serializeError(error)
    });

    await logAiDebug("response-error", {
      requestId,
      orgId,
      roomId,
      status,
      publicMessage,
      error: serializeError(error)
    });

    response.status(status).json({ error: userMessage, requestId });
  }
});




