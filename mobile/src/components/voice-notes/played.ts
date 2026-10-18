// "Played" bookkeeping. Every note played is remembered on this phone (Hub rooms
// only have that). In DMs the listener also marks it played inside their
// encrypted reactions envelope (`p: true`); until the server has it, the mark
// stays pending on the phone and is sent again later (a repeat is harmless).

import { createPlayedQueue, type PendingPlayed } from "../../lib/voice-played.ts";

export const MAX_PLAYED_IDS = 2000;

/** Adds an id to the remembered list, newest last, keeping the newest 2,000. */
export function addPlayedId(ids: readonly string[], messageId: string): string[] {
  const next = ids.filter((id) => id !== messageId);
  next.push(messageId);
  return next.slice(-MAX_PLAYED_IDS);
}

export type PendingReceipt = PendingPlayed;

type ApiFetch = (path: string, init: { method: string; headers: Record<string, string>; body: string }, token: string | null) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** The request function sendPlayed expects, made with this account's token. */
export function receiptRequest(apiFetch: ApiFetch, token: string | null) {
  return async (path: string, init: { method: string; body: unknown }) => {
    try {
      const response = await apiFetch(
        path,
        { method: init.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) },
        token,
      );
      return { ok: response.ok, data: await response.json().catch(() => ({})) };
    } catch {
      return { ok: false };
    }
  };
}

/** The phone's queue; the context passed to report/retry is this account's token. */
export function createPlayedReceipts(deps: {
  send: (message: PendingReceipt, token: string | null, selfId: string) => Promise<boolean>;
  markLocal: (accountId: string, messageId: string) => void;
  loadPending: (accountId: string) => PendingReceipt[];
  savePending: (accountId: string, pending: PendingReceipt[]) => void;
}) {
  return createPlayedQueue<string | null>(deps);
}
