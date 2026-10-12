// Twitch subscriber roles (custom per-Hub feature "subRoles"). A member signs
// in with Twitch (scope user:read:subscriptions); DeCave asks Twitch whether
// they subscribe to each of their Hubs' linked channels, gives subscribers the
// Hub's "Subs" role, and re-checks daily with the member's stored (encrypted)
// refresh token. Unsubscribing, unlinking or a revoked token removes the role.

import { createRawToken, nowIso } from "../db";
import { json } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { steamCallbackPage } from "../lib/activity";
import { realtimeBroadcast } from "../lib/realtime";
import type { Env } from "../lib/env";
import type { ApiContext } from "../routes/context";
import { twitchConfigured, type TwitchEnv } from "./client";

export const TWITCH_MEMBER_CALLBACK_PATH = "/api/account/twitch/callback";
const AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";
const STATE_TTL_MS = 10 * 60 * 1000;
const RECHECK_MS = 24 * 60 * 60 * 1000;
const RECHECK_BATCH = 25;
export const SUB_ROLE_NAME = "Subs";
const SUB_ROLE_COLOR = "#9146ff";

type Tokens = { accessToken: string; refreshToken: string };

// --- token encryption (AES-GCM, key derived from the Twitch client secret) ---

async function tokenKey(env: TwitchEnv): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.TWITCH_CLIENT_SECRET!),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("decave-twitch-member-token"),
      info: new TextEncoder().encode("v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export async function encryptToken(env: TwitchEnv, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), new TextEncoder().encode(token)),
  );
  return `${b64(iv)}.${b64(cipher)}`;
}
export async function decryptToken(env: TwitchEnv, value: string): Promise<string> {
  const [iv, cipher] = value.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(env), unb64(cipher));
  return new TextDecoder().decode(plain);
}

// --- Twitch calls with the member's token ---

async function tokenRequest(env: TwitchEnv, form: Record<string, string>): Promise<Tokens | null> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID!, client_secret: env.TWITCH_CLIENT_SECRET!, ...form }),
  });
  if (response.status === 400 || response.status === 401) return null;
  if (!response.ok) throw new Error(`Twitch token request failed (${response.status})`);
  const data = (await response.json()) as { access_token?: string; refresh_token?: string };
  return data.access_token && data.refresh_token
    ? { accessToken: data.access_token, refreshToken: data.refresh_token }
    : null;
}

