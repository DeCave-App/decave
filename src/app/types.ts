// Data shapes shared by the app shell (App.tsx) and its helper modules.

import type { DmEnvelope } from "../../shared/dm-e2ee-format";
import type { DmFileKey } from "../../shared/dm-e2ee";
import type { DmE2eeMark } from "../../shared/dm-e2ee-session";
import type { IconName } from "../components/Icon";
import type { HubLayout } from "../../shared/streamer-mode";
import type { ExtraSettings, NotifyLevels } from "../features/settings";
import type { LocalRecapActionInput } from "../session/local-recap.ts";
import type { SafetyProfile } from "../safety/types";
import type { NotificationPreview } from "../privacy/notification-preview";
import type { HubHomeConfig } from "../../shared/hub-home";
import type { HomeWidgetConfig, HomeWidgetSize } from "../features/home";

export type AppLocalRecapActionInput = Omit<LocalRecapActionInput, "sessionId">;

export type ChannelType = "text" | "voice" | "forum";
export type ServerRole = "owner" | "admin" | "member";
export type ServerVisibility = "private" | "public";
type CustomRolePermission =
  | "manageRooms"
  | "moderateMessages"
  | "moderateMembers"
  | "voiceModerate"
  | "createInvites"
  | "viewAudit"
  | "manageEvents";
export type CustomRoleView = {
  id: string;
  name: string;
  color: string;
  icon: string;
  permissions: CustomRolePermission[];
};

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible";

export type Channel = {
  id: number;
  name: string;
  type: ChannelType;
  category?: string;
  position?: number;
  private?: boolean;
  icon?: string;
  forumGuidelines?: string;
  forumPostPolicy?: "everyone" | "staff" | "roles" | "members";
  forumPostRoleIds?: string[];
  forumPostMemberIds?: string[];
};

export type HubAsset = {
  id: string;
  kind: "emote" | "sticker";
  name: string;
  mimeType: string;
  url: string;
  createdAt?: string;
};
export type PollPayload = { question: string; options: string[] };
export type EventInviteMode = "all" | "selected";
export type EventPayload = {
  title: string;
  startAt: string;
  description: string;
  inviteMode: EventInviteMode;
  invitedUserIds: string[];
  invitedUsernames: string[];
};
export type ComposerTarget = "hub" | "dm" | "group" | "forum";
export type GiphyGif = {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width?: number;
  height?: number;
};
export type GifPayload = { id: string; title: string; url: string };

export type Server = {
  id: number;
  name: string;
  icon: string;
  channels: Channel[];
  ownerId: string | null;
  myRole: ServerRole | null;
  visibility: ServerVisibility;
  memberCount?: number | null;
  onlineCount?: number | null;
  description?: string;
  accent?: string;
  category?: string;
  tags?: string[];
  slowModeSeconds?: number;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  chatBackgroundUrl?: string | null;
  iconRing?: boolean;
  theme?: "midnight" | "ember" | "forest" | "ocean";
  useBannerBackground?: boolean;
  useChatBackground?: boolean;
  layout?: HubLayout;
  capabilities?: unknown;
  features?: unknown;
  streamerHubsEnabled?: boolean;
  isSquad?: boolean;
  ownerOnlyPosting?: boolean;
  membershipPrivate?: boolean;
  /** Hub Home layout, Welcome message and Rules. */
  home?: HubHomeConfig;
};

export type DiscoverServer = {
  id: number;
  name: string;
  icon: string;
  visibility: "public";
  memberCount: number | null;
  onlineCount: number | null;
  joined: boolean;
  myRole: ServerRole | null;
  description?: string;
  accent?: string;
  category?: string;
  tags?: string[];
  iconUrl?: string | null;
  bannerUrl?: string | null;
  iconRing?: boolean;
  membershipPrivate?: boolean;
  createdAt?: string;
  friendsInside?: number;
  friendNames?: string[];
  voiceCount?: number;
};

export type SquadSearch = {
  id: string;
  game: string;
  platform: string;
  language: string;
  region: string;
  microphoneRequired: boolean;
  groupId: string | null;
  memberCount: number;
  expiresAt: string;
  owner?: { id: string | null; username: string; avatarUrl?: string | null };
};

