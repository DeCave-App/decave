// Hub and room management: create, join and leave Hubs, rooms and their order,
// members, roles, access, invites, media and assets, moderation and the audit log.

import type { Dispatch, SetStateAction, MutableRefObject, DragEvent as ReactDragEvent } from "react";
import type { HubTemplateId } from "../../../shared/hub-templates";
import { hubMediaDimensionMessage } from "../../features/manage-hub/hubMediaText";
import { measureImageFile } from "../../features/manage-hub/measureImage";
import { extractDiscordTemplateCode, type DiscordImportPreview } from "../../../shared/discord-template";
import type {
  ChannelType,
  ServerVisibility,
  CustomRoleView,
  Channel,
  HubAsset,
  Server,
  DiscoverServer,
  AccountUser,
  ChatMessage,
  ServerMemberView,
  ServerAccessUser,
  SocialUser,
  ApiError,
  DeleteServerResult,
  LeaveServerResult,
  DeleteChannelResult,
} from "../types";
import { HTTP_URL, HUB_SHARE_ROUTE_PREFIX } from "../env";
import { i18next } from "../../i18n/index.ts";
import { apiErrorMessage } from "../../i18n/apiError.ts";
import type { HubPanelsState } from "../state/hub-panels";

export type HubActionsDeps = {
  currentUser: AccountUser | null;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setShowAdminDashboard: Dispatch<SetStateAction<boolean>>;
  setShowHome: Dispatch<SetStateAction<boolean>>;
  setPendingHubShareCode: Dispatch<SetStateAction<string>>;
  setHubShareNotice: Dispatch<SetStateAction<string>>;
  setServers: Dispatch<SetStateAction<Server[]>>;
  setSelectedServer: Dispatch<SetStateAction<number>>;
  selectedServer: number;
  setSelectedChannel: Dispatch<SetStateAction<number>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setHubMembers: Dispatch<SetStateAction<ServerMemberView[]>>;
  setShowCreateServer: Dispatch<SetStateAction<boolean>>;
  newServerName: string;
  setNewServerName: Dispatch<SetStateAction<string>>;
  newServerVisibility: ServerVisibility;
  setNewServerVisibility: Dispatch<SetStateAction<ServerVisibility>>;
  newServerTemplate: HubTemplateId;
  setNewServerTemplate: Dispatch<SetStateAction<HubTemplateId>>;
  creatingServer: boolean;
  setCreatingServer: Dispatch<SetStateAction<boolean>>;
  discordImportPreview: DiscordImportPreview | null;
  setDiscordImportPreview: Dispatch<SetStateAction<DiscordImportPreview | null>>;
  setDiscordImportBusy: Dispatch<SetStateAction<boolean>>;
  setDiscordImportError: Dispatch<SetStateAction<string>>;
  setServerCreateError: Dispatch<SetStateAction<string>>;
  setShowServerBrowser: Dispatch<SetStateAction<boolean>>;
  setDiscoverError: Dispatch<SetStateAction<string>>;
  setShowCreateChannel: Dispatch<SetStateAction<boolean>>;
  setRoomReorderError: Dispatch<SetStateAction<string>>;
  newChannelName: string;
  setNewChannelName: Dispatch<SetStateAction<string>>;
  newChannelType: ChannelType;
  setNewChannelType: Dispatch<SetStateAction<ChannelType>>;
  newChannelIcon: string;
  setNewChannelIcon: Dispatch<SetStateAction<string>>;
  newChannelPrivate: boolean;
  setNewChannelPrivate: Dispatch<SetStateAction<boolean>>;
  newChannelMemberIds: string[];
  setNewChannelMemberIds: Dispatch<SetStateAction<string[]>>;
  newForumGuidelines: string;
  setNewForumGuidelines: Dispatch<SetStateAction<string>>;
  newForumPostPolicy: "everyone" | "staff" | "roles" | "members";
  setNewForumPostPolicy: Dispatch<SetStateAction<"everyone" | "staff" | "roles" | "members">>;
  newForumPostRoleIds: string[];
  setNewForumPostRoleIds: Dispatch<SetStateAction<string[]>>;
  newForumPostMemberIds: string[];
  setNewForumPostMemberIds: Dispatch<SetStateAction<string[]>>;
  setNewForumMemberSearch: Dispatch<SetStateAction<string>>;
  setChannelCreateError: Dispatch<SetStateAction<string>>;
  setShowManageServer: Dispatch<SetStateAction<boolean>>;
  manageServerName: string;
  setManageServerName: Dispatch<SetStateAction<string>>;
  manageServerIcon: string;
  setManageServerIcon: Dispatch<SetStateAction<string>>;
  manageServerVisibility: ServerVisibility;
  setManageServerVisibility: Dispatch<SetStateAction<ServerVisibility>>;
  setServerManageError: Dispatch<SetStateAction<string>>;
  manageServerDescription: string;
  setManageServerDescription: Dispatch<SetStateAction<string>>;
  manageServerAccent: string;
  setManageServerAccent: Dispatch<SetStateAction<string>>;
  manageServerTheme: "midnight" | "ember" | "forest" | "ocean";
  setManageServerTheme: Dispatch<SetStateAction<"midnight" | "ember" | "forest" | "ocean">>;
  setManageUseBannerBackground: Dispatch<SetStateAction<boolean>>;
  manageUseBannerBackground: boolean;
  setManageUseChatBackground: Dispatch<SetStateAction<boolean>>;
  manageUseChatBackground: boolean;
  manageServerCategory: string;
  setManageServerCategory: Dispatch<SetStateAction<string>>;
  manageServerTags: string;
  setManageServerTags: Dispatch<SetStateAction<string>>;
  manageSlowMode: number;
  setManageSlowMode: Dispatch<SetStateAction<number>>;
  setHubInviteCode: Dispatch<SetStateAction<string>>;
  hubInviteCode: string;
  setHubMemberSearch: Dispatch<SetStateAction<string>>;
  setHubFriendSearch: Dispatch<SetStateAction<string>>;
  setManageHubAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  setHubMemberMenuId: Dispatch<SetStateAction<string | null>>;
  hubShareBusy: boolean;
  setHubShareBusy: Dispatch<SetStateAction<boolean>>;
  manageHubIconRing: boolean;
  setManageHubIconRing: Dispatch<SetStateAction<boolean>>;
  inviteJoinCode: string;
  setInviteJoinCode: Dispatch<SetStateAction<string>>;
  setHubMediaBusy: Dispatch<SetStateAction<boolean>>;
  setHubMediaError: Dispatch<SetStateAction<string>>;
  setHubAuditLog: Dispatch<
    SetStateAction<
      { id: string; action: string; actorUserId: string; targetUserId?: string; detail?: string; timestamp: string }[]
    >
  >;
  setHubAssets: Dispatch<SetStateAction<HubAsset[]>>;
  setHubFeatureBusy: Dispatch<SetStateAction<boolean>>;
  setCustomRoles: Dispatch<SetStateAction<CustomRoleView[]>>;
  setServerMembers: Dispatch<SetStateAction<ServerMemberView[]>>;
  setMembersLoading: Dispatch<SetStateAction<boolean>>;
  setServerAccessUsers: Dispatch<SetStateAction<ServerAccessUser[]>>;
  setAccessLoading: Dispatch<SetStateAction<boolean>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setShowManageChannel: Dispatch<SetStateAction<boolean>>;
  setManageChannelId: Dispatch<SetStateAction<number>>;
  manageChannelId: number;
  setManageChannelServerId: Dispatch<SetStateAction<number>>;
  manageChannelServerId: number;
  setManageChannelName: Dispatch<SetStateAction<string>>;
  manageChannelName: string;
  setManageChannelIcon: Dispatch<SetStateAction<string>>;
  manageChannelIcon: string;
  setManageChannelPrivate: Dispatch<SetStateAction<boolean>>;
  manageChannelPrivate: boolean;
  setManageChannelMemberIds: Dispatch<SetStateAction<string[]>>;
  manageChannelMemberIds: string[];
  setManageChannelMemberSearch: Dispatch<SetStateAction<string>>;
  setManageForumGuidelines: Dispatch<SetStateAction<string>>;
  manageForumGuidelines: string;
  setManageForumPostPolicy: Dispatch<SetStateAction<"everyone" | "staff" | "roles" | "members">>;
  manageForumPostPolicy: "everyone" | "staff" | "roles" | "members";
  setManageForumPostRoleIds: Dispatch<SetStateAction<string[]>>;
  manageForumPostRoleIds: string[];
  setManageForumPostMemberIds: Dispatch<SetStateAction<string[]>>;
  manageForumPostMemberIds: string[];
  setManageForumMemberSearch: Dispatch<SetStateAction<string>>;
  setChannelManageError: Dispatch<SetStateAction<string>>;
  setDraggedChannelId: Dispatch<SetStateAction<number | null>>;
  draggedChannelRef: MutableRefObject<number | null>;
  socketRef: MutableRefObject<WebSocket | null>;
  activeServerRef: MutableRefObject<number>;
  activeChannelRef: MutableRefObject<number>;
  currentServer: Server;
  currentChannel: Channel;
  streamerHubsEnabled: boolean;
  canManageCurrentServer: boolean;
  canManageCurrentRooms: boolean;
  isCurrentServerOwner: boolean;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  loadServers: () => Promise<Server[] | null>;
  loadDiscoverServers: () => Promise<DiscoverServer[] | null>;
  loadMessages: (channelId: number) => Promise<void>;
  changeChannel: (channelId: number) => void;
  hubPanels: HubPanelsState;
};

