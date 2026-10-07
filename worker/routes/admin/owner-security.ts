// Platform owner security: second-factor status and setup, re-authentication
// before privileged actions, and recovery codes.

import { requirePlatformOwner, platformAudit } from "../../lib/platform-owner";
import { json, bodyJson } from "../../lib/http";
import {
  platformOwnerMfaEnabled,
  ownerRandomMfaSecret,
  ownerEncryptMfa,
  ownerDecryptMfa,
  ownerMatchingTotpStep,
  ownerRecoveryCode,
  ownerVerifyMfaOrRecovery,
  ownerRequireReauth,
} from "../../lib/mfa";
import { verifyPassword, nowIso, tokenHash, createRawToken } from "../../db";
import { securityEventIpHash } from "../../lib/sessions";
import type { ApiContext } from "../context";

export async function handleOwnerSecurityRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/admin/security/mfa-status") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM decave_owner_recovery_codes WHERE user_id=? AND used_at IS NULL",
    )
      .bind(owner.id)
      .first<{ count: number }>();
    return json(
      {
        enabled: await platformOwnerMfaEnabled(env.DB, owner.id),
        recoveryCodesRemaining: Number(remaining?.count ?? 0),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/admin/security/mfa/setup") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const body = await bodyJson(request);
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    if (!(await verifyPassword(currentPassword, owner.password_salt, owner.password_hash))) {
      await platformAudit(env, owner.id, "platform.mfa_setup_reauth_failed", request);
      return json({ error: "Current password is incorrect" }, 403);
    }
    const existing = await env.DB.prepare(
      "SELECT secret_ciphertext,enabled_at FROM decave_owner_mfa WHERE user_id=? LIMIT 1",
    )
      .bind(owner.id)
      .first<{ secret_ciphertext: string; enabled_at: string | null }>();
    if (existing?.enabled_at) {
      const reauthError = await ownerRequireReauth(request, env, owner.id);
      if (reauthError) {
        const mfaCode = typeof body?.mfaCode === "string" ? body.mfaCode : "";
        if (!mfaCode) {
          await platformAudit(env, owner.id, "platform.mfa_setup_reauth_failed", request);
          return json({ error: "Verify your current authenticator or recovery code before replacing MFA." }, 428);
        }
        const method = await ownerVerifyMfaOrRecovery(env, owner.id, mfaCode);
        if (!method) {
          await platformAudit(env, owner.id, "platform.mfa_setup_reauth_failed", request);
          return json({ error: "The current authenticator or recovery code is invalid." }, 403);
        }
      }
    }
    const secret = ownerRandomMfaSecret();
    const encrypted = await ownerEncryptMfa(env, secret);
    const now = nowIso();
    const replaceEnabled = Boolean(existing?.enabled_at);
    const setupMutation = replaceEnabled
      ? env.DB.prepare(
          `UPDATE decave_owner_mfa SET secret_ciphertext=?,enabled_at=NULL,last_totp_step=NULL,updated_at=?
           WHERE user_id=? AND secret_ciphertext=? AND enabled_at=?
             AND EXISTS(SELECT 1 FROM decave_users WHERE id=? AND platform_role='owner')`,
        ).bind(encrypted, now, owner.id, existing!.secret_ciphertext, existing!.enabled_at, owner.id)
      : env.DB.prepare(
          `INSERT INTO decave_owner_mfa(user_id,secret_ciphertext,enabled_at,created_at,updated_at)
           SELECT ?,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM decave_users WHERE id=? AND platform_role='owner')
           ON CONFLICT(user_id) DO UPDATE SET
             secret_ciphertext=excluded.secret_ciphertext,
             enabled_at=NULL,
             last_totp_step=NULL,
             updated_at=excluded.updated_at
           WHERE decave_owner_mfa.enabled_at IS NULL`,
        ).bind(owner.id, encrypted, now, now, owner.id);
    // Use the newly generated secret as a mutation witness for both dependent
    // deletes. `changes()` is statement-local in D1/SQLite, so chaining it
    // would skip reauth deletion whenever recovery-code deletion changed 0 or
    // more than one row.
    const setupApplied = `EXISTS(
      SELECT 1 FROM decave_owner_mfa
      WHERE user_id=? AND secret_ciphertext=? AND enabled_at IS NULL AND updated_at=?
    )`;
    const results = await env.DB.batch([
      setupMutation,
      env.DB.prepare(`DELETE FROM decave_owner_recovery_codes WHERE user_id=? AND ${setupApplied}`).bind(
        owner.id,
        owner.id,
        encrypted,
        now,
      ),
      env.DB.prepare(`DELETE FROM decave_owner_reauth WHERE user_id=? AND ${setupApplied}`).bind(
        owner.id,
        owner.id,
        encrypted,
        now,
      ),
    ]);
    if (Number(results[0]?.meta.changes) !== 1)
      return json({ error: "Account authentication policy changed. Authenticate again." }, 409);
    await platformAudit(env, owner.id, "platform.mfa_setup_started", request, owner.id, {
      replacingEnrolledFactor: replaceEnabled,
    });
    const issuer = "DeCave";
    const accountLabel = owner.email || owner.username;
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    return json({ secret, otpauth }, 200, { "Cache-Control": "no-store, private" });
  }

  if (method === "POST" && p === "/api/admin/security/mfa/enable") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    const body = await bodyJson(request);
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    const row = await env.DB.prepare(
      "SELECT secret_ciphertext FROM decave_owner_mfa WHERE user_id=? AND enabled_at IS NULL LIMIT 1",
    )
      .bind(owner.id)
      .first<{ secret_ciphertext: string }>();
    if (!row) return json({ error: "Start MFA setup first" }, 409);
    const secret = await ownerDecryptMfa(env, row.secret_ciphertext);
    const matchedStep = await ownerMatchingTotpStep(secret, code);
    if (matchedStep === null) {
      await platformAudit(env, owner.id, "platform.mfa_enable_failed", request);
      return json({ error: "Authenticator code is invalid" }, 403);
    }
    const codes = Array.from({ length: 10 }, () => ownerRecoveryCode());
    const now = nowIso();
    const eventId = crypto.randomUUID();
    const event = "platform.mfa_enabled";
    const ipHash = await securityEventIpHash(env, request);
    const witness = "EXISTS(SELECT 1 FROM decave_platform_audit WHERE id=? AND actor_user_id=? AND action=?)";
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE decave_owner_mfa SET enabled_at=?,last_totp_step=?,updated_at=?
        WHERE user_id=? AND secret_ciphertext=? AND enabled_at IS NULL
        AND EXISTS(SELECT 1 FROM decave_users WHERE id=? AND platform_role='owner')`,
      ).bind(now, matchedStep, now, owner.id, row.secret_ciphertext, owner.id),
      // Only the primary CAS can create this unique witness. All dependent
      // inserts use it in the same transaction, not a chain of changes().
      // An insertion failure rolls back the primary update and the witness.
      env.DB.prepare(
        `INSERT INTO decave_platform_audit(id,actor_user_id,target_user_id,action,detail_json,request_ray,request_country,created_at)
        SELECT ?,?,NULL,?, '{"recoveryCodeCount":10}',?,?,? WHERE changes()=1`,
      ).bind(
        eventId,
        owner.id,
        event,
        (request.headers.get("CF-Ray") ?? "").slice(0, 80) || null,
        (request.headers.get("CF-IPCountry") ?? "").slice(0, 8) || null,
        now,
      ),
      ...codes.map((value) =>
        env.DB.prepare(
          `INSERT INTO decave_owner_recovery_codes(id,user_id,code_hash,used_at,created_at)
           SELECT ?,?,?,NULL,? WHERE ${witness}`,
        ).bind(crypto.randomUUID(), owner.id, tokenHash(value), now, eventId, owner.id, event),
      ),
      env.DB.prepare(
        `INSERT INTO decave_security_events(id,user_id,event,ip_hash,user_agent,detail,created_at)
        SELECT ?,?,?,?,?,?,? WHERE ${witness}`,
      ).bind(
        crypto.randomUUID(),
        owner.id,
        event,
        ipHash,
        (request.headers.get("user-agent") ?? "").slice(0, 240),
        "",
        now,
        eventId,
        owner.id,
        event,
      ),
    ]);
    if (Number(results[0]?.meta.changes) !== 1)
      return json({ error: "Owner or MFA state changed. Start MFA setup again." }, 409);
    return json({ success: true, recoveryCodes: codes }, 200, { "Cache-Control": "no-store, private" });
  }

  if (method === "POST" && p === "/api/admin/security/reauth") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const body = await bodyJson(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!(await verifyPassword(currentPassword, owner.password_salt, owner.password_hash))) {
      await platformAudit(env, owner.id, "platform.reauth_password_failed", request);
      return json({ error: "Current password is incorrect" }, 403);
    }
    if (!(await platformOwnerMfaEnabled(env.DB, owner.id))) {
      return json({ error: "Owner MFA must be enabled first" }, 409);
    }
    const methodUsed = await ownerVerifyMfaOrRecovery(env, owner.id, body.mfaCode);
    if (!methodUsed) {
      await platformAudit(env, owner.id, "platform.reauth_mfa_failed", request);
      return json({ error: "MFA or recovery code is invalid" }, 403);
    }
    // Keep legacy proof semantics, but do not let an in-flight legacy proof
    // issue privileges after a concurrent CUTOVER or role/MFA removal.
    const reauthToken = createRawToken();
    const now = nowIso();
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO decave_owner_reauth(token_hash,user_id,expires_at,created_at)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM decave_users WHERE id=? AND platform_role='owner')
        AND EXISTS(SELECT 1 FROM decave_owner_mfa WHERE user_id=? AND enabled_at IS NOT NULL)`,
      ).bind(
        tokenHash(reauthToken),
        owner.id,
        new Date(Date.parse(now) + 600_000).toISOString(),
        now,
        owner.id,
        owner.id,
      ),
      env.DB.prepare(
        `INSERT INTO decave_platform_audit(id,actor_user_id,target_user_id,action,detail_json,request_ray,request_country,created_at)
        SELECT ?,?,NULL,'platform.reauth_succeeded',?,?,?,? WHERE changes()=1`,
      ).bind(
        crypto.randomUUID(),
        owner.id,
        JSON.stringify({ method: methodUsed }),
        (request.headers.get("CF-Ray") ?? "").slice(0, 80) || null,
        (request.headers.get("CF-IPCountry") ?? "").slice(0, 8) || null,
        now,
      ),
    ]);
    if (Number(results[0]?.meta.changes) !== 1)
      return json({ error: "Owner authentication policy changed. Authenticate again." }, 409);
    return json({ reauthToken, expiresInSeconds: 600 }, 200, { "Cache-Control": "no-store, private" });
  }

  if (method === "POST" && p === "/api/admin/security/recovery/regenerate") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;

    const ownerReauthError = await ownerRequireReauth(request, env, owner.id);
    if (ownerReauthError) return ownerReauthError;

    const codes = Array.from({ length: 10 }, () => ownerRecoveryCode());
    const now = nowIso();

    await env.DB.batch([
      env.DB.prepare("DELETE FROM decave_owner_recovery_codes WHERE user_id=?").bind(owner.id),
      ...codes.map((value) =>
        env.DB.prepare(
          `INSERT INTO decave_owner_recovery_codes
           (id,user_id,code_hash,used_at,created_at)
           VALUES(?,?,?,NULL,?)`,
        ).bind(crypto.randomUUID(), owner.id, tokenHash(value), now),
      ),
    ]);

    await platformAudit(env, owner.id, "platform.recovery_codes_regenerated", request, owner.id, {
      recoveryCodeCount: 10,
    });

    return json({ recoveryCodes: codes }, 200, { "Cache-Control": "no-store, private" });
  }

  return null;
}
