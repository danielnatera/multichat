export type UserRole = "admin" | "member";

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface OrgUser {
  uid: string;
  /** Tenant slug, also used as the organization document id. */
  orgId: string;
  displayName: string;
  email: string;
  role: UserRole;
}

export interface Room {
  id: string;
  /** Tenant slug, also used as the organization document id. */
  orgId: string;
  name: string;
  memberIds: string[];
  description?: string;
  aiPersonaPrompt?: string;
  createdAt: unknown;
}

export interface ChatMessage {
  id: string;
  /** Tenant slug, also used as the organization document id. */
  orgId: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderRole?: UserRole;
  type: "user" | "ai" | "system";
  content: string;
  parentMessageId?: string;
  parentSenderName?: string;
  parentMessagePreview?: string;
  createdAt: unknown;
  status?: "streaming" | "complete" | "error";
}
