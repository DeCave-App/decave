// Marks the Settings window as having unsaved changes when any setting differs
// from the snapshot taken when Settings opened.

import { type MutableRefObject, useEffect } from "react";
import type { AudioSettings, SettingsSnapshot } from "../types";
import type { PreferencesState } from "../state/preferences";
import type { SettingsWindowState } from "../state/settings-window";
import type { ProfileFieldsState } from "../state/profile-fields";

export type SettingsDirtyTrackingDeps = {
  preferences: PreferencesState;
  showSettings: boolean;
  settingsWindow: SettingsWindowState;
  profileFields: ProfileFieldsState;
  audioSettings: AudioSettings;
  settingsSnapshotRef: MutableRefObject<SettingsSnapshot | null>;
  settingsHydratingRef: MutableRefObject<boolean>;
};

export function useSettingsDirtyTracking(deps: SettingsDirtyTrackingDeps): void {
  const {
    preferences,
    showSettings,
    settingsWindow,
    profileFields,
    audioSettings,
    settingsSnapshotRef,
    settingsHydratingRef,
  } = deps;

  useEffect(() => {
    if (settingsHydratingRef.current) {
      settingsWindow.setSettingsDirty(false);
      return;
    }
    if (!showSettings || !settingsSnapshotRef.current) {
      settingsWindow.setSettingsDirty(false);
      return;
    }
    const snapshot = settingsSnapshotRef.current;
    settingsWindow.setSettingsDirty(
      profileFields.profileBio !== snapshot.profileBio ||
        profileFields.profileStatus !== snapshot.profileStatus ||
        profileFields.profileStatusText !== snapshot.profileStatusText ||
        profileFields.profileAccent !== snapshot.profileAccent ||
        profileFields.profileDisplayName !== snapshot.profileDisplayName ||
        profileFields.profilePronouns !== snapshot.profilePronouns ||
        preferences.appSkin !== snapshot.appSkin ||
        JSON.stringify(preferences.extraSettings) !== JSON.stringify(snapshot.extraSettings) ||
        preferences.notificationPreset !== snapshot.notificationPreset ||
        preferences.accessibilityTextScale !== snapshot.accessibilityTextScale ||
        JSON.stringify(preferences.notificationSettings) !== JSON.stringify(snapshot.notificationSettings) ||
        JSON.stringify(preferences.soundSettings) !== JSON.stringify(snapshot.soundSettings) ||
        JSON.stringify(preferences.privacySettings) !== JSON.stringify(snapshot.privacySettings) ||
        JSON.stringify(audioSettings) !== JSON.stringify(snapshot.audioSettings) ||
        JSON.stringify(preferences.activitySettings) !== JSON.stringify(snapshot.activitySettings) ||
        preferences.accountPreferences.language !== snapshot.language ||
        preferences.accountPreferences.timeFormat !== snapshot.timeFormat ||
        preferences.accountPreferences.loginAlerts !== snapshot.loginAlerts ||
        preferences.accountPreferences.activityVisibility !== snapshot.activityVisibility ||
        JSON.stringify(preferences.notifyLevels) !== JSON.stringify(snapshot.notifyLevels) ||
        JSON.stringify(preferences.desktopSystemSettings) !== JSON.stringify(snapshot.desktopSystemSettings) ||
        JSON.stringify(preferences.desktopKeybinds) !== JSON.stringify(snapshot.desktopKeybinds),
    );
  }, [
    showSettings,
    profileFields.profileBio,
    profileFields.profileStatus,
    profileFields.profileStatusText,
    profileFields.profileAccent,
    profileFields.profileDisplayName,
    profileFields.profilePronouns,
    preferences.appSkin,
    preferences.extraSettings,
    preferences.notificationPreset,
    preferences.notificationSettings,
    preferences.soundSettings,
    preferences.privacySettings,
    preferences.accessibilityTextScale,
    audioSettings,
    preferences.activitySettings,
    preferences.accountPreferences.language,
    preferences.accountPreferences.timeFormat,
    preferences.accountPreferences.loginAlerts,
    preferences.accountPreferences.activityVisibility,
    preferences.notifyLevels,
    preferences.desktopSystemSettings,
    preferences.desktopKeybinds,
  ]);
}
