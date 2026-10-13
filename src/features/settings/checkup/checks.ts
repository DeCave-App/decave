// Your setup: small pure checks over existing state, each with a one-click fix.
// Order is the spec's priority order.

import type { SettingsTabId } from "../settingsMap";

export type CheckupState = {
  twoFactorOn: boolean;
  e2eeAvailable: boolean;
  recoveryBackupSaved: boolean;
  pttMode: boolean;
  pttKey: string | null;
  notificationsOn: boolean;
  notificationPermission: "granted" | "denied" | "default" | "unsupported";
  micTestedOnDevice: boolean;
  desktopUpdateReady: boolean;
  hasAvatar: boolean;
  isDesktop: boolean;
};

export type CheckupId =
  "twoFactor" | "recoveryCode" | "pttKey" | "notificationsBlocked" | "micTest" | "updateReady" | "avatar";

export type CheckupFix =
  { tab: SettingsTabId; anchor?: string } | { action: "restartToUpdate" | "requestNotifications" };

export type CheckupItem = { id: CheckupId; severity: "high" | "medium" | "low"; fix: CheckupFix };

/** Set once a microphone test ran on this device (Settings → Voice & video). */
export const MIC_TESTED_KEY = "decave_mic_tested_v1";

export const CHECKUP_ORDER: CheckupId[] = [
  "twoFactor",
  "recoveryCode",
  "pttKey",
  "notificationsBlocked",
  "micTest",
  "updateReady",
  "avatar",
];

const CHECKS: Record<CheckupId, (state: CheckupState) => Omit<CheckupItem, "id"> | null> = {
  twoFactor: (state) =>
    state.twoFactorOn ? null : { severity: "high", fix: { tab: "account", anchor: "two-factor" } },
  recoveryCode: (state) =>
    state.e2eeAvailable && !state.recoveryBackupSaved
      ? { severity: "high", fix: { tab: "privacy", anchor: "encryption" } }
      : null,
  pttKey: (state) =>
    state.pttMode && !state.pttKey ? { severity: "medium", fix: { tab: "gaming", anchor: "push-to-talk" } } : null,
  notificationsBlocked: (state) => {
    if (!state.notificationsOn) return null;
    if (state.notificationPermission === "default")
      return { severity: "medium", fix: { action: "requestNotifications" } };
    if (state.notificationPermission === "denied")
      return { severity: "medium", fix: { tab: "notifications", anchor: "desktop-notifications" } };
    return null;
  },
  micTest: (state) => (state.micTestedOnDevice ? null : { severity: "low", fix: { tab: "voice", anchor: "mic-test" } }),
  updateReady: (state) =>
    state.isDesktop && state.desktopUpdateReady ? { severity: "medium", fix: { action: "restartToUpdate" } } : null,
  avatar: (state) => (state.hasAvatar ? null : { severity: "low", fix: { tab: "profile", anchor: "avatar" } }),
};

/** Items that need attention and aren't dismissed, most important first. */
export function checkupItems(state: CheckupState, dismissed: readonly string[]): CheckupItem[] {
  const hidden = new Set(dismissed);
  return CHECKUP_ORDER.flatMap((id) => {
    if (hidden.has(id)) return [];
    const item = CHECKS[id](state);
    return item ? [{ id, ...item }] : [];
  });
}

/** The browser's notification permission, or "unsupported". */
export function notificationPermission(): CheckupState["notificationPermission"] {
  if (typeof Notification === "undefined") return "unsupported";
  const value = Notification.permission;
  return value === "granted" || value === "denied" ? value : "default";
}

export function micTestedOnThisDevice(): boolean {
  try {
    return Boolean(localStorage.getItem(MIC_TESTED_KEY));
  } catch {
    return true;
  }
}
