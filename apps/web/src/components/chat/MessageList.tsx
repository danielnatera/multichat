import type { ChatMessage, OrgUser, UserRole } from "@multichat/shared";
import { Bot, Reply } from "lucide-react";
import type { RefObject } from "react";
import { getMessagePreview, renderMessageContent } from "../../lib/messageFormatting";

interface MessageListProps {
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onReply: (message: ChatMessage) => void;
  orgUsers: OrgUser[];
  repliesByParentId: Map<string, ChatMessage[]>;
  topLevelMessages: ChatMessage[];
}

function getTimestampMillis(value: unknown) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "object" && value !== null && "seconds" in value && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  if (typeof value === "object" && value !== null && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis() as number;
  }

  return null;
}

function formatMessageTime(createdAt: unknown) {
  const timestampMillis = getTimestampMillis(createdAt);

  if (!timestampMillis) {
    return "Sending...";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestampMillis));
}

function formatRoleLabel(role?: UserRole) {
  return role === "admin" ? "Admin" : "Member";
}

function MessageBody({ fallback, message }: { fallback: string; message: ChatMessage }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
      {message.content ? renderMessageContent(message.content) : message.status === "streaming" ? fallback : ""}
      {message.status === "streaming" ? (
        <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-cyan-500 align-[-2px]" />
      ) : null}
    </p>
  );
}

function MessageBadges({ message, role }: { message: ChatMessage; role?: UserRole }) {
  return (
    <>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
        {message.type === "ai" ? "Gemini" : formatRoleLabel(role)}
      </span>
      {message.status === "streaming" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">
          <span className="size-1.5 animate-pulse rounded-full bg-cyan-600" />
          Streaming
        </span>
      ) : null}
      {message.status === "error" ? (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Failed</span>
      ) : null}
    </>
  );
}

export function MessageList({
  messagesEndRef,
  onReply,
  orgUsers,
  repliesByParentId,
  topLevelMessages
}: MessageListProps) {
  if (topLevelMessages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-5 py-6">
        <div className="grid h-full place-items-center">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-lg bg-white text-slate-500 shadow-sm">
              <Bot size={22} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">No messages yet</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Start the room conversation. Mention @Gemini or @AI when the team needs an AI response.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-5 py-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {topLevelMessages.map((message) => {
          const senderRole = message.senderRole ?? orgUsers.find((orgUser) => orgUser.uid === message.senderId)?.role;
          const replies = repliesByParentId.get(message.id) ?? [];

          return (
            <article
              className={[
                "relative rounded-lg border p-4 pb-12 shadow-sm",
                message.type === "ai"
                  ? message.status === "error"
                    ? "border-red-200 bg-red-50"
                    : "border-cyan-200 bg-cyan-50"
                  : "border-slate-200 bg-white"
              ].join(" ")}
              key={message.id}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <strong className="text-slate-900">{message.senderName}</strong>
                <span className="text-xs text-slate-400">{formatMessageTime(message.createdAt)}</span>
                <MessageBadges message={message} role={senderRole} />
              </div>

              <MessageBody fallback="Gemini is reading the room..." message={message} />

              {replies.length > 0 ? (
                <div className="mt-4 grid gap-3 border-l-2 border-cyan-100 pl-4">
                  {replies.map((reply) => {
                    const replySenderRole =
                      reply.senderRole ?? orgUsers.find((orgUser) => orgUser.uid === reply.senderId)?.role;

                    return (
                      <article
                        className="relative rounded-lg border border-slate-200 bg-white/80 p-3 pb-12 shadow-sm"
                        key={reply.id}
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                          <strong className="text-slate-900">{reply.senderName}</strong>
                          <span className="text-xs text-slate-400">{formatMessageTime(reply.createdAt)}</span>
                          <MessageBadges message={reply} role={replySenderRole} />
                          <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700">
                            Thread reply
                          </span>
                        </div>
                        <p className="mb-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          Replying to {reply.parentSenderName ?? message.senderName}: “
                          {reply.parentMessagePreview ?? getMessagePreview(message.content)}”
                        </p>
                        <MessageBody fallback="Gemini is reading the thread..." message={reply} />
                        {reply.status !== "streaming" && reply.status !== "error" ? (
                          <button
                            aria-label={`Reply to ${reply.senderName}`}
                            className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-cyan-700"
                            onClick={() => onReply(reply)}
                            title={`Reply to ${reply.senderName}`}
                            type="button"
                          >
                            <Reply size={15} />
                          </button>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {message.status !== "streaming" && message.status !== "error" ? (
                <button
                  aria-label={`Reply to ${message.senderName}`}
                  className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-cyan-700"
                  onClick={() => onReply(message)}
                  title={`Reply to ${message.senderName}`}
                  type="button"
                >
                  <Reply size={15} />
                </button>
              ) : null}
            </article>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