export type SquadGameSuggestion = {
  id: string;
  gameName: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  submittedBy: string;
};

export type AccountUser = {
  id: string;
  username: string;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | null;
  bio?: string;
  status?: PresenceStatus;
  statusText?: string;
  activityText?: string;
  accent?: string;
  displayName?: string;
  pronouns?: string;
  bannerUrl?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  createdAt?: string;
  lastOnlineAt?: string | null;
  safety?: SafetyProfile;
};

export type OnlineUser = {
  id: string;
  userId?: string;
  username: string;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | null;
  serverId: number;
  channelId: number;
  role?: ServerRole | null;
  status?: PresenceStatus;
  statusText?: string;
  activityText?: string;
  bio?: string;
  accent?: string;
  createdAt?: string;
  lastOnlineAt?: string | null;
};

export type AttachmentMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  /** Present when the file was encrypted before upload (end-to-end encrypted DMs). */
  fileKey?: DmFileKey;
};

export type ChatMessage = {
  id: string;
  userId?: string;
  username: string;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | null;
  text: string;
  timestamp: string;
  channelId: number;
  role?: ServerRole | null;
  editedAt?: string | null;
  replyToId?: string | null;
  reactions?: Record<string, string[]>;
  pinned?: boolean;
  attachment?: AttachmentMeta | null;
  pending?: boolean;
};

export type ServerMemberView = {
  userId: string;
  username: string;
  role: ServerRole;
  customRoleIds?: string[];
  customRoles?: CustomRoleView[];
  avatarUrl?: string | null;
  status?: PresenceStatus;
  statusText?: string;
  activityText?: string;
  online?: boolean;
  isFriend?: boolean;
  joinedAt?: string;
  createdAt?: string;
  lastOnlineAt?: string | null;
};

export type ServerAccessUser = {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  hasAccess: boolean;
  role: ServerRole | null;
};

export type VoiceParticipant = {
  connectionId: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | null;
  channelId: number;
  role?: ServerRole | null;
  muted: boolean;
  selfMuted?: boolean;
  deafened?: boolean;
  selfDeafened?: boolean;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  screenSharing: boolean;
  allowStreamPreview?: boolean;
  cameraSharing?: boolean;
};

export type SocialUser = AccountUser & { online?: boolean };

export type DirectMessage = {
  id: string;
  fromUserId: string;
  toUserId: string;
  /** For an encrypted message, the decrypted text (empty until decrypted). */
  text: string;
  timestamp: string;
  replyToId?: string | null;
  reactions?: Record<string, string[]>;
  /** Encrypted reactions, merged into `reactions` once decrypted. */
  reactionEnvelopes?: DmEnvelope[] | null;
  envelope?: DmEnvelope | null;
  /** Set once the message has been through decryption. */
  e2ee?: DmE2eeMark;
};

export type DmConversation = {
  user: SocialUser;
  latestMessage: string;
  latestMessageId?: string;
  latestEnvelope?: DmEnvelope | null;
  latestTimestamp: string;
};

export type DmPreference = {
  favorite: boolean;
  archived: boolean;
};

export type GroupChatMessage = {
  id: string;
  groupId: string;
  fromUserId: string;
  username: string;
  avatarUrl?: string | null;
  text: string;
  timestamp: string;
  editedAt?: string | null;
  replyToId?: string | null;
  reactions?: Record<string, string[]>;
  envelope?: DmEnvelope | null;
  /** Set once the message has been through decryption. */
  e2ee?: DmE2eeMark;
};

export type GroupChat = {
  id: string;
  name: string;
  ownerUserId: string;
  members: SocialUser[];
  latestMessage: string;
  latestEnvelope?: DmEnvelope | null;
  latestTimestamp: string;
  memberCount: number;
  /** Messages are end-to-end encrypted (and stay so). */
  e2ee?: boolean;
};

export type DmNotice = {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  text: string;
};

export type UserContextTarget = {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  role?: ServerRole | null;
  connectionId?: string;
  voiceParticipant?: VoiceParticipant;
  source?: "top-profile" | "profile";
};

export type UserContextMenuState = {
  x: number;
  y: number;
  target: UserContextTarget;
};

