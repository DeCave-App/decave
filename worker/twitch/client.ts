// Minimal Twitch Helix/EventSub client for Streamer Hub auto-live. Uses an app
// access token (client credentials); no viewer or creator Twitch login.

import type { Env } from "../lib/env";

const HELIX = "https://api.twitch.tv/helix";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

export type TwitchEnv = Pick<Env, "TWITCH_CLIENT_ID" | "TWITCH_CLIENT_SECRET" | "TWITCH_EVENTSUB_SECRET">;

export function twitchConfigured(env: TwitchEnv): boolean {
  const secret = env.TWITCH_EVENTSUB_SECRET ?? "";
  return Boolean(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET && secret.length >= 10 && secret.length <= 100);
}

let cachedToken: { value: string; expiresAt: number; clientId: string } | null = null;

/** Tests only: forget the cached app token. */
export function resetTwitchTokenForTests(): void {
  cachedToken = null;
}

async function appToken(env: TwitchEnv): Promise<string> {
  const clientId = env.TWITCH_CLIENT_ID!;
  if (cachedToken && cachedToken.clientId === clientId && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: env.TWITCH_CLIENT_SECRET!,
    grant_type: "client_credentials",
  });
  const response = await fetch(TOKEN_URL, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Twitch token request failed (${response.status})`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Twitch token response had no token");
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000, clientId };
  return data.access_token;
}

async function helix(env: TwitchEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const send = async () =>
    fetch(`${HELIX}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        "Client-Id": env.TWITCH_CLIENT_ID!,
        Authorization: `Bearer ${await appToken(env)}`,
      },
    });
  let response = await send();
  if (response.status === 401) {
    cachedToken = null;
    response = await send();
  }
  return response;
}

export async function twitchUserByLogin(env: TwitchEnv, login: string): Promise<{ id: string; login: string } | null> {
  const response = await helix(env, `/users?login=${encodeURIComponent(login)}`);
  if (!response.ok) throw new Error(`Twitch user lookup failed (${response.status})`);
  const data = (await response.json()) as { data?: { id: string; login: string }[] };
  const user = data.data?.[0];
  return user ? { id: user.id, login: user.login } : null;
}

export async function twitchLiveStream(
  env: TwitchEnv,
  broadcasterId: string,
): Promise<{ title: string; game: string } | null> {
  const response = await helix(env, `/streams?user_id=${encodeURIComponent(broadcasterId)}&type=live`);
  if (!response.ok) return null;
  const data = (await response.json()) as { data?: { title?: string; game_name?: string }[] };
  const stream = data.data?.[0];
  return stream ? { title: stream.title ?? "", game: stream.game_name ?? "" } : null;
}

export type TwitchClip = {
  id: string;
  url: string;
  title: string;
  creatorName: string;
  viewCount: number;
  createdAt: string;
  /** Twitch's thumbnail image URL ("" when missing). */
  thumbnailUrl: string;
};

type HelixClip = {
  id?: string;
  url?: string;
  title?: string;
  creator_name?: string;
  view_count?: number;
  created_at?: string;
  thumbnail_url?: string;
};

function clipsFrom(data: { data?: HelixClip[] }): TwitchClip[] {
  return (data.data ?? [])
    .filter((clip) => typeof clip.id === "string" && typeof clip.url === "string")
    .map((clip) => ({
      id: clip.id!,
      url: clip.url!,
      title: clip.title ?? "",
      creatorName: clip.creator_name ?? "",
      viewCount: clip.view_count ?? 0,
      createdAt: clip.created_at ?? "",
      thumbnailUrl: typeof clip.thumbnail_url === "string" ? clip.thumbnail_url : "",
    }));
}

/** The channel's clips created since `startedAt` (newest Helix page, up to 20). */
export async function twitchClips(env: TwitchEnv, broadcasterId: string, startedAt: string): Promise<TwitchClip[]> {
  const response = await helix(
    env,
    `/clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&started_at=${encodeURIComponent(startedAt)}&first=20`,
  );
  if (!response.ok) throw new Error(`Twitch clips request failed (${response.status})`);
  return clipsFrom((await response.json()) as { data?: HelixClip[] });
}

/** Clips by id (up to 100), e.g. to backfill thumbnails of clips posted earlier. */
export async function twitchClipsById(env: TwitchEnv, ids: string[]): Promise<TwitchClip[]> {
  if (!ids.length) return [];
  const query = ids
    .slice(0, 100)
    .map((id) => `id=${encodeURIComponent(id)}`)
    .join("&");
  const response = await helix(env, `/clips?${query}`);
  if (!response.ok) throw new Error(`Twitch clips lookup failed (${response.status})`);
  return clipsFrom((await response.json()) as { data?: HelixClip[] });
}

/**
 * Downloads a clip thumbnail, only from Twitch's image CDNs over https and at
 * most 2 MB of JPEG/PNG/WebP; null otherwise. Runs on the server, never on
 * members' devices.
 */
export async function twitchClipThumbnail(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  const allowedHost =
    target.hostname === "static-cdn.jtvnw.net" ||
    target.hostname === "clips-media-assets2.twitch.tv" ||
    target.hostname.endsWith(".clips.twitchcdn.net");
  if (target.protocol !== "https:" || target.username || target.password || target.port || !allowedHost) return null;
  // Workers only support "follow" | "manual"; a redirect (3xx) is refused, not followed.
  const response = await fetch(target.toString(), { redirect: "manual" });
  if (response.status !== 200) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
  const bytes = await response.arrayBuffer();
  return bytes.byteLength > 0 && bytes.byteLength <= 2 * 1024 * 1024 ? { bytes, type } : null;
}

export async function createStreamSubscription(
  env: TwitchEnv,
  type: "stream.online" | "stream.offline",
  broadcasterId: string,
  callback: string,
): Promise<string> {
  const response = await helix(env, "/eventsub/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      version: "1",
      condition: { broadcaster_user_id: broadcasterId },
      transport: { method: "webhook", callback, secret: env.TWITCH_EVENTSUB_SECRET },
    }),
  });
  if (response.status === 409) return ""; // Already subscribed; the stored id stays authoritative.
  if (!response.ok) throw new Error(`Twitch ${type} subscription failed (${response.status})`);
  const data = (await response.json()) as { data?: { id: string }[] };
  return data.data?.[0]?.id ?? "";
}

export async function deleteSubscription(env: TwitchEnv, id: string): Promise<void> {
  if (!id) return;
  const response = await helix(env, `/eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`Twitch unsubscribe failed (${response.status})`);
}
