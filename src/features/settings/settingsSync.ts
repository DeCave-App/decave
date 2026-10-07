// Settings that follow the account to every device. Device-specific choices
// (microphone, speakers, camera, output volume, desktop startup, keybinds,
// streaming-app detection) stay on each device on purpose.

import { normalizeNotifyLevels, type NotifyLevels } from "./notifyLevels";
import type { ExtraSettings } from "./extraSettings";

export const SYNCED_SETTINGS_VERSION = 1;
export const SETTINGS_SYNC_STAMP_KEY = "decave_settings_synced_at_v1";

/** The part of ExtraSettings that is a personal preference rather than a device choice. */
export type SyncedExtra = Pick<
  ExtraSettings,
  | "themeMode"
  | "lightSkin"
  | "darkSkin"
  | "motion"
  | "density"
  | "highContrast"
  | "underlineLinks"
  | "showAltText"
  | "quietHours"
>;

export type SyncedSettings = {
  v: number;
  appSkin?: string;
  textScale?: number;
  extra?: Partial<SyncedExtra>;
  notifications?: Record<string, boolean>;
  notificationPreset?: string;
  sounds?: Record<string, unknown>;
  privacy?: { notificationPreview?: string; sendTypingIndicators?: boolean };
  notifyLevels?: NotifyLevels;
  /** Hub id → muted until (epoch ms), or -1 until turned back on. */
  mutedHubs?: Record<string, number>;
  /** IANA time zone, so the server can apply quiet hours to phone notifications. */
  timeZone?: string;
};

export type SyncSource = {
  appSkin: string;
  textScale: number;
  extra: ExtraSettings;
  notifications: Record<string, boolean>;
  notificationPreset: string;
  sounds: Record<string, unknown>;
  privacy: { notificationPreview: string; sendTypingIndicators: boolean };
  notifyLevels: NotifyLevels;
  mutedHubs: Record<string, number>;
  timeZone: string;
};

export function buildSyncedSettings(source: SyncSource): SyncedSettings {
  const { themeMode, lightSkin, darkSkin, motion, density, highContrast, underlineLinks, showAltText, quietHours } =
    source.extra;
  return {
    v: SYNCED_SETTINGS_VERSION,
    appSkin: source.appSkin,
    textScale: source.textScale,
    extra: {
      themeMode,
      lightSkin,
      darkSkin,
      motion,
      density,
      highContrast,
      underlineLinks,
      showAltText,
      quietHours: { ...quietHours },
    },
    notifications: { ...source.notifications },
    notificationPreset: source.notificationPreset,
    sounds: { ...source.sounds },
    privacy: {
      notificationPreview: source.privacy.notificationPreview,
      sendTypingIndicators: source.privacy.sendTypingIndicators,
    },
    notifyLevels: source.notifyLevels,
    mutedHubs: { ...source.mutedHubs },
    timeZone: source.timeZone,
  };
}

/** Muted Hubs from the app's two stores: the id list plus optional end times. */
export function mutedHubsForSync(
  ids: readonly number[],
  schedule: Record<string, number>,
  now = Date.now(),
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const until = schedule[String(id)];
    if (until === undefined || until === -1) out[String(id)] = -1;
    else if (until > now) out[String(id)] = until;
  }
  return out;
}

/**
 * Read settings saved by another device. Unknown or malformed parts are
 * dropped; each part is still checked by the same normalisers the app uses
 * for local storage before it is applied.
 */
export function readSyncedSettings(raw: unknown): SyncedSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.v !== SYNCED_SETTINGS_VERSION) return null;
  const obj = (input: unknown) =>
    input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
  const notifications = obj(value.notifications);
  const privacy = obj(value.privacy);
  return {
    v: SYNCED_SETTINGS_VERSION,
    appSkin: typeof value.appSkin === "string" ? value.appSkin : undefined,
    textScale: Number.isFinite(Number(value.textScale))
      ? Math.max(80, Math.min(140, Number(value.textScale)))
      : undefined,
    extra: obj(value.extra) as Partial<SyncedExtra> | undefined,
    notifications: notifications
      ? (Object.fromEntries(
          Object.entries(notifications).filter(([, enabled]) => typeof enabled === "boolean"),
        ) as Record<string, boolean>)
      : undefined,
    notificationPreset: typeof value.notificationPreset === "string" ? value.notificationPreset : undefined,
    sounds: obj(value.sounds),
    privacy: privacy
      ? {
          notificationPreview:
            typeof privacy.notificationPreview === "string" ? privacy.notificationPreview : undefined,
          sendTypingIndicators:
            typeof privacy.sendTypingIndicators === "boolean" ? privacy.sendTypingIndicators : undefined,
        }
      : undefined,
    notifyLevels: value.notifyLevels ? normalizeNotifyLevels(value.notifyLevels) : undefined,
    mutedHubs: obj(value.mutedHubs)
      ? Object.fromEntries(
          Object.entries(obj(value.mutedHubs)!)
            .filter(([key, until]) => /^\d{1,12}$/.test(key) && Number.isFinite(Number(until)))
            .map(([key, until]) => [key, Number(until)]),
        )
      : undefined,
    timeZone: typeof value.timeZone === "string" ? value.timeZone.slice(0, 64) : undefined,
  };
}

/** Apply the server copy only when it is newer than the last one this device saw. */
export function shouldApplyRemote(
  remoteUpdatedAt: string | null | undefined,
  localStamp: string | null | undefined,
): boolean {
  if (!remoteUpdatedAt) return false;
  if (!localStamp) return true;
  return Date.parse(remoteUpdatedAt) > Date.parse(localStamp);
}