export type ResourceContextTarget =
  { kind: "hub"; server: Server } | { kind: "room"; server: Server; channel: Channel };

export type ResourceContextMenuState = {
  x: number;
  y: number;
  target: ResourceContextTarget;
};

// The voice join in flight: one generation, aborted or timed out as a unit.
export type VoiceJoinAttempt = {
  generation: number;
  channelId: number;
  controller: AbortController;
  timer: number | null;
  deadlineExpired: boolean;
};

export type PeerSession = {
  pc: RTCPeerConnection;
  microphoneSender: RTCRtpSender | null;
  participant: VoiceParticipant;
  polite: boolean;
  signalingQueue: Promise<void>;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  remoteDescriptionPending: boolean;
  remoteAudioStream: MediaStream;
  remoteAudioTrackAttached: boolean;
  missingInboundAudioSamples: number;
  recoveryTimer: number | null;
  restartAttempts: number;
  screenConfigPending: Promise<void>;
  lastInboundAudioBytes: number;
  lastInboundAudioPackets: number;
  mutedInboundSamples: number;
  pendingIceCandidates: RTCIceCandidateInit[];
  resumeAudio: () => void;
  recover: (reason: string, immediate?: boolean, forcePeerRebuild?: boolean) => void;
};

export type RemoteScreen = {
  connectionId: string;
  username: string;
  stream: MediaStream;
};

export type NoiseSuppressionMode = "off" | "standard" | "strong" | "ai";
type SensitivityMode = "auto" | "manual";
export type DirectCallMicrophoneLease = {
  stream: MediaStream;
  subscribe: (listener: (stream: MediaStream) => Promise<void> | void) => () => void;
  release: () => void;
};
export type AppSkin = "nebula" | "arctic" | "crimson" | "royal" | "pearl" | "obsidian" | "verdant" | "bright";
export type ScreenQuality = "auto" | "720p30" | "1080p30" | "1080p60" | "1440p30" | "1440p60";
export type ScreenShareProfile = { width: number; height: number; fps: number; maxBitrate: number };

export type CameraEffect = "none" | "blur" | "replace";

export type AutomaticActivitySource = "desktop-steam" | "desktop-epic" | "steam" | "desktop" | "";

export type DetectedDesktopGame = {
  source: "steam" | "epic";
  gameName: string;
  appId: string;
  startedAt: string | null;
  iconDataUrl?: string;
};

export type DesktopActivityScanResult = {
  supported: boolean;
  platform: string;
  game: DetectedDesktopGame | null;
  scannedAt: string;
};

export type ActivitySettings = {
  autoDetectLocal: boolean;
  useSteamPresence: boolean;
  publishAutomatic: boolean;
  excludedGames: string[];
};

export type SteamIntegrationState = {
  linked: boolean;
  apiConfigured: boolean;
  steamId?: string;
  personaName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  gameName?: string;
  gameId?: string;
};

export type ActivityState = {
  manualText: string;
  automaticText: string;
  effectiveText: string;
  source: AutomaticActivitySource;
  appId: string;
  startedAt: string | null;
  steam: SteamIntegrationState;
};

export type FriendRequestPolicy = "everyone" | "friends_of_friends" | "none";
export type TimeFormatPreference = "system" | "12h" | "24h";
export type LanguagePreference = "en" | "pl" | "el" | "de" | "fr" | "es" | "it" | "pt";
export type VoiceMiniPlayerPosition = { x: number; y: number };
export type VoiceMiniDragState = { pointerId: number; offsetX: number; offsetY: number; moved: boolean };

export type AccountPreferences = {
  usernameChangedAt: string | null;
  usernameChangeAvailableAt: string | null;
  friendRequestPolicy: FriendRequestPolicy;
  allowStreamPreviews: boolean;
  streamerMode: boolean;
  language: LanguagePreference;
  timeFormat: TimeFormatPreference;
  voiceMiniPlayerPosition: VoiceMiniPlayerPosition | null;
  /** Email when someone signs in from a new device. */
  loginAlerts: boolean;
  /** Who can see the game you're playing. */
  activityVisibility: "everyone" | "friends" | "nobody";
};

