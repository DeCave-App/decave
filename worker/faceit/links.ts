// Members' linked FACEIT accounts. A link is only stored after the member signs
// in with FACEIT (OAuth 2 authorization code + PKCE), so nobody can claim
// someone else's FACEIT account by typing its nickname. Also: unlink, and the
// hourly ELO refresh.

import { createRawToken, nowIso } from "../db";
import { json } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { steamCallbackPage } from "../lib/activity";
import type { Env } from "../lib/env";
import type { ApiContext } from "../routes/context";
import {
  faceitAuthorizeUrl,
  faceitConfigured,
  faceitLoginConfigured,
  faceitPlayerById,
  faceitUserFromCode,
  pkceChallenge,
} from "./client";

export const FACEIT_CALLBACK_PATH = "/api/account/faceit/callback";
/** Linked accounts older than this are refreshed by the hourly job. */
const STALE_MS = 6 * 60 * 60 * 1000;
const REFRESH_BATCH = 40;
const STATE_TTL_MS = 10 * 60 * 1000;

function page(title: string, message: string, ok: boolean, showOpenDeCaveLink = false): Response {
  return steamCallbackPage(title, message, ok, showOpenDeCaveLink, "FACEIT");
}

function callbackUrl(request: Request): string {
  return new URL(FACEIT_CALLBACK_PATH, new URL(request.url).origin).toString();
}

/**
 * POST /api/account/faceit/connect → { url } to open in a browser.
 * GET  /api/account/faceit/callback ← FACEIT redirects here after sign-in.
 * DELETE /api/account/faceit unlinks.
 */
export async function handleFaceitRoutes({ request, env, url, p, method }: ApiContext): Promise<Response | null> {
  if (p === "/api/account/faceit" && method === "DELETE") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await env.DB.prepare("DELETE FROM decave_faceit_links WHERE user_id=?").bind(user.id).run();
    return json({ ok: true });
  }

  if (p === "/api/account/faceit/connect" && method === "POST") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    if (!faceitLoginConfigured(env)) return json({ error: "FACEIT sign-in isn't available yet." }, 503);
    const state = createRawToken();
    const verifier = createRawToken() + createRawToken();
    const createdAt = nowIso();
    await env.DB.prepare("DELETE FROM decave_faceit_link_states WHERE user_id=? OR expires_at<=?")
      .bind(user.id, createdAt)
      .run();
    await env.DB.prepare(
      "INSERT INTO decave_faceit_link_states(state,user_id,code_verifier,expires_at,created_at) VALUES(?,?,?,?,?)",
    )
      .bind(state, user.id, verifier, new Date(Date.now() + STATE_TTL_MS).toISOString(), createdAt)
      .run();
    return json({ url: faceitAuthorizeUrl(env, callbackUrl(request), state, await pkceChallenge(verifier)) });
  }

  if (p === FACEIT_CALLBACK_PATH && method === "GET") {
    const state = url.searchParams.get("state") ?? "";
    const claimed = state
      ? await env.DB.prepare(
          "DELETE FROM decave_faceit_link_states WHERE state=? AND expires_at>? RETURNING user_id,code_verifier",
        )
          .bind(state, nowIso())
          .first<{ user_id: string; code_verifier: string }>()
      : null;
    if (!claimed) return page("FACEIT link expired", "Start linking FACEIT again from the Leaderboard.", false);
    if (url.searchParams.get("error"))
      return page("FACEIT not linked", "You cancelled the FACEIT sign-in. Nothing was linked.", false);

    // FACEIT returns through a top-level cross-site GET, so only the browser's
    // SameSite=Lax session cookie can prove this browser belongs to the member
    // who started linking (same rule as the Steam link). Authorization headers
    // are ignored so a leaked API token cannot stand in for that proof.
    const browserHeaders = new Headers(request.headers);
    browserHeaders.delete("authorization");
    const browserUser = await requireUser(new Request(request.url, { method: "GET", headers: browserHeaders }), env);
    if (browserUser instanceof Response || browserUser.id !== claimed.user_id) {
      return page(
        "Sign in to finish FACEIT linking",
        "FACEIT was not linked. Open DeCave in this browser, sign in to the same account that started linking, then link FACEIT again from the Leaderboard.",
        false,
        true,
      );
    }

    const code = url.searchParams.get("code") ?? "";
    let faceitUser;
    try {
      faceitUser = code ? await faceitUserFromCode(env, code, callbackUrl(request), claimed.code_verifier) : null;
    } catch (error) {
      console.error("FACEIT sign-in exchange failed", error instanceof Error ? error.message : "UnknownError");
      faceitUser = null;
    }
    if (!faceitUser) return page("FACEIT verification failed", "FACEIT didn't confirm the sign-in. Try again.", false);

    const taken = await env.DB.prepare("SELECT user_id FROM decave_faceit_links WHERE player_id=?")
      .bind(faceitUser.playerId)
      .first<{ user_id: string }>();
    if (taken && taken.user_id !== claimed.user_id)
      return page("FACEIT account already linked", "That FACEIT account is linked to another DeCave account.", false);

    // ELO and level come from the Data API; the link is valid even if that lookup fails.
    let stats: { elo: number | null; level: number | null; nickname: string } | null = null;
    if (faceitConfigured(env)) {
      try {
        stats = await faceitPlayerById(env, faceitUser.playerId);
      } catch {
        stats = null;
      }
    }
    await env.DB.prepare(
      `INSERT INTO decave_faceit_links(user_id,player_id,nickname,elo,level,updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET player_id=excluded.player_id,nickname=excluded.nickname,
         elo=excluded.elo,level=excluded.level,updated_at=excluded.updated_at`,
    )
      .bind(
        claimed.user_id,
        faceitUser.playerId,
        stats?.nickname || faceitUser.nickname,
        stats?.elo ?? null,
        stats?.level ?? null,
        nowIso(),
      )
      .run();
    return page(
      "FACEIT linked",
      `Your FACEIT account ${stats?.nickname || faceitUser.nickname} is now linked to DeCave.`,
      true,
    );
  }

  return null;
}

/** Hourly: refresh the oldest stale links (bounded). Players FACEIT no longer knows are unlinked. */
export async function refreshFaceitLinks(env: Env, now = Date.now()): Promise<void> {
  if (!faceitConfigured(env)) return;
  const stale = await env.DB.prepare(
    "SELECT user_id,player_id FROM decave_faceit_links WHERE updated_at<? ORDER BY updated_at LIMIT ?",
  )
    .bind(new Date(now - STALE_MS).toISOString(), REFRESH_BATCH)
    .all<{ user_id: string; player_id: string }>();
  for (const link of stale.results) {
    try {
      const player = await faceitPlayerById(env, link.player_id);
      if (!player) {
        await env.DB.prepare("DELETE FROM decave_faceit_links WHERE user_id=?").bind(link.user_id).run();
        continue;
      }
      await env.DB.prepare("UPDATE decave_faceit_links SET nickname=?,elo=?,level=?,updated_at=? WHERE user_id=?")
        .bind(player.nickname, player.elo, player.level, new Date(now).toISOString(), link.user_id)
        .run();
    } catch (error) {
      console.error("FACEIT refresh failed", error instanceof Error ? error.message : "UnknownError");
      return; // Back off until the next hour.
    }
  }
}
