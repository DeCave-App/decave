import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { test, after } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { tokenHash } = await import("../../worker/db.ts");
const { ownerEncryptMfa, ownerTotpAt, ownerVerifyMfaOrRecovery, userVerifyMfaOrRecovery } =
  await import("../../worker/lib/mfa.ts");
const { TERMS_VERSION, PRIVACY_VERSION } = await import("../../shared/legal-consent.ts");
const { handleApi } = await import("../../worker/index.ts");

const db = new D1Mock();
const limiterKeys = [];
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: {
    limit: async ({ key }) => {
      limiterKeys.push(key);
      return { success: true };
    },
  },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  OWNER_MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ success: true, count: 0, userIds: [] }) }),
  },
};
after(() => db.sqlite.close());
const now = new Date().toISOString();

function registerAccount(body) {
  return handleApi(
    new Request("https://test.invalid/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

function seedUser(id, { email = `${id}@example.test`, role = "user" } = {}) {
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,
      email_verified_at,requires_email_verification,platform_role,status,must_reset_password)
     VALUES(?,?,?,?,?,?,?,?,?,0,?,'online',0)`,
    id,
    `user-${id}`,
    "fixture-salt",
    "00".repeat(64),
    now,
    `DC-${id
      .replace(/[^a-z0-9]/gi, "")
      .padEnd(16, "0")
      .slice(0, 16)}`,
    email,
    email.toLowerCase(),
    now,
    role,
  );
}

test("user and owner MFA consume a TOTP timestep once and keep recovery codes usable", async () => {
  seedUser("mfa-user");
  seedUser("mfa-owner", { role: "owner" });
  const secret = "JBSWY3DPEHPK3PXP";
  const encrypted = await ownerEncryptMfa(env, secret);
  for (const [table, userId] of [
    ["decave_user_mfa", "mfa-user"],
    ["decave_owner_mfa", "mfa-owner"],
  ]) {
    db.exec(
      `INSERT INTO ${table}(user_id,secret_ciphertext,enabled_at,created_at,updated_at) VALUES(?,?,?, ?,?)`,
      userId,
      encrypted,
      now,
      now,
      now,
    );
  }
  const code = await ownerTotpAt(secret, Math.floor(Date.now() / 30_000));

  for (const [verify, userId, recoveryTable] of [
    [userVerifyMfaOrRecovery, "mfa-user", "decave_user_recovery_codes"],
    [ownerVerifyMfaOrRecovery, "mfa-owner", "decave_owner_recovery_codes"],
  ]) {
    const concurrent = await Promise.all([verify(env, userId, code), verify(env, userId, code)]);
    assert.equal(concurrent.filter((result) => result === "totp").length, 1);
    assert.equal(concurrent.filter((result) => result === null).length, 1);
    assert.equal(await verify(env, userId, code), null, "the accepted timestep cannot be replayed");

    const recovery = "ABCD-EFGH-IJKL-MNOP";
    db.exec(
      `INSERT INTO ${recoveryTable}(id,user_id,code_hash,used_at,created_at) VALUES(?,?,?,?,?)`,
      `recovery-${userId}`,
      userId,
      tokenHash(recovery),
      null,
      now,
    );
    assert.equal(await verify(env, userId, recovery), "recovery");
    assert.equal(await verify(env, userId, recovery), null, "a recovery code remains one-use");
  }
});

test("an older TOTP timestep is rejected after a newer one was accepted", async () => {
  seedUser("mfa-step");
  const secret = "JBSWY3DPEHPK3PXP";
  db.exec(
    `INSERT INTO decave_user_mfa(user_id,secret_ciphertext,enabled_at,created_at,updated_at) VALUES(?,?,?,?,?)`,
    "mfa-step",
    await ownerEncryptMfa(env, secret),
    now,
    now,
    now,
  );
  const step = Math.floor(Date.now() / 30_000);
  assert.equal(await userVerifyMfaOrRecovery(env, "mfa-step", await ownerTotpAt(secret, step + 1)), "totp");
  assert.equal(db.scalar("SELECT last_totp_step FROM decave_user_mfa WHERE user_id='mfa-step'"), step + 1);
  assert.equal(await userVerifyMfaOrRecovery(env, "mfa-step", await ownerTotpAt(secret, step)), null);
});

test("sign-up requires accepting the current Terms and Privacy versions and records them", async () => {
  const base = {
    email: "new@example.test",
    username: "new-user",
    password: "correct horse battery staple",
    birthDate: "1990-01-01",
    turnstileToken: "test",
  };
  const countNew = () => db.scalar("SELECT COUNT(*) FROM decave_users WHERE email_normalized='new@example.test'");
  for (const consent of [
    { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
    { termsAccepted: true },
    { termsAccepted: false, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
    { termsAccepted: true, termsVersion: "2000-01-01", privacyVersion: PRIVACY_VERSION },
    { termsAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: "2000-01-01" },
  ]) {
    const response = await registerAccount({ ...base, ...consent });
    assert.equal(response.status, 400, JSON.stringify(consent));
    assert.equal((await response.json()).code, "TERMS_NOT_ACCEPTED");
    assert.equal(countNew(), 0);
  }

  const accepted = await registerAccount({
    ...base,
    termsAccepted: true,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
  });
  assert.equal(accepted.status, 201);
  const row = db.sqlite
    .prepare("SELECT terms_accepted_at,terms_version,privacy_version FROM decave_users WHERE email_normalized=?")
    .get("new@example.test");
  assert.equal(row.terms_version, TERMS_VERSION);
  assert.equal(row.privacy_version, PRIVACY_VERSION);
  assert.ok(row.terms_accepted_at);
});

test("sign-up from a 0.1.132 client with no consent fields is recorded with a legacy marker", async () => {
  const response = await registerAccount({
    email: "legacy@example.test",
    username: "legacy-user",
    password: "correct horse battery staple",
    birthDate: "1990-01-01",
    turnstileToken: "test",
  });
  assert.equal(response.status, 201);
  const row = db.sqlite
    .prepare("SELECT terms_accepted_at,terms_version,privacy_version FROM decave_users WHERE email_normalized=?")
    .get("legacy@example.test");
  assert.ok(row.terms_accepted_at);
  assert.equal(row.terms_version, "legacy-client-checkbox");
  assert.equal(row.privacy_version, "legacy-client-checkbox");
  assert.notEqual(row.terms_version, TERMS_VERSION, "a legacy sign-up is never recorded as the current version");
});

test("sign-up from a 0.1.133 client sending only acceptedTerms is recorded with the legacy marker", async () => {
  const base = {
    username: "legacy-flag-user",
    password: "correct horse battery staple",
    birthDate: "1990-01-01",
    turnstileToken: "test",
  };
  const response = await registerAccount({ ...base, email: "legacy-flag@example.test", acceptedTerms: true });
  assert.equal(response.status, 201);
  const row = db.sqlite
    .prepare("SELECT terms_accepted_at,terms_version,privacy_version FROM decave_users WHERE email_normalized=?")
    .get("legacy-flag@example.test");
  assert.ok(row.terms_accepted_at);
  assert.equal(row.terms_version, "legacy-client-checkbox");
  assert.equal(row.privacy_version, "legacy-client-checkbox");

  const unticked = await registerAccount({
    ...base,
    email: "unticked@example.test",
    username: "unticked-user",
    acceptedTerms: false,
  });
  assert.equal(unticked.status, 400);

  const mixed = await registerAccount({
    ...base,
    email: "mixed@example.test",
    username: "mixed-user",
    acceptedTerms: true,
    termsAccepted: true,
    termsVersion: "old",
    privacyVersion: PRIVACY_VERSION,
  });
  assert.equal(mixed.status, 400, "a client sending versioned fields must send the current versions");
});
