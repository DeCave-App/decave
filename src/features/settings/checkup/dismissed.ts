// Your setup items someone dismissed. Kept on this device and synced with the
// account (SyncedSettings.checkupDismissed), so a dismissal follows you.

import { useSyncExternalStore } from "react";
import { CHECKUP_ORDER } from "./checks";

export const CHECKUP_DISMISSED_KEY = "decave_checkup_dismissed_v1";

export function normalizeDismissed(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return CHECKUP_ORDER.filter((id) => value.includes(id));
}

function load(): string[] {
  try {
    return normalizeDismissed(JSON.parse(localStorage.getItem(CHECKUP_DISMISSED_KEY) || "[]"));
  } catch {
    return [];
  }
}

let current: string[] | null = null;
const listeners = new Set<() => void>();

export function getCheckupDismissed(): string[] {
  if (!current) current = load();
  return current;
}

export function setCheckupDismissed(next: readonly string[]): void {
  current = normalizeDismissed(next);
  try {
    localStorage.setItem(CHECKUP_DISMISSED_KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((listener) => listener());
}

export function useCheckupDismissed(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCheckupDismissed,
    getCheckupDismissed,
  );
}
