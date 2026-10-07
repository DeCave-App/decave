// Whether each voice or call peer's connection was verified against their
// account key (see signRtc / verifyRtc in shared/dm-e2ee-session.ts), by
// connection id, for the participant tiles and the call screen.

import { useSyncExternalStore } from "react";
import type { RtcVerdict } from "./dm-e2ee-session";
import { dmE2ee } from "./client";

const verdicts = new Map<string, RtcVerdict>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function setCallVerdict(connectionId: string, verdict: RtcVerdict) {
  if (verdicts.get(connectionId) === verdict) return;
  verdicts.set(connectionId, verdict);
  notify();
}

export function clearCallVerdict(connectionId?: string) {
  if (connectionId === undefined) verdicts.clear();
  else verdicts.delete(connectionId);
  notify();
}

export function useCallVerdict(connectionId: string | null | undefined): RtcVerdict | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (connectionId ? (verdicts.get(connectionId) ?? null) : null),
  );
}

/** The `auth` to send next to a local description for `peerUserId`, if this device can sign. */
export function callDescriptionAuth(peerUserId: string | undefined, sdp: string | undefined) {
  const auth = peerUserId ? dmE2ee.signRtc(peerUserId, sdp) : null;
  return auth ? { auth } : {};
}

/** Check a peer's description and remember the result for the UI. */
export async function checkCallDescription(
  peer: { connectionId: string; userId?: string },
  description: { sdp?: string },
  auth: unknown,
  strict: boolean,
): Promise<RtcVerdict> {
  // Without knowing whose connection it is there is nothing to check it against.
  const verdict = peer.userId
    ? await dmE2ee.verifyRtc(peer.userId, description.sdp, auth, { strict })
    : strict && dmE2ee.getState().available
      ? "rejected"
      : "unverified";
  // An unverified renegotiation doesn't undo an earlier verification of the same connection.
  if (verdict !== "unverified" || !verdicts.has(peer.connectionId)) setCallVerdict(peer.connectionId, verdict);
  return verdict;
}
