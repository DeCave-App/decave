// Second-factor sign-in: TOTP secrets (encrypted at rest), recovery codes,
// login challenges and owner re-authentication.

import type { Env } from "./env";
import { createRawToken, nowIso, tokenHash } from "../db";
import { json } from "./http";

export const OWNER_MFA_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function ownerBytesToBase32(bytes: Uint8Array): string {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += OWNER_MFA_BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += OWNER_MFA_BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function ownerBase32ToBytes(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = OWNER_MFA_BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function ownerOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function ownerRandomMfaSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return ownerBytesToBase32(bytes);
}

export async function ownerTotpAt(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ownerOwnedArrayBuffer(ownerBase32ToBytes(secret)),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = new ArrayBuffer(8);
  const view = new DataView(counter);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

export async function ownerMatchingTotpStep(secret: string, code: string, nowMs = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(nowMs / 30000);
  let matched: number | null = null;
  for (const delta of [-1, 0, 1]) {
    const candidate = step + delta;
    if (candidate >= 0 && (await ownerTotpAt(secret, candidate)) === code) matched = candidate;
  }
  return matched;
}

export async function ownerVerifyTotp(secret: string, code: string): Promise<boolean> {
  return (await ownerMatchingTotpStep(secret, code)) !== null;
}

export function ownerB64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function ownerFromB64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function ownerMfaEncryptionKey(env: Env): Promise<CryptoKey> {
  if (!env.OWNER_MFA_ENCRYPTION_KEY) throw new Error("OWNER_MFA_ENCRYPTION_KEY is not configured");
  const raw = ownerFromB64(env.OWNER_MFA_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("OWNER_MFA_ENCRYPTION_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", ownerOwnedArrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function ownerEncryptMfa(env: Env, secret: string): Promise<string> {
  const key = await ownerMfaEncryptionKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ownerOwnedArrayBuffer(iv) },
      key,
      ownerOwnedArrayBuffer(new TextEncoder().encode(secret)),
    ),
  );
  return `${ownerB64(iv)}.${ownerB64(encrypted)}`;
}

export async function ownerDecryptMfa(env: Env, value: string): Promise<string> {
  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) throw new Error("Invalid owner MFA secret");
  const key = await ownerMfaEncryptionKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownerOwnedArrayBuffer(ownerFromB64(ivPart)) },
    key,
    ownerOwnedArrayBuffer(ownerFromB64(cipherPart)),
  );
  return new TextDecoder().decode(plain);
}

export async function platformOwnerMfaEnabled(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT enabled_at FROM decave_owner_mfa WHERE user_id=? LIMIT 1")
    .bind(userId)
    .first<{ enabled_at: string | null }>();
  return Boolean(row?.enabled_at);
}

export function ownerRecoveryCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const value = ownerBytesToBase32(bytes).slice(0, 16);
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
}

