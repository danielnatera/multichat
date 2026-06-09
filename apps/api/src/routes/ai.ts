import { Router } from "express";
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

const historyLimit = Number(process.env.GEMINI_HISTORY_LIMIT ?? 20);

interface RoomMessageData {
  senderId?: string;
  senderName?: string;
  type?: "user" | "ai" | "system";
  content?: string;
  status?: "streaming" | "complete" | "error";
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

function buildGeminiContext(messages: RoomMessageData[]) {
  // Keep the prompt focused on real conversation, not failed development attempts or partial AI writes.
  const usefulMessages = messages.filter(isUsefulContextMessage).slice(-historyLimit);
  const lastUserMessage = [...usefulMessages].reverse().find((message) => message.type === "user");
  const participants = usefulMessages
    .filter((message) => message.type === "user" && message.senderName)
    .map((message) => message.senderName as string)
    .filter((name, index, names) => names.indexOf(name) === index);

  const history = usefulMessages
    .map((message) => {
      const speaker = message.type === "ai" ? "Gemini AI" : message.senderName ?? "Unknown user";
      return `[${speaker}] ${message.content?.trim()}`;
    })
    .join("\n");

  const prompt = [
    "You are Gemini AI inside a collaborative multi-user team chat.",
    "Use the conversation context to answer the room, not just the last speaker.",
    "Always preserve user attribution: understand who said what and address people by name when useful.",
    "Ignore previous technical error messages, empty AI messages, and failed AI attempts.",
    "If the latest user request is vague, ask one concise clarifying question instead of inventing context.",
    `Participants in this context: ${participants.length > 0 ? participants.join(", ") : "unknown"}.`,
    `Last user message: ${lastUserMessage?.senderName ?? "unknown"} said "${lastUserMessage?.content?.trim() ?? ""}".`,
    "Conversation history:",
    history || "No useful conversation history is available."
  ].join("\n\n");

  return {
    prompt,
    usefulMessages,
    lastUserMessage,
    participants
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

export const aiRouter = Router();

aiRouter.post("/stream", requireAuth, async (request: AuthenticatedRequest, response) => {
  const parsed = requestSchema.safeParse(request.body);

  if (!parsed.success || !request.user) {
    response.status(400).json({ error: "Invalid request." });
    return;
  }

  const { orgId, roomId } = parsed.data;
  let aiMessageRef: FirebaseFirestore.DocumentReference | null = null;

  try {
    // The backend repeats the membership check even though Firestore rules exist.
    // This keeps the Gemini proxy from becoming a cross-tenant data leak.
    await assertRoomAccess(request.user.uid, orgId, roomId);

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
        createdAt: new Date()
      });

    // Create the placeholder before calling Gemini so every participant sees the AI start responding.
    const geminiContext = buildGeminiContext(messages);

    await logAiDebug("request-context", {
      orgId,
      roomId,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
      mock: process.env.MOCK_GEMINI === "true",
      rawMessages: messages.length,
      usefulMessages: geminiContext.usefulMessages.length,
      participants: geminiContext.participants,
      lastUser: geminiContext.lastUserMessage?.senderName ?? null,
      prompt: geminiContext.prompt
    });

    const stream = await streamGeminiResponse(geminiContext.prompt);
    let content = "";

    response.setHeader("Content-Type", "application/json");

    for await (const chunk of stream.stream as AsyncIterable<GeminiStreamChunk>) {
      const text = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (!text) {
        continue;
      }

      content += text;
      // Persist each chunk to Firestore. The browser sees streaming through its normal onSnapshot listener.
      await aiMessageRef.update({ content, status: "streaming" });
    }

    if (!content.trim()) {
      await aiMessageRef.update({
        content: "Vertex AI returned no text for this request.",
        status: "error"
      });
      response.status(502).json({ error: "Vertex AI returned no text for this request." });
      return;
    }

    await aiMessageRef.update({ content, status: "complete" });
    await logAiDebug("response-complete", {
      orgId,
      roomId,
      messageId: aiMessageRef.id,
      characters: content.length
    });
    response.json({ messageId: aiMessageRef.id });
  } catch (error) {
    const status = error instanceof Error && error.name === "ForbiddenError" ? 403 : 500;

    if (aiMessageRef && status >= 500) {
      await aiMessageRef.update({
        content: getAiErrorMessage(error),
        status: "error"
      });
    }

    await logAiDebug("response-error", {
      orgId,
      roomId,
      status,
      message: getAiErrorMessage(error)
    });

    response.status(status).json({ error: getAiErrorMessage(error) });
  }
});
