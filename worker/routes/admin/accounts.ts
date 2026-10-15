// Account moderation from the owner dashboard: listing and detail, age
// recovery, suspension, password reset, deletion and restore, platform roles,
// Hub ownership transfer and erasure.

import {
  requirePlatformOwner,
  type PlatformRole,
  platformAudit,
  platformOwnerCount,
  platformUserByIdentifier,
} from "../../lib/platform-owner";
import { nowIso, userByReference, type UserRow, tokenHash, getHub, publicIdOf } from "../../db";
import { json, bodyJson, authBaseUrlForEnvironment, apiError, apiErrorLegacy } from "../../lib/http";
import { serverNotice } from "../../lib/notices";
import { ownerRequireReauth } from "../../lib/mfa";
import {
  deriveAgeProfile,
  saveAgeProfile,
  AGE_POLICY_VERSION,
  safetyProfileForClient,
  getSafetyProfile,
} from "../../trust-safety";
import { securityEvent, revokeAccountSessions, createAuthToken, activeSuspension } from "../../lib/sessions";
import { streamerMigrationExists, streamerRevokeParticipantStatements } from "../../streamer/index.ts";
import { sendResetEmail, sendVerificationEmail } from "../../lib/email";
import { userLocale } from "../../lib/i18n";
import { ownedHubCount } from "../../lib/hubs";
import { UNDERAGE_DELETION_REASON } from "../../retention";
import { realtimeBroadcast } from "../../lib/realtime";
import { AccountErasureStorageError, claimAccountErasure, eraseAccountData } from "../../account-erasure";
import type { ApiContext } from "../context";

