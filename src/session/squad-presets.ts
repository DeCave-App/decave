import {
  accountStorageKey,
  browserLocalStorage,
  readLocalJsonResult,
  removeLocalValueResult,
  writeLocalJsonResult,
  type LocalStorageLike,
} from "./local-storage.ts";

export const SQUAD_PRESETS_STORAGE_NAMESPACE = "decave-squad-presets-v1";
export const MAX_SQUAD_PRESETS = 30;

/** These fields match the existing /api/squad-finder request exactly. */
export type SupportedSquadFilters = {
  game: string;
  platform: string;
  language: string;
  region: string;
  microphoneRequired: boolean;
};

/**
 * Saved-only preferences are useful when choosing a preset but are not sent
 * to the current matcher. The UI must keep the support label visible.
 */
export type SquadPresetExtras = {
  playStyle: "any" | "casual" | "competitive";
  timeWindow: string | null;
  partySize: { min: number; max: number };
};

export type SquadPreset = {
  version: 1;
  id: string;
  name: string;
  filters: SupportedSquadFilters;
  extras: SquadPresetExtras;
  createdAt: string;
  updatedAt: string;
};

export type SquadPresetDraft = Omit<SquadPreset, "version" | "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<SquadPreset, "id" | "createdAt" | "updatedAt">>;

export const SQUAD_PRESET_EXTRA_SUPPORT = {
  playStyle: {
    label: "Play style",
    status: "saved-only" as const,
    detail: "Saved in this device; the current matcher does not filter by play style.",
  },
  timeWindow: {
    label: "Time window",
    status: "saved-only" as const,
    detail: "Saved in this device; the current matcher does not filter by time window.",
  },
  partySize: {
    label: "Party size",
    status: "saved-only" as const,
    detail: "Saved in this device; the current matcher does not filter by party size.",
  },
} as const;

function text(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const result = value.trim().slice(0, max);
  return result || fallback;
}

function id(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().slice(0, 160);
  return result || null;
}

function iso(value: unknown, now: number): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date(now).toISOString();
}

