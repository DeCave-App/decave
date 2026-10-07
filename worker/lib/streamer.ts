// Streamer Mode: feature flags and the access and mutation guards the
// streamer API is given.

import type { Env } from "./env";
import { streamerMigrationExists, streamerHubIdsForUser } from "../streamer/index.ts";
import { json, sameOriginWriteAllowed, requestKey } from "./http";
import { getHub, type ServerRole, nowIso } from "../db";
import { getSafetyProfile } from "../trust-safety";
import { requireUser } from "./sessions";
import { requireHubPostingPermission } from "./official-hubs";

export function streamerHubsEnabled(env: Pick<Env, "STREAMER_HUBS_ENABLED">): boolean {
  return env.STREAMER_HUBS_ENABLED?.trim().toLowerCase() === "true";
}

export function streamerGiveawaysEnabled(
  env: Pick<Env, "STREAMER_HUBS_ENABLED" | "STREAMER_GIVEAWAYS_ENABLED">,
): boolean {
  return streamerHubsEnabled(env) && env.STREAMER_GIVEAWAYS_ENABLED?.trim().toLowerCase() === "true";
}

export async function streamerHubIdsForUserSafe(env: Env, userId: string): Promise<Set<number>> {
  if (!streamerHubsEnabled(env)) return new Set<number>();
  if (!(await streamerMigrationExists(env.DB))) return new Set<number>();
  try {
    return await streamerHubIdsForUser(env.DB, userId);
  } catch (error) {
    console.error("Could not serialize Streamer Hub layouts", error instanceof Error ? error.name : "UnknownError");
    return new Set<number>();
  }
}

export async function streamerHubAccessGuard(
  request: Request,
  env: Env,
  hubId: number,
  userId: string,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not supported." }, 405);
  }

  const hub = await getHub(env.DB, hubId);
  if (!hub) return json({ error: "Hub not found." }, 404);
  const membership = await env.DB.prepare("SELECT role FROM decave_hub_members WHERE hub_id=? AND user_id=? LIMIT 1")
    .bind(hubId, userId)
    .first<{ role: ServerRole }>();

  // Membership is deliberately checked again here. handleStreamerRequest also
  // performs admission, but this hook is the host's retained-ban/private-Hub
  // boundary and must not become an unconditional allow-all adapter.
  if (!membership || !["owner", "admin", "member"].includes(membership.role)) {
    return json({ error: "Hub not found." }, 404);
  }

  const banned = await env.DB.prepare("SELECT 1 FROM decave_bans WHERE hub_id=? AND user_id=? LIMIT 1")
    .bind(hubId, userId)
    .first();
  if (banned) return json({ error: "You are banned from this Hub." }, 403);

  try {
    const safety = await getSafetyProfile(env.DB, userId);
    if (!safety) {
      return json(
        { error: "Account safety policy is temporarily unavailable.", code: "SAFETY_POLICY_UNAVAILABLE" },
        503,
      );
    }
    if (safety.age_status === "ineligible") {
      return json({ error: "This account is not eligible for DeCave.", code: "AGE_RESTRICTED" }, 403);
    }
  } catch (error) {
    console.error(
      "Could not apply Streamer Hub safety admission",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json({ error: "Account safety policy is temporarily unavailable.", code: "SAFETY_POLICY_UNAVAILABLE" }, 503);
  }

  // A private Hub is admitted by its existing membership row above. Official
  // Hub posting restrictions are applied by streamerMutationGuard below.
  void hub;
  return null;
}

export async function streamerMutationGuard(
  request: Request,
  env: Env,
  hubId: number,
  userId: string,
): Promise<Response | null> {
  if (!sameOriginWriteAllowed(request)) return json({ error: "Cross-site request blocked" }, 403);

  // Re-authenticate the session at the mutation boundary. This preserves the
  // host's session revocation/account-state checks even if this hook is reused.
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  if (user.id !== userId) return json({ error: "Authentication required" }, 401);

  const access = await streamerHubAccessGuard(request, env, hubId, userId);
  if (access) return access;

  const streamerPath = new URL(request.url).pathname;
  const participationRoute = /^\/api\/servers\/\d+\/streamer\/(?:queue\/(?:join|ready|leave)|giveaways\/enter)$/.test(
    streamerPath,
  );
  // Official owner-only posting governs Streamer configuration/content
  // mutations. Queue participation and giveaway entry are member actions and
  // must remain available to admitted members subject to the checks below.
  if (!participationRoute) {
    const postingError = await requireHubPostingPermission(env.DB, hubId, userId);
    if (postingError) return postingError;
  }

  const timeout = await env.DB.prepare(
    "SELECT 1 FROM decave_timeouts WHERE hub_id=? AND user_id=? AND expires_at>? LIMIT 1",
  )
    .bind(hubId, userId, nowIso())
    .first();
  if (timeout) return json({ error: "You are timed out in this Hub." }, 403);

  let safety;
  try {
    safety = await getSafetyProfile(env.DB, userId);
  } catch (error) {
    console.error("Could not apply Streamer mutation safety", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "Account safety policy is temporarily unavailable.", code: "SAFETY_POLICY_UNAVAILABLE" }, 503);
  }
  if (!safety) {
    return json({ error: "Account safety policy is temporarily unavailable.", code: "SAFETY_POLICY_UNAVAILABLE" }, 503);
  }
  if (safety.age_status === "ineligible") {
    return json({ error: "This account is not eligible for DeCave.", code: "AGE_RESTRICTED" }, 403);
  }

  if (
    streamerPath.endsWith("/giveaways/enter") &&
    (safety.age_status !== "eligible" || safety.age_band !== "adult" || safety.teen_safety_mode === 1)
  ) {
    return json({ error: "Giveaway entry is available only to verified adult accounts." }, 403);
  }

  try {
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: requestKey(request, `streamer:${userId}`) });
    if (!limited.success) return json({ error: "Too many Streamer actions. Please wait a minute." }, 429);
  } catch (error) {
    console.error("Could not apply Streamer mutation rate limit", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "Abuse protection is temporarily unavailable." }, 503);
  }

  return null;
}
