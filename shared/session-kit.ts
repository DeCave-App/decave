/**
 * Shared, transport-neutral contracts for local Session Kits.
 *
 * A kit stores intent and opaque identifiers only. It deliberately has no
 * message body, attachment, transcript, media track, or auto-capture flag.
 * Callers must resolve identifiers against the current account's available
 * state before applying a kit.
 */

export const SESSION_KIT_VERSION = 1 as const;
export const MAX_SESSION_KITS = 40;
export const MAX_SESSION_KIT_NAME_LENGTH = 64;

export type SessionKitPresenceStatus = "online" | "idle" | "dnd" | "invisible";
export type SessionKitNotificationPreset = "all" | "mentions" | "quiet";
export type SessionKitIntent = "play" | "watch" | "chat" | "plan";
export type SessionKitProcessingMode = "standard" | "high-quality" | "low-cpu";

export type SessionKitScope = {
  /** Opaque server hub identifier. Numeric IDs should be converted to strings by the caller. */
  hubId: string;
  channelId: string | null;
  eventId: string | null;
};

export type SessionKitGameContext = {
  name: string;
  platform: string | null;
};

export type SessionKitVoiceProfile = {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  processingMode: SessionKitProcessingMode;
};

export type SessionKitPrivacyDefaults = {
  presenceStatus: SessionKitPresenceStatus;
  notificationPreset: SessionKitNotificationPreset;
  allowUrgentMentions: boolean;
};

export type SessionKit = {
  version: typeof SESSION_KIT_VERSION;
  id: string;
  name: string;
  intent: SessionKitIntent;
  scope: SessionKitScope;
  inviteUserIds: string[];
  game: SessionKitGameContext;
  voice: SessionKitVoiceProfile;
  privacy: SessionKitPrivacyDefaults;
  createdAt: string;
  updatedAt: string;
};

export type SessionKitDraft = Omit<SessionKit, "version" | "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

/** Structural repository contract used by the desktop shell integration. */
export type SessionKitRepository = {
  readonly key: string;
  load: () => SessionKit[];
  upsert: (kit: SessionKit | SessionKitDraft) => { ok: boolean; kits: SessionKit[]; error?: string };
  remove: (kitId: string) => { ok: boolean; kits: SessionKit[]; error?: string };
  clear: () => boolean;
  lastError?: () => string | null;
};

export type SessionKitReferenceCatalog = {
  hubIds: readonly string[];
  /** A channel is valid only when it appears under the selected hub. */
  channelIdsByHub: Readonly<Record<string, readonly string[]>> | ReadonlyMap<string, readonly string[]>;
  eventIds?: readonly string[];
  inviteUserIds?: readonly string[];
  inputDeviceIds?: readonly string[];
  outputDeviceIds?: readonly string[];
};

export type SessionKitReferenceIssueCode =
  | "hub-unavailable"
  | "channel-unavailable"
  | "layout-unavailable"
  | "event-unavailable"
  | "invite-member-unavailable"
  | "input-device-unavailable"
  | "output-device-unavailable";

export type SessionKitReferenceIssue = {
  code: SessionKitReferenceIssueCode;
  reference: string;
  message: string;
};

export type SessionKitLaunchPlan = {
  kitId: string;
  kitName: string;
  intent: SessionKitIntent;
  /** Safe references that survived validation; null means restore the safe home state. */
  restored: {
    hubId: string | null;
    channelId: string | null;
    eventId: string | null;
    inviteUserIds: string[];
    game: SessionKitGameContext;
    voice: SessionKitVoiceProfile;
    privacy: SessionKitPrivacyDefaults;
  };
  issues: SessionKitReferenceIssue[];
  /** A missing hub prevents contextual launch; other stale references can be skipped safely. */
  canLaunch: boolean;
  summary: string[];
  /** Applying a plan never captures, publishes, enables a camera, or unmutes a track. */
  mediaActionRequired: readonly ["microphone", "camera"];
  /** Available invite candidates remain unchanged until the user chooses an explicit invite action. */
  inviteActionRequired: boolean;
};

const PRESENCE_STATUSES: readonly SessionKitPresenceStatus[] = ["online", "idle", "dnd", "invisible"];
const NOTIFICATION_PRESETS: readonly SessionKitNotificationPreset[] = ["all", "mentions", "quiet"];
const INTENTS: readonly SessionKitIntent[] = ["play", "watch", "chat", "plan"];
const PROCESSING_MODES: readonly SessionKitProcessingMode[] = ["standard", "high-quality", "low-cpu"];

function cleanText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim().slice(0, maxLength);
  return text || fallback;
}

