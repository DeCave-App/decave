// Realtime Hub events: Hub list and membership changes, online users, rooms deleted or made private.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { resolveDeletedChannel } from "../../voice/desktop-voice-reliability";
import type {
  Server,
  DiscoverServer,
  OnlineUser,
  SocialUser,
  AttachmentMeta,
  ChatMessage,
  VoiceJoinAttempt,
} from "../../app/types";
import type { HubEventsStore } from "../../features/events";
import type { RealtimeFrame } from "../connection";
import { applyFriendPresence } from "../presence";

export type HubEventContext = {
  setTypingUsers: Dispatch<SetStateAction<Record<string, number>>>;
  setSelectedServer: Dispatch<SetStateAction<number>>;
  setSelectedChannel: Dispatch<SetStateAction<number>>;
  setMessageInput: Dispatch<SetStateAction<string>>;
  messageDrafts: Record<number, string>;
  setMessageDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setOnlineUsers: Dispatch<SetStateAction<OnlineUser[]>>;
  setFriends: Dispatch<SetStateAction<SocialUser[]>>;
  setPendingAttachment: Dispatch<SetStateAction<AttachmentMeta | null>>;
  setAttachmentError: Dispatch<SetStateAction<string>>;
  setActiveForumPostId: Dispatch<SetStateAction<string | null>>;
  setForumPostComposerOpen: Dispatch<SetStateAction<boolean>>;
  setForumReplyInput: Dispatch<SetStateAction<string>>;
  setVoiceError: Dispatch<SetStateAction<string>>;
  setVoiceChatOpen: Dispatch<SetStateAction<boolean>>;
  voiceReconnectChannelRef: MutableRefObject<number | null>;
  voiceServerIdRef: MutableRefObject<number | null>;
  voiceJoinAttemptRef: MutableRefObject<VoiceJoinAttempt | null>;
  messageLoadGenerationRef: MutableRefObject<number>;
  activeServerRef: MutableRefObject<number>;
  serversRef: MutableRefObject<Server[]>;
  activeChannelRef: MutableRefObject<number>;
  voiceChannelRef: MutableRefObject<number | null>;
  loadServers: () => Promise<Server[] | null>;
  hubEvents: HubEventsStore;
  loadDiscoverServers: () => Promise<DiscoverServer[] | null>;
  loadMessages: (channelId: number) => Promise<void>;
  sendSocket: (payload: unknown) => boolean;
  cleanupVoiceLocal: (clearPresence: boolean, preserveMicrophone?: boolean, preserveRecoveryCounter?: boolean) => void;
  loadHubMembers: (serverId: number) => Promise<void>;
};

