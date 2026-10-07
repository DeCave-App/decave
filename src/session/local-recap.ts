import {
  accountStorageKey,
  browserLocalStorage,
  readLocalJsonResult,
  removeLocalValueResult,
  writeLocalJsonResult,
  type LocalStorageLike,
} from "./local-storage.ts";

export const LOCAL_RECAP_STORAGE_NAMESPACE = "decave-local-session-recap-v1";
export const MAX_RECAP_ACTIONS = 500;

type LocalRecapActionBase = {
  id: string;
  sessionId: string;
  occurredAt: string;
};

export type LocalRecapAction =
  | (LocalRecapActionBase & { kind: "session-started"; hubId: string; hubName?: string })
  | (LocalRecapActionBase & { kind: "session-ended"; hubId: string; hubName?: string })
  | (LocalRecapActionBase & { kind: "channel-visited"; hubId: string; channelId: string; channelName: string })
  | (LocalRecapActionBase & { kind: "participant-seen"; userId: string; displayName: string })
  | (LocalRecapActionBase & { kind: "shared-link"; url: string; label: string })
  | (LocalRecapActionBase & { kind: "poll-created"; pollId: string; question: string; optionCount: number })
  | (LocalRecapActionBase & { kind: "event-scheduled"; eventId: string; title: string; startAt: string })
  | (LocalRecapActionBase & { kind: "follow-up-scheduled"; followUpId: string; title: string; dueAt: string });

/** Input accepted at UI boundaries; runtime normalization enforces fields for each kind. */
export type LocalRecapActionInput = {
  id?: string;
  sessionId?: string;
  occurredAt?: string;
  kind: LocalRecapAction["kind"];
  hubId?: string;
  hubName?: string;
  channelId?: string;
  channelName?: string;
  userId?: string;
  displayName?: string;
  url?: string;
  label?: string;
  pollId?: string;
  question?: string;
  optionCount?: number;
  eventId?: string;
  title?: string;
  startAt?: string;
  followUpId?: string;
  dueAt?: string;
};

export type LocalSessionRecap = {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  hub: { id: string; name: string | null } | null;
  participants: Array<{ userId: string; displayName: string }>;
  channels: Array<{ hubId: string; channelId: string; channelName: string }>;
  sharedLinks: Array<{ url: string; label: string }>;
  polls: Array<{ pollId: string; question: string; optionCount: number }>;
  events: Array<{ eventId: string; title: string; startAt: string }>;
  followUps: Array<{ followUpId: string; title: string; dueAt: string }>;
  actionCount: number;
  /** Plain local note generated from the action log, with no audio or private message content. */
  note: string;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().slice(0, max);
  return result || null;
}

function id(value: unknown): string | null {
  const result = text(value, 160);
  return result && !/[\u0000-\u001f]/.test(result) ? result : null;
}

function time(value: unknown, fallback: number): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date(fallback).toISOString();
}

