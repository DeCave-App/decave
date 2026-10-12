// Streamer Hub auto-live: links a hub to the Twitch channel in its stream URL
// and receives EventSub stream.online / stream.offline webhooks for it.
//
// One EventSub subscription pair per Twitch channel, shared by every linked
// hub. On "online" each linked hub with auto-live on is marked live (title and
// game from Helix) and its bots get a streamLive event; "offline" clears it.

import { DEFAULT_STREAMER_CONFIG, twitchLoginFromUrl, type StreamerConfig } from "../../shared/streamer-mode";
import { queueBotEvent } from "../bots/events";
import { authBaseUrlForEnvironment, json } from "../lib/http";
import type { Env } from "../lib/env";
import {
  createStreamSubscription,
  deleteSubscription,
  twitchConfigured,
  twitchLiveStream,
  twitchUserByLogin,
} from "./client";

export const TWITCH_EVENTSUB_PATH = "/api/integrations/twitch/eventsub";
/** Twitch rejects deliveries older than this; so do we (replay protection). */
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
/** Upper bound for an auto-live status in case the offline event never arrives. */
const AUTO_LIVE_MAX_MS = 24 * 60 * 60 * 1000;
const SEEN_RETENTION_MS = 24 * 60 * 60 * 1000;

type WaitUntil = ((work: Promise<unknown>) => void) | undefined;
type LinkRow = { hub_id: number; broadcaster_id: string };
type BroadcasterRow = { broadcaster_id: string; login: string; online_sub_id: string; offline_sub_id: string };

function callbackUrl(env: Env): string {
  return `${authBaseUrlForEnvironment(env)}${TWITCH_EVENTSUB_PATH}`;
}

async function linkFor(env: Env, hubId: number): Promise<LinkRow | null> {
  return env.DB.prepare("SELECT hub_id,broadcaster_id FROM decave_twitch_hub_links WHERE hub_id=?")
    .bind(hubId)
    .first<LinkRow>();
}

/** Drops a channel's subscriptions once no hub links to it any more. */
async function releaseBroadcaster(env: Env, broadcasterId: string): Promise<void> {
  const stillUsed = await env.DB.prepare("SELECT 1 FROM decave_twitch_hub_links WHERE broadcaster_id=? LIMIT 1")
    .bind(broadcasterId)
    .first();
  if (stillUsed) return;
  const row = await env.DB.prepare("SELECT * FROM decave_twitch_broadcasters WHERE broadcaster_id=?")
    .bind(broadcasterId)
    .first<BroadcasterRow>();
  if (!row) return;
  await env.DB.prepare("DELETE FROM decave_twitch_broadcasters WHERE broadcaster_id=?").bind(broadcasterId).run();
  if (twitchConfigured(env)) {
    await Promise.allSettled([deleteSubscription(env, row.online_sub_id), deleteSubscription(env, row.offline_sub_id)]);
  }
}

async function ensureBroadcaster(env: Env, broadcasterId: string, login: string): Promise<void> {
  const existing = await env.DB.prepare("SELECT * FROM decave_twitch_broadcasters WHERE broadcaster_id=?")
    .bind(broadcasterId)
    .first<BroadcasterRow>();
  if (existing?.online_sub_id && existing.offline_sub_id) return;
  const callback = callbackUrl(env);
  const online =
    existing?.online_sub_id || (await createStreamSubscription(env, "stream.online", broadcasterId, callback));
  const offline =
    existing?.offline_sub_id || (await createStreamSubscription(env, "stream.offline", broadcasterId, callback));
  await env.DB.prepare(
    `INSERT INTO decave_twitch_broadcasters(broadcaster_id,login,online_sub_id,offline_sub_id,created_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(broadcaster_id) DO UPDATE SET login=excluded.login,
       online_sub_id=excluded.online_sub_id, offline_sub_id=excluded.offline_sub_id`,
  )
    .bind(broadcasterId, login, online, offline, new Date().toISOString())
    .run();
}

