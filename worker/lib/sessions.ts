// Sign-in sessions: cookies, session and WebSocket tokens, security events,
// signed-in devices, suspensions and requireUser.

import type { Env } from "./env";
import { createRawToken, nowIso, tokenHash, type UserRow, rawSessionTokenFromRequest, userFromRequest } from "../db";
import { apiError, apiErrorLegacy, errorFields, json, authBaseUrlForEnvironment } from "./http";
import { accountPreferencesRow } from "./account-preferences";
import { sendSignInAlertEmail } from "./email";
import { userLocale } from "./i18n";
import { realtimeBroadcast } from "./realtime";
import { getSafetyProfile } from "../trust-safety";
import { touchPresenceActivity } from "./activity";
import { ensurePushSchema } from "../push";
import {
  englishSessionDeviceLabel,
  parseSessionDeviceLabel,
  sessionDeviceFromUserAgent,
  type SessionDevice,
} from "../../shared/session-device";

export function sessionCookie(request: Request, token: string, maxAgeSeconds: number | null = 30 * 86400): string {
  const url = new URL(request.url);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "0.0.0.0";

  const persistence = maxAgeSeconds === null ? "" : `; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;

  // Production uses a __Host- cookie, which requires Secure and Path=/.
  // When maxAgeSeconds is null, the cookie is a browser-session cookie and is
  // not intended to survive a full browser/app restart.
  if (isLocal) {
    return `decave_session_local=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${persistence}`;
  }

  return `__Host-decave_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax${persistence}`;
}

export function clearSessionCookie(request: Request): string {
  return sessionCookie(request, "", 0);
}

export async function createSession(env: Env, userId: string, ttlMs: number): Promise<string> {
  const token = createRawToken();
  const createdAt = nowIso();
  await env.DB.prepare("INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(tokenHash(token), userId, new Date(Date.now() + ttlMs).toISOString(), createdAt)
    .run();
  return token;
}

export async function createWsToken(
  env: Env,
  userId: string,
  sessionToken: string,
  ttlMs = 2 * 60 * 1000,
): Promise<string> {
  const sessionHash = tokenHash(sessionToken);
  if (!(await isActiveSession(env, userId, sessionHash)))
    throw new Error("WebSocket credentials require an active session");
  const token = createRawToken();
  const createdAt = nowIso();
  // Tokens live for two minutes and are single-use; drop this user's spent ones
  // so the table never becomes a history of when someone connected.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM decave_ws_tokens WHERE user_id=? AND (used_at IS NOT NULL OR expires_at<=?)").bind(
      userId,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO decave_ws_tokens(token_hash,user_id,session_hash,expires_at,created_at,used_at)
       VALUES(?,?,?,?,?,NULL)`,
    ).bind(tokenHash(token), userId, sessionHash, new Date(Date.now() + ttlMs).toISOString(), createdAt),
  ]);
  return token;
}

