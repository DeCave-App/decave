// Sign-in: registration, email verification, login with a second factor, the
// current session, signing out, signed-in devices, QR sign-in, adding an email,
// changing and resetting passwords.

import { streamerMigrationExists } from "../streamer/index.ts";
import { json, requestKey, bodyJson, authBaseUrlForEnvironment, escapeHtml } from "../lib/http";
import { streamerHubsEnabled, streamerGiveawaysEnabled } from "../lib/streamer";
import { validateEmail, validateUsername, validatePassword } from "../lib/validation";
import { TERMS_VERSION, PRIVACY_VERSION, MINIMUM_SIGNUP_AGE } from "../../shared/legal-consent";
import { deriveAgeProfile, saveAgeProfile, safetyProfileForClient, getSafetyProfile } from "../trust-safety";
import { verifyTurnstile } from "../lib/turnstile";
import { ensureOfficialHubSchema, joinOfficialHubs } from "../lib/official-hubs";
import {
  createPublicUserId,
  nowIso,
  hashPassword,
  tokenHash,
  type UserRow,
  verifyPassword,
  privateUser,
  userFromRequest,
  rawSessionTokenFromRequest,
  createRawToken,
  passwordHashNeedsUpgrade,
  DUMMY_PASSWORD_HASH,
  DUMMY_PASSWORD_SALT,
  sessionPublicId,
} from "../db";
import {
  securityEvent,
  createAuthToken,
  normalizeSessionClient,
  describeSessionDevice,
  describeRequestCountry,
  accountAccessError,
  replaceSessionClientClass,
  createSession,
  recordSessionClient,
  noteSignInDevice,
  createWsToken,
  sessionCookie,
  requireUser,
  ensureSessionClientSchema,
  clearSessionCookie,
  ensureQrLoginSchema,
  revokeAccountSessions,
  revokeSession,
} from "../lib/sessions";
import { sendVerificationEmail, sendResetEmail, sendEmailChangeNotice } from "../lib/email";
import {
  platformOwnerMfaEnabled,
  ownerCreateLoginChallenge,
  userMfaEnabled,
  userCreateLoginChallenge,
  ownerLoginChallenge,
  ownerVerifyMfaOrRecovery,
  userVerifyMfaOrRecovery,
  userRecoveryCodesRemaining,
} from "../lib/mfa";
import { platformAudit } from "../lib/platform-owner";
import type { ApiContext } from "./context";

/** A row of GET /api/auth/sessions (session joined with its client record). */
type SessionListRow = {
  token_hash: string;
  expires_at: string;
  created_at: string;
  client: string;
  device_label: string;
  last_seen_at: string | null;
};

/** A QR sign-in challenge; user_id is only selected when claiming. */
type QrLoginChallengeRow = {
  id: string;
  secret_hash: string;
  user_id?: string | null;
  expires_at: string;
  approved_at: string | null;
  claimed_at: string | null;
  requester_device?: string;
  requester_country?: string;
};

const SELF_DISABLE_REASON = "Self-disabled by account holder";
const SELF_DELETE_REASON = "Self-service account deletion";
const SHORT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Account holds the holder placed themselves, which a full sign-in lifts. */
type SelfServiceHolds = { disabled: boolean; deletion: boolean };

function selfServiceHolds(user: UserRow): SelfServiceHolds {
  return {
    disabled: Boolean(user.suspended_at) && user.suspension_reason === SELF_DISABLE_REASON,
    deletion:
      Boolean(user.deleted_at) &&
      user.deletion_reason === SELF_DELETE_REASON &&
      Boolean(user.delete_after) &&
      Date.parse(user.delete_after ?? "") > Date.now(),
  };
}

/** The user as it would look once its self-service holds are lifted (no DB write). */
function withSelfServiceHoldsLifted(user: UserRow, holds: SelfServiceHolds): UserRow {
  return {
    ...user,
    ...(holds.disabled ? { suspended_at: null, suspended_until: null, suspension_reason: "" } : {}),
    ...(holds.deletion ? { deleted_at: null, delete_after: null, deletion_reason: "" } : {}),
  };
}

/**
 * Lifts self-service holds. Call only after sign-in has fully succeeded
 * (password, plus the second factor when MFA is enabled). Each hold is cleared
 * only while it still carries the self-service reason, so an admin suspension
 * or deletion applied meanwhile is never lifted by signing in.
 */
async function liftSelfServiceHolds(
  env: ApiContext["env"],
  user: UserRow,
  holds: SelfServiceHolds,
  request: Request,
): Promise<UserRow | Response> {
  if (!holds.disabled && !holds.deletion) return user;
  if (holds.disabled) {
    await env.DB.prepare(
      `UPDATE decave_users SET suspended_at=NULL,suspended_until=NULL,suspension_reason=''
       WHERE id=? AND suspended_at IS NOT NULL AND suspension_reason=?`,
    )
      .bind(user.id, SELF_DISABLE_REASON)
      .run();
  }
  if (holds.deletion) {
    await env.DB.prepare(
      `UPDATE decave_users SET deleted_at=NULL,delete_after=NULL,deletion_reason=''
       WHERE id=? AND deleted_at IS NOT NULL AND deletion_reason=? AND delete_after>?
         AND erasure_started_at IS NULL AND erased_at IS NULL`,
    )
      .bind(user.id, SELF_DELETE_REASON, nowIso())
      .run();
  }
  const latest = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1").bind(user.id).first<UserRow>();
  if (!latest) return json({ error: "This account is no longer available." }, 403);
  const blocked = accountAccessError(latest);
  if (blocked) {
    await securityEvent(env, user.id, "login.blocked_account_state", request);
    return blocked;
  }
  await securityEvent(env, user.id, "account.self_reactivated_on_login", request);
  return latest;
}

const EMAIL_ACTION_JS = `(()=>{const root=document.querySelector("[data-email-action]");if(!root)return;const action=root.dataset.emailAction;const token=new URLSearchParams(location.hash.slice(1)).get("token")||"";history.replaceState(null,"",location.pathname+location.search);const form=root.querySelector("form");const status=root.querySelector("[role=status]");form.addEventListener("submit",async e=>{e.preventDefault();if(!token){status.textContent="This link is invalid or expired.";return}const button=form.querySelector("button");button.disabled=true;status.textContent="Working…";const body={token};if(action==="reset")body.password=form.elements.password.value;try{const path=action==="verify"?"/api/auth/verify-email":action==="secure"?"/api/auth/secure-account":"/api/auth/reset-password";const response=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"});const result=await response.json();status.textContent=response.ok?(result.message||"Done. You can close this page."):(result.error||"This link is invalid or expired.");if(response.ok)form.remove()}catch{status.textContent="Could not complete this action. Try again."}finally{button.disabled=false}})})();`;

