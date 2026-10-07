// Where this browser or desktop app keeps an account's DM encryption keyring (the
// current key and the ones it replaced, 32 bytes each): an IndexedDB record per
// account, so it survives restarts but never leaves the device. Signing out
// removes it (see dm-e2ee-client.ts).
//
// In the desktop app the record holds the key wrapped by the OS keychain
// (Electron safeStorage, through the preload bridge), so a copy of the profile
// folder is useless without the user's OS login. Browsers, and desktops without a
// keychain, store the key itself.

const DB_NAME = "decave-e2ee";
const STORE = "account-keys";

type StoredKey = Uint8Array | { v: 1; keychain: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser can't store encryption keys."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open key storage."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("Key storage failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Key storage failed."));
    });
  } finally {
    db.close();
  }
}

function keychain() {
  return typeof window !== "undefined" ? window.decaveDesktop?.e2eeKeys : undefined;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The record to store: wrapped by the OS keychain when there is one. */
async function recordFor(keyring: Uint8Array): Promise<StoredKey> {
  const wrapped = await keychain()
    ?.protect(toBase64(keyring))
    .catch(() => null);
  return wrapped ? { v: 1, keychain: wrapped } : keyring;
}

function isKeyring(bytes: Uint8Array): boolean {
  return bytes.length >= 32 && bytes.length % 32 === 0;
}

export async function loadAccountKeyring(accountId: string): Promise<Uint8Array | null> {
  const value = await withStore<unknown>("readonly", (store) => store.get(accountId));
  if (value instanceof Uint8Array && isKeyring(value)) {
    // Stored before the OS keychain was used (or without one): wrap it now if we can.
    if (keychain()) {
      const record = await recordFor(value);
      if (!(record instanceof Uint8Array)) await withStore("readwrite", (store) => store.put(record, accountId));
    }
    return value;
  }
  if (value && typeof value === "object" && typeof (value as { keychain?: unknown }).keychain === "string") {
    const unwrapped = await keychain()
      ?.unprotect((value as { keychain: string }).keychain)
      .catch(() => null);
    if (!unwrapped) return null; // another OS user, or the keychain is gone: unlock again
    const keyring = fromBase64(unwrapped);
    return isKeyring(keyring) ? keyring : null;
  }
  return null;
}

export async function saveAccountKeyring(accountId: string, keyring: Uint8Array): Promise<void> {
  const record = await recordFor(keyring);
  await withStore("readwrite", (store) => store.put(record, accountId));
}

export async function forgetAccountKeyring(accountId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(accountId));
}
