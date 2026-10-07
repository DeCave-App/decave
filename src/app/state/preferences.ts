// User preferences edited in Settings: skin, text scale, sounds, notifications,
// privacy, keybinds, desktop options, activity sharing, muted Hubs and the
// account preferences stored on the server. Initial values come from local storage.

import { useState } from "react";
import type {
  AppSkin,
  AccountPreferences,
  DesktopSystemSettings,
  DesktopKeybindSettings,
  ActivitySettings,
  NotificationSettings,
  SoundSettings,
  PrivacySettings,
} from "../types";
import {
  loadAppSkin,
  APP_SKIN_IDS,
  loadActivitySettings,
  loadNotificationSettings,
  loadSoundSettings,
  loadPrivacySettings,
  NOTIFY_LEVELS_KEY,
  loadMutedHubIds,
} from "../settings-storage";
import {
  loadExtraSettings,
  normalizeNotifyLevels,
  EMPTY_NOTIFY_LEVELS,
  type ExtraSettings,
  type NotifyLevels,
} from "../../features/settings";
import { loadLanguageTimePreferences } from "../locale";

export function usePreferencesState() {
  const [appSkin, setAppSkin] = useState<AppSkin>(loadAppSkin);
  const [extraSettings, setExtraSettings] = useState<ExtraSettings>(() => loadExtraSettings(APP_SKIN_IDS));
  const [accountPreferences, setAccountPreferences] = useState<AccountPreferences>(() => {
    const local = loadLanguageTimePreferences();
    return {
      usernameChangedAt: null,
      usernameChangeAvailableAt: null,
      friendRequestPolicy: "everyone",
      allowStreamPreviews: false,
      streamerMode: false,
      language: local.language,
      timeFormat: local.timeFormat,
      voiceMiniPlayerPosition: null,
      loginAlerts: true,
      activityVisibility: "everyone",
    };
  });
  const [desktopSystemSettings, setDesktopSystemSettingsState] = useState<DesktopSystemSettings>({
    openAtLogin: false,
    closeToTray: false,
    voiceOverlayEnabled: true,
  });
  const [desktopKeybinds, setDesktopKeybindsState] = useState<DesktopKeybindSettings>({
    toggleMute: "CommandOrControl+Shift+M",
    toggleDeafen: "CommandOrControl+Shift+D",
  });
  const [activitySettings, setActivitySettings] = useState<ActivitySettings>(loadActivitySettings);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(loadNotificationSettings);
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(loadSoundSettings);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>(loadPrivacySettings);
  const [notifyLevels, setNotifyLevels] = useState<NotifyLevels>(() => {
    try {
      return normalizeNotifyLevels(JSON.parse(localStorage.getItem(NOTIFY_LEVELS_KEY) || "{}"));
    } catch {
      return EMPTY_NOTIFY_LEVELS;
    }
  });
  const [accessibilityTextScale, setAccessibilityTextScale] = useState<number>(100);
  const [mutedHubIds, setMutedHubIds] = useState<number[]>(loadMutedHubIds);
  const [notificationPreset, setNotificationPreset] = useState<"all" | "mentions" | "quiet">(() => {
    try {
      return (localStorage.getItem("decave-notification-preset-v1") as "all" | "mentions" | "quiet") || "all";
    } catch {
      return "all";
    }
  });
  const [hubMuteSchedule, setHubMuteSchedule] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem("decave-hub-mute-schedule-v1") ?? "{}");
    } catch {
      return {};
    }
  });

  return {
    appSkin,
    setAppSkin,
    extraSettings,
    setExtraSettings,
    accountPreferences,
    setAccountPreferences,
    desktopSystemSettings,
    setDesktopSystemSettingsState,
    desktopKeybinds,
    setDesktopKeybindsState,
    activitySettings,
    setActivitySettings,
    notificationSettings,
    setNotificationSettings,
    soundSettings,
    setSoundSettings,
    privacySettings,
    setPrivacySettings,
    notifyLevels,
    setNotifyLevels,
    accessibilityTextScale,
    setAccessibilityTextScale,
    mutedHubIds,
    setMutedHubIds,
    notificationPreset,
    setNotificationPreset,
    hubMuteSchedule,
    setHubMuteSchedule,
  };
}

export type PreferencesState = ReturnType<typeof usePreferencesState>;
