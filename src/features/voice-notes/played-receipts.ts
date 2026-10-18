// When the listener plays someone else's DM voice note: clear the dot on this
// device and mark it played inside their encrypted reactions envelope. A mark
// the server has not accepted yet stays pending in localStorage (per account)
// and is sent again on bubble mount, DM open and reconnect.

import { createPlayedQueue, type PendingPlayed } from "../../../shared/voice-played.ts";

const MAX_PENDING = 2000;
const pendingKey = (accountId: string) => `decave.voiceNote.pendingPlayed.${accountId}`;

export function loadPendingPlayed(
  accountId: string,
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): PendingPlayed[] {
  try {
    const raw = JSON.parse(storage?.getItem(pendingKey(accountId)) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((p): p is PendingPlayed => !!p && typeof p.id === "string" && typeof p.fromUserId === "string")
      : [];
  } catch {
    return [];
  }
}

export function savePendingPlayed(
  accountId: string,
  pending: PendingPlayed[],
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage(),
): void {
  try {
    if (!pending.length) storage?.removeItem(pendingKey(accountId));
    else storage?.setItem(pendingKey(accountId), JSON.stringify(pending.slice(-MAX_PENDING)));
  } catch {
    /* storage unavailable: the mark is retried while the page stays open only */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

type Request = (path: string, init: { method: string; body: unknown }) => Promise<{ ok: boolean; data?: unknown }>;

/**
 * The web queue: `sendPlayed` is the shared e2ee glue (createDmE2eeSending),
 * `request` the authorized fetch. Exported as a factory so tests drive the real glue.
 */
export function createWebPlayedQueue(deps: {
  sendPlayed: (request: Request, message: PendingPlayed, me: string) => Promise<boolean>;
  request: Request;
  markLocal: (accountId: string, messageId: string) => void;
  loadPending?: (accountId: string) => PendingPlayed[];
  savePending?: (accountId: string, pending: PendingPlayed[]) => void;
}) {
  return createPlayedQueue<void>({
    send: (message, _context, me) => deps.sendPlayed(deps.request, message, me),
    markLocal: deps.markLocal,
    loadPending: deps.loadPending ?? ((accountId) => loadPendingPlayed(accountId)),
    savePending: deps.savePending ?? ((accountId, pending) => savePendingPlayed(accountId, pending)),
  });
}
