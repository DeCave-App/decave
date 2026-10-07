import {
  MAX_SESSION_KITS,
  SESSION_KIT_VERSION,
  createSessionKit,
  normalizeSessionKit,
  normalizeSessionKits,
  type SessionKit,
  type SessionKitDraft,
} from "../../shared/session-kit.ts";
import {
  accountStorageKey,
  browserLocalStorage,
  readLocalJsonResult,
  removeLocalValueResult,
  writeLocalJsonResult,
  type LocalStorageLike,
} from "./local-storage.ts";

export const SESSION_KITS_STORAGE_NAMESPACE = "decave-session-kits-v1";

export type SessionKitWriteResult = {
  ok: boolean;
  kits: SessionKit[];
  error?: string;
};

export type SessionKitRepository = {
  readonly key: string;
  load: () => SessionKit[];
  upsert: (kit: SessionKit | SessionKitDraft) => SessionKitWriteResult;
  remove: (kitId: string) => SessionKitWriteResult;
  clear: () => boolean;
  /** Last local storage failure, for a parent shell status region. */
  lastError: () => string | null;
};

type SessionKitRepositoryOptions = {
  storage?: LocalStorageLike | null;
  now?: () => number;
};

function writeKits(storage: LocalStorageLike | null, key: string, kits: SessionKit[]): { ok: boolean; error?: string } {
  const result = writeLocalJsonResult(storage, key, { version: SESSION_KIT_VERSION, kits });
  return { ok: result.ok, error: result.error };
}

/**
 * Account-scoped, device-local storage. Nothing is synchronized to a server;
 * callers should create a new repository when the authenticated account changes.
 */
export function createSessionKitRepository(
  accountId: string,
  options: SessionKitRepositoryOptions = {},
): SessionKitRepository {
  const storage = options.storage === undefined ? browserLocalStorage() : options.storage;
  const now = options.now ?? (() => Date.now());
  const key = accountStorageKey(SESSION_KITS_STORAGE_NAMESPACE, accountId);
  let storageError: string | null = null;
  const load = (): SessionKit[] => {
    const result = readLocalJsonResult(storage, key, []);
    storageError = result.ok ? null : (result.error ?? "Saved Session Kits could not be read.");
    return normalizeSessionKits(result.value ?? [], now());
  };
  const persist = (kits: SessionKit[]): SessionKitWriteResult => {
    const result = writeKits(storage, key, kits);
    storageError = result.ok ? null : (result.error ?? "Session Kit changes could not be saved.");
    return { ok: result.ok, kits, ...(result.error ? { error: result.error } : {}) };
  };
  return {
    key,
    load,
    upsert: (candidate) => {
      const timestamp = now();
      const input = candidate.id ? { ...candidate, updatedAt: new Date(timestamp).toISOString() } : candidate;
      const kit = candidate.id ? normalizeSessionKit(input, timestamp) : createSessionKit(input, timestamp);
      if (!kit) {
        const kits = load();
        const error = "This Session Kit is invalid and was not saved.";
        storageError = error;
        return { ok: false, kits, error };
      }
      const next = [kit, ...load().filter((existing) => existing.id !== kit.id)].slice(0, MAX_SESSION_KITS);
      return persist(next);
    },
    remove: (kitId) => {
      const current = load();
      const next = current.filter((kit) => kit.id !== kitId);
      return next.length === current.length ? { ok: true, kits: current } : persist(next);
    },
    clear: () => {
      const result = removeLocalValueResult(storage, key);
      storageError = result.ok ? null : (result.error ?? "Session Kits could not be cleared.");
      return result.ok;
    },
    lastError: () => storageError,
  };
}
