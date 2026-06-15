import type { Room } from "@multichat/shared";
import { AlertTriangle, Bot, Users } from "lucide-react";

interface ChatHeaderProps {
  activeRoom: Room | null;
  aiError: string | null;
  aiPending: boolean;
  geminiModel: string;
  isAdmin: boolean;
  isMemberManagerOpen: boolean;
  onToggleMembers: () => void;
}

export function ChatHeader({
  activeRoom,
  aiError,
  aiPending,
  geminiModel,
  isAdmin,
  isMemberManagerOpen,
  onToggleMembers
}: ChatHeaderProps) {
  return (
    <>
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5">
        <div>
          <h1 className="text-base font-semibold text-slate-900">
            {activeRoom ? `# ${activeRoom.name}` : "No room selected"}
          </h1>
          <p className="text-sm text-slate-500">{activeRoom?.description || "No room description"}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && activeRoom ? (
            <button
              className={[
                "hidden h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition sm:flex",
                isMemberManagerOpen
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              ].join(" ")}
              onClick={onToggleMembers}
              type="button"
            >
              <Users size={15} />
              Members
            </button>
          ) : null}
          <div
            aria-label={aiError ? "Gemini unavailable" : aiPending ? "Gemini is generating" : "Gemini available"}
            className={[
              "hidden h-9 cursor-default select-none items-center gap-2 rounded-full border px-3 text-sm font-medium sm:flex",
              aiError
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : aiPending
                  ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                  : "border-transparent bg-slate-100 text-slate-600"
            ].join(" ")}
            title={aiError ? "Gemini API is currently unavailable" : `Model: ${geminiModel}`}
          >
            {aiPending ? (
              <span className="size-3 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-700" />
            ) : (
              <Bot size={15} />
            )}
            Gemini
          </div>
        </div>
      </header>

      {aiError ? (
        <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-800">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-700">
              <AlertTriangle size={15} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">Gemini is unavailable right now</p>
              <p className="mt-0.5 text-rose-700">{aiError}</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
