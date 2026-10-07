// Opening the person and Hub/room context menus and their actions: manage a Hub or
// room, copy text, copy a Hub share link.

import type { Dispatch, SetStateAction, MutableRefObject, MouseEvent as ReactMouseEvent } from "react";
import type {
  ServerVisibility,
  Channel,
  Server,
  AccountUser,
  ServerMemberView,
  ServerAccessUser,
  SocialUser,
  UserContextTarget,
  UserContextMenuState,
  ResourceContextTarget,
  ResourceContextMenuState,
} from "../types";
import { HTTP_URL, HUB_SHARE_ROUTE_PREFIX } from "../env";
import type { HubPanelsState } from "../state/hub-panels";

export type ContextMenuActionsDeps = {
  currentUser: AccountUser | null;
  setHubShareNotice: Dispatch<SetStateAction<string>>;
  setSelectedServer: Dispatch<SetStateAction<number>>;
  setSelectedChannel: Dispatch<SetStateAction<number>>;
  setShowManageServer: Dispatch<SetStateAction<boolean>>;
  setManageServerName: Dispatch<SetStateAction<string>>;
  setManageServerIcon: Dispatch<SetStateAction<string>>;
  setManageServerVisibility: Dispatch<SetStateAction<ServerVisibility>>;
  setServerManageError: Dispatch<SetStateAction<string>>;
  setManageServerDescription: Dispatch<SetStateAction<string>>;
  setManageServerAccent: Dispatch<SetStateAction<string>>;
  setManageServerTheme: Dispatch<SetStateAction<"midnight" | "ember" | "forest" | "ocean">>;
  setManageUseBannerBackground: Dispatch<SetStateAction<boolean>>;
  setManageUseChatBackground: Dispatch<SetStateAction<boolean>>;
  setManageServerCategory: Dispatch<SetStateAction<string>>;
  setManageServerTags: Dispatch<SetStateAction<string>>;
  setManageSlowMode: Dispatch<SetStateAction<number>>;
  setHubInviteCode: Dispatch<SetStateAction<string>>;
  setHubMemberSearch: Dispatch<SetStateAction<string>>;
  setHubFriendSearch: Dispatch<SetStateAction<string>>;
  setManageHubAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  setHubMemberMenuId: Dispatch<SetStateAction<string | null>>;
  setManageHubIconRing: Dispatch<SetStateAction<boolean>>;
  setServerMembers: Dispatch<SetStateAction<ServerMemberView[]>>;
  setServerAccessUsers: Dispatch<SetStateAction<ServerAccessUser[]>>;
  setUserContextMenu: Dispatch<SetStateAction<UserContextMenuState | null>>;
  setProfileDetails: Dispatch<SetStateAction<Record<string, SocialUser>>>;
  setResourceContextMenu: Dispatch<SetStateAction<ResourceContextMenuState | null>>;
  setResourceContextMoreOpen: Dispatch<SetStateAction<boolean>>;
  setShowManageChannel: Dispatch<SetStateAction<boolean>>;
  setManageChannelId: Dispatch<SetStateAction<number>>;
  setManageChannelServerId: Dispatch<SetStateAction<number>>;
  setManageChannelName: Dispatch<SetStateAction<string>>;
  setManageChannelIcon: Dispatch<SetStateAction<string>>;
  setManageChannelPrivate: Dispatch<SetStateAction<boolean>>;
  setManageChannelMemberIds: Dispatch<SetStateAction<string[]>>;
  setManageChannelMemberSearch: Dispatch<SetStateAction<string>>;
  setManageForumGuidelines: Dispatch<SetStateAction<string>>;
  setManageForumPostPolicy: Dispatch<SetStateAction<"everyone" | "staff" | "roles" | "members">>;
  setManageForumPostRoleIds: Dispatch<SetStateAction<string[]>>;
  setManageForumPostMemberIds: Dispatch<SetStateAction<string[]>>;
  setManageForumMemberSearch: Dispatch<SetStateAction<string>>;
  setChannelManageError: Dispatch<SetStateAction<string>>;
  activeServerRef: MutableRefObject<number>;
  activeChannelRef: MutableRefObject<number>;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  loadServerMembers: (serverId: number) => Promise<void>;
  loadCustomRoles: (serverId?: number) => Promise<void>;
  loadHubFeatures: (serverId?: number) => Promise<void>;
  loadServerAccess: (serverId: number) => Promise<void>;
  loadHubMembers: (serverId: number) => Promise<void>;
  hubPanels: HubPanelsState;
};

