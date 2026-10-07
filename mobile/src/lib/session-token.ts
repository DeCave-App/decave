const SESSION_KEY = "decave.mobile.session.v1";
let memoryToken: string | null = null;
let storageWrites: Promise<void> = Promise.resolve();
let mutationVersion = 0;

type SessionTokenStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string, options?: Record<string, unknown>) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY?: unknown;
};

async function resolveStore(store?: SessionTokenStore): Promise<SessionTokenStore> {
  return store ?? await import("expo-secure-store") as SessionTokenStore;
}

export function beginSessionTokenMutation(): number {
  return ++mutationVersion;
}

function enqueueStorageWrite(write: () => Promise<void>): Promise<void> {
  const next = storageWrites.then(write, write);
  storageWrites = next.catch(() => {});
  return next;
}

export async function loadSessionToken(store?: SessionTokenStore): Promise<string | null> {
  if (memoryToken) return memoryToken;
  const version = mutationVersion;
  let loadedToken: string | null = null;
  await enqueueStorageWrite(async () => {
    if (version !== mutationVersion) {
      loadedToken = memoryToken;
      return;
    }
    const tokenStore = await resolveStore(store);
    if (version !== mutationVersion) {
      loadedToken = memoryToken;
      return;
    }
    const storedToken = await tokenStore.getItemAsync(SESSION_KEY);
    if (version !== mutationVersion) {
      loadedToken = memoryToken;
      return;
    }
    memoryToken = storedToken;
    loadedToken = memoryToken;
  });
  return loadedToken;
}

export async function saveSessionToken(token: string, version = beginSessionTokenMutation(), store?: SessionTokenStore): Promise<void> {
  await enqueueStorageWrite(async () => {
    if (version !== mutationVersion) return;
    const tokenStore = await resolveStore(store);
    if (version !== mutationVersion) return;
    memoryToken = token;
    await tokenStore.setItemAsync(SESSION_KEY, token, {
      keychainAccessible: tokenStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });
}

export async function clearSessionToken(version = beginSessionTokenMutation(), store?: SessionTokenStore): Promise<void> {
  if (version === mutationVersion) memoryToken = null;
  await enqueueStorageWrite(async () => {
    if (version !== mutationVersion) return;
    const tokenStore = await resolveStore(store);
    if (version !== mutationVersion) return;
    memoryToken = null;
    await tokenStore.deleteItemAsync(SESSION_KEY);
  });
}
