import {
  accountStorageKey,
  browserLocalStorage,
  readLocalJsonResult,
  writeLocalJsonResult,
  type LocalStorageLike,
} from "./local-storage.ts";
import type { SessionKitNotificationPreset, SessionKitPresenceStatus } from "../../shared/session-kit.ts";

export type PresenceIntent = "playing" | "watching" | "planning" | "available" | "quiet";
export type QuietPresenceInterrupt = "urgent-mention" | "ordinary-join" | "soundboard-event" | "recommendation";

/** Semantic event names used by callers that do not need to know storage keys. */
export type QuietPresenceEvent = QuietPresenceInterrupt | "mention" | "join" | "soundboard";

export type QuietPresenceInterruptPolicy = {
  urgentMentions: boolean;
  ordinaryJoins: boolean;
  soundboardEvents: boolean;
  recommendations: boolean;
};

export type QuietPresenceSettings = {
  version: 1;
  intent: PresenceIntent;
  /** Existing profile status semantics used by App/server presence. */
  presenceStatus: SessionKitPresenceStatus;
  notificationPreset: SessionKitNotificationPreset;
  expiresAt: string | null;
  interruptPolicy: QuietPresenceInterruptPolicy;
  updatedAt: string;
};

export type LegacyPresencePatch = {
  status: SessionKitPresenceStatus;
  notificationPreset: SessionKitNotificationPreset;
};

const QUIET_PRESENCE_VERSION = 1 as const;
const PRESENCE_INTENTS: readonly PresenceIntent[] = ["playing", "watching", "planning", "available", "quiet"];
const PRESENCE_STATUSES: readonly SessionKitPresenceStatus[] = ["online", "idle", "dnd", "invisible"];
const NOTIFICATION_PRESETS: readonly SessionKitNotificationPreset[] = ["all", "mentions", "quiet"];
const INTERRUPT_KEYS: readonly (keyof QuietPresenceInterruptPolicy)[] = [
  "urgentMentions",
  "ordinaryJoins",
  "soundboardEvents",
  "recommendations",
];

export const QUIET_PRESENCE_STORAGE_NAMESPACE = "decave-quiet-presence-v1";

export const DEFAULT_QUIET_PRESENCE: QuietPresenceSettings = {
  version: QUIET_PRESENCE_VERSION,
  intent: "available",
  presenceStatus: "online",
  notificationPreset: "all",
  expiresAt: null,
  interruptPolicy: {
    urgentMentions: true,
    ordinaryJoins: true,
    soundboardEvents: true,
    recommendations: true,
  },
  updatedAt: new Date(0).toISOString(),
};

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, maxLength);
  return text || null;
}

function isoOrNull(value: unknown): string | null {
  const text = cleanText(value, 64);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function policyFrom(value: unknown, notificationPreset: SessionKitNotificationPreset): QuietPresenceInterruptPolicy {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const fallback =
    notificationPreset === "quiet"
      ? { urgentMentions: true, ordinaryJoins: false, soundboardEvents: false, recommendations: false }
      : notificationPreset === "mentions"
        ? { urgentMentions: true, ordinaryJoins: false, soundboardEvents: false, recommendations: false }
        : DEFAULT_QUIET_PRESENCE.interruptPolicy;
  return {
    urgentMentions: typeof raw.urgentMentions === "boolean" ? raw.urgentMentions : fallback.urgentMentions,
    ordinaryJoins: typeof raw.ordinaryJoins === "boolean" ? raw.ordinaryJoins : fallback.ordinaryJoins,
    soundboardEvents: typeof raw.soundboardEvents === "boolean" ? raw.soundboardEvents : fallback.soundboardEvents,
    recommendations: typeof raw.recommendations === "boolean" ? raw.recommendations : fallback.recommendations,
  };
}

export function presenceStatusForIntent(intent: PresenceIntent): SessionKitPresenceStatus {
  if (intent === "planning") return "idle";
  if (intent === "quiet") return "dnd";
  return "online";
}

export function normalizeQuietPresenceSettings(value: unknown, now = Date.now()): QuietPresenceSettings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const intent = PRESENCE_INTENTS.includes(raw.intent as PresenceIntent)
    ? (raw.intent as PresenceIntent)
    : DEFAULT_QUIET_PRESENCE.intent;
  const presenceStatus = PRESENCE_STATUSES.includes(raw.presenceStatus as SessionKitPresenceStatus)
    ? (raw.presenceStatus as SessionKitPresenceStatus)
    : presenceStatusForIntent(intent);
  const notificationPreset = NOTIFICATION_PRESETS.includes(raw.notificationPreset as SessionKitNotificationPreset)
    ? (raw.notificationPreset as SessionKitNotificationPreset)
    : intent === "quiet"
      ? "quiet"
      : DEFAULT_QUIET_PRESENCE.notificationPreset;
  const expiresAt = isoOrNull(raw.expiresAt);
  const updatedAt = isoOrNull(raw.updatedAt) ?? new Date(now).toISOString();
  return {
    version: QUIET_PRESENCE_VERSION,
    intent,
    presenceStatus,
    notificationPreset,
    expiresAt,
    interruptPolicy: policyFrom(raw.interruptPolicy, notificationPreset),
    updatedAt,
  };
}

