// Account-scoped browser storage on web and desktop. Every key the app writes
// starts with one of APP_STORAGE_PREFIXES; anything about the account (drafts,
// notes, mutes, workspace, privacy/notification settings, per-user volumes) is
// removed when the person signs out, or when a different account signs in on
// this device, so the next person starts clean. Device-level display and audio
// preferences that say nothing about the account survive.
//
// DM encryption state (decave.e2ee.device.<id> and the IndexedDB keyring) is
// not touched here: dmE2ee.stop({ forget }) owns it, so a device that was
// signed out elsewhere keeps its key exactly as before.

import { clearDesktopBrowserSession } from "../desktop";
import { LANGUAGE_TIME_KEY } from "../locale";
import { AUDIO_SETTINGS_KEY, VADRION_SKIN_KEY } from "../settings-storage";
import { EXTRA_SETTINGS_KEY } from "../../features/settings/extraSettings";

const APP_STORAGE_PREFIXES = ["decave", "gamerchat_", "vadrion_"];

/** Which account the account-scoped storage belongs to (a hash of its id). */
export const STORAGE_OWNER_KEY = "decave_storage_owner_v1";

/** Managed by the DM encryption session's own forget semantics. */
const E2EE_DEVICE_STATE_PREFIX = "decave.e2ee.device.";

/** Device-level preferences kept across accounts (theme, layout, audio devices, language). */
export const DEVICE_PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  VADRION_SKIN_KEY, // theme skin
  EXTRA_SETTINGS_KEY, // theme mode, density, motion, contrast, output volume, camera device
  AUDIO_SETTINGS_KEY, // microphone/speaker device and voice processing
  LANGUAGE_TIME_KEY, // UI language and 12/24h clock
  "decave-hub-rail-collapsed-v1", // sidebar collapsed state
  "decave-right-friends-collapsed-v1", // friends panel collapsed state
  STORAGE_OWNER_KEY,
]);

export function isAccountScopedStorageKey(key: string): boolean {
  if (DEVICE_PREFERENCE_KEYS.has(key) || key.startsWith(E2EE_DEVICE_STATE_PREFIX)) return false;
  return APP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function clearAppKeys(storage: Storage) {
  const doomed: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isAccountScopedStorageKey(key)) doomed.push(key);
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

async function clearDesktopProfile() {
  try {
    await clearDesktopBrowserSession();
  } catch {
    // Signing out must not fail because the desktop shell is old or busy.
  }
}

/** The person chose to sign out: clear local account data and the desktop browser profile. */
export async function clearAccountDataOnSignOut() {
  clearAccountScopedStorage();
  await clearDesktopProfile();
}

async function ownerTag(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`decave-storage-owner:${userId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Called when an account is signed in. "switched" means local data belonged to
 * another account and was cleared; the caller reloads so no state read from it
 * stays in memory. A device without an owner yet (first run, or an app from
 * before this check) adopts the current account.
 */
export async function claimAccountStorage(userId: string): Promise<"same" | "claimed" | "switched"> {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return "same";
  }
  const tag = await ownerTag(userId);
  let previous: string | null = null;
  try {
    previous = storage.getItem(STORAGE_OWNER_KEY);
  } catch {
    return "same";
  }
  if (previous === tag) return "same";
  if (previous) {
    clearAccountScopedStorage();
    await clearDesktopProfile();
  }
  try {
    storage.setItem(STORAGE_OWNER_KEY, tag);
  } catch {
    return "same";
  }
  return previous ? "switched" : "claimed";
}
