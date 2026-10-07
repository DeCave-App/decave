// Closes short-lived UI when it no longer applies: notices and panels when the page
// changes, and context menus on any click or window resize.

import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { SquadSearch, UserContextMenuState, ResourceContextMenuState } from "../types";
import type { HubPanelsState } from "../state/hub-panels";

export type TransientUiDismissalDeps = {
  showSettings: boolean;
  showAdminDashboard: boolean;
  setCustomStatusEditing: Dispatch<SetStateAction<boolean>>;
  setCustomStatusError: Dispatch<SetStateAction<string>>;
  showHome: boolean;
  hubPanels: HubPanelsState;
  selectedServer: number;
  showServerBrowser: boolean;
  showSquadFinder: boolean;
  setShowSquadFinder: Dispatch<SetStateAction<boolean>>;
  setSquadMatchPopup: Dispatch<SetStateAction<SquadSearch | null>>;
  setFriendIdNotice: Dispatch<SetStateAction<string>>;
  showSocial: boolean;
  socialView: "dm" | "friends";
  setHubMembersPanelSearch: Dispatch<SetStateAction<string>>;
  setUserContextMenu: Dispatch<SetStateAction<UserContextMenuState | null>>;
  setResourceContextMenu: Dispatch<SetStateAction<ResourceContextMenuState | null>>;
  setResourceContextMoreOpen: Dispatch<SetStateAction<boolean>>;
  setShowFeedback: Dispatch<SetStateAction<boolean>>;
};

export function useTransientUiDismissal(deps: TransientUiDismissalDeps): void {
  const {
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
  } = deps;

  useEffect(() => {
    // Friend-by-ID feedback belongs to the current Friends visit only. Once the
    // user navigates elsewhere it should not be waiting for them when they
    // return.
    setFriendIdNotice("");
  }, [
    showHome,
    showSocial,
    socialView,
    showServerBrowser,
    showSettings,
    showAdminDashboard,
    showSquadFinder,
    selectedServer,
  ]);

  useEffect(() => {
    if (showHome || showSocial || showSettings || showServerBrowser || showAdminDashboard || showSquadFinder) {
      hubPanels.setShowHubMembersPanel(false);
      hubPanels.setShowHubCalendarPanel(false);
      setHubMembersPanelSearch("");
    }
  }, [showHome, showSocial, showSettings, showServerBrowser, showAdminDashboard, showSquadFinder]);

  useEffect(() => {
    if (showHome || showSocial || showSettings || showServerBrowser || showAdminDashboard) {
      setShowFeedback(false);
      setShowSquadFinder(false);
      setSquadMatchPopup(null);
    }
  }, [showHome, showSocial, showSettings, showServerBrowser, showAdminDashboard]);

  useEffect(() => {
    const closeMenu = () => {
      setUserContextMenu(null);
      setResourceContextMenu(null);
      setResourceContextMoreOpen(false);
      setCustomStatusEditing(false);
      setCustomStatusError("");
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, []);
}