function randomId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function")
      return `squad-preset-${globalThis.crypto.randomUUID().slice(0, 12)}`;
  } catch {
    // Timestamp fallback is local-only.
  }
  return `squad-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSquadPreset(value: unknown, now = Date.now()): SquadPreset | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawFilters = raw.filters && typeof raw.filters === "object" ? (raw.filters as Record<string, unknown>) : {};
  const rawExtras = raw.extras && typeof raw.extras === "object" ? (raw.extras as Record<string, unknown>) : {};
  const presetId = id(raw.id);
  if (!presetId) return null;
  const playStyle =
    rawExtras.playStyle === "casual" || rawExtras.playStyle === "competitive" ? rawExtras.playStyle : "any";
  const rawParty =
    rawExtras.partySize && typeof rawExtras.partySize === "object"
      ? (rawExtras.partySize as Record<string, unknown>)
      : {};
  const min =
    typeof rawParty.min === "number" && Number.isFinite(rawParty.min)
      ? Math.max(1, Math.min(20, Math.floor(rawParty.min)))
      : 1;
  const max =
    typeof rawParty.max === "number" && Number.isFinite(rawParty.max)
      ? Math.max(min, Math.min(20, Math.floor(rawParty.max)))
      : 4;
  return {
    version: 1,
    id: presetId,
    name: text(raw.name, 64, "Squad preset"),
    filters: {
      game: text(rawFilters.game, 100, ""),
      platform: text(rawFilters.platform, 60, "Any platform"),
      language: text(rawFilters.language, 60, "Any language"),
      region: text(rawFilters.region, 60, "Any region"),
      microphoneRequired: rawFilters.microphoneRequired === true,
    },
    extras: {
      playStyle,
      timeWindow:
        typeof rawExtras.timeWindow === "string" && rawExtras.timeWindow.trim()
          ? rawExtras.timeWindow.trim().slice(0, 80)
          : null,
      partySize: { min, max },
    },
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

export function createSquadPreset(input: SquadPresetDraft, now = Date.now()): SquadPreset {
  const stamp = new Date(now).toISOString();
  return (
    normalizeSquadPreset(
      {
        ...input,
        id: input.id ?? randomId(),
        createdAt: input.createdAt ?? stamp,
        updatedAt: input.updatedAt ?? stamp,
      },
      now,
    ) ?? {
      version: 1,
      id: randomId(),
      name: "Squad preset",
      filters: {
        game: "",
        platform: "Any platform",
        language: "Any language",
        region: "Any region",
        microphoneRequired: false,
      },
      extras: { playStyle: "any", timeWindow: null, partySize: { min: 1, max: 4 } },
      createdAt: stamp,
      updatedAt: stamp,
    }
  );
}

export function normalizeSquadPresets(value: unknown, now = Date.now()): SquadPreset[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).presets)
      ? ((value as Record<string, unknown>).presets as unknown[])
      : [];
  const seen = new Set<string>();
  const presets: SquadPreset[] = [];
  for (const item of raw.slice(0, MAX_SQUAD_PRESETS)) {
    const preset = normalizeSquadPreset(item, now);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    presets.push(preset);
  }
  return presets;
}

export function toSupportedSquadSearchRequest(filters: SupportedSquadFilters): SupportedSquadFilters {
  return {
    game: text(filters.game, 100, ""),
    platform: text(filters.platform, 60, "Any platform"),
    language: text(filters.language, 60, "Any language"),
    region: text(filters.region, 60, "Any region"),
    microphoneRequired: filters.microphoneRequired === true,
  };
}

export function unsupportedSquadPresetExtras(preset: SquadPreset): string[] {
  const extras: string[] = [];
  if (preset.extras.playStyle !== "any") extras.push(`${SQUAD_PRESET_EXTRA_SUPPORT.playStyle.label}: saved only`);
  if (preset.extras.timeWindow) extras.push(`${SQUAD_PRESET_EXTRA_SUPPORT.timeWindow.label}: saved only`);
  if (preset.extras.partySize.min !== 1 || preset.extras.partySize.max !== 4)
    extras.push(`${SQUAD_PRESET_EXTRA_SUPPORT.partySize.label}: saved only`);
  return extras;
}

export type SquadPresetRepository = {
  readonly key: string;
  load: () => SquadPreset[];
  upsert: (preset: SquadPreset | SquadPresetDraft) => { ok: boolean; presets: SquadPreset[]; error?: string };
  remove: (presetId: string) => { ok: boolean; presets: SquadPreset[]; error?: string };
  clear: () => boolean;
  lastError: () => string | null;
};

export function createSquadPresetRepository(
  accountId: string,
  options: { storage?: LocalStorageLike | null; now?: () => number } = {},
): SquadPresetRepository {
  const storage = options.storage === undefined ? browserLocalStorage() : options.storage;
  const now = options.now ?? (() => Date.now());
  const key = accountStorageKey(SQUAD_PRESETS_STORAGE_NAMESPACE, accountId);
  let storageError: string | null = null;
  const load = () => {
    const result = readLocalJsonResult(storage, key, []);
    storageError = result.ok ? null : (result.error ?? "Squad presets could not be read.");
    return normalizeSquadPresets(result.value ?? [], now());
  };
  const persist = (presets: SquadPreset[]) => {
    const result = writeLocalJsonResult(storage, key, { version: 1, presets });
    storageError = result.ok ? null : (result.error ?? "Squad presets could not be saved.");
    return { ok: result.ok, presets, ...(result.error ? { error: result.error } : {}) };
  };
  return {
    key,
    load,
    upsert: (candidate) => {
      const timestamp = now();
      const preset = candidate.id
        ? normalizeSquadPreset({ ...candidate, updatedAt: new Date(timestamp).toISOString() }, timestamp)
        : createSquadPreset(candidate, timestamp);
      if (!preset) {
        const presets = load();
        const error = "This squad preset is invalid and was not saved.";
        storageError = error;
        return { ok: false, presets, error };
      }
      return persist([preset, ...load().filter((item) => item.id !== preset.id)].slice(0, MAX_SQUAD_PRESETS));
    },
    remove: (presetId) => {
      const current = load();
      const next = current.filter((preset) => preset.id !== presetId);
      return next.length === current.length ? { ok: true, presets: current } : persist(next);
    },
    clear: () => {
      const result = removeLocalValueResult(storage, key);
      storageError = result.ok ? null : (result.error ?? "Squad presets could not be cleared.");
      return result.ok;
    },
    lastError: () => storageError,
  };
}
