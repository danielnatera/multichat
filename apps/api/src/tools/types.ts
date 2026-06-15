import type { z } from "zod";
import type { RoomData, RoomMessageData } from "../lib/aiContext.js";

export interface ToolContext {
  firestore: FirebaseFirestore.Firestore;
  messages: RoomMessageData[];
  orgId: string;
  room: RoomData;
  roomId: string;
  uid: string;
}

export interface AiTool<TArgs> {
  name: string;
  description: string;
  parameters: z.ZodSchema<TArgs>;
  parametersDescription: string;
  execute: (args: TArgs, context: ToolContext) => Promise<string>;
}

export type AnyAiTool = AiTool<any>;

export function defineAiTool<TArgs>(tool: AiTool<TArgs>) {
  return tool;
}