function emailActionPage(action: "verify" | "secure" | "reset"): Response {
  const title =
    action === "verify" ? "Verify your email" : action === "secure" ? "Secure your account" : "Reset password";
  const description =
    action === "verify"
      ? "Choose Verify email to confirm this address."
      : action === "secure"
        ? "Choose the button only if you want to sign out every device and secure your account."
        : "Choose a new password to finish resetting your account.";
  const password =
    action === "reset"
      ? '<label for="password">New password</label><input id="password" name="password" type="password" minlength="10" maxlength="128" required autocomplete="new-password" placeholder="10–128 characters" style="width:100%;padding:12px;box-sizing:border-box;border-radius:10px;border:1px solid #344663;background:#080d18;color:white">'
      : "";
  const button =
    action === "verify"
      ? "Verify email"
      : action === "secure"
        ? "Sign out everywhere and secure my account"
        : "Set new password";
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>${title}</title></head><body style="margin:0;background:#080d18;color:#eef4ff;font-family:Arial;display:grid;place-items:center;min-height:100vh"><main data-email-action="${action}" style="width:min(420px,calc(100vw - 40px));background:#10182a;border:1px solid #273653;border-radius:16px;padding:28px;box-sizing:border-box"><h1 style="margin-top:0">${title}</h1><p>${description}</p><form>${password}<button type="submit" style="width:100%;margin-top:14px;padding:12px;border:0;border-radius:10px;background:#6fe4ff;color:#06111b;font-weight:800">${button}</button></form><p role="status" aria-live="polite"></p></main><script src="/api/auth/email-action.js" defer></script></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, private",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

export async function handleSignInRoutes({ request, env, url, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/auth/config") {
    const migrationPresent = await streamerMigrationExists(env.DB);
    return json({
      turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? "",
      turnstileTestMode: env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA",
      emailAuthEnabled: Boolean(env.EMAIL),
      streamerHubsEnabled: migrationPresent && streamerHubsEnabled(env),
      streamerGiveawaysEnabled: migrationPresent && streamerGiveawaysEnabled(env),
    });
  }

  if (method === "POST" && p === "/api/auth/register") {
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: requestKey(request, "register") });
    if (!limited.success) return json({ error: "Too many registration attempts. Try again shortly." }, 429);

    const body = await bodyJson(request);
    const email = validateEmail(body.email);
    const username = validateUsername(body.username);
    const password = validatePassword(body.password);
    const ageProfile = deriveAgeProfile(body.birthDate, new Date());
    if (!email) return json({ error: "Enter a valid email address" }, 400);
    if (!username) return json({ error: "Username must be 3-24 characters using letters, numbers, _, . or -" }, 400);
    if (!password) return json({ error: "Password must be 10-128 characters" }, 400);
    if (!ageProfile)
      return json({ error: `Enter a valid birth date to confirm you are ${MINIMUM_SIGNUP_AGE} or older.` }, 400);
    if (ageProfile.ageStatus === "ineligible") {
      return json(
        {
          error: `DeCave accounts are available only to people aged ${MINIMUM_SIGNUP_AGE} or older.`,
          code: "AGE_RESTRICTED",
        },
        403,
      );
    }
    if (body.termsAccepted !== true || body.termsVersion !== TERMS_VERSION || body.privacyVersion !== PRIVACY_VERSION) {
      return json({ error: "Review and accept the current Terms and Privacy Notice to create an account." }, 400);
    }
    if (!(await verifyTurnstile(request, env, body.turnstileToken, "register"))) {
      return json({ error: "Security check failed. Please try again." }, 403);
    }

    try {
      await ensureOfficialHubSchema(env);
    } catch (error) {
      console.error("Could not prepare default Hub membership", error instanceof Error ? error.name : "UnknownError");
      return json({ error: "Account setup is temporarily unavailable. Please try again." }, 503);
    }

    const { salt, hash } = await hashPassword(password);
    const exists = await env.DB.prepare(
      "SELECT 1 FROM decave_users WHERE username = ? COLLATE NOCASE OR email_normalized = ? LIMIT 1",
    )
      .bind(username, email)
      .first();
    const genericSignupResponse = () =>
      json({ success: true, message: "If the details can be used, the next step will be sent to you." }, 202, {
        "Cache-Control": "no-store, private",
      });
    if (exists) return genericSignupResponse();

    const id = crypto.randomUUID();
    const publicId = createPublicUserId();
    const createdAt = nowIso();
    const inserted = await env.DB.prepare(
      `INSERT INTO decave_users
         (id, public_id, username, password_salt, password_hash, created_at, email, email_normalized,
          requires_email_verification, terms_accepted_at, terms_version, privacy_version, activity_visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'friends')`,
    )
      .bind(id, publicId, username, salt, hash, createdAt, email, email, createdAt, TERMS_VERSION, PRIVACY_VERSION)
      .run()
      .catch((error: unknown) => {
        if (/unique constraint|constraint failed/i.test(String(error))) return null;
        throw error;
      });
    if (!inserted) return genericSignupResponse();

    try {
      await saveAgeProfile(env.DB, id, ageProfile, createdAt);
    } catch (error) {
      console.error("Could not prepare account safety profile", error instanceof Error ? error.name : "UnknownError");
      await env.DB.prepare("DELETE FROM decave_users WHERE id = ?").bind(id).run();
      return json({ error: "Account setup is temporarily unavailable. Please try again." }, 503);
    }

    try {
      await joinOfficialHubs(env, id, createdAt);
    } catch (error) {
      console.error("Could not add new account to official Hubs", error instanceof Error ? error.name : "UnknownError");
      await env.DB.prepare("DELETE FROM decave_users WHERE id = ?").bind(id).run();
      return json({ error: "Account setup is temporarily unavailable. Please try again." }, 503);
    }

    // The isolated local Worker has no email binding. With the documented
    // Turnstile test secret, complete local account setup immediately so a
    // developer can exercise the authenticated UI without a mail service.
    // Production credentials never take this path.
    if (env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA" && !env.EMAIL) {
      await env.DB.prepare("UPDATE decave_users SET email_verified_at=?,requires_email_verification=0 WHERE id=?")
        .bind(createdAt, id)
        .run();
      await securityEvent(env, id, "account.registered", request);
      return genericSignupResponse();
    }

    // Keep the signup response indistinguishable when email delivery is not
    // configured. Remove the pending account so the person can retry later.
    if (!env.EMAIL) {
      await env.DB.prepare("DELETE FROM decave_users WHERE id = ?").bind(id).run();
      return genericSignupResponse();
    }

    const verifyToken = await createAuthToken(env, id, "verify_email", 24 * 60 * 60 * 1000);
    try {
      const authBaseUrl = authBaseUrlForEnvironment(env);
      await sendVerificationEmail(env, email, username, verifyToken, authBaseUrl);
    } catch (error) {
      console.error("Could not send verification email", error instanceof Error ? error.name : "UnknownError");
      await env.DB.prepare("DELETE FROM decave_users WHERE id = ?").bind(id).run();
      return genericSignupResponse();
    }

    await securityEvent(env, id, "account.registered", request);
    return genericSignupResponse();
  }

  if (method === "GET" && p === "/api/auth/verify-email") {
    const legacyToken = url.searchParams.get("token");
    if (legacyToken) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `${url.origin}${url.pathname}#token=${encodeURIComponent(legacyToken)}`,
          "cache-control": "no-store, private",
          "referrer-policy": "no-referrer",
        },
      });
    }
    return emailActionPage("verify");
  }

  if (method === "POST" && p === "/api/auth/verify-email") {
    const raw = String((await bodyJson(request)).token ?? "");
    if (!raw || raw.length > 2048) return json({ error: "Verification link is invalid or expired." }, 400);
    const at = nowIso();
    const row = await env.DB.prepare(
      `SELECT t.id,t.user_id,u.email,u.email_normalized FROM decave_auth_tokens t
       JOIN decave_users u ON u.id=t.user_id
       WHERE t.token_hash=? AND t.purpose='verify_email' AND t.consumed_at IS NULL AND t.expires_at>?
       LIMIT 1`,
    )
      .bind(tokenHash(raw), at)
      .first<{ id: string; user_id: string; email: string | null; email_normalized: string | null }>();
    if (!row) return json({ error: "Verification link is invalid or expired." }, 400);
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE decave_users SET email_verified_at=?,requires_email_verification=0
         WHERE id=? AND email IS ? AND email_normalized IS ?
         AND EXISTS(SELECT 1 FROM decave_auth_tokens WHERE id=? AND token_hash=? AND purpose='verify_email'
           AND consumed_at IS NULL AND expires_at>?)`,
      ).bind(at, row.user_id, row.email, row.email_normalized, row.id, tokenHash(raw), at),
      env.DB.prepare(
        `UPDATE decave_auth_tokens SET consumed_at=? WHERE changes()=1 AND id=? AND user_id=?
         AND token_hash=? AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>?`,
      ).bind(at, row.id, row.user_id, tokenHash(raw), at),
    ]);
    if (results.some((result) => Number(result.meta?.changes ?? 0) !== 1)) {
      return json({ error: "Verification link is invalid or expired." }, 400);
    }
    await securityEvent(env, row.user_id, "email.verified", request);
    return json({ success: true, message: "Email verified. You can return to DeCave and sign in." }, 200, {
      "Cache-Control": "no-store, private",
    });
  }

  if (method === "POST" && p === "/api/auth/login") {
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: requestKey(request, "login") });
    if (!limited.success) return json({ error: "Too many login attempts. Try again shortly." }, 429);

    const body = await bodyJson(request);
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const staySignedIn = body.staySignedIn === true;
    const sessionClient = normalizeSessionClient(body.client);
    const mobileClient = sessionClient === "mobile";

    if (!(await verifyTurnstile(request, env, body.turnstileToken, "login"))) {
      return json({ error: "Security check failed. Please try again." }, 403);
    }

    const normalized = validateEmail(identifier);
    const accountLimit = await env.AUTH_RATE_LIMITER.limit({
      key: `login-account:${tokenHash((normalized ?? identifier.trim().toLowerCase()).slice(0, 320)).slice(0, 32)}`,
    });
    if (!accountLimit.success) return json({ error: "Too many login attempts. Try again shortly." }, 429);
    let user = await env.DB.prepare(
      `SELECT * FROM decave_users
         WHERE email_normalized = ?
         LIMIT 1`,
    )
      .bind(normalized ?? "")
      .first<UserRow>();

    // Always perform the password KDF, even when the identifier does not exist,
    // to reduce username/email enumeration through response-time differences.
    // The dummy hash is a valid scrypt-v2 hash so unknown identifiers pay the
    // same KDF cost as real (upgraded) accounts.
    const passwordMatches = await verifyPassword(
      password,
      user?.password_salt ?? DUMMY_PASSWORD_SALT,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordMatches) {
      await securityEvent(env, user?.id ?? null, "login.failed", request);
      return json({ error: "Invalid email or password" }, 401);
    }

    if (passwordHashNeedsUpgrade(user.password_hash)) {
      const upgraded = await hashPassword(password);
      const result = await env.DB.prepare(
        "UPDATE decave_users SET password_salt=?,password_hash=? WHERE id=? AND password_salt=? AND password_hash=?",
      )
        .bind(upgraded.salt, upgraded.hash, user.id, user.password_salt, user.password_hash)
        .run();
      if (Number(result.meta?.changes ?? 0) !== 1) {
        const latest = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
          .bind(user.id)
          .first<UserRow>();
        if (!latest || !(await verifyPassword(password, latest.password_salt, latest.password_hash))) {
          await securityEvent(env, user.id, "login.failed", request, "credential_changed_during_login");
          return json({ error: "Invalid email or password" }, 401);
        }
        user = latest;
      } else {
        user = { ...user, password_salt: upgraded.salt, password_hash: upgraded.hash };
      }
    }

    // A self-disabled account or a pending self-service deletion is lifted by
    // signing in again, but only once sign-in fully succeeds: after the
    // password for password-only accounts, and after the second factor for MFA
    // accounts. Here we only check the account would be usable once lifted;
    // any other hold (admin suspension, admin deletion, erasure) still blocks.
    const holds = selfServiceHolds(user);
    const accountBlocked = accountAccessError(withSelfServiceHoldsLifted(user, holds));
    if (accountBlocked) {
      await securityEvent(env, user.id, "login.blocked_account_state", request);
      return accountBlocked;
    }

    if (user.requires_email_verification === 1 && !user.email_verified_at) {
      return json({ error: "Verify your email before logging in." }, 403);
    }

    // MFA is mandatory at login for platform owners who have completed MFA
    // enrollment. Newly promoted owners without enrollment can still sign in
    // to complete MFA setup, but cannot obtain privileged re-authentication.
    if (user.platform_role === "owner" && (await platformOwnerMfaEnabled(env.DB, user.id))) {
      const challengeToken = await ownerCreateLoginChallenge(env, user.id, staySignedIn);
      await securityEvent(env, user.id, "login.owner_mfa_challenge", request);

      return json(
        {
          mfaRequired: true,
          challengeToken,
          challengeExpiresInSeconds: 300,
        },
        200,
        { "Cache-Control": "no-store, private" },
      );
    }

    if (await userMfaEnabled(env.DB, user.id)) {
      const challengeToken = await userCreateLoginChallenge(env, user.id, staySignedIn);
      await securityEvent(env, user.id, "login.mfa_challenge", request);
      return json({ mfaRequired: true, mfaKind: "user", challengeToken, challengeExpiresInSeconds: 300 }, 200, {
        "Cache-Control": "no-store, private",
      });
    }

    // Password-only account: the password was the full authentication.
    const liftedUser = await liftSelfServiceHolds(env, user, holds, request);
    if (liftedUser instanceof Response) return liftedUser;
    user = liftedUser;

    // DECAVE_PARITY_LOGIN_SESSION_CLASS
    await replaceSessionClientClass(env, user.id, sessionClient);
    const sessionTtlMs = staySignedIn ? 30 * 86400000 : 12 * 60 * 60 * 1000;
    const sessionToken = await createSession(env, user.id, sessionTtlMs);
    await recordSessionClient(env, sessionToken, user.id, sessionClient, request);
    await noteSignInDevice(env, request, user, sessionClient);
    const wsToken = await createWsToken(env, user.id, sessionToken);
    await securityEvent(env, user.id, "login.succeeded", request);

    return json(
      {
        user: privateUser(user),
        safety: safetyProfileForClient(await getSafetyProfile(env.DB, user.id)),
        wsToken,
        ...(mobileClient ? { sessionToken } : {}),
      },
      200,
      {
        "Set-Cookie": sessionCookie(request, sessionToken, staySignedIn ? 30 * 86400 : null),
        "Cache-Control": "no-store, private",
      },
    );
  }

  if (method === "POST" && p === "/api/auth/owner-mfa-login") {
    const body = await bodyJson(request);
    const challengeToken = typeof body.challengeToken === "string" ? body.challengeToken : "";
    const mfaCode = typeof body.mfaCode === "string" ? body.mfaCode.trim() : "";
    const sessionClient = normalizeSessionClient(body.client);
    const mobileClient = sessionClient === "mobile";

    const challenge = await ownerLoginChallenge(env, challengeToken);
    if (!challenge) {
      return json({ error: "MFA login challenge expired. Sign in again." }, 401);
    }

    const limited = await env.AUTH_RATE_LIMITER.limit({
      key: `owner-mfa-login:${challenge.user_id}`,
    });
    if (!limited.success) {
      return json({ error: "Too many MFA attempts. Try again shortly." }, 429);
    }

    let user = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(challenge.user_id)
      .first<UserRow>();

    if (!user || user.platform_role !== "owner" || !(await platformOwnerMfaEnabled(env.DB, challenge.user_id))) {
      await env.DB.prepare("DELETE FROM decave_owner_login_challenges WHERE token_hash=?")
        .bind(challenge.token_hash)
        .run();
      return json({ error: "MFA login challenge is no longer valid." }, 401);
    }

    const ownerHolds = selfServiceHolds(user);
    const ownerAccountBlocked = accountAccessError(withSelfServiceHoldsLifted(user, ownerHolds));
    if (ownerAccountBlocked) {
      await env.DB.prepare("DELETE FROM decave_owner_login_challenges WHERE token_hash=?")
        .bind(challenge.token_hash)
        .run();
      return ownerAccountBlocked;
    }

    const methodUsed = await ownerVerifyMfaOrRecovery(env, user.id, mfaCode);

    if (!methodUsed) {
      await securityEvent(env, user.id, "login.owner_mfa_failed", request);
      return json({ error: "Authenticator or recovery code is invalid." }, 403);
    }

    // Consume the challenge before issuing credentials.
    const consumedChallenge = await env.DB.prepare(
      "DELETE FROM decave_owner_login_challenges WHERE token_hash=? AND expires_at>? RETURNING token_hash",
    )
      .bind(challenge.token_hash, nowIso())
      .first<{ token_hash: string }>();
    if (!consumedChallenge) return json({ error: "MFA login challenge was already used. Sign in again." }, 409);

    // Password and second factor both verified: sign-in is complete.
    const liftedUser = await liftSelfServiceHolds(env, user, ownerHolds, request);
    if (liftedUser instanceof Response) return liftedUser;
    user = liftedUser;

    // DECAVE_PARITY_MFA_SESSION_CLASS
    await replaceSessionClientClass(env, user.id, sessionClient);
    const staySignedIn = challenge.stay_signed_in === 1;
    const sessionTtlMs = staySignedIn ? 30 * 86400000 : 12 * 60 * 60 * 1000;
    const sessionToken = await createSession(env, user.id, sessionTtlMs);
    await recordSessionClient(env, sessionToken, user.id, sessionClient, request);
    await noteSignInDevice(env, request, user, sessionClient);
    const wsToken = await createWsToken(env, user.id, sessionToken);

    await securityEvent(env, user.id, "login.owner_mfa_succeeded", request, `method=${methodUsed}`);
    await platformAudit(env, user.id, "platform.owner_login_mfa_succeeded", request, user.id, { method: methodUsed });

    return json(
      {
        user: privateUser(user),
        safety: safetyProfileForClient(await getSafetyProfile(env.DB, user.id)),
        wsToken,
        ...(mobileClient ? { sessionToken } : {}),
      },
      200,
      {
        "Set-Cookie": sessionCookie(request, sessionToken, staySignedIn ? 30 * 86400 : null),
        "Cache-Control": "no-store, private",
      },
    );
  }

  if (method === "POST" && p === "/api/auth/mfa-login") {
    const body = await bodyJson(request);
    const challengeToken = typeof body.challengeToken === "string" ? body.challengeToken : "";
    const sessionClient = normalizeSessionClient(body.client);
    const mobileClient = sessionClient === "mobile";
    if (!challengeToken || challengeToken.length > 2048) {
      return json({ error: "Sign-in check expired. Sign in again." }, 401);
    }
    const challenge = await env.DB.prepare(
      "SELECT token_hash,user_id,stay_signed_in FROM decave_user_login_challenges WHERE token_hash=? AND expires_at>? LIMIT 1",
    )
      .bind(tokenHash(challengeToken), nowIso())
      .first<{ token_hash: string; user_id: string; stay_signed_in: number }>();
    if (!challenge) return json({ error: "Sign-in check expired. Sign in again." }, 401);

    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `user-mfa-login:${challenge.user_id}` });
    if (!limited.success) return json({ error: "Too many attempts. Try again shortly." }, 429);

    const dropChallenge = () =>
      env.DB.prepare("DELETE FROM decave_user_login_challenges WHERE token_hash=?").bind(challenge.token_hash).run();
    const consumeChallenge = () =>
      env.DB.prepare(
        "DELETE FROM decave_user_login_challenges WHERE token_hash=? AND expires_at>? RETURNING token_hash",
      )
        .bind(challenge.token_hash, nowIso())
        .first<{ token_hash: string }>();
    let user = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(challenge.user_id)
      .first<UserRow>();
    if (!user || !(await userMfaEnabled(env.DB, user.id))) {
      await dropChallenge();
      return json({ error: "Sign-in check is no longer valid. Sign in again." }, 401);
    }
    const userHolds = selfServiceHolds(user);
    const blocked = accountAccessError(withSelfServiceHoldsLifted(user, userHolds));
    if (blocked) {
      await dropChallenge();
      return blocked;
    }
    const methodUsed = await userVerifyMfaOrRecovery(env, user.id, body.mfaCode);
    if (!methodUsed) {
      await securityEvent(env, user.id, "login.mfa_failed", request);
      return json({ error: "That code is not valid. Check your authenticator app and try again." }, 403);
    }
    const consumedChallenge = await consumeChallenge();
    if (!consumedChallenge) return json({ error: "Sign-in check was already used. Sign in again." }, 409);

    // Password and second factor (TOTP or recovery code) both verified.
    const liftedUser = await liftSelfServiceHolds(env, user, userHolds, request);
    if (liftedUser instanceof Response) return liftedUser;
    user = liftedUser;

    await replaceSessionClientClass(env, user.id, sessionClient);
    const staySignedIn = challenge.stay_signed_in === 1;
    const sessionToken = await createSession(env, user.id, staySignedIn ? 30 * 86400000 : 12 * 60 * 60 * 1000);
    await recordSessionClient(env, sessionToken, user.id, sessionClient, request);
    await noteSignInDevice(env, request, user, sessionClient);
    const wsToken = await createWsToken(env, user.id, sessionToken);
    await securityEvent(env, user.id, "login.mfa_succeeded", request, `method=${methodUsed}`);
    return json(
      {
        user: privateUser(user),
        safety: safetyProfileForClient(await getSafetyProfile(env.DB, user.id)),
        wsToken,
        recoveryCodesRemaining:
          methodUsed === "recovery" ? await userRecoveryCodesRemaining(env.DB, user.id) : undefined,
        ...(mobileClient ? { sessionToken } : {}),
      },
      200,
      {
        "Set-Cookie": sessionCookie(request, sessionToken, staySignedIn ? 30 * 86400 : null),
        "Cache-Control": "no-store, private",
      },
    );
  }

  return null;
}

export async function handleSessionRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/auth/me") {
    const user = await requireUser(request, env);
    if (user instanceof Response) {
      return new Response(user.body, {
        status: user.status,
        headers: {
          ...Object.fromEntries(user.headers),
          "Cache-Control": "no-store, private",
        },
      });
    }

    return json(
      {
        userId: user.id,
        user: privateUser(user),
        safety: safetyProfileForClient(await getSafetyProfile(env.DB, user.id)),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/auth/ws-token") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const sessionToken = rawSessionTokenFromRequest(request);
    if (!sessionToken) return json({ error: "An active session is required." }, 401);
    const wsToken = await createWsToken(env, user.id, sessionToken);
    return json({ wsToken });
  }

  if (method === "POST" && p === "/api/auth/logout") {
    const user = await userFromRequest(env.DB, request);
    const raw = rawSessionTokenFromRequest(request);
    if (raw) {
      await revokeSession(env, tokenHash(raw), "logout");
    }
    if (user) {
      await securityEvent(env, user.id, "logout", request);
    }
    return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  }

  if (method === "POST" && p === "/api/auth/logout-all") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await revokeAccountSessions(env, user.id, "logout_all");
    await securityEvent(env, user.id, "sessions.revoked_all", request);
    return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
  }

  // DECAVE_PARITY_ACCOUNT_ENDPOINTS
  if (method === "GET" && p === "/api/auth/sessions") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureSessionClientSchema(env);
    const raw = rawSessionTokenFromRequest(request);
    const currentHash = raw ? tokenHash(raw) : "";
    const rows = await env.DB.prepare(
      `SELECT s.token_hash,s.expires_at,s.created_at,COALESCE(m.client,'legacy') client,COALESCE(m.device_label,'Legacy session') device_label,m.last_seen_at FROM decave_sessions s LEFT JOIN decave_session_clients m ON m.token_hash=s.token_hash WHERE s.user_id=? AND s.expires_at>? ORDER BY s.created_at DESC`,
    )
      .bind(user.id, nowIso())
      .all<SessionListRow>();
    return json(
      {
        sessions: rows.results.map((row) => ({
          // Opaque id derived from the token hash; the stored hash is never sent.
          id: sessionPublicId(row.token_hash),
          client: row.client,
          deviceLabel: row.device_label,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          lastActiveAt: row.last_seen_at ?? null,
          current: row.token_hash === currentHash,
        })),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/auth/sessions/revoke") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureSessionClientSchema(env);
    const body = await bodyJson(request);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id || !/^[0-9a-f]{32}$/.test(id)) return json({ error: "Choose a session to log out." }, 400);
    // The id is opaque (derived from the token hash), so resolve it among the
    // caller's own sessions. A raw token hash is no longer accepted.
    const ownedRows = await env.DB.prepare("SELECT token_hash FROM decave_sessions WHERE user_id=?")
      .bind(user.id)
      .all<{ token_hash: string }>();
    const owned = ownedRows.results.find((row) => sessionPublicId(row.token_hash) === id);
    if (!owned) return json({ error: "That session is no longer active." }, 404);
    const raw = rawSessionTokenFromRequest(request);
    const current = Boolean(raw && tokenHash(raw) === owned.token_hash);
    await revokeSession(env, owned.token_hash, "session_revoked");
    await securityEvent(env, user.id, "session.revoked_one", request, `client_session=${id.slice(0, 12)}`);
    return json({ success: true, current }, 200, current ? { "Set-Cookie": clearSessionCookie(request) } : undefined);
  }

  if (method === "POST" && p === "/api/auth/qr/start") {
    await ensureQrLoginSchema(env);
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: requestKey(request, "qr-start") });
    if (!limited.success) return json({ error: "Too many QR login requests. Try again shortly." }, 429);
    const body = await bodyJson(request);
    const id = crypto.randomUUID();
    const secret = createRawToken();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const client = normalizeSessionClient(body.client);
    const country = request.headers.get("CF-IPCountry") ?? "";
    const device = describeSessionDevice(request.headers.get("user-agent") ?? "", client, country);
    await env.DB.prepare("DELETE FROM decave_qr_login_challenges WHERE expires_at<=? OR claimed_at IS NOT NULL")
      .bind(nowIso())
      .run();
    await env.DB.prepare(
      `INSERT INTO decave_qr_login_challenges
       (id,secret_hash,user_id,expires_at,approved_at,claimed_at,created_at,requester_device,requester_country)
       VALUES(?,?,NULL,?,NULL,NULL,?,?,?)`,
    )
      .bind(id, tokenHash(secret), expiresAt, nowIso(), device, /^[A-Z]{2}$/.test(country) ? country : "")
      .run();
    return json(
      {
        challengeId: id,
        secret,
        expiresAt,
        payload: `decave://qr-login?challenge=${encodeURIComponent(id)}&secret=${encodeURIComponent(secret)}`,
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/auth/qr/preview") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureQrLoginSchema(env);
    const body = await bodyJson(request);
    const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
    const secret = typeof body.secret === "string" ? body.secret : "";
    const challenge = await env.DB.prepare(
      `SELECT secret_hash,expires_at,approved_at,claimed_at,requester_device,requester_country
       FROM decave_qr_login_challenges WHERE id=? LIMIT 1`,
    )
      .bind(challengeId)
      .first<QrLoginChallengeRow>();
    if (
      !challenge ||
      challenge.secret_hash !== tokenHash(secret) ||
      challenge.expires_at <= nowIso() ||
      challenge.approved_at ||
      challenge.claimed_at
    ) {
      return json({ error: "This QR login code expired or was already used." }, 400, {
        "Cache-Control": "no-store, private",
      });
    }
    return json(
      {
        deviceLabel: (challenge.requester_device ?? "Unknown device").slice(0, 80),
        locationLabel: describeRequestCountry(challenge.requester_country ?? "") || "Unknown location",
        expiresAt: challenge.expires_at,
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/auth/qr/approve") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureQrLoginSchema(env);
    const body = await bodyJson(request);
    if (body.approved !== true) return json({ error: "Confirm approval to continue." }, 400);
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `qr-approve:${user.id}` });
    if (!limited.success) return json({ error: "Too many QR approvals. Try again shortly." }, 429);
    const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
    const secret = typeof body.secret === "string" ? body.secret : "";
    const challenge = await env.DB.prepare(
      "SELECT id,secret_hash,expires_at,approved_at,claimed_at FROM decave_qr_login_challenges WHERE id=? LIMIT 1",
    )
      .bind(challengeId)
      .first<QrLoginChallengeRow>();
    if (
      !challenge ||
      challenge.secret_hash !== tokenHash(secret) ||
      challenge.expires_at <= nowIso() ||
      challenge.claimed_at
    )
      return json({ error: "This QR login code expired. Refresh it on the other device." }, 400);
    if (challenge.approved_at) return json({ error: "This QR login code was already approved." }, 409);
    const mfaCode = typeof body.mfaCode === "string" ? body.mfaCode : "";
    const ownerFactor = user.platform_role === "owner" && (await platformOwnerMfaEnabled(env.DB, user.id));
    const regularFactor = !ownerFactor && (await userMfaEnabled(env.DB, user.id));
    if (ownerFactor && !(await ownerVerifyMfaOrRecovery(env, user.id, mfaCode))) {
      return json({ error: "Enter a current authenticator or recovery code to approve this login." }, 403);
    }
    if (regularFactor && !(await userVerifyMfaOrRecovery(env, user.id, mfaCode))) {
      return json({ error: "Enter a current authenticator or recovery code to approve this login." }, 403);
    }
    const approved = await env.DB.prepare(
      `UPDATE decave_qr_login_challenges SET user_id=?,approved_at=?
       WHERE id=? AND secret_hash=? AND expires_at>? AND approved_at IS NULL AND claimed_at IS NULL`,
    )
      .bind(user.id, nowIso(), challengeId, tokenHash(secret), nowIso())
      .run();
    if (Number(approved.meta?.changes ?? 0) !== 1)
      return json({ error: "This QR login code expired or was already used." }, 409);
    await securityEvent(env, user.id, "login.qr_approved", request);
    return json({ success: true });
  }

  if (method === "POST" && p === "/api/auth/qr/claim") {
    await ensureQrLoginSchema(env);
    const body = await bodyJson(request);
    const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
    const secret = typeof body.secret === "string" ? body.secret : "";
    const sessionClient = normalizeSessionClient(body.client);
    const challenge = await env.DB.prepare(
      "SELECT id,secret_hash,user_id,expires_at,approved_at,claimed_at FROM decave_qr_login_challenges WHERE id=? LIMIT 1",
    )
      .bind(challengeId)
      .first<QrLoginChallengeRow>();
    if (
      !challenge ||
      challenge.secret_hash !== tokenHash(secret) ||
      challenge.expires_at <= nowIso() ||
      challenge.claimed_at
    )
      return json({ error: "This QR login code expired." }, 410);
    if (!challenge.user_id || !challenge.approved_at)
      return json({ pending: true }, 202, { "Cache-Control": "no-store, private" });
    const user = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(challenge.user_id)
      .first<UserRow>();
    if (!user) return json({ error: "The approving account is unavailable." }, 404);
    const blocked = accountAccessError(user);
    if (blocked) return blocked;
    const claimed = await env.DB.prepare(
      `UPDATE decave_qr_login_challenges SET claimed_at=?
       WHERE id=? AND secret_hash=? AND user_id=? AND approved_at IS NOT NULL AND claimed_at IS NULL AND expires_at>?
       RETURNING id`,
    )
      .bind(nowIso(), challengeId, tokenHash(secret), user.id, nowIso())
      .first<{ id: string }>();
    if (!claimed) return json({ error: "This QR login code was already used or expired." }, 409);
    await replaceSessionClientClass(env, user.id, sessionClient);
    // QR sign-in grants a short, non-persistent session (same as a password
    // sign-in without "stay signed in"); the cookie is a session cookie.
    const sessionToken = await createSession(env, user.id, SHORT_SESSION_TTL_MS);
    await recordSessionClient(env, sessionToken, user.id, sessionClient, request);
    await noteSignInDevice(env, request, user, sessionClient);
    const wsToken = await createWsToken(env, user.id, sessionToken);
    await securityEvent(env, user.id, "login.qr_succeeded", request);
    return json(
      { user: privateUser(user), safety: safetyProfileForClient(await getSafetyProfile(env.DB, user.id)), wsToken },
      200,
      {
        "Set-Cookie": sessionCookie(request, sessionToken, null),
        "Cache-Control": "no-store, private",
      },
    );
  }

  return null;
}

