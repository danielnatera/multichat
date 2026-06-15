import type { OrgUser, UserRole } from "@multichat/shared";
import { X } from "lucide-react";
import type { FormEvent } from "react";

interface CreateRoomModalProps {
  currentUserId: string;
  description: string;
  isClosing: boolean;
  memberIds: string[];
  name: string;
  onClose: () => void;
  onDescriptionChange: (value: string) => void;
  onMemberToggle: (uid: string) => void;
  onNameChange: (value: string) => void;
  onPersonaPromptChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  personaPrompt: string;
  roomActionError: string | null;
  sortedOrgUsers: OrgUser[];
}

function formatRoleLabel(role?: UserRole) {
  return role === "admin" ? "Admin" : "Member";
}

export function CreateRoomModal({
  currentUserId,
  description,
  isClosing,
  memberIds,
  name,
  onClose,
  onDescriptionChange,
  onMemberToggle,
  onNameChange,
  onPersonaPromptChange,
  onSubmit,
  personaPrompt,
  roomActionError,
  sortedOrgUsers
}: CreateRoomModalProps) {
  return (
    <div
      aria-labelledby="create-room-modal-title"
      aria-modal="true"
      className={[
        "modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-900/45 px-4 py-6 backdrop-blur-sm",
        isClosing ? "modal-overlay-out" : ""
      ].join(" ")}
      role="dialog"
    >
      <button aria-label="Close create room" className="absolute inset-0 cursor-default" onClick={onClose} type="button" />
      <form
        className={[
          "modal-panel relative flex max-h-[min(680px,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20",
          isClosing ? "modal-panel-out" : ""
        ].join(" ")}
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Admin controls</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900" id="create-room-modal-title">
              Create new room
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Set the room details and choose who can access the conversation.
            </p>
          </div>
          <button
            aria-label="Close create room"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto bg-slate-50 px-5 py-4">
          <div className="grid min-w-0 gap-3">
            <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
              Room name
              <input
                className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="engineering"
                value={name}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
              Description
              <input
                className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                onChange={(event) => onDescriptionChange(event.target.value)}
                placeholder="Optional context"
                value={description}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
              AI persona prompt
              <textarea
                className="min-h-24 w-full min-w-0 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal leading-6 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                maxLength={800}
                onChange={(event) => onPersonaPromptChange(event.target.value)}
                placeholder="Optional. Example: Act as a concise senior backend architect. Prefer tradeoffs, risks, and next steps."
                value={personaPrompt}
              />
              <span className="text-xs font-normal text-slate-400">
                Optional instructions that shape Gemini's tone and behavior in this room.
              </span>
            </label>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Members</p>
            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {sortedOrgUsers.map((orgUser) => (
                <label
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600 shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50/40"
                  key={orgUser.uid}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{orgUser.displayName}</span>
                    <span className="block truncate text-xs text-slate-400">{formatRoleLabel(orgUser.role)}</span>
                  </span>
                  <input
                    checked={memberIds.includes(orgUser.uid)}
                    className="size-4 shrink-0 rounded border-slate-300 text-cyan-600"
                    disabled={orgUser.uid === currentUserId}
                    onChange={() => onMemberToggle(orgUser.uid)}
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
          </div>
          {roomActionError ? (
            <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{roomActionError}</p>
          ) : null}
        </div>
        <div className="flex flex-none flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <button
            className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-md bg-slate-800 px-4 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={!name.trim()}
            type="submit"
          >
            Create room
          </button>
        </div>
      </form>
    </div>
  );
}