export type DesktopSystemSettings = {
  openAtLogin: boolean;
  closeToTray: boolean;
  voiceOverlayEnabled: boolean;
  /** Overlay size in percent (60–150). Undefined on desktop builds that predate the setting. */
  voiceOverlayScale?: number;
};

export type DesktopUpdateState = {
  status: "disabled" | "idle" | "checking" | "downloading" | "downloaded" | "up-to-date" | "error";
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  transferred: number | null;
  total: number | null;
  bytesPerSecond: number | null;
  checkedAt: string | null;
  error: string | null;
};

export type DesktopKeybindSettings = {
  toggleMute: string;
  toggleDeafen: string;
};

export type SoundboardSound = {
  id: string;
  uploaderUserId?: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
};

export type ExternalHomeWidget = {
  kind: "external";
  id: string;
  title: string;
  url: string;
  size: HomeWidgetSize;
};
export type HomeDashboardWidget = HomeWidgetConfig | ExternalHomeWidget;

export type HubCalendarEvent = EventPayload & {
  id: string;
  hubId: number;
  hubName: string;
  channelId: number;
  channelName: string;
  createdAt: string;
  authorName: string;
  /** API event announced by this legacy-format chat message (new clients). */
  eventId?: string;
};

export type AudioSettings = {
  inputDeviceId: string;
  outputDeviceId: string;
  inputVolume: number;
  sensitivityMode: SensitivityMode;
  sensitivityDb: number;
  noiseSuppression: NoiseSuppressionMode;
  echoCancellation: boolean;
  autoGainControl: boolean;
  pushToTalk: boolean;
  pushToTalkKey: string;
};

export type SinkableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export type ApiError = {
  error?: string;
};

export type AuthResponse = {
  wsToken?: string;
  user?: AccountUser;
  verificationRequired?: boolean;
  message?: string;
  mfaRequired?: boolean;
  challengeToken?: string;
  challengeExpiresInSeconds?: number;
  /** "user" for the account holder's optional 2FA; absent for platform-owner MFA. */
  mfaKind?: "user";
  recoveryCodesRemaining?: number;
  safety?: SafetyProfile;
};

export type DeviceSession = {
  id: string;
  client: "mobile" | "web" | "desktop" | "legacy";
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  lastActiveAt?: string | null;
  current: boolean;
};

export type PlatformOwnerSummary = {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  platformRole: "owner";
  createdAt: string;
};

export type AdminDashboardSummary = {
  generatedAt: string;
  activityDate: string;
  activityFrom: string;
  activityTo: string;
  signedInToday: number;
  returningUsers: number;
  onlineUsers: number;
  voiceUsers: number;
  screenSharingUsers: number;
  squadFinderUsers: number;
  accounts: number;
  verifiedAccounts: number;
  platformOwners: number;
  platformAdmins: number;
  hubs: number;
  publicHubs: number;
  activeSessions: number;
  securityEvents24h: number;
  platformAuditEvents24h: number;
  ownersWithMfa: number;
  suspendedAccounts: number;
  deletionScheduledAccounts: number;
};

export type AdminAccountSummary = {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  platformRole: "user" | "admin" | "owner";
  createdAt: string;
  activeSessions: number;
  hubsOwned: number;
  suspended: boolean;
  suspendedAt: string | null;
  suspendedUntil: string | null;
  suspensionReason: string;
  passwordResetRequired: boolean;
  deletedAt: string | null;
  deleteAfter: string | null;
  deletionReason: string;
  erasedAt: string | null;
};

type AdminOwnedHub = {
  id: number;
  name: string;
  visibility: "private" | "public";
  createdAt: string;
};

export type AdminAccountDetail = AdminAccountSummary & {
  ageStatus: "unconfirmed" | "eligible" | "ineligible" | "review";
  ageBand: "unknown" | "teen" | "adult";
  ageAssuranceMethod: "unknown" | "self_attested" | "reviewed";
  ownerMfaEnabled: boolean;
  ownerRecoveryCodesRemaining: number;
  hubsOwned: AdminOwnedHub[];
  recentSecurityEvents: AdminSecurityEvent[];
};

export type AdminSecurityEvent = {
  id: string;
  userId: string | null;
  username: string | null;
  event: string;
  detail: string;
  userAgent: string;
  createdAt: string;
};

