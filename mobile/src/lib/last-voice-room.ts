import * as SecureStore from "expo-secure-store";

export type LastVoiceRoom = { channelId: number; hubId: number; name: string; squad?: boolean };

const LEGACY_KEY = "decave.lastVoiceRoom";
let accountId: string | null = null;
let generation = 0;
const listeners = new Set<(room: LastVoiceRoom) => void>();
const storageQueues = new Map<string, Promise<unknown>>();

void SecureStore.deleteItemAsync(LEGACY_KEY).catch(() => undefined);

export function lastVoiceRoomStorageKey(userId: string | null): string | null {
  if (!userId) return null;
  const encodedId = Array.from(userId, (character) => character.codePointAt(0)!.toString(16)).join(".");
  return `decave.lastVoiceRoom.v2.${encodedId}`;
}

function queueStorageOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = storageQueues.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  storageQueues.set(key, next.then(() => undefined, () => undefined));
  return next;
}

/** Call synchronously before changing auth state so pending writes cannot cross accounts. */
export function setLastVoiceRoomAccount(userId: string | null): void {
  if (accountId === userId) return;
  const previousKey = lastVoiceRoomStorageKey(accountId);
  accountId = userId;
  generation += 1;
  if (previousKey) void queueStorageOperation(previousKey, () => SecureStore.deleteItemAsync(previousKey)).catch(() => undefined);
}

export function lastVoiceRoomGeneration(): number {
  return generation;
}

/** Called after each save, so system surfaces can pick up the room name. */
export function onLastVoiceRoomSaved(listener: (room: LastVoiceRoom) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function saveLastVoiceRoom(room: LastVoiceRoom): Promise<void> {
  const key = lastVoiceRoomStorageKey(accountId);
  const writeGeneration = generation;
  if (!key) return;
  try {
    await queueStorageOperation(key, () => SecureStore.setItemAsync(key, JSON.stringify(room)));
    if (writeGeneration !== generation || key !== lastVoiceRoomStorageKey(accountId)) return;
    listeners.forEach((listener) => listener(room));
  } catch (error) {
    console.warn("[voice] could not remember last room", error);
  }
}

export async function loadLastVoiceRoom(): Promise<LastVoiceRoom | null> {
  const key = lastVoiceRoomStorageKey(accountId);
  const loadGeneration = generation;
  if (!key) return null;
  try {
    const raw = await queueStorageOperation(key, () => SecureStore.getItemAsync(key));
    if (loadGeneration !== generation || key !== lastVoiceRoomStorageKey(accountId) || !raw) return null;
    const value = JSON.parse(raw) as LastVoiceRoom;
    return Number.isFinite(value.channelId) && value.channelId > 0 ? value : null;
  } catch {
    return null;
  }
}

export function voiceRoomHref(room: LastVoiceRoom): string {
  return `/voice/${room.channelId}?hubId=${room.hubId}&name=${encodeURIComponent(room.name)}${room.squad ? "&squad=1" : ""}`;
}

/** Resolves only a room name from the account generation that requested it. */
export async function roomNameFor(channelId: number | null): Promise<string> {
  const requestedGeneration = generation;
  const saved = await loadLastVoiceRoom();
  if (requestedGeneration !== generation) return "Voice room";
  if (saved && saved.channelId === channelId) return saved.name;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop();
      resolve("Voice room");
    }, 4000);
    const stop = onLastVoiceRoomSaved((room) => {
      if (requestedGeneration !== generation) {
        clearTimeout(timer);
        stop();
        resolve("Voice room");
        return;
      }
      if (room.channelId !== channelId) return;
      clearTimeout(timer);
      stop();
      resolve(room.name);
    });
  });
}