export async function isActiveSession(env: Env, userId: string, sessionHash: string): Promise<boolean> {
  if (!userId || !sessionHash) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS active FROM decave_sessions s
     JOIN decave_users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>?
       AND u.erased_at IS NULL AND u.deleted_at IS NULL AND u.must_reset_password=0
       AND u.erasure_started_at IS NULL
       AND (u.suspended_at IS NULL OR (u.suspended_until IS NOT NULL AND u.suspended_until<=?))
     LIMIT 1`,
  )
    .bind(sessionHash, userId, nowIso(), nowIso())
    .first<{ active: number }>();
  return Boolean(row?.active);
}

export async function consumeSessionBoundWsToken(
  env: Env,
  rawToken: string,
): Promise<{ user: UserRow; sessionHash: string } | null> {
  if (!rawToken || rawToken.length > 256) return null;
  const now = nowIso();
  const claimed = await env.DB.prepare(
    `UPDATE decave_ws_tokens
     SET used_at=?
     WHERE token_hash=? AND used_at IS NULL AND expires_at>?
       AND session_hash IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM decave_sessions s
         WHERE s.token_hash=decave_ws_tokens.session_hash
           AND s.user_id=decave_ws_tokens.user_id AND s.expires_at>?
           AND EXISTS (
             SELECT 1 FROM decave_users u WHERE u.id=s.user_id
               AND u.erased_at IS NULL AND u.deleted_at IS NULL AND u.must_reset_password=0
               AND u.erasure_started_at IS NULL
               AND (u.suspended_at IS NULL OR (u.suspended_until IS NOT NULL AND u.suspended_until<=?))
           )
       )
     RETURNING user_id,session_hash`,
  )
    .bind(now, tokenHash(rawToken), now, now, now)
    .first<{ user_id: string; session_hash: string }>();
  if (!claimed?.user_id || !claimed.session_hash) return null;
  const user = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
    .bind(claimed.user_id)
    .first<UserRow>();
  if (!user || accountAccessError(user)) return null;
  return { user, sessionHash: claimed.session_hash };
}

/** Revoke one browser/app session without affecting any other device. */
export async function revokeSession(env: Env, sessionHash: string, reason: string): Promise<void> {
  if (!sessionHash) return;
  await ensureSessionClientSchema(env);
  await ensurePushSchema(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM decave_sessions WHERE token_hash=?").bind(sessionHash),
    env.DB.prepare("DELETE FROM decave_session_clients WHERE token_hash=?").bind(sessionHash),
    env.DB.prepare("DELETE FROM decave_ws_tokens WHERE session_hash=?").bind(sessionHash),
    env.DB.prepare("DELETE FROM decave_push_tokens WHERE session_hash=?").bind(sessionHash),
  ]);
  await realtimeBroadcast(env, { type: "SESSION_REVOKED", reason }, { sessionHashes: [sessionHash] });
}

export async function createAuthToken(
  env: Env,
  userId: string,
  purpose: "verify_email" | "reset_password",
  ttlMs: number,
): Promise<string> {
  const raw = createRawToken();
  await env.DB.prepare(
    `INSERT INTO decave_auth_tokens
     (id,user_id,purpose,token_hash,expires_at,created_at)
     VALUES(?,?,?,?,?,?)`,
  )
    .bind(crypto.randomUUID(), userId, purpose, tokenHash(raw), new Date(Date.now() + ttlMs).toISOString(), nowIso())
    .run();
  return raw;
}

// Security events keep the browser user agent so people can recognise their
// own sign-ins, but never the IP address. Pass request=null when someone else
// (an admin) acts on the account, so their client details are not filed under
// the affected user.
export async function securityEvent(
  env: Env,
  userId: string | null,
  event: string,
  request: Request | null,
  detail = "",
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO decave_security_events
     (id,user_id,event,ip_hash,user_agent,detail,created_at)
     VALUES(?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      event,
      "",
      (request?.headers.get("user-agent") ?? "").slice(0, 240),
      detail.slice(0, 500),
      nowIso(),
    )
    .run();
}

/**
 * Throttles current-password checks before sensitive account changes. The key
 * is the account, not the IP, so guesses made with a stolen session from many
 * addresses share one budget. Returns a 429 response when over the limit.
 */
export async function currentPasswordThrottle(env: Env, userId: string): Promise<Response | null> {
  const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: `current-password:${userId}` });
  return limited.success ? null : apiError("session.passwordAttempts", 429);
}

export function activeSuspension(user: UserRow): boolean {
  if (!user.suspended_at) return false;
  if (!user.suspended_until) return true;
  return user.suspended_until > nowIso();
}

export function accountAccessError(user: UserRow): Response | null {
  if ((user as UserRow & { erasure_started_at?: string | null }).erasure_started_at) {
    return apiError("session.accountErasing", 403);
  }
  if (user.erased_at) {
    return apiError("session.accountUnavailable", 403);
  }
  if (user.deleted_at) {
    return apiError("session.accountScheduledForDeletion", 403);
  }
  if (activeSuspension(user)) {
    return user.suspended_until
      ? apiError("session.accountSuspendedUntil", 403, { until: user.suspended_until })
      : apiError("session.accountSuspended", 403);
  }
  if (user.must_reset_password === 1) {
    return json({ ...errorFields("session.passwordResetRequired"), passwordResetRequired: true }, 403);
  }
  return null;
}

export type SessionClient = "mobile" | "web" | "desktop";

export let sessionClientSchemaReady: Promise<void> | null = null;

export function normalizeSessionClient(value: unknown): SessionClient {
  return value === "mobile" || value === "desktop" ? value : "web";
}

export async function ensureSessionClientSchema(env: Env): Promise<void> {
  if (sessionClientSchemaReady) return sessionClientSchemaReady;
  sessionClientSchemaReady = env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_session_clients (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,client TEXT NOT NULL,device_label TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL)`,
    ),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_decave_session_clients_user ON decave_session_clients(user_id)`),
  ])
    .then(() => undefined)
    .catch((error) => {
      sessionClientSchemaReady = null;
      throw error;
    });
  return sessionClientSchemaReady;
}

export let qrLoginSchemaReady: Promise<void> | null = null;

// Keep this the original table shape. Migration 0073 adds the requester and
// claim columns with ALTER TABLE; D1 has no ADD COLUMN IF NOT EXISTS, so a
// lazily created table that already had them would make that migration fail.
export function ensureQrLoginSchema(env: Env): Promise<void> {
  if (qrLoginSchemaReady) return qrLoginSchemaReady;
  qrLoginSchemaReady = env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS decave_qr_login_challenges (
    id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    user_id TEXT,
    expires_at TEXT NOT NULL,
    approved_at TEXT,
    claimed_at TEXT,
    created_at TEXT NOT NULL
  )`,
  )
    .run()
    .then(() => undefined)
    .catch((error) => {
      qrLoginSchemaReady = null;
      throw error;
    });
  return qrLoginSchemaReady;
}

