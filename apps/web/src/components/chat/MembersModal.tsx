import type { OrgUser, Room } from "@multichat/shared";
import { X } from "lucide-react";

interface MembersModalProps {
  activeRoom: Room;
  currentUserId: string;
  isClosing: boolean;
  memberIds: string[];
  onClose: () => void;
  onMemberToggle: (uid: string) => void;
  onPersonaPromptChange: (value: string) => void;
  onSave: () => void;
  personaPrompt: string;
  roomActionError: string | null;
  sortedOrgUsers: OrgUser[];
}

export function MembersModal({
  activeRoom,
  currentUserId,
  isClosing,
  memberIds,
  onClose,
  onMemberToggle,
  onPersonaPromptChange,
  onSave,
  personaPrompt,
  roomActionError,
  sortedOrgUsers
}: MembersModalProps) {
  return (
    <div
      aria-labelledby="members-modal-title"
      aria-modal="true"
      className={[
        "modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-900/45 px-4 py-6 backdrop-blur-sm",
        isClosing ? "modal-overlay-out" : ""
      ].join(" ")}
      role="dialog"
    >
      <button aria-label="Close member manager" className="absolute inset-0 cursor-default" onClick={onClose} type="button" />
      <div
        className={[
          "modal-panel relative flex max-h-[min(680px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20",
          isClosing ? "modal-panel-out" : ""
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Admin controls</p>
            <h2 className="mt-1 truncate text-lg font-semibold text-slate-900" id="members-modal-title">
              Manage # {activeRoom.name} members
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Configure access and the Gemini personality for this room.
            </p>
          </div>
          <button
            aria-label="Close member manager"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto bg-slate-50 px-5 py-4">
          <label className="mb-4 grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
            AI persona prompt
            <textarea
              className="min-h-24 w-full min-w-0 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal leading-6 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
              maxLength={800}
              onChange={(event) => onPersonaPromptChange(event.target.value)}
              placeholder="Optional. Example: Act as a concise senior backend architect. Prefer tradeoffs, risks, and next steps."
              value={personaPrompt}
            />
            <span className="text-xs font-normal text-slate-400">
              Gemini uses this instruction only inside this room.
            </span>
          </label>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Members</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {sortedOrgUsers.map((orgUser) => (
              <label
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600 shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50/40"
                key={orgUser.uid}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{orgUser.displayName}</span>
                  <span className="block truncate text-xs text-slate-400">{orgUser.email}</span>
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
          {roomActionError ? (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{roomActionError}</p>
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
            className="h-10 rounded-md bg-slate-800 px-4 text-sm font-medium text-white transition hover:bg-slate-700"
            onClick={onSave}
            type="button"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