export async function ownerCreateLoginChallenge(env: Env, userId: string, staySignedIn: boolean): Promise<string> {
  const raw = createRawToken();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Keep only the newest outstanding challenge for this owner.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM decave_owner_login_challenges WHERE user_id=? OR expires_at<=?").bind(
      userId,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO decave_owner_login_challenges
       (token_hash,user_id,stay_signed_in,expires_at,created_at)
       VALUES(?,?,?,?,?)`,
    ).bind(tokenHash(raw), userId, staySignedIn ? 1 : 0, expiresAt, createdAt),
  ]);

  return raw;
}

export async function ownerLoginChallenge(
  env: Env,
  raw: string,
): Promise<{
  token_hash: string;
  user_id: string;
  stay_signed_in: number;
  expires_at: string;
} | null> {
  if (!raw || raw.length > 2048) return null;
  return (
    (await env.DB.prepare(
      `SELECT token_hash,user_id,stay_signed_in,expires_at
       FROM decave_owner_login_challenges
       WHERE token_hash=? AND expires_at>?
       LIMIT 1`,
    )
      .bind(tokenHash(raw), nowIso())
      .first<{
        token_hash: string;
        user_id: string;
        stay_signed_in: number;
        expires_at: string;
      }>()) ?? null
  );
}

export async function ownerCreateReauth(env: Env, userId: string): Promise<string> {
  const raw = createRawToken();
  await env.DB.prepare("INSERT INTO decave_owner_reauth(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(tokenHash(raw), userId, new Date(Date.now() + 10 * 60 * 1000).toISOString(), nowIso())
    .run();
  return raw;
}

export async function ownerRequireReauth(request: Request, env: Env, userId: string): Promise<Response | null> {
  const raw = request.headers.get("X-DeCave-Owner-Reauth") ?? "";
  if (!raw) return json({ error: "Recent owner re-authentication required" }, 428);
  const row = await env.DB.prepare(
    "SELECT token_hash FROM decave_owner_reauth WHERE token_hash=? AND user_id=? AND expires_at>? LIMIT 1",
  )
    .bind(tokenHash(raw), userId, nowIso())
    .first();
  return row ? null : json({ error: "Owner re-authentication expired or invalid" }, 428);
}

export async function ownerVerifyMfaOrRecovery(
  env: Env,
  userId: string,
  rawCode: unknown,
): Promise<"totp" | "recovery" | null> {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  const row = await env.DB.prepare(
    "SELECT secret_ciphertext,enabled_at,last_totp_step FROM decave_owner_mfa WHERE user_id=? LIMIT 1",
  )
    .bind(userId)
    .first<{ secret_ciphertext: string; enabled_at: string | null; last_totp_step: number | null }>();
  if (!row?.enabled_at) return null;

  if (/^\d{6}$/.test(code)) {
    const secret = await ownerDecryptMfa(env, row.secret_ciphertext);
    const step = await ownerMatchingTotpStep(secret, code);
    if (step === null || (row.last_totp_step !== null && step <= row.last_totp_step)) return null;
    const accepted = await env.DB.prepare(
      `UPDATE decave_owner_mfa SET last_totp_step=?
       WHERE user_id=? AND secret_ciphertext=? AND enabled_at IS NOT NULL
         AND (last_totp_step IS NULL OR last_totp_step<?)`,
    )
      .bind(step, userId, row.secret_ciphertext, step)
      .run();
    return Number(accepted.meta?.changes ?? 0) === 1 ? "totp" : null;
  }

  if (!/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code)) return null;
  // Spend the matching code in one compare-and-set statement. Two concurrent
  // login or re-auth requests cannot both accept the same recovery code.
  const spent = await env.DB.prepare(
    `UPDATE decave_owner_recovery_codes SET used_at=?
     WHERE id=(SELECT id FROM decave_owner_recovery_codes
       WHERE user_id=? AND code_hash=? AND used_at IS NULL LIMIT 1)
       AND used_at IS NULL`,
  )
    .bind(nowIso(), userId, tokenHash(code))
    .run();
  return Number(spent.meta?.changes ?? 0) === 1 ? "recovery" : null;
}

// Optional two-factor sign-in for every account. Reuses the owner TOTP and
// secret-encryption primitives but keeps its own tables, so the owner MFA
// policy (mandatory, reset on demotion) is not affected.
export async function userMfaEnabled(db: D1Database, userId: string): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT enabled_at FROM decave_user_mfa WHERE user_id=? LIMIT 1")
      .bind(userId)
      .first<{ enabled_at: string | null }>();
    return Boolean(row?.enabled_at);
  } catch (error) {
    // Before migration 0060 runs nobody can have 2FA, so sign-in must keep
    // working. Any other database error fails closed (sign-in errors out).
    if (/no such table/i.test(String(error))) return false;
    throw error;
  }
}

export async function userVerifyMfaOrRecovery(
  env: Env,
  userId: string,
  rawCode: unknown,
): Promise<"totp" | "recovery" | null> {
  const code = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "").toUpperCase() : "";
  const row = await env.DB.prepare(
    "SELECT secret_ciphertext,enabled_at,last_totp_step FROM decave_user_mfa WHERE user_id=? LIMIT 1",
  )
    .bind(userId)
    .first<{ secret_ciphertext: string; enabled_at: string | null; last_totp_step: number | null }>();
  if (!row?.enabled_at) return null;
  if (/^\d{6}$/.test(code)) {
    const secret = await ownerDecryptMfa(env, row.secret_ciphertext);
    const step = await ownerMatchingTotpStep(secret, code);
    if (step === null || (row.last_totp_step !== null && step <= row.last_totp_step)) return null;
    const accepted = await env.DB.prepare(
      `UPDATE decave_user_mfa SET last_totp_step=?
       WHERE user_id=? AND secret_ciphertext=? AND enabled_at IS NOT NULL
         AND (last_totp_step IS NULL OR last_totp_step<?)`,
    )
      .bind(step, userId, row.secret_ciphertext, step)
      .run();
    return Number(accepted.meta?.changes ?? 0) === 1 ? "totp" : null;
  }
  if (!/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code)) return null;
  // Single statement so a recovery code can only be spent once, even when two
  // sign-ins race with the same code.
  const spent = await env.DB.prepare(
    `UPDATE decave_user_recovery_codes SET used_at=?
     WHERE id=(SELECT id FROM decave_user_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL LIMIT 1)`,
  )
    .bind(nowIso(), userId, tokenHash(code))
    .run();
  return Number(spent.meta?.changes ?? 0) === 1 ? "recovery" : null;
}

export async function userRecoveryCodesRemaining(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM decave_user_recovery_codes WHERE user_id=? AND used_at IS NULL")
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export function userRecoveryCodeStatements(
  env: Env,
  userId: string,
  codes: string[],
  now: string,
): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM decave_user_recovery_codes WHERE user_id=?").bind(userId),
    ...codes.map((value) =>
      env.DB.prepare(
        "INSERT INTO decave_user_recovery_codes(id,user_id,code_hash,used_at,created_at) VALUES(?,?,?,NULL,?)",
      ).bind(crypto.randomUUID(), userId, tokenHash(value), now),
    ),
  ];
}

export async function userCreateLoginChallenge(env: Env, userId: string, staySignedIn: boolean): Promise<string> {
  const raw = createRawToken();
  const createdAt = nowIso();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM decave_user_login_challenges WHERE user_id=? OR expires_at<=?").bind(userId, createdAt),
    env.DB.prepare(
      "INSERT INTO decave_user_login_challenges(token_hash,user_id,stay_signed_in,expires_at,created_at) VALUES(?,?,?,?,?)",
    ).bind(tokenHash(raw), userId, staySignedIn ? 1 : 0, new Date(Date.now() + 5 * 60 * 1000).toISOString(), createdAt),
  ]);
  return raw;
}
