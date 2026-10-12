// Cloudflare Realtime SFU client. Holds the app token server-side; the browser never sees it.

import type { Env } from "./env";

type RealtimeEnv = Pick<Env, "CLOUDFLARE_REALTIME_APP_ID" | "CLOUDFLARE_REALTIME_APP_TOKEN" | "SCREEN_SFU_ENABLED">;
// Worker typings have no DOM lib, so mirror RTCSessionDescriptionInit.
type Sdp = { type: "offer" | "answer" | "pranswer" | "rollback"; sdp?: string };
type RemoteTrack = { sessionId: string; trackName: string };
type Rid = "f" | "p";
type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

type TrackResult = { trackName?: string; mid?: string; errorCode?: string; errorDescription?: string };
type SfuResponse = {
  sessionId?: string;
  sessionDescription?: Sdp;
  tracks?: TrackResult[];
  requiresImmediateRenegotiation?: boolean;
  errorCode?: string;
  errorDescription?: string;
};

export class RealtimeSfuError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RealtimeSfuError";
    this.code = code;
  }
}

export function screenSfuEnabled(env: RealtimeEnv): boolean {
  return (
    env.SCREEN_SFU_ENABLED === "true" &&
    !!env.CLOUDFLARE_REALTIME_APP_ID?.trim() &&
    !!env.CLOUDFLARE_REALTIME_APP_TOKEN?.trim()
  );
}

/** Upper bound for one Cloudflare Realtime API call. */
export const REALTIME_REQUEST_TIMEOUT_MS = 8_000;

export function createRealtimeClient(
  env: RealtimeEnv,
  fetchImpl: FetchImpl = fetch,
  timeoutMs: number = REALTIME_REQUEST_TIMEOUT_MS,
) {
  const appId = env.CLOUDFLARE_REALTIME_APP_ID?.trim() ?? "";
  const token = env.CLOUDFLARE_REALTIME_APP_TOKEN?.trim() ?? "";
  const base = `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}`;

  async function call(method: "POST" | "PUT", path: string, body?: unknown): Promise<SfuResponse> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
        throw new RealtimeSfuError("timeout", "Realtime SFU request timed out");
      throw new RealtimeSfuError("network_error", "Realtime SFU request failed");
    }
    // Never echo the response body or request headers: they could carry the token.
    const data = (await response.json().catch(() => ({}))) as SfuResponse;
    if (!response.ok) {
      throw new RealtimeSfuError(data.errorCode ?? `http_${response.status}`, `Realtime SFU returned HTTP ${response.status}`);
    }
    if (data.errorCode) {
      throw new RealtimeSfuError(data.errorCode, data.errorDescription ?? "Realtime SFU error");
    }
    for (const track of data.tracks ?? []) {
      if (track.errorCode) {
        throw new RealtimeSfuError(track.errorCode, track.errorDescription ?? "Realtime SFU track error");
      }
    }
    return data;
  }

  const remoteTrack = (remote: RemoteTrack, simulcast: Record<string, string>, extra: Record<string, string> = {}) => ({
    location: "remote",
    sessionId: remote.sessionId,
    trackName: remote.trackName,
    ...extra,
    simulcast,
  });

  return {
    async newSession(): Promise<{ sessionId: string }> {
      const data = await call("POST", "/sessions/new");
      if (!data.sessionId) throw new RealtimeSfuError("bad_response", "Realtime SFU returned no sessionId");
      return { sessionId: data.sessionId };
    },

    async pushTrack(sessionId: string, offer: Sdp, mid: string, trackName: string): Promise<{ answer: Sdp }> {
      const data = await call("POST", `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
        sessionDescription: { type: "offer", sdp: offer.sdp },
        tracks: [{ location: "local", mid, trackName }],
      });
      if (!data.sessionDescription) throw new RealtimeSfuError("bad_response", "Realtime SFU returned no answer");
      return { answer: data.sessionDescription };
    },

    async pullTrack(
      sessionId: string,
      remote: RemoteTrack,
      preferredRid: Rid,
    ): Promise<{ offer: Sdp | null; mid: string; requiresImmediateRenegotiation: boolean }> {
      const data = await call("POST", `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
        tracks: [
          remoteTrack(remote, { preferredRid, priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" }),
        ],
      });
      const mid = data.tracks?.[0]?.mid;
      if (!mid) throw new RealtimeSfuError("bad_response", "Realtime SFU returned no mid");
      return {
        offer: data.sessionDescription ?? null,
        mid,
        requiresImmediateRenegotiation: data.requiresImmediateRenegotiation === true,
      };
    },

    async setLayer(sessionId: string, mid: string, remote: RemoteTrack, preferredRid: Rid): Promise<void> {
      await call("PUT", `/sessions/${encodeURIComponent(sessionId)}/tracks/update`, {
        tracks: [remoteTrack(remote, { preferredRid }, { mid })],
      });
    },

    async renegotiate(sessionId: string, answer: Sdp): Promise<void> {
      await call("PUT", `/sessions/${encodeURIComponent(sessionId)}/renegotiate`, {
        sessionDescription: { type: "answer", sdp: answer.sdp },
      });
    },

    async closeTracks(sessionId: string, mids: string[]): Promise<void> {
      await call("PUT", `/sessions/${encodeURIComponent(sessionId)}/tracks/close`, {
        tracks: mids.map((mid) => ({ mid })),
        force: true,
      });
    },
  };
}
