// Closes open menus and pickers when you press outside them.

import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { ComposerTarget, UserContextMenuState } from "../types";
import type { HubPanelsState } from "../state/hub-panels";
import type { ComposerState } from "../state/composer";
import type { ForumRoomUiState } from "../state/forum-room-ui";
import type { CallMediaState } from "../state/call-media";

export type CloseMenusOnOutsidePointerDeps = {
  setCustomStatusEditing: Dispatch<SetStateAction<boolean>>;
  setCustomStatusError: Dispatch<SetStateAction<string>>;
  setShowEmojiPicker: Dispatch<SetStateAction<boolean>>;
  setReactionPickerMessageId: Dispatch<SetStateAction<string | null>>;
  setReactionPickerPosition: Dispatch<
    SetStateAction<{ top: number; left: number; width: number; maxHeight: number } | null>
  >;
  setHubMemberMenuId: Dispatch<SetStateAction<string | null>>;
  setFriendActionsUserId: Dispatch<SetStateAction<string | null>>;
  setShowDmPlusMenu: Dispatch<SetStateAction<boolean>>;
  setShowDmEmojiPicker: Dispatch<SetStateAction<boolean>>;
  setShowGroupEmojiPicker: Dispatch<SetStateAction<boolean>>;
  setGifPickerTarget: Dispatch<SetStateAction<ComposerTarget | null>>;
  setUserContextMenu: Dispatch<SetStateAction<UserContextMenuState | null>>;
  hubPanels: HubPanelsState;
  composer: ComposerState;
  forumRoomUi: ForumRoomUiState;
  callMedia: CallMediaState;
};

export function useCloseMenusOnOutsidePointer(deps: CloseMenusOnOutsidePointerDeps): void {
  const {
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
  } = deps;
  const { setCameraSettingsOpen, setScreenShareSettingsOpen } = callMedia;
  const { setShowForumEmojiPicker } = forumRoomUi;
  const { setShowComposerPlusMenu } = composer;
  const { setShowHubMembersPanel, setShowHubCalendarPanel } = hubPanels;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element && target.closest(".user-context-menu"))) {
        setUserContextMenu(null);
        setCustomStatusEditing(false);
        setCustomStatusError("");
      }
      if (
        target instanceof Element &&
        !target.closest('[data-message-reaction-picker="true"], .reaction-action-button')
      ) {
        setReactionPickerMessageId(null);
        setReactionPickerPosition(null);
      }
      if (!(target instanceof Element && target.closest(".camera-control-wrap"))) {
        setCameraSettingsOpen(false);
        setScreenShareSettingsOpen(false);
      }
      if (!(target instanceof Element && target.closest('.dc-hub-members-popover, [data-hub-members-toggle="true"]'))) {
        setShowHubMembersPanel(false);
      }
      if (!(target instanceof Element && target.closest(".dc-hub-member-menu-wrap"))) {
        setHubMemberMenuId(null);
      }
      if (!(
        target instanceof Element &&
        target.closest('[data-hub-calendar-page="true"], [data-hub-calendar-toggle="true"]')
      )) {
        setShowHubCalendarPanel(false);
      }
      if (target instanceof Element && target.closest('[data-composer-popover="true"]')) return;
      if (!(target instanceof Element && target.closest('[data-friend-actions="true"]'))) {
        setFriendActionsUserId(null);
      }
      setShowComposerPlusMenu(false);
      setShowDmPlusMenu(false);
      setShowEmojiPicker(false);
      setShowDmEmojiPicker(false);
      setShowGroupEmojiPicker(false);
      setShowForumEmojiPicker(false);
      setGifPickerTarget(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);
}
