import type { ChatMessage, OrgUser, Room } from "@multichat/shared";
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, where, writeBatch } from "firebase/firestore";
import { Bot, Circle, LogOut, MessageSquarePlus, Send, Users } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { db } from "../lib/firebase";

interface ChatPageProps {
  user: User;
  onSignOut: () => void;
}

interface TypingUser {
  uid: string;
  displayName: string;
  expiresAtMillis: number;
}

interface PresenceUser {
  uid: string;
  displayName: string;
  expiresAtMillis: number;
}

interface LatestRoomMessage {
  senderId: string;
  createdAtMillis: number;
}

function getTimestampMillis(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "object" && value !== null && "seconds" in value && typeof value.seconds === "number") {
    return value.seconds * 1000;
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

export function ChatPage({ user, onSignOut }: ChatPageProps) {
  const [profile, setProfile] = useState<OrgUser | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [roomReadTimes, setRoomReadTimes] = useState<Record<string, number>>({});
  const [latestRoomMessages, setLatestRoomMessages] = useState<Record<string, LatestRoomMessage>>({});
  const [draft, setDraft] = useState("");
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [roomActionError, setRoomActionError] = useState<string | null>(null);
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
  const [isMemberManagerOpen, setIsMemberManagerOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomDescription, setNewRoomDescription] = useState("");
  const [newRoomMemberIds, setNewRoomMemberIds] = useState<string[]>([user.uid]);
  const [activeRoomMemberIds, setActiveRoomMemberIds] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingWriteRef = useRef(0);
  const [now, setNow] = useState(Date.now());

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [activeRoomId, rooms]
  );
  const isAdmin = profile?.role === "admin";
  const sortedOrgUsers = useMemo(
    () => [...orgUsers].sort((firstUser, secondUser) => firstUser.displayName.localeCompare(secondUser.displayName)),
    [orgUsers]
  );
  const unreadRoomIds = useMemo(() => {
    const nextUnreadRoomIds = new Set<string>();

    for (const room of rooms) {
      const latestMessage = latestRoomMessages[room.id];
      const lastReadAt = roomReadTimes[room.id] ?? 0;

      if (
        room.id !== activeRoomId &&
        latestMessage &&
        latestMessage.senderId !== user.uid &&
        latestMessage.createdAtMillis > lastReadAt
      ) {
        nextUnreadRoomIds.add(room.id);
      }
    }

    return nextUnreadRoomIds;
  }, [activeRoomId, latestRoomMessages, roomReadTimes, rooms, user.uid]);
  const visibleTypingUsers = useMemo(
    () => typingUsers.filter((typingUser) => typingUser.expiresAtMillis > now),
    [now, typingUsers]
  );
  const visiblePresenceUsers = useMemo(
    () => presenceUsers.filter((presenceUser) => presenceUser.expiresAtMillis > now),
    [now, presenceUsers]
  );
  const typingLabel = useMemo(() => {
    const names = visibleTypingUsers.map((typingUser) => typingUser.displayName);

    if (names.length === 0) {
      return null;
    }

    if (names.length === 1) {
      return `${names[0]} is typing...`;
    }

    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing...`;
    }

    return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others are typing...`;
  }, [visibleTypingUsers]);

  useEffect(() => {
    // Read only the signed-in user's profile. Firestore rules intentionally block listing all profiles.
    const profileRef = doc(db, "userProfiles", user.uid);
    const unsubscribe = onSnapshot(profileRef, (snapshot) => {
      setProfile(snapshot.exists() ? (snapshot.data() as OrgUser) : null);
    });

    return unsubscribe;
  }, [user.uid]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    // Rooms are filtered by membership so tenants never need a broad room query in the UI.
    const roomsRef = collection(db, "organizations", profile.orgId, "rooms");
    const roomsQuery = query(roomsRef, where("memberIds", "array-contains", user.uid));
    const unsubscribe = onSnapshot(roomsQuery, (snapshot) => {
      const nextRooms = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Room);
      setRooms(nextRooms);
      setActiveRoomId((current) => current ?? nextRooms[0]?.id ?? null);
    });

    return unsubscribe;
  }, [profile, user.uid]);

  useEffect(() => {
    if (!profile) {
      setOrgUsers([]);
      return;
    }

    const usersRef = collection(db, "organizations", profile.orgId, "users");

    return onSnapshot(usersRef, (snapshot) => {
      setOrgUsers(snapshot.docs.map((item) => item.data() as OrgUser));
    });
  }, [profile]);

  useEffect(() => {
    if (!profile || rooms.length === 0) {
      setRoomReadTimes({});
      return;
    }

    const unsubscribeReadStates = rooms.map((room) =>
      onSnapshot(doc(db, "organizations", profile.orgId, "rooms", room.id, "readStates", user.uid), (snapshot) => {
        const data = snapshot.data() as { lastReadAt?: Timestamp } | undefined;
        const lastReadAt = getTimestampMillis(data?.lastReadAt) ?? 0;

        setRoomReadTimes((current) => ({ ...current, [room.id]: lastReadAt }));
      })
    );

    return () => {
      unsubscribeReadStates.forEach((unsubscribe) => unsubscribe());
    };
  }, [profile, rooms, user.uid]);

  useEffect(() => {
    if (!profile || rooms.length === 0) {
      setLatestRoomMessages({});
      return;
    }

    const unsubscribeLatestMessages = rooms.map((room) => {
      const messagesRef = collection(db, "organizations", profile.orgId, "rooms", room.id, "messages");
      const latestMessageQuery = query(messagesRef, orderBy("createdAt", "desc"), limit(1));

      return onSnapshot(latestMessageQuery, (snapshot) => {
        const latestMessageDoc = snapshot.docs[0];

        setLatestRoomMessages((current) => {
          if (!latestMessageDoc) {
            const remainingRooms = { ...current };
            delete remainingRooms[room.id];
            return remainingRooms;
          }

          const data = latestMessageDoc.data() as ChatMessage;
          const createdAtMillis = getTimestampMillis(data.createdAt) ?? Date.now();

          return {
            ...current,
            [room.id]: {
              senderId: data.senderId,
              createdAtMillis
            }
          };
        });
      });
    });

    return () => {
      unsubscribeLatestMessages.forEach((unsubscribe) => unsubscribe());
    };
  }, [profile, rooms]);

  useEffect(() => {
    setNewRoomMemberIds((current) => (current.includes(user.uid) ? current : [...current, user.uid]));
  }, [user.uid]);

  useEffect(() => {
    setActiveRoomMemberIds(activeRoom?.memberIds ?? []);
    setIsMemberManagerOpen(false);
  }, [activeRoom]);

  useEffect(() => {
    if (!profile || !activeRoomId) {
      setMessages([]);
      return;
    }

    // This listener is the core realtime chat path: Firestore pushes new messages to every room member.
    const messagesRef = collection(db, "organizations", profile.orgId, "rooms", activeRoomId, "messages");
    const messagesQuery = query(messagesRef, orderBy("createdAt", "asc"), limit(100));

    return onSnapshot(messagesQuery, (snapshot) => {
      setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ChatMessage));
    });
  }, [activeRoomId, profile]);

  useEffect(() => {
    if (!profile || !activeRoomId) {
      setTypingUsers([]);
      return;
    }

    const typingRef = collection(db, "organizations", profile.orgId, "rooms", activeRoomId, "typing");

    return onSnapshot(typingRef, (snapshot) => {
      const nextTypingUsers = snapshot.docs
        .map((typingDoc) => {
          const data = typingDoc.data() as {
            displayName?: string;
            isTyping?: boolean;
            expiresAt?: Timestamp;
          };

          return {
            uid: typingDoc.id,
            displayName: data.displayName ?? "Someone",
            isTyping: data.isTyping === true,
            expiresAtMillis: data.expiresAt?.toMillis() ?? 0
          };
        })
        .filter((typingUser) => typingUser.uid !== user.uid && typingUser.isTyping)
        .map(({ uid, displayName, expiresAtMillis }) => ({ uid, displayName, expiresAtMillis }));

      setTypingUsers(nextTypingUsers);
    });
  }, [activeRoomId, profile, user.uid]);

  useEffect(() => {
    if (!profile || !activeRoomId) {
      setPresenceUsers([]);
      return;
    }

    const presenceRef = collection(db, "organizations", profile.orgId, "rooms", activeRoomId, "presence");

    return onSnapshot(presenceRef, (snapshot) => {
      const nextPresenceUsers = snapshot.docs
        .map((presenceDoc) => {
          const data = presenceDoc.data() as {
            displayName?: string;
            isOnline?: boolean;
            expiresAt?: Timestamp;
          };

          return {
            uid: presenceDoc.id,
            displayName: data.displayName ?? "Someone",
            isOnline: data.isOnline === true,
            expiresAtMillis: data.expiresAt?.toMillis() ?? 0
          };
        })
        .filter((presenceUser) => presenceUser.isOnline)
        .map(({ uid, displayName, expiresAtMillis }) => ({ uid, displayName, expiresAtMillis }));

      setPresenceUsers(nextPresenceUsers);
    });
  }, [activeRoomId, profile]);

  useEffect(() => {
    if (!profile || !activeRoomId) {
      return;
    }

    const presenceRef = doc(db, "organizations", profile.orgId, "rooms", activeRoomId, "presence", user.uid);

    async function writePresence(isOnline: boolean) {
      await setDoc(
        presenceRef,
        {
          displayName: profile?.displayName ?? "Unknown user",
          isOnline,
          lastSeen: serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 45000)
        },
        { merge: true }
      );
    }

    // Firestore does not have a browser disconnect hook like Realtime Database.
    // A short heartbeat plus expiresAt gives us reliable-enough room presence for this assessment.
    void writePresence(true);
    const interval = window.setInterval(() => {
      void writePresence(true);
    }, 15000);

    return () => {
      window.clearInterval(interval);
      void writePresence(false);
    };
  }, [activeRoomId, profile, user.uid]);

  useEffect(() => {
    // In busy rooms, keep the composer visible and move the scroll position to the newest message.
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!profile || !activeRoomId) {
      return;
    }

    const latestMessage = messages[messages.length - 1];
    const lastReadAt = getTimestampMillis(latestMessage?.createdAt) ?? Date.now();

    // Persist read state per user, per room. This powers unread indicators after reloads too.
    setRoomReadTimes((current) => ({ ...current, [activeRoomId]: lastReadAt }));
    void setDoc(
      doc(db, "organizations", profile.orgId, "rooms", activeRoomId, "readStates", user.uid),
      {
        uid: user.uid,
        lastReadAt: Timestamp.fromMillis(lastReadAt),
        lastReadMessageId: latestMessage?.id ?? null,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }, [activeRoomId, messages, profile, user.uid]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  async function writeTypingState(isTyping: boolean) {
    if (!profile || !activeRoomId) {
      return;
    }

    await setDoc(
      doc(db, "organizations", profile.orgId, "rooms", activeRoomId, "typing", user.uid),
      {
        displayName: profile.displayName,
        isTyping,
        updatedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 3500)
      },
      { merge: true }
    );
  }

  function handleDraftChange(value: string) {
    setDraft(value);

    if (!profile || !activeRoomId) {
      return;
    }

    const currentTime = Date.now();

    // Throttle writes so normal typing does not create a Firestore write per keypress.
    if (currentTime - lastTypingWriteRef.current > 1000) {
      lastTypingWriteRef.current = currentTime;
      void writeTypingState(value.trim().length > 0);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      void writeTypingState(false);
    }, 1800);
  }

  function toggleNewRoomMember(uid: string) {
    setNewRoomMemberIds((current) => {
      if (uid === user.uid) {
        return current;
      }

      return current.includes(uid) ? current.filter((memberId) => memberId !== uid) : [...current, uid];
    });
  }

  function toggleActiveRoomMember(uid: string) {
    setActiveRoomMemberIds((current) => {
      if (uid === user.uid) {
        return current;
      }

      return current.includes(uid) ? current.filter((memberId) => memberId !== uid) : [...current, uid];
    });
  }

  function closeCreateRoomForm() {
    setIsCreateRoomOpen(false);
    setRoomActionError(null);
    setNewRoomName("");
    setNewRoomDescription("");
    setNewRoomMemberIds([user.uid]);
  }

  function closeMemberManager() {
    setIsMemberManagerOpen(false);
    setRoomActionError(null);
    setActiveRoomMemberIds(activeRoom?.memberIds ?? []);
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profile || !isAdmin) {
      return;
    }

    const name = newRoomName.trim().replace(/^#/, "");
    const description = newRoomDescription.trim();
    const memberIds = [...new Set([user.uid, ...newRoomMemberIds])];

    if (!name || memberIds.length === 0) {
      setRoomActionError("Room name and at least one member are required.");
      return;
    }

    try {
      setRoomActionError(null);
      const batch = writeBatch(db);
      const roomRef = doc(collection(db, "organizations", profile.orgId, "rooms"));

      batch.set(roomRef, {
        orgId: profile.orgId,
        name,
        description,
        memberIds,
        createdAt: serverTimestamp()
      });

      for (const memberId of memberIds) {
        const member = orgUsers.find((orgUser) => orgUser.uid === memberId);
        batch.set(doc(roomRef, "members", memberId), {
          uid: memberId,
          displayName: member?.displayName ?? "Unknown user",
          joinedAt: serverTimestamp()
        });
      }

      await batch.commit();
      setNewRoomName("");
      setNewRoomDescription("");
      setNewRoomMemberIds([user.uid]);
      setIsCreateRoomOpen(false);
      setActiveRoomId(roomRef.id);
    } catch (error) {
      setRoomActionError(error instanceof Error ? error.message : "Could not create room.");
    }
  }

  async function saveActiveRoomMembers() {
    if (!profile || !activeRoom || !isAdmin) {
      return;
    }

    const memberIds = [...new Set([user.uid, ...activeRoomMemberIds])];

    try {
      setRoomActionError(null);
      const batch = writeBatch(db);
      const roomRef = doc(db, "organizations", profile.orgId, "rooms", activeRoom.id);

      batch.update(roomRef, { memberIds });

      for (const memberId of memberIds) {
        const member = orgUsers.find((orgUser) => orgUser.uid === memberId);
        batch.set(doc(roomRef, "members", memberId), {
          uid: memberId,
          displayName: member?.displayName ?? "Unknown user",
          joinedAt: serverTimestamp()
        });
      }

      for (const previousMemberId of activeRoom.memberIds) {
        if (!memberIds.includes(previousMemberId)) {
          batch.delete(doc(roomRef, "members", previousMemberId));
        }
      }

      await batch.commit();
      setIsMemberManagerOpen(false);
    } catch (error) {
      setRoomActionError(error instanceof Error ? error.message : "Could not update room members.");
    }
  }

  async function requestAiResponse(orgId: string, roomId: string) {
    setAiPending(true);
    setAiError(null);

    try {
      const token = await user.getIdToken();
      const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
      const apiUrl = apiBaseUrl ? `${apiBaseUrl}/api/ai/stream` : "/api/ai/stream";
      // The backend is the only place allowed to call Vertex AI; the browser only sends a Firebase ID token.
      const apiResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ orgId, roomId })
      });

      if (!apiResponse.ok) {
        const responseText = await apiResponse.text();
        const contentType = apiResponse.headers.get("content-type") ?? "";
        const parsedBody = contentType.includes("application/json") ? JSON.parse(responseText) : null;
        const fallbackMessage = responseText.slice(0, 180) || "Gemini request failed.";
        const errorMessage = parsedBody?.error ?? fallbackMessage;
        throw new Error(`${apiResponse.status} from ${apiUrl}: ${errorMessage}`);
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Gemini request failed.");
    } finally {
      setAiPending(false);
    }
  }

  async function retryAiResponse() {
    if (!profile || !activeRoomId || aiPending) {
      return;
    }

    await requestAiResponse(profile.orgId, activeRoomId);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    if (!profile || !activeRoomId || !content) {
      return;
    }

    setDraft("");
    lastTypingWriteRef.current = 0;

    await addDoc(collection(db, "organizations", profile.orgId, "rooms", activeRoomId, "messages"), {
      orgId: profile.orgId,
      roomId: activeRoomId,
      senderId: user.uid,
      senderName: profile.displayName,
      type: "user",
      content,
      createdAt: serverTimestamp()
    });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    await setDoc(doc(db, "organizations", profile.orgId, "rooms", activeRoomId, "typing", user.uid), {
      displayName: profile.displayName,
      isTyping: false,
      updatedAt: serverTimestamp()
    });

    // Gemini is opt-in per message. Normal chat stays cheap and does not hit the AI endpoint.
    if (/@(?:gemini|ai)\b/i.test(content)) {
      await requestAiResponse(profile.orgId, activeRoomId);
    }
  }

  if (!profile) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-6 text-center text-sm text-slate-500">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/70">
          User profile not found. Seed this Firebase user in Firestore before continuing.
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen overflow-hidden bg-slate-100 p-3 text-slate-900 sm:p-4">
      <div className="grid h-full min-h-0 w-full grid-rows-[220px_minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/40 md:grid-rows-none md:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-white md:border-b-0 md:border-r">
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
          <div>
            <p className="text-sm font-semibold text-slate-950">TeamChat AI</p>
            <p className="text-xs text-slate-500">{profile.orgId}</p>
          </div>
          <button
            aria-label="Sign out"
            className="grid size-9 place-items-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            onClick={onSignOut}
            type="button"
          >
            <LogOut size={18} />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rooms</p>
              {isAdmin ? (
                <button
                  aria-label="Create room"
                  className={[
                    "grid size-8 place-items-center rounded-md transition",
                    isCreateRoomOpen
                      ? "bg-slate-950 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                  ].join(" ")}
                  onClick={() => {
                    setRoomActionError(null);
                    setIsCreateRoomOpen((current) => !current);
                  }}
                  type="button"
                >
                  <MessageSquarePlus size={17} />
                </button>
              ) : null}
            </div>
            {isAdmin && isCreateRoomOpen ? (
              <form
                className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-sm"
                onSubmit={createRoom}
              >
                <div className="grid gap-2">
                  <label className="grid gap-1 text-xs font-medium text-slate-600">
                    Room name
                    <input
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                      onChange={(event) => setNewRoomName(event.target.value)}
                      placeholder="engineering"
                      value={newRoomName}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-slate-600">
                    Description
                    <input
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                      onChange={(event) => setNewRoomDescription(event.target.value)}
                      placeholder="Optional context"
                      value={newRoomDescription}
                    />
                  </label>
                </div>
                <div className="mt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Members</p>
                  <div className="grid max-h-36 gap-1 overflow-y-auto pr-1">
                    {sortedOrgUsers.map((orgUser) => (
                      <label
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-white"
                        key={orgUser.uid}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{orgUser.displayName}</span>
                          <span className="block truncate text-xs text-slate-400">{orgUser.role}</span>
                        </span>
                        <input
                          checked={newRoomMemberIds.includes(orgUser.uid)}
                          className="size-4 rounded border-slate-300 text-cyan-600"
                          disabled={orgUser.uid === user.uid}
                          onChange={() => toggleNewRoomMember(orgUser.uid)}
                          type="checkbox"
                        />
                      </label>
                    ))}
                  </div>
                </div>
                {roomActionError ? (
                  <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{roomActionError}</p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    className="h-9 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                    onClick={closeCreateRoomForm}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="h-9 rounded-md bg-slate-950 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    disabled={!newRoomName.trim()}
                    type="submit"
                  >
                    Create
                  </button>
                </div>
              </form>
            ) : null}
            <nav className="grid gap-1">
              {rooms.map((room) => {
                const hasUnreadMessages = unreadRoomIds.has(room.id);

                return (
                  <button
                    className={[
                      "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition",
                      room.id === activeRoomId
                        ? "bg-slate-950 text-white shadow-sm"
                        : hasUnreadMessages
                          ? "bg-cyan-50 text-slate-950 ring-1 ring-cyan-100 hover:bg-cyan-100"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                    ].join(" ")}
                    key={room.id}
                    onClick={() => setActiveRoomId(room.id)}
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
        </aside>
        <section className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div>
            <h1 className="text-base font-semibold text-slate-950">
              {activeRoom ? `# ${activeRoom.name}` : "No room selected"}
            </h1>
            <p className="text-sm text-slate-500">
              {profile.displayName} / {profile.role}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && activeRoom ? (
              <button
                className={[
                  "hidden h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition sm:flex",
                  isMemberManagerOpen
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                ].join(" ")}
                onClick={() => {
                  setRoomActionError(null);
                  setIsMemberManagerOpen((current) => !current);
                }}
                type="button"
              >
                <Users size={15} />
                Members
              </button>
            ) : null}
            <div className="hidden items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-sm font-medium text-cyan-700 sm:flex">
              <Bot size={16} />
              {aiPending ? "Gemini thinking" : "Gemini ready"}
            </div>
          </div>
        </header>
        {aiError ? (
          <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
            <span>{aiError}</span>
            <button
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={aiPending || !activeRoomId}
              onClick={retryAiResponse}
              type="button"
            >
              Retry Gemini
            </button>
          </div>
        ) : null}
        {isAdmin && activeRoom && isMemberManagerOpen ? (
          <div className="flex-none border-b border-slate-200 bg-white px-5 py-4">
            <div className="mx-auto max-w-4xl rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Room members</p>
                  <p className="text-xs text-slate-500">Only selected users can see and write in this room.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                    onClick={closeMemberManager}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="h-9 rounded-md bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
                    onClick={saveActiveRoomMembers}
                    type="button"
                  >
                    Save changes
                  </button>
                </div>
              </div>
              <div className="grid max-h-40 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                {sortedOrgUsers.map((orgUser) => (
                  <label
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
                    key={orgUser.uid}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800">{orgUser.displayName}</span>
                      <span className="block truncate text-xs text-slate-400">{orgUser.email}</span>
                    </span>
                    <input
                      checked={activeRoomMemberIds.includes(orgUser.uid)}
                      className="size-4 rounded border-slate-300 text-cyan-600"
                      disabled={orgUser.uid === user.uid}
                      onChange={() => toggleActiveRoomMember(orgUser.uid)}
                      type="checkbox"
                    />
                  </label>
                ))}
              </div>
              {roomActionError ? (
                <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{roomActionError}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-5 py-6">
          {messages.length === 0 ? (
            <div className="grid h-full place-items-center">
              <div className="max-w-sm text-center">
                <div className="mx-auto mb-4 grid size-12 place-items-center rounded-lg bg-white text-slate-500 shadow-sm">
                  <Bot size={22} />
                </div>
                <h2 className="text-lg font-semibold text-slate-950">No messages yet</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Start the room conversation. Mention @Gemini when the team needs an AI response.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {messages.map((message) => (
                <article
                  className={[
                    "rounded-lg border p-4 shadow-sm",
                    message.type === "ai"
                      ? message.status === "error"
                        ? "border-red-200 bg-red-50"
                        : "border-cyan-200 bg-cyan-50"
                      : "border-slate-200 bg-white"
                  ].join(" ")}
                  key={message.id}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <strong className="text-slate-950">{message.senderName}</strong>
                    <span className="text-xs text-slate-400">{formatMessageTime(message.createdAt)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      {message.type === "ai" ? "Gemini" : "Member"}
                    </span>
                    {message.status === "streaming" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">
                        <span className="size-1.5 animate-pulse rounded-full bg-cyan-600" />
                        Streaming
                      </span>
                    ) : null}
                    {message.status === "error" ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Failed
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {message.content || (message.status === "streaming" ? "Gemini is reading the room..." : "")}
                    {message.status === "streaming" ? (
                      <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-cyan-500 align-[-2px]" />
                    ) : null}
                  </p>
                  {message.type === "ai" && message.status === "error" ? (
                    <button
                      className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={aiPending || !activeRoomId}
                      onClick={retryAiResponse}
                      type="button"
                    >
                      Retry Gemini
                    </button>
                  ) : null}
                </article>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
        {typingLabel ? (
          <div className="flex-none border-t border-slate-200 bg-white px-5 py-2 text-sm italic text-slate-500">
            {typingLabel}
          </div>
        ) : null}
        <form className="grid flex-none grid-cols-[1fr_auto] gap-3 border-t border-slate-200 bg-white p-4" onSubmit={sendMessage}>
          <input
            className="h-11 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            onChange={(event) => handleDraftChange(event.target.value)}
            placeholder="Type a message or mention @Gemini..."
            value={draft}
          />
          <button
            aria-label="Send message"
            className="grid h-11 w-11 place-items-center rounded-md bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={aiPending}
            type="submit"
          >
            <Send size={18} />
          </button>
        </form>
        </section>
      </div>
    </main>
  );
}
