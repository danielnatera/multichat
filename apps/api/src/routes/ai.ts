import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertRoomAccess } from "../lib/access.js";
import { logAiDebug } from "../lib/aiLogger.js";
import { firestore } from "../lib/firebaseAdmin.js";
import { streamGeminiResponse } from "../lib/gemini.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth.js";

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

const historyLimit = Number(process.env.GEMINI_HISTORY_LIMIT ?? 40);
const contextCharLimit = Number(process.env.GEMINI_CONTEXT_CHAR_LIMIT ?? 20000);
const aiRetryDelaysMs = [600, 1400, 2800];

interface RoomMessageData {
  senderId?: string;
  senderName?: string;
  type?: "user" | "ai" | "system";
  content?: string;
  parentMessageId?: string;
  parentSenderName?: string;
  parentMessagePreview?: string;
  status?: "streaming" | "complete" | "error";
}

interface RoomData {
  name?: string;
  description?: string;
  aiPersonaPrompt?: string;
}

function isUsefulContextMessage(message: RoomMessageData) {
  const content = message.content?.trim();

  if (!content) {
    return false;
  }

  if (message.status === "error" || message.status === "streaming") {
    return false;
  }

  if (message.type === "system") {
    return false;
  }

  return true;
}

function formatContextMessage(message: RoomMessageData) {
  const speaker = message.type === "ai" ? "Gemini AI" : message.senderName ?? "Unknown user";
  const replyContext = message.parentMessageId
    ? ` replying to ${message.parentSenderName ?? "a previous message"}: "${message.parentMessagePreview ?? ""}"`
    : "";

  return `[${speaker}${replyContext}] ${message.content?.trim()}`;
}

function fitMessagesWithinContextLimit(messages: RoomMessageData[]) {
  const selectedMessages: RoomMessageData[] = [];
  let totalCharacters = 0;

  // Keep the newest messages first when the room is too long for the configured context budget.
  for (const message of [...messages].reverse()) {
    const formattedMessage = formatContextMessage(message);
    const nextTotalCharacters = totalCharacters + formattedMessage.length + 1;

    if (selectedMessages.length > 0 && nextTotalCharacters > contextCharLimit) {
      break;
    }

    selectedMessages.unshift(message);
    totalCharacters = nextTotalCharacters;
  }

  return {
    messages: selectedMessages,
    totalCharacters
  };
}

function buildGeminiContext(messages: RoomMessageData[], room: RoomData, roomId: string) {
  // Keep the prompt focused on real conversation, not failed development attempts or partial AI writes.
  const boundedMessages = messages.filter(isUsefulContextMessage).slice(-historyLimit);
  const contextWindow = fitMessagesWithinContextLimit(boundedMessages);
  const usefulMessages = contextWindow.messages;
  const lastUserMessage = [...usefulMessages].reverse().find((message) => message.type === "user");
  const participants = usefulMessages
    .filter((message) => message.type === "user" && message.senderName)
    .map((message) => message.senderName as string)
    .filter((name, index, names) => names.indexOf(name) === index);

  const history = usefulMessages.map(formatContextMessage).join("\n");

  const prompt = [
    "You are Gemini AI inside a collaborative multi-user team chat.",
    "Use the conversation context to answer the room, not just the last speaker.",
    "Always preserve user attribution: understand who said what and address people by name when useful.",
    "Ignore previous technical error messages, empty AI messages, and failed AI attempts.",
    "If the latest user request is vague, ask one concise clarifying question instead of inventing context.",
    `Room: #${room.name?.trim() || roomId}.`,
    `Room description: ${room.description?.trim() || "No room description provided."}`,
    // Room personas are flexible, but the shared guardrails above stay consistent across tenants.
    room.aiPersonaPrompt?.trim()
      ? `Room AI persona/instructions: ${room.aiPersonaPrompt.trim().slice(0, 1200)}`
      : "Room AI persona/instructions: Use a concise, practical, collaborative assistant style.",
    "Follow the room AI persona unless it conflicts with user attribution, tenant isolation, or the immediate user request.",
    `Participants in this context: ${participants.length > 0 ? participants.join(", ") : "unknown"}.`,
    `Last user message: ${lastUserMessage?.senderName ?? "unknown"} said "${lastUserMessage?.content?.trim() ?? ""}".`,
    "Conversation history:",
    history || "No useful conversation history is available."
  ].join("\n\n");

  return {
    prompt,
    usefulMessages,
    contextCharacters: contextWindow.totalCharacters,
    truncatedMessages: boundedMessages.length - usefulMessages.length,
    lastUserMessage,
    participants
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause
    };
  }

  return {
    message: String(error),
    value: error
  };
}

function getAiErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "AI request failed.";

  if (rawMessage.includes("BILLING_DISABLED")) {
    return "Vertex AI requires billing to be enabled for this project.";
  }

  if (rawMessage.includes("SERVICE_DISABLED") || rawMessage.includes("aiplatform.googleapis.com")) {
    return "Vertex AI API is not enabled yet or is still propagating. Try again in a few minutes.";
  }

  if (rawMessage.includes("PERMISSION_DENIED") || rawMessage.includes("403")) {
    return "Vertex AI denied the request. Check billing, API status, and project permissions.";
  }

  return rawMessage;
}

function shouldRetryAiError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = rawMessage.toLowerCase();
  const definitiveErrorPatterns = [
    "400",
    "401",
    "403",
    "404",
    "billing_disabled",
    "failed_precondition",
    "invalid_argument",
    "permission_denied",
    "service_disabled",
    "unauthenticated"
  ];

  if (definitiveErrorPatterns.some((pattern) => normalizedMessage.includes(pattern))) {
    return false;
  }

  return [
    "408",
    "429",
    "500",
    "502",
    "503",
    "504",
    "ECONNRESET",
    "ETIMEDOUT",
    "fetch failed",
    "rate limit",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "Service Unavailable"
  ].some((pattern) => normalizedMessage.includes(pattern.toLowerCase()));
}

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

        const stream = await streamGeminiResponse(geminiContext.prompt);

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
    const userMessage = status >= 500
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
