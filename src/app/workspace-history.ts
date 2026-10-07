// Workspace history (back/forward between Home, DMs, Hubs, Settings...).

import type { WorkspaceHistoryEntry } from "./types";

export const workspaceEntryKey = (entry: WorkspaceHistoryEntry) =>
  JSON.stringify([
    entry.showHome,
    entry.showSocial,
    entry.socialView,
    entry.activeDmUserId,
    entry.activeGroupChatId,
    entry.showSettings,
    entry.settingsTab,
    entry.showServerBrowser,
    entry.showAdminDashboard,
    entry.adminDashboardTab,
    entry.selectedServer,
    entry.selectedChannel,
  ]);