export async function handleAdminAccountRoutes({ request, env, url, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/admin/accounts") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const requestedLimit = Number(url.searchParams.get("limit") ?? 75);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(150, Math.trunc(requestedLimit))) : 75;
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 120);
    const like = `%${search.replace(/[%_]/g, "\\$&")}%`;
    const now = nowIso();

    const query = search
      ? `SELECT
           u.id,u.public_id,u.username,u.email,u.email_verified_at,u.platform_role,u.created_at,
           u.suspended_at,u.suspended_until,u.suspension_reason,u.must_reset_password,
           u.deleted_at,u.delete_after,u.deletion_reason,u.erased_at,
           (SELECT COUNT(*) FROM decave_sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS active_sessions,
           (SELECT COUNT(*) FROM decave_hubs h WHERE h.owner_id=u.id) AS hubs_owned
         FROM decave_users u
         WHERE u.username LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR COALESCE(u.email,'') LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR u.public_id = ? COLLATE NOCASE
         ORDER BY u.created_at DESC, u.rowid DESC
         LIMIT ?`
      : `SELECT
           u.id,u.public_id,u.username,u.email,u.email_verified_at,u.platform_role,u.created_at,
           u.suspended_at,u.suspended_until,u.suspension_reason,u.must_reset_password,
           u.deleted_at,u.delete_after,u.deletion_reason,u.erased_at,
           (SELECT COUNT(*) FROM decave_sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS active_sessions,
           (SELECT COUNT(*) FROM decave_hubs h WHERE h.owner_id=u.id) AS hubs_owned
         FROM decave_users u
         ORDER BY u.created_at DESC, u.rowid DESC
         LIMIT ?`;

    const statement = search
      ? env.DB.prepare(query).bind(now, like, like, search, limit)
      : env.DB.prepare(query).bind(now, limit);

    const rows = await statement.all<{
      id: string;
      public_id: string | null;
      username: string;
      email: string | null;
      email_verified_at: string | null;
      platform_role: PlatformRole;
      created_at: string;
      suspended_at: string | null;
      suspended_until: string | null;
      suspension_reason: string;
      must_reset_password: number;
      deleted_at: string | null;
      delete_after: string | null;
      deletion_reason: string;
      erased_at: string | null;
      active_sessions: number;
      hubs_owned: number;
    }>();
    await platformAudit(env, owner.id, "platform.account_list_viewed", request, null, {
      limit,
      filtered: Boolean(search),
    });

    return json(
      {
        accounts: rows.results.map((row) => ({
          id: row.public_id ?? "",
          username: row.username,
          email: null,
          emailVerified: Boolean(row.email_verified_at),
          platformRole: row.platform_role,
          createdAt: row.created_at,
          activeSessions: Number(row.active_sessions ?? 0),
          hubsOwned: Number(row.hubs_owned ?? 0),
          suspended: Boolean(row.suspended_at && (!row.suspended_until || row.suspended_until > now)),
          suspendedAt: row.suspended_at,
          suspendedUntil: row.suspended_until,
          suspensionReason: row.suspension_reason,
          passwordResetRequired: row.must_reset_password === 1,
          deletedAt: row.deleted_at,
          deleteAfter: row.delete_after,
          deletionReason: row.deletion_reason,
          erasedAt: row.erased_at,
        })),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const adminAgeRecoveryMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/age-recovery$/);
  if (method === "POST" && adminAgeRecoveryMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const targetReference = decodeURIComponent(adminAgeRecoveryMatch[1]);
    const target = await userByReference(env.DB, targetReference);
    if (!target) return apiError("admin.accountNotFound", 404);
    // An account scheduled for deletion only because it was found to be under
    // 18 can still be corrected during the grace period.
    const underageDeletion = target.deleted_at && target.deletion_reason === UNDERAGE_DELETION_REASON;
    if (target.erased_at || (target.deleted_at && !underageDeletion)) {
      return apiError("admin.accountNotActive", 409);
    }

    const body = await bodyJson(request);
    const profile = deriveAgeProfile(body.birthDate);
    if (!profile) return apiError("admin.birthDateInvalid", 400);
    if (profile.ageStatus !== "eligible") {
      return apiError("admin.birthDateUnderage", 400);
    }

    await saveAgeProfile(env.DB, target.id, profile, nowIso(), "reviewed");
    if (underageDeletion) {
      await env.DB.prepare(
        "UPDATE decave_users SET deleted_at=NULL,delete_after=NULL,deletion_reason='' WHERE id=? AND deletion_reason=? AND erased_at IS NULL",
      )
        .bind(target.id, UNDERAGE_DELETION_REASON)
        .run();
    }
    await platformAudit(env, owner.id, "platform.account_age_corrected", request, target.id, {
      ageBand: profile.ageBand,
      agePolicyVersion: AGE_POLICY_VERSION,
      accountUnblocked: true,
    });
    await securityEvent(
      env,
      target.id,
      "age.corrected_by_owner",
      null,
      `Owner-reviewed age correction (${profile.ageBand})`,
    );
    return json({ success: true, safety: safetyProfileForClient(await getSafetyProfile(env.DB, target.id)) });
  }

  const adminAccountDetailMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)$/);
  if (method === "GET" && adminAccountDetailMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const targetReference = decodeURIComponent(adminAccountDetailMatch[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser) return apiError("admin.accountNotFound", 404);
    const targetUserId = targetUser.id;
    const now = nowIso();

    const target = await env.DB.prepare(
      `SELECT
         u.id,u.public_id,u.username,u.email,u.email_verified_at,u.platform_role,u.created_at,
         u.suspended_at,u.suspended_until,u.suspension_reason,u.must_reset_password,
         u.deleted_at,u.delete_after,u.deletion_reason,u.erased_at,
         COALESCE(sp.age_status,'unconfirmed') AS age_status,
         COALESCE(sp.age_band,'unknown') AS age_band,
         COALESCE(sp.age_assurance_method,'unknown') AS age_assurance_method,
         (SELECT COUNT(*) FROM decave_sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS active_sessions
       FROM decave_users u
       LEFT JOIN decave_user_safety_profiles sp ON sp.user_id=u.id
       WHERE u.id=?
       LIMIT 1`,
    )
      .bind(now, targetUserId)
      .first<{
        id: string;
        public_id: string | null;
        username: string;
        email: string | null;
        email_verified_at: string | null;
        platform_role: PlatformRole;
        created_at: string;
        suspended_at: string | null;
        suspended_until: string | null;
        suspension_reason: string;
        must_reset_password: number;
        deleted_at: string | null;
        delete_after: string | null;
        deletion_reason: string;
        erased_at: string | null;
        age_status: "unconfirmed" | "eligible" | "ineligible" | "review";
        age_band: "unknown" | "teen" | "adult";
        age_assurance_method: "unknown" | "self_attested" | "reviewed";
        active_sessions: number;
      }>();

    if (!target) return apiError("admin.accountNotFound", 404);
    await platformAudit(env, owner.id, "platform.account_details_viewed", request, target.id);

    const hubs = await env.DB.prepare(
      `SELECT id,name,visibility,created_at
       FROM decave_hubs
       WHERE owner_id=?
       ORDER BY created_at DESC`,
    )
      .bind(target.id)
      .all<{
        id: number;
        name: string;
        visibility: "private" | "public";
        created_at: string;
      }>();

    const recentSecurity = await env.DB.prepare(
      `SELECT id,event,detail,user_agent,created_at
       FROM decave_security_events
       WHERE user_id=?
       ORDER BY created_at DESC
       LIMIT 20`,
    )
      .bind(target.id)
      .all<{
        id: string;
        event: string;
        detail: string;
        user_agent: string;
        created_at: string;
      }>();

    const mfa =
      target.platform_role === "owner"
        ? await env.DB.prepare(`SELECT enabled_at FROM decave_owner_mfa WHERE user_id=? LIMIT 1`)
            .bind(target.id)
            .first<{ enabled_at: string | null }>()
        : null;

    const recovery =
      target.platform_role === "owner"
        ? await env.DB.prepare(
            `SELECT COUNT(*) AS count
           FROM decave_owner_recovery_codes
           WHERE user_id=? AND used_at IS NULL`,
          )
            .bind(target.id)
            .first<{ count: number }>()
        : null;

    return json(
      {
        account: {
          id: target.public_id ?? "",
          username: target.username,
          email: target.email,
          emailVerified: Boolean(target.email_verified_at),
          platformRole: target.platform_role,
          createdAt: target.created_at,
          activeSessions: Number(target.active_sessions ?? 0),
          suspended: Boolean(target.suspended_at && (!target.suspended_until || target.suspended_until > now)),
          suspendedAt: target.suspended_at,
          suspendedUntil: target.suspended_until,
          suspensionReason: target.suspension_reason,
          passwordResetRequired: target.must_reset_password === 1,
          deletedAt: target.deleted_at,
          deleteAfter: target.delete_after,
          deletionReason: target.deletion_reason,
          erasedAt: target.erased_at,
          ageStatus: target.age_status,
          ageBand: target.age_band,
          ageAssuranceMethod: target.age_assurance_method,
          ownerMfaEnabled: Boolean(mfa?.enabled_at),
          ownerRecoveryCodesRemaining: Number(recovery?.count ?? 0),
          hubsOwned: hubs.results.map((hub) => ({
            id: hub.id,
            name: hub.name,
            visibility: hub.visibility,
            createdAt: hub.created_at,
          })),
          recentSecurityEvents: recentSecurity.results.map((event) => ({
            id: event.id,
            event: event.event,
            detail: event.detail,
            userAgent: event.user_agent,
            createdAt: event.created_at,
          })),
        },
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const adminSuspendMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/suspend$/);
  if (method === "POST" && adminSuspendMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const targetReference = decodeURIComponent(adminSuspendMatch[1]);
    const target = await userByReference(env.DB, targetReference);
    if (!target) return apiError("admin.accountNotFound", 404);

    if (target.id === owner.id) {
      return apiError("admin.cannotSuspendSelf", 409);
    }
    if (target.erased_at) return apiError("admin.accountAlreadyBeenErased", 409);
    if (target.deleted_at) return apiError("admin.restoreBeforeSuspend", 409);
    if (target.platform_role === "owner") {
      return apiError("admin.demoteBeforeSuspend", 409);
    }

    const body = await bodyJson(request);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    const durationDaysRaw = Number(body.durationDays);
    const durationDays =
      Number.isFinite(durationDaysRaw) && durationDaysRaw > 0
        ? Math.max(1, Math.min(365, Math.trunc(durationDaysRaw)))
        : null;

    if (!reason) return apiError("admin.suspensionReasonRequired", 400);

    const suspendedAt = nowIso();
    const suspendedUntil = durationDays ? new Date(Date.now() + durationDays * 86400000).toISOString() : null;

    const suspensionStatements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE decave_users
       SET suspended_at=?,suspended_until=?,suspension_reason=?
       WHERE id=?`,
      ).bind(suspendedAt, suspendedUntil, reason, target.id),
    ];
    if (await streamerMigrationExists(env.DB)) {
      const memberships = await env.DB.prepare("SELECT hub_id FROM decave_hub_members WHERE user_id=?")
        .bind(target.id)
        .all<{ hub_id: number }>();
      for (const membership of memberships.results) {
        suspensionStatements.push(...streamerRevokeParticipantStatements(env.DB, membership.hub_id, target.id));
      }
    }
    await env.DB.batch(suspensionStatements);

    await revokeAccountSessions(env, target.id, "account_suspended");
    await platformAudit(env, owner.id, "platform.account_suspended", request, target.id, { durationDays, reason });
    await securityEvent(env, target.id, "account.suspended", null, reason);

    return json({ success: true, suspendedAt, suspendedUntil });
  }

  const adminUnsuspendMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/unsuspend$/);
  if (method === "POST" && adminUnsuspendMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const targetReference = decodeURIComponent(adminUnsuspendMatch[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser) return apiError("admin.accountNotFound", 404);
    const targetUserId = targetUser.id;
    const target = await env.DB.prepare("SELECT id,erased_at,deleted_at FROM decave_users WHERE id=? LIMIT 1")
      .bind(targetUserId)
      .first<{
        id: string;
        erased_at: string | null;
        deleted_at: string | null;
      }>();
    if (!target) return apiError("admin.accountNotFound", 404);
    if (target.erased_at) return apiError("admin.erasedCannotRestore", 409);
    if (target.deleted_at) return apiError("admin.restoreDeletedFirst", 409);

    await env.DB.prepare(
      `UPDATE decave_users
       SET suspended_at=NULL,suspended_until=NULL,suspension_reason=''
       WHERE id=?`,
    )
      .bind(target.id)
      .run();

    await platformAudit(env, owner.id, "platform.account_unsuspended", request, target.id);
    await securityEvent(env, target.id, "account.unsuspended", null);
    return json({ success: true });
  }

  const adminResendVerificationMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/resend-verification$/);
  if (method === "POST" && adminResendVerificationMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const target = await userByReference(env.DB, decodeURIComponent(adminResendVerificationMatch[1]));
    if (!target) return apiError("admin.accountNotFound", 404);
    if (target.erased_at || target.deleted_at) {
      return apiError("admin.accountNotActive", 409);
    }
    if (!target.email || target.email_verified_at) {
      return apiError("admin.verificationNotNeeded", 409);
    }

    const token = await createAuthToken(env, target.id, "verify_email", 24 * 60 * 60 * 1000);
    try {
      await sendVerificationEmail(
        env,
        target.email,
        target.username,
        token,
        authBaseUrlForEnvironment(env),
        await userLocale(env.DB, target.id),
      );
    } catch (error) {
      console.error("Could not resend verification email", error instanceof Error ? error.name : "UnknownError");
      await env.DB.prepare("UPDATE decave_auth_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL")
        .bind(nowIso(), tokenHash(token))
        .run();
      return apiError("admin.verificationEmailFailed", 502);
    }

    // Only the newest link stays usable.
    await env.DB.prepare(
      `UPDATE decave_auth_tokens SET consumed_at=?
       WHERE user_id=? AND purpose='verify_email' AND token_hash<>? AND consumed_at IS NULL`,
    )
      .bind(nowIso(), target.id, tokenHash(token))
      .run();

    await platformAudit(env, owner.id, "platform.verification_email_resent", request, target.id);
    await securityEvent(env, target.id, "email.verification_resent", null);
    return json({ success: true, ...serverNotice("admin.server.verificationEmailResent") });
  }

  const adminForceResetMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/force-password-reset$/);
  if (method === "POST" && adminForceResetMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const targetReference = decodeURIComponent(adminForceResetMatch[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser) return apiError("admin.accountNotFound", 404);
    const targetUserId = targetUser.id;
    if (targetUserId === owner.id) {
      return apiError("admin.useChangePassword", 409);
    }

    const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(targetUserId)
      .first<UserRow>();
    if (!target) return apiError("admin.accountNotFound", 404);
    if (target.erased_at || target.deleted_at) {
      return apiError("admin.accountNotActive", 409);
    }
    if (!target.email || !target.email_verified_at) {
      return apiError("admin.resetNeedsVerifiedEmail", 409);
    }

    const token = await createAuthToken(env, target.id, "reset_password", 30 * 60000);

    try {
      await sendResetEmail(
        env,
        target.email,
        target.username,
        token,
        authBaseUrlForEnvironment(env),
        await userLocale(env.DB, target.id),
      );
    } catch (error) {
      console.error("Could not send forced password reset email", error instanceof Error ? error.name : "UnknownError");
      await env.DB.prepare(
        `UPDATE decave_auth_tokens
         SET consumed_at=?
         WHERE user_id=? AND purpose='reset_password' AND consumed_at IS NULL`,
      )
        .bind(nowIso(), target.id)
        .run();
      return apiError("admin.resetEmailFailed", 502);
    }

    await env.DB.batch([
      env.DB.prepare(`UPDATE decave_users SET must_reset_password=1 WHERE id=?`).bind(target.id),
      env.DB.prepare(
        `UPDATE decave_auth_tokens
         SET consumed_at=?
         WHERE user_id=? AND purpose='reset_password'
           AND token_hash<>? AND consumed_at IS NULL`,
      ).bind(nowIso(), target.id, tokenHash(token)),
    ]);

    await revokeAccountSessions(env, target.id, "password_reset_required");
    await platformAudit(env, owner.id, "platform.password_reset_forced", request, target.id);
    await securityEvent(env, target.id, "password.reset_forced", null);

    return json({
      success: true,
      ...serverNotice("admin.server.passwordResetForced"),
    });
  }

  const adminDeleteMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/schedule-deletion$/);
  if (method === "POST" && adminDeleteMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const targetReference = decodeURIComponent(adminDeleteMatch[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser) return apiError("admin.accountNotFound", 404);
    const targetUserId = targetUser.id;
    if (targetUserId === owner.id) {
      return apiError("admin.cannotDeleteSelf", 409);
    }

    const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(targetUserId)
      .first<UserRow>();
    if (!target) return apiError("admin.accountNotFound", 404);
    if (target.erased_at) return apiError("admin.accountAlreadyErased", 409);
    if (target.platform_role === "owner") {
      return apiError("admin.demoteBeforeDelete", 409);
    }

    const hubs = await ownedHubCount(env.DB, target.id);
    if (hubs > 0) {
      return apiError("admin.hubsOwnedBeforeDelete", 409, undefined, undefined, { hubsOwned: hubs });
    }

    const body = await bodyJson(request);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    if (!reason) return apiError("admin.deletionReasonRequired", 400);

    const deletedAt = nowIso();
    const deleteAfter = new Date(Date.now() + 30 * 86400000).toISOString();

    await env.DB.prepare(
      `UPDATE decave_users
       SET deleted_at=?,delete_after=?,deletion_reason=?,
           suspended_at=NULL,suspended_until=NULL,suspension_reason=''
       WHERE id=?`,
    )
      .bind(deletedAt, deleteAfter, reason, target.id)
      .run();

    await revokeAccountSessions(env, target.id, "account_scheduled_for_deletion");
    await platformAudit(env, owner.id, "platform.account_deletion_scheduled", request, target.id, {
      deleteAfter,
      reason,
    });
    await securityEvent(env, target.id, "account.deletion_scheduled", null, reason);

    return json({ success: true, deletedAt, deleteAfter });
  }

  const adminRestoreMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/restore$/);
  if (method === "POST" && adminRestoreMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const targetReference = decodeURIComponent(adminRestoreMatch[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser) return apiError("admin.accountNotFound", 404);
    const targetUserId = targetUser.id;
    const target = await env.DB.prepare(
      "SELECT id,deleted_at,erased_at,erasure_started_at FROM decave_users WHERE id=? LIMIT 1",
    )
      .bind(targetUserId)
      .first<{
        id: string;
        deleted_at: string | null;
        erased_at: string | null;
        erasure_started_at: string | null;
      }>();
    if (!target) return apiError("admin.accountNotFound", 404);
    if (target.erased_at || target.erasure_started_at) return apiError("admin.erasingCannotRestore", 409);
    if (!target.deleted_at) return json({ success: true, unchanged: true });

    const restoreResult = await env.DB.prepare(
      `UPDATE decave_users
       SET deleted_at=NULL,delete_after=NULL,deletion_reason=''
       WHERE id=? AND erased_at IS NULL AND erasure_started_at IS NULL AND deleted_at IS NOT NULL`,
    )
      .bind(target.id)
      .run();
    if (Number(restoreResult.meta.changes ?? 0) !== 1) return apiError("admin.restoreStateChanged", 409);

    await platformAudit(env, owner.id, "platform.account_restored", request, target.id);
    await securityEvent(env, target.id, "account.restored", null);
    return json({ success: true });
  }

  const adminRoleMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/platform-role$/);
  if (method === "POST" && adminRoleMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const targetReference = decodeURIComponent(adminRoleMatch[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser) return apiError("admin.accountNotFound", 404);
    const targetUserId = targetUser.id;
    const body = await bodyJson(request);
    const role: PlatformRole | null =
      body.role === "user" || body.role === "admin" || body.role === "owner" ? body.role : null;
    if (!role) return apiError("admin.platformRoleInvalid", 400);

    const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(targetUserId)
      .first<UserRow>();
    if (!target) return apiError("admin.accountNotFound", 404);
    if (target.erased_at || target.deleted_at) {
      return apiError("admin.restoreBeforeRoleChange", 409);
    }
    if (target.id === owner.id && target.platform_role === "owner" && role !== "owner") {
      return apiError("admin.cannotDemoteSelf", 409);
    }
    if (target.platform_role === role) {
      return json({ success: true, unchanged: true, platformRole: role });
    }

    if (target.platform_role === "owner" && role !== "owner") {
      const count = await platformOwnerCount(env.DB);
      if (count <= 2) {
        return apiError("admin.minimumOwners", 409, undefined, undefined, { ownerCount: count });
      }
    }

    if (role === "owner" && !target.email_verified_at) {
      return apiError("admin.verifyEmailBeforePromote", 409);
    }

    const roleUpdate = await env.DB.prepare(
      `UPDATE decave_users SET platform_role=?
       WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL AND erasure_started_at IS NULL`,
    )
      .bind(role, target.id)
      .run();
    if (Number(roleUpdate.meta.changes ?? 0) !== 1) return apiError("admin.roleStateChanged", 409);

    if (target.platform_role === "owner" && role !== "owner") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM decave_owner_mfa WHERE user_id=?").bind(target.id),
        env.DB.prepare("DELETE FROM decave_owner_recovery_codes WHERE user_id=?").bind(target.id),
        env.DB.prepare("DELETE FROM decave_owner_reauth WHERE user_id=?").bind(target.id),
        env.DB.prepare("DELETE FROM decave_owner_login_challenges WHERE user_id=?").bind(target.id),
      ]);
    }

    await revokeAccountSessions(env, target.id, "platform_role_changed");
    await platformAudit(env, owner.id, "platform.account_role_changed", request, target.id, {
      previousRole: target.platform_role,
      newRole: role,
    });

    return json({
      success: true,
      platformRole: role,
      ownerCount: await platformOwnerCount(env.DB),
    });
  }

  const adminTransferHubMatch = p.match(/^\/api\/admin\/hubs\/(\d+)\/transfer-owner$/);
  if (method === "POST" && adminTransferHubMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const hubId = Number(adminTransferHubMatch[1]);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return apiError("admin.hubNotFound", 404);

    const body = await bodyJson(request);
    const targetIdentifier = typeof body.targetIdentifier === "string" ? body.targetIdentifier.trim() : "";
    if (!targetIdentifier) {
      return apiError("admin.newOwnerRequired", 400);
    }

    const target = await platformUserByIdentifier(env.DB, targetIdentifier);
    if (!target) return apiError("admin.newOwnerNotFound", 404);
    if (target.erased_at || target.deleted_at || activeSuspension(target)) {
      return apiError("admin.newOwnerNotActive", 409);
    }
    if (target.id === hub.owner_id) {
      return json({ success: true, unchanged: true });
    }

    const oldOwnerId = hub.owner_id;
    const now = nowIso();

    const transferResults = await env.DB.batch([
      env.DB.prepare(
        `UPDATE decave_hubs SET owner_id=?,updated_at=?
         WHERE id=? AND owner_id=?
           AND EXISTS(SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL AND erasure_started_at IS NULL)`,
      ).bind(target.id, now, hubId, hub.owner_id, target.id),
      env.DB.prepare(
        `INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at)
         SELECT ?,?,'owner',?
         WHERE EXISTS(SELECT 1 FROM decave_hubs WHERE id=? AND owner_id=?)
           AND EXISTS(SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL AND erasure_started_at IS NULL)
         ON CONFLICT(hub_id,user_id) DO UPDATE SET role='owner'`,
      ).bind(hubId, target.id, now, hubId, target.id, target.id),
      env.DB.prepare(
        `UPDATE decave_hub_members
         SET role='admin'
         WHERE hub_id=? AND user_id=? AND role='owner'
           AND EXISTS(SELECT 1 FROM decave_hubs WHERE id=? AND owner_id=?)`,
      ).bind(hubId, oldOwnerId, hubId, target.id),
    ]);
    if (Number(transferResults[0]?.meta?.changes ?? 0) !== 1) return apiError("admin.transferStateChanged", 409);

    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId, userIds: [oldOwnerId, target.id] });
    await platformAudit(env, owner.id, "platform.hub_ownership_transferred", request, target.id, {
      hubId,
      previousOwnerId: oldOwnerId,
      newOwnerId: target.id,
    });

    return json({
      success: true,
      hubId,
      previousOwnerId: oldOwnerId,
      newOwnerId: target.id,
    });
  }

  const adminEraseMatch = p.match(/^\/api\/admin\/accounts\/([^/]+)\/erase$/);
  if (method === "POST" && adminEraseMatch) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;

    const targetReference = decodeURIComponent(adminEraseMatch[1]);
    const targetUser = await userByReference(env.DB, targetReference);
    if (!targetUser) return apiError("admin.accountNotFound", 404);
    const targetUserId = targetUser.id;
    if (targetUserId === owner.id) {
      return apiError("admin.cannotEraseSelf", 409);
    }

    const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(targetUserId)
      .first<UserRow>();
    if (!target) return apiError("admin.accountNotFound", 404);
    const alreadyErased = Boolean(target.erased_at);
    if (!alreadyErased && target.platform_role === "owner") {
      return apiError("admin.demoteBeforeErase", 409);
    }
    if (!alreadyErased && (!target.deleted_at || !target.delete_after)) {
      return apiError("admin.scheduleDeletionBeforeErase", 409);
    }
    if (!alreadyErased && target.delete_after && target.delete_after > nowIso()) {
      return apiError("admin.deletionRecoveryPending", 409, undefined, undefined, { deleteAfter: target.delete_after });
    }

    if (!alreadyErased) {
      const hubs = await ownedHubCount(env.DB, target.id);
      if (hubs > 0) {
        return apiError("admin.hubsOwnedFirst", 409);
      }

      const body = await bodyJson(request);
      const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";
      if (confirmation !== target.username) {
        return apiError("admin.eraseConfirmMismatch", 400);
      }
    }

    // Manual and scheduled erasure share the same atomic claim and cleanup path.
    const claimedAt = await claimAccountErasure(env, target.id);
    if (!claimedAt) return apiError("admin.erasureStateChanged", 409);

    let erasure: Awaited<ReturnType<typeof eraseAccountData>>;
    try {
      erasure = await eraseAccountData(env, target.id, claimedAt);
    } catch (error) {
      if (error instanceof AccountErasureStorageError) {
        console.error(
          "Permanent account erasure stopped after an object-storage deletion failure.",
          error.cause instanceof Error ? error.cause.name : "UnknownError",
        );
        return apiErrorLegacy("ACCOUNT_ERASURE_STORAGE_FAILURE", "admin.erasureStorageFailure", 503);
      }
      throw error;
    }

    if (erasure.alreadyErased) {
      return json({
        success: true,
        unchanged: true,
        cleanupVerified: true,
        erasedAt: erasure.erasedAt,
        accountId: publicIdOf(erasure.target),
      });
    }

    await platformAudit(env, owner.id, "platform.account_permanently_erased", request, target.id, {
      retainedAuditTombstone: true,
    });

    return json({
      success: true,
      erasedAt: erasure.erasedAt,
      accountId: publicIdOf(erasure.target),
      ...serverNotice("admin.server.accountErased"),
    });
  }

  return null;
}
