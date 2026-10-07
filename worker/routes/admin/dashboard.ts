// Platform owner dashboard overview.

import { requirePlatformOwner } from "../../lib/platform-owner";
import { nowIso } from "../../db";
import { json } from "../../lib/http";
import { ensureSquadFinderSchema } from "../../lib/squad";
import { realtimeFetch } from "../../lib/realtime";
import type { ApiContext } from "../context";

export async function handleAdminDashboardRoutes({
  request,
  env,
  url,
  p,
  method,
}: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/admin/dashboard") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const now = nowIso();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const requestedOffset = Number(url.searchParams.get("timezoneOffsetMinutes") ?? 0);
    const timezoneOffsetMinutes = Number.isFinite(requestedOffset)
      ? Math.max(-840, Math.min(840, Math.trunc(requestedOffset)))
      : 0;
    const localNow = new Date(Date.now() - timezoneOffsetMinutes * 60_000);
    const today = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth() + 1).padStart(2, "0")}-${String(localNow.getUTCDate()).padStart(2, "0")}`;
    const validDate = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
    const requestedTo = validDate(url.searchParams.get("to")) ?? today;
    const requestedFrom = validDate(url.searchParams.get("from")) ?? requestedTo;
    const toDate = new Date(`${requestedTo}T00:00:00.000Z`);
    const fromDate = new Date(`${requestedFrom}T00:00:00.000Z`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate)
      return json({ error: "Invalid dashboard date range" }, 400);
    const rangeDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (rangeDays > 90) return json({ error: "Dashboard range cannot exceed 90 days" }, 400);
    const rangeStart = new Date(fromDate.getTime() + timezoneOffsetMinutes * 60_000).toISOString();
    const rangeEnd = new Date(toDate.getTime() + 86_400_000 + timezoneOffsetMinutes * 60_000).toISOString();
    const activityDate = requestedFrom === requestedTo ? requestedFrom : `${requestedFrom} – ${requestedTo}`;
    const successfulLoginEvents = "'login.succeeded','login.owner_mfa_succeeded','login.qr_succeeded'";

    await ensureSquadFinderSchema(env);
    type RealtimeUsageStats = {
      onlineUsers?: number;
      voiceUsers?: number;
      screenSharingUsers?: number;
    };
    const realtimeStatsPromise: Promise<RealtimeUsageStats> = realtimeFetch(env, "/internal/stats")
      .then(async (response) => (response.ok ? ((await response.json()) as RealtimeUsageStats) : {}))
      .catch(() => ({}));

    const [
      accounts,
      verified,
      owners,
      admins,
      hubs,
      publicHubs,
      sessions,
      security24h,
      audit24h,
      ownersWithMfa,
      suspendedAccounts,
      deletionScheduledAccounts,
      signedInToday,
      returningUsers,
      squadFinderUsers,
      realtimeStats,
    ] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_users").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_users WHERE email_verified_at IS NOT NULL").first<{
        count: number;
      }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_users WHERE platform_role='owner'").first<{
        count: number;
      }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_users WHERE platform_role='admin'").first<{
        count: number;
      }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_hubs").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_hubs WHERE visibility='public'").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_sessions WHERE expires_at>?")
        .bind(now)
        .first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_security_events WHERE created_at>=?")
        .bind(dayAgo)
        .first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_platform_audit WHERE created_at>=?")
        .bind(dayAgo)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM decave_users u
         JOIN decave_owner_mfa m ON m.user_id=u.id
         WHERE u.platform_role='owner' AND m.enabled_at IS NOT NULL`,
      ).first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM decave_users
         WHERE suspended_at IS NOT NULL
           AND (suspended_until IS NULL OR suspended_until>?)`,
      )
        .bind(now)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM decave_users
         WHERE deleted_at IS NOT NULL AND erased_at IS NULL`,
      ).first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT user_id) AS count
         FROM decave_security_events
         WHERE user_id IS NOT NULL
           AND event IN (${successfulLoginEvents})
           AND created_at>=? AND created_at<?`,
      )
        .bind(rangeStart, rangeEnd)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM (
           SELECT DISTINCT today.user_id
           FROM decave_security_events today
           WHERE today.user_id IS NOT NULL
             AND today.event IN (${successfulLoginEvents})
             AND today.created_at>=? AND today.created_at<?
             AND EXISTS (
               SELECT 1
               FROM decave_security_events previous
               WHERE previous.user_id=today.user_id
                 AND previous.event IN (${successfulLoginEvents})
                 AND previous.created_at<?
             )
         ) returning_accounts`,
      )
        .bind(rangeStart, rangeEnd, rangeStart)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT user_id) AS count
         FROM decave_squad_searches
         WHERE status='active' AND expires_at>?`,
      )
        .bind(now)
        .first<{ count: number }>(),
      realtimeStatsPromise,
    ]);

    return json(
      {
        generatedAt: now,
        accounts: Number(accounts?.count ?? 0),
        verifiedAccounts: Number(verified?.count ?? 0),
        platformOwners: Number(owners?.count ?? 0),
        platformAdmins: Number(admins?.count ?? 0),
        hubs: Number(hubs?.count ?? 0),
        publicHubs: Number(publicHubs?.count ?? 0),
        activeSessions: Number(sessions?.count ?? 0),
        securityEvents24h: Number(security24h?.count ?? 0),
        platformAuditEvents24h: Number(audit24h?.count ?? 0),
        ownersWithMfa: Number(ownersWithMfa?.count ?? 0),
        suspendedAccounts: Number(suspendedAccounts?.count ?? 0),
        deletionScheduledAccounts: Number(deletionScheduledAccounts?.count ?? 0),
        activityDate,
        activityFrom: requestedFrom,
        activityTo: requestedTo,
        signedInToday: Number(signedInToday?.count ?? 0),
        returningUsers: Number(returningUsers?.count ?? 0),
        onlineUsers: Number(realtimeStats.onlineUsers ?? 0),
        voiceUsers: Number(realtimeStats.voiceUsers ?? 0),
        screenSharingUsers: Number(realtimeStats.screenSharingUsers ?? 0),
        squadFinderUsers: Number(squadFinderUsers?.count ?? 0),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  return null;
}