function cleanNullableId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id.length <= 160 && !/[\u0000-\u001f]/.test(id) ? id : null;
}

function cleanIdList(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 160),
    ),
  ].slice(0, max);
}

function isoOrNow(value: unknown, now: number): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date(now).toISOString();
}

function randomSuffix(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID().slice(0, 12);
  } catch {
    // Fall through to a timestamp-based local ID.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSessionKitId(): string {
  return `session-kit-${randomSuffix()}`;
}

export function createSessionKit(input: SessionKitDraft, now = Date.now()): SessionKit {
  const timestamp = new Date(now).toISOString();
  return (
    normalizeSessionKit(
      {
        ...input,
        id: input.id ?? createSessionKitId(),
        createdAt: input.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      },
      now,
    ) ?? {
      version: SESSION_KIT_VERSION,
      id: createSessionKitId(),
      name: "Session Kit",
      intent: "play",
      scope: { hubId: "", channelId: null, eventId: null },
      inviteUserIds: [],
      game: { name: "", platform: null },
      voice: { inputDeviceId: null, outputDeviceId: null, processingMode: "standard" },
      privacy: { presenceStatus: "online", notificationPreset: "all", allowUrgentMentions: true },
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  );
}

/** Normalize persisted data and strip fields added by an untrusted/older client. */
export function normalizeSessionKit(value: unknown, now = Date.now()): SessionKit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawScope = raw.scope && typeof raw.scope === "object" ? (raw.scope as Record<string, unknown>) : {};
  const rawGame = raw.game && typeof raw.game === "object" ? (raw.game as Record<string, unknown>) : {};
  const rawVoice = raw.voice && typeof raw.voice === "object" ? (raw.voice as Record<string, unknown>) : {};
  const rawPrivacy = raw.privacy && typeof raw.privacy === "object" ? (raw.privacy as Record<string, unknown>) : {};
  const hubId = cleanNullableId(rawScope.hubId);
  if (!hubId) return null;
  const id = cleanNullableId(raw.id);
  if (!id) return null;
  const intent = INTENTS.includes(raw.intent as SessionKitIntent) ? (raw.intent as SessionKitIntent) : "play";
  const presenceStatus = PRESENCE_STATUSES.includes(rawPrivacy.presenceStatus as SessionKitPresenceStatus)
    ? (rawPrivacy.presenceStatus as SessionKitPresenceStatus)
    : "online";
  const notificationPreset = NOTIFICATION_PRESETS.includes(
    rawPrivacy.notificationPreset as SessionKitNotificationPreset,
  )
    ? (rawPrivacy.notificationPreset as SessionKitNotificationPreset)
    : "all";
  const processingMode = PROCESSING_MODES.includes(rawVoice.processingMode as SessionKitProcessingMode)
    ? (rawVoice.processingMode as SessionKitProcessingMode)
    : "standard";
  const createdAt = isoOrNow(raw.createdAt, now);
  const updatedAt = isoOrNow(raw.updatedAt, now);
  return {
    version: SESSION_KIT_VERSION,
    id,
    name: cleanText(raw.name, MAX_SESSION_KIT_NAME_LENGTH, "Session Kit"),
    intent,
    scope: {
      hubId,
      channelId: cleanNullableId(rawScope.channelId),
      eventId: cleanNullableId(rawScope.eventId),
    },
    inviteUserIds: cleanIdList(raw.inviteUserIds, 100),
    game: {
      name: cleanText(rawGame.name, 100, ""),
      platform: cleanNullableId(rawGame.platform),
    },
    voice: {
      inputDeviceId: cleanNullableId(rawVoice.inputDeviceId),
      outputDeviceId: cleanNullableId(rawVoice.outputDeviceId),
      processingMode,
    },
    privacy: {
      presenceStatus,
      notificationPreset,
      allowUrgentMentions: rawPrivacy.allowUrgentMentions !== false,
    },
    createdAt,
    updatedAt,
  };
}

export function normalizeSessionKits(value: unknown, now = Date.now()): SessionKit[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).kits)
      ? ((value as Record<string, unknown>).kits as unknown[])
      : [];
  const seen = new Set<string>();
  const kits: SessionKit[] = [];
  for (const item of raw.slice(0, MAX_SESSION_KITS)) {
    const kit = normalizeSessionKit(item, now);
    if (!kit || seen.has(kit.id)) continue;
    seen.add(kit.id);
    kits.push(kit);
  }
  return kits;
}

function catalogSet(value: readonly string[] | undefined): Set<string> {
  return new Set((value ?? []).map((item) => String(item)));
}