export function isQuietPresenceExpired(settings: QuietPresenceSettings, now = Date.now()): boolean {
  return settings.expiresAt !== null && Date.parse(settings.expiresAt) <= now;
}

/** Expiry restores the quiet controls to a safe available baseline. */
export function effectiveQuietPresence(settings: QuietPresenceSettings, now = Date.now()): QuietPresenceSettings {
  if (!isQuietPresenceExpired(settings, now)) return settings;
  return {
    ...DEFAULT_QUIET_PRESENCE,
    updatedAt: settings.updatedAt,
  };
}

export function toLegacyPresencePatch(settings: QuietPresenceSettings, now = Date.now()): LegacyPresencePatch {
  const effective = effectiveQuietPresence(settings, now);
  return {
    status: effective.presenceStatus,
    notificationPreset: effective.notificationPreset,
  };
}

export function shouldInterruptQuietPresence(
  settings: QuietPresenceSettings,
  event: QuietPresenceInterrupt,
  now = Date.now(),
): boolean {
  const effective = effectiveQuietPresence(settings, now);
  const key: keyof QuietPresenceInterruptPolicy =
    event === "urgent-mention"
      ? "urgentMentions"
      : event === "ordinary-join"
        ? "ordinaryJoins"
        : event === "soundboard-event"
          ? "soundboardEvents"
          : "recommendations";
  return effective.interruptPolicy[key];
}

/** Map UI/event vocabulary to the four persisted interrupt controls. */
export function quietPresenceInterruptForEvent(
  event: QuietPresenceEvent,
  urgent = false,
): QuietPresenceInterrupt | null {
  // Ordinary mentions follow the caller's notification grouping. Only an
  // explicitly urgent mention is governed by the separate urgent control.
  if (event === "mention") return urgent ? "urgent-mention" : null;
  if (event === "join") return "ordinary-join";
  if (event === "soundboard") return "soundboard-event";
  return event;
}

/** Convenience wrapper for notification and activity call sites. */
export function shouldInterruptQuietPresenceEvent(
  settings: QuietPresenceSettings,
  event: QuietPresenceEvent,
  options: { urgent?: boolean; now?: number } = {},
): boolean {
  const interrupt = quietPresenceInterruptForEvent(event, options.urgent === true);
  return interrupt ? shouldInterruptQuietPresence(settings, interrupt, options.now ?? Date.now()) : false;
}

export type QuietPresenceRepository = {
  readonly key: string;
  load: () => QuietPresenceSettings;
  save: (settings: QuietPresenceSettings) => { ok: boolean; settings: QuietPresenceSettings; error?: string };
  lastError: () => string | null;
};

export function createQuietPresenceRepository(
  accountId: string,
  options: { storage?: LocalStorageLike | null; now?: () => number } = {},
): QuietPresenceRepository {
  const storage = options.storage === undefined ? browserLocalStorage() : options.storage;
  const now = options.now ?? (() => Date.now());
  const key = accountStorageKey(QUIET_PRESENCE_STORAGE_NAMESPACE, accountId);
  let storageError: string | null = null;
  return {
    key,
    load: () => {
      const result = readLocalJsonResult(storage, key, DEFAULT_QUIET_PRESENCE);
      storageError = result.ok ? null : (result.error ?? "Quiet presence could not be read.");
      return normalizeQuietPresenceSettings(result.value ?? DEFAULT_QUIET_PRESENCE, now());
    },
    save: (candidate) => {
      const settings = normalizeQuietPresenceSettings(
        { ...candidate, updatedAt: new Date(now()).toISOString() },
        now(),
      );
      const result = writeLocalJsonResult(storage, key, settings);
      storageError = result.ok ? null : (result.error ?? "Quiet presence could not be saved.");
      return { ok: result.ok, settings, ...(result.error ? { error: result.error } : {}) };
    },
    lastError: () => storageError,
  };
}

export function allInterruptsEnabled(policy: QuietPresenceInterruptPolicy): boolean {
  return INTERRUPT_KEYS.every((key) => policy[key]);
}
