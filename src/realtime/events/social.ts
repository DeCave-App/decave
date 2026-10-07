// Realtime social events: friends, direct messages, group chats and profile changes.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { NotificationPreview } from "../../privacy/notification-preview";
import type {
  AccountUser,
  OnlineUser,
  ChatMessage,
  ServerMemberView,
  VoiceParticipant,
  SocialUser,
  DirectMessage,
  GroupChatMessage,
  GroupChat,
  DmNotice,
  NotificationSettings,
  UiSoundEvent,
} from "../../app/types";
import type { RealtimeFrame } from "../connection";

export type SocialEventContext = {
  currentUser: AccountUser;
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setOnlineUsers: Dispatch<SetStateAction<OnlineUser[]>>;
  setHubMembers: Dispatch<SetStateAction<ServerMemberView[]>>;
  setFriends: Dispatch<SetStateAction<SocialUser[]>>;
  setIncomingFriendRequests: Dispatch<SetStateAction<SocialUser[]>>;
  setOutgoingFriendRequests: Dispatch<SetStateAction<SocialUser[]>>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  groupChats: GroupChat[];
  setActiveGroupChat: Dispatch<SetStateAction<GroupChat | null>>;
  setGroupMessages: Dispatch<SetStateAction<GroupChatMessage[]>>;
  setGroupError: Dispatch<SetStateAction<string>>;
  setShowGroupMembers: Dispatch<SetStateAction<boolean>>;
  setDmMessages: Dispatch<SetStateAction<DirectMessage[]>>;
  setDmError: Dispatch<SetStateAction<string>>;
  setDmUnread: Dispatch<SetStateAction<Record<string, number>>>;
  setDmNotice: Dispatch<SetStateAction<DmNotice | null>>;
  setVoiceParticipants: Dispatch<SetStateAction<VoiceParticipant[]>>;
  notificationSettingsRef: MutableRefObject<NotificationSettings>;
  friendsRef: MutableRefObject<SocialUser[]>;
  mutedUserIdsRef: MutableRefObject<Set<string>>;
  activeDmUserRef: MutableRefObject<SocialUser | null>;
  activeGroupChatRef: MutableRefObject<GroupChat | null>;
  dmNoticeTimerRef: MutableRefObject<number | null>;
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
  applySocialState: (data: { friends?: SocialUser[]; incoming?: SocialUser[]; outgoing?: SocialUser[] }) => void;
  loadSocialState: () => Promise<void>;
  loadDmConversations: () => Promise<void>;
  loadGroupChats: () => Promise<void>;
  openGroupChat: (group: GroupChat) => Promise<void>;
  sendSocket: (payload: unknown) => boolean;
  /** DM encryption (src/e2ee/dm-e2ee-client.ts), passed in so this module stays free of browser globals. */
  e2ee?: {
    handleEvent: (data: RealtimeFrame) => boolean;
    open: (message: DirectMessage) => Promise<DirectMessage>;
    retryFrame: (error: RealtimeFrame) => Promise<Record<string, unknown> | null>;
    settle: (messageId: string, peerId: string) => void;
    openGroup: (message: GroupChatMessage, groupId: string) => Promise<GroupChatMessage>;
    retryGroupFrame: (error: RealtimeFrame) => Promise<Record<string, unknown> | null>;
    settleGroup: (messageId: string, groupId: string) => void;
  };
};

