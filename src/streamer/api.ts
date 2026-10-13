import type { QueuePage, StreamerSnapshot } from "../../shared/streamer-mode";
import type { Leaderboard } from "../../shared/streamer-pugs";
/** Inject the app's existing authenticated request helper. Never store tokens here. */
export interface StreamerTransport {
  request<T>(path: string, init: RequestInit): Promise<T>;
}
export function createStreamerApi(hubId: number, transport: StreamerTransport) {
  if (!Number.isSafeInteger(hubId) || hubId <= 0) throw new Error("Invalid hub ID.");
  const base = `/api/servers/${hubId}/streamer`;
  return {
    snapshot: (signal: AbortSignal) => transport.request<StreamerSnapshot>(base, { method: "GET", signal }),
    queue: (signal: AbortSignal, after?: string) =>
      transport.request<QueuePage>(`${base}/queue${after ? `?after=${encodeURIComponent(after)}` : ""}`, {
        method: "GET",
        signal,
      }),
    leaderboard: (signal: AbortSignal) =>
      transport.request<Leaderboard>(`${base}/leaderboard`, { method: "GET", signal }),
    /** Account-level FACEIT link (shown on every Streamer Hub leaderboard). */
    /** Starts Twitch sign-in (subscriber role); returns the Twitch login URL. */
    connectTwitch: (signal: AbortSignal) =>
      transport.request<{ url: string }>("/api/account/twitch/connect", { method: "POST", signal }),
    recheckTwitch: (signal: AbortSignal) =>
      transport.request<{ ok: boolean }>("/api/account/twitch/recheck", { method: "POST", signal }),
    unlinkTwitch: (signal: AbortSignal) =>
      transport.request<{ ok: boolean }>("/api/account/twitch", { method: "DELETE", signal }),
    /** Starts FACEIT sign-in; returns the FACEIT login URL to open in a browser. */
    connectFaceit: (signal: AbortSignal) =>
      transport.request<{ url: string }>("/api/account/faceit/connect", { method: "POST", signal }),
    unlinkFaceit: (signal: AbortSignal) =>
      transport.request<{ ok: boolean }>("/api/account/faceit", { method: "DELETE", signal }),
    mutate: (path: string, payload: unknown, signal: AbortSignal) => {
      if (!/^[a-z-]+\/[a-z-]+$/.test(path) && path !== "settings" && path !== "enable")
        throw new Error("Invalid action path.");
      return transport.request<{ ok: boolean; id?: string; notice?: string; noticeI18n?: unknown }>(`${base}/${path}`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
  };
}
