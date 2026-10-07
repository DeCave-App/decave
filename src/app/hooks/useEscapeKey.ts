// Escape closes the innermost open panel, menu or dialog (Settings asks first if you have unsaved changes).

import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { SafetyReportTarget } from "../../safety/types";
import type {
  ComposerTarget,
  SocialUser,
  DirectMessage,
  GroupChatMessage,
  UserContextMenuState,
  ResourceContextMenuState,
} from "../types";
import type { SettingsWindowState } from "../state/settings-window";
import type { HubPanelsState } from "../state/hub-panels";
import type { ComposerState } from "../state/composer";
import type { ForumRoomUiState } from "../state/forum-room-ui";
import type { CallMediaState } from "../state/call-media";

export type EscapeKeyDeps = {
  showSettings: boolean;
  showCommandPalette: boolean;
  setShowCommandPalette: Dispatch<SetStateAction<boolean>>;
  showInbox: boolean;
  setShowInbox: Dispatch<SetStateAction<boolean>>;
  showLogoutConfirm: boolean;
  setShowLogoutConfirm: Dispatch<SetStateAction<boolean>>;
  showAdminDashboard: boolean;
  setShowAdminDashboard: Dispatch<SetStateAction<boolean>>;
  reportTarget: SafetyReportTarget | null;
  setReportTarget: Dispatch<SetStateAction<SafetyReportTarget | null>>;
  showMyReports: boolean;
  setShowMyReports: Dispatch<SetStateAction<boolean>>;
  setCustomStatusEditing: Dispatch<SetStateAction<boolean>>;
  setCustomStatusError: Dispatch<SetStateAction<string>>;
  showEmojiPicker: boolean;
  setShowEmojiPicker: Dispatch<SetStateAction<boolean>>;
  reactionPickerMessageId: string | null;
  setReactionPickerMessageId: Dispatch<SetStateAction<string | null>>;
  setReactionPickerPosition: Dispatch<
    SetStateAction<{ top: number; left: number; width: number; maxHeight: number } | null>
  >;
  showCreateServer: boolean;
  setShowCreateServer: Dispatch<SetStateAction<boolean>>;
  showServerBrowser: boolean;
  setShowServerBrowser: Dispatch<SetStateAction<boolean>>;
  showCreateChannel: boolean;
  setShowCreateChannel: Dispatch<SetStateAction<boolean>>;
  showManageServer: boolean;
  setShowManageServer: Dispatch<SetStateAction<boolean>>;
  hubMemberMenuId: string | null;
  setHubMemberMenuId: Dispatch<SetStateAction<string | null>>;
  showSocial: boolean;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  groupReplyingTo: GroupChatMessage | null;
  setGroupReplyingTo: Dispatch<SetStateAction<GroupChatMessage | null>>;
  dmReplyingTo: DirectMessage | null;
  setDmReplyingTo: Dispatch<SetStateAction<DirectMessage | null>>;
  showPollComposer: "hub" | "dm" | null;
  setShowPollComposer: Dispatch<SetStateAction<"hub" | "dm" | null>>;
  showDmPlusMenu: boolean;
  setShowDmPlusMenu: Dispatch<SetStateAction<boolean>>;
  showDmEmojiPicker: boolean;
  setShowDmEmojiPicker: Dispatch<SetStateAction<boolean>>;
  showGroupEmojiPicker: boolean;
  setShowGroupEmojiPicker: Dispatch<SetStateAction<boolean>>;
  gifPickerTarget: ComposerTarget | null;
  setGifPickerTarget: Dispatch<SetStateAction<ComposerTarget | null>>;
  showEventComposer: boolean;
  setShowEventComposer: Dispatch<SetStateAction<boolean>>;
  userContextMenu: UserContextMenuState | null;
  setUserContextMenu: Dispatch<SetStateAction<UserContextMenuState | null>>;
  resourceContextMenu: ResourceContextMenuState | null;
  setResourceContextMenu: Dispatch<SetStateAction<ResourceContextMenuState | null>>;
  resourceContextMoreOpen: boolean;
  setResourceContextMoreOpen: Dispatch<SetStateAction<boolean>>;
  friendRemovalConfirm: SocialUser | null;
  setFriendRemovalConfirm: Dispatch<SetStateAction<SocialUser | null>>;
  showManageChannel: boolean;
  setShowManageChannel: Dispatch<SetStateAction<boolean>>;
  focusedVideo: { title: string; stream: MediaStream; connectionId?: string } | null;
  setFocusedVideo: Dispatch<SetStateAction<{ title: string; stream: MediaStream; connectionId?: string } | null>>;
  closeSettings: () => void;
  settingsWindow: SettingsWindowState;
  hubPanels: HubPanelsState;
  composer: ComposerState;
  forumRoomUi: ForumRoomUiState;
  callMedia: CallMediaState;
};

