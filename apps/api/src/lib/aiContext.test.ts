import { describe, expect, it } from "vitest";
import { buildGeminiContext, formatContextMessage, isUsefulContextMessage, type RoomMessageData } from "./aiContext.js";

const room = {
  name: "engineering",
  description: "API decisions",
  aiPersonaPrompt: "Act as a senior backend architect."
};

describe("buildGeminiContext", () => {
  it("preserves user attribution in the prompt", () => {
    const context = buildGeminiContext(
      [
        { senderName: "Sarah", type: "user", content: "We need a cache strategy." },
        { senderName: "Mike", type: "user", content: "Redis is fast but may cost more." }
      ],
      room,
      "engineering"
    );

    expect(context.prompt).toContain("[Sarah] We need a cache strategy.");
    expect(context.prompt).toContain("[Mike] Redis is fast but may cost more.");
    expect(context.participants).toEqual(["Sarah", "Mike"]);
  });

  it("includes room metadata and persona instructions", () => {
    const context = buildGeminiContext(
      [{ senderName: "Sarah", type: "user", content: "What should we do?" }],
      room,
      "engineering"
    );

    expect(context.prompt).toContain("Room: #engineering.");
    expect(context.prompt).toContain("Room description: API decisions");
    expect(context.prompt).toContain("Room AI persona/instructions: Act as a senior backend architect.");
  });

  it("filters empty, system, streaming, and failed messages", () => {
    const messages: RoomMessageData[] = [
      { senderName: "System", type: "system", content: "User joined." },
      { senderName: "Gemini AI", type: "ai", content: "Partial", status: "streaming" },
      { senderName: "Gemini AI", type: "ai", content: "Failed", status: "error" },
      { senderName: "Lisa", type: "user", content: "   " },
      { senderName: "Sarah", type: "user", content: "Only this matters." }
    ];

    const context = buildGeminiContext(messages, room, "engineering");

    expect(context.usefulMessages).toHaveLength(1);
    expect(context.prompt).toContain("[Sarah] Only this matters.");
    expect(context.prompt).not.toContain("Partial");
    expect(context.prompt).not.toContain("Failed");
    expect(context.prompt).not.toContain("User joined.");
  });

  it("respects the message history limit", () => {
    const messages = Array.from({ length: 5 }, (_, index) => ({
      senderName: `User ${index + 1}`,
      type: "user" as const,
      content: `Message ${index + 1}`
    }));

    const context = buildGeminiContext(messages, room, "engineering", { historyLimit: 3 });

    expect(context.usefulMessages).toHaveLength(3);
    expect(context.prompt).not.toContain("[User 1] Message 1");
    expect(context.prompt).not.toContain("[User 2] Message 2");
    expect(context.prompt).toContain("[User 3] Message 3");
    expect(context.prompt).toContain("[User 5] Message 5");
  });

  it("truncates oldest messages when the character budget is exceeded", () => {
    const messages = [
      { senderName: "Sarah", type: "user" as const, content: "Older long message ".repeat(20) },
      { senderName: "Mike", type: "user" as const, content: "Recent decision" }
    ];

    const context = buildGeminiContext(messages, room, "engineering", { contextCharLimit: 80, historyLimit: 10 });

    expect(context.truncatedMessages).toBe(1);
    expect(context.prompt).not.toContain("Older long message");
    expect(context.prompt).toContain("[Mike] Recent decision");
  });

  it("formats thread replies so Gemini knows what message is being answered", () => {
    const formatted = formatContextMessage({
      senderName: "Mike",
      type: "user",
      content: "Redis makes sense.",
      parentMessageId: "message-1",
      parentSenderName: "Sarah",
      parentMessagePreview: "Should we use cache?"
    });

    expect(formatted).toBe('[Mike replying to Sarah: "Should we use cache?"] Redis makes sense.');
  });

  it("keeps useful complete messages", () => {
    expect(isUsefulContextMessage({ senderName: "Sarah", type: "user", content: "Hello" })).toBe(true);
  });
});
