import type { ReactNode } from "react";

export type HubRole = "owner" | "admin" | "member";
export type HubPermission =
  | "manageRooms"
  | "moderateMessages"
  | "moderateMembers"
  | "voiceModerate"
  | "createInvites"
  | "viewAudit"
  | "manageEvents";
export type HubCustomRole = { id: string; name: string; color: string; icon: string; permissions: HubPermission[] };
export type HubTheme = "midnight" | "ember" | "forest" | "ocean";

export type HubMemberRow = {
  userId: string;
  username: string;
  role: HubRole;
  customRoleIds?: string[];
  avatarUrl?: string | null;
  online?: boolean;
  joinedAt?: string;
};

export type HubFriendRow = { userId: string; username: string; avatarUrl?: string | null };

export type HubRoom = {
  id: number;
  name: string;
  type: "text" | "voice" | "forum";
  icon?: string;
  private?: boolean;
  category?: string;
  position?: number;
};

export type ManageHubServer = {
  id: number;
  name: string;
  icon: string;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  chatBackgroundUrl?: string | null;
  visibility: "private" | "public";
  description?: string;
  accent?: string;
  theme?: HubTheme;
  useBannerBackground?: boolean;
  useChatBackground?: boolean;
  iconRing?: boolean;
  category?: string;
  tags?: string[];
  slowModeSeconds?: number;
  memberCount?: number | null;
  onlineCount?: number | null;
  channels: HubRoom[];
  myRole: HubRole | null;
};

export type HubProfileValues = {
  name: string;
  icon: string;
  visibility: "private" | "public";
  description: string;
  accent: string;
  theme: HubTheme;
  useBannerBackground: boolean;
  useChatBackground: boolean;
  iconRing: boolean;
  category: string;
  tags: string;
  slowMode: number;
};

export type HubProfileSetters = { [K in keyof HubProfileValues]: (value: HubProfileValues[K]) => void };

export type HubAssetRow = { id: string; kind: "emote" | "sticker"; name: string; url: string };
export type HubAuditRow = { id: string; action: string; timestamp: string; detail?: string };

export type AuthorizedFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ManageHubSectionId =
  "overview" | "profile" | "roles" | "members" | "invites" | "rooms" | "events" | "moderation" | "bots" | "danger";

export type ManageHubPanelProps = {
  server: ManageHubServer;
  values: HubProfileValues;
  set: HubProfileSetters;
  apiBaseUrl: string;
  authorizedFetch: AuthorizedFetch;
  isOwner: boolean;
  canManage: boolean;
  currentUserId?: string | null;
  error?: string;
  renderAvatar: (person: { username: string; avatarUrl?: string | null }) => ReactNode;

  members: readonly HubMemberRow[];
  membersLoading: boolean;
  friends: readonly HubFriendRow[];
  friendsLoading: boolean;
  onAddFriend: (friend: HubFriendRow) => void;
  onChangeMemberRole: (member: HubMemberRow, role: "admin" | "member") => void;
  onAssignCustomRole: (member: HubMemberRow, roleId: string) => void;
  onModerateMember: (member: HubMemberRow, action: "timeout" | "ban") => void;
  onRemoveMember: (member: HubMemberRow) => void;

  roles: readonly HubCustomRole[];
  roleIconChoices?: readonly string[];
  onRolesChanged: () => Promise<void> | void;

  inviteUrl: string;
  inviteBusy: boolean;
  onCreateInvite: () => void;
  onCopyInvite: () => void;

  mediaBusy: boolean;
  mediaError?: string;
  onUploadMedia: (kind: "icon" | "banner" | "chat-background", file: File) => void;
  onRemoveMedia: (kind: "banner" | "chat-background") => void;

  assets: readonly HubAssetRow[];
  assetBusy: boolean;
  onUploadAsset: (kind: "emote" | "sticker", file: File) => void;
  onDeleteAsset: (asset: HubAssetRow) => void;
  auditLog: readonly HubAuditRow[];
  onLoadAudit: () => void;

  onOpenRoomSettings: (room: HubRoom) => void;
  onReorderRoom: (sourceId: number, targetId: number) => void;
  onCreateRoom: () => void;
  onOpenCalendar: () => void;
  onCreateEvent: () => void;

  botsPanel?: ReactNode;
  importPanel?: ReactNode;

  /** Persist profile/moderation fields without closing the panel. */
  onSave: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onClose: () => void;
};
