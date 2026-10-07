import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { VoiceActivationGateMetrics } from "./audio/clearvoice/VoiceActivationGate";
import type { HubTemplateId } from "../shared/hub-templates";
import { CreateHubModal } from "./features/create-hub/CreateHubModal";
import "./features/hub-sidebar/hubBanner.css";
import type { StreamerEvent } from "../shared/streamer-mode";
import {
  type DiscordImportApplyResult,
  type DiscordImportPreview,
  type DiscordImportRollbackResult,
} from "../shared/discord-template";
import "./styles/app.css";
import { Icon, type IconName } from "./components/Icon";
import "./styles/hub-templates.css";
import { DiscordImportReview } from "./components/studio";
import { resolveSkin, motionReduced } from "./features/settings";
import { ManageHubPanel } from "./features/manage-hub";
import { RoomSettingsPanel } from "./features/room-settings";
import {
  DEFAULT_QUIET_PRESENCE,
  type QuietPresenceRepository,
  type QuietPresenceSettings as QuietPresenceModel,
} from "./session/quiet-presence.ts";
import { buildLocalSessionRecap, type LocalRecapAction, type LocalRecapRepository } from "./session/local-recap.ts";
import type { SessionKit, SessionKitReferenceCatalog, SessionKitRepository } from "../shared/session-kit.ts";
import type { SquadPreset, SquadPresetRepository, SupportedSquadFilters } from "./session/squad-presets.ts";
import type { VoiceReadiness } from "./session/voice-readiness.ts";
import {
  normalizeDecisionCard,
  type DecisionCardTransport,
  type SharedDecisionCard,
} from "./session/decision-cards.ts";
import { streamerSidebarBinding } from "./streamer/sidebar";
import type { StreamerTransport } from "./streamer/api";
import { DirectCallOverlay } from "./components/DirectCallOverlay";
import HubBotsPanel from "./components/HubBotsPanel";
import "./components/HubBotsPanel.css";
import ReportDialog from "./components/ReportDialog";
import MyReportsPanel from "./components/MyReportsPanel";
import type { SafetyReportTarget } from "./safety/types";
import "./styles/app-rework.css";
import "./styles/design-system-legacy.css";
import type { ForumPreview } from "./features/hub-sidebar/HubRoomBoxes";
import { PinnedMessagesPanel } from "./features/pins/PinnedMessagesPanel";
import { failStale, type OutboxItem } from "./features/outbox/outbox";
import { HubInsightsDialog } from "./features/hub-home/HubOwnerTools";
import type { HubHomeCatchUp, HubHomeEvent, HubHomeLiveRoom } from "./features/hub-home/HubHome";
import { DiscoverPage } from "./features/discover/DiscoverPage";
import { normalizeHubHomeConfig } from "../shared/hub-home";
import {
  EventComposerSheet,
  EventDetailDrawer,
  apiEventToItem,
  itemEnd,
  mergeCalendarItems,
  useHubEvents,
  type CalendarItem,
  type EventComposerSeed,
} from "./features/events";
import type {
  AppLocalRecapActionInput,
  ChannelType,
  ServerRole,
  ServerVisibility,
  CustomRoleView,
  Channel,
  HubAsset,
  PollPayload,
  EventInviteMode,
  ComposerTarget,
  Server,
  DiscoverServer,
  SquadSearch,
  AccountUser,
  OnlineUser,
  AttachmentMeta,
  ChatMessage,
  ServerMemberView,
  ServerAccessUser,
  VoiceParticipant,
  SocialUser,
  DirectMessage,
  DmConversation,
  DmPreference,
  GroupChatMessage,
  GroupChat,
  DmNotice,
  UserContextMenuState,
  ResourceContextMenuState,
  PeerSession,
  RemoteScreen,
  NoiseSuppressionMode,
  AppSkin,
  ScreenQuality,
  ActivitySettings,
  SteamIntegrationState,
  DesktopKeybindSettings,
  HomeDashboardWidget,
  HubCalendarEvent,
  AudioSettings,
  SinkableAudioElement,
  ApiError,
  NotificationSettings,
  PrivacySettings,
  SoundSettings,
  SettingsSnapshot,
  AdminDashboardTab,
  WorkspaceHistoryEntry,
  GlobalCommandItem,
  VoiceJoinAttempt,
} from "./app/types";
import {
  VOICE_USER_VOLUMES_KEY,
  VADRION_SKIN_KEY,
  AUDIO_SETTINGS_KEY,
  MUTED_USERS_KEY,
  LAST_WORKSPACE_KEY,
  loadLastWorkspaceSelection,
  loadMutedUserIds,
  ACCESSIBILITY_TEXT_SCALE_KEY,
  ACTIVITY_SETTINGS_KEY,
  loadAccessibilityTextScale,
  loadAudioSettings,
  loadVoiceUserVolumes,
} from "./app/settings-storage";
import { HTTP_URL, hubShareCodeFromLocation } from "./app/env";
import { SCREEN_SHARE_PROFILES, microphoneErrorMessage } from "./app/voice";
import { type HomeQuickLink, loadHomeQuickLinks, loadHomeLayout } from "./app/home-dashboard";
import { formatTimestamp } from "./app/locale";
import { formatActivityElapsed, clamp } from "./app/format";
import { hasDesktopActivityBridge, setDesktopStreamerMode, setDesktopVoiceOverlayState } from "./app/desktop";
import { isStreamerServer, streamerLocalMediaPath, streamerMediaUrl } from "./app/streamer";
import {
  DEFAULT_ROOM_ICONS,
  REFERENCE_ROOM_ICONS,
  ROLE_ICON_CHOICES,
  HISTORY_PAGE_SIZE,
  EMPTY_SERVER,
} from "./app/constants";
import { POLL_PREFIX, parsePrefixedJson } from "./app/message-payloads";
import { resolveAvatarUrl } from "./app/user-display";
import { UserAvatar } from "./app/components/UserAvatar";
import { DeCaveBrand } from "./app/components/DeCaveBrand";
import { DiscordImportPanel } from "./app/components/DiscordImportPanel";
import { useInjectedStyle } from "./app/hooks/useInjectedStyle";
import { useSyncRef } from "./app/hooks/useSyncRef";
import { useSystemAppearance } from "./app/hooks/useSystemAppearance";
import { useDesktopFitScale } from "./app/hooks/useDesktopFitScale";
import { useHubMutes } from "./app/hooks/useHubMutes";
import { useDesktopUpdates } from "./app/hooks/useDesktopUpdates";
import APP_SHELL_CSS from "./styles/shell/app-shell.css?raw";
import POLISHED_SKINS_CSS from "./styles/shell/polished-skins.css?raw";
import REFERENCE_UI_CSS from "./styles/shell/reference-ui.css?raw";
import { AuthScreen } from "./app/views/AuthScreen";
import { HubOnboardingScreen } from "./app/views/HubOnboardingScreen";
import { LogoutConfirmDialog } from "./app/views/LogoutConfirmDialog";
import { FriendsSidebar } from "./app/views/FriendsSidebar";
import { HubMessageList } from "./app/views/HubMessageList";
import { VoiceRoomStage } from "./app/views/VoiceRoomStage";
import type { RealtimeAppHandlers } from "./realtime/events";
import { createVoiceEngine } from "./voice/engine";
import { ResourceContextMenu } from "./app/views/ResourceContextMenu";
import { UserContextMenu } from "./app/views/UserContextMenu";
import { SettingsCloseConfirmDialog } from "./app/views/SettingsCloseConfirmDialog";
import { FeedbackDialog } from "./app/views/FeedbackDialog";
import { GroupMembersDialog } from "./app/views/GroupMembersDialog";
import { NewConversationDialog } from "./app/views/NewConversationDialog";
import { NoHubsPlaceholder } from "./app/views/NoHubsPlaceholder";
import { createAdminActions } from "./app/actions/admin";
import { createHubActions } from "./app/actions/hubs";
import { createDirectMessageActions } from "./app/actions/direct-messages";
import { createAccountActions } from "./app/actions/account";
import { createProfileMediaActions } from "./app/actions/profile-media";
import { createActivityActions } from "./app/actions/activity";
import { createFriendActions } from "./app/actions/friends";
import { createSettingsActions } from "./app/actions/settings";
import { createHubChatActions } from "./app/actions/hub-chat";
import { createVoiceControlActions } from "./app/actions/voice-controls";
import { createMessageHistoryActions } from "./app/actions/message-history";
import { createAuthActions } from "./app/actions/auth";
import { clearForumDraftsForAccount } from "./features/forum/forumModel";
import { homeNotesStorageKey } from "./app/home-dashboard";
import { createHubImportActions } from "./app/actions/hub-import";
import { createSessionActions } from "./app/actions/session";
import { createHomeDashboardActions } from "./app/actions/home-dashboard";
import { createMessageRendering, renderGroupMessageBody } from "./app/actions/message-rendering";
import { createPageNavigation } from "./app/actions/page-navigation";
import { createContextMenuActions } from "./app/actions/context-menus";
import { HubForumRoom } from "./app/views/HubForumRoom";
import { HomePage } from "./app/views/HomePage";
import { SocialPage } from "./app/views/SocialPage";
import { AdminDashboardPage } from "./app/views/admin/AdminDashboardPage";
import { useRealtimeConnection } from "./realtime/useRealtimeConnection";
import { useForumRoomPreviews } from "./app/hooks/useForumRoomPreviews";
import { useVoiceSessionRecap } from "./app/hooks/useVoiceSessionRecap";
import { useWorkspaceHistoryShortcuts } from "./app/hooks/useWorkspaceHistoryShortcuts";
import { useWorkspaceHistoryRecording } from "./app/hooks/useWorkspaceHistoryRecording";
import { useCaptureAppsWatch } from "./app/hooks/useCaptureAppsWatch";
import { useEscapeKey } from "./app/hooks/useEscapeKey";
import { useCloseMenusOnOutsidePointer } from "./app/hooks/useCloseMenusOnOutsidePointer";
import { useSpeakingDetection } from "./voice/useSpeakingDetection";
import { useRtcStatsPolling } from "./voice/useRtcStatsPolling";
import { useAuthBootstrap } from "./app/hooks/useAuthBootstrap";
import { useSessionKitRepository } from "./app/hooks/useSessionKitRepository";
import { AccountEditDialog } from "./app/views/AccountEditDialog";
import { SquadFinderDialog } from "./app/views/SquadFinderDialog";
import { RemoveFriendDialog } from "./app/views/RemoveFriendDialog";
import { CommandPalette } from "./app/views/CommandPalette";
import { VoiceControlsPanel } from "./app/views/VoiceControlsPanel";
import { VoiceMiniPlayer } from "./app/views/VoiceMiniPlayer";
import { useAdminDashboardState } from "./app/state/admin-dashboard";
import { useOwnerSecurityState } from "./app/state/owner-security";
import { useAccountEditState } from "./app/state/account-edit";
import { useAccountSessionsState } from "./app/state/account-sessions";
import { useAuthFormState } from "./app/state/auth-form";
import { useExternalWidgetFormState } from "./app/state/external-widget-form";
import { useGifSearchState } from "./app/state/gif-search";
import { useNewConversationState } from "./app/state/new-conversation";
import { useProfileMediaState } from "./app/state/profile-media";
import { useSoundboardState } from "./app/state/soundboard";
import { useCameraShareOptionsState } from "./app/state/camera-share-options";
import { HubContextHeader } from "./app/views/HubContextHeader";
import { NoticeToastStack } from "./app/views/NoticeToastStack";
import { HubSidebar } from "./app/views/HubSidebar";
import { AppTopBar } from "./app/views/AppTopBar";
import { ServerRail } from "./app/views/ServerRail";
import { authorizedFetch, fetchWsToken } from "./app/http";
import { homeCalendarEventForMessage, firstOccurrencePerEvent } from "./app/calendar";
import { workspaceEntryKey } from "./app/workspace-history";
import { createNotificationActions } from "./app/actions/notifications";
import { createVoiceMiniPlayerActions } from "./app/actions/voice-mini-player";
import { createCalendarActions } from "./app/actions/calendar";
import { createSquadSearchActions } from "./app/actions/squad-search";
import { useSettingsWindowState } from "./app/state/settings-window";
import { useProfileFieldsState } from "./app/state/profile-fields";
import { usePreferencesState } from "./app/state/preferences";
import { useGameActivityState } from "./app/state/game-activity";
import { useAudioSetupState } from "./app/state/audio-setup";
import { SettingsWindow } from "./app/views/settings/SettingsWindow";
import { useHubPanelsState } from "./app/state/hub-panels";
import { useComposerState } from "./app/state/composer";
import { useForumRoomUiState } from "./app/state/forum-room-ui";
import { useVoiceCallState } from "./app/state/voice-call";
import { useCallMediaState } from "./app/state/call-media";
import { useSettingsDirtyTracking } from "./app/hooks/useSettingsDirtyTracking";
import { useGlobalShortcuts } from "./app/hooks/useGlobalShortcuts";
import { PollComposerDialog } from "./app/views/PollComposerDialog";
import { AccountDangerDialog } from "./app/views/AccountDangerDialog";
import { StreamFocusOverlay } from "./app/views/StreamFocusOverlay";
import { InboxPanel } from "./app/views/InboxPanel";
import { MessageSearchDialog } from "./app/views/MessageSearchDialog";
import { RoomEmptyHero } from "./app/views/RoomEmptyHero";
import { AppBottomBar } from "./app/views/AppBottomBar";
import { OwnerSecurityDialog } from "./app/views/OwnerSecurityDialog";
import { SquadMatchPopup } from "./app/views/SquadMatchPopup";
import { AgeGateDialog } from "./app/views/AgeGateDialog";
import { useRealtimeAppHandlers } from "./app/hooks/useRealtimeAppHandlers";
import { HubComposerStatus } from "./app/views/HubComposerStatus";
import { HubHomePanel } from "./app/views/HubHomePanel";
import { HubStreamerOverview } from "./app/views/HubStreamerOverview";
import { createAudioDeviceActions } from "./app/actions/audio-devices";
import { createFeedbackActions } from "./app/actions/feedback";
import { createSquadRoomActions } from "./app/actions/squad-rooms";
import { createHubDirectoryActions } from "./app/actions/hub-directory";
import { AccountSessionGuard } from "./app/account-session-guard";
import { createHomeCalendarActions } from "./app/actions/home-calendar";
import { createSafetyActions } from "./app/actions/safety";
import { createPresenceActions } from "./app/actions/presence";
import { createSettingsSyncActions } from "./app/actions/settings-sync";
import { useSquadMatchPolling } from "./app/hooks/useSquadMatchPolling";
import { useGameActivityTracking } from "./app/hooks/useGameActivityTracking";
import { useHomePersistence } from "./app/hooks/useHomePersistence";
import { usePreferencePersistence } from "./app/hooks/usePreferencePersistence";
import { useTransientUiDismissal } from "./app/hooks/useTransientUiDismissal";