/**
 * Brings a hub's Twitch link in line with its saved stream settings. Returns a
 * notice for the creator when auto-live is on but can't work, else null.
 */
export async function syncTwitchAutoLive(
  env: Env,
  hubId: number,
  config: Pick<StreamerConfig, "streamUrl" | "twitchAutoLive">,
): Promise<string | null> {
  const login = config.twitchAutoLive ? twitchLoginFromUrl(config.streamUrl) : null;
  const current = await linkFor(env, hubId);
  if (!login) {
    if (current) {
      await env.DB.prepare("DELETE FROM decave_twitch_hub_links WHERE hub_id=?").bind(hubId).run();
      await releaseBroadcaster(env, current.broadcaster_id);
    }
    if (!config.twitchAutoLive) return null;
    return "Automatic live status needs a Twitch channel link, like https://www.twitch.tv/yourname.";
  }
  if (!twitchConfigured(env)) return "Automatic live status from Twitch isn't available on this server yet.";
  try {
    const user = await twitchUserByLogin(env, login);
    if (!user) return `Twitch has no channel called "${login}". Check the stream URL.`;
    if (current?.broadcaster_id === user.id) {
      await ensureBroadcaster(env, user.id, user.login);
      return null;
    }
    await ensureBroadcaster(env, user.id, user.login);
    await env.DB.prepare(
      `INSERT INTO decave_twitch_hub_links(hub_id,broadcaster_id,created_at) VALUES(?,?,?)
       ON CONFLICT(hub_id) DO UPDATE SET broadcaster_id=excluded.broadcaster_id, created_at=excluded.created_at`,
    )
      .bind(hubId, user.id, new Date().toISOString())
      .run();
    if (current) await releaseBroadcaster(env, current.broadcaster_id);
    return null;
  } catch (error) {
    console.error("Twitch auto-live link failed", error instanceof Error ? error.message : "UnknownError");
    return "Couldn't reach Twitch to turn on automatic live status. Save again in a minute.";
  }
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyEventSubSignature(
  secret: string,
  messageId: string,
  timestamp: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(messageId + timestamp + body));
  return timingSafeEqual(`sha256=${hex(mac)}`, signature.toLowerCase());
}

async function setHubLive(
  env: Env,
  hubId: number,
  live: { title: string; game: string } | null,
  now: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT config_json FROM decave_streamer_hubs WHERE hub_id=? AND json_extract(community_features,'$.twitch')=1",
  )
    .bind(hubId)
    .first<{ config_json: string }>();
  if (!row) return false;
  let stored: Partial<StreamerConfig>;
  try {
    stored = JSON.parse(row.config_json) as Partial<StreamerConfig>;
  } catch {
    return false;
  }
  const config = { ...DEFAULT_STREAMER_CONFIG, ...stored };
  if (!config.twitchAutoLive || !twitchLoginFromUrl(config.streamUrl)) return false;
  const next = live
    ? {
        ...stored,
        liveUntil: new Date(now + AUTO_LIVE_MAX_MS).toISOString(),
        streamTitle: (live.title || config.streamTitle).slice(0, 140),
        game: (live.game || config.game).slice(0, 80),
      }
    : { ...stored, liveUntil: null };
  await env.DB.prepare("UPDATE decave_streamer_hubs SET config_json=?,version=version+1,updated_at=? WHERE hub_id=?")
    .bind(JSON.stringify(next), new Date(now).toISOString(), hubId)
    .run();
  return true;
}

