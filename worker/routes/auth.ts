// Sign-in: registration, email verification, login with a second factor, the
// current session, signing out, signed-in devices, QR sign-in, adding an email,
// changing and resetting passwords.

import { streamerMigrationExists } from "../streamer/index.ts";
import { json, requestKey, bodyJson, authBaseUrlForEnvironment, apiError, apiErrorLegacy } from "../lib/http";
import { streamerHubsEnabled, streamerGiveawaysEnabled } from "../lib/streamer";
import { validateEmail, validateUsername, validatePassword } from "../lib/validation";
import { deriveAgeProfile, saveAgeProfile, safetyProfileForClient, getSafetyProfile } from "../trust-safety";
import { verifyTurnstile } from "../lib/turnstile";
import { acceptsCurrentLegalTerms, PRIVACY_VERSION, TERMS_VERSION } from "../../shared/legal-consent";
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
  currentPasswordThrottle,
  describeSessionDevice,
  sessionDeviceParts,
  describeRequestCountry,
  requestCountryCode,
} from "../lib/sessions";
import { sendVerificationEmail, sendResetEmail, sendEmailChangeNotice } from "../lib/email";
import { linkPageLocale } from "../lib/link-pages";
import { SECURE_ACCOUNT_SCRIPT, secureAccountPromptPage, secureAccountResultPage } from "../lib/secure-account-pages";
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
import { storedLocale, userLocale } from "../lib/i18n";
import { serverNotice } from "../lib/notices";
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

// Transition for released apps up to 0.1.133, which predate the stricter
// sign-up consent and QR approval requests. Remove both flags (and the legacy
// branches they guard) once those apps are no longer in use.
/** Apps up to 0.1.133 show a required Terms/Privacy checkbox but send no
 * versioned consent: 0.1.132 sends nothing, 0.1.133 sends `acceptedTerms: true`. */
const LEGACY_CONSENT_CLIENTS_ALLOWED = true;
/** Recorded instead of a version string for those sign-ups: they never saw a versioned text. */
const LEGACY_CONSENT_VERSION = "legacy-client-checkbox";
/** 0.1.132 mobile apps approve QR sign-ins without `approved` or an MFA code. */
const LEGACY_QR_APPROVAL_CLIENTS_ALLOWED = true;

/** Sign-ins approved by QR are never "stay signed in": same as a password sign-in without it. */
const SHORT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Forgot-password always answers the same, whether or not the account exists. */
const FORGOT_PASSWORD_RESPONSE = {
  success: true,
  ...serverNotice("auth.server.resetLinkSent"),
};

const SELF_DISABLE_REASON = "Self-disabled by account holder";
const SELF_DELETE_REASON = "Self-service account deletion";

/** Holds the account holder placed on their own account, which signing in again lifts. */
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

/** The user as it would look once its self-service holds are lifted (no write). */
function withSelfServiceHoldsLifted(user: UserRow, holds: SelfServiceHolds): UserRow {
  return {
    ...user,
    ...(holds.disabled ? { suspended_at: null, suspended_until: null, suspension_reason: "" } : {}),
    ...(holds.deletion ? { deleted_at: null, delete_after: null, deletion_reason: "" } : {}),
  };
}