async function helixAsMember(env: TwitchEnv, accessToken: string, path: string): Promise<Response> {
  return fetch(`${HELIX}${path}`, {
    headers: { "Client-Id": env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${accessToken}` },
  });
}

/** Tier ("1000"/"2000"/"3000") when the member subscribes to the channel, null when not. */
async function subscriptionTier(
  env: TwitchEnv,
  accessToken: string,
  twitchUserId: string,
  broadcasterId: string,
): Promise<string | null> {
  const response = await helixAsMember(
    env,
    accessToken,
    `/subscriptions/user?broadcaster_id=${encodeURIComponent(broadcasterId)}&user_id=${encodeURIComponent(twitchUserId)}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Twitch subscription check failed (${response.status})`);
  const data = (await response.json()) as { data?: { tier?: string }[] };
  return data.data?.[0]?.tier ?? "1000";
}

// --- roles ---

async function subRoleId(env: Env, hubId: number): Promise<string> {
  const existing = await env.DB.prepare(
    "SELECT id FROM decave_custom_roles WHERE hub_id=? AND lower(name)=lower(?) ORDER BY created_at LIMIT 1",
  )
    .bind(hubId, SUB_ROLE_NAME)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO decave_custom_roles(id,hub_id,name,color,permissions_json,position,created_at) VALUES(?,?,?,?,'[]',0,?)",
  )
    .bind(id, hubId, SUB_ROLE_NAME, SUB_ROLE_COLOR, nowIso())
    .run();
  return id;
}

/** Hubs (with the subRoles feature and a linked Twitch channel) this member belongs to. */
async function memberSubHubs(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT m.hub_id, l.broadcaster_id FROM decave_hub_members m
     JOIN decave_streamer_hubs s ON s.hub_id=m.hub_id
     JOIN decave_twitch_hub_links l ON l.hub_id=m.hub_id
     WHERE m.user_id=? AND json_extract(s.community_features,'$.subRoles')=1`,
  )
    .bind(userId)
    .all<{ hub_id: number; broadcaster_id: string }>();
  return rows.results;
}

async function setSubscriber(env: Env, hubId: number, userId: string, tier: string | null): Promise<boolean> {
  const roleId = await subRoleId(env, hubId);
  const before = await env.DB.prepare("SELECT tier FROM decave_twitch_hub_subscribers WHERE hub_id=? AND user_id=?")
    .bind(hubId, userId)
    .first<{ tier: string }>();
  if (tier) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO decave_twitch_hub_subscribers(hub_id,user_id,tier,verified_at) VALUES(?,?,?,?)
         ON CONFLICT(hub_id,user_id) DO UPDATE SET tier=excluded.tier, verified_at=excluded.verified_at`,
      ).bind(hubId, userId, tier, nowIso()),
      env.DB.prepare("INSERT OR IGNORE INTO decave_member_roles(hub_id,user_id,role_id) VALUES(?,?,?)").bind(
        hubId,
        userId,
        roleId,
      ),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM decave_twitch_hub_subscribers WHERE hub_id=? AND user_id=?").bind(hubId, userId),
      env.DB.prepare("DELETE FROM decave_member_roles WHERE hub_id=? AND user_id=? AND role_id=?").bind(
        hubId,
        userId,
        roleId,
      ),
    ]);
  }
  return Boolean(before) !== Boolean(tier);
}

/** Removes every Twitch subscriber role and record of a member (unlink, revoked token). */
async function clearSubscriber(env: Env, userId: string): Promise<void> {
  const rows = await env.DB.prepare("SELECT hub_id FROM decave_twitch_hub_subscribers WHERE user_id=?")
    .bind(userId)
    .all<{ hub_id: number }>();
  for (const row of rows.results) await setSubscriber(env, Number(row.hub_id), userId, null);
}

/** Checks the member's subscriptions to all their sub-role Hubs and updates roles. */
async function checkMember(env: Env, userId: string, twitchUserId: string, accessToken: string) {
  const changedHubs: number[] = [];
  for (const hub of await memberSubHubs(env, userId)) {
    const tier = await subscriptionTier(env, accessToken, twitchUserId, hub.broadcaster_id);
    if (await setSubscriber(env, Number(hub.hub_id), userId, tier)) changedHubs.push(Number(hub.hub_id));
  }
  await env.DB.prepare("UPDATE decave_twitch_member_links SET checked_at=? WHERE user_id=?")
    .bind(nowIso(), userId)
    .run();
  for (const hubId of changedHubs) await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
}

function page(title: string, message: string, ok: boolean, showOpenDeCaveLink = false): Response {
  return steamCallbackPage(title, message, ok, showOpenDeCaveLink, "Twitch");
}

function callbackUrl(request: Request): string {
  return new URL(TWITCH_MEMBER_CALLBACK_PATH, new URL(request.url).origin).toString();
}

/** POST /api/account/twitch/connect, GET …/callback, POST /api/account/twitch/recheck, DELETE /api/account/twitch. */
export async function handleTwitchMemberRoutes({ request, env, url, p, method }: ApiContext): Promise<Response | null> {
  if (!p.startsWith("/api/account/twitch")) return null;

  if (p === "/api/account/twitch" && method === "DELETE") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await clearSubscriber(env, user.id);
    await env.DB.prepare("DELETE FROM decave_twitch_member_links WHERE user_id=?").bind(user.id).run();
    return json({ ok: true });
  }

  if (p === "/api/account/twitch/connect" && method === "POST") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    if (!twitchConfigured(env)) return json({ error: "Twitch sign-in isn't available yet." }, 503);
    const state = createRawToken();
    const createdAt = nowIso();
    await env.DB.prepare("DELETE FROM decave_twitch_member_link_states WHERE user_id=? OR expires_at<=?")
      .bind(user.id, createdAt)
      .run();
    await env.DB.prepare(
      "INSERT INTO decave_twitch_member_link_states(state,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    )
      .bind(state, user.id, new Date(Date.now() + STATE_TTL_MS).toISOString(), createdAt)
      .run();
    const target = new URL(AUTHORIZE_URL);
    target.searchParams.set("client_id", env.TWITCH_CLIENT_ID!);
    target.searchParams.set("redirect_uri", callbackUrl(request));
    target.searchParams.set("response_type", "code");
    target.searchParams.set("scope", "user:read:subscriptions");
    target.searchParams.set("state", state);
    return json({ url: target.toString() });
  }

  if (p === "/api/account/twitch/recheck" && method === "POST") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const ok = await recheckMember(env, user.id);
    return ok ? json({ ok: true }) : json({ error: "Link Twitch again to check your subscription." }, 409);
  }

  if (p === TWITCH_MEMBER_CALLBACK_PATH && method === "GET") {
    const state = url.searchParams.get("state") ?? "";
    const claimed = state
      ? await env.DB.prepare(
          "DELETE FROM decave_twitch_member_link_states WHERE state=? AND expires_at>? RETURNING user_id",
        )
          .bind(state, nowIso())
          .first<{ user_id: string }>()
      : null;
    if (!claimed) return page("Twitch link expired", "Start linking Twitch again from the Hub.", false);
    if (url.searchParams.get("error"))
      return page("Twitch not linked", "You cancelled the Twitch sign-in. Nothing was linked.", false);
    // Same browser-session binding as the Steam and FACEIT links.
    const browserHeaders = new Headers(request.headers);
    browserHeaders.delete("authorization");
    const browserUser = await requireUser(new Request(request.url, { method: "GET", headers: browserHeaders }), env);
    if (browserUser instanceof Response || browserUser.id !== claimed.user_id)
      return page(
        "Sign in to finish Twitch linking",
        "Twitch was not linked. Open DeCave in this browser, sign in to the same account that started linking, then link Twitch again.",
        false,
        true,
      );
    let tokens: Tokens | null = null;
    let twitchUser: { id: string; login: string } | null = null;
    try {
      tokens = await tokenRequest(env, {
        code: url.searchParams.get("code") ?? "",
        grant_type: "authorization_code",
        redirect_uri: callbackUrl(request),
      });
      if (tokens) {
        const me = await helixAsMember(env, tokens.accessToken, "/users");
        const data = me.ok ? ((await me.json()) as { data?: { id?: string; login?: string }[] }) : {};
        const first = data.data?.[0];
        if (first?.id && first.login) twitchUser = { id: first.id, login: first.login };
      }
    } catch (error) {
      console.error("Twitch member sign-in failed", error instanceof Error ? error.message : "UnknownError");
    }
    if (!tokens || !twitchUser) return page("Twitch verification failed", "Twitch didn't confirm the sign-in.", false);
    const taken = await env.DB.prepare("SELECT user_id FROM decave_twitch_member_links WHERE twitch_user_id=?")
      .bind(twitchUser.id)
      .first<{ user_id: string }>();
    if (taken && taken.user_id !== claimed.user_id)
      return page("Twitch account already linked", "That Twitch account is linked to another DeCave account.", false);
    const stamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO decave_twitch_member_links(user_id,twitch_user_id,login,refresh_token_enc,linked_at,checked_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET twitch_user_id=excluded.twitch_user_id, login=excluded.login,
         refresh_token_enc=excluded.refresh_token_enc, checked_at=excluded.checked_at`,
    )
      .bind(
        claimed.user_id,
        twitchUser.id,
        twitchUser.login,
        await encryptToken(env, tokens.refreshToken),
        stamp,
        stamp,
      )
      .run();
    try {
      await checkMember(env, claimed.user_id, twitchUser.id, tokens.accessToken);
    } catch (error) {
      console.error("Twitch subscription check failed", error instanceof Error ? error.message : "UnknownError");
    }
    return page("Twitch linked", `Your Twitch account ${twitchUser.login} is now linked to DeCave.`, true);
  }

  return null;
}

