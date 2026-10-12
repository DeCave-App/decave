// FACEIT Data API v4 (server key). Used only to read a player's public CS2
// ELO and skill level for the Streamer Hub leaderboard.

import type { Env } from "../lib/env";

const API = "https://open.faceit.com/data/v4";

// FACEIT Connect (OAuth 2 / OpenID), from https://api.faceit.com/auth/v1/openid_configuration.
const AUTHORIZE_URL = "https://accounts.faceit.com";
const TOKEN_URL = "https://api.faceit.com/auth/v1/oauth/token";
const USERINFO_URL = "https://api.faceit.com/auth/v1/resources/userinfo";

export type FaceitEnv = Pick<Env, "FACEIT_API_KEY" | "FACEIT_CLIENT_ID" | "FACEIT_CLIENT_SECRET">;
export type FaceitPlayer = { playerId: string; nickname: string; elo: number | null; level: number | null };

/** Data API key present: ELO lookups and refreshes work. */
export function faceitConfigured(env: Pick<Env, "FACEIT_API_KEY">): boolean {
  return Boolean(env.FACEIT_API_KEY);
}

/**
 * FACEIT Connect client present: members can link by signing in with FACEIT.
 * App Studio's "Authorization Code with PKCE" clients are public (no secret);
 * a confidential client also sets FACEIT_CLIENT_SECRET.
 */
export function faceitLoginConfigured(env: FaceitEnv): boolean {
  return Boolean(env.FACEIT_CLIENT_ID);
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE S256 challenge for a code verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

/** FACEIT's sign-in page. The redirect URI is the one registered for the client in FACEIT App Studio. */
export function faceitAuthorizeUrl(env: FaceitEnv, redirectUri: string, state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.FACEIT_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_popup", "true");
  return url.toString();
}

/** Exchanges the sign-in code (with its PKCE verifier) and returns the signed-in FACEIT player. */
export async function faceitUserFromCode(
  env: FaceitEnv,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<{ playerId: string; nickname: string } | null> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  // Confidential client: HTTP Basic with the secret. Public PKCE client: client_id in the body.
  if (env.FACEIT_CLIENT_SECRET)
    headers.Authorization = `Basic ${btoa(`${env.FACEIT_CLIENT_ID}:${env.FACEIT_CLIENT_SECRET}`)}`;
  else form.set("client_id", env.FACEIT_CLIENT_ID!);
  const token = await fetch(TOKEN_URL, { method: "POST", headers, body: form });
  if (!token.ok) throw new Error(`FACEIT token exchange failed (${token.status})`);
  const { access_token: accessToken } = (await token.json()) as { access_token?: string };
  if (!accessToken) return null;
  const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!info.ok) throw new Error(`FACEIT userinfo failed (${info.status})`);
  const claims = (await info.json()) as { guid?: unknown; sub?: unknown; nickname?: unknown };
  const playerId = typeof claims.guid === "string" ? claims.guid : typeof claims.sub === "string" ? claims.sub : "";
  if (!/^[0-9a-f-]{8,64}$/i.test(playerId)) return null;
  return { playerId, nickname: typeof claims.nickname === "string" ? claims.nickname.slice(0, 32) : "" };
}

function playerFrom(data: unknown): FaceitPlayer | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as {
    player_id?: unknown;
    nickname?: unknown;
    games?: { cs2?: { faceit_elo?: unknown; skill_level?: unknown } };
  };
  if (typeof raw.player_id !== "string" || typeof raw.nickname !== "string") return null;
  const cs2 = raw.games?.cs2;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null);
  return { playerId: raw.player_id, nickname: raw.nickname, elo: num(cs2?.faceit_elo), level: num(cs2?.skill_level) };
}

async function get(env: FaceitEnv, path: string): Promise<Response> {
  return fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${env.FACEIT_API_KEY}` } });
}

/** The FACEIT player with this nickname, or null when none exists. */
export async function faceitPlayerByNickname(env: FaceitEnv, nickname: string): Promise<FaceitPlayer | null> {
  const response = await get(env, `/players?nickname=${encodeURIComponent(nickname)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FACEIT lookup failed (${response.status})`);
  return playerFrom(await response.json());
}

export async function faceitPlayerById(env: FaceitEnv, playerId: string): Promise<FaceitPlayer | null> {
  const response = await get(env, `/players/${encodeURIComponent(playerId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FACEIT refresh failed (${response.status})`);
  return playerFrom(await response.json());
}