/**
 * Lifts self-service holds once sign-in has fully succeeded: the password for
 * password-only accounts, and the second factor too when two-factor sign-in is
 * on. Each hold is cleared only while it still carries the self-service
 * reason, so an admin suspension or deletion applied meanwhile stays.
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
       WHERE id=? AND deleted_at IS NOT NULL AND deletion_reason=? AND delete_after>?`,
    )
      .bind(user.id, SELF_DELETE_REASON, nowIso())
      .run();
  }
  const latest = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1").bind(user.id).first<UserRow>();
  if (!latest) return apiError("auth.accountUnavailable", 403);
  const blocked = accountAccessError(latest);
  if (blocked) {
    await securityEvent(env, user.id, "login.blocked_account_state", request);
    return blocked;
  }
  await securityEvent(env, user.id, "account.self_reactivated_on_login", request);
  return latest;
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
    if (!limited.success) return apiError("auth.tooManyRegistrations", 429);

    const body = await bodyJson(request);
    const email = validateEmail(body.email);
    const username = validateUsername(body.username);
    const password = validatePassword(body.password);
    const ageProfile = deriveAgeProfile(body.birthDate);
    if (!email) return apiError("auth.emailInvalid", 400);
    if (!username) return apiError("common.usernameFormat", 400);
    if (!password) return apiError("auth.passwordLength", 400);
    if (!ageProfile) return apiError("auth.birthDateInvalid", 400);
    if (ageProfile.ageStatus === "ineligible") {
      return apiErrorLegacy("AGE_RESTRICTED", "auth.ageRestricted", 403);
    }
    // Old clients send none of the versioned consent fields (at most the old
    // `acceptedTerms` flag, which must not be false); any versioned field means
    // a current client, which must accept exactly the current versions.
    const legacyConsent =
      LEGACY_CONSENT_CLIENTS_ALLOWED &&
      !("termsAccepted" in body) &&
      !("termsVersion" in body) &&
      !("privacyVersion" in body) &&
      (!("acceptedTerms" in body) || body.acceptedTerms === true);
    if (!legacyConsent && !acceptsCurrentLegalTerms(body)) {
      return apiErrorLegacy("TERMS_NOT_ACCEPTED", "auth.termsNotAccepted", 400);
    }
    if (!(await verifyTurnstile(request, env, body.turnstileToken, "register"))) {
      return apiError("auth.securityCheckFailed", 403);
    }

    try {
      await ensureOfficialHubSchema(env);
    } catch (error) {
      console.error("Could not prepare default Hub membership", error instanceof Error ? error.name : "UnknownError");
      return apiError("auth.setupUnavailable", 503);
    }

    const exists = await env.DB.prepare(
      "SELECT 1 FROM decave_users WHERE username = ? COLLATE NOCASE OR email_normalized = ? LIMIT 1",
    )
      .bind(username, email)
      .first();
    if (exists) return apiError("auth.accountTaken", 409);

    const id = crypto.randomUUID();
    const publicId = createPublicUserId();
    const createdAt = nowIso();
    const { salt, hash } = await hashPassword(password);
    await env.DB.prepare(
      // Privacy by default: a new account shares its game activity with friends only.
      `INSERT INTO decave_users
         (id, public_id, username, password_salt, password_hash, created_at, email, email_normalized, requires_email_verification, activity_visibility,
          terms_accepted_at, terms_version, privacy_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'friends', ?, ?, ?)`,
    )
      .bind(
        id,
        publicId,
        username,
        salt,
        hash,
        createdAt,
        email,
        email,
        createdAt,
        legacyConsent ? LEGACY_CONSENT_VERSION : TERMS_VERSION,
        legacyConsent ? LEGACY_CONSENT_VERSION : PRIVACY_VERSION,
      )
      .run();

    try {
      await saveAgeProfile(env.DB, id, ageProfile, createdAt);
    } catch (error) {
      console.error("Could not prepare account safety profile", error instanceof Error ? error.name : "UnknownError");
      await env.DB.prepare("DELETE FROM decave_users WHERE id = ?").bind(id).run();
      return apiError("auth.setupUnavailable", 503);
    }

    try {
      await joinOfficialHubs(env, id, createdAt);
    } catch (error) {
      console.error("Could not add new account to official Hubs", error instanceof Error ? error.name : "UnknownError");
      await env.DB.prepare("DELETE FROM decave_users WHERE id = ?").bind(id).run();
      return apiError("auth.setupUnavailable", 503);
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
      return json(
        {
          verificationRequired: false,
          ...serverNotice("auth.server.localAccountCreated"),
        },
        201,
      );
    }

    const verifyToken = await createAuthToken(env, id, "verify_email", 24 * 60 * 60 * 1000);
    try {
      const authBaseUrl = authBaseUrlForEnvironment(env);
      await sendVerificationEmail(env, email, username, verifyToken, authBaseUrl, await userLocale(env.DB, id));
    } catch (error) {
      console.error("Could not send verification email", error instanceof Error ? error.name : "UnknownError");
      await env.DB.prepare("DELETE FROM decave_users WHERE id = ?").bind(id).run();
      return apiError("auth.verificationEmailRetry", 503);
    }

    await securityEvent(env, id, "account.registered", request);
    return json(
      {
        verificationRequired: true,
        ...serverNotice("auth.server.accountCreated"),
      },
      201,
    );
  }

  if (method === "GET" && p === "/api/auth/verify-email") {
    // Mail scanners routinely follow links. Move the credential into the URL
    // fragment (which is not sent to this server) and wait for an explicit
    // client POST before consuming it.
    const raw = url.searchParams.get("token") ?? "";
    const verifiedBaseUrl = authBaseUrlForEnvironment(env);
    const fragment = raw && raw.length <= 2048 ? `#token=${encodeURIComponent(raw)}` : "";
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${verifiedBaseUrl}/${fragment}`,
        "Cache-Control": "no-store, private",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  if (method === "POST" && p === "/api/auth/verify-email") {
    const body = await bodyJson(request);
    const raw = typeof body.token === "string" ? body.token : "";
    const tokenDigest = raw.length > 0 && raw.length <= 2048 ? tokenHash(raw) : "";
    const at = nowIso();
    const row = tokenDigest
      ? await env.DB.prepare(
          `SELECT t.id,t.user_id,u.email,u.email_normalized FROM decave_auth_tokens t
           JOIN decave_users u ON u.id=t.user_id
           WHERE t.token_hash=? AND t.purpose='verify_email' AND t.consumed_at IS NULL AND t.expires_at>?
           LIMIT 1`,
        )
          .bind(tokenDigest, at)
          .first<{ id: string; user_id: string; email: string | null; email_normalized: string | null }>()
      : null;

    if (!row) return apiError("auth.verificationLinkInvalid", 400, undefined, { "Cache-Control": "no-store, private" });

    // D1 batches are atomic. Both statements re-check the email and live token
    // at the write boundary, so a racing address change, token replacement or
    // expiry cannot leave a partially verified account.
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE decave_users SET email_verified_at=?,requires_email_verification=0
         WHERE id=? AND email IS ? AND email_normalized IS ?
           AND EXISTS(SELECT 1 FROM decave_auth_tokens WHERE id=? AND user_id=? AND token_hash=?
             AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>?)`,
      ).bind(at, row.user_id, row.email, row.email_normalized, row.id, row.user_id, tokenDigest, at),
      env.DB.prepare(
        `UPDATE decave_auth_tokens SET consumed_at=? WHERE changes()=1
         AND id=? AND user_id=? AND token_hash=? AND purpose='verify_email'
         AND consumed_at IS NULL AND expires_at>?`,
      ).bind(at, row.id, row.user_id, tokenDigest, at),
    ]);
    if (!results.every((result) => Number(result.meta.changes) === 1)) {
      return apiError("auth.verificationLinkInvalid", 400, undefined, { "Cache-Control": "no-store, private" });
    }

    await securityEvent(env, row.user_id, "email.verified", request);
    return json({ success: true }, 200, { "Cache-Control": "no-store, private" });
  }

  if (method === "POST" && p === "/api/auth/login") {
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: requestKey(request, "login") });
    if (!limited.success) return apiError("auth.tooManyLogins", 429);

    const body = await bodyJson(request);
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const staySignedIn = body.staySignedIn === true;
    const sessionClient = normalizeSessionClient(body.client);
    const mobileClient = sessionClient === "mobile";

    if (!(await verifyTurnstile(request, env, body.turnstileToken, "login"))) {
      return apiError("auth.securityCheckFailed", 403);
    }

    const normalized = validateEmail(identifier);
    // A second limiter keyed by the account (a hash of the normalized email,
    // never stored) stops guessing one account's password from many addresses.
    const accountLimit = await env.AUTH_RATE_LIMITER.limit({
      key: `login-account:${tokenHash((normalized ?? identifier.toLowerCase()).slice(0, 320)).slice(0, 32)}`,
    });
    if (!accountLimit.success) return apiError("auth.tooManyLogins", 429);
    let user = await env.DB.prepare(
      `SELECT * FROM decave_users
         WHERE email_normalized = ?
         LIMIT 1`,
    )
      .bind(normalized ?? "")
      .first<UserRow>();

    // Always perform the password KDF, even when the identifier does not exist,
    // to reduce username/email enumeration through response-time differences.
    // The dummy is a current-version hash, so it costs the same as a real one.
    const passwordMatches = await verifyPassword(
      password,
      user?.password_salt ?? DUMMY_PASSWORD_SALT,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordMatches) {
      await securityEvent(env, user?.id ?? null, "login.failed", request);
      return apiError("auth.invalidCredentials", 401);
    }

    if (passwordHashNeedsUpgrade(user.password_hash)) {
      // Rewrite the hash with the current scrypt parameters. The update only
      // applies while the stored hash is still the one just verified.
      const upgraded = await hashPassword(password);
      const result = await env.DB.prepare(
        "UPDATE decave_users SET password_salt=?,password_hash=? WHERE id=? AND password_salt=? AND password_hash=?",
      )
        .bind(upgraded.salt, upgraded.hash, user.id, user.password_salt, user.password_hash)
        .run();
      if (Number(result.meta?.changes ?? 0) === 1) {
        user = { ...user, password_salt: upgraded.salt, password_hash: upgraded.hash };
      }
    }

    // A self-disabled account or a pending self-service deletion is lifted by
    // signing in again, but only once sign-in fully succeeds (after the second
    // factor when two-factor sign-in is on). Here we only check the account
    // would be usable once lifted; any other hold still blocks.
    const holds = selfServiceHolds(user);
    const accountBlocked = accountAccessError(withSelfServiceHoldsLifted(user, holds));
    if (accountBlocked) {
      await securityEvent(env, user.id, "login.blocked_account_state", request);
      return accountBlocked;
    }

    if (user.requires_email_verification === 1 && !user.email_verified_at) {
      return apiError("auth.emailUnverified", 403);
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

    // Password-only account: the password was the full sign-in.
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
      return apiError("auth.mfaChallengeExpired", 401);
    }

    const limited = await env.AUTH_RATE_LIMITER.limit({
      key: `owner-mfa-login:${challenge.user_id}`,
    });
    if (!limited.success) {
      return apiError("auth.tooManyMfaAttempts", 429);
    }

    let user = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(challenge.user_id)
      .first<UserRow>();

    if (!user || user.platform_role !== "owner" || !(await platformOwnerMfaEnabled(env.DB, challenge.user_id))) {
      await env.DB.prepare("DELETE FROM decave_owner_login_challenges WHERE token_hash=?")
        .bind(challenge.token_hash)
        .run();
      return apiError("auth.mfaChallengeInvalid", 401);
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
      return apiError("auth.mfaCodeInvalid", 403);
    }

    // Consume the challenge before issuing credentials.
    const consumedChallenge = await env.DB.prepare(
      "DELETE FROM decave_owner_login_challenges WHERE token_hash=? AND expires_at>? RETURNING token_hash",
    )
      .bind(challenge.token_hash, nowIso())
      .first<{ token_hash: string }>();
    if (!consumedChallenge) return apiError("auth.mfaChallengeUsed", 409);

    // Password and second factor both verified: sign-in is complete.
    const ownerLifted = await liftSelfServiceHolds(env, user, ownerHolds, request);
    if (ownerLifted instanceof Response) return ownerLifted;
    user = ownerLifted;

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
      return apiError("auth.signInCheckExpired", 401);
    }
    const challenge = await env.DB.prepare(
      "SELECT token_hash,user_id,stay_signed_in FROM decave_user_login_challenges WHERE token_hash=? AND expires_at>? LIMIT 1",
    )
      .bind(tokenHash(challengeToken), nowIso())
      .first<{ token_hash: string; user_id: string; stay_signed_in: number }>();
    if (!challenge) return apiError("auth.signInCheckExpired", 401);

    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `user-mfa-login:${challenge.user_id}` });
    if (!limited.success) return apiError("common.tooManyAttempts", 429);

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
      return apiError("auth.signInCheckInvalid", 401);
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
      return apiError("auth.codeInvalidCheckApp", 403);
    }
    const consumedChallenge = await consumeChallenge();
    if (!consumedChallenge) return apiError("auth.signInCheckUsed", 409);

    // Password and second factor (authenticator or recovery code) both verified.
    const userLifted = await liftSelfServiceHolds(env, user, userHolds, request);
    if (userLifted instanceof Response) return userLifted;
    user = userLifted;

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
        locale: storedLocale(user.locale),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "POST" && p === "/api/auth/ws-token") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const sessionToken = rawSessionTokenFromRequest(request);
    if (!sessionToken) return apiError("auth.sessionRequired", 401);
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
          device: sessionDeviceParts(row.device_label),
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
    if (!/^[0-9a-f]{32}$/.test(id)) return apiError("auth.sessionRequiredForLogout", 400);
    // The id is opaque, so resolve it among the caller's own sessions only.
    const ownedRows = await env.DB.prepare("SELECT token_hash FROM decave_sessions WHERE user_id=?")
      .bind(user.id)
      .all<{ token_hash: string }>();
    const owned = ownedRows.results.find((row) => sessionPublicId(row.token_hash) === id);
    if (!owned) return apiError("auth.sessionInactive", 404);
    const raw = rawSessionTokenFromRequest(request);
    const current = Boolean(raw && tokenHash(raw) === owned.token_hash);
    await revokeSession(env, owned.token_hash, "session_revoked");
    await securityEvent(env, user.id, "session.revoked_one", request, `client_session=${id.slice(0, 12)}`);
    return json({ success: true, current }, 200, current ? { "Set-Cookie": clearSessionCookie(request) } : undefined);
  }

  if (method === "POST" && p === "/api/auth/qr/start") {
    await ensureQrLoginSchema(env);
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: requestKey(request, "qr-start") });
    if (!limited.success) return apiError("auth.tooManyQrLogins", 429);
    const body = await bodyJson(request);
    const id = crypto.randomUUID();
    const secret = createRawToken();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    // Shown to the approver before they approve: which app and browser or OS
    // is asking, and the country Cloudflare places it in. No IP is stored.
    const country = requestCountryCode(request);
    const device = describeSessionDevice(request.headers.get("user-agent") ?? "", normalizeSessionClient(body?.client));
    await env.DB.prepare("DELETE FROM decave_qr_login_challenges WHERE expires_at<=? OR claimed_at IS NOT NULL")
      .bind(nowIso())
      .run();
    await env.DB.prepare(
      `INSERT INTO decave_qr_login_challenges
       (id,secret_hash,user_id,expires_at,approved_at,claimed_at,created_at,requester_device,requester_country)
       VALUES(?,?,NULL,?,NULL,NULL,?,?,?)`,
    )
      .bind(id, tokenHash(secret), expiresAt, nowIso(), device, country)
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

  // What the approver sees before approving a QR sign-in.
  if (method === "POST" && p === "/api/auth/qr/preview") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureQrLoginSchema(env);
    const body = await bodyJson(request);
    const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
    const secret = typeof body.secret === "string" ? body.secret : "";
    const challenge = await env.DB.prepare(
      `SELECT id,secret_hash,expires_at,approved_at,claimed_at,requester_device,requester_country
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
      return apiError("auth.qrExpiredOrUsed", 400, undefined, {
        "Cache-Control": "no-store, private",
      });
    }
    const ownerFactor = user.platform_role === "owner" && (await platformOwnerMfaEnabled(env.DB, user.id));
    const mfaRequired = ownerFactor || (await userMfaEnabled(env.DB, user.id));
    return json(
      {
        deviceLabel: (challenge.requester_device || "Unknown device").slice(0, 80),
        device: sessionDeviceParts(challenge.requester_device ?? ""),
        locationLabel: describeRequestCountry(challenge.requester_country ?? "") || "Unknown location",
        locationCountry: describeRequestCountry(challenge.requester_country ?? "") ? challenge.requester_country : null,
        expiresAt: challenge.expires_at,
        mfaRequired,
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
    // Current apps show the requesting device first and send approved:true
    // after an explicit confirm. Older apps approved straight from the scan.
    // Older apps send no `approved` field; they are allowed only while the
    // transition flag is on and only for approvers without MFA (checked below).
    const legacyApproval = LEGACY_QR_APPROVAL_CLIENTS_ALLOWED && !("approved" in body);
    if (body.approved !== true && !legacyApproval) {
      return apiErrorLegacy("QR_APPROVAL_UPDATE_REQUIRED", "auth.qrApprovalUpdateRequired", 400);
    }
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `qr-approve:${user.id}` });
    if (!limited.success) return apiError("auth.tooManyQrApprovals", 429);
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
      return apiError("auth.qrExpiredRefresh", 400);
    if (challenge.approved_at) return apiError("auth.qrAlreadyApproved", 409);
    // Approving signs another device in, so it needs the second factor too.
    const mfaCode = typeof body.mfaCode === "string" ? body.mfaCode : "";
    const ownerFactor = user.platform_role === "owner" && (await platformOwnerMfaEnabled(env.DB, user.id));
    const regularFactor = !ownerFactor && (await userMfaEnabled(env.DB, user.id));
    // An old app cannot send a code, so an MFA account fails closed.
    if (legacyApproval && (ownerFactor || regularFactor)) {
      return apiErrorLegacy("QR_APPROVAL_UPDATE_REQUIRED", "auth.qrApprovalUpdateRequired", 400);
    }
    if (
      (ownerFactor && !(await ownerVerifyMfaOrRecovery(env, user.id, mfaCode))) ||
      (regularFactor && !(await userVerifyMfaOrRecovery(env, user.id, mfaCode)))
    ) {
      await securityEvent(env, user.id, "login.qr_approve_mfa_failed", request);
      return apiErrorLegacy("MFA_REQUIRED", "auth.mfaRequiredToApproveLogin", 403);
    }
    const approved = await env.DB.prepare(
      `UPDATE decave_qr_login_challenges SET user_id=?,approved_at=?
       WHERE id=? AND secret_hash=? AND expires_at>? AND approved_at IS NULL AND claimed_at IS NULL
         AND EXISTS (SELECT 1 FROM decave_sessions WHERE token_hash=? AND user_id=? AND expires_at>?)`,
    )
      .bind(
        user.id,
        nowIso(),
        challengeId,
        tokenHash(secret),
        nowIso(),
        tokenHash(rawSessionTokenFromRequest(request) ?? ""),
        user.id,
        nowIso(),
      )
      .run();
    if (Number(approved.meta?.changes ?? 0) !== 1) {
      return apiError("auth.qrExpiredOrUsed", 409);
    }
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
      return apiError("auth.qrExpired", 410);
    if (!challenge.user_id || !challenge.approved_at)
      return json({ pending: true }, 202, { "Cache-Control": "no-store, private" });
    const user = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(challenge.user_id)
      .first<UserRow>();
    if (!user) return apiError("auth.approverUnavailable", 404);
    const blocked = accountAccessError(user);
    if (blocked) return blocked;
    // One conditional write claims the challenge and stamps a fresh claim id;
    // only the request whose claim id was written goes on to get a session.
    const claimId = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      `UPDATE decave_qr_login_challenges SET claimed_at=?,claim_id=?
       WHERE id=? AND secret_hash=? AND user_id=? AND approved_at IS NOT NULL
         AND claimed_at IS NULL AND claim_id IS NULL AND expires_at>?
       RETURNING claim_id`,
    )
      .bind(nowIso(), claimId, challengeId, tokenHash(secret), user.id, nowIso())
      .first<{ claim_id: string }>();
    if (claimed?.claim_id !== claimId) return apiError("auth.qrAlreadyUsed", 409);
    await replaceSessionClientClass(env, user.id, sessionClient);
    // Short and non-persistent: the cookie below is a session cookie.
    // Revocation may run after claim but before issuance. Check the grant at
    // the session write, not only in an earlier JavaScript read.
    const sessionToken = createRawToken();
    const createdAt = nowIso();
    const issued = await env.DB.prepare(
      `INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at)
       SELECT ?,user_id,?,? FROM decave_qr_login_challenges
       WHERE id=? AND user_id=? AND claim_id=? AND expires_at>?`,
    )
      .bind(
        tokenHash(sessionToken),
        new Date(Date.now() + SHORT_SESSION_TTL_MS).toISOString(),
        createdAt,
        challengeId,
        user.id,
        claimId,
        createdAt,
      )
      .run();
    if (Number(issued.meta?.changes ?? 0) !== 1) {
      return apiError("auth.qrApprovalExpired", 409);
    }
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
  if (method === "POST" && p === "/api/auth/add-email") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const body = await bodyJson(request);
    if (!body) {
      return apiErrorLegacy("INVALID_INPUT", "auth.invalidMutation", 400);
    }
    const email = validateEmail(body.email);
    if (!email) return apiError("auth.emailNotCanonical", 400);
    {
      const password = typeof body.password === "string" ? body.password : "";
      const passwordThrottle = await currentPasswordThrottle(env, user.id);
      if (passwordThrottle) return passwordThrottle;
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "email.add_failed_password", request);
        return apiError("common.currentPasswordIncorrectShort", 403);
      }
    }
    {
      // With two-factor sign-in on (user TOTP or owner MFA), moving the account
      // email also needs a fresh authenticator or recovery code, so a stolen
      // session plus password cannot redirect account recovery. Apps released
      // before this check never send mfaCode; they show this error verbatim.
      const ownerFactor = user.platform_role === "owner" && (await platformOwnerMfaEnabled(env.DB, user.id));
      const regularFactor = !ownerFactor && (await userMfaEnabled(env.DB, user.id));
      if (ownerFactor || regularFactor) {
        const mfaCode = typeof body.mfaCode === "string" ? body.mfaCode.trim() : "";
        if (!mfaCode) {
          return apiErrorLegacy("MFA_REQUIRED", "auth.mfaRequiredToChangeEmail", 403);
        }
        const factor = ownerFactor
          ? await ownerVerifyMfaOrRecovery(env, user.id, mfaCode)
          : await userVerifyMfaOrRecovery(env, user.id, mfaCode);
        if (!factor) {
          await securityEvent(env, user.id, "email.add_failed_mfa", request);
          return apiErrorLegacy("MFA_INVALID", "auth.mfaInvalid", 403);
        }
      }
    }

    let verifyToken: string;
    {
      const exists = await env.DB.prepare("SELECT 1 FROM decave_users WHERE email_normalized=? AND id<>? LIMIT 1")
        .bind(email, user.id)
        .first();
      if (exists) return apiError("auth.emailTaken", 409);
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
        return apiErrorLegacy("REAUTH_REQUIRED", "auth.reauthRequired", 401);
      }
    }

    // Wrangler can expose an internal request hostname while using remote bindings,
    // so hostname checks are not reliable for identifying our local auth test mode.
    // The official Cloudflare always-pass Turnstile secret is used only in local dev.
    const isLocalDev = env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA";
    const authBaseUrl = authBaseUrlForEnvironment(env);
    const localVerificationUrl = isLocalDev ? `${authBaseUrl}/#token=${encodeURIComponent(verifyToken)}` : undefined;

    if (user.email && user.email_verified_at && user.email_normalized !== email) {
      // Tell the previous verified address. No links: the notice cannot undo
      // or confirm anything, so forwarding it is harmless.
      try {
        await sendEmailChangeNotice(env, user.email, user.username, email, await userLocale(env.DB, user.id));
      } catch (error) {
        console.error("Could not send email change notice", error instanceof Error ? error.name : "UnknownError");
      }
    }

    try {
      await sendVerificationEmail(
        env,
        email,
        user.username,
        verifyToken,
        authBaseUrl,
        await userLocale(env.DB, user.id),
      );
    } catch (error) {
      console.error("Could not send verification email", error instanceof Error ? error.name : "UnknownError");
      return apiError("auth.verificationEmailFailed", 503);
    }

    await securityEvent(env, user.id, "email.added_pending_verification", request);
    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
    return json(
      {
        user: privateUser(updated!),
        ...serverNotice("auth.server.verificationEmailSent"),
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
      return apiError("auth.tooManyPasswordChanges", 429);
    }

    const body = await bodyJson(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (!currentPassword || !newPassword || !confirmPassword) {
      return apiError("auth.passwordFieldsMissing", 400);
    }

    if (newPassword !== confirmPassword) {
      return apiError("auth.passwordMismatch", 400);
    }

    if (newPassword === currentPassword) {
      return apiError("auth.passwordUnchanged", 400);
    }

    if (newPassword.length < 10 || newPassword.length > 128) {
      return apiError("auth.newPasswordLength", 400);
    }

    const currentMatches = await verifyPassword(currentPassword, user.password_salt, user.password_hash);

    if (!currentMatches) {
      await securityEvent(env, user.id, "password.change_failed_current_password", request);
      return apiError("common.currentPasswordIncorrect", 403);
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
        ...serverNotice("auth.server.passwordChanged"),
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
    const token = url.searchParams.get("token") ?? ""; // Support links sent before tokens moved to fragments.
    const row =
      token.length > 0 && token.length <= 2048
        ? await env.DB.prepare(
            "SELECT user_id,device_label FROM decave_secure_account_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>? LIMIT 1",
          )
            .bind(tokenHash(token), nowIso())
            .first<{ user_id: string; device_label: string }>()
        : null;
    const locale = await linkPageLocale(env.DB, request, row?.user_id ?? null);
    if (!token) return secureAccountPromptPage(locale, token, { kind: "noToken" });
    if (!row) return secureAccountPromptPage(locale, token, { kind: "expired" });
    return secureAccountPromptPage(locale, token, { kind: "device", deviceLabel: row.device_label });
  }

  if (method === "GET" && p === "/api/auth/secure-account.js") {
    return new Response(SECURE_ACCOUNT_SCRIPT, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store, private",
        "referrer-policy": "no-referrer",
      },
    });
  }

  if (method === "POST" && (p === "/api/auth/secure-account" || p === "/api/auth/secure-account-form")) {
    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: requestKey(request, "secure-account") });
    if (!limited.success) return apiError("auth.tooManyAttemptsLater", 429);
    const submitted = request.headers.get("content-type")?.includes("application/json")
      ? await bodyJson(request)
      : Object.fromEntries(await request.formData());
    const raw = typeof submitted.token === "string" ? submitted.token : "";
    const now = nowIso();
    const browserLocale = () => linkPageLocale(env.DB, request, null);
    if (!raw || raw.length > 2048) return secureAccountResultPage(await browserLocale(), "expired", 400);
    const row = await env.DB.prepare(
      "UPDATE decave_secure_account_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? RETURNING user_id",
    )
      .bind(now, tokenHash(raw), now)
      .first<{ user_id: string }>();
    if (!row) return secureAccountResultPage(await browserLocale(), "expired", 400);
    const user = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
      .bind(row.user_id)
      .first<UserRow>();
    if (!user) return secureAccountResultPage(await browserLocale(), "notFound", 404);
    const locale = await linkPageLocale(env.DB, request, user.id);
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
        await sendResetEmail(
          env,
          user.email,
          user.username,
          resetToken,
          authBaseUrlForEnvironment(env),
          await userLocale(env.DB, user.id),
        );
        mailed = true;
      } catch (error) {
        console.error("Could not send password reset email", error instanceof Error ? error.name : "UnknownError");
      }
    }
    await securityEvent(env, user.id, "account.secured_from_alert", request);
    return secureAccountResultPage(locale, { mailed });
  }

  if (method === "POST" && p === "/api/auth/forgot-password") {
    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: requestKey(request, "forgot") });
    if (!limited.success) return json(FORGOT_PASSWORD_RESPONSE, 200, { "Cache-Control": "no-store, private" });

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
          await sendResetEmail(
            env,
            email,
            user.username,
            resetToken,
            authBaseUrlForEnvironment(env),
            await userLocale(env.DB, user.id),
          );
          await securityEvent(env, user.id, "password.reset_requested", request);
        } catch (error) {
          console.error("Could not send password reset email", error instanceof Error ? error.name : "UnknownError");
        }
      };
      if (ctx) ctx.waitUntil(sendReset());
      else await sendReset();
    }
    return json(FORGOT_PASSWORD_RESPONSE, 200, { "Cache-Control": "no-store, private" });
  }

  if (method === "GET" && p === "/api/auth/reset") {
    const token = url.searchParams.get("token") ?? "";
    const escaped = token.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reset DeCave password</title></head><body style="margin:0;background:#080d18;color:#eef4ff;font-family:Arial;display:grid;place-items:center;min-height:100vh"><form method="post" action="/api/auth/reset-password-form" style="width:min(420px,calc(100vw - 40px));background:#10182a;border:1px solid #273653;border-radius:16px;padding:28px;box-sizing:border-box"><h1 style="margin-top:0">Reset password</h1><input type="hidden" name="token" value="${escaped}"><input name="password" type="password" minlength="10" maxlength="128" required placeholder="New password" style="width:100%;padding:12px;box-sizing:border-box;border-radius:10px;border:1px solid #344663;background:#080d18;color:white"><button style="width:100%;margin-top:14px;padding:12px;border:0;border-radius:10px;background:#6fe4ff;color:#06111b;font-weight:800">Set new password</button></form></body></html>`,
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, private",
          "referrer-policy": "no-referrer",
        },
      },
    );
  }

  // Opening the emailed link (GET) only shows the form; mail scanners that
  // follow links never spend the token. Only the POST below consumes it.
  if (method === "POST" && p === "/api/auth/reset-password-form") {
    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: requestKey(request, "reset-password-form") });
    if (!limited.success) return apiError("auth.tooManyResets", 429);
    const form = await request.formData();
    const raw = String(form.get("token") ?? "");
    const password = validatePassword(form.get("password"));
    if (!raw || raw.length > 2048 || !password) return apiError("auth.resetRequestInvalid", 400);

    // Claim the token in one conditional write before doing anything else, so
    // two submissions of the same link can never both set a password.
    const { salt, hash } = await hashPassword(password);
    const claimId = crypto.randomUUID();
    const at = nowIso();
    const row = await env.DB.prepare(
      `UPDATE decave_auth_tokens SET consumed_at=?,claim_id=?
       WHERE token_hash=? AND purpose='reset_password' AND consumed_at IS NULL AND claim_id IS NULL AND expires_at>?
       RETURNING id,user_id`,
    )
      .bind(at, claimId, tokenHash(raw), at)
      .first<{ id: string; user_id: string }>();
    if (!row) return apiError("auth.resetLinkInvalid", 400);

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE decave_users SET password_salt=?,password_hash=?,must_reset_password=0
         WHERE id=? AND EXISTS(SELECT 1 FROM decave_auth_tokens WHERE id=? AND claim_id=?)`,
      ).bind(salt, hash, row.user_id, row.id, claimId),
      env.DB.prepare("DELETE FROM decave_sessions WHERE user_id=?").bind(row.user_id),
      env.DB.prepare("DELETE FROM decave_ws_tokens WHERE user_id=?").bind(row.user_id),
      env.DB.prepare("DELETE FROM decave_owner_reauth WHERE user_id=?").bind(row.user_id),
      env.DB.prepare("DELETE FROM decave_owner_login_challenges WHERE user_id=?").bind(row.user_id),
    ]);
    await revokeAccountSessions(env, row.user_id, "password_reset");
    await securityEvent(env, row.user_id, "password.reset_completed", request);
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Password changed</title><body style="background:#080d18;color:#eef4ff;font-family:Arial;padding:40px"><h1>Password updated</h1><p>All previous sessions were signed out.</p><p><a href="/" style="color:#63dfff">Return to DeCave</a></p></body>`,
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, private" } },
    );
  }

  return null;
}
