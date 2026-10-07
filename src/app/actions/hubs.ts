// Hub and room management: create, join and leave Hubs, rooms and their order,
// members, roles, access, invites, media and assets, moderation and the audit log.

import type { Dispatch, SetStateAction, MutableRefObject, DragEvent as ReactDragEvent } from "react";
import type { HubTemplateId } from "../../../shared/hub-templates";
import { validateHubMediaDimensions } from "../../../shared/hub-media-specs";
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
      setServerCreateError("Enter a hub name.");
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
        setServerCreateError(data.error || "Could not create hub.");
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
      setServerCreateError("Could not connect to DeCave.");
    } finally {
      setCreatingServer(false);
    }
  };

  const loadDiscordTemplate = async (value: string) => {
    const code = extractDiscordTemplateCode(value);
    if (!code) {
      setDiscordImportError("Enter a supported Discord Server Template URL.");
      setDiscordImportPreview(null);
      return;
    }
    setDiscordImportBusy(true);
    setDiscordImportError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/discord/templates/${encodeURIComponent(code)}`);
      const data = (await response.json()) as DiscordImportPreview & ApiError;
      if (!response.ok) {
        setDiscordImportError(data.error || "Discord template could not be retrieved.");
        setDiscordImportPreview(null);
        return;
      }
      setDiscordImportPreview(data);
    } catch (error) {
      console.error("Could not load Discord template:", error);
      setDiscordImportError("Could not connect to DeCave to preview this template.");
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
        setDiscoverError(data.error || "Could not join hub.");
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
      setDiscoverError("Could not connect to DeCave.");
    }
  };

  const joinHubFromShareLink = async (code: string) => {
    if (!currentUser || !code) return;
    setHubShareNotice("Opening shared Hub...");
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/invites/${encodeURIComponent(code)}/join` /* DECAVE_PARITY_INVITE_ROUTE */,
        { method: "POST" },
      );
      const data = (await response.json().catch(() => ({}))) as Server & ApiError;
      if (!response.ok || !data.id) {
        setHubShareNotice(data.error || "This one-time Hub invite could not be used.");
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
      setHubShareNotice(`Opened ${data.name}.`);
      window.history.replaceState(null, "", "/");
    } catch {
      setHubShareNotice("Could not connect to this shared Hub.");
      setPendingHubShareCode("");
    }
  };

  const leaveServer = async () => {
    if (currentServer.myRole === "owner") return;
    const confirmed = window.confirm(`Leave server "${currentServer.name}"?`);
    if (!confirmed) return;

    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/leave`, {
        method: "POST",
      });
      const data = (await response.json()) as LeaveServerResult & ApiError;
      if (!response.ok) {
        window.alert(data.error || "Could not leave hub.");
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
      window.alert("Could not connect to DeCave.");
    }
  };

  const createChannel = async (extra: { forumTags?: string[] } = {}) => {
    const name = newChannelName.trim();
    if (!name) {
      setChannelCreateError("Enter a room name.");
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
        setChannelCreateError(data.error || "Could not create room.");
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
      setChannelCreateError("Could not connect to DeCave.");
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
        setServerManageError(data.error || "Could not load members.");
        setServerMembers([]);
        return;
      }
      setServerMembers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Could not load hub members:", error);
      setServerManageError("Could not load hub members.");
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
        setServerManageError(data.error || "Could not load friends who can be added.");
        setServerAccessUsers([]);
        return;
      }
      setServerAccessUsers("users" in data && Array.isArray(data.users) ? data.users : []);
    } catch (error) {
      console.error("Could not load addable Hub friends:", error);
      setServerManageError("Could not load friends who can be added.");
      setServerAccessUsers([]);
    } finally {
      setAccessLoading(false);
    }
  };

  const uploadHubMedia = async (kind: "icon" | "banner" | "chat-background", file: File) => {
    const limit = kind === "icon" ? 3 * 1024 * 1024 : 8 * 1024 * 1024;
    const label = kind === "icon" ? "Icon" : kind === "banner" ? "Banner" : "Chat background";
    if (file.size > limit) {
      setHubMediaError(`${label} is too large.`);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setHubMediaError("Choose an image file.");
      return;
    }
    if (kind !== "icon") {
      const dims = await measureImageFile(file);
      const dimensionError = validateHubMediaDimensions(kind, dims?.width ?? NaN, dims?.height ?? NaN);
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
        setHubMediaError(data.error || "Could not upload Hub image.");
        return;
      }
      await loadServers();
      if (kind === "chat-background") setManageUseChatBackground(true);
    } catch {
      setHubMediaError("Could not upload Hub image.");
    } finally {
      setHubMediaBusy(false);
    }
  };

  const removeHubMedia = async (kind: "banner" | "chat-background") => {
    const label = kind === "banner" ? "sidebar banner" : "chat background";
    if (!window.confirm(`Remove the ${label}? This deletes the image from this Hub.`)) return;
    setHubMediaBusy(true);
    setHubMediaError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/media/${kind}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiError;
        setHubMediaError(data.error || `Could not remove the ${label}.`);
        return;
      }
      if (kind === "banner") setManageUseBannerBackground(false);
      else setManageUseChatBackground(false);
      await loadServers();
    } catch {
      setHubMediaError(`Could not remove the ${label}.`);
    } finally {
      setHubMediaBusy(false);
    }
  };

  const loadHubFeatures = async (serverId = currentServer.id) => {
    try {
      const assetsResponse = await authorizedFetch(`${HTTP_URL}/api/servers/${serverId}/assets`);
      if (assetsResponse.ok) setHubAssets((await assetsResponse.json()) as HubAsset[]);
    } catch {
      setServerManageError("Could not load Hub apps and media.");
    }
  };

  const uploadHubAsset = async (kind: "emote" | "sticker", file: File) => {
    const suggested =
      file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^\p{L}\p{N}_-]/gu, "")
        .slice(0, 32) || kind;
    const name = window.prompt(`${kind === "emote" ? "Emote" : "Sticker"} name`, suggested)?.trim();
    if (!name) return;
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
      if (!response.ok) setServerManageError(data.error || "Could not upload custom media.");
      else await loadHubFeatures();
    } catch {
      setServerManageError("Could not upload custom media.");
    } finally {
      setHubFeatureBusy(false);
    }
  };

  const deleteHubAsset = async (asset: HubAsset) => {
    if (!window.confirm(`Delete ${asset.kind} “${asset.name}”?`)) return;
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
        setDiscoverError(data.error || "Invite could not be used.");
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
      setDiscoverError("Could not use invite.");
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
        setServerManageError(data.error || "Could not create one-time Hub invite link.");
        return;
      }
      setHubInviteCode(data.code);
    } catch {
      setServerManageError("Could not create one-time Hub invite link.");
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
      setServerManageError(data.error || "Could not assign custom role.");
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
    if (!window.confirm(`${action.toUpperCase()} ${member.username}?`)) return;
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
      setServerManageError(data.error || `Could not ${action} user.`);
      return;
    }
    await loadServerMembers(currentServer.id);
    await loadHubAudit();
  };

  const saveManageHub = async (keepOpen = false) => {
    const name = manageServerName.trim();
    if (!name) {
      setServerManageError("Enter a Hub name.");
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
        setServerManageError(renameData.error || "Could not save Hub identity.");
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
          setServerManageError(visibilityData.error || "Could not change Hub privacy.");
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
        setServerManageError(settingsData.error || "Could not save Hub settings.");
        return;
      }

      await loadServers();
      await Promise.all([loadServerMembers(currentServer.id), loadServerAccess(currentServer.id)]);
      if (!keepOpen) setShowManageServer(false);
    } catch (error) {
      console.error("Could not save Hub settings:", error);
      setServerManageError("Could not connect to DeCave.");
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
        setServerManageError(data.error || "Could not grant hub access.");
        return;
      }
      await loadServerAccess(currentServer.id);
      await loadServerMembers(currentServer.id);
      await loadServers();
    } catch (error) {
      console.error("Could not grant hub access:", error);
      setServerManageError("Could not connect to DeCave.");
    }
  };

  const removeHubMemberDirectly = async (member: ServerMemberView) => {
    if (!canManageCurrentServer || member.role === "owner" || member.userId === currentUser?.id) return;
    if (currentServer.myRole === "admin" && member.role !== "member") return;
    if (!window.confirm(`Remove ${member.username} from "${currentServer.name}"?`)) return;

    setServerManageError("");
    try {
      const response = await authorizedFetch(
        `${HTTP_URL}/api/servers/${currentServer.id}/members/${encodeURIComponent(member.userId)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as ApiError;
      if (!response.ok) {
        setServerManageError(data.error || "Could not remove Hub member.");
        return;
      }
      await Promise.all([loadServerMembers(currentServer.id), loadServerAccess(currentServer.id), loadServers()]);
    } catch {
      setServerManageError("Could not connect to DeCave.");
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
      setServerManageError("Only the hub owner can delete this server.");
      return;
    }

    const confirmed =
      confirmedInDialog ||
      window.confirm(
        `Delete server "${currentServer.name}"?\n\nThis also deletes all of its rooms and saved messages.`,
      );
    if (!confirmed) return;

    setServerManageError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}`, { method: "DELETE" });
      const data = (await response.json()) as DeleteServerResult & ApiError;
      if (!response.ok) {
        setServerManageError(data.error || "Could not delete hub.");
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
      setServerManageError("Could not connect to DeCave.");
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
        setServerManageError(data.error || "Could not change member role.");
        return;
      }
      await loadServerMembers(currentServer.id);
      if (isCurrentServerOwner) await loadServerAccess(currentServer.id);
      await loadServers();
    } catch (error) {
      console.error("Could not change member role:", error);
      setServerManageError("Could not connect to DeCave.");
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
    if (currentChannel.type === "forum") void loadCustomRoles(hubId);
    void (async () => {
      try {
        const response = await authorizedFetch(`${HTTP_URL}/api/channels/${roomId}/access`);
        const data = (await response.json()) as { private?: boolean; memberIds?: string[]; error?: string };
        if (!response.ok) {
          setChannelManageError(data.error || "Could not load room access.");
          return;
        }
        setManageChannelPrivate(data.private === true);
        setManageChannelMemberIds(Array.isArray(data.memberIds) ? data.memberIds : []);
      } catch {
        setChannelManageError("Could not load room access.");
      }
    })();
  };

  const renameChannel = async (extra: { forumTags?: string[] } = {}) => {
    const name = manageChannelName.trim();
    const roomId = manageChannelId || currentChannel.id;
    const hubId = manageChannelServerId || currentServer.id;
    if (!name) {
      setChannelManageError("Enter a room name.");
      return;
    }
    if (!roomId) {
      setChannelManageError("Room could not be identified. Reopen Room Settings and try again.");
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
        }),
      });
      const data = (await response.json()) as ApiError & { private?: boolean; icon?: string; name?: string };
      if (!response.ok) {
        setChannelManageError(data.error || "Could not save room settings.");
        return;
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
                      },
                ),
              },
        ),
      );
      await loadServers();
      setShowManageChannel(false);
    } catch (error) {
      console.error("Could not save room settings:", error);
      setChannelManageError("Could not connect to DeCave.");
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
        throw new Error(((await response.json().catch(() => ({}))) as ApiError).error || "Could not reorder rooms.");
      await loadServers();
    } catch (error) {
      // F10: surface reorder failures next to the room list (was hidden in the room-settings modal state).
      setRoomReorderError(error instanceof Error ? error.message : "Could not reorder rooms.");
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
      window.confirm(
        `Delete room "${manageChannelName || currentChannel.name}"?\n\nSaved messages in this room will also be deleted.`,
      );
    if (!confirmed) return;

    setChannelManageError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/channels/${roomId}`, { method: "DELETE" });
      const data = (await response.json()) as DeleteChannelResult & ApiError;
      if (!response.ok) {
        setChannelManageError(data.error || "Could not delete room.");
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
      setChannelManageError("Could not connect to DeCave.");
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
