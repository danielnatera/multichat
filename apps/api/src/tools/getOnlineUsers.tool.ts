import { z } from "zod";
import { defineAiTool } from "./types.js";

interface PresenceData {
  displayName?: string;
  expiresAt?: { toMillis?: () => number };
  isOnline?: boolean;
}

export const getOnlineUsersTool = defineAiTool({
  name: "get_online_users",
  description: "Returns users currently online in the active room based on room presence heartbeat.",
  parameters: z.object({}),
  parametersDescription: "{}",
  async execute(_args, context) {
    console.log("[ai-tools:get_online_users] Loading presence", {
      orgId: context.orgId,
      roomId: context.roomId
    });

    const presenceSnapshot = await context.firestore
      .collection("organizations")
      .doc(context.orgId)
      .collection("rooms")
      .doc(context.roomId)
      .collection("presence")
      .get();

    const now = Date.now();
    const onlineUsers = presenceSnapshot.docs
      .map((doc) => doc.data() as PresenceData)
      .filter((presence) => presence.isOnline === true && (presence.expiresAt?.toMillis?.() ?? 0) > now)
      .map((presence) => presence.displayName ?? "Unknown user");

    console.log("[ai-tools:get_online_users] Online users loaded", {
      count: onlineUsers.length,
      onlineUsers
    });

    return JSON.stringify({ onlineUsers }, null, 2);
  }
});
