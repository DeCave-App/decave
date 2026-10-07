// Platform administration: security events, revoking a user's sessions,
// platform status, platform owners and the platform audit log.

import {
  requirePlatformOwner,
  platformAudit,
  platformOwnerCount,
  type PlatformOwnerListRow,
  platformOwnerForClient,
  platformUserByIdentifier,
} from "../../lib/platform-owner";
import { json, bodyJson } from "../../lib/http";
import { ownerRequireReauth, platformOwnerMfaEnabled } from "../../lib/mfa";
import { userByReference, publicIdOf } from "../../db";
import { revokeAccountSessions, securityEvent } from "../../lib/sessions";
import type { ApiContext } from "../context";

export async function handlePlatformAdminRoutes({
  request,
  env,
  url,
  p,
  method,
}: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/admin/security-events") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const requestedLimit = Number(url.searchParams.get("limit") ?? 75);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(150, Math.trunc(requestedLimit))) : 75;

    const rows = await env.DB.prepare(
      `SELECT
         e.id,e.user_id,u.public_id,u.username,e.event,e.detail,e.user_agent,e.created_at
       FROM decave_security_events e
       LEFT JOIN decave_users u ON u.id=e.user_id
       ORDER BY e.created_at DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all<{
        id: string;
        user_id: string | null;
        public_id: string | null;
        username: string | null;
        event: string;
        detail: string;
        user_agent: string;
        created_at: string;
      }>();
    // Reading other people's security history is itself an auditable access.
    await platformAudit(env, owner.id, "platform.security_events_viewed", request, null, {
      limit,
      returned: rows.results.length,
    });

    return json(
      {
        events: rows.results.map((row) => ({
          id: row.id,
          userId: row.public_id ?? null,
          username: row.username,
          event: row.event,
          detail: row.detail,
          userAgent: row.user_agent,
          createdAt: row.created_at,
        })),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/admin/sessions/revoke-user") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const ownerReauthError = await ownerRequireReauth(request, env, owner.id);
    if (ownerReauthError) return ownerReauthError;

    const body = await bodyJson(request);
    const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";

    if (!targetUserId) return json({ error: "Target account is required" }, 400);

    const target = await userByReference(env.DB, targetUserId);
    if (!target) return json({ error: "Target account was not found" }, 404);

    await revokeAccountSessions(env, target.id, "platform_security_revocation");

    await platformAudit(env, owner.id, "platform.sessions_revoked", request, target.id, {
      targetRole: target.platform_role,
    });
    await securityEvent(env, target.id, "sessions.revoked_by_platform_owner", request);

    return json({ success: true, targetUserId: publicIdOf(target) });
  }

  if (method === "GET" && p === "/api/admin/platform-status") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    return json(
      {
        platformRole: owner.platform_role,
        ownerCount: await platformOwnerCount(env.DB),
        minimumOwnerCount: 2,
        mfaEnabled: await platformOwnerMfaEnabled(env.DB, owner.id),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "GET" && p === "/api/admin/platform-owners") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const rows = await env.DB.prepare(
      `SELECT id, public_id, username, email, email_verified_at, platform_role, created_at
         FROM decave_users
         WHERE platform_role='owner'
         ORDER BY created_at, username`,
    ).all<PlatformOwnerListRow>();

    return json({ owners: rows.results.map(platformOwnerForClient) }, 200, { "Cache-Control": "no-store, private" });
  }

  if (method === "GET" && p === "/api/admin/platform-audit") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.trunc(requestedLimit))) : 50;

    const rows = await env.DB.prepare(
      `SELECT
           a.id,
           a.action,
           a.actor_user_id,
           actor.public_id AS actor_public_id,
           actor.username AS actor_username,
           a.target_user_id,
           target.public_id AS target_public_id,
           target.username AS target_username,
           a.detail_json,
           a.request_ray,
           a.request_country,
           a.created_at
         FROM decave_platform_audit a
         LEFT JOIN decave_users actor ON actor.id = a.actor_user_id
         LEFT JOIN decave_users target ON target.id = a.target_user_id
         ORDER BY a.created_at DESC
         LIMIT ?`,
    )
      .bind(limit)
      .all<{
        id: string;
        action: string;
        actor_user_id: string;
        actor_public_id: string | null;
        actor_username: string | null;
        target_user_id: string | null;
        target_public_id: string | null;
        target_username: string | null;
        detail_json: string;
        request_ray: string | null;
        request_country: string | null;
        created_at: string;
      }>();

    return json(
      {
        events: rows.results.map((row) => {
          let detail: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(row.detail_json) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              detail = parsed as Record<string, unknown>;
            }
          } catch {}

          return {
            id: row.id,
            action: row.action,
            actorUserId: row.actor_public_id ?? null,
            actorUsername: row.actor_username,
            targetUserId: row.target_public_id ?? null,
            targetUsername: row.target_username,
            detail,
            requestRay: row.request_ray,
            requestCountry: row.request_country,
            createdAt: row.created_at,
          };
        }),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/admin/platform-owners/promote") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const ownerReauthError = await ownerRequireReauth(request, env, owner.id);
    if (ownerReauthError) return ownerReauthError;

    const limited = await env.AUTH_RATE_LIMITER.limit({
      key: `platform-owner-promote:${owner.id}`,
    });
    if (!limited.success) {
      return json({ error: "Too many owner-management attempts. Try again shortly." }, 429);
    }

    const body = await bodyJson(request);
    const targetIdentifier = typeof body.targetIdentifier === "string" ? body.targetIdentifier.trim() : "";

    if (!targetIdentifier) {
      return json({ error: "Target account is required" }, 400);
    }

    const target = await platformUserByIdentifier(env.DB, targetIdentifier);
    if (!target) {
      await platformAudit(env, owner.id, "platform.owner_promote_target_not_found", request);
      return json({ error: "Target account was not found" }, 404);
    }

    if (!target.email_verified_at && target.requires_email_verification === 1) {
      return json({ error: "The target account must verify its email first" }, 409);
    }

    if (target.platform_role === "owner") {
      return json({
        success: true,
        unchanged: true,
        ownerCount: await platformOwnerCount(env.DB),
        owner: {
          id: publicIdOf(target),
          username: target.username,
          email: target.email,
          emailVerified: Boolean(target.email_verified_at),
          platformRole: target.platform_role,
          createdAt: target.created_at,
        },
      });
    }

    const promoted = await env.DB.prepare(
      "UPDATE decave_users SET platform_role='owner' WHERE id=? AND erasure_started_at IS NULL",
    )
      .bind(target.id)
      .run();
    if (Number(promoted.meta.changes ?? 0) !== 1)
      return json({ error: "That account is being erased and cannot be promoted." }, 409);

    await platformAudit(env, owner.id, "platform.owner_promoted", request, target.id, {
      previousRole: target.platform_role,
    });
    await securityEvent(env, owner.id, "platform.owner_promoted", request, `target=${publicIdOf(target)}`);

    return json({
      success: true,
      ownerCount: await platformOwnerCount(env.DB),
      owner: {
        id: publicIdOf(target),
        username: target.username,
        email: target.email,
        emailVerified: Boolean(target.email_verified_at),
        platformRole: "owner",
        createdAt: target.created_at,
      },
    });
  }

  if (method === "POST" && p === "/api/admin/platform-owners/demote") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const ownerReauthError = await ownerRequireReauth(request, env, owner.id);
    if (ownerReauthError) return ownerReauthError;

    const limited = await env.AUTH_RATE_LIMITER.limit({
      key: `platform-owner-demote:${owner.id}`,
    });
    if (!limited.success) {
      return json({ error: "Too many owner-management attempts. Try again shortly." }, 429);
    }

    const body = await bodyJson(request);
    const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";

    if (!targetUserId) {
      return json({ error: "Target owner is required" }, 400);
    }

    const target = await userByReference(env.DB, targetUserId);
    if (!target || target.platform_role !== "owner") {
      return json({ error: "Target platform owner was not found" }, 404);
    }

    if (target.id === owner.id) {
      return json({ error: "You cannot demote your own platform-owner account. Use another owner account." }, 409);
    }

    const countBefore = await platformOwnerCount(env.DB);
    if (countBefore <= 2) {
      return json(
        {
          error: "DeCave must always keep at least two platform owners. Promote another owner first.",
          ownerCount: countBefore,
          minimumOwnerCount: 2,
        },
        409,
      );
    }

    const demoted = await env.DB.prepare(
      "UPDATE decave_users SET platform_role='user' WHERE id=? AND platform_role='owner' AND erasure_started_at IS NULL",
    )
      .bind(target.id)
      .run();
    if (Number(demoted.meta.changes ?? 0) !== 1)
      return json({ error: "That account is being erased or is no longer an owner." }, 409);
    await revokeAccountSessions(env, target.id, "platform_owner_removed");

    await platformAudit(env, owner.id, "platform.owner_demoted", request, target.id, {
      previousRole: "owner",
      newRole: "user",
    });
    await securityEvent(env, owner.id, "platform.owner_demoted", request, `target=${publicIdOf(target)}`);

    return json({
      success: true,
      ownerCount: await platformOwnerCount(env.DB),
      targetUserId: publicIdOf(target),
    });
  }

  return null;
}