/** Returns true when the frame was handled. */
export function handleHubEvent(data: RealtimeFrame, context: HubEventContext): boolean {
  const {
    setTypingUsers,
    setSelectedServer,
    setSelectedChannel,
    setMessageInput,
    messageDrafts,
    setMessageDrafts,
    setMessages,
    setOnlineUsers,
    setFriends,
    setPendingAttachment,
    setAttachmentError,
    setActiveForumPostId,
    setForumPostComposerOpen,
    setForumReplyInput,
    setVoiceError,
    setVoiceChatOpen,
    voiceReconnectChannelRef,
    voiceServerIdRef,
    voiceJoinAttemptRef,
    messageLoadGenerationRef,
    activeServerRef,
    serversRef,
    activeChannelRef,
    voiceChannelRef,
    loadServers,
    hubEvents,
    loadDiscoverServers,
    loadMessages,
    sendSocket,
    cleanupVoiceLocal,
    loadHubMembers,
  } = context;

  if (data.type === "SERVERS_UPDATE" || data.type === "SERVERS_REFRESH") {
    // The REST server list is the authorization source of truth because it is
    // generated per signed-in user and includes private-room grants. Never
    // replace it with a shared realtime snapshot, which can briefly expose a
    // room and then make it disappear for an explicitly granted member.
    void loadServers();
    return true;
  }

  if (data.type === "USERS_UPDATE") {
    const users: OnlineUser[] = Array.isArray(data.users) ? data.users : [];
    setOnlineUsers(users);
    setFriends((current) => applyFriendPresence(current, users));
    if (activeServerRef.current > 0) void loadHubMembers(activeServerRef.current);
    return true;
  }

  if (data.type === "HUB_EVENTS_CHANGED") {
    const hubId = Number(data.serverId);
    if (Number.isSafeInteger(hubId) && hubId > 0) void hubEvents.refreshHub(hubId);
    return true;
  }

  if (data.type === "CHANNEL_JOINED") {
    const channelId = Number(data.channelId);
    activeChannelRef.current = channelId;
    setSelectedChannel(channelId);
    setMessages([]);
    void loadMessages(channelId);
    return true;
  }

  if (data.type === "SERVER_JOINED") {
    const serverId = Number(data.serverId);
    const channelId = Number(data.channelId);
    activeServerRef.current = serverId;
    activeChannelRef.current = channelId;
    setSelectedServer(serverId);
    setSelectedChannel(channelId);
    setMessages([]);
    void loadHubMembers(serverId);
    if (channelId > 0) void loadMessages(channelId);
    return true;
  }

  if (data.type === "SERVER_LEFT" || data.type === "SERVER_DELETED") {
    const fallbackServerId = Number(data.fallbackServerId) || 0;
    const fallbackChannelId = Number(data.fallbackChannelId) || 0;
    activeServerRef.current = fallbackServerId;
    activeChannelRef.current = fallbackChannelId;
    setSelectedServer(fallbackServerId);
    setSelectedChannel(fallbackChannelId);
    setMessages([]);
    void loadServers();
    void loadDiscoverServers();
    if (fallbackChannelId > 0) void loadMessages(fallbackChannelId);
    return true;
  }

  if (data.type === "CHANNEL_DELETED") {
    const deletedChannelId = Number(data.channelId);
    if (!Number.isSafeInteger(deletedChannelId) || deletedChannelId <= 0) return true;
    const fallbackChannelId = Number(data.fallbackChannelId);
    const channelServerId = Number(data.serverId);
    const knownServerId =
      Number.isSafeInteger(channelServerId) && channelServerId > 0
        ? channelServerId
        : (serversRef.current.find((server) => server.channels.some((channel) => channel.id === deletedChannelId))
            ?.id ?? activeServerRef.current);
    const pendingJoin = voiceJoinAttemptRef.current;
    const voiceAffected =
      voiceChannelRef.current === deletedChannelId ||
      voiceReconnectChannelRef.current === deletedChannelId ||
      pendingJoin?.channelId === deletedChannelId;
    if (voiceAffected) {
      if (voiceChannelRef.current === deletedChannelId) {
        sendSocket({
          type: "VOICE_LEAVE",
        });
      }
      voiceReconnectChannelRef.current = null;
      cleanupVoiceLocal(true);
      setVoiceError("This voice room was deleted. Choose another room to continue.");
    }

    const selectedDeleted = activeChannelRef.current === deletedChannelId;
    const deletionLoadGeneration = selectedDeleted
      ? ++messageLoadGenerationRef.current
      : messageLoadGenerationRef.current;
    void loadServers().then((loaded) => {
      if (!selectedDeleted) return;
      if (messageLoadGenerationRef.current !== deletionLoadGeneration) return;
      const refreshedServers = loaded ?? serversRef.current;
      const resolved = resolveDeletedChannel(refreshedServers, knownServerId, deletedChannelId, fallbackChannelId);
      if (!resolved) {
        activeServerRef.current = 0;
        activeChannelRef.current = 0;
        setSelectedServer(0);
        setSelectedChannel(0);
        setMessages([]);
        setMessageInput("");
        setPendingAttachment(null);
        setAttachmentError("");
        setActiveForumPostId(null);
        setForumPostComposerOpen(false);
        setForumReplyInput("");
        setVoiceChatOpen(false);
        setTypingUsers({});
        setMessageDrafts((current) => {
          const next = { ...current };
          delete next[deletedChannelId];
          return next;
        });
        return;
      }
      activeServerRef.current = resolved.server.id;
      activeChannelRef.current = resolved.channel.id;
      setSelectedServer(resolved.server.id);
      setSelectedChannel(resolved.channel.id);
      setMessages([]);
      setMessageInput(messageDrafts[resolved.channel.id] ?? "");
      setPendingAttachment(null);
      setAttachmentError("");
      setActiveForumPostId(null);
      setForumPostComposerOpen(false);
      setForumReplyInput("");
      setVoiceChatOpen(false);
      setTypingUsers({});
      setMessageDrafts((current) => {
        const next = { ...current };
        delete next[deletedChannelId];
        return next;
      });
      void loadMessages(resolved.channel.id);
    });
    return true;
  }

  if (data.type === "ACCESS_REVOKED") {
    const revokedServerId = Number(data.serverId);
    const voiceServerId = voiceServerIdRef.current;
    const reconnectVoiceChannel = voiceReconnectChannelRef.current;
    const voiceReferenceChannel = voiceChannelRef.current ?? reconnectVoiceChannel;
    const voiceReferenceServerId =
      voiceServerId ??
      (voiceReferenceChannel === null
        ? null
        : serversRef.current.find((server) => server.channels.some((channel) => channel.id === voiceReferenceChannel))
            ?.id) ??
      activeServerRef.current;
    const affectedVoice =
      voiceReferenceChannel !== null &&
      (!Number.isSafeInteger(revokedServerId) || voiceReferenceServerId === revokedServerId);
    const pendingJoin = voiceJoinAttemptRef.current;
    const pendingServerId = pendingJoin
      ? serversRef.current.find((server) => server.channels.some((channel) => channel.id === pendingJoin.channelId))?.id
      : null;
    const affectedPendingJoin =
      pendingJoin !== null && (!Number.isSafeInteger(revokedServerId) || pendingServerId === revokedServerId);
    if (affectedVoice || affectedPendingJoin) {
      if (voiceChannelRef.current !== null) {
        sendSocket({
          type: "VOICE_LEAVE",
        });
      }
      voiceReconnectChannelRef.current = null;
      cleanupVoiceLocal(true);
      setVoiceError(typeof data.message === "string" ? data.message : "Your access to this Hub was revoked.");
    }
    setMessages([]);
    void loadServers();
    return true;
  }

  return false;
}
