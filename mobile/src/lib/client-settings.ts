import { deviceTimeZone, updateAccountPreferences, type SyncedClientSettings } from "./account-preferences";
import { setAccountPreferencesSnapshot } from "./account-preferences-store";

/** Saves a client-settings patch (mutes, notification levels) and refreshes the shared snapshot; returns the new settings. */
export async function saveClientSettingsPatch(token: string, patch: SyncedClientSettings): Promise<SyncedClientSettings> {
  const prefs = await updateAccountPreferences(token, { clientSettingsPatch: { ...patch, timeZone: deviceTimeZone() } });
  setAccountPreferencesSnapshot(prefs);
  return prefs.clientSettings ?? {};
}
