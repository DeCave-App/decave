// Saves notification, sound and privacy settings to this device whenever they change.

import { useEffect } from "react";
import { NOTIFICATION_SETTINGS_KEY, PRIVACY_SETTINGS_KEY, SOUND_SETTINGS_KEY } from "../settings-storage";
import type { PreferencesState } from "../state/preferences";

export type PreferencePersistenceDeps = {
  preferences: PreferencesState;
};

export function usePreferencePersistence(deps: PreferencePersistenceDeps): void {
  const { preferences } = deps;

  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(preferences.notificationSettings));
    } catch {}
  }, [preferences.notificationSettings]);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(preferences.soundSettings));
    } catch {}
  }, [preferences.soundSettings]);

  useEffect(() => {
    try {
      localStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify(preferences.privacySettings));
    } catch {}
  }, [preferences.privacySettings]);
}