/** Called once per render with that render's values. */
export function createHubActions(deps: HubActionsDeps) {
  const {
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
  } = deps;
  const { setShowHubHome, setShowStreamerOverview } = hubPanels;

  const createServer = async (iconFile: File | null = null) => {
    if (!currentUser || creatingServer) return;

    const name = newServerName.trim();
    if (!name) {
      setServerCreateError(i18next.t("hub.actions.create.nameMissing"));
      return;
    }

    setServerCreateError("");
    setCreatingServer(true);
    try {
      const templateId = newServerTemplate === "streamer" && !streamerHubsEnabled ? "blank" : newServerTemplate;
      const response = await authorizedFetch(`${HTTP_URL}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          visibility: newServerVisibility,
          templateId,
          discordImport: discordImportPreview,
        }),
      });
      const data = (await response.json()) as Server & ApiError;
      if (!response.ok) {
        setServerCreateError(apiErrorMessage(data, "client.hub.create"));
        return;
      }

      if (iconFile) {
        // Best effort: the Hub exists already, so an icon failure must not block entry.
        try {
          await authorizedFetch(`${HTTP_URL}/api/servers/${data.id}/media/icon`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream", "X-File-Type": iconFile.type },
            body: iconFile,
          });
        } catch (error) {
          console.error("Could not upload new Hub icon:", error);
        }
      }

      await loadServers();
      setShowCreateServer(false);
      setNewServerName("");
      setNewServerVisibility("private");
      setNewServerTemplate("blank");
      setDiscordImportPreview(null);
      setDiscordImportError("");
      void loadDiscoverServers();
      const firstChannel = data.channels.find((channel) => channel.type === "text") || data.channels[0];

      if (firstChannel) {
        activeServerRef.current = data.id;
        activeChannelRef.current = firstChannel.id;
        setSelectedServer(data.id);
        setSelectedChannel(firstChannel.id);
        setMessages([]);

        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "JOIN_SERVER", serverId: data.id }));
        }
      }
    } catch (error) {
      console.error("Could not create server:", error);
      setServerCreateError(i18next.t("errors.client.connect"));
    } finally {
      setCreatingServer(false);
    }
  };

  const loadDiscordTemplate = async (value: string) => {
    const code = extractDiscordTemplateCode(value);
    if (!code) {
      setDiscordImportError(i18next.t("hub.actions.import.templateUrlInvalid"));
      setDiscordImportPreview(null);
      return;
    }
    setDiscordImportBusy(true);
    setDiscordImportError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/discord/templates/${encodeURIComponent(code)}`);
      const data = (await response.json()) as DiscordImportPreview & ApiError;
      if (!response.ok) {
        setDiscordImportError(apiErrorMessage(data, "client.hub.templateFetch"));
        setDiscordImportPreview(null);
        return;
      }
      setDiscordImportPreview(data);
    } catch (error) {
      console.error("Could not load Discord template:", error);
      setDiscordImportError(i18next.t("hub.actions.import.previewOffline"));
      setDiscordImportPreview(null);
    } finally {
      setDiscordImportBusy(false);
    }
  };

  const joinPublicServer = async (serverId: number) => {
    setDiscoverError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/join`, {
        method: "POST",
      });
      const data = (await response.json()) as Server & ApiError;
      if (!response.ok) {
        setDiscoverError(apiErrorMessage(data, "client.hub.join"));
        return;
      }

      await loadServers();
      await loadDiscoverServers();
      setShowServerBrowser(false);
      setShowHubHome(true);

      const firstChannel = data.channels.find((channel) => channel.type === "text") || data.channels[0];
      if (!firstChannel) return;

      activeServerRef.current = data.id;
      activeChannelRef.current = firstChannel.id;
      setSelectedServer(data.id);
      setSelectedChannel(firstChannel.id);
      setMessages([]);

      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "JOIN_SERVER", serverId: data.id }));
      }
    } catch (error) {
      console.error("Could not join public server:", error);
      setDiscoverError(i18next.t("errors.client.connect"));
    }
  };

  const joinHubFromShareLink = async (code: string) => {
    if (!currentUser || !code) return;
    setHubShareNotice(i18next.t("hub.actions.share.opening"));
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/invites/${encodeURIComponent(code)}/join` /* DECAVE_PARITY_INVITE_ROUTE */,
        { method: "POST" },
      );
      const data = (await response.json().catch(() => ({}))) as Server & ApiError;
      if (!response.ok || !data.id) {
        setHubShareNotice(apiErrorMessage(data, "client.hub.shareInviteInvalid"));
        setPendingHubShareCode("");
        return;
      }

      await loadServers();
      void loadDiscoverServers();
      const firstChannel = data.channels.find((channel) => channel.type === "text") || data.channels[0];

      setShowHome(false);
      setShowSocial(false);
      setShowSettings(false);
      setShowServerBrowser(false);
      setShowAdminDashboard(false);
      activeServerRef.current = data.id;
      setSelectedServer(data.id);

      if (firstChannel) {
        activeChannelRef.current = firstChannel.id;
        setSelectedChannel(firstChannel.id);
        setMessages([]);
      }

      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "JOIN_SERVER", serverId: data.id }));
      }

      setPendingHubShareCode("");
      setHubShareNotice(i18next.t("hub.actions.share.opened", { name: data.name }));
      window.history.replaceState(null, "", "/");
    } catch {
      setHubShareNotice(i18next.t("hub.actions.share.offline"));
      setPendingHubShareCode("");
    }
  };

  const leaveServer = async () => {
    if (currentServer.myRole === "owner") return;
    const confirmed = window.confirm(i18next.t("hub.actions.leave.confirm", { name: currentServer.name }));
    if (!confirmed) return;

    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/leave`, {
        method: "POST",
      });
      const data = (await response.json()) as LeaveServerResult & ApiError;
      if (!response.ok) {
        window.alert(apiErrorMessage(data, "client.hub.leave"));
        return;
      }

      setShowManageServer(false);
      const loaded = await loadServers();
      void loadDiscoverServers();
      const fallback = loaded?.find((server) => server.id === data.fallbackServerId) || loaded?.[0];

      if (!fallback) {
        activeServerRef.current = 0;
        activeChannelRef.current = 0;
        setSelectedServer(0);
        setSelectedChannel(0);
        setMessages([]);
        return;
      }

      const firstChannel = fallback.channels.find((channel) => channel.type === "text") || fallback.channels[0];
      if (!firstChannel) return;

      activeServerRef.current = fallback.id;
      activeChannelRef.current = firstChannel.id;
      setSelectedServer(fallback.id);
      setSelectedChannel(firstChannel.id);
      setMessages([]);

      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "JOIN_SERVER", serverId: fallback.id }));
      }
    } catch (error) {
      console.error("Could not leave server:", error);
      window.alert(i18next.t("errors.client.connect"));
    }
  };

  const createChannel = async (extra: { forumTags?: string[] } = {}) => {
    const name = newChannelName.trim();
    if (!name) {
      setChannelCreateError(i18next.t("hub.actions.room.nameMissing"));
      return;
    }

    setChannelCreateError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${selectedServer}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type: newChannelType,
          icon: newChannelIcon,
          private: newChannelPrivate,
          memberIds: newChannelPrivate ? newChannelMemberIds : [],
          forumGuidelines: newChannelType === "forum" ? newForumGuidelines : "",
          forumPostPolicy: newChannelType === "forum" ? newForumPostPolicy : "everyone",
          forumPostRoleIds: newChannelType === "forum" && newForumPostPolicy === "roles" ? newForumPostRoleIds : [],
          forumPostMemberIds:
            newChannelType === "forum" && newForumPostPolicy === "members" ? newForumPostMemberIds : [],
          ...(newChannelType === "forum" && extra.forumTags ? { forumTags: extra.forumTags } : {}),
        }),
      });
      const data = (await response.json()) as Channel & ApiError;
      if (!response.ok) {
        setChannelCreateError(apiErrorMessage(data, "client.hub.createRoom"));
        return;
      }

      await loadServers();
      setShowCreateChannel(false);
      setNewChannelName("");
      setNewChannelPrivate(false);
      setNewChannelMemberIds([]);
      setNewForumGuidelines("");
      setNewForumPostPolicy("everyone");
      setNewForumPostRoleIds([]);
      setNewForumPostMemberIds([]);
      setNewForumMemberSearch("");
      setNewChannelIcon(newChannelType === "voice" ? "🔊" : newChannelType === "forum" ? "🗂️" : "💬");
      changeChannel(data.id);
    } catch (error) {
      console.error("Could not create channel:", error);
      setChannelCreateError(i18next.t("errors.client.connect"));
    }
  };

  const loadHubMembers = async (serverId: number) => {
    if (!serverId) {
      setHubMembers([]);
      return;
    }
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/members`);
      const data = (await response.json()) as ServerMemberView[] & ApiError;
      if (!response.ok || !Array.isArray(data)) {
        setHubMembers([]);
        return;
      }
      setHubMembers(data);
    } catch {
      setHubMembers([]);
    }
  };

  const loadServerMembers = async (serverId: number) => {
    setMembersLoading(true);
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/members`);
      const data = (await response.json()) as ServerMemberView[] & ApiError;
      if (!response.ok) {
        setServerManageError(apiErrorMessage(data, "client.hub.loadMembers"));
        setServerMembers([]);
        return;
      }
      setServerMembers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Could not load hub members:", error);
      setServerManageError(i18next.t("hub.actions.members.loadFailed"));
    } finally {
      setMembersLoading(false);
    }
  };

  const loadServerAccess = async (serverId: number) => {
    setAccessLoading(true);
    try {
      // Build the addable list from the user's real friend list and current Hub
      // membership. This avoids the old generic "registered users" access picker
      // and guarantees that only friends who are not already in the Hub appear.
      const [socialResponse, membersResponse] = await Promise.all([
        authorizedFetch(`${HTTP_URL}/api/social`),
        authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/members`),
      ]);

      if (socialResponse.ok && membersResponse.ok) {
        const social = (await socialResponse.json()) as { friends?: SocialUser[] };
        const members = (await membersResponse.json()) as ServerMemberView[];
        const memberIds = new Set((Array.isArray(members) ? members : []).map((member) => member.userId));
        const addable = (Array.isArray(social.friends) ? social.friends : [])
          .filter((friend) => !memberIds.has(friend.id))
          .map((friend): ServerAccessUser => ({
            userId: friend.id,
            username: friend.username,
            avatarUrl: friend.avatarUrl,
            hasAccess: false,
            role: null,
          }));
        setServerAccessUsers(addable);
        return;
      }

      // Compatibility fallback for older clients/backends.
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/access`);
      const data = (await response.json()) as
        { visibility?: ServerVisibility; users?: ServerAccessUser[]; error?: string } | ApiError;
      if (!response.ok) {
        setServerManageError(apiErrorMessage(data, "client.hub.loadAddableFriends"));
        setServerAccessUsers([]);
        return;
      }
      setServerAccessUsers("users" in data && Array.isArray(data.users) ? data.users : []);
    } catch (error) {
      console.error("Could not load addable Hub friends:", error);
      setServerManageError(i18next.t("errors.client.hub.loadAddableFriends"));
      setServerAccessUsers([]);
    } finally {
      setAccessLoading(false);
    }
  };

  const uploadHubMedia = async (kind: "icon" | "banner" | "header" | "chat-background", file: File) => {
    const limit = kind === "icon" ? 3 * 1024 * 1024 : 8 * 1024 * 1024;
    if (file.size > limit) {
      setHubMediaError(
        kind === "icon"
          ? i18next.t("hub.actions.media.iconTooLarge")
          : kind === "banner"
            ? i18next.t("hub.actions.media.bannerTooLarge")
            : kind === "header"
              ? i18next.t("hub.actions.media.headerTooLarge")
              : i18next.t("hub.actions.media.chatBackgroundTooLarge"),
      );
      return;
    }
    if (!file.type.startsWith("image/")) {
      setHubMediaError(i18next.t("hub.actions.media.notImage"));
      return;
    }
    if (kind !== "icon") {
      const dims = await measureImageFile(file);
      const dimensionError = hubMediaDimensionMessage(kind, dims?.width ?? NaN, dims?.height ?? NaN);
      if (dimensionError) {
        setHubMediaError(dimensionError);
        return;
      }
    }
    setHubMediaBusy(true);
    setHubMediaError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/media/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Type": file.type },
        body: file,
      });
      const data = (await response.json()) as ApiError;
      if (!response.ok) {
        setHubMediaError(apiErrorMessage(data, "client.hub.uploadMedia"));
        return;
      }
      await loadServers();
      if (kind === "chat-background") setManageUseChatBackground(true);
    } catch {
      setHubMediaError(i18next.t("errors.client.hub.uploadMedia"));
    } finally {
      setHubMediaBusy(false);
    }
  };

  const removeHubMedia = async (kind: "banner" | "header" | "chat-background") => {
    const confirmText =
      kind === "banner"
        ? i18next.t("hub.actions.media.confirmRemoveBanner")
        : kind === "header"
          ? i18next.t("hub.actions.media.confirmRemoveHeader")
          : i18next.t("hub.actions.media.confirmRemoveChatBackground");
    const failureKey =
      kind === "banner"
        ? "client.hub.removeBanner"
        : kind === "header"
          ? "client.hub.removeHeader"
          : "client.hub.removeChatBackground";
    if (!window.confirm(confirmText)) return;
    setHubMediaBusy(true);
    setHubMediaError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/media/${kind}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        setHubMediaError(apiErrorMessage(data, failureKey));
        return;
      }
      if (kind === "banner") setManageUseBannerBackground(false);
      else if (kind === "chat-background") setManageUseChatBackground(false);
      await loadServers();
    } catch {
      setHubMediaError(apiErrorMessage(null, failureKey));
    } finally {
      setHubMediaBusy(false);
    }
  };

  const loadHubFeatures = async (serverId = currentServer.id) => {
    try {
      const assetsResponse = await authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/assets`);
      if (assetsResponse.ok) setHubAssets((await assetsResponse.json()) as HubAsset[]);
    } catch {
      setServerManageError(i18next.t("hub.actions.media.loadFeaturesFailed"));
    }
  };

  const uploadHubAsset = async (kind: "emote" | "sticker", file: File) => {
    const suggested =
      file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^\p{L}\p{N}_-]/gu, "")
        .slice(0, 32) || kind;
    // The desktop app (Electron) has no window.prompt: use the file name there.
    let asked: string | null | undefined;
    try {
      asked =
        typeof window.prompt === "function" && !window.decaveDesktop?.isDesktop
          ? window.prompt(
              kind === "emote"
                ? i18next.t("hub.actions.assets.emoteNamePrompt")
                : i18next.t("hub.actions.assets.stickerNamePrompt"),
              suggested,
            )
          : suggested;
    } catch {
      asked = suggested;
    }
    if (asked === null) return; // Cancelled in the browser prompt.
    const name = (asked ?? suggested).trim() || suggested;
    setHubFeatureBusy(true);
    setServerManageError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/assets/${kind}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Type": file.type,
          "X-Asset-Name": encodeURIComponent(name),
        },
        body: file,
      });
      const data = (await response.json()) as ApiError;
      if (!response.ok) setServerManageError(apiErrorMessage(data, "client.hub.uploadAsset"));
      else await loadHubFeatures();
    } catch {
      setServerManageError(i18next.t("errors.client.hub.uploadAsset"));
    } finally {
      setHubFeatureBusy(false);
    }
  };

  const deleteHubAsset = async (asset: HubAsset) => {
    if (
      !window.confirm(
        asset.kind === "emote"
          ? i18next.t("hub.actions.assets.confirmDeleteEmote", { name: asset.name })
          : i18next.t("hub.actions.assets.confirmDeleteSticker", { name: asset.name }),
      )
    )
      return;
    await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/assets/${encodeURIComponent(asset.id)}`, {
      method: "DELETE",
    });
    await loadHubFeatures();
  };

  const joinByInviteCode = async () => {
    const code = inviteJoinCode.trim();
    if (!code) return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/invites/${encodeURIComponent(code)}/join`, {
        method: "POST",
      });
      const data = (await response.json()) as ApiError & { serverId?: number; channelId?: number };
      if (!response.ok) {
        setDiscoverError(apiErrorMessage(data, "client.hub.inviteInvalid"));
        return;
      }
      setInviteJoinCode("");
      setShowServerBrowser(false);
      await loadServers();
      if (data.serverId) {
        setSelectedServer(data.serverId);
        activeServerRef.current = data.serverId;
      }
      if (data.channelId) changeChannel(data.channelId);
    } catch {
      setDiscoverError(i18next.t("hub.actions.invite.useFailed"));
    }
  };

  const createHubInvite = async (_rotate = false, serverId = currentServer.id) => {
    if (!serverId || hubShareBusy) return;
    setHubShareBusy(true);
    setServerManageError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresHours: 24, maxUses: 1 }),
      });
      const data = (await response.json()) as { code?: string; error?: string };
      if (!response.ok || !data.code) {
        setServerManageError(apiErrorMessage(data, "client.hub.createInviteLink"));
        return;
      }
      setHubInviteCode(data.code);
    } catch {
      setServerManageError(i18next.t("errors.client.hub.createInviteLink"));
    } finally {
      setHubShareBusy(false);
    }
  };

  const hubInviteUrl = () => {
    if (!hubInviteCode) return "";
    const origin = window.location.origin;
    return `${origin}${HUB_SHARE_ROUTE_PREFIX}${encodeURIComponent(hubInviteCode)}`;
  };

  const loadCustomRoles = async (serverId = currentServer.id) => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/roles`);
      if (response.ok) setCustomRoles((await response.json()) as CustomRoleView[]);
    } catch (error) {
      console.warn("Could not load Hub roles:", error);
    }
  };

  const assignCustomRole = async (member: ServerMemberView, roleId: string) => {
    const response = await authorizedFetch(
      `${HTTP_URL}/api/servers/${currentServer.id}/members/${member.userId}/custom-roles`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleIds: roleId ? [roleId] : [] }),
      },
    );
    if (!response.ok) {
      const data = (await response.json()) as ApiError;
      setServerManageError(apiErrorMessage(data, "client.hub.assignRole"));
      return;
    }
    await loadServerMembers(currentServer.id);
  };

  const loadHubAudit = async () => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/audit`);
      if (response.ok) setHubAuditLog(await response.json());
    } catch (error) {
      console.warn("Could not load the Hub audit log:", error);
    }
  };

  const moderateHubMember = async (member: ServerMemberView, action: "kick" | "ban" | "timeout") => {
    if (
      !window.confirm(
        action === "kick"
          ? i18next.t("hub.actions.moderation.confirmKick", { username: member.username })
          : action === "ban"
            ? i18next.t("hub.actions.moderation.confirmBan", { username: member.username })
            : i18next.t("hub.actions.moderation.confirmTimeout", { username: member.username }),
      )
    )
      return;
    const path = action === "timeout" ? `timeout` : action;
    const response = await authorizedFetch(
      `${HTTP_URL}/api/servers/${currentServer.id}/members/${member.userId}/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "timeout" ? { minutes: 10 } : { reason: "Moderator action" }),
      },
    );
    if (!response.ok) {
      const data = (await response.json()) as ApiError;
      setServerManageError(
        apiErrorMessage(
          data,
          action === "kick" ? "client.hub.kick" : action === "ban" ? "client.hub.ban" : "client.hub.timeout",
        ),
      );
      return;
    }
    await loadServerMembers(currentServer.id);
    await loadHubAudit();
  };

  const saveManageHub = async (keepOpen = false) => {
    const name = manageServerName.trim();
    if (!name) {
      setServerManageError(i18next.t("hub.actions.settings.nameMissing"));
      return;
    }

    setServerManageError("");
    try {
      const renameResponse = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon: manageServerIcon.trim() }),
      });
      const renameData = (await renameResponse.json()) as ApiError;
      if (!renameResponse.ok) {
        setServerManageError(apiErrorMessage(renameData, "client.hub.saveIdentity"));
        return;
      }

      if (isCurrentServerOwner && manageServerVisibility !== currentServer.visibility) {
        const visibilityResponse = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/visibility`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: manageServerVisibility }),
        });
        const visibilityData = (await visibilityResponse.json()) as ApiError;
        if (!visibilityResponse.ok) {
          setServerManageError(apiErrorMessage(visibilityData, "client.hub.changePrivacy"));
          return;
        }
      }

      const settingsResponse = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: manageServerDescription,
          accent: manageServerAccent,
          theme: manageServerTheme,
          useBannerBackground: manageUseBannerBackground,
          useChatBackground: manageUseChatBackground,
          iconRing: manageHubIconRing,
          category: manageServerCategory,
          tags: manageServerTags
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          slowModeSeconds: manageSlowMode,
        }),
      });
      const settingsData = (await settingsResponse.json()) as ApiError;
      if (!settingsResponse.ok) {
        setServerManageError(apiErrorMessage(settingsData, "client.hub.saveSettings"));
        return;
      }

      await loadServers();
      await Promise.all([loadServerMembers(currentServer.id), loadServerAccess(currentServer.id)]);
      if (!keepOpen) setShowManageServer(false);
    } catch (error) {
      console.error("Could not save Hub settings:", error);
      setServerManageError(i18next.t("errors.client.connect"));
    }
  };

  const grantServerAccess = async (user: ServerAccessUser) => {
    if (!canManageCurrentServer) return;
    setServerManageError("");

    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/members/${user.userId}`, {
        method: "PUT",
      });
      const data = (await response.json()) as ApiError;
      if (!response.ok) {
        setServerManageError(apiErrorMessage(data, "client.hub.grantAccess"));
        return;
      }
      await loadServerAccess(currentServer.id);
      await loadServerMembers(currentServer.id);
      await loadServers();
    } catch (error) {
      console.error("Could not grant hub access:", error);
      setServerManageError(i18next.t("errors.client.connect"));
    }
  };

  const removeHubMemberDirectly = async (member: ServerMemberView) => {
    if (!canManageCurrentServer || member.role === "owner" || member.userId === currentUser?.id) return;
    if (currentServer.myRole === "admin" && member.role !== "member") return;
    if (
      !window.confirm(
        i18next.t("hub.actions.members.confirmRemove", { username: member.username, hub: currentServer.name }),
      )
    )
      return;

    setServerManageError("");
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/servers/${currentServer.id}/members/${encodeURIComponent(member.userId)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as ApiError;
      if (!response.ok) {
        setServerManageError(apiErrorMessage(data, "client.hub.removeMember"));
        return;
      }
      await Promise.all([loadServerMembers(currentServer.id), loadServerAccess(currentServer.id), loadServers()]);
    } catch {
      setServerManageError(i18next.t("errors.client.connect"));
    }
  };

  const openManageServer = () => {
    setShowHubHome(false);
    setShowStreamerOverview(false);
    setManageServerName(currentServer.name);
    setManageServerIcon(currentServer.icon);
    setManageServerVisibility(currentServer.visibility);
    setManageServerDescription(currentServer.description ?? "");
    setManageServerAccent(currentServer.accent ?? "#7c5cff");
    setManageServerTheme(currentServer.theme ?? "midnight");
    setManageUseBannerBackground(currentServer.useBannerBackground === true);
    setManageUseChatBackground(currentServer.useChatBackground === true);
    setManageHubIconRing(currentServer.iconRing === true);
    setManageServerCategory(currentServer.category ?? "Gaming");
    setManageServerTags((currentServer.tags ?? []).join(", "));
    setManageSlowMode(currentServer.slowModeSeconds ?? 0);
    setServerManageError("");
    setServerMembers([]);
    setServerAccessUsers([]);
    setHubMemberSearch("");
    setHubFriendSearch("");
    setManageHubAdvancedOpen(false);
    setHubMemberMenuId(null);
    setHubInviteCode("");
    setShowManageServer(true);
    void loadServerMembers(currentServer.id);
    void loadCustomRoles();
    void loadHubFeatures(currentServer.id);
    if (canManageCurrentServer) {
      void loadServerAccess(currentServer.id);
    }
  };

  const deleteServer = async (confirmedInDialog = false) => {
    if (!isCurrentServerOwner) {
      setServerManageError(i18next.t("hub.actions.delete.ownerOnly"));
      return;
    }

    const confirmed =
      confirmedInDialog || window.confirm(i18next.t("hub.actions.delete.confirm", { name: currentServer.name }));
    if (!confirmed) return;

    setServerManageError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}`, { method: "DELETE" });
      const data = (await response.json()) as DeleteServerResult & ApiError;
      if (!response.ok) {
        setServerManageError(apiErrorMessage(data, "client.hub.delete"));
        return;
      }

      setShowManageServer(false);
      await loadServers();
      void loadDiscoverServers();
      activeServerRef.current = data.fallbackServerId || 0;
      activeChannelRef.current = data.fallbackChannelId || 0;
      setSelectedServer(data.fallbackServerId || 0);
      setSelectedChannel(data.fallbackChannelId || 0);
      setMessages([]);
      if (data.fallbackChannelId > 0) void loadMessages(data.fallbackChannelId);
    } catch (error) {
      console.error("Could not delete server:", error);
      setServerManageError(i18next.t("errors.client.connect"));
    }
  };

  const changeMemberRole = async (member: ServerMemberView, role: "admin" | "member") => {
    setServerManageError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/members/${member.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = (await response.json()) as ApiError;
      if (!response.ok) {
        setServerManageError(apiErrorMessage(data, "client.hub.changeRole"));
        return;
      }
      await loadServerMembers(currentServer.id);
      if (isCurrentServerOwner) await loadServerAccess(currentServer.id);
      await loadServers();
    } catch (error) {
      console.error("Could not change member role:", error);
      setServerManageError(i18next.t("errors.client.connect"));
    }
  };

  const openManageChannel = () => {
    const roomId = currentChannel.id;
    const hubId = currentServer.id;
    setManageChannelId(roomId);
    setManageChannelServerId(hubId);
    setManageChannelName(currentChannel.name);
    setManageChannelIcon(currentChannel.icon ?? (currentChannel.type === "voice" ? "🔊" : "💬"));
    setManageChannelPrivate(Boolean(currentChannel.private));
    setManageForumGuidelines(currentChannel.forumGuidelines ?? "");
    setManageForumPostPolicy(currentChannel.forumPostPolicy ?? "everyone");
    setManageForumPostRoleIds(currentChannel.forumPostRoleIds ?? []);
    setManageForumPostMemberIds(currentChannel.forumPostMemberIds ?? []);
    setManageForumMemberSearch("");
    setManageChannelMemberIds([]);
    setManageChannelMemberSearch("");
    setChannelManageError("");
    setShowManageChannel(true);
    void loadHubMembers(hubId);
    if (currentChannel.type === "forum" || currentChannel.type === "text") void loadCustomRoles(hubId);
    void (async () => {
      try {
        const response = await authorizedFetch(`${HTTP_URL}/api/channels/${roomId}/access`);
        const data = (await response.json()) as { private?: boolean; memberIds?: string[]; error?: string };
        if (!response.ok) {
          setChannelManageError(apiErrorMessage(data, "client.hub.loadRoomAccess"));
          return;
        }
        setManageChannelPrivate(data.private === true);
        setManageChannelMemberIds(Array.isArray(data.memberIds) ? data.memberIds : []);
      } catch {
        setChannelManageError(i18next.t("errors.client.hub.loadRoomAccess"));
      }
    })();
  };

  const renameChannel = async (
    extra: {
      forumTags?: string[];
      userLimit?: number;
      postPolicy?: string;
      postRoleIds?: string[];
      /** '#rrggbb', null = Hub accent; undefined leaves it unchanged. */
      accent?: string | null;
      /** A new background image, null to remove it; undefined leaves it unchanged. */
      background?: File | null;
    } = {},
  ) => {
    const name = manageChannelName.trim();
    const roomId = manageChannelId || currentChannel.id;
    const hubId = manageChannelServerId || currentServer.id;
    if (!name) {
      setChannelManageError(i18next.t("hub.actions.room.nameMissing"));
      return;
    }
    if (!roomId) {
      setChannelManageError(i18next.t("hub.actions.room.unidentified"));
      return;
    }

    setChannelManageError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/channels/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          icon: manageChannelIcon,
          private: manageChannelPrivate,
          memberIds: manageChannelPrivate ? manageChannelMemberIds : [],
          forumGuidelines: manageForumGuidelines,
          forumPostPolicy: manageForumPostPolicy,
          forumPostRoleIds: manageForumPostPolicy === "roles" ? manageForumPostRoleIds : [],
          forumPostMemberIds: manageForumPostPolicy === "members" ? manageForumPostMemberIds : [],
          ...(extra.forumTags ? { forumTags: extra.forumTags } : {}),
          ...(extra.userLimit !== undefined ? { userLimit: extra.userLimit } : {}),
          ...(extra.postPolicy !== undefined
            ? { postPolicy: extra.postPolicy, postRoleIds: extra.postRoleIds ?? [] }
            : {}),
          ...(extra.accent !== undefined ? { accent: extra.accent } : {}),
        }),
      });
      const data = (await response.json()) as ApiError & { private?: boolean; icon?: string; name?: string };
      if (!response.ok) {
        setChannelManageError(apiErrorMessage(data, "client.hub.saveRoom"));
        return;
      }
      if (extra.background !== undefined) {
        const upload = await authorizedFetch(`${HTTP_URL}/api/channels/${roomId}/media/background`, {
          method: extra.background ? "POST" : "DELETE",
          ...(extra.background
            ? {
                headers: { "Content-Type": "application/octet-stream", "X-File-Type": extra.background.type },
                body: extra.background,
              }
            : {}),
        });
        if (!upload.ok) {
          const failed = (await upload.json().catch(() => ({}))) as ApiError;
          setChannelManageError(apiErrorMessage(failed, "client.hub.roomBackground"));
          await loadServers();
          return;
        }
      }

      // Reflect the privacy change immediately, then refresh from the server.
      setServers((current) =>
        current.map((server) =>
          server.id !== hubId
            ? server
            : {
                ...server,
                channels: server.channels.map((channel) =>
                  channel.id !== roomId
                    ? channel
                    : {
                        ...channel,
                        name,
                        icon: manageChannelIcon,
                        private: manageChannelPrivate,
                        forumGuidelines: manageForumGuidelines,
                        forumPostPolicy: manageForumPostPolicy,
                        forumPostRoleIds: manageForumPostPolicy === "roles" ? manageForumPostRoleIds : [],
                        forumPostMemberIds: manageForumPostPolicy === "members" ? manageForumPostMemberIds : [],
                        ...(extra.accent !== undefined ? { accent: extra.accent } : {}),
                      },
                ),
              },
        ),
      );
      await loadServers();
      setShowManageChannel(false);
    } catch (error) {
      console.error("Could not save room settings:", error);
      setChannelManageError(i18next.t("errors.client.connect"));
    }
  };

  const reorderChannel = async (sourceId: number, targetId: number) => {
    if (!canManageCurrentRooms || sourceId === targetId) return;
    setRoomReorderError("");
    const source = currentServer.channels.find((channel) => channel.id === sourceId);
    const target = currentServer.channels.find((channel) => channel.id === targetId);
    if (!source || !target || source.type !== target.type) return;
    const group = currentServer.channels.filter((channel) => channel.type === source.type);
    const from = group.findIndex((channel) => channel.id === sourceId);
    const to = group.findIndex((channel) => channel.id === targetId);
    if (from < 0 || to < 0) return;
    const ordered = [...group];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setServers((current) =>
      current.map((server) =>
        server.id !== currentServer.id
          ? server
          : {
              ...server,
              channels: server.channels.map((channel) => {
                const index = ordered.findIndex((item) => item.id === channel.id);
                return index < 0 ? channel : { ...channel, position: index };
              }),
            },
      ),
    );
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/channels/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: ordered.map((channel) => channel.id) }),
      });
      if (!response.ok)
        throw new Error(
          apiErrorMessage((await response.json().catch(() => ({}))) as ApiError, "client.hub.reorderRooms"),
        );
      await loadServers();
    } catch (error) {
      // F10: surface reorder failures next to the room list (was hidden in the room-settings modal state).
      setRoomReorderError(error instanceof Error ? error.message : i18next.t("errors.client.hub.reorderRooms"));
      await loadServers();
    }
  };

  const openCreateRoomOfType = (type: "text" | "voice" | "forum") => {
    setNewChannelName("");
    setNewChannelType(type);
    setNewChannelIcon(type === "voice" ? "🔊" : type === "forum" ? "🗂️" : "💬");
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
  };

  const channelDragProps = (channel: Channel) => ({
    draggable: canManageCurrentRooms,
    onDragStart: (event: ReactDragEvent<HTMLElement>) => {
      draggedChannelRef.current = channel.id;
      setDraggedChannelId(channel.id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(channel.id));
    },
    onDragEnter: (event: ReactDragEvent<HTMLElement>) => {
      if (canManageCurrentRooms) event.preventDefault();
    },
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (canManageCurrentRooms) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = draggedChannelRef.current ?? Number(event.dataTransfer.getData("text/plain"));
      draggedChannelRef.current = null;
      setDraggedChannelId(null);
      if (Number.isSafeInteger(sourceId)) void reorderChannel(sourceId, channel.id);
    },
    onDragEnd: () => {
      draggedChannelRef.current = null;
      setDraggedChannelId(null);
    },
  });

  const deleteChannel = async (confirmedInDialog = false) => {
    const roomId = manageChannelId || currentChannel.id;
    const confirmed =
      confirmedInDialog ||
      window.confirm(i18next.t("hub.actions.room.confirmDelete", { name: manageChannelName || currentChannel.name }));
    if (!confirmed) return;

    setChannelManageError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/channels/${roomId}`, { method: "DELETE" });
      const data = (await response.json()) as DeleteChannelResult & ApiError;
      if (!response.ok) {
        setChannelManageError(apiErrorMessage(data, "client.hub.deleteRoom"));
        return;
      }

      setShowManageChannel(false);
      await loadServers();
      activeServerRef.current = data.serverId;
      activeChannelRef.current = data.fallbackChannelId;
      setSelectedServer(data.serverId);
      setSelectedChannel(data.fallbackChannelId);
      setMessages([]);
      void loadMessages(data.fallbackChannelId);
    } catch (error) {
      console.error("Could not delete channel:", error);
      setChannelManageError(i18next.t("errors.client.connect"));
    }
  };

  return {
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
  };
}