export function useEscapeKey(deps: EscapeKeyDeps): void {
  const {
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
  } = deps;
  const { cameraSettingsOpen, setCameraSettingsOpen, screenShareSettingsOpen, setScreenShareSettingsOpen } = callMedia;
  const { showForumEmojiPicker, setShowForumEmojiPicker } = forumRoomUi;
  const {
    replyingTo,
    setReplyingTo,
    editingMessage,
    setEditingMessage,
    showComposerPlusMenu,
    setShowComposerPlusMenu,
  } = composer;
  const {
    showMessageSearch,
    setShowMessageSearch,
    showPinnedMessages,
    setShowPinnedMessages,
    showStreamerOverview,
    setShowStreamerOverview,
    showHubCalendarPanel,
    setShowHubCalendarPanel,
  } = hubPanels;
  const { settingsDirty, settingsCloseConfirm, setSettingsCloseConfirm } = settingsWindow;

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Event drawer / composer sheet handle their own Escape (innermost dialog first).
      if (document.querySelector('[data-hub-events-dialog="open"]')) return;

      const popupOpen =
        settingsCloseConfirm ||
        showCommandPalette ||
        showInbox ||
        showLogoutConfirm ||
        Boolean(userContextMenu) ||
        Boolean(resourceContextMenu) ||
        Boolean(hubMemberMenuId) ||
        showStreamerOverview ||
        showHubCalendarPanel ||
        showEmojiPicker ||
        showDmEmojiPicker ||
        showGroupEmojiPicker ||
        showForumEmojiPicker ||
        cameraSettingsOpen ||
        screenShareSettingsOpen ||
        showComposerPlusMenu ||
        showDmPlusMenu ||
        showEventComposer ||
        Boolean(showPollComposer) ||
        Boolean(gifPickerTarget) ||
        Boolean(friendRemovalConfirm) ||
        Boolean(focusedVideo) ||
        Boolean(reactionPickerMessageId) ||
        Boolean(reportTarget) ||
        showMyReports ||
        showManageChannel ||
        showManageServer ||
        showCreateChannel ||
        showCreateServer ||
        showServerBrowser ||
        showPinnedMessages ||
        showMessageSearch ||
        showSettings ||
        showSocial ||
        Boolean(replyingTo) ||
        Boolean(editingMessage);

      if (!popupOpen) return;
      event.preventDefault();
      event.stopPropagation();

      if (settingsCloseConfirm) {
        setSettingsCloseConfirm(false);
        return;
      }
      if (showCommandPalette) {
        setShowCommandPalette(false);
        return;
      }
      if (showInbox) {
        setShowInbox(false);
        return;
      }
      if (showLogoutConfirm) {
        setShowLogoutConfirm(false);
        return;
      }
      if (reportTarget) {
        setReportTarget(null);
        return;
      }
      if (showMyReports) {
        setShowMyReports(false);
        return;
      }
      if (resourceContextMenu) {
        if (resourceContextMoreOpen) {
          setResourceContextMoreOpen(false);
        } else {
          setResourceContextMenu(null);
        }
        return;
      }
      if (userContextMenu) {
        setUserContextMenu(null);
        setCustomStatusEditing(false);
        setCustomStatusError("");
        return;
      }
      if (hubMemberMenuId) {
        setHubMemberMenuId(null);
        return;
      }
      if (showStreamerOverview) {
        setShowStreamerOverview(false);
        return;
      }
      if (showHubCalendarPanel) {
        setShowHubCalendarPanel(false);
        return;
      }
      if (gifPickerTarget) {
        setGifPickerTarget(null);
        return;
      }
      if (showComposerPlusMenu) {
        setShowComposerPlusMenu(false);
        return;
      }
      if (showDmPlusMenu) {
        setShowDmPlusMenu(false);
        return;
      }
      if (showEventComposer) {
        setShowEventComposer(false);
        return;
      }
      if (showPollComposer) {
        setShowPollComposer(null);
        return;
      }
      if (showGroupEmojiPicker) {
        setShowGroupEmojiPicker(false);
        return;
      }
      if (showForumEmojiPicker) {
        setShowForumEmojiPicker(false);
        return;
      }
      if (cameraSettingsOpen) {
        setCameraSettingsOpen(false);
        return;
      }
      if (screenShareSettingsOpen) {
        setScreenShareSettingsOpen(false);
        return;
      }
      if (showDmEmojiPicker) {
        setShowDmEmojiPicker(false);
        return;
      }
      if (showEmojiPicker) {
        setShowEmojiPicker(false);
        return;
      }
      if (friendRemovalConfirm) {
        setFriendRemovalConfirm(null);
        return;
      }
      if (focusedVideo) {
        setFocusedVideo(null);
        return;
      }
      if (reactionPickerMessageId) {
        setReactionPickerMessageId(null);
        setReactionPickerPosition(null);
        return;
      }
      if (showManageChannel) {
        setShowManageChannel(false);
        return;
      }
      if (showManageServer) {
        setShowManageServer(false);
        return;
      }
      if (showCreateChannel) {
        setShowCreateChannel(false);
        return;
      }
      if (showCreateServer) {
        setShowCreateServer(false);
        return;
      }
      if (showServerBrowser) {
        setShowServerBrowser(false);
        return;
      }
      if (showPinnedMessages) {
        setShowPinnedMessages(false);
        return;
      }
      if (showMessageSearch) {
        setShowMessageSearch(false);
        return;
      }
      if (showAdminDashboard) {
        setShowAdminDashboard(false);
        return;
      }
      if (showSettings) {
        closeSettings();
        return;
      }
      if (showSocial) {
        setShowSocial(false);
        return;
      }
      if (editingMessage) {
        setEditingMessage(null);
        return;
      }
      if (replyingTo) {
        setReplyingTo(null);
        return;
      }
      if (dmReplyingTo) {
        setDmReplyingTo(null);
        return;
      }
      if (groupReplyingTo) setGroupReplyingTo(null);
    };

    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [
    settingsCloseConfirm,
    showCommandPalette,
    showInbox,
    showLogoutConfirm,
    userContextMenu,
    resourceContextMenu,
    resourceContextMoreOpen,
    hubMemberMenuId,
    showHubCalendarPanel,
    showEmojiPicker,
    showDmEmojiPicker,
    showGroupEmojiPicker,
    showComposerPlusMenu,
    showDmPlusMenu,
    showEventComposer,
    showPollComposer,
    gifPickerTarget,
    friendRemovalConfirm,
    focusedVideo,
    reactionPickerMessageId,
    reportTarget,
    showMyReports,
    showManageChannel,
    showManageServer,
    showCreateChannel,
    showCreateServer,
    showServerBrowser,
    showPinnedMessages,
    showMessageSearch,
    showAdminDashboard,
    showSettings,
    showSocial,
    replyingTo,
    editingMessage,
    dmReplyingTo,
    groupReplyingTo,
    showStreamerOverview,
    showForumEmojiPicker,
    cameraSettingsOpen,
    screenShareSettingsOpen,
    settingsDirty,
  ]);
}
