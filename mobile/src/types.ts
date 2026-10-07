export type PresenceStatus = "online" | "idle" | "dnd" | "invisible";

export const REPORT_CATEGORIES = [
  "HARASSMENT_BULLYING",
  "HATE_SPEECH",
  "SEXUAL_INAPPROPRIATE",
  "SUSPECTED_GROOMING",
  "CHILD_SAFETY",
  "THREATS_VIOLENCE",
  "SPAM_SCAM",
  "IMPERSONATION",
  "UNDERAGE_USER",
  "INAPPROPRIATE_MEDIA",
  "SELF_HARM",
  "OTHER",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReportUrgency = "critical" | "high" | "medium" | "low" | "spam_invalid";
export type ReportTargetType = "user" | "message" | "content" | "attachment" | "profile" | "voice_participant";

export type SafetyProfile = {
  ageStatus: "unconfirmed" | "eligible" | "ineligible" | "review";
  ageBand: "unknown" | "teen" | "adult";
  teenSafetyMode: boolean;
  agePolicyVersion: string;
  ageAcknowledgedAt: string | null;
  ageVerifiedAt: string | null;
  ageGateRequired: boolean;
};

export type SafetyReport = {
  id: string;
  caseId: string;
  caseNumber: string | null;
  targetType: ReportTargetType;
  targetId: string;
  targetUsername: string | null;
  subjectUserId: string | null;
  subjectUsername: string | null;
  category: ReportCategory;
  description: string;
  urgencyRecommended: ReportUrgency;
  urgency: ReportUrgency;
  urgencySource: "system" | "reporter" | "owner";
  status: "submitted" | "under_review" | "awaiting_information" | "action_taken" | "no_violation" | "escalated" | "appealed" | "closed";
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type SafetyReportTarget = {
  targetType: ReportTargetType;
  targetId: string;
  subjectUserId?: string;
  subjectUsername?: string;
  contextType?: string;
  contextId?: string;
  contextLabel?: string;
  hubId?: number;
  roomId?: number;
};

export type AccountUser = {
  id: string;
  username: string;
  displayName?: string | null;
  pronouns?: string | null;
  bannerUrl?: string | null;
  avatarUrl: string | null;
  avatarUpdatedAt?: string | null;
  bio: string;
  status: PresenceStatus;
  statusText: string;
  activityText: string;
  accent: string;
  email: string | null;
  emailVerified: boolean;
  online?: boolean;
  createdAt?: string | null;
  safety?: SafetyProfile;
};

export type ForumPostPolicy = "everyone" | "staff" | "roles" | "members";

export type Channel = {
  id: number;
  name: string;
  type: "text" | "voice" | "forum";
  kind?: "chat" | "forum";
  icon?: string;
  category?: string;
  position?: number;
  private?: boolean;
  forumGuidelines?: string;
  forumPostPolicy?: ForumPostPolicy;
};

export type Hub = {
  id: number;
  name: string;
  icon: string;
  channels: Channel[];
  ownerId: string | null;
  myRole: "owner" | "admin" | "member" | null;
  visibility: "private" | "public";
  memberCount?: number;
  onlineCount?: number;
  description?: string;
  accent?: string;
  category?: string;
  tags?: string[];
  slowModeSeconds?: number;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  joined?: boolean;
  isSquad?: boolean;
};

export type SocialState = {
  friends: AccountUser[];
  incoming: AccountUser[];
  outgoing: AccountUser[];
};

export type DirectMessage = {
  id: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  timestamp: string;
  replyToId?: string | null;
  reactions?: Record<string, string[]>;
};

export type DmConversation = {
  user: AccountUser;
  latestMessage: string;
  latestTimestamp: string;
};

export type GroupChatMessage = {
  id: string;
  groupId: string;
  fromUserId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  timestamp: string;
  replyToId?: string | null;
  reactions?: Record<string, string[]>;
  pinned?: boolean;
};

export type GroupChat = {
  id: string;
  name: string;
  ownerUserId: string;
  members: AccountUser[];
  latestMessage: string;
  latestTimestamp: string;
  memberCount: number;
};

export type ChatMessage = {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  timestamp: string;
  channelId: number;
  role: "owner" | "admin" | "member" | null;
  editedAt?: string | null;
  replyToId?: string | null;
  reactions?: Record<string, string[]>;
  pinned?: boolean;
  attachment?: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    url: string;
  } | null;
};

export type VoiceParticipant = {
  connectionId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  avatarUpdatedAt?: string | null;
  channelId: number;
  role: "owner" | "admin" | "member" | null;
  muted: boolean;
  selfMuted: boolean;
  deafened: boolean;
  selfDeafened: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  screenSharing: boolean;
  cameraSharing: boolean;
};

export type AuthResponse = {
  user?: AccountUser;
  wsToken?: string;
  sessionToken?: string;
  verificationRequired?: boolean;
  message?: string;
  mfaRequired?: boolean;
  challengeToken?: string;
  challengeExpiresInSeconds?: number;
  /** "user" when the member turned on two-factor; absent for platform owner checks. */
  mfaKind?: "user";
  recoveryCodesRemaining?: number;
  error?: string;
  safety?: SafetyProfile;
};

export type RealtimeEvent = Record<string, unknown> & {
  type?: string;
};
