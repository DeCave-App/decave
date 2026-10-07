import type { QueuePage, StreamerSnapshot } from "../../shared/streamer-mode";
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
    mutate: (path: string, payload: unknown, signal: AbortSignal) => {
      if (!/^[a-z-]+\/[a-z-]+$/.test(path) && path !== "settings" && path !== "enable")
        throw new Error("Invalid action path.");
      return transport.request<{ ok: boolean; id?: string }>(`${base}/${path}`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
  };
}
