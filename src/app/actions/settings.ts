// Settings: custom status, muting Hubs and people, saving every section,
// discarding unsaved changes, resetting a section, closing Settings.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { DEFAULT_EXTRA_SETTINGS, saveExtraSettings, EMPTY_NOTIFY_LEVELS } from "../../features/settings";
import type { AccountUser, AppSkin, AudioSettings, SettingsSnapshot } from "../types";
import {
  VADRION_SKIN_KEY,
  AUDIO_SETTINGS_KEY,
  NOTIFICATION_SETTINGS_KEY,
  NOTIFY_LEVELS_KEY,
  PRIVACY_SETTINGS_KEY,
  SOUND_SETTINGS_KEY,
  ACCESSIBILITY_TEXT_SCALE_KEY,
  ACTIVITY_SETTINGS_KEY,
  DEFAULT_ACTIVITY_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PRIVACY_SETTINGS,
  DEFAULT_SOUND_VARIANTS,
  DEFAULT_SOUND_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
} from "../settings-storage";
import { HTTP_URL } from "../env";
import { LANGUAGE_TIME_KEY, setActiveLanguagePreference, setActiveTimeFormatPreference } from "../locale";
import {
  hasDesktopActivityBridge,
  setDesktopSystemSettings,
  setDesktopKeybinds,
  setDesktopStreamerMode,
} from "../desktop";
import type { SettingsWindowState } from "../state/settings-window";
import type { ProfileFieldsState } from "../state/profile-fields";
import type { PreferencesState } from "../state/preferences";
import type { AudioSetupState } from "../state/audio-setup";

export type SettingsActionsDeps = {
  currentUser: AccountUser | null;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setProfileAvatarError: Dispatch<SetStateAction<string>>;
  setCustomStatusEditing: Dispatch<SetStateAction<boolean>>;
  customStatusDraft: string;
  customStatusSaving: boolean;
  setCustomStatusSaving: Dispatch<SetStateAction<boolean>>;
  setCustomStatusError: Dispatch<SetStateAction<string>>;
  mutedUserIds: string[];
  setMutedUserIds: Dispatch<SetStateAction<string[]>>;
  setAudioSettings: Dispatch<SetStateAction<AudioSettings>>;
  localMicStreamRef: MutableRefObject<MediaStream | null>;
  micTestActiveRef: MutableRefObject<boolean>;
  settingsSnapshotRef: MutableRefObject<SettingsSnapshot | null>;
  settingsHydratingRef: MutableRefObject<boolean>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  chooseAppSkin: (skin: AppSkin) => void;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  setCurrentUserFromResponse: (nextUser: AccountUser) => void;
  captureSettingsSnapshot: () => SettingsSnapshot;
  stopMicTest: () => void;
  saveAudioSettings: (next: AudioSettings) => void;
  rebuildMicrophoneIfActive: (next: AudioSettings) => Promise<void>;
  saveRemoteAccountPreferences: () => Promise<boolean>;
  settingsWindow: SettingsWindowState;
  profileFields: ProfileFieldsState;
  preferences: PreferencesState;
  audioSetup: AudioSetupState;
};