/** Refreshes the member's token and re-checks their subscriptions. False when the link is gone or revoked. */
export async function recheckMember(env: Env, userId: string): Promise<boolean> {
  if (!twitchConfigured(env)) return false;
  const link = await env.DB.prepare(
    "SELECT twitch_user_id,refresh_token_enc FROM decave_twitch_member_links WHERE user_id=?",
  )
    .bind(userId)
    .first<{ twitch_user_id: string; refresh_token_enc: string }>();
  if (!link) return false;
  let tokens: Tokens | null = null;
  try {
    tokens = await tokenRequest(env, {
      grant_type: "refresh_token",
      refresh_token: await decryptToken(env, link.refresh_token_enc),
    });
  } catch (error) {
    console.error("Twitch token refresh failed", error instanceof Error ? error.message : "UnknownError");
    return true; // Twitch unavailable: keep the link and try again later.
  }
  if (!tokens) {
    // Revoked or expired: the member must link again; their sub roles go.
    await clearSubscriber(env, userId);
    await env.DB.prepare("DELETE FROM decave_twitch_member_links WHERE user_id=?").bind(userId).run();
    return false;
  }
  await env.DB.prepare("UPDATE decave_twitch_member_links SET refresh_token_enc=? WHERE user_id=?")
    .bind(await encryptToken(env, tokens.refreshToken), userId)
    .run();
  await checkMember(env, userId, link.twitch_user_id, tokens.accessToken);
  return true;
}

/** Hourly job: re-check members whose last check is over a day old (bounded batch). */
export async function recheckTwitchSubscribers(env: Env, now = Date.now()): Promise<void> {
  if (!twitchConfigured(env)) return;
  const due = await env.DB.prepare(
    "SELECT user_id FROM decave_twitch_member_links WHERE checked_at<? ORDER BY checked_at LIMIT ?",
  )
    .bind(new Date(now - RECHECK_MS).toISOString(), RECHECK_BATCH)
    .all<{ user_id: string }>();
  for (const row of due.results) {
    try {
      await recheckMember(env, row.user_id);
    } catch (error) {
      console.error("Twitch subscriber re-check failed", error instanceof Error ? error.message : "UnknownError");
      await env.DB.prepare("UPDATE decave_twitch_member_links SET checked_at=? WHERE user_id=?")
        .bind(new Date(now).toISOString(), row.user_id)
        .run();
    }
  }
}

/** The member's Twitch link and their subscription to this Hub's channel (Overview). */
export async function memberTwitchStatus(env: Env, hubId: number, userId: string) {
  const link = await env.DB.prepare("SELECT login FROM decave_twitch_member_links WHERE user_id=?")
    .bind(userId)
    .first<{ login: string }>();
  const sub = await env.DB.prepare("SELECT tier FROM decave_twitch_hub_subscribers WHERE hub_id=? AND user_id=?")
    .bind(hubId, userId)
    .first<{ tier: string }>();
  return { linked: Boolean(link), login: link?.login ?? null, subscribed: Boolean(sub), tier: sub?.tier ?? null };
}
