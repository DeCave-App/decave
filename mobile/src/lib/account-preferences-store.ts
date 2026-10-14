// Account preferences that screens outside Settings act on: typing indicators,
// 12/24-hour message times and large emoji. Filled at sign-in
// (NotificationSettingsProvider) and whenever Settings or Privacy saves, and
// cleared on sign-out. Defaults match the desktop app when nothing is loaded.

import { useSyncExternalStore } from "react";
import type { AccountPreferences } from "./account-preferences";

let current: AccountPreferences | null = null;
const listeners = new Set<() => void>();

export function setAccountPreferencesSnapshot(next: AccountPreferences | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders when preferences load or change, so times and emoji sizes follow them. */
export function useAccountPreferencesSnapshot(): AccountPreferences | null {
  return useSyncExternalStore(subscribe, () => current);
}

export function sendsTypingIndicators(prefs: AccountPreferences | null = current): boolean {
  return prefs?.clientSettings?.privacy?.sendTypingIndicators !== false;
}

export function showsLargeEmoji(prefs: AccountPreferences | null = current): boolean {
  return prefs?.clientSettings?.chat?.largeEmoji !== false;
}

/** `hour12` for toLocaleTimeString: forced by the account's time format, else the language's default. */
export function hour12Preference(prefs: AccountPreferences | null = current): boolean | undefined {
  if (prefs?.timeFormat === "12h") return true;
  if (prefs?.timeFormat === "24h") return false;
  return undefined;
}
