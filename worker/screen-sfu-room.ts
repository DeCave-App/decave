// Pure helpers for HubRoom's Cloudflare Realtime screen-share signalling.
// Authorization lives here so it is testable without a Durable Object.

/** The sharer's publish session, stored on their socket attachment. `mid` stays server-side. */
export type ScreenSfuPublish = { sessionId: string; trackName: string; mid: string };

export type RoomMember = {
  connectionId: string;
  voiceChannelId: number | null;
  screenSfu: ScreenSfuPublish | null;
};

/** SFU fields persisted on the socket attachment so they survive hibernation. */
export type ScreenSfuSocketFields = {
  screenSfu: ScreenSfuPublish | null;
  sfuScreenCapable: boolean;
  /** The viewer's single pull session (created on first pull). */
  sfuPullSessionId: string | null;
  /** sharerConnectionId -> pulled mid in the viewer's pull session. */
  sfuPulls: Record<string, string>;
};

export type Sdp = { type: "offer" | "answer"; sdp: string };
export type Rid = "f" | "p";

export const MAX_SFU_PULLS = 16;
export const MAX_SDP_LENGTH = 64 * 1024;
export const MAX_KEY_ENVELOPE_JSON = 16 * 1024;

export const EMPTY_SFU_FIELDS: ScreenSfuSocketFields = {
  screenSfu: null,
  sfuScreenCapable: false,
  sfuPullSessionId: null,
  sfuPulls: {},
};

export function canPull(viewer: RoomMember, sharer: RoomMember | null): boolean {
  if (!sharer || viewer.voiceChannelId === null) return false;
  if (viewer.connectionId === sharer.connectionId) return false;
  if (sharer.voiceChannelId !== viewer.voiceChannelId) return false;
  return sharer.screenSfu !== null;
}

/** Track names are always server-chosen; never take one from a client. */
export function trackNameFor(connectionId: string): string {
  return `screen-${connectionId}`;
}

export function sfuResult(requestId: string, data: Record<string, unknown> = {}) {
  return { ...data, type: "RTC_SFU_RESULT", requestId, ok: true };
}

export function sfuErrorResult(requestId: string, error: string) {
  return { type: "RTC_SFU_RESULT", requestId, ok: false, error };
}

export function sfuDisabledResult(requestId: string) {
  return sfuErrorResult(requestId, "sfu-disabled");
}

export function parseSdp(value: unknown, expected: Sdp["type"]): Sdp | null {
  if (!value || typeof value !== "object") return null;
  const { type, sdp } = value as { type?: unknown; sdp?: unknown };
  if (type !== expected || typeof sdp !== "string" || !sdp || sdp.length > MAX_SDP_LENGTH) return null;
  return { type: expected, sdp };
}

export function parseRid(value: unknown): Rid | null {
  return value === "f" || value === "p" ? value : null;
}

export function parseMid(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
}

export function parseRequestId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

/** Validates an RTC_SCREEN_KEY payload; the envelope is sealed client-side and passed through. */
export function keyRelayPayload(data: Record<string, unknown>): { keyIndex: number; envelope: object } | null {
  const { keyIndex, envelope } = data;
  if (typeof keyIndex !== "number" || !Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 255) return null;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  let size: number;
  try {
    size = JSON.stringify(envelope).length;
  } catch {
    return null;
  }
  if (size > MAX_KEY_ENVELOPE_JSON) return null;
  return { keyIndex, envelope };
}

/** Sessions to close (best effort) when a connection drops its SFU state. */
export function sfuCloses(
  fields: Pick<ScreenSfuSocketFields, "screenSfu" | "sfuPullSessionId" | "sfuPulls">,
): { sessionId: string; mids: string[] }[] {
  const closes: { sessionId: string; mids: string[] }[] = [];
  if (fields.screenSfu) closes.push({ sessionId: fields.screenSfu.sessionId, mids: [fields.screenSfu.mid] });
  const pullMids = Object.values(fields.sfuPulls ?? {});
  if (fields.sfuPullSessionId && pullMids.length > 0)
    closes.push({ sessionId: fields.sfuPullSessionId, mids: pullMids });
  return closes;
}

/**
 * Drops a viewer's pull of a sharer whose publish ended. Returns the viewer's
 * new fields and the pulled mid to close in the viewer's pull session, if any.
 */
export function pruneViewerPull<T extends Pick<ScreenSfuSocketFields, "sfuPullSessionId" | "sfuPulls">>(
  viewer: T,
  sharerConnectionId: string,
): { viewer: T; close: { sessionId: string; mids: string[] } | null } {
  const mid = viewer.sfuPulls?.[sharerConnectionId];
  if (!mid) return { viewer, close: null };
  const { [sharerConnectionId]: _dropped, ...rest } = viewer.sfuPulls;
  return {
    viewer: { ...viewer, sfuPulls: rest },
    close: viewer.sfuPullSessionId ? { sessionId: viewer.sfuPullSessionId, mids: [mid] } : null,
  };
}

/**
 * Whether an RTC_SFU_STOP releases the current publish. A stop naming a
 * sessionId only ends that publish (a stale stop must not end a newer share);
 * an unscoped stop (older clients, or a publish whose result never arrived)
 * releases whatever is published.
 */
export function stopReleasesPublish(
  current: Pick<NonNullable<ScreenSfuSocketFields["screenSfu"]>, "sessionId"> | null,
  requestedSessionId: unknown,
): boolean {
  if (!current) return false;
  if (typeof requestedSessionId !== "string" || requestedSessionId.length === 0) return true;
  return requestedSessionId === current.sessionId;
}
