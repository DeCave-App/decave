// Realtime Hub room chat events: new, edited and deleted messages, typing and room activity.

import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import { effectiveNotifyLevel, notifyDecision, type NotifyLevels } from "../../features/settings/notifyLevels";
import {
  shouldInterruptQuietPresence,
  type QuietPresenceSettings as QuietPresenceModel,
} from "../../session/quiet-presence.ts";
import type { NotificationPreview } from "../../privacy/notification-preview";
import { resolveEcho, type OutboxItem } from "../../features/outbox/outbox";
import type { AccountUser, AttachmentMeta, ChatMessage, NotificationSettings, UiSoundEvent } from "../../app/types";
import type { RealtimeFrame } from "../connection";

export type ChatEventContext = {
  currentUser: AccountUser;
  quietPresence: QuietPresenceModel;
  notifyLevelsRef: MutableRefObject<NotifyLevels>;
  setTypingUsers: Dispatch<SetStateAction<Record<string, number>>>;
  setRoomUnread: Dispatch<SetStateAction<Record<number, number>>>;
  setRoomMentions: Dispatch<SetStateAction<Record<number, number>>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setOutbox: Dispatch<SetStateAction<OutboxItem<AttachmentMeta>[]>>;
  myUserIdRef: MutableRefObject<string | undefined>;
  activeServerRef: MutableRefObject<number>;
  activeChannelRef: MutableRefObject<number>;
  pendingForumPublishRef: MutableRefObject<{
    channelId: number;
    text: string;
    settle: (error: Error | null) => void;
  } | null>;
  roomChatVisibleRef: MutableRefObject<boolean>;
  notificationSettingsRef: MutableRefObject<NotificationSettings>;
  mutedHubIdsRef: MutableRefObject<Set<number>>;
  mutedUserIdsRef: MutableRefObject<Set<string>>;
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  notificationPreviewMode: () => NotificationPreview;
  notificationPreviewText: (
    sender: string,
    text: string,
    fallbackTitle?: string,
    context?: string,
  ) => { title: string; body: string };
  desktopNotify: (
    title: string,
    body: string,
    kind?: "friend" | "dm" | "voice",
    soundEvent?: UiSoundEvent | null,
    quietKind?: "dm" | "mention" | "other",
  ) => void;
  removeHomeCalendarMessage: (messageId: string) => void;
};