function App() {
  useInjectedStyle("decave-polished-skins-v1", POLISHED_SKINS_CSS);
  useInjectedStyle("decave-reference-ui-v2", REFERENCE_UI_CSS);

  const [authToken, setAuthToken] = useState("");
  const [currentUser, setCurrentUser] = useState<AccountUser | null>(null);
  const accountSessionGuardRef = useRef(new AccountSessionGuard());
  const accountSessionSnapshot = accountSessionGuardRef.current.switchTo(currentUser?.id ?? null);
  const [authReady, setAuthReady] = useState(false);
  const [serversReady, setServersReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot">("login");
  const preferences = usePreferencesState();
  const extraSettingsRef = useRef(preferences.extraSettings);
  extraSettingsRef.current = preferences.extraSettings;
  const { prefersDark, systemReducedMotion } = useSystemAppearance();
  /** The skin on screen: the chosen one, or the light/dark pick when following the computer. */
  const displaySkin = resolveSkin(preferences.extraSettings, preferences.appSkin, prefersDark) as AppSkin;
  // Mirror the skin onto <html>/<body> so overlays portaled to document.body
  // resolve the same design tokens as surfaces inside .app.
  useLayoutEffect(() => {
    document.documentElement.dataset.skin = displaySkin;
    document.body.dataset.skin = displaySkin;
  }, [displaySkin]);
  const authForm = useAuthFormState();
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [turnstileTestMode, setTurnstileTestMode] = useState(false);
  const [streamerHubsCapability, setStreamerHubsCapability] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const [authError, setAuthError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const settingsWindow = useSettingsWindowState();
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0);
  const [showInbox, setShowInbox] = useState(false);
  const [settingsHydrationVersion, setSettingsHydrationVersion] = useState(0);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const profileMedia = useProfileMediaState();
  const [profileAvatarError, setProfileAvatarError] = useState("");
  const accountEdit = useAccountEditState();
  const [securityNotice, setSecurityNotice] = useState("");
  const accountSessions = useAccountSessionsState();
  const [securityBusy, setSecurityBusy] = useState(false);
  const [accountEditField, setAccountEditField] = useState<"username" | "email" | "phone" | "password" | null>(null);
  const accountEditOperationRef = useRef<{ accountId: string; controller: AbortController } | null>(null);
  const accountEditAccountIdRef = useRef<string | null>(currentUser?.id ?? null);
  accountEditAccountIdRef.current = currentUser?.id ?? null;
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [keybindCapture, setKeybindCapture] = useState<keyof DesktopKeybindSettings | null>(null);
  const soundboard = useSoundboardState();
  const voiceCall = useVoiceCallState();
  const callMedia = useCallMediaState();
  const [dangerPassword, setDangerPassword] = useState("");
  const [accountDangerAction, setAccountDangerAction] = useState<"disable" | "delete" | null>(null);
  const accountDangerOperationRef = useRef<{
    accountId: string;
    controller: AbortController;
    mutationStarted: boolean;
  } | null>(null);
  const [deleteOwnershipBlock, setDeleteOwnershipBlock] = useState<string[] | null>(null);
  const ownerSecurity = useOwnerSecurityState();
  const ownerSecurityRoleRef = useRef(ownerSecurity.platformOwnerActive);
  ownerSecurityRoleRef.current = ownerSecurity.platformOwnerActive;
  const ownerSecurityOperationRef = useRef<{
    accountId: string;
    kind: "setup" | "reauth";
    controller: AbortController;
    mutationStarted: boolean;
  } | null>(null);
  const [ownerLoginChallengeToken, setOwnerLoginChallengeToken] = useState("");
  const [ownerLoginMfaCode, setOwnerLoginMfaCode] = useState("");
  const [ownerLoginMfaBusy, setOwnerLoginMfaBusy] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [adminDashboardTab, setAdminDashboardTab] = useState<AdminDashboardTab>("overview");
  const adminDashboard = useAdminDashboardState();
  const [reportTarget, setReportTarget] = useState<SafetyReportTarget | null>(null);
  const [showMyReports, setShowMyReports] = useState(false);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [ageGateBirthDate, setAgeGateBirthDate] = useState("");
  const [ageGateNotice, setAgeGateNotice] = useState("");
  const [ageGateBusy, setAgeGateBusy] = useState(false);
  const [hubOnboardingSkipped, setHubOnboardingSkipped] = useState(false);
  const profileFields = useProfileFieldsState();
  const [customStatusEditing, setCustomStatusEditing] = useState(false);
  const [customStatusDraft, setCustomStatusDraft] = useState("");
  const [customStatusSaving, setCustomStatusSaving] = useState(false);
  const [customStatusError, setCustomStatusError] = useState("");
  const gameActivity = useGameActivityState();
  const [quietPresence, setQuietPresence] = useState<QuietPresenceModel>(DEFAULT_QUIET_PRESENCE);
  const [sessionKits, setSessionKits] = useState<SessionKit[]>([]);
  const [sessionRecapActions, setSessionRecapActions] = useState<LocalRecapAction[]>([]);
  const [squadPresets, setSquadPresets] = useState<SquadPreset[]>([]);
  const [voiceReadiness, setVoiceReadiness] = useState<VoiceReadiness | null>(null);
  const [sessionStudioSection, setSessionStudioSection] = useState<
    "overview" | "kits" | "voice" | "decisions" | "squad"
  >("overview");
  const [decisionCardComposerOpen, setDecisionCardComposerOpen] = useState(false);
  const [createdDecisionCards, setCreatedDecisionCards] = useState<SharedDecisionCard[]>([]);
  const sessionKitRepositoryRef = useRef<SessionKitRepository | null>(null);
  const quietPresenceRepositoryRef = useRef<QuietPresenceRepository | null>(null);
  const localRecapRepositoryRef = useRef<LocalRecapRepository | null>(null);
  const squadPresetRepositoryRef = useRef<SquadPresetRepository | null>(null);
  const sessionIdRef = useRef("");
  const activeVoiceRecapSessionRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const notifyLevelsRef = useRef(preferences.notifyLevels);
  notifyLevelsRef.current = preferences.notifyLevels;
  /** Streaming apps running right now (desktop app, when auto Streamer mode is on). */
  const [captureApps, setCaptureApps] = useState<string[]>([]);
  const [streamerToast, setStreamerToast] = useState("");
  const autoStreamerActive = preferences.privacySettings.autoStreamerMode && captureApps.length > 0;
  /** Streamer mode as applied: switched on by hand, or automatically while streaming. */
  const effectiveStreamerMode = preferences.privacySettings.streamerMode || autoStreamerActive;
  const fitScale = useDesktopFitScale();
  const [homeWidgets, setHomeWidgets] = useState<HomeDashboardWidget[]>(() => loadHomeLayout(null));
  /** Account whose Home layout is loaded into homeWidgets (null before sign-in). */
  const [homeLayoutOwner, setHomeLayoutOwner] = useState<string | null>(null);
  const [homeQuickLinks, setHomeQuickLinks] = useState<HomeQuickLink[]>(loadHomeQuickLinks);
  const [homeCalendarEvents, setHomeCalendarEvents] = useState<HubCalendarEvent[]>([]);
  const [homeCalendarBusy, setHomeCalendarBusy] = useState(false);
  const [homeCalendarNotice, setHomeCalendarNotice] = useState("");
  const homeCalendarSyncRef = useRef(0);
  const [homeEditMode, setHomeEditMode] = useState(false);
  const [showQuickLinkEditor, setShowQuickLinkEditor] = useState(false);
  const [quickLinkDraft, setQuickLinkDraft] = useState<HomeQuickLink[]>([]);
  const [quickLinkError, setQuickLinkError] = useState("");
  const externalWidgetForm = useExternalWidgetFormState();
  const [homeNotes, setHomeNotes] = useState("");
  const [homeNotesOwner, setHomeNotesOwner] = useState<string | null>(null);
  const [showHome, setShowHome] = useState(false);
  const hubPanels = useHubPanelsState();
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [messageSearchResults, setMessageSearchResults] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
  const [roomUnread, setRoomUnread] = useState<Record<number, number>>({});
  const [roomMentions, setRoomMentions] = useState<Record<number, number>>({});
  const [mutedUserIds, setMutedUserIds] = useState<string[]>(loadMutedUserIds);
  const [pendingHubShareCode, setPendingHubShareCode] = useState(hubShareCodeFromLocation);
  const [hubShareNotice, setHubShareNotice] = useState("");
  useEffect(() => {
    if (!hubShareNotice) return;
    const timer = window.setTimeout(() => setHubShareNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [hubShareNotice]);
  const [chatAtBottom, setChatAtBottom] = useState(true);
  const composer = useComposerState();

  const [servers, setServers] = useState<Server[]>([]);
  const [initialWorkspaceSelection] = useState(loadLastWorkspaceSelection);
  const [selectedServer, setSelectedServer] = useState(initialWorkspaceSelection.serverId);
  const [selectedChannel, setSelectedChannel] = useState(initialWorkspaceSelection.channelId);
  const [messageDrafts, setMessageDrafts] = useState<Record<number, string>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [hubMembers, setHubMembers] = useState<ServerMemberView[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [reactionPickerPosition, setReactionPickerPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  /** Messages sent but not yet confirmed by the server (see features/outbox). */
  const [outbox, setOutbox] = useState<OutboxItem<AttachmentMeta>[]>([]);
  const outboxRef = useRef(outbox);
  outboxRef.current = outbox;
  const myUserIdRef = useRef<string | undefined>(undefined);

  const [showCreateServer, setShowCreateServer] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [newServerVisibility, setNewServerVisibility] = useState<ServerVisibility>("private");
  const [newServerTemplate, setNewServerTemplate] = useState<HubTemplateId>("blank");
  const [creatingServer, setCreatingServer] = useState(false);
  const [discordImportPreview, setDiscordImportPreview] = useState<DiscordImportPreview | null>(null);
  const [discordImportBusy, setDiscordImportBusy] = useState(false);
  const [discordImportError, setDiscordImportError] = useState("");
  const [hubImportPreview, setHubImportPreview] = useState<DiscordImportPreview | null>(null);
  const [hubImportBusy, setHubImportBusy] = useState(false);
  const [hubImportError, setHubImportError] = useState("");
  const [serverCreateError, setServerCreateError] = useState("");
  const [showServerBrowser, setShowServerBrowser] = useState(false);
  const [discoverServers, setDiscoverServers] = useState<DiscoverServer[]>([]);
  const [discoverSearch, setDiscoverSearch] = useState("");
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState("");
  const [showSquadFinder, setShowSquadFinder] = useState(false);
  const [squadGame, setSquadGame] = useState("Escape from Tarkov");
  const [squadGames, setSquadGames] = useState<string[]>(["Escape from Tarkov"]);
  const [squadGameSuggestion, setSquadGameSuggestion] = useState("");
  const [squadPlatform, setSquadPlatform] = useState("PC");
  const [squadLanguage, setSquadLanguage] = useState("English");
  const [squadRegion, setSquadRegion] = useState("Europe");
  const [squadMicrophone, setSquadMicrophone] = useState(true);
  const [squadCurrent, setSquadCurrent] = useState<SquadSearch | null>(null);
  const [squadMatches, setSquadMatches] = useState<SquadSearch[]>([]);
  const [squadMatchPopup, setSquadMatchPopup] = useState<SquadSearch | null>(null);
  const squadNotifiedMatchRef = useRef("");
  const [squadBusy, setSquadBusy] = useState(false);
  const [squadNotice, setSquadNotice] = useState("");

  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [roomReorderError, setRoomReorderError] = useState("");
  const lobbyPendingJoinRef = useRef<{ channelId: number; muted: boolean; camera: boolean } | null>(null);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<ChannelType>("text");
  const [newChannelIcon, setNewChannelIcon] = useState("💬");
  const [newChannelPrivate, setNewChannelPrivate] = useState(false);
  const [newChannelMemberIds, setNewChannelMemberIds] = useState<string[]>([]);
  const [newForumGuidelines, setNewForumGuidelines] = useState("");
  const [newForumPostPolicy, setNewForumPostPolicy] = useState<"everyone" | "staff" | "roles" | "members">("everyone");
  const [newForumPostRoleIds, setNewForumPostRoleIds] = useState<string[]>([]);
  const [newForumPostMemberIds, setNewForumPostMemberIds] = useState<string[]>([]);
  const [, setNewForumMemberSearch] = useState("");
  const [channelCreateError, setChannelCreateError] = useState("");
  const forumRoomUi = useForumRoomUiState();

  const [showManageServer, setShowManageServer] = useState(false);
  const [manageServerName, setManageServerName] = useState("");
  const [manageServerIcon, setManageServerIcon] = useState("");
  const [manageServerVisibility, setManageServerVisibility] = useState<ServerVisibility>("private");
  const [serverManageError, setServerManageError] = useState("");
  const [manageServerDescription, setManageServerDescription] = useState("");
  const [manageServerAccent, setManageServerAccent] = useState("#7c5cff");
  const [manageServerTheme, setManageServerTheme] = useState<"midnight" | "ember" | "forest" | "ocean">("midnight");
  const [manageUseBannerBackground, setManageUseBannerBackground] = useState(false);
  const [manageUseChatBackground, setManageUseChatBackground] = useState(false);
  const [profileStatusMenuOpen, setProfileStatusMenuOpen] = useState(false);
  const [manageServerCategory, setManageServerCategory] = useState("Gaming");
  const [manageServerTags, setManageServerTags] = useState("");
  const [manageSlowMode, setManageSlowMode] = useState(0);
  const [hubInviteCode, setHubInviteCode] = useState("");
  const [, setHubMemberSearch] = useState("");
  const [, setHubFriendSearch] = useState("");
  const [, setManageHubAdvancedOpen] = useState(false);
  const [hubMemberMenuId, setHubMemberMenuId] = useState<string | null>(null);
  const [hubShareBusy, setHubShareBusy] = useState(false);
  const [manageHubIconRing, setManageHubIconRing] = useState(false);
  const [inviteJoinCode, setInviteJoinCode] = useState("");
  const [hubMediaBusy, setHubMediaBusy] = useState(false);
  const [hubMediaError, setHubMediaError] = useState("");
  const [hubAuditLog, setHubAuditLog] = useState<
    Array<{
      id: string;
      action: string;
      actorUserId: string;
      targetUserId?: string;
      detail?: string;
      timestamp: string;
    }>
  >([]);
  const [hubAssets, setHubAssets] = useState<HubAsset[]>([]);
  const [hubFeatureBusy, setHubFeatureBusy] = useState(false);
  const [customRoles, setCustomRoles] = useState<CustomRoleView[]>([]);
  const [serverMembers, setServerMembers] = useState<ServerMemberView[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [serverAccessUsers, setServerAccessUsers] = useState<ServerAccessUser[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);

  const [friends, setFriends] = useState<SocialUser[]>([]);
  const [friendListSearch, setFriendListSearch] = useState("");
  const [friendListFilter, setFriendListFilter] = useState<"all" | "online" | "offline" | "pending">("online");
  const [friendActionsUserId, setFriendActionsUserId] = useState<string | null>(null);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<SocialUser[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<SocialUser[]>([]);
  const [friendIdInput, setFriendIdInput] = useState("");
  const [friendIdNotice, setFriendIdNotice] = useState("");
  // Target of the last "Friend request sent." notice; cleared once they accept.
  const friendRequestSentToRef = useRef<string | null>(null);
  const [friendIdBusy, setFriendIdBusy] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [socialView, setSocialView] = useState<"dm" | "friends">("friends");
  const [activeDmUser, setActiveDmUser] = useState<SocialUser | null>(null);
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [dmPreferences, setDmPreferences] = useState<Record<string, DmPreference>>({});
  const [dmConversationSearch, setDmConversationSearch] = useState("");
  const [dmListFilter, setDmListFilter] = useState<"all" | "unread" | "requests" | "archived">("all");
  const [dmHeaderMenuOpen, setDmHeaderMenuOpen] = useState(false);
  const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
  const [activeGroupChat, setActiveGroupChat] = useState<GroupChat | null>(null);
  const [groupMessages, setGroupMessages] = useState<GroupChatMessage[]>([]);
  const [groupInput, setGroupInput] = useState("");
  const [groupReplyingTo, setGroupReplyingTo] = useState<GroupChatMessage | null>(null);
  const [groupError, setGroupError] = useState("");
  const [showNewConversation, setShowNewConversation] = useState(false);
  const newConversation = useNewConversationState();
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [dmMessages, setDmMessages] = useState<DirectMessage[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [dmDrafts, setDmDrafts] = useState<Record<string, string>>({});
  const [dmReplyingTo, setDmReplyingTo] = useState<DirectMessage | null>(null);
  const [dmAttachmentBusy, setDmAttachmentBusy] = useState(false);
  const [dmAttachmentRetryName, setDmAttachmentRetryName] = useState("");
  const [rightFriendSearch, setRightFriendSearch] = useState("");
  const [rightFriendsCollapsed, setRightFriendsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("decave-right-friends-collapsed-v1") === "1";
    } catch {
      return false;
    }
  });
  const [hubRailCollapsed, setHubRailCollapsed] = useState(() => {
    try {
      return localStorage.getItem("decave-hub-rail-collapsed-v1") === "1";
    } catch {
      return false;
    }
  });
  // Hub Home: the landing page of a Hub, shown in the room pane (replaces the old Overview popover).
  const [forumPreviews, setForumPreviews] = useState<Record<number, ForumPreview | null>>({});
  const appRootRef = useRef<HTMLDivElement | null>(null);
  // Full-page Hub Calendar (replaces the old popover; name kept for the Escape/outside-click chains).
  const [hubMembersPanelSearch, setHubMembersPanelSearch] = useState("");
  const [hubMembersPanelRole, setHubMembersPanelRole] = useState("all");
  const [dmError, setDmError] = useState("");
  const [dmEditingId, setDmEditingId] = useState<string | null>(null);
  const [dmEditingText, setDmEditingText] = useState("");
  const [showPollComposer, setShowPollComposer] = useState<"hub" | "dm" | null>(null);
  const [showDmPlusMenu, setShowDmPlusMenu] = useState(false);
  const [showDmEmojiPicker, setShowDmEmojiPicker] = useState(false);
  const [showGroupEmojiPicker, setShowGroupEmojiPicker] = useState(false);
  const [gifPickerTarget, setGifPickerTarget] = useState<ComposerTarget | null>(null);
  const gifSearch = useGifSearchState();
  const [showEventComposer, setShowEventComposer] = useState(false);
  // Session kits restore invitees; the event composer uses them as the "members" audience prefill.
  const [eventInviteMode, setEventInviteMode] = useState<EventInviteMode>("all");
  const [eventInviteMemberIds, setEventInviteMemberIds] = useState<string[]>([]);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [dmDeleteConfirm, setDmDeleteConfirm] = useState<DirectMessage | null>(null);
  const [dmConversationDeleteConfirm, setDmConversationDeleteConfirm] = useState<SocialUser | null>(null);
  const [dmUnread, setDmUnread] = useState<Record<string, number>>({});
  const [userContextMenu, setUserContextMenu] = useState<UserContextMenuState | null>(null);
  useEffect(() => {
    if (!userContextMenu) setProfileStatusMenuOpen(false);
  }, [userContextMenu]);
  const dmAutoOpenedRef = useRef(false);
  const openDirectMessageRef = useRef<((user: SocialUser) => Promise<void>) | null>(null);
  useEffect(() => {
    if (!showSocial || socialView !== "dm") {
      dmAutoOpenedRef.current = false;
      return;
    }
    if (dmAutoOpenedRef.current || activeDmUser || activeGroupChat) return;
    if (typeof window !== "undefined" && window.innerWidth < 900) return;
    const latest = dmConversations
      .filter((conversation) => !(dmPreferences[conversation.user.id]?.archived ?? false))
      .sort((a, b) => Date.parse(b.latestTimestamp) - Date.parse(a.latestTimestamp))[0];
    if (!latest) return;
    dmAutoOpenedRef.current = true;
    void openDirectMessageRef.current?.(latest.user);
  }, [showSocial, socialView, dmConversations, activeDmUser, activeGroupChat]);
  const [profileDetails, setProfileDetails] = useState<Record<string, SocialUser>>({});
  const [resourceContextMenu, setResourceContextMenu] = useState<ResourceContextMenuState | null>(null);
  const [resourceContextMoreOpen, setResourceContextMoreOpen] = useState(false);
  const [friendRequestNotice, setFriendRequestNotice] = useState<SocialUser | null>(null);
  const [dmNotice, setDmNotice] = useState<DmNotice | null>(null);

  const { openSafetyReport, toggleBlockedUser, confirmAgeGate } = createSafetyActions({
    setCurrentUser,
    setReportTarget,
    blockedUserIds,
    setBlockedUserIds,
    ageGateBirthDate,
    setAgeGateNotice,
    setAgeGateBusy,
    setUserContextMenu,
    setDmNotice,
  });
  const [friendRemovalConfirm, setFriendRemovalConfirm] = useState<SocialUser | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"bug" | "feature">("bug");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackContact, setFeedbackContact] = useState("");
  const [feedbackShareContact, setFeedbackShareContact] = useState(false);
  const [feedbackDiagnosticsConsent, setFeedbackDiagnosticsConsent] = useState(false);
  const [feedbackDiagnosticName, setFeedbackDiagnosticName] = useState("");
  const [feedbackDiagnosticText, setFeedbackDiagnosticText] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  const { submitFeedback } = createFeedbackActions({
    feedbackType,
    feedbackMessage,
    setFeedbackMessage,
    feedbackContact,
    feedbackShareContact,
    feedbackDiagnosticsConsent,
    setFeedbackDiagnosticsConsent,
    feedbackDiagnosticName,
    setFeedbackDiagnosticName,
    feedbackDiagnosticText,
    setFeedbackDiagnosticText,
    setFeedbackNotice,
    setFeedbackBusy,
  });
  const [speakingConnections, setSpeakingConnections] = useState<Record<string, boolean>>({});

  const [showManageChannel, setShowManageChannel] = useState(false);
  const [manageChannelId, setManageChannelId] = useState(0);
  const [manageChannelServerId, setManageChannelServerId] = useState(0);
  const [manageChannelName, setManageChannelName] = useState("");
  const [manageChannelIcon, setManageChannelIcon] = useState("");
  const [manageChannelPrivate, setManageChannelPrivate] = useState(false);
  const [manageChannelMemberIds, setManageChannelMemberIds] = useState<string[]>([]);
  const [, setManageChannelMemberSearch] = useState("");
  const [manageForumGuidelines, setManageForumGuidelines] = useState("");
  const [manageForumPostPolicy, setManageForumPostPolicy] = useState<"everyone" | "staff" | "roles" | "members">(
    "everyone",
  );
  const [manageForumPostRoleIds, setManageForumPostRoleIds] = useState<string[]>([]);
  const [manageForumPostMemberIds, setManageForumPostMemberIds] = useState<string[]>([]);
  const [, setManageForumMemberSearch] = useState("");
  const [channelManageError, setChannelManageError] = useState("");
  const [draggedChannelId, setDraggedChannelId] = useState<number | null>(null);
  const draggedChannelRef = useRef<number | null>(null);

  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [voiceChannelId, setVoiceChannelId] = useState<number | null>(null);
  const cameraShareOptions = useCameraShareOptionsState();
  const [focusedVideo, setFocusedVideo] = useState<{
    title: string;
    stream: MediaStream;
    connectionId?: string;
  } | null>(null);

  const [audioSettings, setAudioSettings] = useState<AudioSettings>(loadAudioSettings);
  const [voiceUserVolumes, setVoiceUserVolumes] = useState<Record<string, number>>(loadVoiceUserVolumes);
  const audioSetup = useAudioSetupState();
  const [activeNoiseSuppressionMode, setActiveNoiseSuppressionMode] = useState<NoiseSuppressionMode>("off");

  const socketRef = useRef<WebSocket | null>(null);
  const ownerPrivilegedContextRef = useRef<{ accountId: string } | null>(null);
  const reconnectNowRef = useRef<() => void>(() => {});
  const realtimeReconnectEnabledRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const voiceReconnectChannelRef = useRef<number | null>(null);
  const voiceServerIdRef = useRef<number | null>(null);
  const voiceJoinAttemptRef = useRef<VoiceJoinAttempt | null>(null);
  const voiceJoinStartedAtRef = useRef<number | null>(null);
  const messageLoadGenerationRef = useRef(0);
  const activeServerRef = useRef(selectedServer);
  const serversRef = useRef<Server[]>(servers);
  const activeChannelRef = useRef(selectedChannel);

  const resetPrivateAccountState = () => {
    if (currentUser?.id) {
      clearForumDraftsForAccount(currentUser.id);
      try {
        localStorage.removeItem(homeNotesStorageKey(currentUser.id));
      } catch {
        /* storage unavailable */
      }
    }
    accountSessionGuardRef.current.invalidate();
    messageLoadGenerationRef.current += 1;
    homeCalendarSyncRef.current += 1;
    activeServerRef.current = 0;
    activeChannelRef.current = 0;
    myUserIdRef.current = undefined;
    outboxRef.current = [];
    setServersReady(false);
    setServers([]);
    setSelectedServer(0);
    setSelectedChannel(0);
    setMessages([]);
    setMessageDrafts({});
    setOnlineUsers([]);
    setHubMembers([]);
    setOutbox([]);
    setRoomUnread({});
    setRoomMentions({});
    setTypingUsers({});
    setMessageSearchResults([]);
    setDiscoverServers([]);
    setDiscoverLoading(false);
    setDiscoverError("");
    setFriends([]);
    setIncomingFriendRequests([]);
    setOutgoingFriendRequests([]);
    setActiveDmUser(null);
    setDmConversations([]);
    setDmPreferences({});
    setDmMessages([]);
    setDmUnread({});
    setDmDrafts({});
    setDmInput("");
    setDmReplyingTo(null);
    setDmNotice(null);
    setFriendRequestNotice(null);
    setGroupChats([]);
    setActiveGroupChat(null);
    setGroupMessages([]);
    setProfileDetails({});
    setHomeCalendarEvents([]);
    setHomeCalendarBusy(false);
    setHomeCalendarNotice("");
    setHomeWidgets(loadHomeLayout(null));
    setHomeLayoutOwner(null);
    setHomeNotes("");
    setHomeNotesOwner(null);
    setShowHome(false);
    setMessageSearchQuery("");
    setProfileStatusMenuOpen(false);
  };

  const { loadServers, saveHubHome, loadHubPreview, loadDiscoverServers } = createHubDirectoryActions({
    authToken,
    setServers,
    setSelectedServer,
    setSelectedChannel,
    setMessages,
    setDiscoverServers,
    setDiscoverLoading,
    setDiscoverError,
    activeServerRef,
    activeChannelRef,
    sessionGuard: accountSessionGuardRef.current,
    sessionSnapshot: accountSessionSnapshot,
  });
  // A forum post waiting for the server to echo it back (accepted) or send an
  // ERROR (rejected: slow mode, permissions, timeout...). The composer stays
  // open with its draft until this settles.
  const pendingForumPublishRef = useRef<{
    channelId: number;
    text: string;
    settle: (error: Error | null) => void;
  } | null>(null);
  const roomChatVisibleRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [olderHistory, setOlderHistory] = useState({ channel: false, dm: false, group: false });
  const [olderHistoryBusy, setOlderHistoryBusy] = useState(false);
  // Set while an older page is prepended so the stick-to-bottom effects keep the reader's place.
  const prependingHistoryRef = useRef(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const dmMessageListRef = useRef<HTMLDivElement | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentAbortRef = useRef<AbortController | null>(null);
  const attachmentRetryFileRef = useRef<File | null>(null);
  const dmAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const dmAttachmentAbortRef = useRef<AbortController | null>(null);
  const dmAttachmentRetryFileRef = useRef<File | null>(null);
  const selfConnectionIdRef = useRef("");
  const voiceChannelRef = useRef<number | null>(null);
  const voiceParticipantsRef = useRef<VoiceParticipant[]>([]);
  const localMicStreamRef = useRef<MediaStream | null>(null);
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  const directMicrophoneLeaseCountRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const clearVoiceNodeRef = useRef<AudioWorkletNode | null>(null);
  const inputGainNodeRef = useRef<GainNode | null>(null);
  const voiceActivationNodeRef = useRef<AudioWorkletNode | null>(null);
  const autoSensitivityDbRef = useRef(-45);
  const micLevelDbRef = useRef(-80);
  const micVoiceActivationAudibleRef = useRef(true);
  const voiceActivationMetricsRef = useRef<Partial<VoiceActivationGateMetrics> | null>(null);
  const micTrackIdRef = useRef("");
  const microphoneBuildSerialRef = useRef(0);
  const microphoneMutedSinceRef = useRef<number | null>(null);
  const requestMicrophoneRecoveryRef = useRef<(reason: string) => void>(() => {});
  const requestAiNoiseFallbackRef = useRef<(reason: string) => void>(() => {});
  const micTestAudioRef = useRef<SinkableAudioElement | null>(null);
  const micTestActiveRef = useRef(false);
  const settingsSnapshotRef = useRef<SettingsSnapshot | null>(null);
  const settingsHydratingRef = useRef(false);
  const accessibilityScaleUserRef = useRef<string | null>(null);
  const activitySettingsRef = useRef<ActivitySettings>(preferences.activitySettings);
  const steamIntegrationRef = useRef<SteamIntegrationState>(gameActivity.steamIntegration);
  const automaticActivityActiveRef = useRef(false);
  const lastPublishedActivityRef = useRef("");
  const steamPollAtRef = useRef(0);
  const steamLinkPollTimerRef = useRef<number | null>(null);
  const notificationSettingsRef = useRef<NotificationSettings>(preferences.notificationSettings);
  const soundSettingsRef = useRef<SoundSettings>(preferences.soundSettings);
  const quietPresenceRef = useRef<QuietPresenceModel>(quietPresence);
  const privacySettingsRef = useRef<PrivacySettings>(preferences.privacySettings);

  const { playUiSound, notificationPreviewMode, notificationPreviewText, desktopNotify } = createNotificationActions({
    extraSettingsRef,
    notificationSettingsRef,
    soundSettingsRef,
    privacySettingsRef,
    effectiveStreamerMode: () => effectiveStreamerMode,
  });

  const squadSearch = createSquadSearchActions({
    setSquadGame,
    squadGame,
    setSquadGames,
    squadGameSuggestion,
    setSquadGameSuggestion,
    squadPlatform,
    squadLanguage,
    squadRegion,
    squadMicrophone,
    setSquadCurrent,
    setSquadMatches,
    setSquadMatchPopup,
    squadNotifiedMatchRef,
    setSquadBusy,
    setSquadNotice,
    quietPresenceRef,
    desktopNotify,
  });
  const friendsRef = useRef<SocialUser[]>(friends);
  const mutedHubIdsRef = useRef<Set<number>>(new Set(preferences.mutedHubIds));
  const mutedUserIdsRef = useRef<Set<string>>(new Set(mutedUserIds));
  const audioSettingsRef = useRef<AudioSettings>(audioSettings);
  const voiceUserVolumesRef = useRef<Record<string, number>>(voiceUserVolumes);
  const isMutedRef = useRef(false);
  const isServerMutedRef = useRef(false);
  const isServerDeafenedRef = useRef(false);
  const activeDmUserRef = useRef<SocialUser | null>(null);
  const activeGroupChatRef = useRef<GroupChat | null>(null);
  const dmHistoryLoadGenerationRef = useRef(0);
  const groupHistoryLoadGenerationRef = useRef(0);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const localCameraStreamRef = useRef<MediaStream | null>(null);
  const cameraStartInFlightRef = useRef(false);
  const screenShareInFlightRef = useRef(false);
  const remoteScreensRef = useRef<Record<string, RemoteScreen>>({});
  const remoteCamerasRef = useRef<Record<string, RemoteScreen>>({});
  const inboundVideoBitrateSamplesRef = useRef<
    Map<string, { trackId: string; reportKey: string; bytesReceived: number; timestamp: number }>
  >(new Map());
  const screenQualityRef = useRef<ScreenQuality>(callMedia.screenQuality);
  const peerSessionsRef = useRef<Map<string, PeerSession>>(new Map());
  const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteGainContextsRef = useRef<
    Map<
      string,
      {
        context: AudioContext;
        gain: GainNode;
        source: MediaStreamAudioSourceNode;
        trackId: string;
        destination: MediaStreamAudioDestinationNode;
      }
    >
  >(new Map());
  const locallyMutedUsersRef = useRef<Set<string>>(new Set());
  const pushToTalkHeldRef = useRef(false);
  const isDeafenedRef = useRef(false);
  const incomingFriendIdsRef = useRef<Set<string>>(new Set());
  const socialStateInitializedRef = useRef(false);
  const friendRequestNoticeTimerRef = useRef<number | null>(null);
  const dmNoticeTimerRef = useRef<number | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
  const workspaceBackRef = useRef<WorkspaceHistoryEntry[]>([]);
  const workspaceForwardRef = useRef<WorkspaceHistoryEntry[]>([]);
  const workspaceLastRef = useRef<WorkspaceHistoryEntry | null>(null);
  const workspaceRestoringRef = useRef(false);
  const sideMouseHeldRef = useRef<number | null>(null);
  const sideMouseLastRef = useRef<{ button: number; at: number } | null>(null);

  const appendSessionRecap = (action: AppLocalRecapActionInput) => {
    const repository = localRecapRepositoryRef.current;
    const sessionId = sessionIdRef.current;
    if (!repository || !sessionId) return;
    const result = repository.append({ ...action, sessionId });
    if (result.ok) setSessionRecapActions(result.actions);
  };

  const recordSessionMessageActions = (text: string) => {
    const urls = text.match(/https:\/\/[^\s<>]+/gi) ?? [];
    for (const rawUrl of Array.from(new Set(urls)).slice(0, 8)) {
      const url = rawUrl.replace(/[),.;!?]+$/, "");
      appendSessionRecap({ kind: "shared-link", url, label: "Link shared in Hub" });
    }
  };

  useSessionKitRepository({
    currentUser,
    setQuietPresence,
    setSessionKits,
    setSessionRecapActions,
    setSquadPresets,
    setVoiceReadiness,
    sessionKitRepositoryRef,
    quietPresenceRepositoryRef,
    localRecapRepositoryRef,
    squadPresetRepositoryRef,
    sessionIdRef,
  });

  useSyncRef(activeServerRef, selectedServer);

  useSyncRef(serversRef, servers);

  useEffect(() => {
    if (showHome || showSocial || showSettings || showServerBrowser || showAdminDashboard) {
      hubPanels.setShowHubMembersPanel(false);
      hubPanels.setShowHubCalendarPanel(false);
    }
  }, [showHome, showSocial, showSettings, showServerBrowser, showAdminDashboard]);

  const desktopUpdates = useDesktopUpdates();
  const {
    desktopUpdateState,
    desktopUpdateAction,
    desktopUpdateNotice,
    handleRestartDesktopToUpdate,
    desktopInstalledVersion,
  } = desktopUpdates;

  useSyncRef(activeChannelRef, selectedChannel);

  useSyncRef(messagesRef, messages);

  useSyncRef(notificationSettingsRef, preferences.notificationSettings);

  useSyncRef(soundSettingsRef, preferences.soundSettings);

  useSyncRef(quietPresenceRef, quietPresence);

  useSyncRef(privacySettingsRef, preferences.privacySettings);

  useSyncRef(friendsRef, friends);

  const lastSyncedMutesRef = useRef<string | null>(null);
  useHubMutes({ currentUser, preferences, mutedHubIdsRef, lastSyncedMutesRef });

  useEffect(() => {
    mutedUserIdsRef.current = new Set(mutedUserIds);
    try {
      localStorage.setItem(MUTED_USERS_KEY, JSON.stringify(mutedUserIds));
    } catch {}
  }, [mutedUserIds]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setTypingUsers((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([, until]) => until > now));
        return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, []);

  useSyncRef(voiceChannelRef, voiceChannelId);

  useEffect(() => {
    voiceParticipantsRef.current = voiceParticipants;
    for (const participant of voiceParticipants) {
      const session = peerSessionsRef.current.get(participant.connectionId);
      if (session) session.participant = participant;
    }
  }, [voiceParticipants]);

  useEffect(() => {
    screenQualityRef.current = callMedia.screenQuality;

    const screen = localScreenStreamRef.current;
    const track = screen?.getVideoTracks()[0];

    if (!track) return;

    const { width, height, fps } = SCREEN_SHARE_PROFILES[callMedia.screenQuality];

    void track
      .applyConstraints({
        width: { ideal: width, max: width },
        height: { ideal: height, max: height },
        frameRate: { ideal: fps, max: fps },
      })
      .catch(() => {
        // Some capture sources cannot switch quality without restarting sharing.
      });

    for (const session of peerSessionsRef.current.values()) {
      for (const sender of session.pc.getSenders()) {
        if (sender.track?.id === track.id) {
          session.screenConfigPending = session.screenConfigPending
            .then(() => configureScreenSender(sender, session.pc))
            .catch((error) => {
              console.warn("Could not update screen sender configuration:", error);
            });
        }
      }
    }
  }, [callMedia.screenQuality]);

  useEffect(() => {
    audioSettingsRef.current = audioSettings;
    try {
      localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(audioSettings));
    } catch {
      // Local storage may be unavailable in a restricted browser context.
    }
  }, [audioSettings]);

  useEffect(() => {
    voiceUserVolumesRef.current = voiceUserVolumes;
    try {
      localStorage.setItem(VOICE_USER_VOLUMES_KEY, JSON.stringify(voiceUserVolumes));
    } catch {
      // Local storage may be unavailable in a restricted browser context.
    }
  }, [voiceUserVolumes]);

  useSyncRef(micTestActiveRef, audioSetup.micTestActive);

  useSyncRef(isMutedRef, voiceCall.isMuted);

  useEffect(() => {
    isServerMutedRef.current = voiceCall.isServerMuted;
    applyMicrophoneEnabledState();
  }, [voiceCall.isServerMuted]);

  useEffect(() => {
    isServerDeafenedRef.current = voiceCall.isServerDeafened;
    for (const session of peerSessionsRef.current.values()) session.resumeAudio();
  }, [voiceCall.isServerDeafened]);

  useSyncRef(activeDmUserRef, activeDmUser);

  useSyncRef(activeGroupChatRef, activeGroupChat);

  useSyncRef(remoteScreensRef, callMedia.remoteScreens);

  useSyncRef(remoteCamerasRef, callMedia.remoteCameras);

  useEffect(() => {
    return () => {
      if (friendRequestNoticeTimerRef.current !== null) {
        window.clearTimeout(friendRequestNoticeTimerRef.current);
      }
      if (dmNoticeTimerRef.current !== null) {
        window.clearTimeout(dmNoticeTimerRef.current);
      }
    };
  }, []);

  useTransientUiDismissal({
    showSettings,
    showAdminDashboard,
    setCustomStatusEditing,
    setCustomStatusError,
    showHome,
    hubPanels,
    selectedServer,
    showServerBrowser,
    showSquadFinder,
    setShowSquadFinder,
    setSquadMatchPopup,
    setFriendIdNotice,
    showSocial,
    socialView,
    setHubMembersPanelSearch,
    setUserContextMenu,
    setResourceContextMenu,
    setResourceContextMoreOpen,
    setShowFeedback,
  });

  useEffect(() => {
    isDeafenedRef.current = voiceCall.isDeafened;
    for (const session of peerSessionsRef.current.values()) session.resumeAudio();
    applyMicrophoneEnabledState();
  }, [voiceCall.isDeafened]);

  useEffect(() => {
    if (!currentUser) return;
    profileFields.setProfileBio(currentUser.bio ?? "");
    profileFields.setProfileStatus(currentUser.status ?? "online");
    profileFields.setProfileStatusText(currentUser.statusText ?? "");
    if (!customStatusEditing) setCustomStatusDraft(currentUser.statusText ?? "");
    profileFields.setProfileAccent(currentUser.accent ?? "#7c5cff");
    profileFields.setProfileDisplayName(currentUser.displayName ?? "");
    profileFields.setProfilePronouns(currentUser.pronouns ?? "");
  }, [
    currentUser?.id,
    currentUser?.bio,
    currentUser?.status,
    currentUser?.statusText,
    currentUser?.accent,
    currentUser?.displayName,
    currentUser?.pronouns,
    customStatusEditing,
  ]);

  useSettingsDirtyTracking({
    preferences,
    showSettings,
    settingsWindow,
    profileFields,
    audioSettings,
    settingsSnapshotRef,
    settingsHydratingRef,
  });

  usePreferencePersistence({
    preferences,
  });

  useEffect(() => {
    const userId = currentUser?.id ?? null;
    if (!userId) {
      accessibilityScaleUserRef.current = null;
      if (preferences.accessibilityTextScale !== 100) preferences.setAccessibilityTextScale(100);
      return;
    }
    if (accessibilityScaleUserRef.current !== userId) {
      accessibilityScaleUserRef.current = userId;
      preferences.setAccessibilityTextScale(loadAccessibilityTextScale(userId));
      return;
    }
    try {
      localStorage.setItem(`${ACCESSIBILITY_TEXT_SCALE_KEY}:${userId}`, String(preferences.accessibilityTextScale));
    } catch {}
  }, [currentUser?.id, preferences.accessibilityTextScale]);

  useEffect(() => {
    const readShareRoute = () => setPendingHubShareCode(hubShareCodeFromLocation());
    window.addEventListener("popstate", readShareRoute);
    return () => window.removeEventListener("popstate", readShareRoute);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    void accountActions.loadAccountPreferences();
    void accountActions.loadDesktopIntegrationSettings();
  }, [currentUser?.id]);

  useEffect(
    () => () => {
      accountEditOperationRef.current?.controller.abort();
    },
    [currentUser?.id],
  );

  useEffect(() => {
    ownerSecurity.setOwnerMfaPassword("");
    ownerSecurity.setOwnerReauthPassword("");
    ownerSecurity.setOwnerReauthCode("");
    ownerSecurity.setOwnerMfaSecret("");
    ownerSecurity.setOwnerMfaOtpAuth("");
    ownerSecurity.setOwnerReauthToken("");
    ownerSecurity.setOwnerReauthExpiresAt(0);
    ownerSecurity.setOwnerMfaBusy(false);
    ownerSecurity.setOwnerManagementBusy(false);
    ownerPrivilegedContextRef.current = null;
    return () => {
      const operation = ownerSecurityOperationRef.current;
      operation?.controller.abort();
    };
  }, [currentUser?.id, ownerSecurity.platformOwnerActive]);

  useEffect(() => {
    setDangerPassword("");
    setAccountDangerAction(null);
    return () => {
      accountDangerOperationRef.current?.controller.abort();
    };
  }, [currentUser?.id]);

  const chooseAppSkin = (skin: AppSkin) => {
    preferences.setAppSkin(skin);
    try {
      localStorage.setItem(VADRION_SKIN_KEY, skin);
    } catch {
      // Local appearance preference is optional.
    }
  };

  const { applyRemoteSettings } = createSettingsSyncActions({
    preferences,
    lastSyncedMutesRef,
    chooseAppSkin,
  });

  const currentServer = servers.find((server) => server.id === selectedServer) || servers[0] || EMPTY_SERVER;

  const currentChannel = currentServer.channels.find((channel) => channel.id === selectedChannel) ||
    currentServer.channels[0] || {
      id: 0,
      name: "no-channel",
      type: "text" as ChannelType,
    };

  const streamerHubsEnabled = streamerHubsCapability === true;
  const isStreamerHub = isStreamerServer(currentServer, streamerHubsCapability);
  const streamerOverviewActive = isStreamerHub && hubPanels.showStreamerOverview;
  const announcementAvailable = currentServer.channels.some(
    (channel) => channel.type === "text" && channel.name.trim().toLowerCase() === "announcements",
  );
  const streamerBannerPath = isStreamerHub ? streamerLocalMediaPath(currentServer.bannerUrl) : "";
  const streamerSidebarProps = streamerSidebarBinding(isStreamerHub, streamerBannerPath, streamerMediaUrl);

  useEffect(() => {
    roomChatVisibleRef.current = currentChannel.type !== "voice" || voiceCall.voiceChatOpen;
  }, [currentChannel.id, currentChannel.type, voiceCall.voiceChatOpen]);

  useEffect(() => {
    if (currentServer.id <= 0) return;
    if (isStreamerHub) {
      hubPanels.setShowHubHome(false);
      hubPanels.setShowStreamerOverview(true);
    } else {
      hubPanels.setShowStreamerOverview(false);
    }
  }, [currentServer.id, isStreamerHub]);

  const canManageCurrentServer = currentServer.myRole === "owner" || currentServer.myRole === "admin";
  // F9: custom roles with manageRooms may create/reorder/manage rooms (mirrors worker hasPermission).
  const canManageCurrentRooms =
    canManageCurrentServer ||
    Boolean(
      currentUser &&
      hubMembers
        .find((member) => member.userId === currentUser.id)
        ?.customRoles?.some((role) => role.permissions.includes("manageRooms")),
    );
  const isCurrentServerOwner = currentServer.myRole === "owner";
  const canPostInCurrentHub = currentServer.ownerOnlyPosting !== true || isCurrentServerOwner;

  const storeToken = (token: string) => {
    // WebSocket credentials are memory-only. The durable browser login session
    // is kept in a Secure HttpOnly cookie that JavaScript cannot read.
    setAuthToken(token);
  };

  const streamerTransport: StreamerTransport = {
    request: async function request<T>(path: string, init: RequestInit): Promise<T> {
      const base = new URL(HTTP_URL);
      const target = new URL(path, base);
      if (
        target.origin !== base.origin ||
        !/^\/api\/servers\/\d+\/streamer(?:\/[^/]+(?:\/[^/]+)?)?$/.test(target.pathname)
      ) {
        throw new Error("Invalid Streamer request.");
      }
      const response = await authorizedFetch(target.toString(), init);
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error =
          data && typeof data === "object" && typeof (data as Record<string, unknown>).error === "string"
            ? ((data as Record<string, unknown>).error as string)
            : "Could not load Streamer Mode.";
        throw new Error(error);
      }
      return data as T;
    },
  };

  const setCurrentUserFromResponse = (nextUser: AccountUser) => {
    setCurrentUser((current) => ({
      ...nextUser,
      // Profile endpoints predate the safety payload. Preserve the age gate
      // when one of those responses updates the local account object.
      safety: nextUser.safety ?? current?.safety,
    }));
  };

  useEffect(() => {
    if (!currentUser) {
      setBlockedUserIds([]);
      return;
    }
    void (async () => {
      try {
        const response = await authorizedFetch(`${HTTP_URL}/api/safety/blocks`);
        const data = (await response.json().catch(() => ({}))) as { blocks?: Array<{ userId?: string }> };
        if (response.ok)
          setBlockedUserIds(
            (data.blocks ?? [])
              .map((item) => item.userId)
              .filter((value): value is string => typeof value === "string"),
          );
      } catch (error) {
        console.warn("Could not load blocked users:", error);
      }
    })();
  }, [currentUser?.id]);

  const activityActions = createActivityActions({
    currentUser,
    activitySettingsRef,
    steamIntegrationRef,
    automaticActivityActiveRef,
    lastPublishedActivityRef,
    steamPollAtRef,
    steamLinkPollTimerRef,
    authorizedFetch,
    setCurrentUserFromResponse,
    gameActivity,
  });

  useSyncRef(steamIntegrationRef, gameActivity.steamIntegration);

  useEffect(() => {
    activitySettingsRef.current = preferences.activitySettings;
    try {
      localStorage.setItem(ACTIVITY_SETTINGS_KEY, JSON.stringify(preferences.activitySettings));
    } catch {}
    if (currentUser) void activityActions.runAutomaticActivityScan(true);
  }, [preferences.activitySettings, currentUser?.id]);

  useHomePersistence({
    currentUser,
    setHomeWidgets,
    setHomeNotes,
    setHomeNotesOwner,
    homeWidgets,
    homeLayoutOwner,
    setHomeLayoutOwner,
    homeQuickLinks,
    homeNotes,
    homeNotesOwner,
  });

  useGameActivityTracking({
    currentUser,
    gameActivity,
    automaticActivityActiveRef,
    lastPublishedActivityRef,
    steamLinkPollTimerRef,
    activityActions,
  });

  useAuthBootstrap({
    resetPrivateAccountState,
    setCurrentUser,
    setAuthReady,
    setTurnstileSiteKey,
    setTurnstileTestMode,
    setStreamerHubsCapability,
    storeToken,
    fetchWsToken,
  });

  useEffect(() => {
    if (turnstileTestMode) setTurnstileToken("local-test");
  }, [turnstileTestMode, authMode, turnstileNonce]);

  useEffect(() => {
    if (!currentUser) return;

    let stopped = false;

    const checkStillActive = async () => {
      try {
        const response = await fetch(`${HTTP_URL}/api/auth/me`, {
          credentials: "include",
          cache: "no-store",
        });

        if (response.status === 401 && !stopped) {
          await logout();
          if (!stopped) {
            setAuthError("Your DeCave account was signed in on another browser or desktop app.");
          }
        }
      } catch {
        // Temporary network errors should not sign the user out.
      }
    };

    const timer = window.setInterval(() => {
      void checkStillActive();
    }, 2500);

    void checkStillActive();

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) {
      setHubOnboardingSkipped(false);
      return;
    }
    try {
      setHubOnboardingSkipped(localStorage.getItem(`decave_hub_onboarding_skipped:${currentUser.id}`) === "1");
    } catch {
      setHubOnboardingSkipped(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) {
      ownerSecurity.setPlatformOwnerActive(false);
      return;
    }
    void adminActions.loadOwnerSecurityStatus();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!showSettings) {
      ownerSecurity.setOwnerReauthToken("");
      ownerSecurity.setOwnerReauthExpiresAt(0);
      ownerSecurity.setOwnerReauthPassword("");
      ownerSecurity.setOwnerReauthCode("");
      return;
    }
    void adminActions.loadOwnerSecurityStatus();
    void accountActions.loadAccountSessions();
  }, [showSettings]);

  const profileMediaActions = createProfileMediaActions({
    setProfileAvatarError,
    authorizedFetch,
    setCurrentUserFromResponse,
    profileMedia,
  });

  // Output volume changed in Settings → Voice: re-apply to everyone playing now.
  useEffect(() => {
    for (const participant of voiceParticipantsRef.current) applyVoiceUserVolume(participant);
  }, [preferences.extraSettings.outputVolume]);

  // Hub events API (GET /events per Hub, range based) + HUB_EVENTS_CHANGED refresh.
  const hubEventsScopeKey = `${accountSessionSnapshot.generation}|${currentUser?.id ?? ""}|${servers
    .map((server) => `${server.id}:${server.myRole ?? ""}`)
    .sort()
    .join(",")}`;
  const hubEventsScopeRef = useRef(hubEventsScopeKey);
  hubEventsScopeRef.current = hubEventsScopeKey;
  const hubEventsApi = useMemo(
    () => ({
      baseUrl: HTTP_URL,
      authorizedFetch: (url: string, init?: RequestInit) => authorizedFetch(url, init),
      sessionGuard: accountSessionGuardRef.current,
      sessionSnapshot: accountSessionSnapshot,
      scopeKey: hubEventsScopeKey,
      isScopeCurrent: () => hubEventsScopeRef.current === hubEventsScopeKey,
    }),
    [hubEventsScopeKey, accountSessionSnapshot.accountKey, accountSessionSnapshot.generation],
  );
  const hubEvents = useHubEvents(hubEventsApi);

  const { upsertHomeCalendarEvent, removeHomeCalendarMessage, syncHomeCalendar } = createHomeCalendarActions({
    authToken,
    setHomeCalendarEvents,
    setHomeCalendarBusy,
    setHomeCalendarNotice,
    homeCalendarSyncRef,
    servers,
    hubEvents,
  });
  const [eventDrawerItem, setEventDrawerItem] = useState<CalendarItem | null>(null);
  const [eventComposerSeed, setEventComposerSeed] = useState<EventComposerSeed>({});
  const [eventComposerHubId, setEventComposerHubId] = useState(0);

  useEffect(() => {
    const channel = currentServer.channels.find((item) => item.id === currentChannel.id);
    if (!channel || !messages.length) return;
    for (const message of messages) {
      const event = homeCalendarEventForMessage(
        message.id,
        message.text,
        currentServer,
        channel,
        message.timestamp,
        message.username,
      );
      if (event) upsertHomeCalendarEvent(event);
    }
  }, [messages, currentServer.id, currentChannel.id]);

  useEffect(() => {
    if (showHome && servers.length) void syncHomeCalendar();
  }, [showHome, authToken, servers]);

  const openServerBrowser = () => {
    closePrimaryTransientOverlays();
    setShowHome(false);
    setShowSocial(false);
    setShowSettings(false);
    setShowAdminDashboard(false);
    setDiscoverSearch("");
    setDiscoverError("");
    setShowServerBrowser(true);
    void loadDiscoverServers();
  };

  useEffect(() => {
    let cancelled = false;

    if (!currentUser || !authToken) {
      setServersReady(false);
      return () => {
        cancelled = true;
      };
    }

    setServersReady(false);
    void loadServers().finally(() => {
      if (!cancelled) setServersReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, authToken]);

  const { loadOlderHistory, loadMessages } = createMessageHistoryActions({
    authToken,
    messages,
    setMessages,
    groupMessages,
    setGroupMessages,
    dmMessages,
    setDmMessages,
    messageLoadGenerationRef,
    activeChannelRef,
    setOlderHistory,
    olderHistoryBusy,
    setOlderHistoryBusy,
    prependingHistoryRef,
    activeDmUserRef,
    activeGroupChatRef,
    authorizedFetch,
    composer,
  });

  const friendActions = createFriendActions({
    authToken,
    currentUser,
    setFriends,
    friends,
    setIncomingFriendRequests,
    incomingFriendRequests,
    setOutgoingFriendRequests,
    outgoingFriendRequests,
    friendIdInput,
    setFriendIdInput,
    setFriendIdNotice,
    friendRequestSentToRef,
    setFriendIdBusy,
    setActiveDmUser,
    setDmMessages,
    setDmError,
    setFriendRequestNotice,
    notificationSettingsRef,
    activeDmUserRef,
    incomingFriendIdsRef,
    socialStateInitializedRef,
    friendRequestNoticeTimerRef,
    desktopNotify,
    authorizedFetch,
  });

  const askToRemoveFriend = (user: SocialUser) => {
    setUserContextMenu(null);
    setFriendRemovalConfirm(user);
  };

  const confirmFriendRemoval = async () => {
    const user = friendRemovalConfirm;
    if (!user) return;
    setFriendRemovalConfirm(null);
    await friendActions.socialAction(user.id, "remove");
  };

  const openDirectMessage = async (user: SocialUser) => {
    const loadGeneration = ++dmHistoryLoadGenerationRef.current;
    const previousDm = activeDmUserRef.current;
    if (previousDm && previousDm.id !== user.id) {
      setDmDrafts((current) => ({ ...current, [previousDm.id]: dmInput }));
    }
    setDmHeaderMenuOpen(false);
    setShowHome(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setShowSocial(true);
    setSocialView("dm");
    setActiveGroupChat(null);
    activeGroupChatRef.current = null;
    setGroupMessages([]);
    setGroupReplyingTo(null);
    setActiveDmUser(user);
    activeDmUserRef.current = user;
    setDmInput(dmDrafts[user.id] ?? "");
    setDmReplyingTo(null);
    setDmError("");
    setDmEditingId(null);
    setDmEditingText("");
    setDmDeleteConfirm(null);
    setDmConversationDeleteConfirm(null);
    setReactionPickerMessageId(null);
    setDmUnread((current) => ({ ...current, [user.id]: 0 }));
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/dms/${encodeURIComponent(user.id)}`);
      const data = (await response.json().catch(() => ({}))) as { messages?: DirectMessage[] } & ApiError;
      if (loadGeneration !== dmHistoryLoadGenerationRef.current || activeDmUserRef.current?.id !== user.id) return;
      if (!response.ok) {
        setDmMessages([]);
        setDmError(data.error || "Could not open private messages.");
        return;
      }
      const firstDmPage = Array.isArray(data.messages) ? data.messages : [];
      setDmMessages(firstDmPage);
      setOlderHistory((current) => ({ ...current, dm: firstDmPage.length >= HISTORY_PAGE_SIZE }));
      void directMessages.loadDmConversations();
    } catch (error) {
      if (loadGeneration !== dmHistoryLoadGenerationRef.current || activeDmUserRef.current?.id !== user.id) return;
      console.error("Could not load private messages:", error);
      setDmMessages([]);
      setDmError("Could not load private messages.");
    }
  };
  openDirectMessageRef.current = openDirectMessage;

  const canModerateTarget = (targetRole?: ServerRole | null) => {
    if (currentServer.myRole === "owner") return targetRole === "admin" || targetRole === "member";
    if (currentServer.myRole === "admin") return targetRole === "member";
    return false;
  };

  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) => {
      if (!audioSettingsRef.current.pushToTalk || event.code !== audioSettingsRef.current.pushToTalkKey || event.repeat)
        return;
      pushToTalkHeldRef.current = true;
      applyMicrophoneEnabledState();
    };
    const up = (event: globalThis.KeyboardEvent) => {
      if (!audioSettingsRef.current.pushToTalk || event.code !== audioSettingsRef.current.pushToTalkKey) return;
      pushToTalkHeldRef.current = false;
      applyMicrophoneEnabledState();
    };
    const release = () => {
      pushToTalkHeldRef.current = false;
      applyMicrophoneEnabledState();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    applyMicrophoneEnabledState();
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [
    audioSettings.pushToTalk,
    audioSettings.pushToTalkKey,
    voiceCall.isMuted,
    voiceCall.isServerMuted,
    voiceChannelId,
  ]);

  useRtcStatsPolling({
    setRtcStats: voiceCall.setRtcStats,
    voiceChannelId,
    remoteScreensRef,
    remoteCamerasRef,
    inboundVideoBitrateSamplesRef,
    peerSessionsRef,
  });

  const toggleLocalMuteUser = (participant: VoiceParticipant) => {
    const muted = locallyMutedUsersRef.current.has(participant.userId);
    if (muted) locallyMutedUsersRef.current.delete(participant.userId);
    else locallyMutedUsersRef.current.add(participant.userId);
    const audio = remoteAudioElementsRef.current.get(participant.connectionId);
    if (audio) audio.muted = !muted || isDeafenedRef.current || isServerDeafenedRef.current;
    const amplified = remoteGainContextsRef.current.get(participant.connectionId);
    if (amplified) amplified.gain.gain.value = !muted ? 0 : getVoiceUserVolume(participant.userId) / 100;
    setSpeakingConnections((current) => ({ ...current }));
  };

  const isParticipantSpeaking = (participant: VoiceParticipant): boolean =>
    !!speakingConnections[participant.connectionId] && !participant.muted;

  useSpeakingDetection({
    setSpeakingConnections,
    voiceChannelId,
    selfConnectionIdRef,
    voiceParticipantsRef,
    voiceActivationNodeRef,
    autoSensitivityDbRef,
    micLevelDbRef,
    micVoiceActivationAudibleRef,
    voiceActivationMetricsRef,
    audioSettingsRef,
    isMutedRef,
    isServerMutedRef,
    isServerDeafenedRef,
    peerSessionsRef,
    pushToTalkHeldRef,
    isDeafenedRef,
  });

  const sendSocket = (payload: unknown): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (myUserIdRef.current && realtimeReconnectEnabledRef.current) {
        setConnectionStatus("Reconnecting...");
        reconnectNowRef.current();
      }
      return false;
    }

    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      try {
        socket.close(4000, "Realtime send failed");
      } catch {}
      if (myUserIdRef.current && realtimeReconnectEnabledRef.current) {
        setConnectionStatus("Reconnecting...");
        reconnectNowRef.current();
      }
      return false;
    }
  };

  const directMessages = createDirectMessageActions({
    currentUser,
    setShowSettings,
    setShowAdminDashboard,
    setShowHome,
    setReactionPickerMessageId,
    setShowServerBrowser,
    setShowSocial,
    setSocialView,
    setActiveDmUser,
    setDmConversations,
    setDmPreferences,
    dmPreferences,
    setDmHeaderMenuOpen,
    setGroupChats,
    setActiveGroupChat,
    setGroupMessages,
    setGroupInput,
    groupInput,
    setGroupReplyingTo,
    groupReplyingTo,
    setGroupError,
    setShowNewConversation,
    setShowGroupMembers,
    setDmMessages,
    dmInput,
    setDmInput,
    setDmDrafts,
    setDmReplyingTo,
    dmReplyingTo,
    dmAttachmentBusy,
    setDmAttachmentBusy,
    setDmAttachmentRetryName,
    setDmError,
    setDmEditingId,
    dmEditingId,
    setDmEditingText,
    dmEditingText,
    setShowDmPlusMenu,
    dmDeleteConfirm,
    setDmDeleteConfirm,
    dmConversationDeleteConfirm,
    setDmConversationDeleteConfirm,
    setOlderHistory,
    dmAttachmentInputRef,
    dmAttachmentAbortRef,
    dmAttachmentRetryFileRef,
    activeDmUserRef,
    activeGroupChatRef,
    groupHistoryLoadGenerationRef,
    playUiSound,
    authorizedFetch,
    loadServers,
    loadSocialState: friendActions.loadSocialState,
    sendSocket,
    newConversation,
  });

  useEffect(() => {
    if (voiceChannelId === null) {
      microphoneMutedSinceRef.current = null;
      return;
    }
    const checkMicrophoneHealth = () => {
      const context = audioContextRef.current;
      if (context?.state === "suspended") {
        void context.resume().catch(() => requestMicrophoneRecoveryRef.current("audio context stayed suspended"));
      } else if (context?.state === "closed") {
        requestMicrophoneRecoveryRef.current("audio context closed");
      }
      const rawTrack = rawMicStreamRef.current?.getAudioTracks()[0];
      const processedTrack = localMicStreamRef.current?.getAudioTracks()[0];
      if (!rawTrack || rawTrack.readyState === "ended" || !processedTrack || processedTrack.readyState === "ended") {
        requestMicrophoneRecoveryRef.current("microphone track is unavailable");
        return;
      }
      if (rawTrack.muted) {
        const mutedSince = microphoneMutedSinceRef.current ?? Date.now();
        microphoneMutedSinceRef.current = mutedSince;
        if (Date.now() - mutedSince >= 4_000) requestMicrophoneRecoveryRef.current("microphone source remained muted");
      } else microphoneMutedSinceRef.current = null;
      applyMicrophoneEnabledState();
      for (const session of peerSessionsRef.current.values()) {
        if (session.microphoneSender?.track?.id !== processedTrack.id) {
          void replaceMicrophoneTrackForPeers(micTrackIdRef.current, processedTrack, localMicStreamRef.current!);
          break;
        }
      }
    };
    checkMicrophoneHealth();
    const timer = window.setInterval(checkMicrophoneHealth, 2_000);
    return () => window.clearInterval(timer);
  }, [voiceChannelId]);

  useEffect(() => {
    if (!showSettings || settingsWindow.settingsTab !== "voice") return;
    let cancelled = false;
    audioSetup.setMicrophoneCaptureState(localMicStreamRef.current ? "ready" : "starting");
    audioSetup.setAudioSettingsError("");

    void (async () => {
      try {
        await refreshAudioDevices();
        if (!localMicStreamRef.current) {
          await buildMicrophonePipeline(audioSettingsRef.current);
        }
        if (
          cancelled &&
          voiceChannelRef.current === null &&
          !micTestActiveRef.current &&
          directMicrophoneLeaseCountRef.current === 0
        ) {
          stopMicrophonePipeline();
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Could not start the Voice & Audio microphone preview:", error);
        audioSetup.setMicrophoneCaptureState("error");
        audioSetup.setAudioSettingsError(microphoneErrorMessage(error));
      }
    })();

    return () => {
      cancelled = true;
      if (
        voiceChannelRef.current === null &&
        !micTestActiveRef.current &&
        directMicrophoneLeaseCountRef.current === 0
      ) {
        stopMicrophonePipeline();
      }
    };
  }, [showSettings, settingsWindow.settingsTab]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      void refreshAudioDevices();
      const selectedInput = audioSettingsRef.current.inputDeviceId;
      void mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (
            selectedInput &&
            !devices.some((device) => device.kind === "audioinput" && device.deviceId === selectedInput)
          ) {
            audioSetup.setAudioSettingsError(
              "Your selected microphone is no longer available. Choose another input device.",
            );
            audioSetup.setMicrophoneCaptureState("error");
            requestMicrophoneRecoveryRef.current("selected microphone was disconnected");
          }
          const selectedOutput = audioSettingsRef.current.outputDeviceId;
          if (
            selectedOutput &&
            !devices.some((device) => device.kind === "audiooutput" && device.deviceId === selectedOutput)
          ) {
            audioSetup.setAudioOutputError(
              "Your selected output is no longer available. Using the system default output.",
            );
            void applyOutputDevice("");
            const next = { ...audioSettingsRef.current, outputDeviceId: "" };
            audioSettingsRef.current = next;
            setAudioSettings(next);
          }
        })
        .catch(() => undefined);
    };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, []);

  const captureSettingsSnapshot = (): SettingsSnapshot => ({
    profileBio: profileFields.profileBio,
    profileStatus: profileFields.profileStatus,
    profileStatusText: profileFields.profileStatusText,
    profileAccent: profileFields.profileAccent,
    profileDisplayName: profileFields.profileDisplayName,
    profilePronouns: profileFields.profilePronouns,
    appSkin: preferences.appSkin,
    extraSettings: { ...preferences.extraSettings, quietHours: { ...preferences.extraSettings.quietHours } },
    notificationPreset: preferences.notificationPreset,
    notificationSettings: { ...preferences.notificationSettings },
    soundSettings: { ...preferences.soundSettings },
    privacySettings: { ...preferences.privacySettings },
    accessibilityTextScale: preferences.accessibilityTextScale,
    audioSettings: { ...audioSettingsRef.current },
    activitySettings: {
      ...preferences.activitySettings,
      excludedGames: [...preferences.activitySettings.excludedGames],
    },
    language: preferences.accountPreferences.language,
    timeFormat: preferences.accountPreferences.timeFormat,
    loginAlerts: preferences.accountPreferences.loginAlerts,
    activityVisibility: preferences.accountPreferences.activityVisibility,
    notifyLevels: preferences.notifyLevels,
    desktopSystemSettings: { ...preferences.desktopSystemSettings },
    desktopKeybinds: { ...preferences.desktopKeybinds },
  });

  useEffect(() => {
    if (!showSettings || !settingsHydratingRef.current) return;
    settingsSnapshotRef.current = captureSettingsSnapshot();
    settingsHydratingRef.current = false;
    settingsWindow.setSettingsDirty(false);
  }, [settingsHydrationVersion, showSettings]);

  const closePrimaryTransientOverlays = () => {
    setShowFeedback(false);
    setShowSquadFinder(false);
    setSquadMatchPopup(null);
    hubPanels.setShowHubHome(false);
    hubPanels.setShowStreamerOverview(false);
  };

  const adminActions = createAdminActions({
    currentUser,
    setCurrentUser,
    setAuthReady,
    setAuthMode,
    setTurnstileToken,
    setTurnstileNonce,
    setAuthError,
    setShowSettings,
    accountEditAccountIdRef,
    ownerSecurityRoleRef,
    ownerSecurityOperationRef,
    ownerLoginChallengeToken,
    setOwnerLoginChallengeToken,
    ownerLoginMfaCode,
    setOwnerLoginMfaCode,
    setOwnerLoginMfaBusy,
    setShowAdminDashboard,
    setAdminDashboardTab,
    setShowHome,
    setShowServerBrowser,
    setShowSocial,
    ownerPrivilegedContextRef,
    storeToken,
    authorizedFetch,
    closePrimaryTransientOverlays,
    adminDashboard,
    ownerSecurity,
    authForm,
  });

  const beginCustomStatusEdit = () => {
    setCustomStatusDraft(currentUser?.statusText ?? "");
    setCustomStatusError("");
    setCustomStatusEditing(true);
  };

  const keepSettingsChangesAndClose = async () => {
    const saved = await settingsActions.saveAllSettings();
    if (saved) settingsActions.finishCloseSettings();
  };

  const saveSettingsChanges = async () => {
    await settingsActions.saveAllSettings();
  };

  const closeSettings = () => {
    if (settingsWindow.settingsDirty) {
      settingsWindow.setSettingsCloseConfirm(true);
      return;
    }
    settingsActions.finishCloseSettings();
  };

  useCloseMenusOnOutsidePointer({
    setCustomStatusEditing,
    setCustomStatusError,
    setShowEmojiPicker,
    setReactionPickerMessageId,
    setReactionPickerPosition,
    setHubMemberMenuId,
    setFriendActionsUserId,
    setShowDmPlusMenu,
    setShowDmEmojiPicker,
    setShowGroupEmojiPicker,
    setGifPickerTarget,
    setUserContextMenu,
    hubPanels,
    composer,
    forumRoomUi,
    callMedia,
  });

  useGlobalShortcuts({
    setShowCommandPalette,
    setCommandPaletteQuery,
    setCommandPaletteIndex,
    setShowInbox,
  });

  useEscapeKey({
    showSettings,
    showCommandPalette,
    setShowCommandPalette,
    showInbox,
    setShowInbox,
    showLogoutConfirm,
    setShowLogoutConfirm,
    showAdminDashboard,
    setShowAdminDashboard,
    reportTarget,
    setReportTarget,
    showMyReports,
    setShowMyReports,
    setCustomStatusEditing,
    setCustomStatusError,
    showEmojiPicker,
    setShowEmojiPicker,
    reactionPickerMessageId,
    setReactionPickerMessageId,
    setReactionPickerPosition,
    showCreateServer,
    setShowCreateServer,
    showServerBrowser,
    setShowServerBrowser,
    showCreateChannel,
    setShowCreateChannel,
    showManageServer,
    setShowManageServer,
    hubMemberMenuId,
    setHubMemberMenuId,
    showSocial,
    setShowSocial,
    groupReplyingTo,
    setGroupReplyingTo,
    dmReplyingTo,
    setDmReplyingTo,
    showPollComposer,
    setShowPollComposer,
    showDmPlusMenu,
    setShowDmPlusMenu,
    showDmEmojiPicker,
    setShowDmEmojiPicker,
    showGroupEmojiPicker,
    setShowGroupEmojiPicker,
    gifPickerTarget,
    setGifPickerTarget,
    showEventComposer,
    setShowEventComposer,
    userContextMenu,
    setUserContextMenu,
    resourceContextMenu,
    setResourceContextMenu,
    resourceContextMoreOpen,
    setResourceContextMoreOpen,
    friendRemovalConfirm,
    setFriendRemovalConfirm,
    showManageChannel,
    setShowManageChannel,
    focusedVideo,
    setFocusedVideo,
    closeSettings,
    settingsWindow,
    hubPanels,
    composer,
    forumRoomUi,
    callMedia,
  });

  const loadIceServers = async (): Promise<RTCIceServer[]> => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/rtc/ice-servers`);
      if (!response.ok) throw new Error("Could not load the approved ICE configuration.");
      const data = (await response.json()) as { iceServers?: RTCIceServer[]; error?: string };
      if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
        throw new Error(data.error || "No approved ICE configuration is available.");
      }
      iceServersRef.current = data.iceServers;
      return data.iceServers;
    } catch (error) {
      console.warn("Could not load approved ICE configuration.", error);
      throw error;
    }
  };

  const [voiceEngine] = useState(() =>
    createVoiceEngine({
      extraSettingsRef,
      setSoundboardNotice: voiceCall.setSoundboardNotice,
      myUserIdRef,
      setUserContextMenu,
      setVoiceParticipants,
      setVoiceChannelId,
      setVoiceStatus: voiceCall.setVoiceStatus,
      setVoiceError: voiceCall.setVoiceError,
      setIsServerMuted: voiceCall.setIsServerMuted,
      setIsServerDeafened: voiceCall.setIsServerDeafened,
      setIsScreenSharing: callMedia.setIsScreenSharing,
      setIsCameraOn: callMedia.setIsCameraOn,
      setLocalScreenStream: callMedia.setLocalScreenStream,
      setLocalCameraStream: callMedia.setLocalCameraStream,
      setRemoteScreens: callMedia.setRemoteScreens,
      setScreenAudioMuted: callMedia.setScreenAudioMuted,
      setRemoteCameras: callMedia.setRemoteCameras,
      setAudioSettings,
      setVoiceUserVolumes,
      setAudioInputs: audioSetup.setAudioInputs,
      setAudioOutputs: audioSetup.setAudioOutputs,
      setMicLevelDb: audioSetup.setMicLevelDb,
      setAutoSensitivityDb: audioSetup.setAutoSensitivityDb,
      setMicTestActive: audioSetup.setMicTestActive,
      setMicrophoneCaptureState: audioSetup.setMicrophoneCaptureState,
      setMicrophoneCaptureLabel: audioSetup.setMicrophoneCaptureLabel,
      setAudioSettingsError: audioSetup.setAudioSettingsError,
      setAudioSettingsNotice: audioSetup.setAudioSettingsNotice,
      setAudioOutputError: audioSetup.setAudioOutputError,
      setVoiceActivationMetrics: audioSetup.setVoiceActivationMetrics,
      setActiveNoiseSuppressionMode,
      socketRef,
      voiceReconnectChannelRef,
      voiceServerIdRef,
      voiceJoinAttemptRef,
      voiceJoinStartedAtRef,
      activeServerRef,
      serversRef,
      selfConnectionIdRef,
      voiceChannelRef,
      voiceParticipantsRef,
      localMicStreamRef,
      rawMicStreamRef,
      directMicrophoneLeaseCountRef,
      audioContextRef,
      clearVoiceNodeRef,
      inputGainNodeRef,
      voiceActivationNodeRef,
      autoSensitivityDbRef,
      micLevelDbRef,
      micVoiceActivationAudibleRef,
      voiceActivationMetricsRef,
      micTrackIdRef,
      microphoneBuildSerialRef,
      microphoneMutedSinceRef,
      requestMicrophoneRecoveryRef,
      requestAiNoiseFallbackRef,
      micTestAudioRef,
      micTestActiveRef,
      audioSettingsRef,
      voiceUserVolumesRef,
      isMutedRef,
      isServerMutedRef,
      isServerDeafenedRef,
      localScreenStreamRef,
      localCameraStreamRef,
      screenQualityRef,
      peerSessionsRef,
      remoteAudioElementsRef,
      remoteGainContextsRef,
      locallyMutedUsersRef,
      pushToTalkHeldRef,
      isDeafenedRef,
      iceServersRef,
      sendSocket,
      loadIceServers,
    }),
  );
  const {
    applyMicrophoneEnabledState,
    resetVoiceUserVolumes,
    getVoiceUserVolume,
    applyVoiceUserVolume,
    changeVoiceUserVolume,
    moderateVoiceUser,
    setScreenPlaybackMuted,
    saveAudioSettings,
    refreshAudioDevices,
    setAudioSink,
    stopMicrophonePipeline,
    replaceMicrophoneTrackForPeers,
    buildMicrophonePipeline,
    acquireDirectCallMicrophone,
    rebuildMicrophoneIfActive,
    startMicTest,
    stopMicTest,
    upsertVoiceParticipant,
    closePeer,
    configureScreenSender,
    addLocalTracksToPeer,
    ensurePeer,
    ensureVoicePeersFromState,
    handleRtcDescription,
    handleRtcCandidate,
    cancelVoiceJoinAttempt,
    finishVoiceJoinAttempt,
    acceptsVoiceJoinAcknowledgement,
    cleanupVoiceLocal,
    joinVoiceChannel,
    leaveVoice,
    playSoundboardSound,
    popOutStream,
    stopCamera,
    rejoinVoiceAfterRealtimeReconnect,
  } = voiceEngine;

  const { applyOutputDevice, cycleNoiseSuppression, changeInputVolume } = createAudioDeviceActions({
    activeNoiseSuppressionMode,
    audioContextRef,
    inputGainNodeRef,
    micTestAudioRef,
    audioSettingsRef,
    remoteAudioElementsRef,
    setAudioSink,
    rebuildMicrophoneIfActive,
    saveAudioSettings,
  });

  const { submitAuth, logout, logoutAllSessions } = createAuthActions({
    resetPrivateAccountState,
    setCurrentUser,
    setAuthReady,
    setServersReady,
    authMode,
    setAuthMode,
    turnstileToken,
    setTurnstileToken,
    setTurnstileNonce,
    setAuthError,
    setShowLogoutConfirm,
    setSecurityNotice,
    setSecurityBusy,
    setDangerPassword,
    setAccountDangerAction,
    accountDangerOperationRef,
    setOwnerLoginChallengeToken,
    setOwnerLoginMfaCode,
    setOwnerLoginMfaBusy,
    setServers,
    setMessages,
    setOnlineUsers,
    setFriends,
    setIncomingFriendRequests,
    setOutgoingFriendRequests,
    setShowSocial,
    setActiveDmUser,
    setDmConversations,
    setDmMessages,
    setDmUnread,
    setFriendRequestNotice,
    setDmNotice,
    setFriendRemovalConfirm,
    socketRef,
    realtimeReconnectEnabledRef,
    voiceReconnectChannelRef,
    voiceChannelRef,
    storeToken,
    authorizedFetch,
    sendSocket,
    cancelOwnerSecurityOperation: adminActions.cancelOwnerSecurityOperation,
    cleanupVoiceLocal,
    authForm,
    ownerSecurity,
    hubPanels,
  });

  const accountActions = createAccountActions({
    currentUser,
    setCurrentUser,
    setServersReady,
    setAuthMode,
    setAuthError,
    setShowSettings,
    setProfileAvatarError,
    setSecurityNotice,
    setSecurityBusy,
    setAccountEditField,
    accountEditField,
    accountEditOperationRef,
    accountEditAccountIdRef,
    setDangerPassword,
    dangerPassword,
    setAccountDangerAction,
    accountDangerAction,
    accountDangerOperationRef,
    setDeleteOwnershipBlock,
    setOwnerLoginChallengeToken,
    setOwnerLoginMfaCode,
    autoStreamerActive,
    setServers,
    servers,
    setMessages,
    setOnlineUsers,
    setFriends,
    setIncomingFriendRequests,
    setOutgoingFriendRequests,
    setShowSocial,
    setActiveDmUser,
    setDmConversations,
    setDmMessages,
    setDmUnread,
    setFriendRequestNotice,
    setDmNotice,
    setFriendRemovalConfirm,
    socketRef,
    realtimeReconnectEnabledRef,
    voiceReconnectChannelRef,
    voiceChannelRef,
    applyRemoteSettings,
    storeToken,
    authorizedFetch,
    setCurrentUserFromResponse,
    logout,
    sendSocket,
    cleanupVoiceLocal,
    accountEdit,
    accountSessions,
    settingsWindow,
    preferences,
    ownerSecurity,
  });

  const pageNavigation = createPageNavigation({
    setShowSettings,
    setSettingsHydrationVersion,
    setShowAdminDashboard,
    setShowHome,
    setShowServerBrowser,
    setShowSquadFinder,
    setSquadNotice,
    setShowSocial,
    setSocialView,
    setActiveDmUser,
    setActiveGroupChat,
    setGroupMessages,
    setFriendRequestNotice,
    setDmNotice,
    settingsSnapshotRef,
    settingsHydratingRef,
    activeDmUserRef,
    activeGroupChatRef,
    refreshActivityState: activityActions.refreshActivityState,
    refreshSteamIntegration: activityActions.refreshSteamIntegration,
    loadSquadMatches: squadSearch.loadSquadMatches,
    loadSquadGames: squadSearch.loadSquadGames,
    loadSocialState: friendActions.loadSocialState,
    loadDmConversations: directMessages.loadDmConversations,
    loadGroupChats: directMessages.loadGroupChats,
    captureSettingsSnapshot,
    closePrimaryTransientOverlays,
    refreshAudioDevices,
    loadAccountPreferences: accountActions.loadAccountPreferences,
    loadDesktopIntegrationSettings: accountActions.loadDesktopIntegrationSettings,
    settingsWindow,
    audioSetup,
    hubPanels,
  });

  const settingsActions = createSettingsActions({
    currentUser,
    setShowSettings,
    setProfileAvatarError,
    setCustomStatusEditing,
    customStatusDraft,
    customStatusSaving,
    setCustomStatusSaving,
    setCustomStatusError,
    mutedUserIds,
    setMutedUserIds,
    setAudioSettings,
    localMicStreamRef,
    micTestActiveRef,
    settingsSnapshotRef,
    settingsHydratingRef,
    audioSettingsRef,
    chooseAppSkin,
    authorizedFetch,
    setCurrentUserFromResponse,
    captureSettingsSnapshot,
    stopMicTest,
    saveAudioSettings,
    rebuildMicrophoneIfActive,
    saveRemoteAccountPreferences: accountActions.saveRemoteAccountPreferences,
    settingsWindow,
    profileFields,
    preferences,
    audioSetup,
  });

  const joinVoice = async () => {
    if (currentChannel.type === "voice") await joinVoiceChannel(currentChannel.id);
  };

  // Voice lobby: apply "join muted" / "turn on camera" once the join is acknowledged.
  useEffect(() => {
    const pending = lobbyPendingJoinRef.current;
    if (!pending) return;
    if (voiceCall.voiceStatus === "Disconnected" && voiceChannelId === null && voiceJoinAttemptRef.current === null) {
      lobbyPendingJoinRef.current = null;
      return;
    }
    if (voiceChannelId !== pending.channelId || voiceCall.voiceStatus !== "Connected") return;
    lobbyPendingJoinRef.current = null;
    if (pending.muted && !isMutedRef.current) voiceControls.toggleMute();
    if (pending.camera) void voiceControls.startCamera();
  }, [voiceChannelId, voiceCall.voiceStatus]);

  useEffect(() => {
    const onShortcut = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "toggleMute") voiceControls.toggleMute();
      if (action === "toggleDeafen") voiceControls.toggleDeafen();
    };
    document.addEventListener("decave-desktop-voice-shortcut", onShortcut as EventListener);
    return () => document.removeEventListener("decave-desktop-voice-shortcut", onShortcut as EventListener);
  }, [voiceCall.isMuted, voiceCall.isDeafened]);

  useEffect(() => {
    if (!hasDesktopActivityBridge()) return;
    void setDesktopStreamerMode(effectiveStreamerMode).catch(() => undefined);
  }, [effectiveStreamerMode]);

  // Auto Streamer mode: ask the desktop app every 20 s which streaming apps
  // are running. Desktop builds without getCaptureApps simply never match.
  useCaptureAppsWatch({
    currentUser,
    setCaptureApps,
    preferences,
  });

  const autoStreamerWasActiveRef = useRef(false);
  useEffect(() => {
    const was = autoStreamerWasActiveRef.current;
    autoStreamerWasActiveRef.current = autoStreamerActive;
    if (preferences.privacySettings.streamerMode || was === autoStreamerActive) return;
    setStreamerToast(
      autoStreamerActive
        ? `Streamer mode is on while ${captureApps[0] ?? "your streaming app"} is running.`
        : "Your streaming app closed, so Streamer mode is off again.",
    );
  }, [autoStreamerActive]);

  useEffect(() => {
    if (!streamerToast) return;
    const timer = window.setTimeout(() => setStreamerToast(""), 6000);
    return () => window.clearTimeout(timer);
  }, [streamerToast]);

  useEffect(() => {
    if (!hasDesktopActivityBridge()) return;
    const participants = voiceParticipants
      .filter((participant) => voiceChannelId !== null && participant.channelId === voiceChannelId)
      .map((participant) => ({
        connectionId: participant.connectionId,
        username: participant.username,
        avatarUrl: participant.avatarUrl,
        speaking: isParticipantSpeaking(participant),
        muted: participant.muted === true,
        deafened:
          participant.deafened === true || participant.selfDeafened === true || participant.serverDeafened === true,
      }));
    const voiceRoomName =
      voiceChannelId === null
        ? ""
        : (servers.flatMap((server) => server.channels).find((channel) => channel.id === voiceChannelId)?.name ?? "");
    void setDesktopVoiceOverlayState({
      enabled: preferences.desktopSystemSettings.voiceOverlayEnabled,
      connected: voiceChannelId !== null,
      roomName: voiceRoomName,
      participants,
    }).catch(() => undefined);
  }, [
    voiceParticipants,
    speakingConnections,
    voiceChannelId,
    preferences.desktopSystemSettings.voiceOverlayEnabled,
    servers,
  ]);

  useEffect(() => {
    if (voiceChannelId !== null) void voiceControls.loadSoundboardSounds();
  }, [voiceChannelId, currentUser?.id, currentServer.id]);

  useEffect(() => {
    const active = new Set(Object.keys(callMedia.remoteScreens));
    callMedia.setWatchedScreenConnections((current) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [connectionId, watched] of Object.entries(current)) {
        if (active.has(connectionId)) next[connectionId] = watched;
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [callMedia.remoteScreens]);

  const voiceControls = createVoiceControlActions({
    currentUser,
    extraSettingsRef,
    voiceChannelRef,
    privacySettingsRef,
    isMutedRef,
    localScreenStreamRef,
    localCameraStreamRef,
    cameraStartInFlightRef,
    screenShareInFlightRef,
    screenQualityRef,
    peerSessionsRef,
    isDeafenedRef,
    playUiSound,
    currentServer,
    authorizedFetch,
    sendSocket,
    applyMicrophoneEnabledState,
    addLocalTracksToPeer,
    stopCamera,
    soundboard,
    cameraShareOptions,
    voiceCall,
    callMedia,
  });

  // The socket outlives renders, so its handlers use the latest committed
  // render's state and functions through this ref.
  const realtimeAppRef = useRef<RealtimeAppHandlers | null>(null);

  useRealtimeConnection({
    authToken,
    currentUser,
    setCurrentUser,
    setAuthError,
    setConnectionStatus,
    socketRef,
    reconnectNowRef,
    realtimeReconnectEnabledRef,
    reconnectAttemptRef,
    activeServerRef,
    activeChannelRef,
    voiceChannelRef,
    audioContextRef,
    peerSessionsRef,
    remoteAudioElementsRef,
    remoteGainContextsRef,
    storeToken,
    fetchWsToken,
    realtimeAppRef,
  });

  useEffect(() => {
    if (prependingHistoryRef.current) {
      prependingHistoryRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!activeDmUser) return;
    if (prependingHistoryRef.current) {
      prependingHistoryRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const list = dmMessageListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDmUser?.id, dmMessages]);

  const changeServer = (serverId: number, availableServers: Server[] = servers) => {
    closePrimaryTransientOverlays();
    setShowSquadFinder(false);
    setShowHome(false);
    setShowSocial(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    hubPanels.setShowHubCalendarPanel(false);
    const server = availableServers.find((item) => item.id === serverId);
    if (!server) return;

    hubPanels.setShowStreamerOverview(isStreamerServer(server, streamerHubsCapability));
    hubPanels.setShowHubHome(!isStreamerServer(server, streamerHubsCapability));

    const firstChannel = server.channels.find((channel) => channel.type === "text") || server.channels[0];
    if (!firstChannel) return;

    if (activeChannelRef.current > 0 && composer.messageInput) {
      setMessageDrafts((current) => ({ ...current, [activeChannelRef.current]: composer.messageInput }));
    }
    setSelectedServer(serverId);
    setSelectedChannel(firstChannel.id);
    setRoomUnread((current) => ({ ...current, [firstChannel.id]: 0 }));
    setRoomMentions((current) => ({ ...current, [firstChannel.id]: 0 }));
    activeServerRef.current = serverId;
    activeChannelRef.current = firstChannel.id;
    messageLoadGenerationRef.current += 1;
    try {
      localStorage.setItem(LAST_WORKSPACE_KEY, JSON.stringify({ serverId, channelId: firstChannel.id }));
    } catch {}
    setMessages([]);
    composer.setMessageInput(messageDrafts[firstChannel.id] ?? "");
    sendTypingState(false);
    composer.setPendingAttachment(null);
    composer.setAttachmentError("");
    setShowEmojiPicker(false);
    void loadHubMembers(serverId);

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "JOIN_SERVER", serverId }));
    }
  };

  const changeChannel = (channelId: number) => {
    closePrimaryTransientOverlays();
    setShowSquadFinder(false);
    setRoomUnread((current) => ({ ...current, [channelId]: 0 }));
    setRoomMentions((current) => ({ ...current, [channelId]: 0 }));
    setTypingUsers({});
    if (activeChannelRef.current > 0 && composer.messageInput) {
      setMessageDrafts((current) => ({ ...current, [activeChannelRef.current]: composer.messageInput }));
    }
    setSelectedChannel(channelId);
    activeChannelRef.current = channelId;
    messageLoadGenerationRef.current += 1;
    try {
      localStorage.setItem(LAST_WORKSPACE_KEY, JSON.stringify({ serverId: activeServerRef.current, channelId }));
    } catch {}
    setMessages([]);
    composer.setMessageInput(messageDrafts[channelId] ?? "");
    voiceCall.setVoiceChatOpen(false);
    forumRoomUi.setActiveForumPostId(null);
    forumRoomUi.setForumPostComposerOpen(false);
    forumRoomUi.setForumReplyInput("");

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "JOIN_CHANNEL", channelId }));
      socket.send(JSON.stringify({ type: "VOICE_STATE_REQUEST" }));
    }
  };

  const { joinSquadMatch, leaveCurrentSquadRoom } = createSquadRoomActions({
    voiceCall,
    setShowHome,
    setShowSquadFinder,
    setSquadCurrent,
    setSquadMatches,
    setSquadMatchPopup,
    squadNotifiedMatchRef,
    setSquadBusy,
    setSquadNotice,
    setShowSocial,
    voiceChannelId,
    currentServer,
    currentChannel,
    loadServers,
    joinVoiceChannel,
    leaveVoice,
    changeServer,
    changeChannel,
  });

  const workspaceSnapshot = (): WorkspaceHistoryEntry => ({
    showHome,
    showSocial,
    socialView,
    activeDmUserId: activeDmUserRef.current?.id ?? null,
    activeGroupChatId: activeGroupChatRef.current?.id ?? null,
    showSettings,
    settingsTab: settingsWindow.settingsTab,
    showServerBrowser,
    showAdminDashboard,
    adminDashboardTab,
    selectedServer: activeServerRef.current,
    selectedChannel: activeChannelRef.current,
  });

  const restoreWorkspaceEntry = (entry: WorkspaceHistoryEntry) => {
    workspaceRestoringRef.current = true;
    workspaceLastRef.current = entry;

    setShowHome(entry.showHome);
    setShowSettings(entry.showSettings);
    settingsWindow.setSettingsTab(entry.settingsTab);
    setShowServerBrowser(entry.showServerBrowser);
    setShowAdminDashboard(entry.showAdminDashboard);
    setAdminDashboardTab(entry.adminDashboardTab);

    if (entry.showSocial) {
      setShowSocial(true);
      setSocialView(entry.socialView);
      if (entry.activeDmUserId) {
        const friend = friendsRef.current.find((item) => item.id === entry.activeDmUserId);
        if (friend) {
          void openDirectMessage(friend);
          return;
        }
      }
      if (entry.activeGroupChatId) {
        const group = groupChats.find((item) => item.id === entry.activeGroupChatId);
        if (group) {
          void directMessages.openGroupChat(group);
          return;
        }
      }
      setActiveDmUser(null);
      activeDmUserRef.current = null;
      setActiveGroupChat(null);
      activeGroupChatRef.current = null;
      return;
    }

    setShowSocial(false);
    setActiveDmUser(null);
    activeDmUserRef.current = null;
    setActiveGroupChat(null);
    activeGroupChatRef.current = null;

    const targetServer = servers.find((server) => server.id === entry.selectedServer);
    const targetChannel = targetServer?.channels.find((channel) => channel.id === entry.selectedChannel);
    if (
      !entry.showHome &&
      !entry.showSettings &&
      !entry.showServerBrowser &&
      !entry.showAdminDashboard &&
      targetServer &&
      targetChannel
    ) {
      if (activeServerRef.current !== entry.selectedServer) {
        changeServer(entry.selectedServer);
      }
      setSelectedServer(entry.selectedServer);
      activeServerRef.current = entry.selectedServer;
      changeChannel(entry.selectedChannel);
      void loadHubMembers(entry.selectedServer);
    }
  };

  useWorkspaceHistoryRecording({
    showSettings,
    showAdminDashboard,
    adminDashboardTab,
    showHome,
    selectedServer,
    selectedChannel,
    showServerBrowser,
    showSocial,
    socialView,
    activeDmUser,
    activeGroupChat,
    workspaceBackRef,
    workspaceForwardRef,
    workspaceLastRef,
    workspaceRestoringRef,
    workspaceSnapshot,
    workspaceEntryKey,
    settingsWindow,
  });

  useWorkspaceHistoryShortcuts({
    workspaceBackRef,
    workspaceForwardRef,
    sideMouseHeldRef,
    sideMouseLastRef,
    workspaceSnapshot,
    restoreWorkspaceEntry,
  });

  const sendTypingState = (active: boolean) => {
    if (currentChannel.type !== "text" || connectionStatus !== "Connected") return;
    if (active && !privacySettingsRef.current.sendTypingIndicators) return;
    sendSocket({ type: "TYPING", channelId: currentChannel.id, active });
  };

  const handleComposerChange = (value: string) => {
    composer.setMessageInput(value);
    setMessageDrafts((current) => ({ ...current, [activeChannelRef.current]: value }));
    const now = Date.now();
    if (now - lastTypingSentRef.current > 800) {
      lastTypingSentRef.current = now;
      sendTypingState(true);
    }
    if (typingStopTimerRef.current !== null) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(() => sendTypingState(false), 1400);
  };

  myUserIdRef.current = currentUser?.id;

  // Outbox: give up on messages with no echo, and send queued ones once the
  // connection is back.
  // Outbox: give up on messages with no echo, and send queued ones once the
  // connection is back.
  useEffect(() => {
    if (!outbox.some((item) => item.status === "sending")) return;
    const timer = window.setInterval(() => setOutbox((current) => failStale(current, Date.now())), 3000);
    return () => window.clearInterval(timer);
  }, [outbox]);

  useEffect(() => {
    if (connectionStatus !== "Connected") return;
    const queued = outboxRef.current.filter((item) => item.status === "queued");
    queued.forEach((item, index) => window.setTimeout(() => hubChat.sendOutboxItem(item), 250 * index));
  }, [connectionStatus]);

  useEffect(() => {
    if (!currentUser || !serversReady || !pendingHubShareCode) return;
    void joinHubFromShareLink(pendingHubShareCode);
  }, [currentUser?.id, serversReady, pendingHubShareCode]);

  useEffect(() => {
    if (currentUser?.id && selectedServer) void loadHubFeatures(selectedServer);
  }, [currentUser?.id, selectedServer, canManageCurrentServer]);

  const {
    createServer,
    loadDiscordTemplate,
    joinPublicServer,
    joinHubFromShareLink,
    leaveServer,
    createChannel,
    loadHubMembers,
    loadServerMembers,
    loadServerAccess,
    uploadHubMedia,
    removeHubMedia,
    loadHubFeatures,
    uploadHubAsset,
    deleteHubAsset,
    joinByInviteCode,
    createHubInvite,
    hubInviteUrl,
    loadCustomRoles,
    assignCustomRole,
    loadHubAudit,
    moderateHubMember,
    saveManageHub,
    grantServerAccess,
    removeHubMemberDirectly,
    openManageServer,
    deleteServer,
    changeMemberRole,
    openManageChannel,
    renameChannel,
    reorderChannel,
    openCreateRoomOfType,
    channelDragProps,
    deleteChannel,
  } = createHubActions({
    currentUser,
    setShowSettings,
    setShowAdminDashboard,
    setShowHome,
    setPendingHubShareCode,
    setHubShareNotice,
    setServers,
    setSelectedServer,
    selectedServer,
    setSelectedChannel,
    setMessages,
    setHubMembers,
    setShowCreateServer,
    newServerName,
    setNewServerName,
    newServerVisibility,
    setNewServerVisibility,
    newServerTemplate,
    setNewServerTemplate,
    creatingServer,
    setCreatingServer,
    discordImportPreview,
    setDiscordImportPreview,
    setDiscordImportBusy,
    setDiscordImportError,
    setServerCreateError,
    setShowServerBrowser,
    setDiscoverError,
    setShowCreateChannel,
    setRoomReorderError,
    newChannelName,
    setNewChannelName,
    newChannelType,
    setNewChannelType,
    newChannelIcon,
    setNewChannelIcon,
    newChannelPrivate,
    setNewChannelPrivate,
    newChannelMemberIds,
    setNewChannelMemberIds,
    newForumGuidelines,
    setNewForumGuidelines,
    newForumPostPolicy,
    setNewForumPostPolicy,
    newForumPostRoleIds,
    setNewForumPostRoleIds,
    newForumPostMemberIds,
    setNewForumPostMemberIds,
    setNewForumMemberSearch,
    setChannelCreateError,
    setShowManageServer,
    manageServerName,
    setManageServerName,
    manageServerIcon,
    setManageServerIcon,
    manageServerVisibility,
    setManageServerVisibility,
    setServerManageError,
    manageServerDescription,
    setManageServerDescription,
    manageServerAccent,
    setManageServerAccent,
    manageServerTheme,
    setManageServerTheme,
    setManageUseBannerBackground,
    manageUseBannerBackground,
    setManageUseChatBackground,
    manageUseChatBackground,
    manageServerCategory,
    setManageServerCategory,
    manageServerTags,
    setManageServerTags,
    manageSlowMode,
    setManageSlowMode,
    setHubInviteCode,
    hubInviteCode,
    setHubMemberSearch,
    setHubFriendSearch,
    setManageHubAdvancedOpen,
    setHubMemberMenuId,
    hubShareBusy,
    setHubShareBusy,
    manageHubIconRing,
    setManageHubIconRing,
    inviteJoinCode,
    setInviteJoinCode,
    setHubMediaBusy,
    setHubMediaError,
    setHubAuditLog,
    setHubAssets,
    setHubFeatureBusy,
    setCustomRoles,
    setServerMembers,
    setMembersLoading,
    setServerAccessUsers,
    setAccessLoading,
    setShowSocial,
    setShowManageChannel,
    setManageChannelId,
    manageChannelId,
    setManageChannelServerId,
    manageChannelServerId,
    setManageChannelName,
    manageChannelName,
    setManageChannelIcon,
    manageChannelIcon,
    setManageChannelPrivate,
    manageChannelPrivate,
    setManageChannelMemberIds,
    manageChannelMemberIds,
    setManageChannelMemberSearch,
    setManageForumGuidelines,
    manageForumGuidelines,
    setManageForumPostPolicy,
    manageForumPostPolicy,
    setManageForumPostRoleIds,
    manageForumPostRoleIds,
    setManageForumPostMemberIds,
    manageForumPostMemberIds,
    setManageForumMemberSearch,
    setChannelManageError,
    setDraggedChannelId,
    draggedChannelRef,
    socketRef,
    activeServerRef,
    activeChannelRef,
    currentServer,
    currentChannel,
    streamerHubsEnabled,
    canManageCurrentServer,
    canManageCurrentRooms,
    isCurrentServerOwner,
    authorizedFetch,
    loadServers,
    loadDiscoverServers,
    loadMessages,
    changeChannel,
    hubPanels,
  });

  const { changePresenceStatus } = createPresenceActions({
    currentUser,
    setCurrentUser,
    setProfileAvatarError,
    profileFields,
    setHubMembers,
    setFriends,
    activeServerRef,
    setCurrentUserFromResponse,
    friendActions,
    loadServerMembers,
  });

  useRealtimeAppHandlers({
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
  });

  const contextMenus = createContextMenuActions({
    currentUser,
    setHubShareNotice,
    setSelectedServer,
    setSelectedChannel,
    setShowManageServer,
    setManageServerName,
    setManageServerIcon,
    setManageServerVisibility,
    setServerManageError,
    setManageServerDescription,
    setManageServerAccent,
    setManageServerTheme,
    setManageUseBannerBackground,
    setManageUseChatBackground,
    setManageServerCategory,
    setManageServerTags,
    setManageSlowMode,
    setHubInviteCode,
    setHubMemberSearch,
    setHubFriendSearch,
    setManageHubAdvancedOpen,
    setHubMemberMenuId,
    setManageHubIconRing,
    setServerMembers,
    setServerAccessUsers,
    setUserContextMenu,
    setProfileDetails,
    setResourceContextMenu,
    setResourceContextMoreOpen,
    setShowManageChannel,
    setManageChannelId,
    setManageChannelServerId,
    setManageChannelName,
    setManageChannelIcon,
    setManageChannelPrivate,
    setManageChannelMemberIds,
    setManageChannelMemberSearch,
    setManageForumGuidelines,
    setManageForumPostPolicy,
    setManageForumPostRoleIds,
    setManageForumPostMemberIds,
    setManageForumMemberSearch,
    setChannelManageError,
    activeServerRef,
    activeChannelRef,
    authorizedFetch,
    loadServerMembers,
    loadCustomRoles,
    loadHubFeatures,
    loadServerAccess,
    loadHubMembers,
    hubPanels,
  });

  const hubChat = createHubChatActions({
    currentUser,
    messagesRef,
    messageSearchQuery,
    setMessageSearchResults,
    servers,
    selectedChannel,
    setMessageDrafts,
    setMessages,
    hubMembers,
    setShowEmojiPicker,
    showEmojiPicker,
    reactionPickerMessageId,
    setReactionPickerMessageId,
    setReactionPickerPosition,
    reactionPickerPosition,
    setOutbox,
    hubAssets,
    setGroupInput,
    groupReplyingTo,
    setGroupReplyingTo,
    setDmInput,
    dmReplyingTo,
    setDmReplyingTo,
    setShowPollComposer,
    showPollComposer,
    setShowDmPlusMenu,
    setShowDmEmojiPicker,
    showDmEmojiPicker,
    setShowGroupEmojiPicker,
    showGroupEmojiPicker,
    gifPickerTarget,
    setGifPickerTarget,
    setShowEventComposer,
    eventInviteMode,
    setEventInviteMode,
    eventInviteMemberIds,
    setEventInviteMemberIds,
    setPollQuestion,
    pollQuestion,
    setPollOptions,
    pollOptions,
    activeChannelRef,
    pendingForumPublishRef,
    messageInputRef,
    attachmentInputRef,
    attachmentAbortRef,
    attachmentRetryFileRef,
    activeDmUserRef,
    activeGroupChatRef,
    recordSessionMessageActions,
    playUiSound,
    currentServer,
    currentChannel,
    canPostInCurrentHub,
    authorizedFetch,
    hubEvents,
    setEventDrawerItem,
    setEventComposerSeed,
    setEventComposerHubId,
    sendSocket,
    sendDmReaction: directMessages.sendDmReaction,
    changeChannel,
    loadHubMembers,
    loadCustomRoles,
    gifSearch,
    hubPanels,
    composer,
    forumRoomUi,
  });

  useSquadMatchPolling({
    currentUser,
    squadCurrent,
    squadSearch,
  });

  // These effects must stay before every conditional return below. Their
  // callbacks are guarded for the loading states, but the hooks themselves
  // must execute on every render so React sees the same hook order during the
  // unauthenticated -> authenticated transition.
  useEffect(() => {
    if (!currentUser || !currentServer.id || !currentChannel.id || currentChannel.name === "no-channel") return;
    appendSessionRecap({
      kind: "channel-visited",
      hubId: String(currentServer.id),
      channelId: String(currentChannel.id),
      channelName: currentChannel.name,
    });
  }, [currentUser?.id, currentServer.id, currentChannel.id, currentChannel.name]);

  useVoiceSessionRecap({
    currentUser,
    sessionIdRef,
    activeVoiceRecapSessionRef,
    servers,
    voiceParticipants,
    voiceChannelId,
    activeServerRef,
    appendSessionRecap,
  });

  const forumRoomKey = currentServer.channels
    .filter((channel) => channel.type === "forum")
    .map((channel) => channel.id)
    .join(",");
  // Newest thread per forum for the sidebar Forums box. Refreshes when the room
  // changes so "new" clears after visiting a forum.
  useForumRoomPreviews({
    currentUser,
    selectedChannel,
    setForumPreviews,
    authorizedFetch,
    forumRoomKey,
  });
  if (!authReady) {
    return (
      <div className="username-screen vadrion-auth-screen" data-skin={displaySkin}>
        <div className="vadrion-connecting-card">
          <DeCaveBrand />
          <div className="vadrion-kicker">VOICE · HUBS · ROOMS</div>
          <p>Connecting to DeCave...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        setCurrentUser={setCurrentUser}
        setAuthReady={setAuthReady}
        authMode={authMode}
        setAuthMode={setAuthMode}
        appSkin={preferences.appSkin}
        displaySkin={displaySkin}
        turnstileSiteKey={turnstileSiteKey}
        turnstileTestMode={turnstileTestMode}
        turnstileToken={turnstileToken}
        setTurnstileToken={setTurnstileToken}
        turnstileNonce={turnstileNonce}
        setTurnstileNonce={setTurnstileNonce}
        authError={authError}
        setAuthError={setAuthError}
        ownerLoginChallengeToken={ownerLoginChallengeToken}
        setOwnerLoginChallengeToken={setOwnerLoginChallengeToken}
        ownerLoginMfaCode={ownerLoginMfaCode}
        setOwnerLoginMfaCode={setOwnerLoginMfaCode}
        ownerLoginMfaBusy={ownerLoginMfaBusy}
        submitOwnerMfaLogin={adminActions.submitOwnerMfaLogin}
        chooseAppSkin={chooseAppSkin}
        storeToken={storeToken}
        submitAuth={submitAuth}
        authForm={authForm}
      />
    );
  }

  if (currentUser && !serversReady) {
    return (
      <div className="username-screen vadrion-auth-screen" data-skin={displaySkin}>
        <div className="vadrion-connecting-card">
          <DeCaveBrand />
          <div className="vadrion-kicker">VOICE · HUBS · ROOMS</div>
          <p>Loading your DeCave space...</p>
        </div>
      </div>
    );
  }

  if (servers.length === 0 && !hubOnboardingSkipped) {
    const filteredDiscoverServers = discoverServers.filter((server) =>
      server.name.toLowerCase().includes(discoverSearch.trim().toLowerCase()),
    );

    return (
      <HubOnboardingScreen
        currentUser={currentUser}
        displaySkin={displaySkin}
        setHubOnboardingSkipped={setHubOnboardingSkipped}
        setShowHome={setShowHome}
        showCreateServer={showCreateServer}
        setShowCreateServer={setShowCreateServer}
        newServerName={newServerName}
        setNewServerName={setNewServerName}
        newServerVisibility={newServerVisibility}
        setNewServerVisibility={setNewServerVisibility}
        newServerTemplate={newServerTemplate}
        setNewServerTemplate={setNewServerTemplate}
        creatingServer={creatingServer}
        discordImportPreview={discordImportPreview}
        setDiscordImportPreview={setDiscordImportPreview}
        discordImportBusy={discordImportBusy}
        discordImportError={discordImportError}
        setDiscordImportError={setDiscordImportError}
        serverCreateError={serverCreateError}
        setServerCreateError={setServerCreateError}
        showServerBrowser={showServerBrowser}
        setShowServerBrowser={setShowServerBrowser}
        discoverSearch={discoverSearch}
        setDiscoverSearch={setDiscoverSearch}
        discoverLoading={discoverLoading}
        discoverError={discoverError}
        streamerHubsEnabled={streamerHubsEnabled}
        loadDiscoverServers={loadDiscoverServers}
        openServerBrowser={openServerBrowser}
        createServer={createServer}
        loadDiscordTemplate={loadDiscordTemplate}
        joinPublicServer={joinPublicServer}
        filteredDiscoverServers={filteredDiscoverServers}
      />
    );
  }

  const homeDashboard = createHomeDashboardActions({
    homeWidgets,
    setHomeWidgets,
    homeQuickLinks,
    setHomeQuickLinks,
    setShowQuickLinkEditor,
    quickLinkDraft,
    setQuickLinkDraft,
    setQuickLinkError,
    externalWidgetForm,
  });

  const dmUnreadTotal = Object.values(dmUnread).reduce((sum, value) => sum + value, 0);
  const visibleFriends = friends
    .filter((friend) => {
      const query = friendListSearch.trim().toLowerCase();
      if (query && !friend.username.toLowerCase().includes(query)) return false;
      if (friendListFilter === "online") return friend.online === true;
      if (friendListFilter === "offline") return friend.online !== true;
      if (friendListFilter === "pending") return false;
      return true;
    })
    .sort((a, b) => Number(b.online === true) - Number(a.online === true) || a.username.localeCompare(b.username));
  // Calendar data: API events (all loaded Hubs) merged with legacy __DECAVE_EVENT__ messages.
  const hubNameById = new Map(servers.map((hub) => [hub.id, hub.name] as const));
  const allCalendarItems = mergeCalendarItems(
    hubEvents.allEvents
      .filter((event) => hubNameById.has(event.hubId))
      .map((event) => apiEventToItem(event, hubNameById.get(event.hubId) ?? "Hub")),
    homeCalendarEvents.filter((event) => hubNameById.has(event.hubId)),
  );
  const calendarNowMs = Date.now();
  const currentHubCalendarItems = allCalendarItems.filter((item) => item.hubId === currentServer.id);
  const calendarItemAsLegacy = (item: CalendarItem): HubCalendarEvent => ({
    id: item.id,
    hubId: item.hubId,
    hubName: item.hubName,
    channelId: item.channelId ?? 0,
    channelName:
      servers.find((hub) => hub.id === item.hubId)?.channels.find((room) => room.id === item.channelId)?.name ?? "",
    createdAt: item.legacy ? "" : new Date(item.event?.createdAt ?? item.start).toISOString(),
    authorName: item.legacy?.authorName ?? "",
    title: item.title,
    startAt: new Date(item.start).toISOString(),
    description: item.description,
    inviteMode: "all",
    invitedUserIds: [],
    invitedUsernames: [],
  });
  const currentHubCalendarEvents = firstOccurrencePerEvent(
    currentHubCalendarItems.filter((item) => !item.cancelled),
  ).map(calendarItemAsLegacy);
  const streamerEvents: StreamerEvent[] = currentHubCalendarEvents.map((event) => ({
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    description: event.description,
    channelId: event.channelId,
  }));
  const hubCalendarUpcomingCount = firstOccurrencePerEvent(
    currentHubCalendarItems.filter((item) => !item.cancelled && itemEnd(item) > calendarNowMs),
  ).length;
  const myCurrentHubMember = currentUser ? hubMembers.find((member) => member.userId === currentUser.id) : undefined;
  // Mirrors the contract: owner/admin, or a custom role with manageEvents or manageRooms.
  const canCreateCurrentHubEventsFallback =
    canManageCurrentServer ||
    Boolean(
      myCurrentHubMember?.customRoles?.some(
        (role) => role.permissions.includes("manageEvents") || role.permissions.includes("manageRooms"),
      ),
    );

  const {
    findApiHubEvent,
    canCreateEventsIn,
    eventRoomsFor,
    renderEventMemberAvatar,
    eventMemberName,
    openCalendarItem,
    leaveCalendarForRoom,
    navigateToHubCalendarEvent,
    openStreamerEvent,
    openHubCalendar,
  } = createCalendarActions({
    setShowHome,
    servers,
    hubMembers,
    currentServer,
    hubEvents,
    setEventDrawerItem,
    syncHomeCalendar,
    joinVoiceChannel,
    changeServer,
    changeChannel,
    loadHubMembers,
    openEventComposerWith: hubChat.openEventComposerWith,
    allCalendarItems,
    calendarNowMs,
    currentHubCalendarEvents,
    canCreateCurrentHubEventsFallback,
    hubPanels,
  });

  const messageRendering = createMessageRendering({
    currentUser,
    hubAssets,
    currentServer,
    currentChannel,
    authorizedFetch,
    hubEventsApi,
    hubEvents,
    voteInHubPoll: hubChat.voteInHubPoll,
    voteInDmPoll: hubChat.voteInDmPoll,
    findApiHubEvent,
    openCalendarItem,
    composer,
    changeChannel,
  });

  const globalCommandItems: GlobalCommandItem[] = [
    {
      id: "nav-home",
      group: "Go to",
      icon: "home",
      label: "Home",
      meta: "",
      keywords: "workspace dashboard overview",
      run: pageNavigation.openHomeWorkspace,
    },
    {
      id: "nav-hubs",
      group: "Go to",
      icon: "hash",
      label: "Hubs",
      meta: "",
      keywords: "workspace rooms voice communities",
      run: pageNavigation.openHubsWorkspace,
    },
    {
      id: "nav-dm",
      group: "Go to",
      icon: "message",
      label: "Direct Messages",
      meta: "",
      keywords: "workspace dm chat private",
      run: pageNavigation.openDirectMessagesWorkspace,
    },
    {
      id: "nav-friends",
      group: "Go to",
      icon: "users",
      label: "Friends",
      meta: "",
      keywords: "workspace people crew requests",
      run: pageNavigation.openFriendsWorkspace,
    },
    {
      id: "nav-discover",
      group: "Go to",
      icon: "compass",
      label: "Discover Hubs",
      meta: "",
      keywords: "workspace browse public communities",
      run: openServerBrowser,
    },
    {
      id: "nav-settings",
      group: "Go to",
      icon: "settings",
      label: "Settings",
      meta: "",
      keywords: "workspace preferences audio appearance notifications",
      run: pageNavigation.openSettings,
    },
    ...(ownerSecurity.platformOwnerActive
      ? [
          {
            id: "nav-admin",
            group: "Go to" as const,
            icon: "shield" as IconName,
            label: "Admin & Security",
            meta: "",
            keywords: "workspace accounts audit usage events",
            run: adminActions.openAdminDashboard,
          },
        ]
      : []),
    ...servers.map((server) => ({
      id: `hub-${server.id}`,
      group: "Your Hubs" as const,
      imageUrl: server.iconUrl ? `${HTTP_URL}${server.iconUrl}` : null,
      label: server.name,
      meta: "Hub",
      keywords: `${server.description ?? ""} ${server.category ?? ""} ${(server.tags ?? []).join(" ")}`,
      run: () => {
        pageNavigation.openHubsWorkspace();
        changeServer(server.id);
      },
    })),
    ...servers.flatMap((server) =>
      server.channels.map((channel) => ({
        id: `channel-${channel.id}`,
        group: "Rooms" as const,
        icon: (channel.type === "forum" ? "forum" : channel.type === "voice" ? "volume" : "hash") as IconName,
        label: channel.name,
        meta: server.name,
        keywords: `${server.name} ${channel.type}`,
        run: () => {
          pageNavigation.openHubsWorkspace();
          changeServer(server.id);
          window.setTimeout(() => changeChannel(channel.id), 0);
        },
      })),
    ),
    ...friends.map((friend) => ({
      id: `friend-${friend.id}`,
      group: "Friends" as const,
      imageUrl: friend.avatarUrl ?? null,
      online: friend.online === true,
      label: friend.username,
      meta: friend.online ? "Online" : "Offline",
      keywords: "friend person dm",
      run: () => void openDirectMessage(friend),
    })),
  ];
  const commandQuery = commandPaletteQuery.trim().toLowerCase();
  const visibleGlobalCommands = globalCommandItems
    .filter(
      (item) => !commandQuery || `${item.label} ${item.meta} ${item.keywords}`.toLowerCase().includes(commandQuery),
    )
    .slice(0, 30);
  const inboxRoomItems = servers.flatMap((server) =>
    server.channels
      .filter((channel) => (roomUnread[channel.id] ?? 0) > 0 || (roomMentions[channel.id] ?? 0) > 0)
      .map((channel) => ({
        server,
        channel,
        unread: roomUnread[channel.id] ?? 0,
        mentions: roomMentions[channel.id] ?? 0,
      })),
  );
  const inboxDmItems = dmConversations.filter((conversation) => (dmUnread[conversation.user.id] ?? 0) > 0);
  const desktopUpdateAvailable = Boolean(
    hasDesktopActivityBridge() &&
    desktopUpdateState?.availableVersion &&
    ["downloading", "downloaded"].includes(desktopUpdateState.status) &&
    desktopUpdateState.availableVersion !== dismissedUpdateVersion,
  );
  const inboxTotal =
    dmUnreadTotal + Object.values(roomUnread).reduce((sum, value) => sum + value, 0) + (desktopUpdateAvailable ? 1 : 0);
  const dmListQuery = dmConversationSearch.trim().toLowerCase();
  const visibleDmConversations = dmConversations.filter((conversation) => {
    const archived = dmPreferences[conversation.user.id]?.archived ?? false;
    const matchesSearch =
      !dmListQuery ||
      conversation.user.username.toLowerCase().includes(dmListQuery) ||
      conversation.latestMessage.toLowerCase().includes(dmListQuery);
    if (!matchesSearch) return false;
    if (dmListFilter === "archived") return archived;
    if (dmListFilter === "requests") return false;
    if (archived) return false;
    return dmListFilter !== "unread" || (dmUnread[conversation.user.id] ?? 0) > 0;
  });
  const overlayWorkspaceOpen = showSettings || showSocial || showServerBrowser || showAdminDashboard;
  const primaryHubsActive =
    !showHome && !showSocial && !showSettings && !showServerBrowser && !showAdminDashboard && !showSquadFinder;
  const hiddenWorkspaceProps = overlayWorkspaceOpen
    ? ({ inert: "", "aria-hidden": true } as Record<string, unknown>)
    : {};
  const hiddenHubRailProps =
    overlayWorkspaceOpen || showHome ? ({ inert: "", "aria-hidden": true } as Record<string, unknown>) : {};
  const currentVoiceParticipants = voiceParticipants.filter(
    (participant) => participant.channelId === currentChannel.id,
  );
  const accessibleVoiceFriends = friends.flatMap((friend) => {
    const participant = voiceParticipants.find((item) => item.userId === friend.id);
    if (!participant) return [];
    for (const server of servers) {
      const channel = server.channels.find((item) => item.id === participant.channelId && item.type === "voice");
      if (channel) return [{ friend, participant, server, channel }];
    }
    return [];
  });
  const openFriendVoiceRoom = (server: Server, channel: Channel) => {
    setShowSquadFinder(false);
    setShowHome(false);
    setShowSocial(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    if (activeServerRef.current !== server.id) {
      changeServer(server.id);
      window.setTimeout(() => changeChannel(channel.id), 0);
      return;
    }
    changeChannel(channel.id);
  };
  const ownVoiceRttMs = (() => {
    const values = Object.values(voiceCall.rtcStats)
      .map((stats) => stats.rttMs)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  })();
  const voiceQuality =
    ownVoiceRttMs === null ? null : ownVoiceRttMs <= 80 ? "good" : ownVoiceRttMs <= 160 ? "fair" : "poor";
  const hasActiveScreenShare = !!callMedia.localScreenStream || Object.keys(callMedia.remoteScreens).length > 0;
  const activeScreenShareCount = (callMedia.localScreenStream ? 1 : 0) + Object.keys(callMedia.remoteScreens).length;
  const hasActiveCamera = !!callMedia.localCameraStream || Object.keys(callMedia.remoteCameras).length > 0;
  const automaticActivityStartedAt = gameActivity.activityState?.automaticText
    ? gameActivity.activityState.startedAt
    : (gameActivity.detectedDesktopGame?.startedAt ?? null);
  const automaticActivityElapsed = formatActivityElapsed(automaticActivityStartedAt, gameActivity.activityNow);
  const currentAutomaticGameName = gameActivity.activityState?.automaticText
    ? gameActivity.activityState.automaticText.replace(/^Playing\s+/i, "")
    : (gameActivity.detectedDesktopGame?.gameName ?? "");
  const currentGameIcon = gameActivity.detectedDesktopGame?.iconDataUrl ?? "";
  const activeVoiceLocation =
    voiceChannelId === null
      ? null
      : (servers.flatMap((server) =>
          server.channels
            .filter((channel) => channel.id === voiceChannelId && channel.type === "voice")
            .map((channel) => ({ server, channel })),
        )[0] ?? null);
  // The Hub sidebar's voice panel covers every view where that sidebar is on screen, so the
  // floating mini player only fills in when the sidebar is hidden or collapsed.
  const hubSidebarHidden = showHome || overlayWorkspaceOpen || hubRailCollapsed;
  const voiceMiniPlayerVisible =
    voiceChannelId !== null &&
    hubSidebarHidden &&
    (currentChannel.id !== voiceChannelId ||
      currentChannel.type !== "voice" ||
      showHome ||
      overlayWorkspaceOpen ||
      showSquadFinder);
  const voiceMiniPlayer = createVoiceMiniPlayerActions({
    currentUser,
    preferences,
  });
  const voiceMiniPosition = preferences.accountPreferences.voiceMiniPlayerPosition;
  const voiceMiniPositionStyle: CSSProperties | undefined = voiceMiniPosition
    ? {
        left: `${clamp(voiceMiniPosition.x, 12, Math.max(12, window.innerWidth - 544))}px`,
        top: `${clamp(voiceMiniPosition.y, 12, Math.max(12, window.innerHeight - 96))}px`,
        right: "auto",
        bottom: "auto",
      }
    : undefined;
  const returnToVoiceChannel = () => {
    if (!activeVoiceLocation) return;
    setShowHome(false);
    setShowSocial(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setShowSquadFinder(false);
    voiceCall.setVoiceChatOpen(false);
    if (activeServerRef.current !== activeVoiceLocation.server.id) {
      changeServer(activeVoiceLocation.server.id);
      window.setTimeout(() => changeChannel(activeVoiceLocation.channel.id), 0);
    } else {
      changeChannel(activeVoiceLocation.channel.id);
    }
  };

  const { loadHubImportPreview, applyHubImport } = createHubImportActions({
    setHubImportPreview,
    setHubImportBusy,
    setHubImportError,
    currentServer,
    authorizedFetch,
    loadServers,
  });

  const rollbackHubImport = async (result: DiscordImportApplyResult): Promise<DiscordImportRollbackResult> => {
    const response = await authorizedFetch(
      `${HTTP_URL}/api/servers/${currentServer.id}/import/${encodeURIComponent(result.importId)}/rollback`,
      { method: "POST" },
    );
    const rollback = (await response.json()) as DiscordImportRollbackResult & ApiError;
    if (!response.ok || !rollback.importId)
      throw new Error(rollback.error || "The reviewed import could not be rolled back.");
    await loadServers();
    return rollback;
  };

  const studioVoiceConnectionState =
    voiceChannelId === null ? "disconnected" : voiceCall.voiceStatus === "Connecting..." ? "connecting" : "connected";

  const sessionKitReferences: SessionKitReferenceCatalog = {
    hubIds: servers.map((server) => String(server.id)),
    channelIdsByHub: Object.fromEntries(
      servers.map((server) => [String(server.id), server.channels.map((channel) => String(channel.id))]),
    ),
    eventIds: homeCalendarEvents.filter((event) => event.hubId === currentServer.id).map((event) => event.id),
    inviteUserIds: hubMembers.map((member) => member.userId),
    inputDeviceIds: audioSetup.audioInputs.map((device) => device.deviceId).filter(Boolean),
    outputDeviceIds: audioSetup.audioOutputs.map((device) => device.deviceId).filter(Boolean),
  };
  // ---- Hub Home and room boxes ----
  const hubHomeActive = hubPanels.showHubHome && !isStreamerHub;
  const currentHubHome = normalizeHubHomeConfig(currentServer.home);
  const hubHomeLive: HubHomeLiveRoom[] = currentServer.channels.flatMap((room) => {
    if (room.type !== "voice") return [];
    const people = voiceParticipants.filter((participant) => participant.channelId === room.id);
    if (!people.length) return [];
    return [
      {
        roomId: room.id,
        name: room.name,
        icon: room.icon,
        sharing: people.some((participant) => participant.screenSharing),
        connected: voiceChannelId === room.id,
        people: people.map((participant) => ({
          id: participant.connectionId,
          name: participant.username,
          avatar: <UserAvatar username={participant.username} avatarUrl={participant.avatarUrl} />,
          speaking: isParticipantSpeaking(participant),
        })),
      },
    ];
  });
  const hubHomeEventItems = firstOccurrencePerEvent(
    currentHubCalendarItems.filter((item) => !item.cancelled && itemEnd(item) > calendarNowMs),
  )
    .sort((a, b) => a.start - b.start)
    .slice(0, 6);
  const hubHomeEvents: HubHomeEvent[] = hubHomeEventItems.map((item) => {
    const roomId = item.voiceChannelId ?? item.channelId;
    return {
      key: item.key,
      title: item.title,
      start: item.start,
      roomName: roomId ? currentServer.channels.find((channel) => channel.id === roomId)?.name : undefined,
      going: item.event?.rsvpCounts.going ?? 0,
      myRsvp: item.event?.myRsvp ?? null,
    };
  });
  const hubHomeCatchUp: HubHomeCatchUp[] = currentServer.channels
    .flatMap((room): HubHomeCatchUp[] => {
      if (room.type === "voice") return [];
      const unread = roomUnread[room.id] ?? 0;
      const mentions = roomMentions[room.id] ?? 0;
      const preview = room.type === "forum" ? forumPreviews[room.id] : null;
      if (unread === 0 && mentions === 0 && !preview?.unread) return [];
      return [
        {
          roomId: room.id,
          name: room.name,
          icon: room.icon,
          kind: room.type === "forum" ? "forum" : "text",
          unread,
          mentions,
          detail: preview?.unread ? `New in "${preview.title}"` : undefined,
        },
      ];
    })
    .sort((a, b) => b.mentions - a.mentions || b.unread - a.unread);
  const hubHomeMembers = [...hubMembers]
    .sort((a, b) => Number(b.online === true) - Number(a.online === true) || a.username.localeCompare(b.username))
    .slice(0, 8)
    .map((member) => ({
      id: member.userId,
      name: member.username,
      avatar: <UserAvatar username={member.username} avatarUrl={member.avatarUrl} />,
    }));
  const studioRecap = buildLocalSessionRecap(sessionIdRef.current, sessionRecapActions);
  const studioCurrentSquadFilters: SupportedSquadFilters = {
    game: squadGame,
    platform: squadPlatform,
    language: squadLanguage,
    region: squadRegion,
    microphoneRequired: squadMicrophone,
  };
  const studioDecisionCards: SharedDecisionCard[] = messages
    .map((message) => {
      const poll = parsePrefixedJson<PollPayload>(message.text, POLL_PREFIX);
      if (!poll) return null;
      const created = createdDecisionCards.find((card) => card.sourceMessageId === message.id);
      const selectedOptionIndex = poll.options.findIndex((_, index) =>
        message.reactions?.[`poll_${index}`]?.includes(currentUser?.id ?? ""),
      );
      return normalizeDecisionCard({
        id: created?.id ?? `poll-card-${message.id}`,
        kind: created?.kind ?? "poll",
        question: poll.question,
        options: poll.options,
        deadlineAt: created?.deadlineAt ?? null,
        sourceMessageId: message.id,
        eventId: created?.eventId ?? null,
        counts: poll.options.map((_option, index) => message.reactions?.[`poll_${index}`]?.length ?? 0),
        selectedOptionIndex: selectedOptionIndex >= 0 ? selectedOptionIndex : null,
        pinned: message.pinned === true,
      });
    })
    .filter((card): card is SharedDecisionCard => card !== null)
    .concat(createdDecisionCards.filter((card) => !messages.some((message) => message.id === card.sourceMessageId)))
    .slice(-3)
    .reverse();
  const studioDecisionTransport: DecisionCardTransport = {
    createPoll: async (payload) => {
      setShowHome(false);
      hubChat.openPollComposer("hub");
      setPollQuestion(payload.question);
      setPollOptions(payload.options.length >= 2 ? payload.options : ["", ""]);
      return { sourceMessageId: "composer" };
    },
    vote: async (sourceMessageId, optionIndex) => {
      const message = messages.find((item) => item.id === sourceMessageId);
      if (message) await hubChat.voteInHubPoll(message, optionIndex);
    },
  };
  const studioVoiceProcessingMode =
    activeNoiseSuppressionMode === "ai"
      ? "high-quality"
      : activeNoiseSuppressionMode === "off"
        ? "low-cpu"
        : "standard";

  const {
    runStudioVoiceABTest,
    postStudioPoll,
    postStudioEvent,
    saveCurrentSessionKit,
    launchSessionKit,
    removeSessionKit,
    runSquadPreset,
  } = createSessionActions({
    setQuietPresence,
    quietPresence,
    setSessionKits,
    sessionKitRepositoryRef,
    quietPresenceRepositoryRef,
    messagesRef,
    homeCalendarEvents,
    setShowHome,
    servers,
    hubMembers,
    setShowSquadFinder,
    setSquadGame,
    squadPlatform,
    setSquadPlatform,
    setSquadLanguage,
    setSquadRegion,
    setSquadMicrophone,
    setEventInviteMode,
    eventInviteMemberIds,
    setEventInviteMemberIds,
    audioSettings,
    setAudioSettings,
    localMicStreamRef,
    voiceActivationMetricsRef,
    micTestActiveRef,
    audioSettingsRef,
    appendSessionRecap,
    currentServer,
    currentChannel,
    loadSquadGames: squadSearch.loadSquadGames,
    startSquadSearch: squadSearch.startSquadSearch,
    applyOutputDevice,
    startMicTest,
    stopMicTest,
    buildMicrophonePipeline,
    rebuildMicrophoneIfActive,
    changeServer,
    changeChannel,
    sendRichComposerText: hubChat.sendRichComposerText,
    waitForPostedHubMessage: hubChat.waitForPostedHubMessage,
    currentHubCalendarEvents,
    navigateToHubCalendarEvent,
    currentAutomaticGameName,
    studioVoiceProcessingMode,
    profileFields,
    preferences,
    audioSetup,
  });

  // Session Studio data remains available to the existing session services,
  // but Home deliberately does not mount the action panels. Keep these
  // values initialized for their persistence and notification side effects.
  void sessionKits;
  void squadPresets;
  void voiceReadiness;
  void sessionStudioSection;
  void setSessionStudioSection;
  void decisionCardComposerOpen;
  void setDecisionCardComposerOpen;
  void setCreatedDecisionCards;
  void sessionKitReferences;
  void studioRecap;
  void studioCurrentSquadFilters;
  void studioDecisionCards;
  void studioDecisionTransport;
  void runStudioVoiceABTest;
  void postStudioPoll;
  void postStudioEvent;
  void saveCurrentSessionKit;
  void launchSessionKit;
  void removeSessionKit;
  void runSquadPreset;

  return (
    <div
      className="app"
      ref={appRootRef}
      data-skin={displaySkin}
      data-text-scale={preferences.accessibilityTextScale}
      data-motion={motionReduced(preferences.extraSettings, systemReducedMotion) ? "reduce" : "full"}
      data-density={preferences.extraSettings.density}
      data-contrast={preferences.extraSettings.highContrast ? "high" : undefined}
      data-underline-links={preferences.extraSettings.underlineLinks ? "true" : undefined}
      data-show-alt={preferences.extraSettings.showAltText ? "true" : undefined}
      data-workspace={
        showAdminDashboard
          ? "admin"
          : showSettings
            ? "settings"
            : showSocial
              ? socialView
              : showServerBrowser
                ? "discover"
                : showHome
                  ? "home"
                  : "hub"
      }
      data-right-rail-collapsed={rightFriendsCollapsed ? "true" : "false"}
      data-hub-rail-collapsed={hubRailCollapsed ? "true" : "false"}
      data-hub-theme={currentServer.theme ?? "midnight"}
      style={
        {
          "--dc-hub-accent": currentServer.accent ?? "#7c5cff",
          ...((showManageServer ? manageUseBannerBackground : currentServer.useBannerBackground === true) &&
          currentServer.bannerUrl
            ? { "--dc-hub-background": `url(${HTTP_URL}${currentServer.bannerUrl})` }
            : {}),
          ...((showManageServer ? manageUseChatBackground : currentServer.useChatBackground === true) &&
          currentServer.chatBackgroundUrl
            ? { "--dc-chat-background": `url(${HTTP_URL}${currentServer.chatBackgroundUrl})` }
            : {}),
        } as CSSProperties
      }
    >
      {voiceMiniPlayerVisible && activeVoiceLocation && (
        <VoiceMiniPlayer
          voiceParticipants={voiceParticipants}
          isParticipantSpeaking={isParticipantSpeaking}
          leaveVoice={leaveVoice}
          activeVoiceLocation={activeVoiceLocation}
          voiceMiniPositionStyle={voiceMiniPositionStyle}
          returnToVoiceChannel={returnToVoiceChannel}
          studioVoiceConnectionState={studioVoiceConnectionState}
          voiceCall={voiceCall}
          voiceControls={voiceControls}
          voiceMiniPlayer={voiceMiniPlayer}
        />
      )}
      {!overlayWorkspaceOpen && !showHome && hubRailCollapsed && (
        <button
          type="button"
          className="dc-hub-rail-restore"
          title="Show Hub sidebar"
          aria-label="Show Hub sidebar"
          onClick={() => {
            setHubRailCollapsed(false);
            try {
              localStorage.setItem("decave-hub-rail-collapsed-v1", "0");
            } catch {}
          }}
        >
          ›
        </button>
      )}
      {desktopUpdateState?.status === "downloaded" &&
        desktopUpdateState.availableVersion !== dismissedUpdateVersion && (
          <div className="dc-update-ready-banner" role="status" data-update-surface="ready">
            <span>
              <strong>Update ready · DeCave {desktopUpdateState.availableVersion ?? "update"}</strong>
              <small>Installed version {desktopUpdateState.currentVersion}. Restart to apply the update.</small>
              {desktopUpdateNotice && (
                <small className="dc-update-error" role="alert">
                  {desktopUpdateNotice}
                </small>
              )}
            </span>
            <button
              type="button"
              className="modal-primary"
              disabled={desktopUpdateAction === "restarting"}
              onClick={handleRestartDesktopToUpdate}
            >
              {desktopUpdateAction === "restarting" ? "Restarting…" : "Restart to update"}
            </button>
            <button
              type="button"
              className="modal-secondary"
              onClick={() => setDismissedUpdateVersion(desktopUpdateState.availableVersion)}
            >
              Later
            </button>
          </div>
        )}
      {currentUser.safety?.ageGateRequired && (
        <AgeGateDialog
          ageGateBirthDate={ageGateBirthDate}
          setAgeGateBirthDate={setAgeGateBirthDate}
          ageGateNotice={ageGateNotice}
          ageGateBusy={ageGateBusy}
          confirmAgeGate={confirmAgeGate}
        />
      )}
      {reportTarget && (
        <ReportDialog
          target={reportTarget}
          request={authorizedFetch}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => setTimeout(() => setReportTarget(null), 1400)}
        />
      )}
      {showMyReports && (
        <div className="modal-overlay dc-safety-overlay" onClick={() => setShowMyReports(false)}>
          <div
            className="modal dc-my-reports-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="My reports"
          >
            <MyReportsPanel request={authorizedFetch} />
            <div className="dc-report-actions ds-modal-actions">
              <button type="button" className="ds-btn" onClick={() => setShowMyReports(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <DirectCallOverlay loadIceServers={loadIceServers} acquireMicrophone={acquireDirectCallMicrophone} />
      {/* DECAVE_PARITY_GLOBAL_CALL_OVERLAY */}{" "}
      <style>{`.app[data-text-scale] { --dc-a11y: ${(preferences.accessibilityTextScale / 100) * fitScale}; }`}</style>
      <style>{APP_SHELL_CSS}</style>
      <ServerRail
        currentUser={currentUser}
        showSettings={showSettings}
        platformOwnerActive={ownerSecurity.platformOwnerActive}
        showAdminDashboard={showAdminDashboard}
        effectiveStreamerMode={effectiveStreamerMode}
        showHome={showHome}
        showServerBrowser={showServerBrowser}
        showSquadFinder={showSquadFinder}
        showSocial={showSocial}
        socialView={socialView}
        setShowFeedback={setShowFeedback}
        setFeedbackContact={setFeedbackContact}
        setFeedbackNotice={setFeedbackNotice}
        openServerBrowser={openServerBrowser}
        closePrimaryTransientOverlays={closePrimaryTransientOverlays}
        openAdminDashboard={adminActions.openAdminDashboard}
        dmUnreadTotal={dmUnreadTotal}
        pageNavigation={pageNavigation}
      />
      <AppTopBar
        currentUser={currentUser}
        setShowCommandPalette={setShowCommandPalette}
        setCommandPaletteQuery={setCommandPaletteQuery}
        setCommandPaletteIndex={setCommandPaletteIndex}
        setShowInbox={setShowInbox}
        profileAccent={profileFields.profileAccent}
        showHome={showHome}
        roomUnread={roomUnread}
        roomMentions={roomMentions}
        mutedHubIds={preferences.mutedHubIds}
        servers={servers}
        selectedServer={selectedServer}
        setShowCreateServer={setShowCreateServer}
        setNewServerName={setNewServerName}
        setNewServerVisibility={setNewServerVisibility}
        setNewServerTemplate={setNewServerTemplate}
        setServerCreateError={setServerCreateError}
        showServerBrowser={showServerBrowser}
        squadCurrent={squadCurrent}
        showSocial={showSocial}
        socialView={socialView}
        voiceParticipants={voiceParticipants}
        selfConnectionIdRef={selfConnectionIdRef}
        currentServer={currentServer}
        openSquadFinderWorkspace={pageNavigation.openSquadFinderWorkspace}
        changeServer={changeServer}
        inboxTotal={inboxTotal}
        primaryHubsActive={primaryHubsActive}
        contextMenus={contextMenus}
      />
      <NoticeToastStack
        hubShareNotice={hubShareNotice}
        setHubShareNotice={setHubShareNotice}
        friends={friends}
        setShowSocial={setShowSocial}
        setSocialView={setSocialView}
        setActiveDmUser={setActiveDmUser}
        friendRequestNotice={friendRequestNotice}
        setFriendRequestNotice={setFriendRequestNotice}
        dmNotice={dmNotice}
        setDmNotice={setDmNotice}
        openDirectMessage={openDirectMessage}
      />
      <HubSidebar
        homeCalendarBusy={homeCalendarBusy}
        homeCalendarNotice={homeCalendarNotice}
        roomUnread={roomUnread}
        roomMentions={roomMentions}
        servers={servers}
        selectedChannel={selectedChannel}
        hubMembers={hubMembers}
        roomReorderError={roomReorderError}
        setRoomReorderError={setRoomReorderError}
        lobbyPendingJoinRef={lobbyPendingJoinRef}
        showManageServer={showManageServer}
        manageUseBannerBackground={manageUseBannerBackground}
        hubRailCollapsed={hubRailCollapsed}
        setHubRailCollapsed={setHubRailCollapsed}
        forumPreviews={forumPreviews}
        hubMembersPanelSearch={hubMembersPanelSearch}
        setHubMembersPanelSearch={setHubMembersPanelSearch}
        hubMembersPanelRole={hubMembersPanelRole}
        setHubMembersPanelRole={setHubMembersPanelRole}
        draggedChannelId={draggedChannelId}
        voiceParticipants={voiceParticipants}
        voiceChannelId={voiceChannelId}
        voiceJoinAttemptRef={voiceJoinAttemptRef}
        selfConnectionIdRef={selfConnectionIdRef}
        currentServer={currentServer}
        currentChannel={currentChannel}
        isStreamerHub={isStreamerHub}
        streamerOverviewActive={streamerOverviewActive}
        streamerSidebarProps={streamerSidebarProps}
        canManageCurrentServer={canManageCurrentServer}
        canManageCurrentRooms={canManageCurrentRooms}
        isCurrentServerOwner={isCurrentServerOwner}
        hubEvents={hubEvents}
        syncHomeCalendar={syncHomeCalendar}
        isParticipantSpeaking={isParticipantSpeaking}
        joinVoiceChannel={joinVoiceChannel}
        leaveVoice={leaveVoice}
        changeServer={changeServer}
        changeChannel={changeChannel}
        leaveServer={leaveServer}
        openManageServer={openManageServer}
        reorderChannel={reorderChannel}
        openCreateRoomOfType={openCreateRoomOfType}
        channelDragProps={channelDragProps}
        openEventComposerWith={hubChat.openEventComposerWith}
        currentHubCalendarItems={currentHubCalendarItems}
        hubCalendarUpcomingCount={hubCalendarUpcomingCount}
        canCreateEventsIn={canCreateEventsIn}
        openCalendarItem={openCalendarItem}
        openHubCalendar={openHubCalendar}
        primaryHubsActive={primaryHubsActive}
        hiddenHubRailProps={hiddenHubRailProps}
        ownVoiceRttMs={ownVoiceRttMs}
        voiceQuality={voiceQuality}
        hubHomeActive={hubHomeActive}
        hubHomeCatchUp={hubHomeCatchUp}
        hubPanels={hubPanels}
        voiceCall={voiceCall}
        callMedia={callMedia}
        voiceControls={voiceControls}
        contextMenus={contextMenus}
      />
      <main
        className="main dc-primary-workspace"
        data-primary-workspace={
          showHome ? "home" : showSocial && socialView === "dm" ? "dms" : primaryHubsActive ? "hubs" : "secondary"
        }
        data-current-hub-id={currentServer.id}
        data-current-channel-id={currentChannel.id}
        data-hub-home={primaryHubsActive && hubHomeActive ? "true" : undefined}
        style={{ position: "relative" }}
        {...hiddenWorkspaceProps}
      >
        {showHome && (
          <section className="dc-workspace-page dc-home-page" aria-label="DeCave Home">
            {
              <HomePage
                currentUser={currentUser}
                activityState={gameActivity.activityState}
                homeWidgets={homeWidgets}
                homeQuickLinks={homeQuickLinks}
                homeCalendarBusy={homeCalendarBusy}
                homeCalendarNotice={homeCalendarNotice}
                homeEditMode={homeEditMode}
                setHomeEditMode={setHomeEditMode}
                showQuickLinkEditor={showQuickLinkEditor}
                setShowQuickLinkEditor={setShowQuickLinkEditor}
                quickLinkDraft={quickLinkDraft}
                quickLinkError={quickLinkError}
                setQuickLinkError={setQuickLinkError}
                homeNotes={homeNotesOwner === (currentUser?.id ?? null) ? homeNotes : ""}
                setHomeNotes={setHomeNotes}
                setShowHome={setShowHome}
                roomUnread={roomUnread}
                servers={servers}
                setShowCreateServer={setShowCreateServer}
                setNewServerName={setNewServerName}
                setNewServerVisibility={setNewServerVisibility}
                setNewServerTemplate={setNewServerTemplate}
                setServerCreateError={setServerCreateError}
                setShowServerBrowser={setShowServerBrowser}
                friends={friends}
                setShowSocial={setShowSocial}
                setSocialView={setSocialView}
                dmConversations={dmConversations}
                dmUnread={dmUnread}
                voiceParticipants={voiceParticipants}
                voiceChannelId={voiceChannelId}
                currentServer={currentServer}
                hubEvents={hubEvents}
                syncHomeCalendar={syncHomeCalendar}
                openServerBrowser={openServerBrowser}
                loadSocialState={friendActions.loadSocialState}
                openDirectMessage={openDirectMessage}
                changeServer={changeServer}
                changeChannel={changeChannel}
                dmUnreadTotal={dmUnreadTotal}
                allCalendarItems={allCalendarItems}
                openCalendarItem={openCalendarItem}
                leaveCalendarForRoom={leaveCalendarForRoom}
                automaticActivityElapsed={automaticActivityElapsed}
                currentAutomaticGameName={currentAutomaticGameName}
                currentGameIcon={currentGameIcon}
                activeVoiceLocation={activeVoiceLocation}
                externalWidgetForm={externalWidgetForm}
                pageNavigation={pageNavigation}
                homeDashboard={homeDashboard}
              />
            }
          </section>
        )}
        {!showHome &&
          (servers.length === 0 ? (
            <NoHubsPlaceholder
              setShowCreateServer={setShowCreateServer}
              setNewServerName={setNewServerName}
              setNewServerVisibility={setNewServerVisibility}
              setNewServerTemplate={setNewServerTemplate}
              setServerCreateError={setServerCreateError}
              setShowSocial={setShowSocial}
              setSocialView={setSocialView}
              setActiveDmUser={setActiveDmUser}
              openServerBrowser={openServerBrowser}
              loadSocialState={friendActions.loadSocialState}
            />
          ) : (
            <>
              <HubContextHeader
                roomUnread={roomUnread}
                setRoomUnread={setRoomUnread}
                setRoomMentions={setRoomMentions}
                servers={servers}
                selectedServer={selectedServer}
                selectedChannel={selectedChannel}
                messages={messages}
                connectionStatus={connectionStatus}
                currentServer={currentServer}
                currentChannel={currentChannel}
                streamerOverviewActive={streamerOverviewActive}
                canManageCurrentRooms={canManageCurrentRooms}
                leaveCurrentSquadRoom={leaveCurrentSquadRoom}
                changeServer={changeServer}
                changeChannel={changeChannel}
                openManageChannel={openManageChannel}
                hubHomeActive={hubHomeActive}
                hubPanels={hubPanels}
                voiceCall={voiceCall}
              />

              <div className="messages">
                {olderHistory.channel && !(isStreamerHub && hubPanels.showStreamerOverview) && !hubHomeActive && (
                  <button
                    type="button"
                    className="dc-load-older"
                    disabled={olderHistoryBusy}
                    onClick={(event) => void loadOlderHistory("channel", event.currentTarget.parentElement)}
                  >
                    {olderHistoryBusy ? "Loading…" : "Load older messages"}
                  </button>
                )}
                {isStreamerHub && hubPanels.showStreamerOverview ? (
                  <HubStreamerOverview
                    key={`streamer-overview-${currentUser.id}-${currentServer.id}`}
                    currentUser={currentUser}
                    hubPanels={hubPanels}
                    currentServer={currentServer}
                    announcementAvailable={announcementAvailable}
                    streamerBannerPath={streamerBannerPath}
                    streamerTransport={streamerTransport}
                    pageNavigation={pageNavigation}
                    changeChannel={changeChannel}
                    openManageServer={openManageServer}
                    hubChat={hubChat}
                    streamerEvents={streamerEvents}
                    openStreamerEvent={openStreamerEvent}
                    openHubCalendar={openHubCalendar}
                  />
                ) : hubHomeActive ? (
                  <HubHomePanel
                    key={`hub-home-${currentServer.id}`}
                    preferences={preferences}
                    voiceCall={voiceCall}
                    hubPanels={hubPanels}
                    setRoomUnread={setRoomUnread}
                    setRoomMentions={setRoomMentions}
                    hubMembers={hubMembers}
                    lobbyPendingJoinRef={lobbyPendingJoinRef}
                    voiceChannelId={voiceChannelId}
                    voiceJoinAttemptRef={voiceJoinAttemptRef}
                    currentServer={currentServer}
                    canManageCurrentServer={canManageCurrentServer}
                    isCurrentServerOwner={isCurrentServerOwner}
                    saveHubHome={saveHubHome}
                    joinVoiceChannel={joinVoiceChannel}
                    settingsActions={settingsActions}
                    changeChannel={changeChannel}
                    openManageServer={openManageServer}
                    openCreateRoomOfType={openCreateRoomOfType}
                    contextMenus={contextMenus}
                    hubChat={hubChat}
                    canCreateEventsIn={canCreateEventsIn}
                    openCalendarItem={openCalendarItem}
                    openHubCalendar={openHubCalendar}
                    currentHubHome={currentHubHome}
                    hubHomeLive={hubHomeLive}
                    hubHomeEventItems={hubHomeEventItems}
                    hubHomeEvents={hubHomeEvents}
                    hubHomeCatchUp={hubHomeCatchUp}
                    hubHomeMembers={hubHomeMembers}
                  />
                ) : currentChannel.type === "forum" ? (
                  <HubForumRoom
                    currentUser={currentUser}
                    hubMembers={hubMembers}
                    customRoles={customRoles}
                    setGifPickerTarget={setGifPickerTarget}
                    playUiSound={playUiSound}
                    currentServer={currentServer}
                    currentChannel={currentChannel}
                    canPostInCurrentHub={canPostInCurrentHub}
                    authorizedFetch={authorizedFetch}
                    openSafetyReport={openSafetyReport}
                    forumRoomUi={forumRoomUi}
                    hubChat={hubChat}
                    messageRendering={messageRendering}
                  />
                ) : currentChannel.type === "voice" && !voiceCall.voiceChatOpen ? (
                  <VoiceRoomStage
                    currentUser={currentUser}
                    connectionStatus={connectionStatus}
                    lobbyPendingJoinRef={lobbyPendingJoinRef}
                    voiceChannelId={voiceChannelId}
                    setFocusedVideo={setFocusedVideo}
                    audioOutputError={audioSetup.audioOutputError}
                    selfConnectionIdRef={selfConnectionIdRef}
                    currentServer={currentServer}
                    currentChannel={currentChannel}
                    canManageCurrentServer={canManageCurrentServer}
                    openUserContextMenu={contextMenus.openUserContextMenu}
                    setScreenPlaybackMuted={setScreenPlaybackMuted}
                    isParticipantSpeaking={isParticipantSpeaking}
                    joinVoice={joinVoice}
                    playSoundboardSound={playSoundboardSound}
                    popOutStream={popOutStream}
                    currentVoiceParticipants={currentVoiceParticipants}
                    hasActiveScreenShare={hasActiveScreenShare}
                    activeScreenShareCount={activeScreenShareCount}
                    hasActiveCamera={hasActiveCamera}
                    soundboard={soundboard}
                    voiceCall={voiceCall}
                    callMedia={callMedia}
                    voiceControls={voiceControls}
                  />
                ) : messages.length === 0 ? (
                  <RoomEmptyHero
                    messageInputRef={messageInputRef}
                    attachmentInputRef={attachmentInputRef}
                    currentServer={currentServer}
                    currentChannel={currentChannel}
                    canManageCurrentServer={canManageCurrentServer}
                    canPostInCurrentHub={canPostInCurrentHub}
                    openManageChannel={openManageChannel}
                    hubChat={hubChat}
                    canCreateEventsIn={canCreateEventsIn}
                  />
                ) : (
                  <HubMessageList
                    currentUser={currentUser}
                    setChatAtBottom={setChatAtBottom}
                    selectedChannel={selectedChannel}
                    messages={messages}
                    hubMembers={hubMembers}
                    outbox={outbox}
                    setOutbox={setOutbox}
                    messagesEndRef={messagesEndRef}
                    messageListRef={messageListRef}
                    currentServer={currentServer}
                    currentChannel={currentChannel}
                    authorizedFetch={authorizedFetch}
                    openSafetyReport={openSafetyReport}
                    openUserContextMenu={contextMenus.openUserContextMenu}
                    composer={composer}
                    hubChat={hubChat}
                    messageRendering={messageRendering}
                  />
                )}
              </div>

              {currentChannel.type === "voice" && voiceChannelId === currentChannel.id && (
                <VoiceControlsPanel
                  setSettingsTab={settingsWindow.setSettingsTab}
                  connectionStatus={connectionStatus}
                  voiceParticipants={voiceParticipants}
                  voiceChannelId={voiceChannelId}
                  audioSettings={audioSettings}
                  audioOutputError={audioSetup.audioOutputError}
                  activeNoiseSuppressionMode={activeNoiseSuppressionMode}
                  currentServer={currentServer}
                  currentChannel={currentChannel}
                  cycleNoiseSuppression={cycleNoiseSuppression}
                  leaveVoice={leaveVoice}
                  stopCamera={stopCamera}
                  openSettings={pageNavigation.openSettings}
                  joinVoice={joinVoice}
                  ownVoiceRttMs={ownVoiceRttMs}
                  voiceQuality={voiceQuality}
                  soundboard={soundboard}
                  cameraShareOptions={cameraShareOptions}
                  voiceCall={voiceCall}
                  callMedia={callMedia}
                  voiceControls={voiceControls}
                />
              )}
              {currentChannel.type !== "forum" && (currentChannel.type !== "voice" || voiceCall.voiceChatOpen) && (
                <HubComposerStatus
                  typingUsers={typingUsers}
                  chatAtBottom={chatAtBottom}
                  composer={composer}
                  setShowEmojiPicker={setShowEmojiPicker}
                  connectionStatus={connectionStatus}
                  setGifPickerTarget={setGifPickerTarget}
                  messagesEndRef={messagesEndRef}
                  messageInputRef={messageInputRef}
                  attachmentInputRef={attachmentInputRef}
                  attachmentRetryFileRef={attachmentRetryFileRef}
                  currentServer={currentServer}
                  currentChannel={currentChannel}
                  canPostInCurrentHub={canPostInCurrentHub}
                  handleComposerChange={handleComposerChange}
                  hubChat={hubChat}
                  canCreateEventsIn={canCreateEventsIn}
                />
              )}
            </>
          ))}
      </main>
      {servers.length > 0 && (
        <FriendsSidebar
          currentUser={currentUser}
          setShowHome={setShowHome}
          hubMembers={hubMembers}
          friends={friends}
          setFriendIdNotice={setFriendIdNotice}
          setShowSocial={setShowSocial}
          setSocialView={setSocialView}
          rightFriendSearch={rightFriendSearch}
          setRightFriendSearch={setRightFriendSearch}
          rightFriendsCollapsed={rightFriendsCollapsed}
          setRightFriendsCollapsed={setRightFriendsCollapsed}
          voiceParticipants={voiceParticipants}
          voiceChannelId={voiceChannelId}
          voiceJoinAttemptRef={voiceJoinAttemptRef}
          openDirectMessage={openDirectMessage}
          openUserContextMenu={contextMenus.openUserContextMenu}
          accessibleVoiceFriends={accessibleVoiceFriends}
          openFriendVoiceRoom={openFriendVoiceRoom}
        />
      )}
      {showAdminDashboard && ownerSecurity.platformOwnerActive && (
        <AdminDashboardPage
          currentUser={currentUser}
          setShowAdminDashboard={setShowAdminDashboard}
          adminDashboardTab={adminDashboardTab}
          setAdminDashboardTab={setAdminDashboardTab}
          authorizedFetch={authorizedFetch}
          adminDashboard={adminDashboard}
          ownerSecurity={ownerSecurity}
          adminActions={adminActions}
        />
      )}
      {hubPanels.showMessageSearch && (
        <MessageSearchDialog
          hubPanels={hubPanels}
          messageSearchQuery={messageSearchQuery}
          setMessageSearchQuery={setMessageSearchQuery}
          messageSearchResults={messageSearchResults}
          currentChannel={currentChannel}
          hubChat={hubChat}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          setShowCommandPalette={setShowCommandPalette}
          commandPaletteQuery={commandPaletteQuery}
          setCommandPaletteQuery={setCommandPaletteQuery}
          commandPaletteIndex={commandPaletteIndex}
          setCommandPaletteIndex={setCommandPaletteIndex}
          setShowInbox={setShowInbox}
          visibleGlobalCommands={visibleGlobalCommands}
        />
      )}
      {showInbox && (
        <InboxPanel
          setShowSettings={setShowSettings}
          settingsWindow={settingsWindow}
          setShowInbox={setShowInbox}
          setShowAdminDashboard={setShowAdminDashboard}
          setShowHome={setShowHome}
          setRoomUnread={setRoomUnread}
          setRoomMentions={setRoomMentions}
          setShowServerBrowser={setShowServerBrowser}
          setShowSocial={setShowSocial}
          dmUnread={dmUnread}
          setDmUnread={setDmUnread}
          desktopUpdateState={desktopUpdateState}
          openDirectMessage={openDirectMessage}
          pageNavigation={pageNavigation}
          changeServer={changeServer}
          changeChannel={changeChannel}
          messageRendering={messageRendering}
          inboxRoomItems={inboxRoomItems}
          inboxDmItems={inboxDmItems}
          desktopUpdateAvailable={desktopUpdateAvailable}
          inboxTotal={inboxTotal}
        />
      )}
      {showSocial && (
        <SocialPage
          currentUser={currentUser}
          friends={friends}
          friendListSearch={friendListSearch}
          setFriendListSearch={setFriendListSearch}
          friendListFilter={friendListFilter}
          setFriendListFilter={setFriendListFilter}
          friendActionsUserId={friendActionsUserId}
          setFriendActionsUserId={setFriendActionsUserId}
          incomingFriendRequests={incomingFriendRequests}
          outgoingFriendRequests={outgoingFriendRequests}
          friendIdInput={friendIdInput}
          setFriendIdInput={setFriendIdInput}
          friendIdNotice={friendIdNotice}
          friendIdBusy={friendIdBusy}
          setShowSocial={setShowSocial}
          socialView={socialView}
          setSocialView={setSocialView}
          activeDmUser={activeDmUser}
          dmConversations={dmConversations}
          dmPreferences={dmPreferences}
          dmConversationSearch={dmConversationSearch}
          setDmConversationSearch={setDmConversationSearch}
          dmListFilter={dmListFilter}
          setDmListFilter={setDmListFilter}
          dmHeaderMenuOpen={dmHeaderMenuOpen}
          setDmHeaderMenuOpen={setDmHeaderMenuOpen}
          groupChats={groupChats}
          activeGroupChat={activeGroupChat}
          groupMessages={groupMessages}
          groupInput={groupInput}
          setGroupInput={setGroupInput}
          groupReplyingTo={groupReplyingTo}
          setGroupReplyingTo={setGroupReplyingTo}
          groupError={groupError}
          setGroupError={setGroupError}
          setShowGroupMembers={setShowGroupMembers}
          dmMessages={dmMessages}
          dmInput={dmInput}
          setDmInput={setDmInput}
          setDmDrafts={setDmDrafts}
          dmReplyingTo={dmReplyingTo}
          setDmReplyingTo={setDmReplyingTo}
          dmAttachmentBusy={dmAttachmentBusy}
          dmAttachmentRetryName={dmAttachmentRetryName}
          dmError={dmError}
          dmEditingId={dmEditingId}
          setDmEditingId={setDmEditingId}
          dmEditingText={dmEditingText}
          setDmEditingText={setDmEditingText}
          showDmPlusMenu={showDmPlusMenu}
          setShowDmPlusMenu={setShowDmPlusMenu}
          setShowDmEmojiPicker={setShowDmEmojiPicker}
          setShowGroupEmojiPicker={setShowGroupEmojiPicker}
          setGifPickerTarget={setGifPickerTarget}
          setDmDeleteConfirm={setDmDeleteConfirm}
          setDmConversationDeleteConfirm={setDmConversationDeleteConfirm}
          dmUnread={dmUnread}
          olderHistory={olderHistory}
          olderHistoryBusy={olderHistoryBusy}
          dmMessageListRef={dmMessageListRef}
          dmAttachmentInputRef={dmAttachmentInputRef}
          dmAttachmentRetryFileRef={dmAttachmentRetryFileRef}
          openSafetyReport={openSafetyReport}
          loadOlderHistory={loadOlderHistory}
          askToRemoveFriend={askToRemoveFriend}
          openDirectMessage={openDirectMessage}
          renderGroupMessageBody={renderGroupMessageBody}
          dmUnreadTotal={dmUnreadTotal}
          visibleFriends={visibleFriends}
          visibleDmConversations={visibleDmConversations}
          hubChat={hubChat}
          directMessages={directMessages}
          messageRendering={messageRendering}
          friendActions={friendActions}
        />
      )}
      {showNewConversation && (
        <NewConversationDialog
          friends={friends}
          groupError={groupError}
          setShowNewConversation={setShowNewConversation}
          openDirectMessage={openDirectMessage}
          newConversation={newConversation}
          directMessages={directMessages}
        />
      )}
      {showGroupMembers && activeGroupChat && (
        <GroupMembersDialog
          currentUser={currentUser}
          friends={friends}
          activeGroupChat={activeGroupChat}
          groupError={groupError}
          setShowGroupMembers={setShowGroupMembers}
          directMessages={directMessages}
        />
      )}
      {dmDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setDmDeleteConfirm(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(440px, 92vw)" }}>
            <h2>Delete this DM?</h2>
            <p>This removes the message for both people. This cannot be undone.</p>
            <div className="modal-buttons ds-modal-actions">
              <button type="button" className="ds-btn" onClick={() => setDmDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ds-btn ds-btn-danger"
                onClick={() => void directMessages.deleteDirectMessage()}
              >
                Delete Message
              </button>
            </div>
          </div>
        </div>
      )}
      {dmConversationDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setDmConversationDeleteConfirm(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(470px, 92vw)" }}>
            <h2>Delete conversation with {dmConversationDeleteConfirm.username}?</h2>
            <p>
              This clears the conversation from your DeCave account only. It does not erase the other person's copy. If
              either of you sends a new DM later, the conversation will appear again.
            </p>
            <div className="modal-buttons ds-modal-actions">
              <button type="button" className="ds-btn" onClick={() => setDmConversationDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ds-btn ds-btn-danger"
                onClick={() => void directMessages.deleteDmConversation()}
              >
                Delete Conversation
              </button>
            </div>
          </div>
        </div>
      )}
      {showFeedback && (
        <FeedbackDialog
          setShowFeedback={setShowFeedback}
          feedbackType={feedbackType}
          setFeedbackType={setFeedbackType}
          feedbackMessage={feedbackMessage}
          setFeedbackMessage={setFeedbackMessage}
          feedbackContact={feedbackContact}
          setFeedbackContact={setFeedbackContact}
          feedbackShareContact={feedbackShareContact}
          setFeedbackShareContact={setFeedbackShareContact}
          feedbackDiagnosticsConsent={feedbackDiagnosticsConsent}
          setFeedbackDiagnosticsConsent={setFeedbackDiagnosticsConsent}
          feedbackDiagnosticName={feedbackDiagnosticName}
          setFeedbackDiagnosticName={setFeedbackDiagnosticName}
          setFeedbackDiagnosticText={setFeedbackDiagnosticText}
          feedbackNotice={feedbackNotice}
          setFeedbackNotice={setFeedbackNotice}
          feedbackBusy={feedbackBusy}
          submitFeedback={submitFeedback}
        />
      )}
      {showLogoutConfirm && <LogoutConfirmDialog setShowLogoutConfirm={setShowLogoutConfirm} logout={logout} />}
      {resourceContextMenu && (
        <ResourceContextMenu
          mutedHubIds={preferences.mutedHubIds}
          selectedServer={selectedServer}
          resourceContextMenu={resourceContextMenu}
          setResourceContextMenu={setResourceContextMenu}
          setResourceContextMoreOpen={setResourceContextMoreOpen}
          toggleMutedHub={settingsActions.toggleMutedHub}
          changeServer={changeServer}
          changeChannel={changeChannel}
          contextMenus={contextMenus}
        />
      )}
      {userContextMenu && (
        <UserContextMenu
          currentUser={currentUser}
          setShowLogoutConfirm={setShowLogoutConfirm}
          blockedUserIds={blockedUserIds}
          customStatusEditing={customStatusEditing}
          setCustomStatusEditing={setCustomStatusEditing}
          customStatusDraft={customStatusDraft}
          setCustomStatusDraft={setCustomStatusDraft}
          customStatusSaving={customStatusSaving}
          customStatusError={customStatusError}
          setCustomStatusError={setCustomStatusError}
          mutedUserIds={mutedUserIds}
          onlineUsers={onlineUsers}
          hubMembers={hubMembers}
          profileStatusMenuOpen={profileStatusMenuOpen}
          setProfileStatusMenuOpen={setProfileStatusMenuOpen}
          friends={friends}
          incomingFriendRequests={incomingFriendRequests}
          outgoingFriendRequests={outgoingFriendRequests}
          userContextMenu={userContextMenu}
          setUserContextMenu={setUserContextMenu}
          profileDetails={profileDetails}
          voiceChannelId={voiceChannelId}
          voiceUserVolumes={voiceUserVolumes}
          selfConnectionIdRef={selfConnectionIdRef}
          peerSessionsRef={peerSessionsRef}
          locallyMutedUsersRef={locallyMutedUsersRef}
          changePresenceStatus={changePresenceStatus}
          openSafetyReport={openSafetyReport}
          toggleBlockedUser={toggleBlockedUser}
          askToRemoveFriend={askToRemoveFriend}
          openDirectMessage={openDirectMessage}
          canModerateTarget={canModerateTarget}
          toggleLocalMuteUser={toggleLocalMuteUser}
          openSettings={pageNavigation.openSettings}
          beginCustomStatusEdit={beginCustomStatusEdit}
          changeVoiceUserVolume={changeVoiceUserVolume}
          moderateVoiceUser={moderateVoiceUser}
          ownVoiceRttMs={ownVoiceRttMs}
          voiceCall={voiceCall}
          voiceControls={voiceControls}
          friendActions={friendActions}
          settingsActions={settingsActions}
        />
      )}
      {focusedVideo && (
        <StreamFocusOverlay
          callMedia={callMedia}
          focusedVideo={focusedVideo}
          setFocusedVideo={setFocusedVideo}
          setScreenPlaybackMuted={setScreenPlaybackMuted}
          popOutStream={popOutStream}
        />
      )}
      {hubPanels.showHubInsights && (
        <HubInsightsDialog
          apiBase={HTTP_URL}
          hubId={currentServer.id}
          hubName={currentServer.name}
          onClose={() => hubPanels.setShowHubInsights(false)}
          onOpenRoom={(roomId) => {
            hubPanels.setShowHubInsights(false);
            hubPanels.setShowHubHome(false);
            changeChannel(roomId);
          }}
        />
      )}
      {hubPanels.showPinnedMessages && (
        <PinnedMessagesPanel
          apiBase={HTTP_URL}
          roomId={currentChannel.id}
          roomName={currentChannel.name}
          canUnpin={currentServer.myRole === "owner" || currentServer.myRole === "admin"}
          loadedIds={new Set(messages.map((item) => item.id))}
          renderAvatar={(item) => <UserAvatar username={item.username} avatarUrl={item.avatarUrl} />}
          formatTime={formatTimestamp}
          onJump={(messageId) => {
            hubPanels.setShowPinnedMessages(false);
            window.setTimeout(() => {
              messageRendering.scrollToMessage(messageId);
              const target = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
              if (target) {
                target.classList.remove("is-jump-target");
                void target.offsetWidth;
                target.classList.add("is-jump-target");
              }
            }, 60);
          }}
          onUnpin={async (item) => {
            const response = await authorizedFetch(
              `${HTTP_URL}/api/channels/${item.channelId}/messages/${encodeURIComponent(item.id)}/pin`,
              { method: "POST" },
            );
            if (!response.ok) throw new Error("Could not unpin the message.");
          }}
          onClose={() => hubPanels.setShowPinnedMessages(false)}
        />
      )}
      {friendRemovalConfirm && (
        <RemoveFriendDialog
          friendRemovalConfirm={friendRemovalConfirm}
          setFriendRemovalConfirm={setFriendRemovalConfirm}
          confirmFriendRemoval={confirmFriendRemoval}
        />
      )}
      {streamerToast && (
        <div className="squad-match-popup dc-streamer-toast" role="status">
          <div className="squad-match-popup-icon">
            <Icon name="screen" />
          </div>
          <div>
            <strong>Streamer mode</strong>
            <span>{streamerToast}</span>
          </div>
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm dismiss"
            aria-label="Dismiss"
            onClick={() => setStreamerToast("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {squadMatchPopup && !showSquadFinder && (
        <SquadMatchPopup
          setShowSquadFinder={setShowSquadFinder}
          squadMatchPopup={squadMatchPopup}
          setSquadMatchPopup={setSquadMatchPopup}
          squadSearch={squadSearch}
        />
      )}
      {showSquadFinder && (
        <SquadFinderDialog
          setShowSquadFinder={setShowSquadFinder}
          squadGame={squadGame}
          setSquadGame={setSquadGame}
          squadGames={squadGames}
          squadGameSuggestion={squadGameSuggestion}
          setSquadGameSuggestion={setSquadGameSuggestion}
          squadPlatform={squadPlatform}
          setSquadPlatform={setSquadPlatform}
          squadLanguage={squadLanguage}
          setSquadLanguage={setSquadLanguage}
          squadRegion={squadRegion}
          setSquadRegion={setSquadRegion}
          squadMicrophone={squadMicrophone}
          setSquadMicrophone={setSquadMicrophone}
          squadCurrent={squadCurrent}
          squadMatches={squadMatches}
          squadBusy={squadBusy}
          squadNotice={squadNotice}
          joinSquadMatch={joinSquadMatch}
          squadSearch={squadSearch}
        />
      )}
      {showSettings && (
        <SettingsWindow
          currentUser={currentUser}
          preferences={preferences}
          prefersDark={prefersDark}
          systemReducedMotion={systemReducedMotion}
          settingsWindow={settingsWindow}
          profileMedia={profileMedia}
          profileAvatarError={profileAvatarError}
          securityNotice={securityNotice}
          accountSessions={accountSessions}
          securityBusy={securityBusy}
          keybindCapture={keybindCapture}
          setKeybindCapture={setKeybindCapture}
          ownerSecurity={ownerSecurity}
          setShowMyReports={setShowMyReports}
          setBlockedUserIds={setBlockedUserIds}
          profileFields={profileFields}
          gameActivity={gameActivity}
          captureApps={captureApps}
          autoStreamerActive={autoStreamerActive}
          effectiveStreamerMode={effectiveStreamerMode}
          servers={servers}
          hubMembers={hubMembers}
          friends={friends}
          setShowHubHome={hubPanels.setShowHubHome}
          voiceParticipants={voiceParticipants}
          audioSettings={audioSettings}
          voiceUserVolumes={voiceUserVolumes}
          audioSetup={audioSetup}
          voiceChannelRef={voiceChannelRef}
          playUiSound={playUiSound}
          audioSettingsRef={audioSettingsRef}
          localScreenStreamRef={localScreenStreamRef}
          desktopUpdates={desktopUpdates}
          desktopInstalledVersion={desktopInstalledVersion}
          chooseAppSkin={chooseAppSkin}
          currentServer={currentServer}
          copyMyDecaveId={friendActions.copyMyDecaveId}
          sendSocket={sendSocket}
          applyOutputDevice={applyOutputDevice}
          changeInputVolume={changeInputVolume}
          saveSettingsChanges={saveSettingsChanges}
          closeSettings={closeSettings}
          resetVoiceUserVolumes={resetVoiceUserVolumes}
          saveAudioSettings={saveAudioSettings}
          rebuildMicrophoneIfActive={rebuildMicrophoneIfActive}
          startMicTest={startMicTest}
          stopMicTest={stopMicTest}
          logoutAllSessions={logoutAllSessions}
          changeServer={changeServer}
          changeChannel={changeChannel}
          sendTypingState={sendTypingState}
          automaticActivityElapsed={automaticActivityElapsed}
          currentGameIcon={currentGameIcon}
          adminActions={adminActions}
          accountActions={accountActions}
          settingsActions={settingsActions}
          profileMediaActions={profileMediaActions}
          activityActions={activityActions}
        />
      )}
      {settingsWindow.settingsCloseConfirm && (
        <SettingsCloseConfirmDialog
          settingsSaving={settingsWindow.settingsSaving}
          setSettingsCloseConfirm={settingsWindow.setSettingsCloseConfirm}
          discardSettingsChanges={settingsActions.discardSettingsChanges}
          keepSettingsChangesAndClose={keepSettingsChangesAndClose}
        />
      )}
      {showServerBrowser && (
        <DiscoverPage
          hubs={discoverServers}
          loading={discoverLoading}
          error={discoverError}
          query={discoverSearch}
          onQueryChange={setDiscoverSearch}
          inviteCode={inviteJoinCode}
          onInviteCodeChange={setInviteJoinCode}
          onJoinInvite={() => void joinByInviteCode()}
          onRefresh={() => void loadDiscoverServers()}
          onJoin={(hubId) => joinPublicServer(hubId)}
          onOpen={(hubId) => {
            setShowServerBrowser(false);
            changeServer(hubId);
          }}
          loadPreview={loadHubPreview}
          mediaUrl={resolveAvatarUrl}
        />
      )}
      {accountEditField && (
        <AccountEditDialog
          accountEditField={accountEditField}
          ownerLoginChallengeToken={ownerLoginChallengeToken}
          ownerLoginMfaCode={ownerLoginMfaCode}
          setOwnerLoginMfaCode={setOwnerLoginMfaCode}
          ownerLoginMfaBusy={ownerLoginMfaBusy}
          submitOwnerMfaLogin={adminActions.submitOwnerMfaLogin}
          accountEdit={accountEdit}
          accountActions={accountActions}
        />
      )}
      {deleteOwnershipBlock && (
        <div className="modal-overlay" onClick={() => setDeleteOwnershipBlock(null)}>
          <div className="modal dc-account-danger-modal" onClick={(event) => event.stopPropagation()}>
            <div className="dc-account-danger-icon">
              <Icon name="crown" />
            </div>
            <h2>Transfer Hub ownership first</h2>
            <p>Transfer ownership of all Hubs you own before deleting your account.</p>
            {deleteOwnershipBlock.length > 0 && (
              <div className="ds-list dc-owned-hubs-list">
                <span className="ds-section-label">Owned Hubs</span>
                {deleteOwnershipBlock.map((name) => (
                  <div key={name} className="ds-row ds-row-boxed">
                    <Icon name="crown" size="sm" />
                    <span className="ds-row-title">{name}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions ds-modal-actions">
              <button type="button" className="ds-btn ds-btn-primary" onClick={() => setDeleteOwnershipBlock(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
      {ownerSecurityOperationRef.current && (ownerSecurity.ownerMfaBusy || ownerSecurity.ownerManagementBusy) && (
        <OwnerSecurityDialog
          ownerLoginChallengeToken={ownerLoginChallengeToken}
          ownerLoginMfaCode={ownerLoginMfaCode}
          setOwnerLoginMfaCode={setOwnerLoginMfaCode}
          ownerLoginMfaBusy={ownerLoginMfaBusy}
          adminActions={adminActions}
        />
      )}
      {accountDangerAction && (
        <AccountDangerDialog
          securityNotice={securityNotice}
          securityBusy={securityBusy}
          dangerPassword={dangerPassword}
          setDangerPassword={setDangerPassword}
          accountDangerAction={accountDangerAction}
          accountDangerOperationRef={accountDangerOperationRef}
          ownerLoginChallengeToken={ownerLoginChallengeToken}
          ownerLoginMfaCode={ownerLoginMfaCode}
          setOwnerLoginMfaCode={setOwnerLoginMfaCode}
          ownerLoginMfaBusy={ownerLoginMfaBusy}
          adminActions={adminActions}
          accountActions={accountActions}
        />
      )}
      {showEventComposer && eventComposerHubId > 0 && (
        <EventComposerSheet
          key={`${eventComposerHubId}:${eventComposerSeed.editing?.id ?? "new"}:${eventComposerSeed.start ?? 0}`}
          hubId={eventComposerHubId}
          hubName={servers.find((hub) => hub.id === eventComposerHubId)?.name ?? ""}
          rooms={eventRoomsFor(eventComposerHubId)}
          roles={
            eventComposerHubId === currentServer.id
              ? customRoles.map((role) => ({ id: role.id, name: role.name, color: role.color }))
              : []
          }
          members={
            eventComposerHubId === currentServer.id
              ? hubMembers.map((member) => ({ userId: member.userId, username: member.username }))
              : []
          }
          currentUserId={currentUser?.id}
          api={hubEventsApi}
          seed={eventComposerSeed}
          resolveMediaUrl={(url) => (url.startsWith("/") ? `${HTTP_URL}${url}` : url)}
          renderAvatar={renderEventMemberAvatar}
          onClose={() => setShowEventComposer(false)}
          onSaved={hubChat.handleEventSaved}
        />
      )}
      {eventDrawerItem && (
        <EventDetailDrawer
          item={
            eventDrawerItem.event
              ? (allCalendarItems.find((candidate) => candidate.key === eventDrawerItem.key) ?? eventDrawerItem)
              : eventDrawerItem
          }
          rooms={eventRoomsFor(eventDrawerItem.hubId)}
          api={hubEventsApi}
          resolveMediaUrl={(url) => (url.startsWith("/") ? `${HTTP_URL}${url}` : url)}
          renderAvatar={renderEventMemberAvatar}
          memberName={eventMemberName}
          onClose={() => setEventDrawerItem(null)}
          onEventChanged={(event) => {
            hubEvents.applyEvent(event);
            setEventDrawerItem((current) =>
              current && current.id === event.id
                ? apiEventToItem(
                    { ...event, occurrenceStart: current.start, occurrenceEnd: current.end },
                    current.hubName,
                  )
                : current,
            );
          }}
          onEventCancelled={(hubId, eventId) => {
            hubEvents.removeEvent(hubId, eventId);
            void hubEvents.refreshHub(hubId);
          }}
          onEdit={(event) => hubChat.openEventComposerWith({ editing: event }, event.hubId)}
          onJoinVoice={(hubId, roomId) => leaveCalendarForRoom(hubId, roomId, true)}
          onOpenRoom={(hubId, roomId) => leaveCalendarForRoom(hubId, roomId, false)}
        />
      )}
      {showPollComposer && (
        <PollComposerDialog
          setShowPollComposer={setShowPollComposer}
          pollQuestion={pollQuestion}
          setPollQuestion={setPollQuestion}
          pollOptions={pollOptions}
          setPollOptions={setPollOptions}
          hubChat={hubChat}
        />
      )}
      {showCreateServer && (
        <CreateHubModal
          name={newServerName}
          onNameChange={setNewServerName}
          visibility={newServerVisibility}
          onVisibilityChange={setNewServerVisibility}
          template={newServerTemplate}
          onTemplateChange={setNewServerTemplate}
          streamerHubsEnabled={streamerHubsEnabled}
          error={serverCreateError}
          busy={creatingServer}
          importSlot={
            <DiscordImportPanel
              preview={discordImportPreview}
              busy={discordImportBusy}
              error={discordImportError}
              onLoad={(value) => void loadDiscordTemplate(value)}
              onClear={() => {
                setDiscordImportPreview(null);
                setDiscordImportError("");
              }}
            />
          }
          onCancel={() => setShowCreateServer(false)}
          onCreate={(iconFile) => void createServer(iconFile)}
        />
      )}
      {showCreateChannel && (
        <RoomSettingsPanel
          mode="create"
          hubName={currentServer.name}
          values={{
            name: newChannelName,
            icon: newChannelIcon,
            type: newChannelType,
            isPrivate: newChannelPrivate,
            memberIds: newChannelMemberIds,
            forumGuidelines: newForumGuidelines,
            forumPostPolicy: newForumPostPolicy,
            forumPostRoleIds: newForumPostRoleIds,
            forumPostMemberIds: newForumPostMemberIds,
          }}
          set={{
            name: setNewChannelName,
            icon: setNewChannelIcon,
            type: setNewChannelType,
            isPrivate: setNewChannelPrivate,
            memberIds: setNewChannelMemberIds,
            forumGuidelines: setNewForumGuidelines,
            forumPostPolicy: setNewForumPostPolicy,
            forumPostRoleIds: setNewForumPostRoleIds,
            forumPostMemberIds: setNewForumPostMemberIds,
          }}
          iconChoices={DEFAULT_ROOM_ICONS}
          members={hubMembers}
          roles={customRoles}
          currentUserId={currentUser?.id}
          error={channelCreateError}
          forumTagsSupported={servers.some((hub) =>
            hub.channels.some((room) => Array.isArray((room as Channel & { forumTags?: unknown }).forumTags)),
          )}
          renderAvatar={(member) => <UserAvatar username={member.username} avatarUrl={member.avatarUrl} />}
          onSubmit={(extra) => createChannel(extra)}
          onClose={() => setShowCreateChannel(false)}
        />
      )}
      {showManageServer && (
        <ManageHubPanel
          server={currentServer}
          values={{
            name: manageServerName,
            icon: manageServerIcon,
            visibility: manageServerVisibility,
            description: manageServerDescription,
            accent: manageServerAccent,
            theme: manageServerTheme,
            useBannerBackground: manageUseBannerBackground,
            useChatBackground: manageUseChatBackground,
            iconRing: manageHubIconRing,
            category: manageServerCategory,
            tags: manageServerTags,
            slowMode: manageSlowMode,
          }}
          set={{
            name: setManageServerName,
            icon: setManageServerIcon,
            visibility: setManageServerVisibility,
            description: setManageServerDescription,
            accent: setManageServerAccent,
            theme: setManageServerTheme,
            useBannerBackground: setManageUseBannerBackground,
            useChatBackground: setManageUseChatBackground,
            iconRing: setManageHubIconRing,
            category: setManageServerCategory,
            tags: setManageServerTags,
            slowMode: setManageSlowMode,
          }}
          apiBaseUrl={HTTP_URL}
          authorizedFetch={authorizedFetch}
          isOwner={isCurrentServerOwner}
          canManage={canManageCurrentServer}
          currentUserId={currentUser?.id}
          error={serverManageError}
          renderAvatar={(person) => <UserAvatar username={person.username} avatarUrl={person.avatarUrl} />}
          members={serverMembers}
          membersLoading={membersLoading}
          friends={serverAccessUsers}
          friendsLoading={accessLoading}
          onAddFriend={(friend) => {
            const user = serverAccessUsers.find((item) => item.userId === friend.userId);
            if (user) void grantServerAccess(user);
          }}
          onChangeMemberRole={(member, role) => {
            const target = serverMembers.find((item) => item.userId === member.userId);
            if (target) void changeMemberRole(target, role);
          }}
          onAssignCustomRole={(member, roleId) => {
            const target = serverMembers.find((item) => item.userId === member.userId);
            if (target) void assignCustomRole(target, roleId);
          }}
          onModerateMember={(member, action) => {
            const target = serverMembers.find((item) => item.userId === member.userId);
            if (target) void moderateHubMember(target, action);
          }}
          onRemoveMember={(member) => {
            const target = serverMembers.find((item) => item.userId === member.userId);
            if (target) void removeHubMemberDirectly(target);
          }}
          roles={customRoles}
          roleIconChoices={ROLE_ICON_CHOICES}
          onRolesChanged={async () => {
            await loadCustomRoles(currentServer.id);
            await loadServerMembers(currentServer.id);
          }}
          inviteUrl={hubInviteUrl()}
          inviteBusy={hubShareBusy}
          onCreateInvite={() => void createHubInvite(true)}
          onCopyInvite={() => void contextMenus.copyResourceText(hubInviteUrl())}
          mediaBusy={hubMediaBusy}
          mediaError={hubMediaError}
          onUploadMedia={(kind, file) => void uploadHubMedia(kind, file)}
          onRemoveMedia={(kind) => void removeHubMedia(kind)}
          assets={hubAssets}
          assetBusy={hubFeatureBusy}
          onUploadAsset={(kind, file) => void uploadHubAsset(kind, file)}
          onDeleteAsset={(asset) => {
            const target = hubAssets.find((item) => item.id === asset.id);
            if (target) void deleteHubAsset(target);
          }}
          auditLog={hubAuditLog}
          onLoadAudit={() => void loadHubAudit()}
          onOpenRoomSettings={(room) => {
            const channel = currentServer.channels.find((item) => item.id === room.id);
            if (!channel) return;
            setHubMemberMenuId(null);
            setShowManageServer(false);
            contextMenus.openManageChannelFor(currentServer, channel);
          }}
          onReorderRoom={(sourceId, targetId) => void reorderChannel(sourceId, targetId)}
          onCreateRoom={() => {
            setHubMemberMenuId(null);
            setShowManageServer(false);
            setNewChannelName("");
            setNewChannelType("text");
            setNewChannelIcon("💬");
            setNewChannelPrivate(false);
            setNewChannelMemberIds([]);
            setNewForumGuidelines("");
            setNewForumPostPolicy("everyone");
            setNewForumPostRoleIds([]);
            setNewForumPostMemberIds([]);
            setNewForumMemberSearch("");
            setChannelCreateError("");
            setShowCreateChannel(true);
            void loadCustomRoles(currentServer.id);
            void loadHubMembers(currentServer.id);
          }}
          onOpenCalendar={() => {
            setHubMemberMenuId(null);
            setShowManageServer(false);
            openHubCalendar(true);
          }}
          onCreateEvent={() => {
            setHubMemberMenuId(null);
            setShowManageServer(false);
            hubChat.openEventComposer();
          }}
          botsPanel={
            canManageCurrentServer ? (
              <HubBotsPanel
                hubId={currentServer.id}
                rooms={currentServer.channels}
                apiBaseUrl={HTTP_URL}
                authorizedFetch={authorizedFetch}
              />
            ) : undefined
          }
          importPanel={
            canManageCurrentServer ? (
              <DiscordImportReview
                preview={hubImportPreview}
                busy={hubImportBusy}
                error={hubImportError}
                existingRooms={currentServer.channels.map((channel) => ({
                  id: channel.id,
                  name: channel.name,
                  type: channel.type,
                  category: channel.category ?? "GENERAL",
                }))}
                existingRoles={customRoles.map((role) => ({ id: role.id, name: role.name, color: role.color }))}
                onLoad={(value) => void loadHubImportPreview(value)}
                onClear={() => {
                  setHubImportPreview(null);
                  setHubImportError("");
                }}
                onApply={applyHubImport}
                onRollback={rollbackHubImport}
              />
            ) : undefined
          }
          onSave={() => saveManageHub(true)}
          onDelete={() => deleteServer(true)}
          onClose={() => {
            setHubMemberMenuId(null);
            setShowManageServer(false);
          }}
        />
      )}
      {showManageChannel &&
        (() => {
          const managedRoom =
            servers
              .find((hub) => hub.id === (manageChannelServerId || currentServer.id))
              ?.channels.find((room) => room.id === (manageChannelId || currentChannel.id)) ?? currentChannel;
          const managedTags = (managedRoom as Channel & { forumTags?: unknown }).forumTags;
          return (
            <RoomSettingsPanel
              key={managedRoom.id}
              mode="manage"
              hubName={currentServer.name}
              values={{
                name: manageChannelName,
                icon: manageChannelIcon,
                type: managedRoom.type,
                isPrivate: manageChannelPrivate,
                memberIds: manageChannelMemberIds,
                forumGuidelines: manageForumGuidelines,
                forumPostPolicy: manageForumPostPolicy,
                forumPostRoleIds: manageForumPostRoleIds,
                forumPostMemberIds: manageForumPostMemberIds,
              }}
              set={{
                name: setManageChannelName,
                icon: setManageChannelIcon,
                type: () => undefined,
                isPrivate: setManageChannelPrivate,
                memberIds: setManageChannelMemberIds,
                forumGuidelines: setManageForumGuidelines,
                forumPostPolicy: setManageForumPostPolicy,
                forumPostRoleIds: setManageForumPostRoleIds,
                forumPostMemberIds: setManageForumPostMemberIds,
              }}
              iconChoices={REFERENCE_ROOM_ICONS}
              members={hubMembers}
              roles={customRoles}
              currentUserId={currentUser?.id}
              error={channelManageError}
              initialForumTags={
                Array.isArray(managedTags)
                  ? managedTags.filter((tag): tag is string => typeof tag === "string")
                  : undefined
              }
              forumTagsSupported={
                Array.isArray(managedTags) ||
                servers.some((hub) =>
                  hub.channels.some((room) => Array.isArray((room as Channel & { forumTags?: unknown }).forumTags)),
                )
              }
              renderAvatar={(member) => <UserAvatar username={member.username} avatarUrl={member.avatarUrl} />}
              onSubmit={(extra) => renameChannel(extra)}
              onClose={() => setShowManageChannel(false)}
              onDelete={() => deleteChannel(true)}
              deleteConfirmName={managedRoom.name}
            />
          );
        })()}
      <AppBottomBar
        showSettings={showSettings}
        voiceCall={voiceCall}
        showAdminDashboard={showAdminDashboard}
        showHome={showHome}
        connectionStatus={connectionStatus}
        showServerBrowser={showServerBrowser}
        showSocial={showSocial}
        socialView={socialView}
        voiceChannelId={voiceChannelId}
        currentServer={currentServer}
        currentChannel={currentChannel}
      />
    </div>
  );
}

export default App;