async function handleStreamEvent(
  env: Env,
  type: "stream.online" | "stream.offline",
  broadcasterId: string,
  login: string,
  waitUntil: WaitUntil,
): Promise<void> {
  const links = await env.DB.prepare("SELECT hub_id,broadcaster_id FROM decave_twitch_hub_links WHERE broadcaster_id=?")
    .bind(broadcasterId)
    .all<LinkRow>();
  if (!links.results.length) {
    await releaseBroadcaster(env, broadcasterId);
    return;
  }
  const online = type === "stream.online";
  // Helix can lag the event by a few seconds; an empty title falls back to the saved one.
  const stream = online ? ((await twitchLiveStream(env, broadcasterId)) ?? { title: "", game: "" }) : null;
  const now = Date.now();
  const url = `https://www.twitch.tv/${login}`;
  for (const link of links.results) {
    const hubId = Number(link.hub_id);
    if (!(await setHubLive(env, hubId, stream, now))) continue;
    queueBotEvent(
      env,
      {
        hubId,
        roomId: null,
        kind: online ? "streamLive" : "streamOffline",
        actorId: null,
        actorIsBot: false,
        chainDepth: 0,
        data: { title: stream?.title ?? "", game: stream?.game ?? "", url, streamer: login },
      },
      waitUntil,
    );
  }
}

/** POST /api/integrations/twitch/eventsub. Twitch calls this; no DeCave session. */
export async function handleTwitchEventSub(
  request: Request,
  env: Env,
  waitUntil: WaitUntil,
  now = Date.now(),
): Promise<Response> {
  if (!twitchConfigured(env)) return json({ error: "Not found" }, 404);
  const messageId = request.headers.get("Twitch-Eventsub-Message-Id") ?? "";
  const timestamp = request.headers.get("Twitch-Eventsub-Message-Timestamp") ?? "";
  const signature = request.headers.get("Twitch-Eventsub-Message-Signature") ?? "";
  const messageType = request.headers.get("Twitch-Eventsub-Message-Type") ?? "";
  const body = await request.text();
  if (body.length > 64 * 1024) return json({ error: "Too large" }, 413);
  if (!messageId || !timestamp || !signature) return json({ error: "Missing signature" }, 403);
  if (!(await verifyEventSubSignature(env.TWITCH_EVENTSUB_SECRET!, messageId, timestamp, body, signature))) {
    return json({ error: "Bad signature" }, 403);
  }
  const sentAt = Date.parse(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > MAX_MESSAGE_AGE_MS) return json({ error: "Stale" }, 403);

  let payload: {
    challenge?: string;
    subscription?: { type?: string; condition?: { broadcaster_user_id?: string } };
    event?: { broadcaster_user_id?: string; broadcaster_user_login?: string };
  };
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }

  if (messageType === "webhook_callback_verification") {
    return new Response(String(payload.challenge ?? ""), { headers: { "Content-Type": "text/plain" } });
  }

  // Twitch retries until it gets a 2xx; a message id we've seen is acknowledged and skipped.
  const fresh = await env.DB.prepare(
    "INSERT OR IGNORE INTO decave_twitch_eventsub_seen(message_id,seen_at) VALUES(?,?)",
  )
    .bind(messageId.slice(0, 128), now)
    .run();
  if (!fresh.meta.changes) return new Response(null, { status: 204 });
  await env.DB.prepare("DELETE FROM decave_twitch_eventsub_seen WHERE seen_at<?")
    .bind(now - SEEN_RETENTION_MS)
    .run();

  const broadcasterId = payload.event?.broadcaster_user_id ?? payload.subscription?.condition?.broadcaster_user_id;
  if (!broadcasterId || !/^\d{1,20}$/.test(broadcasterId)) return new Response(null, { status: 204 });

  if (messageType === "revocation") {
    // Channel deleted/suspended or our app lost access: forget the subscription so a later save re-creates it.
    await env.DB.prepare(
      "UPDATE decave_twitch_broadcasters SET online_sub_id='',offline_sub_id='' WHERE broadcaster_id=?",
    )
      .bind(broadcasterId)
      .run();
    return new Response(null, { status: 204 });
  }

  const type = payload.subscription?.type;
  if (messageType === "notification" && (type === "stream.online" || type === "stream.offline")) {
    const login = (payload.event?.broadcaster_user_login ?? "").toLowerCase();
    if (/^[a-z0-9_]{1,25}$/.test(login)) await handleStreamEvent(env, type, broadcasterId, login, waitUntil);
  }
  return new Response(null, { status: 204 });
}
