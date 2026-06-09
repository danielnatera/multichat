import type { ChatMessage, OrgUser, Room, UserRole } from "@multichat/shared";
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, where, writeBatch } from "firebase/firestore";
import { AlertTriangle, AtSign, Bot, Circle, MessageSquarePlus, Reply, Send, Users, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { db } from "../lib/firebase";
import { formatTenantLabel, getMessagePreview, renderMessageContent } from "../lib/messageFormatting";

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

type ClosingModal = "create-room" | "members" | null;

const MODAL_EXIT_DURATION_MS = 160;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 8000;
const PRESENCE_EXPIRATION_MS = 20000;

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

function formatRoleLabel(role?: UserRole) {
  return role === "admin" ? "Admin" : "Member";
}

function parseJsonSafely(text: string) {
  try {
    return JSON.parse(text) as { error?: string; requestId?: string };
  } catch {
    return null;
  }
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
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [roomActionError, setRoomActionError] = useState<string | null>(null);
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
  const [isMemberManagerOpen, setIsMemberManagerOpen] = useState(false);
  const [closingModal, setClosingModal] = useState<ClosingModal>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomDescription, setNewRoomDescription] = useState("");
  const [newRoomAiPersonaPrompt, setNewRoomAiPersonaPrompt] = useState("");
  const [newRoomMemberIds, setNewRoomMemberIds] = useState<string[]>([user.uid]);
  const [activeRoomAiPersonaPrompt, setActiveRoomAiPersonaPrompt] = useState("");
  const [activeRoomMemberIds, setActiveRoomMemberIds] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalExitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingWriteRef = useRef(0);
  const [now, setNow] = useState(Date.now());
  const geminiModel = import.meta.env.VITE_GEMINI_MODEL || "gemini-2.5-flash-lite";

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [activeRoomId, rooms]
  );
  const isAdmin = profile?.role === "admin";
  const isCreateRoomVisible = isCreateRoomOpen || closingModal === "create-room";
  const isMemberManagerVisible = isMemberManagerOpen || closingModal === "members";
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
  const topLevelMessages = useMemo(
    () => messages.filter((message) => !message.parentMessageId),
    [messages]
  );
  const repliesByParentId = useMemo(() => {
    const replies = new Map<string, ChatMessage[]>();

    for (const message of messages) {
      if (!message.parentMessageId) {
        continue;
      }

      replies.set(message.parentMessageId, [...(replies.get(message.parentMessageId) ?? []), message]);
    }

    return replies;
  }, [messages]);
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
    setReplyingTo(null);
    setIsMemberManagerOpen(false);
  }, [activeRoomId]);

  useEffect(() => {
    if (!isMemberManagerOpen && !closingModal) {
      setActiveRoomMemberIds(activeRoom?.memberIds ?? []);
      setActiveRoomAiPersonaPrompt(activeRoom?.aiPersonaPrompt ?? "");
    }
  }, [activeRoom, isMemberManagerOpen, closingModal]);

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
          expiresAt: Timestamp.fromMillis(Date.now() + PRESENCE_EXPIRATION_MS)
        },
        { merge: true }
      );
    }

    // Firestore does not have a browser disconnect hook like Realtime Database.
    // A short heartbeat plus expiresAt gives us reliable-enough room presence for this assessment.
    void writePresence(true);
    const interval = window.setInterval(() => {
      void writePresence(true);
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

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

  useEffect(() => {
    if (!isMemberManagerOpen && !isCreateRoomOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isMemberManagerOpen) {
          closeMemberManager();
        }

        if (isCreateRoomOpen) {
          closeCreateRoomForm();
        }
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMemberManagerOpen, isCreateRoomOpen, activeRoom]);

  useEffect(() => {
    return () => {
      if (modalExitTimeoutRef.current) {
        clearTimeout(modalExitTimeoutRef.current);
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

  function insertGeminiMention() {
    const nextDraft = draft.trim().length > 0 ? `${draft.trimEnd()} @Gemini ` : "@Gemini ";
    handleDraftChange(nextDraft);
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
    if (closingModal || !isCreateRoomOpen) {
      return;
    }

    setClosingModal("create-room");
    setIsCreateRoomOpen(false);
    modalExitTimeoutRef.current = setTimeout(() => {
      setClosingModal(null);
      setRoomActionError(null);
      setNewRoomName("");
      setNewRoomDescription("");
      setNewRoomAiPersonaPrompt("");
      setNewRoomMemberIds([user.uid]);
    }, MODAL_EXIT_DURATION_MS);
  }

  function closeMemberManager() {
    if (closingModal || !isMemberManagerOpen) {
      return;
    }

    setClosingModal("members");
    setIsMemberManagerOpen(false);
    modalExitTimeoutRef.current = setTimeout(() => {
      setClosingModal(null);
      setRoomActionError(null);
      setActiveRoomAiPersonaPrompt(activeRoom?.aiPersonaPrompt ?? "");
      setActiveRoomMemberIds(activeRoom?.memberIds ?? []);
    }, MODAL_EXIT_DURATION_MS);
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profile || !isAdmin) {
      return;
    }

    const name = newRoomName.trim().replace(/^#/, "");
    const description = newRoomDescription.trim();
    const aiPersonaPrompt = newRoomAiPersonaPrompt.trim();
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
        aiPersonaPrompt,
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
      closeCreateRoomForm();
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

      batch.update(roomRef, {
        aiPersonaPrompt: activeRoomAiPersonaPrompt.trim(),
        memberIds
      });

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
      closeMemberManager();
    } catch (error) {
      setRoomActionError(error instanceof Error ? error.message : "Could not update room members.");
    }
  }

  async function requestAiResponse(orgId: string, roomId: string) {
    setAiPending(true);
    setAiError(null);
    const genericAiError = "Gemini is temporarily unavailable. Please retry in a moment.";

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
        const parsedBody = contentType.includes("application/json") ? parseJsonSafely(responseText) : null;
        const errorMessage = parsedBody?.error ?? genericAiError;

        throw new Error(errorMessage);
      }
    } catch (error) {
      setAiError(error instanceof Error && error.message ? error.message : genericAiError);
    } finally {
      setAiPending(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    if (!profile || !activeRoomId || !content) {
      return;
    }

    const parentMessage = replyingTo;

    setDraft("");
    setReplyingTo(null);
    lastTypingWriteRef.current = 0;

    await addDoc(collection(db, "organizations", profile.orgId, "rooms", activeRoomId, "messages"), {
      orgId: profile.orgId,
      roomId: activeRoomId,
      senderId: user.uid,
      senderName: profile.displayName,
      senderRole: profile.role,
      type: "user",
      content,
      ...(parentMessage
        ? {
            parentMessageId: parentMessage.parentMessageId ?? parentMessage.id,
            parentSenderName: parentMessage.senderName,
            parentMessagePreview: getMessagePreview(parentMessage.content)
          }
        : {}),
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
    if (/@(?:gemini|ai|ia)\b/i.test(content)) {
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
              {isAdmin ? (
                <button
                  className="mt-2 flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                  onClick={() => {
                    setRoomActionError(null);
                    setIsCreateRoomOpen(true);
                  }}
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
        <section className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              {activeRoom ? `# ${activeRoom.name}` : "No room selected"}
            </h1>
            <p className="text-sm text-slate-500">
              {activeRoom?.description || "No room description"}
            </p>
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
            <div
              aria-label={aiError ? "Gemini unavailable" : aiPending ? "Gemini is generating" : "Gemini available"}
              className={[
                "hidden h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium cursor-default select-none sm:flex",
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
        {isAdmin && isCreateRoomVisible ? (
          <div
            aria-labelledby="create-room-modal-title"
            aria-modal="true"
            className={[
              "modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-900/45 px-4 py-6 backdrop-blur-sm",
              closingModal === "create-room" ? "modal-overlay-out" : ""
            ].join(" ")}
            role="dialog"
          >
            <button
              aria-label="Close create room"
              className="absolute inset-0 cursor-default"
              onClick={closeCreateRoomForm}
              type="button"
            />
            <form
              className={[
                "modal-panel relative flex max-h-[min(680px,calc(100vh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20",
                closingModal === "create-room" ? "modal-panel-out" : ""
              ].join(" ")}
              onSubmit={createRoom}
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
                  onClick={closeCreateRoomForm}
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
                      onChange={(event) => setNewRoomName(event.target.value)}
                      placeholder="engineering"
                      value={newRoomName}
                    />
                  </label>
                  <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
                    Description
                    <input
                      className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                      onChange={(event) => setNewRoomDescription(event.target.value)}
                      placeholder="Optional context"
                      value={newRoomDescription}
                    />
                  </label>
                  <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
                    AI persona prompt
                    <textarea
                      className="min-h-24 w-full min-w-0 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal leading-6 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
                      maxLength={800}
                      onChange={(event) => setNewRoomAiPersonaPrompt(event.target.value)}
                      placeholder="Optional. Example: Act as a concise senior backend architect. Prefer tradeoffs, risks, and next steps."
                      value={newRoomAiPersonaPrompt}
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
                          checked={newRoomMemberIds.includes(orgUser.uid)}
                          className="size-4 shrink-0 rounded border-slate-300 text-cyan-600"
                          disabled={orgUser.uid === user.uid}
                          onChange={() => toggleNewRoomMember(orgUser.uid)}
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
                  onClick={closeCreateRoomForm}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 rounded-md bg-slate-800 px-4 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={!newRoomName.trim()}
                  type="submit"
                >
                  Create room
                </button>
              </div>
            </form>
          </div>
        ) : null}
        {isAdmin && activeRoom && isMemberManagerVisible ? (
          <div
            aria-labelledby="members-modal-title"
            aria-modal="true"
            className={[
              "modal-overlay fixed inset-0 z-50 grid place-items-center bg-slate-900/45 px-4 py-6 backdrop-blur-sm",
              closingModal === "members" ? "modal-overlay-out" : ""
            ].join(" ")}
            role="dialog"
          >
            <button
              aria-label="Close member manager"
              className="absolute inset-0 cursor-default"
              onClick={closeMemberManager}
              type="button"
            />
            <div
              className={[
                "modal-panel relative flex max-h-[min(680px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20",
                closingModal === "members" ? "modal-panel-out" : ""
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
                  onClick={closeMemberManager}
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
                    onChange={(event) => setActiveRoomAiPersonaPrompt(event.target.value)}
                    placeholder="Optional. Example: Act as a concise senior backend architect. Prefer tradeoffs, risks, and next steps."
                    value={activeRoomAiPersonaPrompt}
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
                        checked={activeRoomMemberIds.includes(orgUser.uid)}
                        className="size-4 shrink-0 rounded border-slate-300 text-cyan-600"
                        disabled={orgUser.uid === user.uid}
                        onChange={() => toggleActiveRoomMember(orgUser.uid)}
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
                  onClick={closeMemberManager}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 rounded-md bg-slate-800 px-4 text-sm font-medium text-white transition hover:bg-slate-700"
                  onClick={saveActiveRoomMembers}
                  type="button"
                >
                  Save changes
                </button>
              </div>
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
                <h2 className="text-lg font-semibold text-slate-900">No messages yet</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Start the room conversation. Mention @Gemini or @AI when the team needs an AI response.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {topLevelMessages.map((message) => {
                const senderRole =
                  message.senderRole ?? orgUsers.find((orgUser) => orgUser.uid === message.senderId)?.role;
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
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                        {message.type === "ai" ? "Gemini" : formatRoleLabel(senderRole)}
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
                      {message.content
                        ? renderMessageContent(message.content)
                        : message.status === "streaming"
                          ? "Gemini is reading the room..."
                          : ""}
                      {message.status === "streaming" ? (
                        <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-cyan-500 align-[-2px]" />
                      ) : null}
                    </p>
                    {replies.length > 0 ? (
                      <div className="mt-4 grid gap-3 border-l-2 border-cyan-100 pl-4">
                        {replies.map((reply) => {
                          const replySenderRole =
                            reply.senderRole ?? orgUsers.find((orgUser) => orgUser.uid === reply.senderId)?.role;

                          return (
                            <article className="relative rounded-lg border border-slate-200 bg-white/80 p-3 pb-12 shadow-sm" key={reply.id}>
                              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                                <strong className="text-slate-900">{reply.senderName}</strong>
                                <span className="text-xs text-slate-400">{formatMessageTime(reply.createdAt)}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                                  {reply.type === "ai" ? "Gemini" : formatRoleLabel(replySenderRole)}
                                </span>
                                <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-700">
                                  Thread reply
                                </span>

                              </div>
                              <p className="mb-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                                Replying to {reply.parentSenderName ?? message.senderName}: “{reply.parentMessagePreview ?? getMessagePreview(message.content)}”
                              </p>
                              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                {reply.content
                                  ? renderMessageContent(reply.content)
                                  : reply.status === "streaming"
                                    ? "Gemini is reading the thread..."
                                    : ""}
                                {reply.status === "streaming" ? (
                                  <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-cyan-500 align-[-2px]" />
                                ) : null}
                              </p>
                              {reply.status !== "streaming" && reply.status !== "error" ? (
                                <button
                                  aria-label={`Reply to ${reply.senderName}`}
                                  className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-cyan-700"
                                  onClick={() => setReplyingTo(reply)}
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
                        onClick={() => setReplyingTo(message)}
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
          )}
        </div>
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
              onClick={() => setReplyingTo(null)}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
        <form className="grid flex-none grid-cols-[1fr_auto_auto] gap-2 border-t border-slate-200 bg-white p-4" onSubmit={sendMessage}>
          <input
            className="h-11 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-4 focus:ring-cyan-100"
            onChange={(event) => handleDraftChange(event.target.value)}
            placeholder="Type a message or mention @Gemini..."
            value={draft}
          />
          <button
            aria-label="Insert Gemini mention"
            className="grid h-11 w-11 place-items-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
            onClick={insertGeminiMention}
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
        </section>
      </div>
    </main>
  );
}
