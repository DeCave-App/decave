// Keeps the realtime socket's handlers pointed at the latest committed render:
// hub, social, chat, voice and session events, plus identify, close and auth errors.

import { type Dispatch, type SetStateAction, type MutableRefObject, useLayoutEffect } from "react";
import type { QuietPresenceSettings as QuietPresenceModel } from "../../session/quiet-presence.ts";
import type { OutboxItem } from "../../features/outbox/outbox";
import type {
  Server,
  DiscoverServer,
  AccountUser,
  OnlineUser,
  AttachmentMeta,
  ChatMessage,
  ServerMemberView,
  VoiceParticipant,
  SocialUser,
  DirectMessage,
  GroupChatMessage,
  GroupChat,
  DmNotice,
  PeerSession,
  AudioSettings,
  SinkableAudioElement,
  NotificationSettings,
  UiSoundEvent,
  VoiceJoinAttempt,
} from "../types";
import type { RealtimeAppHandlers } from "../../realtime/events";
import type { VoiceCallState } from "../state/voice-call";
import type { CallMediaState } from "../state/call-media";
import type { ComposerState } from "../state/composer";
import type { ForumRoomUiState } from "../state/forum-room-ui";
import type { HubEventsStore } from "../../features/events";
import type { FriendActions } from "../actions/friends";
import type { DirectMessageActions } from "../actions/direct-messages";
import type { VoiceControlActions } from "../actions/voice-controls";
import type { NotifyLevels } from "../../features/settings/notifyLevels";
import type { NotificationPreview } from "../../privacy/notification-preview";
import {
  dmE2ee,
  retryFrameAfterDmError,
  retryGroupFrameAfterError,
  settleDmSend,
  settleGroupSend,
} from "../../e2ee/dm-e2ee-client";

export type RealtimeAppHandlersDeps = {
  currentUser: AccountUser | null;
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setAuthError: Dispatch<SetStateAction<string>>;
  voiceCall: VoiceCallState;
  callMedia: CallMediaState;
  quietPresence: QuietPresenceModel;
  notifyLevelsRef: MutableRefObject<NotifyLevels>;
  setTypingUsers: Dispatch<SetStateAction<Record<string, number>>>;
  setRoomUnread: Dispatch<SetStateAction<Record<number, number>>>;
  setRoomMentions: Dispatch<SetStateAction<Record<number, number>>>;
  composer: ComposerState;
  setSelectedServer: Dispatch<SetStateAction<number>>;
  setSelectedChannel: Dispatch<SetStateAction<number>>;
  messageDrafts: Record<number, string>;
  setMessageDrafts: Dispatch<SetStateAction<Record<number, string>>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setOnlineUsers: Dispatch<SetStateAction<OnlineUser[]>>;
  setHubMembers: Dispatch<SetStateAction<ServerMemberView[]>>;
  setConnectionStatus: Dispatch<SetStateAction<string>>;
  setOutbox: Dispatch<SetStateAction<OutboxItem<AttachmentMeta>[]>>;
  outboxRef: MutableRefObject<OutboxItem<AttachmentMeta>[]>;
  myUserIdRef: MutableRefObject<string | undefined>;
  forumRoomUi: ForumRoomUiState;
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
  setVoiceChannelId: Dispatch<SetStateAction<number | null>>;
  realtimeReconnectEnabledRef: MutableRefObject<boolean>;
  voiceReconnectChannelRef: MutableRefObject<number | null>;
  voiceServerIdRef: MutableRefObject<number | null>;
  voiceJoinAttemptRef: MutableRefObject<VoiceJoinAttempt | null>;
  voiceJoinStartedAtRef: MutableRefObject<number | null>;
  messageLoadGenerationRef: MutableRefObject<number>;
  activeServerRef: MutableRefObject<number>;
  serversRef: MutableRefObject<Server[]>;
  activeChannelRef: MutableRefObject<number>;
  pendingForumPublishRef: MutableRefObject<{
    channelId: number;
    text: string;
    settle: (error: Error | null) => void;
  } | null>;
  roomChatVisibleRef: MutableRefObject<boolean>;
  selfConnectionIdRef: MutableRefObject<string>;
  voiceChannelRef: MutableRefObject<number | null>;
  notificationSettingsRef: MutableRefObject<NotificationSettings>;
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
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  friendsRef: MutableRefObject<SocialUser[]>;
  mutedHubIdsRef: MutableRefObject<Set<number>>;
  mutedUserIdsRef: MutableRefObject<Set<string>>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  isServerMutedRef: MutableRefObject<boolean>;
  isServerDeafenedRef: MutableRefObject<boolean>;
  activeDmUserRef: MutableRefObject<SocialUser | null>;
  activeGroupChatRef: MutableRefObject<GroupChat | null>;
  peerSessionsRef: MutableRefObject<Map<string, PeerSession>>;
  dmNoticeTimerRef: MutableRefObject<number | null>;
  storeToken: (token: string) => void;
  loadServers: () => Promise<Server[] | null>;
  removeHomeCalendarMessage: (messageId: string) => void;
  hubEvents: HubEventsStore;
  loadDiscoverServers: () => Promise<DiscoverServer[] | null>;
  loadMessages: (channelId: number) => Promise<void>;
  friendActions: FriendActions;
  sendSocket: (payload: unknown) => boolean;
  directMessages: DirectMessageActions;
  cleanupVoiceLocal: (clearPresence: boolean, preserveMicrophone?: boolean, preserveRecoveryCounter?: boolean) => void;
  applyMicrophoneEnabledState: () => boolean;
  setAudioSink: (element: SinkableAudioElement, outputDeviceId: string) => Promise<boolean>;
  upsertVoiceParticipant: (participant: VoiceParticipant) => void;
  closePeer: (connectionId: string) => void;
  ensurePeer: (participant: VoiceParticipant) => PeerSession;
  ensureVoicePeersFromState: (participants: VoiceParticipant[]) => void;
  handleRtcDescription: (
    participant: VoiceParticipant,
    description: RTCSessionDescriptionInit,
    auth?: unknown,
  ) => Promise<void>;
  handleRtcCandidate: (participant: VoiceParticipant, candidate: RTCIceCandidateInit) => Promise<void>;
  finishVoiceJoinAttempt: (channelId: number) => void;
  acceptsVoiceJoinAcknowledgement: (channelId: number) => boolean;
  rejoinVoiceAfterRealtimeReconnect: (channelId: number, socket: WebSocket) => Promise<void>;
  cancelVoiceJoinAttempt: (message?: string, _preserveRecoveryCounter?: boolean) => void;
  logout: (options?: { signedOutElsewhere?: boolean }) => Promise<void>;
  voiceControls: VoiceControlActions;
  realtimeAppRef: MutableRefObject<RealtimeAppHandlers | null>;
  loadHubMembers: (serverId: number) => Promise<void>;
};

