// Mute one Hub room from its header (bell next to search and pinned).
// Muting sets the room's notification level to "Nothing" (Settings →
// Notifications → Hubs and rooms); unmuting returns it to the Hub default.
// Saved locally and synced to the account right away, so phones go quiet too.

import { useCallback } from "react";
import type { PreferencesState } from "../state/preferences";
import { NOTIFY_LEVELS_KEY } from "../settings-storage";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";
import { SETTINGS_SYNC_STAMP_KEY } from "../../features/settings/settingsSync";
import { withRoomLevel, type NotifyLevels } from "../../features/settings/notifyLevels";

export function isRoomMuted(levels: NotifyLevels, roomId: number): boolean {
  return levels.rooms[String(roomId)] === "nothing";
}

export function useRoomMute(preferences: PreferencesState) {
  return useCallback(
    (roomId: number) => {
      const next = withRoomLevel(
        preferences.notifyLevels,
        roomId,
        isRoomMuted(preferences.notifyLevels, roomId) ? "default" : "nothing",
      );
      preferences.setNotifyLevels(next);
      try {
        localStorage.setItem(NOTIFY_LEVELS_KEY, JSON.stringify(next));
      } catch {}
      void authorizedFetch(`${HTTP_URL}/api/account/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientSettingsPatch: { notifyLevels: next } }),
      })
        .then((response) => response.json().catch(() => ({})))
        .then((data: { clientSettingsUpdatedAt?: string }) => {
          if (data.clientSettingsUpdatedAt) {
            try {
              localStorage.setItem(SETTINGS_SYNC_STAMP_KEY, data.clientSettingsUpdatedAt);
            } catch {}
          }
        })
        .catch(() => undefined);
    },
    [preferences],
  );
}
