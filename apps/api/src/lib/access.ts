import { firestore } from "./firebaseAdmin.js";

export async function assertRoomAccess(uid: string, orgId: string, roomId: string) {
  // Membership documents are the backend source of truth for room-level authorization.
  const memberRef = firestore
    .collection("organizations")
    .doc(orgId)
    .collection("rooms")
    .doc(roomId)
    .collection("members")
    .doc(uid);

  const member = await memberRef.get();

  if (!member.exists) {
    // Naming this error lets route handlers translate it into a clean 403.
    const error = new Error("Room access denied.");
    error.name = "ForbiddenError";
    throw error;
  }
}