export async function handlePasswordRoutes({
  request,
  env,
  url,
  p,
  method,
  ctx,
}: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/auth/email-action.js") {
    return new Response(EMAIL_ACTION_JS, {
      headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (method === "POST" && p === "/api/auth/add-email") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: `add-email:${user.id}` });
    if (!limited.success) return json({ error: "Too many email change attempts. Please try again later." }, 429);

    const body = await bodyJson(request);
    if (!body) {
      return json({ error: "Invalid account mutation request.", code: "INVALID_INPUT" }, 400);
    }
    const email = validateEmail(body.email);
    if (!email) return json({ error: "Enter a canonical valid email address" }, 400);
    {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "email.add_failed_password", request);
        return json({ error: "Current password is incorrect" }, 403);
      }
    }
    const mfaCode = typeof body.mfaCode === "string" ? body.mfaCode : "";
    const ownerFactor = user.platform_role === "owner" && (await platformOwnerMfaEnabled(env.DB, user.id));
    const regularFactor = !ownerFactor && (await userMfaEnabled(env.DB, user.id));
    if (ownerFactor && !(await ownerVerifyMfaOrRecovery(env, user.id, mfaCode))) {
      return json({ error: "Enter a current authenticator or recovery code to change your email." }, 403);
    }
    if (regularFactor && !(await userVerifyMfaOrRecovery(env, user.id, mfaCode))) {
      return json({ error: "Enter a current authenticator or recovery code to change your email." }, 403);
    }

    let verifyToken: string;
    {
      const exists = await env.DB.prepare("SELECT 1 FROM decave_users WHERE email_normalized=? AND id<>? LIMIT 1")
        .bind(email, user.id)
        .first();
      if (exists) return json({ error: "That email is already registered" }, 409);
      verifyToken = createRawToken();
      const tokenId = crypto.randomUUID();
      const at = nowIso();
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE decave_users SET email=?,email_normalized=?,email_verified_at=NULL
          WHERE id=? AND email IS ? AND email_normalized IS ? AND email_verified_at IS ?
          AND NOT EXISTS(SELECT 1 FROM decave_users other WHERE other.id<>? AND other.email_normalized=?)`,
        ).bind(email, email, user.id, user.email, user.email_normalized, user.email_verified_at, user.id, email),
        env.DB.prepare(
          `INSERT INTO decave_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at)
          SELECT ?,id,'verify_email',?,?,? FROM decave_users WHERE changes()=1 AND id=?`,
        ).bind(
          tokenId,
          tokenHash(verifyToken),
          new Date(Date.parse(at) + 24 * 60 * 60 * 1000).toISOString(),
          at,
          user.id,
        ),
        env.DB.prepare(
          `UPDATE decave_auth_tokens SET consumed_at=?
          WHERE user_id=? AND purpose='verify_email' AND consumed_at IS NULL AND id<>?
          AND EXISTS(SELECT 1 FROM decave_auth_tokens current WHERE current.id=? AND current.user_id=?)`,
        ).bind(at, user.id, tokenId, tokenId, user.id),
      ]);
      if (Number(results[0]?.meta.changes) !== 1 || Number(results[1]?.meta.changes) !== 1) {
        return json({ error: "Account email or authentication policy changed.", code: "REAUTH_REQUIRED" }, 401);
      }
    }

    // Wrangler can expose an internal request hostname while using remote bindings,
    // so hostname checks are not reliable for identifying our local auth test mode.
    // The official Cloudflare always-pass Turnstile secret is used only in local dev.
    const isLocalDev = env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA";
    const authBaseUrl = authBaseUrlForEnvironment(env);
    const localVerificationUrl = isLocalDev
      ? `${authBaseUrl}/api/auth/verify-email#token=${encodeURIComponent(verifyToken)}`
      : undefined;

    if (user.email && user.email_verified_at && user.email.toLowerCase() !== email.toLowerCase()) {
      try {
        await sendEmailChangeNotice(env, user.email, user.username, email, authBaseUrl);
      } catch (error) {
        console.error("Could not send email change notice", error instanceof Error ? error.name : "UnknownError");
      }
    }

    try {
      await sendVerificationEmail(env, email, user.username, verifyToken, authBaseUrl);
    } catch (error) {
      console.error("Could not send verification email", error instanceof Error ? error.name : "UnknownError");
      return json({ error: "Could not send verification email" }, 503);
    }

    await securityEvent(env, user.id, "email.added_pending_verification", request);
    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
    return json(
      {
        user: privateUser(updated!),
        message: "Verification email sent.",
        ...(localVerificationUrl ? { localVerificationUrl } : {}),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/auth/change-password") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const limited = await env.RECOVERY_RATE_LIMITER.limit({
      key: `change-password:${user.id}`,
    });
    if (!limited.success) {
      return json({ error: "Too many password change attempts. Please try again later." }, 429);
    }

    const body = await bodyJson(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (!currentPassword || !newPassword || !confirmPassword) {
      return json({ error: "Fill in all password fields." }, 400);
    }

    if (newPassword !== confirmPassword) {
      return json({ error: "The new passwords do not match." }, 400);
    }

    if (newPassword === currentPassword) {
      return json({ error: "Your new password must be different from your current password." }, 400);
    }

    if (newPassword.length < 10 || newPassword.length > 128) {
      return json({ error: "Use 10-128 characters for the new password." }, 400);
    }

    const currentMatches = await verifyPassword(currentPassword, user.password_salt, user.password_hash);

    if (!currentMatches) {
      await securityEvent(env, user.id, "password.change_failed_current_password", request);
      return json({ error: "Current password is incorrect." }, 403);
    }

    const { salt, hash } = await hashPassword(newPassword);
    const changedAt = nowIso();

    // decave_sessions has no revoked_at column. Sessions are revoked by
    // deleting them, which is also the mechanism used by logout-all,
    // password reset, single-login enforcement and owner demotion.
    await ensureSessionClientSchema(env);
    await env.DB.batch([
      env.DB.prepare("UPDATE decave_users SET password_salt=?, password_hash=?, must_reset_password=0 WHERE id=?").bind(
        salt,
        hash,
        user.id,
      ),

      env.DB.prepare("DELETE FROM decave_sessions WHERE user_id=?").bind(user.id),

      env.DB.prepare("DELETE FROM decave_session_clients WHERE user_id=?").bind(user.id),

      env.DB.prepare(
        `UPDATE decave_auth_tokens
         SET consumed_at=?
         WHERE user_id=? AND purpose='reset_password' AND consumed_at IS NULL`,
      ).bind(changedAt, user.id),

      env.DB.prepare("DELETE FROM decave_owner_reauth WHERE user_id=?").bind(user.id),

      env.DB.prepare("DELETE FROM decave_owner_login_challenges WHERE user_id=?").bind(user.id),

      env.DB.prepare("DELETE FROM decave_ws_tokens WHERE user_id=?").bind(user.id),
    ]);

    // Disconnect any currently connected browser/desktop client using old
    // WebSocket credentials. The user must sign back in with the new password.
    await revokeAccountSessions(env, user.id, "password_changed");

    await securityEvent(env, user.id, "password.changed_in_settings", request);

    if (user.platform_role === "owner") {
      await platformAudit(env, user.id, "platform.owner_password_changed", request, user.id);
    }

    return json(
      {
        success: true,
        message: "Password changed successfully. Sign in again with your new password.",
      },
      200,
      {
        "Set-Cookie": clearSessionCookie(request),
        "Cache-Control": "no-store, private",
      },
    );
  }

  // "This wasn't me" from a sign-in alert email. GET only shows a page with a
  // button (mail scanners follow links); the POST does the work.
  if (method === "GET" && p === "/api/auth/secure-account") {
    const token = url.searchParams.get("token") ?? "";
    if (token) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `${url.origin}${url.pathname}#token=${encodeURIComponent(token)}`,
          "cache-control": "no-store, private",
          "referrer-policy": "no-referrer",
        },
      });
    }
    return emailActionPage("secure");
  }

  if (method === "POST" && (p === "/api/auth/secure-account" || p === "/api/auth/secure-account-form")) {
    const apiAction = p === "/api/auth/secure-account";
    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: requestKey(request, "secure-account") });
    if (!limited.success) return json({ error: "Too many attempts. Please try again later." }, 429);
    const raw = apiAction
      ? String((await bodyJson(request)).token ?? "")
      : String((await request.formData()).get("token") ?? "");
    const now = nowIso();
    const row =
      raw && raw.length <= 2048
        ? await env.DB.prepare(
            "SELECT token_hash,user_id FROM decave_secure_account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>? LIMIT 1",
          )
            .bind(tokenHash(raw), now)
            .first<{ token_hash: string; user_id: string }>()
        : null;
    const done = (body: string, status = 200) =>
      apiAction
        ? json(
            {
              success: status < 400,
              message: body
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim(),
            },
            status,
            { "Cache-Control": "no-store, private" },
          )
        : new Response(
            `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DeCave account secured</title></head><body style="margin:0;background:#080d18;color:#eef4ff;font-family:Arial;display:grid;place-items:center;min-height:100vh"><div style="width:min(460px,calc(100vw - 40px));background:#10182a;border:1px solid #273653;border-radius:16px;padding:28px;box-sizing:border-box">${body}</div></body></html>`,
            { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
          );
    if (!row)
      return done(`<h1 style="margin-top:0">Link expired</h1><p>This link was already used or is too old.</p>`, 400);
    const spent = await env.DB.prepare(
      "UPDATE decave_secure_account_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
    )
      .bind(now, row.token_hash, now)
      .run();
    if (Number(spent.meta?.changes ?? 0) !== 1)
      return done(`<h1 style="margin-top:0">Already done</h1><p>This link was just used.</p>`, 409);
    const user = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(row.user_id)
      .first<UserRow>();
    if (!user) return done(`<h1 style="margin-top:0">Account not found</h1>`, 404);
    await revokeAccountSessions(env, user.id, "secured_from_alert");
    // Every device has to prove itself again, so the next sign-ins alert too.
    await env.DB.prepare("DELETE FROM decave_known_devices WHERE user_id=?").bind(user.id).run();
    let mailed = false;
    if (user.email && user.email_verified_at) {
      await env.DB.prepare(
        "UPDATE decave_auth_tokens SET consumed_at=? WHERE user_id=? AND purpose='reset_password' AND consumed_at IS NULL",
      )
        .bind(now, user.id)
        .run();
      const resetToken = await createAuthToken(env, user.id, "reset_password", 30 * 60000);
      try {
        await sendResetEmail(env, user.email, user.username, resetToken, authBaseUrlForEnvironment(env));
        mailed = true;
      } catch (error) {
        console.error("Could not send password reset email", error instanceof Error ? error.name : "UnknownError");
      }
    }
    await securityEvent(env, user.id, "account.secured_from_alert", request);
    const message = `Every device has been signed out. ${mailed ? "We emailed you a link to set a new password. It works for 30 minutes." : "Open DeCave and choose Forgot password to set a new one."} After that, turn on two-factor sign-in in Settings > Account & security.`;
    return done(`<h1 style="margin-top:0">Account secured</h1><p>${escapeHtml(message)}</p>`);
  }

  if (method === "POST" && p === "/api/auth/forgot-password") {
    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: requestKey(request, "forgot") });
    if (!limited.success) return json({ success: true });

    const body = await bodyJson(request);
    const email = validateEmail(body.email);
    if (email && (await verifyTurnstile(request, env, body.turnstileToken, "forgot"))) {
      // The account lookup, token writes and email send run after the response
      // so response time does not reveal whether a verified account exists.
      const sendReset = async () => {
        try {
          const user = await env.DB.prepare(
            "SELECT * FROM decave_users WHERE email_normalized=? AND email_verified_at IS NOT NULL LIMIT 1",
          )
            .bind(email)
            .first<UserRow>();
          if (!user) return;
          await env.DB.prepare(
            "UPDATE decave_auth_tokens SET consumed_at=? WHERE user_id=? AND purpose='reset_password' AND consumed_at IS NULL",
          )
            .bind(nowIso(), user.id)
            .run();
          const resetToken = await createAuthToken(env, user.id, "reset_password", 30 * 60000);
          const authBaseUrl = authBaseUrlForEnvironment(env);
          await sendResetEmail(env, email, user.username, resetToken, authBaseUrl);
          await securityEvent(env, user.id, "password.reset_requested", request);
        } catch (error) {
          console.error("Could not send password reset email", error instanceof Error ? error.name : "UnknownError");
        }
      };
      if (ctx) ctx.waitUntil(sendReset());
      else await sendReset();
    }
    return json({ success: true, message: "If that verified email exists, a reset link has been sent." });
  }

  if (method === "GET" && (p === "/api/auth/reset" || p === "/api/auth/reset-password")) {
    const token = url.searchParams.get("token");
    if (token) {
      return new Response(null, {
        status: 302,
        headers: {
          location: `${url.origin}/api/auth/reset-password#token=${encodeURIComponent(token)}`,
          "cache-control": "no-store, private",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (p === "/api/auth/reset") {
      return new Response(null, {
        status: 302,
        headers: { location: `${url.origin}/api/auth/reset-password`, "cache-control": "no-store" },
      });
    }
    return emailActionPage("reset");
  }

  if (method === "POST" && (p === "/api/auth/reset-password" || p === "/api/auth/reset-password-form")) {
    const apiAction = p === "/api/auth/reset-password";
    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: requestKey(request, "reset-password") });
    if (!limited.success) return json({ error: "Too many reset attempts. Please try again later." }, 429);
    const body = apiAction ? await bodyJson(request) : Object.fromEntries(await (await request.formData()).entries());
    const raw = String(body.token ?? "");
    const password = validatePassword(body.password);
    if (!raw || !password) return json({ error: "Invalid reset request" }, 400);

    const row = await env.DB.prepare(
      `SELECT id,user_id FROM decave_auth_tokens
       WHERE token_hash=? AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>?
       LIMIT 1`,
    )
      .bind(tokenHash(raw), nowIso())
      .first<{ id: string; user_id: string }>();
    if (!row) return json({ error: "Reset link is invalid or expired" }, 400);

    const { salt, hash } = await hashPassword(password);
    const claimId = crypto.randomUUID();
    const at = nowIso();
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE decave_auth_tokens SET claim_id=?
         WHERE id=? AND purpose='reset_password' AND consumed_at IS NULL AND claim_id IS NULL AND expires_at>?`,
      ).bind(claimId, row.id, at),
      env.DB.prepare(
        `UPDATE decave_users SET password_salt=?,password_hash=?,must_reset_password=0
         WHERE id=? AND EXISTS(SELECT 1 FROM decave_auth_tokens WHERE id=? AND claim_id=?
           AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>?)`,
      ).bind(salt, hash, row.user_id, row.id, claimId, at),
      env.DB.prepare(
        `UPDATE decave_auth_tokens SET consumed_at=? WHERE changes()=1 AND id=? AND claim_id=?
         AND consumed_at IS NULL AND expires_at>?
         AND EXISTS(SELECT 1 FROM decave_users WHERE id=? AND password_salt=? AND password_hash=?)`,
      ).bind(at, row.id, claimId, at, row.user_id, salt, hash),
      env.DB.prepare(
        `DELETE FROM decave_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM decave_auth_tokens
         WHERE id=? AND claim_id=? AND consumed_at=?)`,
      ).bind(row.user_id, row.id, claimId, at),
      env.DB.prepare(
        `DELETE FROM decave_ws_tokens WHERE user_id=? AND EXISTS(SELECT 1 FROM decave_auth_tokens
         WHERE id=? AND claim_id=? AND consumed_at=?)`,
      ).bind(row.user_id, row.id, claimId, at),
      env.DB.prepare(
        `DELETE FROM decave_owner_reauth WHERE user_id=? AND EXISTS(SELECT 1 FROM decave_auth_tokens
         WHERE id=? AND claim_id=? AND consumed_at=?)`,
      ).bind(row.user_id, row.id, claimId, at),
      env.DB.prepare(
        `DELETE FROM decave_owner_login_challenges WHERE user_id=? AND EXISTS(SELECT 1 FROM decave_auth_tokens
         WHERE id=? AND claim_id=? AND consumed_at=?)`,
      ).bind(row.user_id, row.id, claimId, at),
      env.DB.prepare(
        `UPDATE decave_auth_tokens SET claim_id=NULL WHERE id=? AND claim_id=? AND consumed_at IS NULL`,
      ).bind(row.id, claimId),
    ]);
    if (results.slice(0, 3).some((result) => Number(result.meta?.changes ?? 0) !== 1)) {
      return json({ error: "Reset link is invalid or expired" }, 400);
    }
    await revokeAccountSessions(env, row.user_id, "password_reset");
    await securityEvent(env, row.user_id, "password.reset_completed", request);
    if (apiAction)
      return json({ success: true, message: "Password updated. All previous sessions were signed out." }, 200, {
        "Cache-Control": "no-store, private",
      });
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Password changed</title><body style="background:#080d18;color:#eef4ff;font-family:Arial;padding:40px"><h1>Password updated</h1><p>All previous sessions were signed out.</p><p><a href="/" style="color:#63dfff">Return to DeCave</a></p></body>`,
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, private" } },
    );
  }

  return null;
}
