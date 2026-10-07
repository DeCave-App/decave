/** Small, failure-tolerant local storage primitives used by session features. */

export type LocalStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LocalStorageOperationResult<T = void> = {
  ok: boolean;
  value?: T;
  /** A user-safe message; raw browser/storage exceptions are never exposed. */
  error?: string;
};

export function browserLocalStorage(): LocalStorageLike | null {
  try {
    return typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null;
  } catch {
    // Storage can throw in privacy-restricted contexts even when the property exists.
    return null;
  }
}

export function readLocalJson<T>(storage: LocalStorageLike | null | undefined, key: string, fallback: T): T {
  return readLocalJsonResult(storage, key, fallback).value as T;
}

export function readLocalJsonResult<T>(
  storage: LocalStorageLike | null | undefined,
  key: string,
  fallback: T,
): LocalStorageOperationResult<T> {
  if (!storage) return { ok: false, value: fallback, error: "Local storage is unavailable on this device." };
  try {
    const value = storage.getItem(key);
    return { ok: true, value: value === null ? fallback : (JSON.parse(value) as T) };
  } catch {
    return { ok: false, value: fallback, error: "Saved local data could not be read; using a safe empty state." };
  }
}

export function writeLocalJson(storage: LocalStorageLike | null | undefined, key: string, value: unknown): boolean {
  return writeLocalJsonResult(storage, key, value).ok;
}

export function writeLocalJsonResult(
  storage: LocalStorageLike | null | undefined,
  key: string,
  value: unknown,
): LocalStorageOperationResult {
  if (!storage) return { ok: false, error: "Local storage is unavailable on this device; your change was not saved." };
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch {
    // Quota errors and blocked storage must not break joining or messaging.
    return { ok: false, error: "Local storage rejected this change; your current session remains usable." };
  }
}

export function removeLocalValue(storage: LocalStorageLike | null | undefined, key: string): boolean {
  return removeLocalValueResult(storage, key).ok;
}

export function removeLocalValueResult(
  storage: LocalStorageLike | null | undefined,
  key: string,
): LocalStorageOperationResult {
  if (!storage) return { ok: false, error: "Local storage is unavailable on this device; saved data was kept." };
  try {
    storage.removeItem(key);
    return { ok: true };
  } catch {
    return { ok: false, error: "Local storage rejected clearing this data; nothing was removed." };
  }
}

export function accountStorageKey(namespace: string, accountId: string): string {
  const normalizedAccountId = accountId.trim();
  const encodedAccountId = encodeURIComponent(normalizedAccountId);
  // Do not truncate: two authenticated account IDs must never share a key.
  const safeAccountId = encodedAccountId;
  return `${namespace}:${safeAccountId || "anonymous"}`;
}