function channelsFor(catalog: SessionKitReferenceCatalog, hubId: string): Set<string> {
  if (catalog.channelIdsByHub instanceof Map) return catalogSet(catalog.channelIdsByHub.get(hubId));
  return catalogSet((catalog.channelIdsByHub as Readonly<Record<string, readonly string[]>>)[hubId]);
}

function issue(code: SessionKitReferenceIssueCode, reference: string, message: string): SessionKitReferenceIssue {
  return { code, reference, message };
}

/** Resolve stale server/device references before a kit is applied to the UI. */
export function validateSessionKitReferences(
  kit: SessionKit,
  catalog: SessionKitReferenceCatalog,
): SessionKitLaunchPlan {
  const issues: SessionKitReferenceIssue[] = [];
  const hubs = catalogSet(catalog.hubIds);
  const events = catalogSet(catalog.eventIds);
  const members = catalogSet(catalog.inviteUserIds);
  const inputs = catalogSet(catalog.inputDeviceIds);
  const outputs = catalogSet(catalog.outputDeviceIds);
  const hubId = hubs.has(kit.scope.hubId) ? kit.scope.hubId : null;
  if (!hubId)
    issues.push(
      issue(
        "hub-unavailable",
        kit.scope.hubId,
        "This Hub is no longer available; the kit will open at the safe home state.",
      ),
    );
  const channelId =
    hubId && kit.scope.channelId && channelsFor(catalog, hubId).has(kit.scope.channelId) ? kit.scope.channelId : null;
  if (kit.scope.channelId && !channelId)
    issues.push(issue("channel-unavailable", kit.scope.channelId, "This room is no longer available and was skipped."));
  const eventId = kit.scope.eventId && events.has(kit.scope.eventId) ? kit.scope.eventId : null;
  if (kit.scope.eventId && !eventId)
    issues.push(issue("event-unavailable", kit.scope.eventId, "This event is unavailable and was skipped."));
  // Invites are never restored from an unverified catalog. The caller must
  // provide current membership explicitly before any invite action is shown.
  const inviteUserIds = catalog.inviteUserIds ? kit.inviteUserIds.filter((userId) => members.has(userId)) : [];
  for (const userId of kit.inviteUserIds) {
    if (!inviteUserIds.includes(userId))
      issues.push(issue("invite-member-unavailable", userId, "An unavailable invite was skipped."));
  }
  const inputDeviceId =
    kit.voice.inputDeviceId && catalog.inputDeviceIds && inputs.has(kit.voice.inputDeviceId)
      ? kit.voice.inputDeviceId
      : null;
  if (kit.voice.inputDeviceId && !inputDeviceId)
    issues.push(
      issue(
        "input-device-unavailable",
        kit.voice.inputDeviceId,
        "The saved input is unavailable; the system input will be kept.",
      ),
    );
  const outputDeviceId =
    kit.voice.outputDeviceId && catalog.outputDeviceIds && outputs.has(kit.voice.outputDeviceId)
      ? kit.voice.outputDeviceId
      : null;
  if (kit.voice.outputDeviceId && !outputDeviceId)
    issues.push(
      issue(
        "output-device-unavailable",
        kit.voice.outputDeviceId,
        "The saved output is unavailable; the system output will be kept.",
      ),
    );
  const restoredVoice: SessionKitVoiceProfile = { ...kit.voice, inputDeviceId, outputDeviceId };
  const restored = {
    hubId,
    channelId,
    eventId,
    inviteUserIds,
    game: { ...kit.game },
    voice: restoredVoice,
    privacy: { ...kit.privacy },
  };
  const summary = [
    hubId ? `Hub: ${hubId}` : "Hub: unavailable (safe home state)",
    channelId ? `Room: ${channelId}` : kit.scope.channelId ? "Room: unavailable (skipped)" : "Room: unchanged",
    kit.game.name ? `Game: ${kit.game.name}${kit.game.platform ? ` · ${kit.game.platform}` : ""}` : "Game: not set",
    eventId ? `Event: ${eventId}` : kit.scope.eventId ? "Event: unavailable (skipped)" : "Event: none",
    inviteUserIds.length
      ? `Invites: ${inviteUserIds.length} available; unchanged until you choose Invite`
      : "Invites: none",
    "Microphone: unchanged until you choose Join and enable it",
    "Camera: unchanged until you choose Camera",
  ];
  return {
    kitId: kit.id,
    kitName: kit.name,
    intent: kit.intent,
    restored,
    issues,
    canLaunch: Boolean(hubId),
    summary,
    mediaActionRequired: ["microphone", "camera"],
    inviteActionRequired: inviteUserIds.length > 0,
  };
}

export const prepareSessionKitLaunch = validateSessionKitReferences;
