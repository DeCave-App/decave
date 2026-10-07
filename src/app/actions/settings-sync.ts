// Applies settings synced from the account when they are newer than this device's copy.

import type { MutableRefObject } from "react";
import {
  normalizeExtraSettings,
  readSyncedSettings,
  shouldApplyRemote,
  SETTINGS_SYNC_STAMP_KEY,
  mutedHubsForSync,
} from "../../features/settings";
import { normalizeNotificationPreview } from "../../privacy/notification-preview";
import type { AppSkin } from "../types";
import {
  APP_SKIN_IDS,
  NOTIFICATION_SETTINGS_KEY,
  SOUND_SETTINGS_KEY,
  loadSoundSettings,
  loadNotificationSettings,
} from "../settings-storage";
import type { PreferencesState } from "../state/preferences";

export type SettingsSyncActionsDeps = {
  preferences: PreferencesState;
  lastSyncedMutesRef: MutableRefObject<string | null>;
  chooseAppSkin: (skin: AppSkin) => void;
};

/** Called once per render with that render's values. */
export function createSettingsSyncActions(deps: SettingsSyncActionsDeps) {
  const { preferences, lastSyncedMutesRef, chooseAppSkin } = deps;

  /**
   * Settings another device saved to this account. Each part goes through the
   * same normaliser as local storage before it is used; device-only settings
   * (audio devices, camera, desktop options) are never part of the sync.
   */
  const applyRemoteSettings = (raw: unknown, updatedAt: string | null) => {
    let localStamp: string | null = null;
    try {
      localStamp = localStorage.getItem(SETTINGS_SYNC_STAMP_KEY);
    } catch {}
    if (!shouldApplyRemote(updatedAt, localStamp)) return;
    const remote = readSyncedSettings(raw);
    if (!remote) return;
    try {
      if (remote.appSkin && (APP_SKIN_IDS as readonly string[]).includes(remote.appSkin))
        chooseAppSkin(remote.appSkin as AppSkin);
      if (remote.textScale !== undefined) preferences.setAccessibilityTextScale(remote.textScale);
      if (remote.extra)
        preferences.setExtraSettings((current) =>
          normalizeExtraSettings({ ...current, ...remote.extra }, APP_SKIN_IDS),
        );
      if (remote.notifications) {
        localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(remote.notifications));
        preferences.setNotificationSettings(loadNotificationSettings());
      }
      if (
        remote.notificationPreset === "all" ||
        remote.notificationPreset === "mentions" ||
        remote.notificationPreset === "quiet"
      )
        preferences.setNotificationPreset(remote.notificationPreset);
      if (remote.sounds) {
        localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(remote.sounds));
        preferences.setSoundSettings(loadSoundSettings());
      }
      if (remote.privacy) {
        preferences.setPrivacySettings((current) => ({
          ...current,
          notificationPreview: normalizeNotificationPreview(
            remote.privacy?.notificationPreview ?? current.notificationPreview,
          ),
          sendTypingIndicators: remote.privacy?.sendTypingIndicators ?? current.sendTypingIndicators,
        }));
      }
      if (remote.notifyLevels) preferences.setNotifyLevels(remote.notifyLevels);
      if (remote.mutedHubs) {
        const now = Date.now();
        const live = Object.entries(remote.mutedHubs).filter(([, until]) => until === -1 || until > now);
        const ids = live.map(([id]) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
        const schedule = Object.fromEntries(live);
        lastSyncedMutesRef.current = JSON.stringify(mutedHubsForSync(ids, schedule));
        preferences.setMutedHubIds(ids);
        preferences.setHubMuteSchedule(schedule);
      }
      if (updatedAt) localStorage.setItem(SETTINGS_SYNC_STAMP_KEY, updatedAt);
    } catch (error) {
      console.warn("Could not apply synced settings:", error);
    }
  };

  return {
    applyRemoteSettings,
  };
}