function requiredTime(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function safeUrl(value: unknown): string | null {
  const result = text(value, 2_000);
  if (!result) return null;
  try {
    const parsed = new URL(result);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function randomId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return `recap-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Timestamp IDs remain local and collision-resistant enough for this log.
  }
  return `recap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Accept only the explicit action union. Unknown fields (including audio,
 * transcript, and private message fields) are intentionally never copied.
 */
export function normalizeLocalRecapAction(value: unknown, now = Date.now()): LocalRecapAction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const kind = raw.kind;
  const sessionId = id(raw.sessionId);
  if (!sessionId || typeof kind !== "string") return null;
  const base = {
    id: id(raw.id) ?? randomId(),
    sessionId,
    occurredAt: time(raw.occurredAt, now),
  };
  if (kind === "session-started" || kind === "session-ended") {
    const hubId = id(raw.hubId);
    if (!hubId) return null;
    return {
      ...base,
      kind,
      hubId,
      ...(text(raw.hubName, 120) ? { hubName: text(raw.hubName, 120)! } : {}),
    } as LocalRecapAction;
  }
  if (kind === "channel-visited") {
    const hubId = id(raw.hubId);
    const channelId = id(raw.channelId);
    const channelName = text(raw.channelName, 120);
    return hubId && channelId && channelName ? { ...base, kind, hubId, channelId, channelName } : null;
  }
  if (kind === "participant-seen") {
    const userId = id(raw.userId);
    const displayName = text(raw.displayName, 120);
    return userId && displayName ? { ...base, kind, userId, displayName } : null;
  }
  if (kind === "shared-link") {
    const url = safeUrl(raw.url);
    const label = text(raw.label, 160);
    return url && label ? { ...base, kind, url, label } : null;
  }
  if (kind === "poll-created") {
    const pollId = id(raw.pollId);
    const question = text(raw.question, 240);
    const optionCount =
      typeof raw.optionCount === "number" && Number.isInteger(raw.optionCount) && raw.optionCount >= 2
        ? Math.min(8, raw.optionCount)
        : null;
    return pollId && question && optionCount !== null ? { ...base, kind, pollId, question, optionCount } : null;
  }
  if (kind === "event-scheduled") {
    const eventId = id(raw.eventId);
    const title = text(raw.title, 160);
    const startAt = requiredTime(raw.startAt);
    return eventId && title && startAt ? { ...base, kind, eventId, title, startAt } : null;
  }
  if (kind === "follow-up-scheduled") {
    const followUpId = id(raw.followUpId);
    const title = text(raw.title, 160);
    const dueAt = requiredTime(raw.dueAt);
    return followUpId && title && dueAt ? { ...base, kind, followUpId, title, dueAt } : null;
  }
  return null;
}

export function normalizeLocalRecapActions(value: unknown, now = Date.now()): LocalRecapAction[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).actions)
      ? ((value as Record<string, unknown>).actions as unknown[])
      : [];
  const seen = new Set<string>();
  const actions: LocalRecapAction[] = [];
  for (const item of raw.slice(-MAX_RECAP_ACTIONS)) {
    const action = normalizeLocalRecapAction(item, now);
    if (!action || seen.has(action.id)) continue;
    seen.add(action.id);
    actions.push(action);
  }
  return actions;
}