/** Called once per render with that render's values. */
export function createSettingsActions(deps: SettingsActionsDeps) {
  const {
    currentUser,
    setShowSettings,
    setProfileAvatarError,
    setCustomStatusEditing,
    customStatusDraft,
    customStatusSaving,
    setCustomStatusSaving,
    setCustomStatusError,
    mutedUserIds,
    setMutedUserIds,
    setAudioSettings,
    localMicStreamRef,
    micTestActiveRef,
    settingsSnapshotRef,
    settingsHydratingRef,
    audioSettingsRef,
    chooseAppSkin,
    authorizedFetch,
    setCurrentUserFromResponse,
    captureSettingsSnapshot,
    stopMicTest,
    saveAudioSettings,
    rebuildMicrophoneIfActive,
    saveRemoteAccountPreferences,
    settingsWindow,
    profileFields,
    preferences,
    audioSetup,
  } = deps;
  const { setAudioSettingsNotice } = audioSetup;
  const {
    appSkin,
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
    setMutedHubIds,
    notificationPreset,
    setNotificationPreset,
  } = preferences;
  const {
    profileBio,
    setProfileBio,
    profileStatus,
    setProfileStatus,
    setProfileStatusText,
    profileStatusText,
    profileAccent,
    setProfileAccent,
    profileDisplayName,
    setProfileDisplayName,
    profilePronouns,
    setProfilePronouns,
  } = profileFields;
  const { setSettingsDirty, setSettingsSaving, setSettingsCloseConfirm, settingsTab } = settingsWindow;

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
        setCustomStatusError(data.error || "Could not update your status.");
        return;
      }
      setProfileStatusText(data.user.statusText ?? statusText);
      setCurrentUserFromResponse(data.user);
      setCustomStatusEditing(false);
    } catch {
      setCustomStatusError("Could not update your status.");
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
    settingsHydratingRef.current = false;
    setSettingsCloseConfirm(false);
    setSettingsDirty(false);
    settingsSnapshotRef.current = null;
    setShowSettings(false);
  };

  const saveAllSettings = async (): Promise<boolean> => {
    if (!currentUser) return false;
    setSettingsSaving(true);
    setProfileAvatarError("");
    try {
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
      const data = (await response.json().catch(() => ({}))) as {
        user?: AccountUser;
        error?: string;
      };
      if (!response.ok || !data.user) {
        setProfileAvatarError(data.error || "Could not save settings.");
        return false;
      }
      if (!(await saveRemoteAccountPreferences())) return false;
      if (hasDesktopActivityBridge()) {
        try {
          const savedSystem = await setDesktopSystemSettings(desktopSystemSettings);
          setDesktopSystemSettingsState(savedSystem);
          const savedKeybinds = await setDesktopKeybinds(desktopKeybinds);
          setDesktopKeybindsState(savedKeybinds);
        } catch (error) {
          setProfileAvatarError(error instanceof Error ? error.message : "Could not save desktop system settings.");
          return false;
        }
      }
      setCurrentUserFromResponse(data.user);
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
          JSON.stringify({
            language: accountPreferences.language,
            timeFormat: accountPreferences.timeFormat,
          }),
        );
      } catch {}
      saveExtraSettings(extraSettings);
      settingsSnapshotRef.current = captureSettingsSnapshot();
      setSettingsDirty(false);
      setAudioSettingsNotice("Settings saved.");
      return true;
    } catch {
      setProfileAvatarError("Could not save settings.");
      return false;
    } finally {
      setSettingsSaving(false);
    }
  };

  const discardSettingsChanges = async () => {
    const snapshot = settingsSnapshotRef.current;
    if (!snapshot) {
      finishCloseSettings();
      return;
    }

    setProfileBio(snapshot.profileBio);
    setProfileStatus(snapshot.profileStatus);
    setProfileStatusText(snapshot.profileStatusText);
    setProfileAccent(snapshot.profileAccent);
    setProfileDisplayName(snapshot.profileDisplayName);
    setProfilePronouns(snapshot.profilePronouns);
    chooseAppSkin(snapshot.appSkin);
    setExtraSettings({ ...snapshot.extraSettings, quietHours: { ...snapshot.extraSettings.quietHours } });
    setNotificationPreset(snapshot.notificationPreset as typeof notificationPreset);
    setNotificationSettings({ ...snapshot.notificationSettings });
    setSoundSettings({ ...snapshot.soundSettings });
    setPrivacySettings({ ...snapshot.privacySettings });
    setAccessibilityTextScale(snapshot.accessibilityTextScale);
    setActivitySettings({
      ...snapshot.activitySettings,
      excludedGames: [...snapshot.activitySettings.excludedGames],
    });
    setAccountPreferences((current) => ({
      ...current,
      language: snapshot.language,
      timeFormat: snapshot.timeFormat,
      loginAlerts: snapshot.loginAlerts,
      activityVisibility: snapshot.activityVisibility,
    }));
    setNotifyLevels(snapshot.notifyLevels);
    setActiveLanguagePreference(snapshot.language);
    setActiveTimeFormatPreference(snapshot.timeFormat);
    document.documentElement.lang = snapshot.language;
    setDesktopSystemSettingsState({ ...snapshot.desktopSystemSettings });
    setDesktopKeybindsState({ ...snapshot.desktopKeybinds });

    const restoredAudio = { ...snapshot.audioSettings };
    saveAudioSettings(restoredAudio);
    if (localMicStreamRef.current) {
      await rebuildMicrophoneIfActive(restoredAudio).catch((error) =>
        console.warn("Could not restore microphone settings:", error),
      );
    }

    if (currentUser) {
      try {
        const response = await authorizedFetch(`${HTTP_URL}/api/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bio: snapshot.profileBio,
            status: snapshot.profileStatus,
            statusText: snapshot.profileStatusText,
            accent: snapshot.profileAccent,
            displayName: snapshot.profileDisplayName,
            pronouns: snapshot.profilePronouns,
          }),
        });
        if (response.ok) {
          const data = (await response.json().catch(() => ({}))) as { user?: AccountUser };
          if (data.user) setCurrentUserFromResponse(data.user);
        }
      } catch (error) {
        console.warn("Could not restore profile settings:", error);
      }
    }

    try {
      await authorizedFetch(`${HTTP_URL}/api/account/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          friendRequestPolicy: snapshot.privacySettings.friendRequestPolicy,
          allowStreamPreviews: snapshot.privacySettings.allowStreamPreviews,
          streamerMode: snapshot.privacySettings.streamerMode,
          language: snapshot.language,
          timeFormat: snapshot.timeFormat,
          loginAlerts: snapshot.loginAlerts,
          activityVisibility: snapshot.activityVisibility,
        }),
      });
      if (hasDesktopActivityBridge()) {
        await setDesktopStreamerMode(snapshot.privacySettings.streamerMode).catch(() => false);
        await setDesktopSystemSettings(snapshot.desktopSystemSettings).catch(() => snapshot.desktopSystemSettings);
        await setDesktopKeybinds(snapshot.desktopKeybinds).catch(() => snapshot.desktopKeybinds);
      }
    } catch (error) {
      console.warn("Could not restore account preferences:", error);
    }

    finishCloseSettings();
  };

  const resetCurrentSettingsSection = () => {
    switch (settingsTab) {
      case "appearance":
        chooseAppSkin("nebula");
        setAccessibilityTextScale(100);
        setExtraSettings((current) => ({
          ...current,
          themeMode: DEFAULT_EXTRA_SETTINGS.themeMode,
          lightSkin: DEFAULT_EXTRA_SETTINGS.lightSkin,
          darkSkin: DEFAULT_EXTRA_SETTINGS.darkSkin,
          motion: DEFAULT_EXTRA_SETTINGS.motion,
          density: DEFAULT_EXTRA_SETTINGS.density,
          highContrast: false,
          underlineLinks: false,
          showAltText: false,
        }));
        break;
      case "notifications":
        setNotificationSettings({ ...DEFAULT_NOTIFICATION_SETTINGS });
        setNotificationPreset("all");
        setExtraSettings((current) => ({ ...current, quietHours: { ...DEFAULT_EXTRA_SETTINGS.quietHours } }));
        setNotifyLevels(EMPTY_NOTIFY_LEVELS);
        break;
      case "sounds":
        setSoundSettings({ ...DEFAULT_SOUND_SETTINGS, variants: { ...DEFAULT_SOUND_VARIANTS } });
        break;
      case "privacy":
        setPrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS });
        break;
      case "voice":
        audioSettingsRef.current = { ...DEFAULT_AUDIO_SETTINGS };
        setAudioSettings({ ...DEFAULT_AUDIO_SETTINGS });
        setExtraSettings((current) => ({
          ...current,
          outputVolume: 100,
          cameraDeviceId: "",
          showAudioDiagnostics: false,
        }));
        break;
      case "activity":
        setActivitySettings({ ...DEFAULT_ACTIVITY_SETTINGS, excludedGames: [] });
        break;
      case "language":
        setAccountPreferences((current) => ({ ...current, language: "en", timeFormat: "system" }));
        break;
      default:
        return;
    }
    setSettingsDirty(true);
    setAudioSettingsNotice("This section was reset. Save changes to keep the defaults.");
  };

  return {
    saveCustomStatus,
    toggleMutedHub,
    toggleMutedUser,
    finishCloseSettings,
    saveAllSettings,
    discardSettingsChanges,
    resetCurrentSettingsSection,
  };
}

export type SettingsActions = ReturnType<typeof createSettingsActions>;
