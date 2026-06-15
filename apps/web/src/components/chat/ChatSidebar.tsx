import type { OrgUser, Room, UserRole } from "@multichat/shared";
import { Circle, MessageSquarePlus, Users } from "lucide-react";
import { formatTenantLabel } from "../../lib/messageFormatting";

interface PresenceUser {
  uid: string;
  displayName: string;
}

interface ChatSidebarProps {
  activeRoomId: string | null;
  isAdmin: boolean;
  onCreateRoom: () => void;
  onSelectRoom: (roomId: string) => void;
  onSignOut: () => void;
  profile: OrgUser;
  rooms: Room[];
  unreadRoomIds: Set<string>;
  visiblePresenceUsers: PresenceUser[];
}

function formatRoleLabel(role?: UserRole) {
  return role === "admin" ? "Admin" : "Member";
}

export function ChatSidebar({
  activeRoomId,
  isAdmin,
  onCreateRoom,
  onSelectRoom,
  onSignOut,
  profile,
  rooms,
  unreadRoomIds,
  visiblePresenceUsers
}: ChatSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-white md:border-b-0 md:border-r">
      <div className="flex h-16 items-center border-b border-slate-200 px-5">
        <div>
          <p className="text-sm font-semibold text-slate-900">TeamChat AI</p>
          <p className="text-xs font-semibold tracking-wide text-slate-500">{formatTenantLabel(profile.orgId)}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rooms</p>
          </div>
          <nav className="grid gap-1">
            {rooms.map((room) => {
              const hasUnreadMessages = unreadRoomIds.has(room.id);

              return (
                <button
                  className={[
                    "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition",
                    room.id === activeRoomId
                      ? "bg-slate-800 text-white shadow-sm"
                      : hasUnreadMessages
                        ? "bg-cyan-50 text-slate-900 ring-1 ring-cyan-100 hover:bg-cyan-100"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  ].join(" ")}
                  key={room.id}
                  onClick={() => onSelectRoom(room.id)}
                  type="button"
                >
                  <span className="min-w-0 truncate"># {room.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {hasUnreadMessages ? (
                      <span className="rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        New
                      </span>
                    ) : null}
                    <span className={room.id === activeRoomId ? "text-slate-300" : "text-slate-400"}>
                      {room.memberIds?.length ?? 0}
                    </span>
                  </span>
                </button>
              );
            })}

            {isAdmin ? (
              <button
                className="mt-2 flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                onClick={onCreateRoom}
                type="button"
              >
                <MessageSquarePlus size={16} />
                New room
              </button>
            ) : null}
          </nav>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Users size={15} />
            Online ({visiblePresenceUsers.length})
          </p>
          <div className="grid gap-2 text-sm text-slate-600">
            {visiblePresenceUsers.length === 0 ? (
              <span className="text-slate-400">No one online</span>
            ) : (
              visiblePresenceUsers.map((presenceUser) => (
                <span className="flex items-center gap-2" key={presenceUser.uid}>
                  <Circle className="fill-emerald-500 text-emerald-500" size={9} />
                  {presenceUser.displayName}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex-none border-t border-slate-700 bg-slate-800 px-4 py-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{profile.displayName}</p>
            <p className="text-xs text-slate-300">
              {formatRoleLabel(profile.role)} · {formatTenantLabel(profile.orgId)}
            </p>
          </div>
          <button
            className="shrink-0 rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
            onClick={onSignOut}
            type="button"
          >
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
