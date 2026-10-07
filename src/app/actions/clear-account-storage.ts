// Logout cleanup for browser storage. Every key the app writes uses one of the
// prefixes below; anything account-related (drafts, notes, mutes, workspace,
// workspace history, privacy/notification settings, per-user volumes) is
// removed so the next person on this device starts clean. Only device-level
// display/audio preferences that say nothing about the account survive.

import { clearDesktopBrowserSession } from "../desktop";
import { LANGUAGE_TIME_KEY } from "../locale";
import { AUDIO_SETTINGS_KEY, VADRION_SKIN_KEY } from "../settings-storage";
import { EXTRA_SETTINGS_KEY } from "../../features/settings/extraSettings";

const APP_STORAGE_PREFIXES = ["decave", "gamerchat_", "vadrion_"];

/** Device-level preferences kept across logout (theme, layout, audio devices, language). */
export const DEVICE_PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  VADRION_SKIN_KEY, // theme skin
  EXTRA_SETTINGS_KEY, // theme mode, density, motion, contrast, output volume, camera device
  AUDIO_SETTINGS_KEY, // microphone/speaker device and voice processing
  LANGUAGE_TIME_KEY, // UI language and 12/24h clock
  "decave-hub-rail-collapsed-v1", // sidebar collapsed state
  "decave-right-friends-collapsed-v1", // friends panel collapsed state
]);

function clearAppKeys(storage: Storage) {
  const doomed: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || DEVICE_PREFERENCE_KEYS.has(key)) continue;
    if (APP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

export function clearAccountScopedStorage() {
  for (const getStorage of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      clearAppKeys(getStorage());
    } catch {
      /* storage unavailable */
    }
  }
}

/** Clears local account data and, on desktop, the in-app browser profile. */
export async function clearAccountDataOnLogout() {
  clearAccountScopedStorage();
  try {
    await clearDesktopBrowserSession();
  } catch {
    // Logout must not fail because the desktop shell is old or busy.
  }
}
