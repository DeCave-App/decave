// Settings: custom status, muting Hubs and people, saving settings (every
// change saves at once, see src/features/settings/useSettingField.ts) and
// closing Settings.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { saveExtraSettings } from "../../features/settings";
import type { AccountUser, AudioSettings } from "../types";
import {
  VADRION_SKIN_KEY,
  AUDIO_SETTINGS_KEY,
  NOTIFICATION_SETTINGS_KEY,
  NOTIFY_LEVELS_KEY,
  PRIVACY_SETTINGS_KEY,
  SOUND_SETTINGS_KEY,
  ACCESSIBILITY_TEXT_SCALE_KEY,
  ACTIVITY_SETTINGS_KEY,
} from "../settings-storage";
import { HTTP_URL } from "../env";
import { LANGUAGE_TIME_KEY } from "../locale";
import { hasDesktopActivityBridge, setDesktopSystemSettings, setDesktopKeybinds } from "../desktop";
import { ALL_SETTINGS_PARTS, type SettingsPart } from "../../features/settings/persist";
import type { ProfileFieldsState } from "../state/profile-fields";
import type { PreferencesState } from "../state/preferences";
import { i18next } from "../../i18n/index.ts";
import { apiErrorMessage } from "../../i18n/apiError.ts";

export type SettingsActionsDeps = {
  currentUser: AccountUser | null;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setCustomStatusEditing: Dispatch<SetStateAction<boolean>>;
  customStatusDraft: string;
  customStatusSaving: boolean;
  setCustomStatusSaving: Dispatch<SetStateAction<boolean>>;
  setCustomStatusError: Dispatch<SetStateAction<string>>;
  mutedUserIds: string[];
  setMutedUserIds: Dispatch<SetStateAction<string[]>>;
  micTestActiveRef: MutableRefObject<boolean>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  setCurrentUserFromResponse: (nextUser: AccountUser) => void;
  stopMicTest: () => void;
  saveRemoteAccountPreferences: () => Promise<boolean>;
  profileFields: ProfileFieldsState;
  preferences: PreferencesState;
};

/** Called once per render with that render's values. */
export function createSettingsActions(deps: SettingsActionsDeps) {
  const {
    currentUser,
    setShowSettings,
    setCustomStatusEditing,
    customStatusDraft,
    customStatusSaving,
    setCustomStatusSaving,
    setCustomStatusError,
    mutedUserIds,
    setMutedUserIds,
    micTestActiveRef,
    audioSettingsRef,
    authorizedFetch,
    setCurrentUserFromResponse,
    stopMicTest,
    saveRemoteAccountPreferences,
    profileFields,
    preferences,
  } = deps;
  const {
    appSkin,
    extraSettings,
    accountPreferences,
    desktopSystemSettings,
    setDesktopSystemSettingsState,
    desktopKeybinds,
    setDesktopKeybindsState,
    activitySettings,
    notificationSettings,
    soundSettings,
    privacySettings,
    notifyLevels,
    accessibilityTextScale,
    setMutedHubIds,
    notificationPreset,
  } = preferences;
  const {
    profileBio,
    profileStatus,
    setProfileStatusText,
    profileStatusText,
    profileAccent,
    profileDisplayName,
    profilePronouns,
  } = profileFields;

  const saveCustomStatus = async () => {
    if (!currentUser || customStatusSaving) return;
    const statusText = customStatusDraft.trim().slice(0, 80);
    setCustomStatusSaving(true);
    setCustomStatusError("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio: profileBio,
          status: profileStatus,
          statusText,
          accent: profileAccent,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        user?: AccountUser;
        error?: string;
      };
      if (!response.ok || !data.user) {
        setCustomStatusError(apiErrorMessage(data, "client.profile.updateStatus"));
        return;
      }
      setProfileStatusText(data.user.statusText ?? statusText);
      setCurrentUserFromResponse(data.user);
      setCustomStatusEditing(false);
    } catch {
      setCustomStatusError(i18next.t("errors.client.profile.updateStatus"));
    } finally {
      setCustomStatusSaving(false);
    }
  };

  const toggleMutedHub = (serverId: number) => {
    setMutedHubIds((current) =>
      current.includes(serverId) ? current.filter((id) => id !== serverId) : [...current, serverId],
    );
  };

  const toggleMutedUser = (userId: string) => {
    const muted = mutedUserIds.includes(userId);
    setMutedUserIds((current) => (muted ? current.filter((id) => id !== userId) : [...current, userId]));
    void authorizedFetch(`${HTTP_URL}/api/safety/mutes/${encodeURIComponent(userId)}`, {
      method: muted ? "DELETE" : "PUT",
    }).catch(() => {
      setMutedUserIds((current) => (muted ? [...current, userId] : current.filter((id) => id !== userId)));
    });
  };

  const finishCloseSettings = () => {
    if (micTestActiveRef.current) stopMicTest();
    setShowSettings(false);
  };

  /** This device's copy of every setting. */
  const saveOnDevice = () => {
    if (!currentUser) return;
    try {
      localStorage.setItem(VADRION_SKIN_KEY, appSkin);
      localStorage.setItem("decave-notification-preset-v1", notificationPreset);
      localStorage.setItem(NOTIFY_LEVELS_KEY, JSON.stringify(notifyLevels));
      localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(notificationSettings));
      localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(soundSettings));
      localStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify(privacySettings));
      localStorage.setItem(`${ACCESSIBILITY_TEXT_SCALE_KEY}:${currentUser.id}`, String(accessibilityTextScale));
      localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(audioSettingsRef.current));
      localStorage.setItem(ACTIVITY_SETTINGS_KEY, JSON.stringify(activitySettings));
      localStorage.setItem(
        LANGUAGE_TIME_KEY,
        JSON.stringify({ language: accountPreferences.language, timeFormat: accountPreferences.timeFormat }),
      );
    } catch {}
    saveExtraSettings(extraSettings);
  };

  /**
   * Saves the current settings (this render's values) to the parts named:
   * the profile, the account (synced settings), this device and the desktop
   * app. Resolves false when any part couldn't be saved.
   */
  const persistSettings = async (parts: readonly SettingsPart[] = ALL_SETTINGS_PARTS): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      if (parts.includes("profile")) {
        const response = await authorizedFetch(`${HTTP_URL}/api/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bio: profileBio,
            status: profileStatus,
            statusText: profileStatusText,
            accent: profileAccent,
            displayName: profileDisplayName,
            pronouns: profilePronouns,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { user?: AccountUser };
        if (!response.ok || !data.user) return false;
        setCurrentUserFromResponse(data.user);
      }
      if (parts.includes("account") && !(await saveRemoteAccountPreferences())) return false;
      if (parts.includes("desktop") && hasDesktopActivityBridge()) {
        try {
          setDesktopSystemSettingsState(await setDesktopSystemSettings(desktopSystemSettings));
          setDesktopKeybindsState(await setDesktopKeybinds(desktopKeybinds));
        } catch {
          return false;
        }
      }
      // The device copy always follows, so a reload shows what you chose.
      saveOnDevice();
      return true;
    } catch {
      return false;
    }
  };

  return {
    saveCustomStatus,
    toggleMutedHub,
    toggleMutedUser,
    finishCloseSettings,
    persistSettings,
  };
}

export type SettingsActions = ReturnType<typeof createSettingsActions>;