export async function replaceSessionClientClass(env: Env, userId: string, client: SessionClient): Promise<void> {
  await ensureSessionClientSchema(env);
  const rows = await env.DB.prepare(
    `SELECT s.token_hash,COALESCE(m.client,'legacy') AS client FROM decave_sessions s LEFT JOIN decave_session_clients m ON m.token_hash=s.token_hash WHERE s.user_id=?`,
  )
    .bind(userId)
    .all<{ token_hash: string; client: string }>();
  const hashes = rows.results
    .filter(
      (row) =>
        row.client === "legacy" ||
        (client === "mobile" ? row.client === "mobile" : row.client === "web" || row.client === "desktop"),
    )
    .map((row) => row.token_hash);
  if (!hashes.length) return;
  await env.DB.batch(
    hashes.flatMap((hash) => [
      env.DB.prepare("DELETE FROM decave_sessions WHERE token_hash=?").bind(hash),
      env.DB.prepare("DELETE FROM decave_session_clients WHERE token_hash=?").bind(hash),
    ]),
  );
}

/** "Chrome on Windows · Greece": readable English name for the Active sessions list. */
export function describeSessionDevice(userAgent: string, client: SessionClient, country = ""): string {
  return englishSessionDeviceLabel(sessionDeviceFromUserAgent(userAgent, client, country));
}

/**
 * The parts of a stored device label, sent next to it so clients can show the
 * name in their own language. Null when the label is not one the Worker wrote.
 */
export function sessionDeviceParts(label: string): SessionDevice | null {
  return parseSessionDeviceLabel(label);
}

/** The two-letter country Cloudflare places the request in, or "" when unknown. No IP is read. */
export function requestCountryCode(request: Request): string {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  const country = typeof cf?.country === "string" ? cf.country : (request.headers.get("CF-IPCountry") ?? "");
  return /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : "";
}

/** English name for a two-letter country code, or "" when it is not a real country. */
export function describeRequestCountry(country: string): string {
  if (!/^[A-Z]{2}$/.test(country) || country === "XX" || country === "T1") return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? "";
  } catch {
    return "";
  }
}

export async function recordSessionClient(
  env: Env,
  rawToken: string,
  userId: string,
  client: SessionClient,
  request?: Request,
): Promise<void> {
  await ensureSessionClientSchema(env);
  const label = request
    ? describeSessionDevice(request.headers.get("user-agent") ?? "", client, request.headers.get("CF-IPCountry") ?? "")
    : client === "mobile"
      ? "Mobile app"
      : client === "desktop"
        ? "Desktop app"
        : "Web browser";
  await env.DB.prepare(
    `INSERT OR REPLACE INTO decave_session_clients(token_hash,user_id,client,device_label,created_at) VALUES(?,?,?,?,?)`,
  )
    .bind(tokenHash(rawToken), userId, client, label, nowIso())
    .run();
  try {
    await env.DB.prepare("UPDATE decave_session_clients SET last_seen_at=? WHERE token_hash=?")
      .bind(nowIso(), tokenHash(rawToken))
      .run();
  } catch {
    /* before migration 0061 */
  }
}

// DECAVE_PARITY_SESSION_SCHEMA

// Settings → Account → Where you're signed in shows when each device was last
// used. Written at most every 5 minutes per session (per isolate first, then
// in SQL) so ordinary API traffic doesn't turn into a stream of writes.
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60_000;

export const sessionTouchCache = new Map<string, number>();

export async function touchSessionActivity(env: Env, request: Request): Promise<void> {
  const raw = rawSessionTokenFromRequest(request);
  if (!raw) return;
  const hash = tokenHash(raw);
  const now = Date.now();
  if ((sessionTouchCache.get(hash) ?? 0) > now - SESSION_TOUCH_INTERVAL_MS) return;
  if (sessionTouchCache.size > 5000) sessionTouchCache.clear();
  sessionTouchCache.set(hash, now);
  try {
    await env.DB.prepare(
      "UPDATE decave_session_clients SET last_seen_at=? WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<?)",
    )
      .bind(new Date(now).toISOString(), hash, new Date(now - SESSION_TOUCH_INTERVAL_MS).toISOString())
      .run();
  } catch {
    /* before migration 0061 */
  }
}