/** Returns true when the frame was handled. */
export function handleChatEvent(data: RealtimeFrame, context: ChatEventContext): boolean {
  const {
    currentUser,
    quietPresence,
    notifyLevelsRef,
    setTypingUsers,
    setRoomUnread,
    setRoomMentions,
    setMessages,
    setOutbox,
    myUserIdRef,
    activeServerRef,
    activeChannelRef,
    pendingForumPublishRef,
    roomChatVisibleRef,
    notificationSettingsRef,
    mutedHubIdsRef,
    mutedUserIdsRef,
    playUiSound,
    notificationPreviewMode,
    notificationPreviewText,
    desktopNotify,
    removeHomeCalendarMessage,
  } = context;

  if (data.type === "CHAT_MESSAGE") {
    const channelId = Number(data.channelId);
    // Our own message came back: it's delivered, drop it from the outbox.
    if (typeof data.userId === "string" && data.userId === myUserIdRef.current && typeof data.text === "string") {
      const echoed = data.text;
      setOutbox((current) => resolveEcho(current, channelId, echoed));
    }
    const pendingPublish = pendingForumPublishRef.current;
    if (pendingPublish && pendingPublish.channelId === channelId && data.text === pendingPublish.text)
      pendingPublish.settle(null);
    if (channelId !== activeChannelRef.current) return true;

    const incoming: ChatMessage = {
      id: typeof data.id === "string" ? data.id : crypto.randomUUID(),
      userId: typeof data.userId === "string" ? data.userId : undefined,
      username: typeof data.username === "string" ? data.username : "Unknown",
      avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
      avatarUpdatedAt: typeof data.avatarUpdatedAt === "string" ? data.avatarUpdatedAt : null,
      text: typeof data.text === "string" ? data.text : "",
      timestamp: typeof data.timestamp === "string" ? data.timestamp : new Date().toISOString(),
      channelId,
      role: data.role === "owner" || data.role === "admin" || data.role === "member" ? data.role : null,
      replyToId: typeof data.replyToId === "string" ? data.replyToId : null,
      attachment: data.attachment && typeof data.attachment === "object" ? (data.attachment as AttachmentMeta) : null,
    };

    if (
      incoming.userId &&
      incoming.userId !== currentUser?.id &&
      Date.now() - new Date(incoming.timestamp).getTime() < 5000 &&
      !mutedUserIdsRef.current.has(incoming.userId) &&
      !mutedHubIdsRef.current.has(activeServerRef.current) &&
      // Settings → Notifications → Hubs and rooms: "Nothing" silences the room you're in too.
      effectiveNotifyLevel(notifyLevelsRef.current, activeServerRef.current, channelId) !== "nothing"
    ) {
      const lowerText = incoming.text.toLowerCase();
      const me = currentUser?.username.toLowerCase() ?? "";
      const isMention = Boolean(me) && (lowerText.includes(`@${me}`) || lowerText.includes("@everyone"));
      playUiSound(isMention ? "mention" : "receive");
      if (
        notificationSettingsRef.current.mentions &&
        isMention &&
        shouldInterruptQuietPresence(quietPresence, "urgent-mention")
      ) {
        const preview = notificationPreviewText(incoming.username, incoming.text, "DeCave", "Mention");
        desktopNotify(preview.title, preview.body, "dm", null, "mention");
      }
    }

    setMessages((current) => (current.some((item) => item.id === incoming.id) ? current : [...current, incoming]));
    // A voice room remains the active realtime channel while its chat is
    // hidden. Count the primary message event here so the Chat control
    // updates even if the account-level ROOM_ACTIVITY event is delayed.
    if (incoming.userId !== currentUser?.id && !roomChatVisibleRef.current) {
      setRoomUnread((current) => ({
        ...current,
        [channelId]: Math.min(999, (current[channelId] ?? 0) + 1),
      }));
    }
    return true;
  }

  if (data.type === "TYPING") {
    const channelId = Number(data.channelId);
    const userId = typeof data.userId === "string" ? data.userId : "";
    const username = typeof data.username === "string" ? data.username : "";
    if (!userId || userId === currentUser?.id || channelId !== activeChannelRef.current) return true;
    const key = `${userId}:${username}`;
    if (data.active === true) setTypingUsers((current) => ({ ...current, [key]: Date.now() + 2200 }));
    else
      setTypingUsers((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    return true;
  }

  if (data.type === "ROOM_ACTIVITY") {
    const channelId = Number(data.channelId);
    const serverId = Number(data.serverId);
    if (!channelId || data.userId === currentUser?.id) return true;

    const mentioned = data.mentioned === true;
    const isCurrentServer = serverId === activeServerRef.current;
    const isCurrentRoom = isCurrentServer && channelId === activeChannelRef.current;
    const viewingRoom = isCurrentRoom && roomChatVisibleRef.current;

    // Room IDs are globally unique, so unread state can follow every Hub
    // the account can access. This powers both room badges and the Hub
    // badges in the top navigation.
    // The primary CHAT_MESSAGE event owns unread counting for the active
    // room (including a voice room with hidden chat). ROOM_ACTIVITY owns
    // counts for rooms that are not currently selected.
    if (!isCurrentRoom) {
      setRoomUnread((current) => ({ ...current, [channelId]: (current[channelId] ?? 0) + 1 }));
      if (mentioned) {
        setRoomMentions((current) => ({ ...current, [channelId]: (current[channelId] ?? 0) + 1 }));
      }
    } else if (!viewingRoom && mentioned) {
      setRoomMentions((current) => ({ ...current, [channelId]: (current[channelId] ?? 0) + 1 }));
    }

    const level = effectiveNotifyLevel(notifyLevelsRef.current, serverId, channelId);
    const decision = notifyDecision(level, mentioned);
    if (
      decision.notify &&
      !viewingRoom &&
      (mentioned
        ? notificationSettingsRef.current.mentions && shouldInterruptQuietPresence(quietPresence, "urgent-mention")
        : shouldInterruptQuietPresence(quietPresence, "recommendation")) &&
      !mutedHubIdsRef.current.has(serverId) &&
      !(typeof data.userId === "string" && mutedUserIdsRef.current.has(data.userId))
    ) {
      const senderName = String(data.username || "DeCave user");
      const channelName = String(data.channelName || "room");
      const text = String(data.text || "");
      const mode = notificationPreviewMode();
      const preview = mentioned
        ? mode === "hidden"
          ? { title: "DeCave", body: "You were mentioned in a Hub." }
          : mode === "sender"
            ? { title: senderName, body: `Mentioned you in #${channelName}.` }
            : { title: senderName, body: text.slice(0, 120) || `Mentioned you in #${channelName}.` }
        : mode === "hidden"
          ? { title: "DeCave", body: "New message in a Hub." }
          : mode === "sender"
            ? { title: `#${channelName}`, body: `${senderName} sent a message.` }
            : { title: `#${channelName}`, body: `${senderName}: ${text.slice(0, 120)}` };
      desktopNotify(
        preview.title,
        preview.body,
        "dm",
        mentioned ? undefined : "receive",
        mentioned ? "mention" : "other",
      );
    }
    return true;
  }

  if (data.type === "MESSAGE_UPDATED" && data.message && typeof data.message === "object") {
    const updated = data.message as ChatMessage;
    setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    return true;
  }

  if (data.type === "MESSAGE_DELETED") {
    const channelId = Number(data.channelId);
    const messageId = typeof data.messageId === "string" ? data.messageId : "";
    if (messageId) removeHomeCalendarMessage(messageId);
    if (!messageId || channelId !== activeChannelRef.current) return true;
    setMessages((current) => current.filter((item) => item.id !== messageId));
    return true;
  }

  return false;
}
