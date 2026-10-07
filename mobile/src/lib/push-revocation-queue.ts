export type PendingPushAction =
  | { kind: "logout"; sessionToken: string }
  | { kind: "unlink"; sessionToken: string; pushToken: string };

export type PushActionResponse = { ok: boolean; status: number };

export function enqueuePushAction(pending: PendingPushAction[], action: PendingPushAction): PendingPushAction[] {
  if (action.kind === "logout") {
    return [...pending.filter((item) => item.sessionToken !== action.sessionToken), action];
  }
  if (pending.some((item) => item.kind === "logout" && item.sessionToken === action.sessionToken)) return pending;
  if (pending.some((item) => item.kind === "unlink" && item.sessionToken === action.sessionToken && item.pushToken === action.pushToken)) {
    return pending;
  }
  return [...pending, action];
}

/** Sends queued actions in order, preserving every unacknowledged credential for retry. */
export async function processPendingPushActions(
  pending: PendingPushAction[],
  send: (action: PendingPushAction) => Promise<PushActionResponse>,
): Promise<{ remaining: PendingPushAction[]; acknowledged: PendingPushAction[] }> {
  const acknowledged: PendingPushAction[] = [];
  for (const action of pending) {
    try {
      const response = await send(action);
      // An expired bearer cannot own an active push binding anymore.
      if (!response.ok && response.status !== 401) break;
      acknowledged.push(action);
    } catch {
      break;
    }
  }
  return { acknowledged, remaining: pending.slice(acknowledged.length) };
}