/** Returns true when the frame was handled. */
export function handleSocialEvent(data: RealtimeFrame, context: SocialEventContext): boolean {
  const {
    currentUser,
    setCurrentUser,
    setMessages,
    setOnlineUsers,
    setHubMembers,
    setFriends,
    setIncomingFriendRequests,
    setOutgoingFriendRequests,
    setActiveDmUser,
    groupChats,
    setActiveGroupChat,
    setGroupMessages,
    setGroupError,
    setShowGroupMembers,
    setDmMessages,
    setDmError,
    setDmUnread,
    setDmNotice,
    setVoiceParticipants,
    notificationSettingsRef,
    friendsRef,
    mutedUserIdsRef,
    activeDmUserRef,
    activeGroupChatRef,
    dmNoticeTimerRef,
    notificationPreviewMode,
    notificationPreviewText,
    desktopNotify,
    applySocialState,
    loadSocialState,
    loadDmConversations,
    loadGroupChats,
    openGroupChat,
    sendSocket,
    e2ee,
  } = context;

  if (e2ee?.handleEvent(data)) return true;

  /** Run `handle` with the message's readable text: at once for plaintext, after decrypting otherwise. */
  const withText = (raw: DirectMessage, handle: (message: DirectMessage) => void) => {
    if (!raw.envelope || !e2ee) {
      handle({ ...raw, e2ee: raw.envelope ? "locked" : "plaintext" });
      return;
    }
    void e2ee.open(raw).then(handle);
  };

  if (data.type === "SOCIAL_REFRESH") {
    void loadSocialState();
    return true;
  }

  if (data.type === "SOCIAL_STATE") {
    applySocialState({
      friends: Array.isArray(data.friends) ? (data.friends as SocialUser[]) : [],
      incoming: Array.isArray(data.incoming) ? (data.incoming as SocialUser[]) : [],
      outgoing: Array.isArray(data.outgoing) ? (data.outgoing as SocialUser[]) : [],
    });
    return true;
  }

  if (data.type === "DM_MESSAGE" && data.message && typeof data.message === "object") {
    // Decrypt first; the rest runs once the text is known.
    withText(data.message as DirectMessage, handleDirectMessage);
    return true;
  }

  function handleDirectMessage(message: DirectMessage) {
    const partnerId = message.fromUserId === currentUser?.id ? message.toUserId : message.fromUserId;
    const isIncoming = message.fromUserId !== currentUser?.id;
    if (!isIncoming) e2ee?.settle(message.id, partnerId);

    void loadDmConversations();

    if (activeDmUserRef.current?.id === partnerId) {
      setDmMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
    } else if (isIncoming) {
      setDmUnread((current) => ({
        ...current,
        [partnerId]: (current[partnerId] ?? 0) + 1,
      }));
    }

    // Incoming DMs always produce the DeCave in-app notification and
    // notification sound, even when that DM conversation is already open.
    // This makes testing predictable and prevents an active DM panel from
    // silently swallowing alerts.
    if (isIncoming && notificationSettingsRef.current.dms && !mutedUserIdsRef.current.has(partnerId)) {
      const realtimeSender =
        data.sender && typeof data.sender === "object"
          ? (data.sender as { id?: unknown; username?: unknown; avatarUrl?: unknown })
          : null;
      const sender = friendsRef.current.find((friend) => friend.id === partnerId);
      const username =
        typeof realtimeSender?.username === "string" && realtimeSender.username
          ? realtimeSender.username
          : (sender?.username ?? "DeCave user");
      const avatarUrl = typeof realtimeSender?.avatarUrl === "string" ? realtimeSender.avatarUrl : sender?.avatarUrl;
      // A device that can't decrypt yet still says a message arrived.
      const readable = message.e2ee === "locked" || message.e2ee === "failed" ? "🔒 Encrypted message" : message.text;
      const preview = notificationPreviewText(username, readable, "DeCave");

      const previewMode = notificationPreviewMode();
      const hiddenPreview = previewMode === "hidden";
      setDmNotice({
        userId: partnerId,
        username: hiddenPreview ? "DeCave" : username,
        avatarUrl: hiddenPreview ? undefined : avatarUrl,
        text: previewMode === "full" ? readable : preview.body,
      });

      if (dmNoticeTimerRef.current !== null) {
        window.clearTimeout(dmNoticeTimerRef.current);
      }
      dmNoticeTimerRef.current = window.setTimeout(() => {
        setDmNotice(null);
        dmNoticeTimerRef.current = null;
      }, 6500);

      desktopNotify(preview.title, preview.body, "dm");
    }
  }

  if (data.type === "DM_EDITED" && data.message && typeof data.message === "object") {
    withText(data.message as DirectMessage, (message) => {
      setDmMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
      void loadDmConversations();
    });
    return true;
  }

  if (data.type === "DM_DELETED" && typeof data.messageId === "string") {
    setDmMessages((current) => current.filter((item) => item.id !== data.messageId));
    void loadDmConversations();
    return true;
  }

  if (data.type === "DM_REACTION_UPDATED" && data.message && typeof data.message === "object") {
    withText(data.message as DirectMessage, (message) => {
      setDmMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
    });
    return true;
  }

  if (data.type === "DM_ERROR") {
    const fallback = typeof data.message === "string" ? data.message : "Private message failed.";
    // A stale key is fixed by sealing again with fresh keys, once.
    if (!e2ee) {
      setDmError(fallback);
      return true;
    }
    void e2ee
      .retryFrame(data)
      .then((frame) => {
        if (!frame || !sendSocket(frame)) setDmError(fallback);
      })
      .catch((error: unknown) => setDmError(error instanceof Error ? error.message : fallback));
    return true;
  }

  if (data.type === "GROUP_MESSAGE" && data.message && typeof data.message === "object") {
    const raw = data.message as GroupChatMessage;
    const groupId = typeof data.groupId === "string" ? data.groupId : raw.groupId;
    // Decrypt first; the rest runs once the text is known.
    if (!raw.envelope || !e2ee) handleGroupMessage({ ...raw, e2ee: raw.envelope ? "locked" : "plaintext" }, groupId);
    else void e2ee.openGroup(raw, groupId).then((message) => handleGroupMessage(message, groupId));
    return true;
  }

  function handleGroupMessage(message: GroupChatMessage, groupId: string) {
    if (message.fromUserId === currentUser?.id) e2ee?.settleGroup(message.id, groupId);
    void loadGroupChats();

    if (activeGroupChatRef.current?.id === groupId) {
      setGroupMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
    }

    if (
      message.fromUserId !== currentUser?.id &&
      notificationSettingsRef.current.groups &&
      !mutedUserIdsRef.current.has(message.fromUserId)
    ) {
      const group = groupChats.find((item) => item.id === groupId);
      const context = group?.name || "Group chat";
      const readable = message.e2ee === "locked" || message.e2ee === "failed" ? "🔒 Encrypted message" : message.text;
      const preview = notificationPreviewText(message.username || "DeCave user", readable, "DeCave", context);
      desktopNotify(preview.title, preview.body, "dm", undefined, "other");
    }
  }

  if (data.type === "GROUP_CHAT_UPDATED" && typeof data.groupId === "string") {
    const groupId = data.groupId;
    void loadGroupChats();
    const active = activeGroupChatRef.current;
    if (active && active.id === groupId) void openGroupChat(active);
    return true;
  }

  if (data.type === "GROUP_CHAT_REMOVED" && typeof data.groupId === "string") {
    const groupId = data.groupId;
    void loadGroupChats();
    const active = activeGroupChatRef.current;
    if (active && active.id === groupId) {
      if (data.userId === currentUser?.id || data.deleted === true) {
        setActiveGroupChat(null);
        activeGroupChatRef.current = null;
        setGroupMessages([]);
        setShowGroupMembers(false);
      } else {
        void openGroupChat(active);
      }
    }
    return true;
  }

  if (data.type === "GROUP_ERROR") {
    const fallback = typeof data.message === "string" ? data.message : "Group message failed.";
    // Keys or members changed since the message was sealed: seal again, once.
    if (!e2ee) {
      setGroupError(fallback);
      return true;
    }
    void e2ee
      .retryGroupFrame(data)
      .then((frame) => {
        if (!frame || !sendSocket(frame)) setGroupError(fallback);
      })
      .catch((error: unknown) => setGroupError(error instanceof Error ? error.message : fallback));
    return true;
  }

  if (data.type === "PROFILE_UPDATED") {
    if (!data.user || typeof data.user !== "object") return true;
    const user = data.user as AccountUser;
    if (user.id === currentUser?.id) setCurrentUser((current) => (current ? { ...current, ...user } : current));
    setOnlineUsers((current) =>
      current.map((item) =>
        item.userId === user.id
          ? {
              ...item,
              avatarUrl: user.avatarUrl,
              avatarUpdatedAt: user.avatarUpdatedAt,
              status: user.status,
              statusText: user.statusText,
              activityText: user.activityText,
              bio: user.bio,
              accent: user.accent,
            }
          : item,
      ),
    );
    setHubMembers((current) =>
      current.map((item) =>
        item.userId === user.id
          ? {
              ...item,
              avatarUrl: user.avatarUrl,
              status: user.status,
              statusText: user.status === "invisible" ? "" : user.statusText,
              activityText: user.status === "invisible" ? "" : user.activityText,
              online: user.status !== "invisible",
            }
          : item,
      ),
    );
    setVoiceParticipants((current) =>
      current.map((item) =>
        item.userId === user.id
          ? {
              ...item,
              avatarUrl: user.avatarUrl,
              avatarUpdatedAt: user.avatarUpdatedAt,
            }
          : item,
      ),
    );
    setMessages((current) =>
      current.map((item) =>
        item.userId === user.id
          ? {
              ...item,
              avatarUrl: user.avatarUrl,
              avatarUpdatedAt: user.avatarUpdatedAt,
            }
          : item,
      ),
    );
    const refreshSocialAvatar = (item: SocialUser) => (item.id === user.id ? { ...item, ...user } : item);
    setFriends((current) => current.map(refreshSocialAvatar));
    setIncomingFriendRequests((current) => current.map(refreshSocialAvatar));
    setOutgoingFriendRequests((current) => current.map(refreshSocialAvatar));
    setActiveDmUser((current) =>
      current?.id === user.id
        ? { ...current, avatarUrl: user.avatarUrl, avatarUpdatedAt: user.avatarUpdatedAt }
        : current,
    );
    return true;
  }

  return false;
}
