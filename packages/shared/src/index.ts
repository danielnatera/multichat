export type UserRole = "admin" | "member";

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface OrgUser {
  uid: string;
  orgId: string;
  displayName: string;
  email: string;
  role: UserRole;
}

export interface Room {
  id: string;
  orgId: string;
  name: string;
  memberIds: string[];
  description?: string;
  createdAt: unknown;
}

export interface ChatMessage {
  id: string;
  orgId: string;
  roomId: string;
  senderId: string;
  senderName: string;
  type: "user" | "ai" | "system";
  content: string;
  createdAt: unknown;
  status?: "streaming" | "complete" | "error";
}