export type AdminAuditEvent = {
  id: string;
  action: string;
  actorUserId: string;
  actorUsername: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  detail: Record<string, unknown>;
  requestRay: string | null;
  requestCountry: string | null;
  createdAt: string;
};

export type DeleteServerResult = {
  success: boolean;
  deletedServerId: number;
  fallbackServerId: number;
  fallbackChannelId: number;
};

export type LeaveServerResult = {
  success: boolean;
  serverId: number;
  fallbackServerId: number;
  fallbackChannelId: number;
};

export type DeleteChannelResult = {
  success: boolean;
  deletedChannelId: number;
  serverId: number;
  fallbackChannelId: number;
};

export type NotificationSettings = {
  desktop: boolean;
  sounds: boolean;
  friendRequests: boolean;
  dms: boolean;
  groups: boolean;
  mentions: boolean;
  voiceEvents: boolean;
};
export type PrivacySettings = {
  notificationPreview: NotificationPreview;
  sendTypingIndicators: boolean;
  friendRequestPolicy: FriendRequestPolicy;
  allowStreamPreviews: boolean;
  streamerMode: boolean;
  /** Desktop: turn Streamer mode on while OBS or another streaming app runs. */
  autoStreamerMode: boolean;
};
export type SoundTheme = "off" | "soft" | "pulse" | "arcade";
export type SoundVariant = "default" | "bright" | "deep" | "digital" | "glass" | "warm" | "chime" | "minimal";
export type UiSoundEvent =
  | "send"
  | "receive"
  | "voiceJoin"
  | "voiceLeave"
  | "friendRequest"
  | "mention"
  | "mute"
  | "unmute"
  | "deafen"
  | "undeafen"
  | "screenShare";
export type SoundSettings = {
  theme: SoundTheme;
  variants: Record<UiSoundEvent, SoundVariant>;
  send: boolean;
  receive: boolean;
  voiceJoin: boolean;
  voiceLeave: boolean;
  friendRequest: boolean;
  mention: boolean;
  mute: boolean;
  unmute: boolean;
  deafen: boolean;
  undeafen: boolean;
  screenShare: boolean;
};
export type SettingsSnapshot = {
  profileBio: string;
  profileStatus: PresenceStatus;
  profileStatusText: string;
  profileAccent: string;
  profileDisplayName: string;
  profilePronouns: string;
  appSkin: AppSkin;
  extraSettings: ExtraSettings;
  notificationPreset: string;
  notificationSettings: NotificationSettings;
  privacySettings: PrivacySettings;
  soundSettings: SoundSettings;
  accessibilityTextScale: number;
  audioSettings: AudioSettings;
  activitySettings: ActivitySettings;
  language: LanguagePreference;
  timeFormat: TimeFormatPreference;
  loginAlerts: boolean;
  activityVisibility: AccountPreferences["activityVisibility"];
  notifyLevels: NotifyLevels;
  desktopSystemSettings: DesktopSystemSettings;
  desktopKeybinds: DesktopKeybindSettings;
};

export type SettingsTab =
  | "profile"
  | "account"
  | "activity"
  | "appearance"
  | "notifications"
  | "sounds"
  | "privacy"
  | "voice"
  | "system"
  | "keybinds"
  | "language"
  | "support";

export type AdminDashboardTab = "overview" | "accounts" | "games" | "security" | "audit" | "trust-safety";

/** A place in the app, for the back/forward workspace history. */
export type WorkspaceHistoryEntry = {
  showHome: boolean;
  showSocial: boolean;
  socialView: "dm" | "friends";
  activeDmUserId: string | null;
  activeGroupChatId: string | null;
  showSettings: boolean;
  settingsTab: SettingsTab;
  showServerBrowser: boolean;
  showAdminDashboard: boolean;
  adminDashboardTab: AdminDashboardTab;
  selectedServer: number;
  selectedChannel: number;
};

/** An entry in the search and quick switch palette. */
export type GlobalCommandItem = {
  id: string;
  group: "Go to" | "Your Hubs" | "Rooms" | "Friends";
  label: string;
  meta: string;
  keywords: string;
  icon?: IconName;
  imageUrl?: string | null;
  online?: boolean;
  run: () => void;
};
