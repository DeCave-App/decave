// Game activity: presence activity rows, the Steam link and Steam OpenID sign-in.

import type { Env } from "./env";
import { ensureCollaborationSchema } from "./hub-schema";
import { nowIso, type UserRow } from "../db";

export async function touchPresenceActivity(env: Env, userId: string): Promise<void> {
  await ensureCollaborationSchema(env);
  const stamp = nowIso();
  const staleBefore = new Date(Date.now() - 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO decave_presence_activity(user_id,last_seen_at)
       VALUES(?,?)
       ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
       WHERE decave_presence_activity.last_seen_at < ?`,
  )
    .bind(userId, stamp, staleBefore)
    .run();
}

export type ActivityStateRow = {
  user_id: string;
  manual_text: string;
  automatic_text: string;
  source: string;
  source_app_id: string;
  started_at: string | null;
  updated_at: string;
};

export type SteamLinkRow = {
  user_id: string;
  steam_id: string;
  persona_name: string;
  avatar_url: string;
  profile_url: string;
  linked_at: string;
  updated_at: string;
};

export type SteamPlayerSummary = {
  steamid?: string;
  personaname?: string;
  profileurl?: string;
  avatarfull?: string;
  avatarmedium?: string;
  gameid?: string;
  gameextrainfo?: string;
};

export async function ensureActivitySchema(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_activity_state (
        user_id TEXT PRIMARY KEY,
        manual_text TEXT NOT NULL DEFAULT '',
        automatic_text TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        source_app_id TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_steam_links (
        user_id TEXT PRIMARY KEY,
        steam_id TEXT NOT NULL UNIQUE,
        persona_name TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        profile_url TEXT NOT NULL DEFAULT '',
        linked_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_steam_link_states (
        state TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    ),
  ]);
}

export async function ensureActivityRow(env: Env, user: UserRow): Promise<ActivityStateRow> {
  await ensureActivitySchema(env);
  const stamp = nowIso();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO decave_activity_state
       (user_id, manual_text, automatic_text, source, source_app_id, started_at, updated_at)
       VALUES (?, ?, '', '', '', NULL, ?)`,
  )
    .bind(user.id, "", stamp)
    .run();

  const row = await env.DB.prepare("SELECT * FROM decave_activity_state WHERE user_id=?")
    .bind(user.id)
    .first<ActivityStateRow>();

  if (!row) throw new Error("Could not initialize activity state");
  if (row.manual_text) {
    await env.DB.prepare("UPDATE decave_activity_state SET manual_text='', updated_at=? WHERE user_id=?")
      .bind(stamp, user.id)
      .run();
    row.manual_text = "";
  }
  return row;
}

export function activitySource(value: unknown): string {
  if (value === "desktop-steam" || value === "desktop-epic" || value === "steam" || value === "desktop") {
    return value;
  }
  return "";
}

export async function steamPlayerSummary(env: Env, steamId: string): Promise<SteamPlayerSummary | null> {
  if (!env.STEAM_WEB_API_KEY) return null;
  try {
    const endpoint = new URL("https://partner.steam-api.com/ISteamUser/GetPlayerSummaries/v2/");
    endpoint.searchParams.set("key", env.STEAM_WEB_API_KEY);
    endpoint.searchParams.set("steamids", steamId);
    const response = await fetch(endpoint.toString(), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { response?: { players?: SteamPlayerSummary[] } };
    return data.response?.players?.[0] ?? null;
  } catch (error) {
    console.warn("Steam GetPlayerSummaries failed:", error);
    return null;
  }
}

export function steamOpenIdUrl(request: Request, state: string): string {
  const requestUrl = new URL(request.url);
  const callback = new URL("/api/integrations/steam/callback", requestUrl.origin);
  callback.searchParams.set("state", state);

  const openId = new URL("https://steamcommunity.com/openid/login");
  openId.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  openId.searchParams.set("openid.mode", "checkid_setup");
  openId.searchParams.set("openid.return_to", callback.toString());
  openId.searchParams.set("openid.realm", requestUrl.origin);
  openId.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  openId.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
  return openId.toString();
}

export function steamCallbackPage(title: string, message: string, ok: boolean): Response {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char] ?? char,
    );
  const accent = ok ? "#64e6a6" : "#ff6b7a";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;background:#050712;color:#eaf3ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;margin:24px;padding:30px;border:1px solid rgba(120,160,255,.2);border-radius:18px;background:#0b1220;box-shadow:0 24px 80px rgba(0,0,0,.38)"><div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${accent};font-weight:800">DeCave · Steam</div><h1 style="font-size:26px;margin:10px 0 10px">${escape(title)}</h1><p style="color:#aebbd0;line-height:1.6;margin:0">${escape(message)}</p><p style="color:#77849a;font-size:13px;margin:20px 0 0">You can close this tab and return to DeCave.</p></main></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function verifySteamOpenIdCallback(url: URL): Promise<string | null> {
  const state = url.searchParams.get("state") ?? "";
  const expectedReturn = new URL("/api/integrations/steam/callback", url.origin);
  expectedReturn.searchParams.set("state", state);
  const endpoint = "https://steamcommunity.com/openid/login";
  if (
    !state ||
    url.searchParams.get("openid.ns") !== "http://specs.openid.net/auth/2.0" ||
    url.searchParams.get("openid.mode") !== "id_res" ||
    url.searchParams.get("openid.return_to") !== expectedReturn.toString() ||
    (url.searchParams.has("openid.realm") && url.searchParams.get("openid.realm") !== url.origin) ||
    url.searchParams.get("openid.op_endpoint") !== endpoint
  )
    return null;

  const claimedId = url.searchParams.get("openid.claimed_id") ?? "";
  const identity = url.searchParams.get("openid.identity") ?? "";
  const match = claimedId.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/);
  if (!match || identity !== claimedId) return null;

  const params = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key.startsWith("openid.")) params.set(key, value);
  }
  params.set("openid.mode", "check_authentication");

  try {
    const response = await fetch("https://steamcommunity.com/openid/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!response.ok) return null;
    const verification = await response.text();
    if (!/(?:^|\n)is_valid:true(?:\r?\n|$)/.test(verification)) return null;
    return match[1];
  } catch (error) {
    console.warn("Steam OpenID verification failed:", error);
    return null;
  }
}
