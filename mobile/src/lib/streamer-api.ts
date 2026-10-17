// Streamer Hub calls (GET /api/servers/:id/streamer, …/queue, …/leaderboard and
// POST …/<area>/<action>), the same as web's src/streamer/api.ts.

import { t } from "i18next";
import type { QueuePage, StreamerSnapshot } from "../../../shared/streamer-mode";
import type { Leaderboard } from "../../../shared/streamer-pugs";
import { apiErrorText, apiFetch, type ApiErrorBody } from "./api";
import { noticeText } from "./server-text";

export type { StreamerSnapshot, QueuePage, Leaderboard };

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init, token);
  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) throw new Error(apiErrorText(data, t("streamer.errors.generic")));
  return data;
}

export function createStreamerApi(token: string, hubId: number) {
  const base = `/api/servers/${hubId}/streamer`;
  return {
    snapshot: () => request<StreamerSnapshot>(token, base),
    queue: (after?: string) => request<QueuePage>(token, `${base}/queue${after ? `?after=${encodeURIComponent(after)}` : ""}`),
    leaderboard: () => request<Leaderboard>(token, `${base}/leaderboard`),
    connect: (provider: "twitch" | "faceit") => request<{ url: string }>(token, `/api/account/${provider}/connect`, { method: "POST" }),
    recheckTwitch: () => request<{ ok: boolean }>(token, "/api/account/twitch/recheck", { method: "POST" }),
    unlink: (provider: "twitch" | "faceit") => request<{ ok: boolean }>(token, `/api/account/${provider}`, { method: "DELETE" }),
    /** A creator or member action such as "queue/join" or "giveaways/draw"; returns the notice to show. */
    async mutate(path: string, payload: unknown): Promise<string> {
      if (!/^[a-z-]+\/[a-z-]+$/.test(path)) throw new Error(t("streamer.errors.generic"));
      const result = await request<{ ok: boolean; notice?: string; noticeI18n?: unknown }>(token, `${base}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const notice = noticeText(result.noticeI18n) ?? result.notice;
      return notice ? t("streamer.notices.savedWithNotice", { notice }) : t("streamer.notices.saved");
    },
  };
}

export type StreamerApi = ReturnType<typeof createStreamerApi>;
