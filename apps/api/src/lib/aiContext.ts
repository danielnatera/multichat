export interface RoomMessageData {
  senderId?: string;
  senderName?: string;
  type?: "user" | "ai" | "system";
  content?: string;
  parentMessageId?: string;
  parentSenderName?: string;
  parentMessagePreview?: string;
  status?: "streaming" | "complete" | "error";
}

export interface RoomData {
  name?: string;
  description?: string;
  aiPersonaPrompt?: string;
  memberIds?: string[];
}

interface GeminiContextOptions {
  contextCharLimit?: number;
  historyLimit?: number;
}

export function isUsefulContextMessage(message: RoomMessageData) {
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

export function formatContextMessage(message: RoomMessageData) {
  const speaker = message.type === "ai" ? "Gemini AI" : message.senderName ?? "Unknown user";
  const replyContext = message.parentMessageId
    ? ` replying to ${message.parentSenderName ?? "a previous message"}: "${message.parentMessagePreview ?? ""}"`
    : "";

  return `[${speaker}${replyContext}] ${message.content?.trim()}`;
}

export function fitMessagesWithinContextLimit(messages: RoomMessageData[], contextCharLimit: number) {
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

export function buildGeminiContext(
  messages: RoomMessageData[],
  room: RoomData,
  roomId: string,
  options: GeminiContextOptions = {}
) {
  const historyLimit = options.historyLimit ?? Number(process.env.GEMINI_HISTORY_LIMIT ?? 40);
  const contextCharLimit = options.contextCharLimit ?? Number(process.env.GEMINI_CONTEXT_CHAR_LIMIT ?? 20000);

  // Keep the prompt focused on real conversation, not failed development attempts or partial AI writes.
  const boundedMessages = messages.filter(isUsefulContextMessage).slice(-historyLimit);
  const contextWindow = fitMessagesWithinContextLimit(boundedMessages, contextCharLimit);
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
