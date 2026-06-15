import type { ChatMessage } from "@multichat/shared";
import { AtSign, Send, X } from "lucide-react";
import type { FormEvent } from "react";
import { getMessagePreview } from "../../lib/messageFormatting";

interface MessageComposerProps {
  aiPending: boolean;
  draft: string;
  onCancelReply: () => void;
  onDraftChange: (value: string) => void;
  onInsertGeminiMention: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  replyingTo: ChatMessage | null;
  typingLabel: string | null;
}

export function MessageComposer({
  aiPending,
  draft,
  onCancelReply,
  onDraftChange,
  onInsertGeminiMention,
  onSubmit,
  replyingTo,
  typingLabel
}: MessageComposerProps) {
  return (
    <>
      {typingLabel ? (
        <div className="flex-none border-t border-slate-200 bg-white px-5 py-2 text-sm italic text-slate-500">
          {typingLabel}
        </div>
      ) : null}

      {replyingTo ? (
        <div className="flex flex-none items-start justify-between gap-3 border-t border-cyan-100 bg-cyan-50 px-5 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold text-cyan-800">Replying to {replyingTo.senderName}</p>
            <p className="mt-0.5 truncate text-cyan-700">{getMessagePreview(replyingTo.content || "Message")}</p>
          </div>
          <button
            aria-label="Cancel reply"
            className="grid size-8 shrink-0 place-items-center rounded-full text-cyan-700 transition hover:bg-cyan-100"
            onClick={onCancelReply}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <form className="grid flex-none grid-cols-[1fr_auto_auto] gap-2 border-t border-slate-200 bg-white p-4" onSubmit={onSubmit}>
        <input
          className="h-11 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Type a message or mention @Gemini..."
          value={draft}
        />
        <button
          aria-label="Insert Gemini mention"
          className="grid h-11 w-11 place-items-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
          onClick={onInsertGeminiMention}
          type="button"
        >
          <AtSign size={18} />
        </button>
        <button
          aria-label="Send message"
          className="grid h-11 w-11 place-items-center rounded-md bg-slate-800 text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={aiPending}
          type="submit"
        >
          <Send size={18} />
        </button>
      </form>
    </>
  );
}
