// Voice notes: "Played" in encrypted DMs. The listener marks a note played with
// `p: true` inside their own encrypted reactions envelope on it (see
// sealReactions in dm-e2ee.ts), so the server only ever sees an ordinary
// reactions update. Until the server accepts it, the mark stays pending on the
// device and is sent again later (sending it twice is harmless).
// The mobile app keeps an identical copy (scripts/dev/sync-dm-e2ee.mjs).

/** True when someone other than `selfId` marked the note played. */
export function playedByOthers(playedBy: readonly string[] | null | undefined, selfId: string): boolean {
  return (playedBy ?? []).some((id) => id !== selfId);
}

export type PendingPlayed = { id: string; fromUserId: string };

const MAX_PENDING = 2000;

/**
 * The listener's queue of Played marks: `report` clears the dot here and sends
 * the mark, keeping it pending until `send` resolves true; `retry` sends every
 * mark still pending (bubble mount, conversation open, reconnect). `context` is
 * passed through to `send` (the mobile app's token, for instance).
 */
export function createPlayedQueue<C = undefined>(deps: {
  send: (message: PendingPlayed, context: C, selfId: string) => Promise<boolean>;
  markLocal: (accountId: string, messageId: string) => void;
  loadPending: (accountId: string) => PendingPlayed[];
  savePending: (accountId: string, pending: PendingPlayed[]) => void;
}) {
  const inFlight = new Set<string>();

  function attempt(selfId: string, message: PendingPlayed, context: C) {
    const key = `${selfId}:${message.id}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void deps
      .send(message, context, selfId)
      .catch(() => false)
      .then((ok) => {
        inFlight.delete(key);
        if (ok)
          deps.savePending(
            selfId,
            deps.loadPending(selfId).filter((p) => p.id !== message.id),
          );
      });
  }

  return {
    /** The listener played someone else's note: clear the dot here and send the mark. */
    report(selfId: string, message: PendingPlayed, context: C) {
      if (!selfId || message.fromUserId === selfId) return;
      deps.markLocal(selfId, message.id);
      const pending = deps.loadPending(selfId);
      if (!pending.some((p) => p.id === message.id)) {
        const entry: PendingPlayed = { id: message.id, fromUserId: message.fromUserId };
        deps.savePending(selfId, [...pending, entry].slice(-MAX_PENDING));
      }
      attempt(selfId, { id: message.id, fromUserId: message.fromUserId }, context);
    },
    /** Sends every mark still pending. */
    retry(selfId: string, context: C) {
      if (!selfId) return;
      for (const pending of deps.loadPending(selfId)) attempt(selfId, pending, context);
    },
  };
}
