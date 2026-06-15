import { z } from "zod";
import { defineAiTool } from "./types.js";

export const getRoomMembersTool = defineAiTool({
  name: "get_room_members",
  description: "Returns the current members of the active room with display names, emails, and roles.",
  parameters: z.object({}),
  parametersDescription: "{}",
  async execute(_args, context) {
    console.log("[ai-tools:get_room_members] Loading room members", {
      orgId: context.orgId,
      roomId: context.roomId,
      memberIds: context.room.memberIds ?? []
    });

    const roomMembers = new Set(context.room.memberIds ?? []);
    const usersSnapshot = await context.firestore
      .collection("organizations")
      .doc(context.orgId)
      .collection("users")
      .get();

    const members = usersSnapshot.docs
      .map((doc) => doc.data() as { uid?: string; displayName?: string; email?: string; role?: string })
      .filter((user) => user.uid && roomMembers.has(user.uid))
      .map((user) => ({
        name: user.displayName ?? "Unknown user",
        email: user.email ?? null,
        role: user.role ?? "member"
      }));

    console.log("[ai-tools:get_room_members] Members loaded", {
      count: members.length,
      members
    });

    return JSON.stringify({ members }, null, 2);
  }
});
