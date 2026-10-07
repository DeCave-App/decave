// Records where you go (page, Hub, room, conversation) for back/forward.

import { type MutableRefObject, useEffect } from "react";
import type { SocialUser, GroupChat, AdminDashboardTab, WorkspaceHistoryEntry } from "../types";
import type { SettingsWindowState } from "../state/settings-window";

export type WorkspaceHistoryRecordingDeps = {
  showSettings: boolean;
  showAdminDashboard: boolean;
  adminDashboardTab: AdminDashboardTab;
  showHome: boolean;
  selectedServer: number;
  selectedChannel: number;
  showServerBrowser: boolean;
  showSocial: boolean;
  socialView: "dm" | "friends";
  activeDmUser: SocialUser | null;
  activeGroupChat: GroupChat | null;
  workspaceBackRef: MutableRefObject<WorkspaceHistoryEntry[]>;
  workspaceForwardRef: MutableRefObject<WorkspaceHistoryEntry[]>;
  workspaceLastRef: MutableRefObject<WorkspaceHistoryEntry | null>;
  workspaceRestoringRef: MutableRefObject<boolean>;
  workspaceSnapshot: () => WorkspaceHistoryEntry;
  workspaceEntryKey: (entry: WorkspaceHistoryEntry) => string;
  settingsWindow: SettingsWindowState;
};

export function useWorkspaceHistoryRecording(deps: WorkspaceHistoryRecordingDeps): void {
  const {
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
  } = deps;
  const { settingsTab } = settingsWindow;

  useEffect(() => {
    const next = workspaceSnapshot();
    const previous = workspaceLastRef.current;
    if (workspaceRestoringRef.current) {
      workspaceRestoringRef.current = false;
      workspaceLastRef.current = next;
      return;
    }
    if (!previous) {
      workspaceLastRef.current = next;
      return;
    }
    if (workspaceEntryKey(previous) !== workspaceEntryKey(next)) {
      workspaceBackRef.current = [previous];
      workspaceForwardRef.current = [];
      workspaceLastRef.current = next;
    }
  }, [
    showHome,
    showSocial,
    socialView,
    activeDmUser?.id,
    activeGroupChat?.id,
    showSettings,
    settingsTab,
    showServerBrowser,
    showAdminDashboard,
    adminDashboardTab,
    selectedServer,
    selectedChannel,
  ]);
}