/** Called once per render with that render's values. */
export function createContextMenuActions(deps: ContextMenuActionsDeps) {
  const {
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
  } = deps;
  const { setShowHubHome, setShowStreamerOverview } = hubPanels;

  const openUserContextMenu = (event: ReactMouseEvent, target: UserContextTarget) => {
    if (!currentUser) return;
    event.preventDefault();
    event.stopPropagation();

    const isSelf = target.userId === currentUser.id;
    const isTopProfileMenu = target.source === "top-profile";
    const menuWidth = isTopProfileMenu ? 360 : 288;
    const menuHeight = isSelf ? 650 : target.connectionId ? 610 : 500;

    const anchor = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    const clickX = event.clientX > 0 ? event.clientX : (anchor?.right ?? 12);
    const clickY = event.clientY > 0 ? event.clientY : (anchor?.top ?? 12);
    const preferredX =
      isTopProfileMenu && anchor
        ? Math.min(window.innerWidth - menuWidth - 12, Math.max(12, anchor.right - menuWidth))
        : clickX + menuWidth + 12 <= window.innerWidth
          ? clickX + 8
          : clickX - menuWidth - 8;
    const preferredY =
      isTopProfileMenu && anchor
        ? anchor.bottom + 10 + menuHeight <= window.innerHeight
          ? anchor.bottom + 10
          : anchor.top - menuHeight - 10
        : clickY + menuHeight + 12 <= window.innerHeight
          ? clickY + 8
          : clickY - menuHeight - 8;
    const anchoredX = Math.max(12, Math.min(preferredX, window.innerWidth - menuWidth - 12));
    const anchoredY = Math.max(12, Math.min(preferredY, window.innerHeight - menuHeight - 12));
    setUserContextMenu({
      x: Math.round(anchoredX),
      y: Math.round(anchoredY),
      target,
    });
    if (!isSelf)
      void authorizedFetch(`${HTTP_URL}/api/users/${encodeURIComponent(target.userId)}/profile`)
        .then(async (response) => {
          if (!response.ok) return;
          const profile = (await response.json()) as SocialUser;
          setProfileDetails((current) => ({ ...current, [target.userId]: profile }));
        })
        .catch((error) => console.warn("Could not load the profile card:", error));
  };

  const openResourceContextMenu = (event: ReactMouseEvent, target: ResourceContextTarget) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 224;
    const estimatedHeight = target.kind === "hub" ? 430 : 320;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(event.clientY, window.innerHeight - estimatedHeight - 12);

    setUserContextMenu(null);
    setResourceContextMoreOpen(false);
    setResourceContextMenu({
      x: Math.max(12, x),
      y: Math.max(12, y),
      target,
    });
  };

  const openManageServerFor = (server: Server) => {
    setSelectedServer(server.id);
    activeServerRef.current = server.id;
    setManageServerName(server.name);
    setManageServerIcon(server.icon);
    setManageServerVisibility(server.visibility);
    setManageServerDescription(server.description ?? "");
    setManageServerAccent(server.accent ?? "#7c5cff");
    setManageServerTheme(server.theme ?? "midnight");
    setManageUseBannerBackground(server.useBannerBackground === true);
    setManageUseChatBackground(server.useChatBackground === true);
    setManageHubIconRing(server.iconRing === true);
    setManageServerCategory(server.category ?? "Gaming");
    setManageServerTags((server.tags ?? []).join(", "));
    setManageSlowMode(server.slowModeSeconds ?? 0);
    setServerManageError("");
    setServerMembers([]);
    setServerAccessUsers([]);
    setHubMemberSearch("");
    setHubFriendSearch("");
    setManageHubAdvancedOpen(false);
    setHubMemberMenuId(null);
    setHubInviteCode("");
    setShowHubHome(false);
    setShowStreamerOverview(false);
    setShowManageServer(true);
    void loadServerMembers(server.id);
    void loadCustomRoles(server.id);
    void loadHubFeatures(server.id);
    if (server.myRole === "owner" || server.myRole === "admin") {
      void loadServerAccess(server.id);
    }
  };

  const openManageChannelFor = (server: Server, channel: Channel) => {
    setSelectedServer(server.id);
    activeServerRef.current = server.id;
    setSelectedChannel(channel.id);
    activeChannelRef.current = channel.id;
    setManageChannelId(channel.id);
    setManageChannelServerId(server.id);
    setManageChannelName(channel.name);
    setManageChannelIcon(channel.icon || (channel.type === "voice" ? "🔊" : "💬"));
    setManageChannelPrivate(Boolean(channel.private));
    setManageForumGuidelines(channel.forumGuidelines ?? "");
    setManageForumPostPolicy(channel.forumPostPolicy ?? "everyone");
    setManageForumPostRoleIds(channel.forumPostRoleIds ?? []);
    setManageForumPostMemberIds(channel.forumPostMemberIds ?? []);
    setManageForumMemberSearch("");
    setManageChannelMemberIds([]);
    setManageChannelMemberSearch("");
    setChannelManageError("");
    setShowManageChannel(true);
    void loadHubMembers(server.id);
    if (channel.type === "forum") void loadCustomRoles(server.id);
    void (async () => {
      try {
        const response = await authorizedFetch(`${HTTP_URL}/api/channels/${channel.id}/access`);
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

  const copyResourceText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setResourceContextMenu(null);
    setResourceContextMoreOpen(false);
  };

  const copyHubShareLink = async (server: Server) => {
    setHubShareNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/${server.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresHours: 24, maxUses: 1 }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
      };
      if (!response.ok || !data.code) {
        setHubShareNotice(data.error || "Could not create a one-time Hub invite link.");
        setResourceContextMenu(null);
        setResourceContextMoreOpen(false);
        return;
      }
      const origin = window.location.origin;
      const link = `${origin}${HUB_SHARE_ROUTE_PREFIX}${encodeURIComponent(data.code)}`;
      await copyResourceText(link);
      setHubShareNotice(`One-time invite copied for ${server.name}.`);
    } catch {
      setHubShareNotice("Could not create a one-time Hub invite link.");
      setResourceContextMenu(null);
      setResourceContextMoreOpen(false);
    }
  };

  return {
    openUserContextMenu,
    openResourceContextMenu,
    openManageServerFor,
    openManageChannelFor,
    copyResourceText,
    copyHubShareLink,
  };
}

export type ContextMenuActions = ReturnType<typeof createContextMenuActions>;
