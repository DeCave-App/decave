// Voice-note settings kept on this phone: the chosen playback speed and, per
// account, which voice notes were played here (the newest 2,000). Stored in a
// small file; every read and write is best effort.

import { File, Paths } from "expo-file-system";
import { addPlayedId, type PendingReceipt } from "./played.ts";
import { isVoiceSpeed } from "./playback.ts";

type Stored = { speed?: number; played?: Record<string, string[]>; pending?: Record<string, PendingReceipt[]> };

let cache: Stored | null = null;
const listeners = new Set<() => void>();

const storeFile = () => new File(Paths.document, "decave-voice-notes.json");

function load(): Stored {
  if (cache) return cache;
  try {
    const file = storeFile();
    const raw = file.exists ? (JSON.parse(file.textSync()) as unknown) : {};
    cache = raw && typeof raw === "object" ? (raw as Stored) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(next: Stored) {
  cache = next;
  for (const listener of listeners) listener();
  try {
    const file = storeFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(next));
  } catch {
    /* storage unavailable: kept in memory for this session */
  }
}

export function subscribeVoiceStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readVoiceSpeed(): number {
  const speed = load().speed;
  return isVoiceSpeed(speed) ? speed : 1;
}

export function writeVoiceSpeed(speed: number) {
  save({ ...load(), speed });
}

export function isLocallyPlayed(accountId: string, messageId: string): boolean {
  const ids = load().played?.[accountId];
  return Array.isArray(ids) && ids.includes(messageId);
}

export function markLocallyPlayed(accountId: string, messageId: string) {
  if (!accountId) return;
  const current = load();
  const ids = current.played?.[accountId];
  save({
    ...current,
    played: { ...current.played, [accountId]: addPlayedId(Array.isArray(ids) ? ids : [], messageId) },
  });
}

/** Played marks not yet accepted by the server, sent again later. */
export function loadPendingReceipts(accountId: string): PendingReceipt[] {
  const list = load().pending?.[accountId];
  return Array.isArray(list)
    ? list.filter((p): p is PendingReceipt => !!p && typeof p.id === "string" && typeof p.fromUserId === "string")
    : [];
}

export function savePendingReceipts(accountId: string, pending: PendingReceipt[]) {
  const current = load();
  const all = { ...current.pending };
  if (pending.length) all[accountId] = pending;
  else delete all[accountId];
  save({ ...current, pending: all });
}

/** Sign-out / another account signing in: forget what this account played and its pending Played marks. */
export function forgetLocallyPlayed(accountId: string) {
  const current = load();
  if (!current.played?.[accountId] && !current.pending?.[accountId]) return;
  const played = { ...current.played };
  const pending = { ...current.pending };
  delete played[accountId];
  delete pending[accountId];
  save({ ...current, played, pending });
}
