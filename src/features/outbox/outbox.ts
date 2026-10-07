// Messages you sent that the server hasn't confirmed yet. A message shows as
// "Sending…" until its own echo comes back over the realtime socket; with no
// echo after SEND_TIMEOUT_MS, or when the server rejects it, it becomes
// "Couldn't send" with Retry and Delete. Messages written while offline wait
// as "queued" and go out when the connection is back.

export type OutboxStatus = "queued" | "sending" | "failed";

export type OutboxItem<A = unknown> = {
  localId: string;
  channelId: number;
  text: string;
  replyToId: string | null;
  attachment: A | null;
  status: OutboxStatus;
  sentAt: number;
  error?: string;
};

export const SEND_TIMEOUT_MS = 12_000;

/** The echo of one of our messages arrived: drop the oldest matching pending item. */
export function resolveEcho<A>(items: readonly OutboxItem<A>[], channelId: number, text: string): OutboxItem<A>[] {
  const index = items.findIndex(
    (item) => item.channelId === channelId && item.status !== "failed" && item.text === text,
  );
  if (index < 0) return items as OutboxItem<A>[];
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

/** Anything still "sending" after the timeout has failed. */
export function failStale<A>(items: readonly OutboxItem<A>[], now: number): OutboxItem<A>[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.status === "sending" && now - item.sentAt > SEND_TIMEOUT_MS) {
      changed = true;
      return {
        ...item,
        status: "failed" as const,
        error: "No reply from DeCave. Check your connection and try again.",
      };
    }
    return item;
  });
  return changed ? next : (items as OutboxItem<A>[]);
}

/** The server rejected the newest message we sent (slow mode, timeouts, permissions…). */
export function failNewestSending<A>(items: readonly OutboxItem<A>[], error: string): OutboxItem<A>[] {
  let index = -1;
  items.forEach((item, i) => {
    if (item.status === "sending" && (index < 0 || item.sentAt >= items[index].sentAt)) index = i;
  });
  if (index < 0) return items as OutboxItem<A>[];
  const next = [...items];
  next[index] = { ...next[index], status: "failed", error };
  return next;
}

export function setStatus<A>(
  items: readonly OutboxItem<A>[],
  localId: string,
  status: OutboxStatus,
  now: number,
): OutboxItem<A>[] {
  return items.map((item) => (item.localId === localId ? { ...item, status, sentAt: now, error: undefined } : item));
}

export function removeItem<A>(items: readonly OutboxItem<A>[], localId: string): OutboxItem<A>[] {
  return items.filter((item) => item.localId !== localId);
}