/**
 * Remember where an account signs in from and email the owner when a new
 * device, app or country appears (Settings → Account → Sign-in alerts). The
 * very first device of an account never alerts. Never blocks the sign-in.
 */
export async function noteSignInDevice(
  env: Env,
  request: Request,
  user: UserRow,
  client: SessionClient,
): Promise<void> {
  try {
    const label = describeSessionDevice(
      request.headers.get("user-agent") ?? "",
      client,
      request.headers.get("CF-IPCountry") ?? "",
    );
    const fingerprint = tokenHash(`device-v1|${label}`);
    const now = nowIso();
    const known = await env.DB.prepare("SELECT 1 FROM decave_known_devices WHERE user_id=? AND fingerprint=?")
      .bind(user.id, fingerprint)
      .first();
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM decave_known_devices WHERE user_id=?")
      .bind(user.id)
      .first<{ count: number }>();
    // Only the fingerprint is needed to recognise a device; the readable label
    // is not kept. last_seen_at lets unused devices expire (see retention.ts).
    await env.DB.prepare(
      `INSERT INTO decave_known_devices(user_id,fingerprint,label,first_seen_at,last_seen_at) VALUES(?,?,'',?,?)
       ON CONFLICT(user_id,fingerprint) DO UPDATE SET last_seen_at=excluded.last_seen_at, label=''`,
    )
      .bind(user.id, fingerprint, now, now)
      .run();
    if (known || Number(count?.count ?? 0) === 0) return;
    const preferences = await accountPreferencesRow(env, user.id);
    if (preferences.login_alerts === 0 || !user.email || !user.email_verified_at) return;
    const raw = createRawToken();
    await env.DB.prepare(
      "INSERT INTO decave_secure_account_tokens(token_hash,user_id,device_label,created_at,expires_at,used_at) VALUES(?,?,?,?,?,NULL)",
    )
      .bind(tokenHash(raw), user.id, label, now, new Date(Date.now() + 7 * 86400000).toISOString())
      .run();
    await sendSignInAlertEmail(
      env,
      user.email,
      user.username,
      label,
      now,
      raw,
      authBaseUrlForEnvironment(env),
      await userLocale(env.DB, user.id),
    );
    await securityEvent(env, user.id, "login.new_device_alert_sent", request, label);
  } catch (error) {
    console.error("Could not record sign-in device", error instanceof Error ? error.name : "UnknownError");
  }
}

export async function revokeAccountSessions(env: Env, userId: string, reason: string): Promise<void> {
  await ensureSessionClientSchema(env);
  await ensurePushSchema(env.DB);
  await ensureQrLoginSchema(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM decave_qr_login_challenges WHERE user_id=?").bind(userId),
    env.DB.prepare("DELETE FROM decave_user_login_challenges WHERE user_id=?").bind(userId),
    env.DB.prepare("DELETE FROM decave_sessions WHERE user_id=?").bind(userId),
    env.DB.prepare("DELETE FROM decave_session_clients WHERE user_id=?").bind(userId),
    env.DB.prepare("DELETE FROM decave_owner_reauth WHERE user_id=?").bind(userId),
    env.DB.prepare("DELETE FROM decave_owner_login_challenges WHERE user_id=?").bind(userId),
    env.DB.prepare("DELETE FROM decave_ws_tokens WHERE user_id=?").bind(userId),
    env.DB.prepare("DELETE FROM decave_push_tokens WHERE user_id=?").bind(userId),
  ]);

  await realtimeBroadcast(env, { type: "SESSION_REVOKED", reason }, { userIds: [userId] });
}

export async function requireUser(request: Request, env: Env): Promise<UserRow | Response> {
  const user = await userFromRequest(env.DB, request);
  if (!user) return apiError("session.authRequired", 401);

  const blocked = accountAccessError(user);
  if (blocked) return blocked;

  // Age eligibility is account-level policy, not a client hint. Existing
  // accounts are backfilled as unconfirmed and remain usable until they
  // complete the age gate; an explicitly ineligible account is blocked here.
  try {
    const safetyProfile = await getSafetyProfile(env.DB, user.id);
    if (safetyProfile?.age_status === "ineligible") {
      return apiErrorLegacy("AGE_RESTRICTED", "session.ageIneligible", 403);
    }
  } catch (error) {
    console.error("Could not read account safety profile", error instanceof Error ? error.name : "UnknownError");
    return apiErrorLegacy("SAFETY_POLICY_UNAVAILABLE", "session.safetyPolicyUnavailable", 503);
  }

  await touchPresenceActivity(env, user.id);
  await touchSessionActivity(env, request);

  return user;
}
