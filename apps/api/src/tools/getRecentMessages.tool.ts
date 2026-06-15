import { z } from "zod";
import { formatContextMessage, isUsefulContextMessage } from "../lib/aiContext.js";
import { defineAiTool } from "./types.js";

export const getRecentMessagesTool = defineAiTool({
  name: "get_recent_messages",
  description: "Returns recent useful room messages with sender attribution.",
  parameters: z.object({
    limit: z.number().int().min(1).max(20).default(10)
  }),
  parametersDescription: '{ "limit": "number from 1 to 20, defaults to 10" }',
  async execute(args, context) {
    const limit = args.limit ?? 10;
    console.log("[ai-tools:get_recent_messages] Reading recent messages", {
      orgId: context.orgId,
      roomId: context.roomId,
      limit,
      availableMessages: context.messages.length
    });

    // This uses the same bounded history already fetched for Gemini, so the tool stays cheap and tenant-scoped.
    const messages = context.messages
      .filter(isUsefulContextMessage)
      .slice(-limit)
      .map((message) => formatContextMessage(message));

    console.log("[ai-tools:get_recent_messages] Recent messages prepared", {
      count: messages.length,
      messages
    });

    return JSON.stringify({ messages }, null, 2);
  }
});