export function buildLocalSessionRecap(
  sessionId: string,
  actions: readonly LocalRecapAction[],
  now = Date.now(),
): LocalSessionRecap {
  void now;
  const selected = actions
    .filter((action) => action.sessionId === sessionId)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const firstStart = selected.find(
    (action): action is Extract<LocalRecapAction, { kind: "session-started" }> => action.kind === "session-started",
  );
  const lastEnd = [...selected]
    .reverse()
    .find((action): action is Extract<LocalRecapAction, { kind: "session-ended" }> => action.kind === "session-ended");
  const hubAction =
    firstStart ??
    selected.find(
      (action): action is Extract<LocalRecapAction, { kind: "session-ended" }> => action.kind === "session-ended",
    );
  const participants = [
    ...new Map(
      selected
        .filter(
          (action): action is Extract<LocalRecapAction, { kind: "participant-seen" }> =>
            action.kind === "participant-seen",
        )
        .map((action) => [action.userId, { userId: action.userId, displayName: action.displayName }]),
    ).values(),
  ];
  const channels = [
    ...new Map(
      selected
        .filter(
          (action): action is Extract<LocalRecapAction, { kind: "channel-visited" }> =>
            action.kind === "channel-visited",
        )
        .map((action) => [
          `${action.hubId}:${action.channelId}`,
          { hubId: action.hubId, channelId: action.channelId, channelName: action.channelName },
        ]),
    ).values(),
  ];
  const sharedLinks = [
    ...new Map(
      selected
        .filter((action): action is Extract<LocalRecapAction, { kind: "shared-link" }> => action.kind === "shared-link")
        .map((action) => [action.url, { url: action.url, label: action.label }]),
    ).values(),
  ];
  const polls = [
    ...new Map(
      selected
        .filter(
          (action): action is Extract<LocalRecapAction, { kind: "poll-created" }> => action.kind === "poll-created",
        )
        .map(({ pollId, question, optionCount }) => [pollId, { pollId, question, optionCount }]),
    ).values(),
  ];
  const events = [
    ...new Map(
      selected
        .filter(
          (action): action is Extract<LocalRecapAction, { kind: "event-scheduled" }> =>
            action.kind === "event-scheduled",
        )
        .map(({ eventId, title, startAt }) => [eventId, { eventId, title, startAt }]),
    ).values(),
  ];
  const followUps = [
    ...new Map(
      selected
        .filter(
          (action): action is Extract<LocalRecapAction, { kind: "follow-up-scheduled" }> =>
            action.kind === "follow-up-scheduled",
        )
        .map(({ followUpId, title, dueAt }) => [followUpId, { followUpId, title, dueAt }]),
    ).values(),
  ];
  const hubLabel = hubAction?.hubName || hubAction?.hubId || "your session";
  const noteParts = [`${selected.length} local action${selected.length === 1 ? "" : "s"} recorded in ${hubLabel}.`];
  if (participants.length)
    noteParts.push(`${participants.length} participant${participants.length === 1 ? "" : "s"} visible.`);
  if (channels.length) noteParts.push(`${channels.length} room${channels.length === 1 ? "" : "s"} visited.`);
  if (sharedLinks.length) noteParts.push(`${sharedLinks.length} shared link${sharedLinks.length === 1 ? "" : "s"}.`);
  if (polls.length || events.length || followUps.length)
    noteParts.push(
      `${polls.length + events.length + followUps.length} planning item${polls.length + events.length + followUps.length === 1 ? "" : "s"}.`,
    );
  return {
    sessionId,
    startedAt: firstStart?.occurredAt ?? null,
    endedAt: lastEnd?.occurredAt ?? null,
    hub: hubAction ? { id: hubAction.hubId, name: hubAction.hubName ?? null } : null,
    participants,
    channels,
    sharedLinks,
    polls,
    events,
    followUps,
    actionCount: selected.length,
    note: noteParts.join(" "),
  };
}

export type LocalRecapRepository = {
  readonly key: string;
  load: () => LocalRecapAction[];
  append: (action: LocalRecapActionInput) => { ok: boolean; actions: LocalRecapAction[]; error?: string };
  clear: () => boolean;
  lastError: () => string | null;
};

export function createLocalRecapRepository(
  accountId: string,
  options: { storage?: LocalStorageLike | null; now?: () => number } = {},
): LocalRecapRepository {
  const storage = options.storage === undefined ? browserLocalStorage() : options.storage;
  const now = options.now ?? (() => Date.now());
  const key = accountStorageKey(LOCAL_RECAP_STORAGE_NAMESPACE, accountId);
  let storageError: string | null = null;
  const load = () => {
    const result = readLocalJsonResult(storage, key, []);
    storageError = result.ok ? null : (result.error ?? "Local session recap could not be read.");
    return normalizeLocalRecapActions(result.value ?? [], now());
  };
  return {
    key,
    load,
    append: (input) => {
      const action = normalizeLocalRecapAction(
        { ...input, occurredAt: input.occurredAt ?? new Date(now()).toISOString() },
        now(),
      );
      if (!action) {
        const actions = load();
        const error = "This recap action is invalid and was not recorded.";
        storageError = error;
        return { ok: false, actions, error };
      }
      const actions = [...load().filter((current) => current.id !== action.id), action].slice(-MAX_RECAP_ACTIONS);
      const result = writeLocalJsonResult(storage, key, { version: 1, actions });
      storageError = result.ok ? null : (result.error ?? "Local session recap could not be saved.");
      return { ok: result.ok, actions, ...(result.error ? { error: result.error } : {}) };
    },
    clear: () => {
      const result = removeLocalValueResult(storage, key);
      storageError = result.ok ? null : (result.error ?? "Local session recap could not be cleared.");
      return result.ok;
    },
    lastError: () => storageError,
  };
}
