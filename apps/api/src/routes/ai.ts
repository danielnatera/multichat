import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertRoomAccess } from "../lib/access.js";
import { buildGeminiContext, type RoomData, type RoomMessageData } from "../lib/aiContext.js";
import { getAiErrorMessage, isDefinitiveAiError, serializeError, shouldRetryAiError } from "../lib/aiErrors.js";
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
