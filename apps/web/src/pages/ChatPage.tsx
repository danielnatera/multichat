import type { ChatMessage, OrgUser, Room } from "@multichat/shared";
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, where, writeBatch } from "firebase/firestore";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { db } from "../lib/firebase";
import { getMessagePreview } from "../lib/messageFormatting";
import { ChatHeader } from "../components/chat/ChatHeader";
import { ChatSidebar } from "../components/chat/ChatSidebar";
import { MessageComposer } from "../components/chat/MessageComposer";
import { MessageList } from "../components/chat/MessageList";
import { CreateRoomModal } from "../components/chat/CreateRoomModal";
import { MembersModal } from "../components/chat/MembersModal";

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

  function closeMemberManager({ resetDraft = true } = {}) {
    if (closingModal || !isMemberManagerOpen) {
      return;
    }

    setClosingModal("members");
    setIsMemberManagerOpen(false);
    modalExitTimeoutRef.current = setTimeout(() => {
      setClosingModal(null);
      setRoomActionError(null);
      if (resetDraft) {
        setActiveRoomAiPersonaPrompt(activeRoom?.aiPersonaPrompt ?? "");
        setActiveRoomMemberIds(activeRoom?.memberIds ?? []);
      }
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
      setRooms((currentRooms) =>
        currentRooms.map((room) =>
          room.id === activeRoom.id
            ? {
                ...room,
                aiPersonaPrompt: activeRoomAiPersonaPrompt.trim(),
                memberIds
              }
            : room
        )
      );
      closeMemberManager({ resetDraft: false });
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
        <ChatSidebar
          activeRoomId={activeRoomId}
          isAdmin={isAdmin}
          onCreateRoom={() => {
            setRoomActionError(null);
            setIsCreateRoomOpen(true);
          }}
          onSelectRoom={setActiveRoomId}
          onSignOut={onSignOut}
          profile={profile}
          rooms={rooms}
          unreadRoomIds={unreadRoomIds}
          visiblePresenceUsers={visiblePresenceUsers}
        />
        <section className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50">
        <ChatHeader
          activeRoom={activeRoom}
          aiError={aiError}
          aiPending={aiPending}
          geminiModel={geminiModel}
          isAdmin={isAdmin}
          isMemberManagerOpen={isMemberManagerOpen}
          onToggleMembers={() => {
            setRoomActionError(null);
            setIsMemberManagerOpen((current) => !current);
          }}
        />
        {isAdmin && isCreateRoomVisible ? (
          <CreateRoomModal
            currentUserId={user.uid}
            description={newRoomDescription}
            isClosing={closingModal === "create-room"}
            memberIds={newRoomMemberIds}
            name={newRoomName}
            onClose={closeCreateRoomForm}
            onDescriptionChange={setNewRoomDescription}
            onMemberToggle={toggleNewRoomMember}
            onNameChange={setNewRoomName}
            onPersonaPromptChange={setNewRoomAiPersonaPrompt}
            onSubmit={createRoom}
            personaPrompt={newRoomAiPersonaPrompt}
            roomActionError={roomActionError}
            sortedOrgUsers={sortedOrgUsers}
          />
        ) : null}
        {isAdmin && activeRoom && isMemberManagerVisible ? (
          <MembersModal
            activeRoom={activeRoom}
            currentUserId={user.uid}
            isClosing={closingModal === "members"}
            memberIds={activeRoomMemberIds}
            onClose={() => closeMemberManager()}
            onMemberToggle={toggleActiveRoomMember}
            onPersonaPromptChange={setActiveRoomAiPersonaPrompt}
            onSave={saveActiveRoomMembers}
            personaPrompt={activeRoomAiPersonaPrompt}
            roomActionError={roomActionError}
            sortedOrgUsers={sortedOrgUsers}
          />
        ) : null}
        <MessageList
          messagesEndRef={messagesEndRef}
          onReply={setReplyingTo}
          orgUsers={orgUsers}
          repliesByParentId={repliesByParentId}
          topLevelMessages={topLevelMessages}
        />
        <MessageComposer
          aiPending={aiPending}
          draft={draft}
          onCancelReply={() => setReplyingTo(null)}
          onDraftChange={handleDraftChange}
          onInsertGeminiMention={insertGeminiMention}
          onSubmit={sendMessage}
          replyingTo={replyingTo}
          typingLabel={typingLabel}
        />
        </section>
      </div>
    </main>
  );
}