export function useRealtimeAppHandlers(deps: RealtimeAppHandlersDeps): void {
  const {
    currentUser,
    setCurrentUser,
    setAuthError,
    voiceCall,
    callMedia,
    quietPresence,
    notifyLevelsRef,
    setTypingUsers,
    setRoomUnread,
    setRoomMentions,
    composer,
    setSelectedServer,
    setSelectedChannel,
    messageDrafts,
    setMessageDrafts,
    setMessages,
    setOnlineUsers,
    setHubMembers,
    setConnectionStatus,
    setOutbox,
    outboxRef,
    myUserIdRef,
    forumRoomUi,
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
    setVoiceChannelId,
    realtimeReconnectEnabledRef,
    voiceReconnectChannelRef,
    voiceServerIdRef,
    voiceJoinAttemptRef,
    voiceJoinStartedAtRef,
    messageLoadGenerationRef,
    activeServerRef,
    serversRef,
    activeChannelRef,
    pendingForumPublishRef,
    roomChatVisibleRef,
    selfConnectionIdRef,
    voiceChannelRef,
    notificationSettingsRef,
    notificationPreviewMode,
    notificationPreviewText,
    desktopNotify,
    playUiSound,
    friendsRef,
    mutedHubIdsRef,
    mutedUserIdsRef,
    audioSettingsRef,
    isServerMutedRef,
    isServerDeafenedRef,
    activeDmUserRef,
    activeGroupChatRef,
    peerSessionsRef,
    dmNoticeTimerRef,
    storeToken,
    loadServers,
    removeHomeCalendarMessage,
    hubEvents,
    loadDiscoverServers,
    loadMessages,
    friendActions,
    sendSocket,
    directMessages,
    cleanupVoiceLocal,
    applyMicrophoneEnabledState,
    setAudioSink,
    upsertVoiceParticipant,
    closePeer,
    ensurePeer,
    ensureVoicePeersFromState,
    handleRtcDescription,
    handleRtcCandidate,
    finishVoiceJoinAttempt,
    acceptsVoiceJoinAcknowledgement,
    rejoinVoiceAfterRealtimeReconnect,
    cancelVoiceJoinAttempt,
    logout,
    voiceControls,
    realtimeAppRef,
    loadHubMembers,
  } = deps;

  useLayoutEffect(() => {
    if (!currentUser) return;
    realtimeAppRef.current = {
      events: {
        hub: {
          setTypingUsers,
          setSelectedServer,
          setSelectedChannel,
          setMessageInput: composer.setMessageInput,
          messageDrafts,
          setMessageDrafts,
          setMessages,
          setOnlineUsers,
          setFriends,
          setPendingAttachment: composer.setPendingAttachment,
          setAttachmentError: composer.setAttachmentError,
          setActiveForumPostId: forumRoomUi.setActiveForumPostId,
          setForumPostComposerOpen: forumRoomUi.setForumPostComposerOpen,
          setForumReplyInput: forumRoomUi.setForumReplyInput,
          setVoiceError: voiceCall.setVoiceError,
          setVoiceChatOpen: voiceCall.setVoiceChatOpen,
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
        },
        social: {
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
          applySocialState: friendActions.applySocialState,
          loadSocialState: friendActions.loadSocialState,
          loadDmConversations: directMessages.loadDmConversations,
          loadGroupChats: directMessages.loadGroupChats,
          openGroupChat: directMessages.openGroupChat,
          sendSocket,
          e2ee: {
            handleEvent: (frame) => dmE2ee.handleRealtimeEvent(frame),
            open: (message) => dmE2ee.open(message),
            retryFrame: retryFrameAfterDmError,
            settle: settleDmSend,
            openGroup: (message, groupId) => dmE2ee.openGroup(message, groupId),
            retryGroupFrame: (error) =>
              retryGroupFrameAfterError(error, (groupId) =>
                activeGroupChatRef.current?.id === groupId
                  ? activeGroupChatRef.current
                  : (groupChats.find((group) => group.id === groupId) ?? null),
              ),
            settleGroup: settleGroupSend,
          },
        },
        chat: {
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
        },
        voice: {
          setSoundboardNotice: voiceCall.setSoundboardNotice,
          quietPresence,
          setVoiceParticipants,
          setVoiceChannelId,
          setVoiceStatus: voiceCall.setVoiceStatus,
          setVoiceError: voiceCall.setVoiceError,
          setIsServerMuted: voiceCall.setIsServerMuted,
          setIsServerDeafened: voiceCall.setIsServerDeafened,
          setRemoteScreens: callMedia.setRemoteScreens,
          setRemoteCameras: callMedia.setRemoteCameras,
          voiceReconnectChannelRef,
          voiceServerIdRef,
          voiceJoinAttemptRef,
          voiceJoinStartedAtRef,
          activeServerRef,
          serversRef,
          voiceChannelRef,
          notificationSettingsRef,
          audioSettingsRef,
          isServerMutedRef,
          isServerDeafenedRef,
          peerSessionsRef,
          applyMicrophoneEnabledState,
          playUiSound,
          sendSocket,
          setAudioSink,
          upsertVoiceParticipant,
          closePeer,
          ensurePeer,
          ensureVoicePeersFromState,
          handleRtcDescription,
          handleRtcCandidate,
          finishVoiceJoinAttempt,
          acceptsVoiceJoinAcknowledgement,
          cleanupVoiceLocal,
          loadSoundboardSounds: voiceControls.loadSoundboardSounds,
        },
        session: {
          setAuthError,
          setOutbox,
          outboxRef,
          realtimeReconnectEnabledRef,
          voiceReconnectChannelRef,
          pendingForumPublishRef,
          logout,
        },
      },
      onAuthError: (data) => {
        realtimeReconnectEnabledRef.current = false;
        voiceReconnectChannelRef.current = null;
        setAuthError(data.message || "Session expired.");
        storeToken("");
        setCurrentUser(null);
      },
      onIdentified: (data, socket) => {
        selfConnectionIdRef.current = typeof data.id === "string" ? data.id : selfConnectionIdRef.current;
        const serverId = Number(data.serverId ?? activeServerRef.current);
        const channelId = Number(data.channelId ?? activeChannelRef.current);
        activeServerRef.current = serverId;
        activeChannelRef.current = channelId;
        setSelectedServer(serverId);
        setSelectedChannel(channelId);
        setConnectionStatus("Connected");
        composer.setAttachmentError((current) => (current.startsWith("Realtime is reconnecting.") ? "" : current));
        void friendActions.loadSocialState();
        if (channelId > 0) void loadMessages(channelId);

        const voiceChannelToRestore = voiceReconnectChannelRef.current;
        if (voiceChannelToRestore !== null) {
          void rejoinVoiceAfterRealtimeReconnect(voiceChannelToRestore, socket);
        }
      },
      onClosed: () => {
        cancelVoiceJoinAttempt();

        if (voiceChannelRef.current !== null) {
          voiceReconnectChannelRef.current = voiceChannelRef.current;
        }
        // A deploy can briefly recycle the realtime Worker/DO while the user's
        // authenticated session remains valid. Keep the current UI state and
        // microphone lease warm while the socket is replaced, then rejoin voice
        // automatically after IDENTIFIED arrives.
        cleanupVoiceLocal(false, true);
        if (voiceReconnectChannelRef.current !== null) voiceCall.setVoiceStatus("Connecting...");
      },
    };
  });
}
