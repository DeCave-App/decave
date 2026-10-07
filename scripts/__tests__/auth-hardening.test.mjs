import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { register } from "node:module";
import { test, after } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { hashPassword, passwordHashNeedsUpgrade, tokenHash, verifyPassword } = await import("../../worker/db.ts");
const { ownerEncryptMfa, ownerTotpAt, ownerVerifyMfaOrRecovery, userVerifyMfaOrRecovery } =
  await import("../../worker/lib/mfa.ts");
const { TERMS_VERSION, PRIVACY_VERSION } = await import("../../shared/legal-consent.ts");

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
const password = "correct horse battery staple";

function request(path, { method = "GET", body, userId, token, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (userId && token) requestHeaders.set("authorization", `Bearer ${token}`);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  return handleApi(
    new Request(`https://test.invalid${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
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

test("versioned scrypt upgrades legacy hashes while still verifying them", async () => {
  const salt = "legacy-fixture-salt";
  const legacy = scryptSync(password, salt, 64, {
    N: 1 << 14,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  }).toString("hex");
  assert.equal(await verifyPassword(password, salt, legacy), true);
  assert.equal(passwordHashNeedsUpgrade(legacy), true);

  const upgraded = await hashPassword(password, salt);
  assert.match(upgraded.hash, /^scrypt-v2\$/);
  assert.equal(await verifyPassword(password, salt, upgraded.hash), true);
  assert.equal(passwordHashNeedsUpgrade(upgraded.hash), false);
});

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

test("signup requires current consent and age eligibility and returns the same duplicate response", async () => {
  const base = {
    email: "new@example.test",
    username: "new-user",
    password,
    birthDate: "1990-01-01",
    turnstileToken: "test",
  };
  const missingConsent = await request("/api/auth/register", { method: "POST", body: base });
  assert.equal(missingConsent.status, 400);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_users WHERE email_normalized='new@example.test'"), 0);

  const youngDate = new Date();
  youngDate.setUTCFullYear(youngDate.getUTCFullYear() - 15);
  const tooYoung = await request("/api/auth/register", {
    method: "POST",
    body: {
      ...base,
      birthDate: youngDate.toISOString().slice(0, 10),
      termsAccepted: true,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
    },
  });
  assert.equal(tooYoung.status, 403);

  const accepted = {
    ...base,
    termsAccepted: true,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
  };
  const first = await request("/api/auth/register", { method: "POST", body: accepted });
  const firstBody = await first.json();
  assert.equal(first.status, 202);
  assert.equal(
    db.scalar("SELECT terms_version FROM decave_users WHERE email_normalized='new@example.test'"),
    TERMS_VERSION,
  );
  assert.ok(db.scalar("SELECT terms_accepted_at FROM decave_users WHERE email_normalized='new@example.test'"));

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    body: { ...accepted, username: "another-name" },
  });
  assert.equal(duplicate.status, first.status);
  assert.deepEqual(await duplicate.json(), firstBody);
});

test("login throttle keys normalize the account identifier", async () => {
  limiterKeys.length = 0;
  env.AUTH_RATE_LIMITER = {
    limit: async ({ key }) => {
      limiterKeys.push(key);
      return { success: !key.startsWith("login-account:") };
    },
  };
  for (const identifier of [" Person@example.test ", "person@EXAMPLE.test"]) {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "CF-Connecting-IP": "192.0.2.4" },
      body: { identifier, password, turnstileToken: "test" },
    });
    assert.equal(response.status, 429);
  }
  const accountKeys = limiterKeys.filter((key) => key.startsWith("login-account:"));
  assert.equal(accountKeys.length, 2);
  assert.equal(accountKeys[0], accountKeys[1]);
  env.AUTH_RATE_LIMITER = { limit: async () => ({ success: true }) };
});

test("QR sign-in discloses requester details before approval and requires MFA plus explicit consent", async () => {
  seedUser("qr-user");
  const sessionToken = "qr-approver-session";
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    tokenHash(sessionToken),
    "qr-user",
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
  const secret = "JBSWY3DPEHPK3PXP";
  const encrypted = await ownerEncryptMfa(env, secret);
  db.exec(
    "INSERT INTO decave_user_mfa(user_id,secret_ciphertext,enabled_at,created_at,updated_at) VALUES(?,?,?,?,?)",
    "qr-user",
    encrypted,
    now,
    now,
    now,
  );

  const started = await request("/api/auth/qr/start", {
    method: "POST",
    headers: { "user-agent": "Mozilla/5.0 Chrome/120.0", "CF-IPCountry": "PL" },
    body: { client: "web" },
  });
  const challenge = await started.json();
  assert.equal(started.status, 200);
  const unauthenticated = await request("/api/auth/qr/preview", {
    method: "POST",
    body: { challengeId: challenge.challengeId, secret: challenge.secret },
  });
  assert.equal(unauthenticated.status, 401);

  const preview = await request("/api/auth/qr/preview", {
    method: "POST",
    userId: "qr-user",
    token: sessionToken,
    body: { challengeId: challenge.challengeId, secret: challenge.secret },
  });
  const details = await preview.json();
  assert.equal(preview.status, 200);
  assert.match(details.deviceLabel, /Chrome/);
  assert.equal(details.locationLabel, "Poland");

  const body = { challengeId: challenge.challengeId, secret: challenge.secret };
  const noExplicitApproval = await request("/api/auth/qr/approve", {
    method: "POST",
    userId: "qr-user",
    token: sessionToken,
    body: { ...body, approved: false },
  });
  assert.equal(noExplicitApproval.status, 400);
  const noMfa = await request("/api/auth/qr/approve", {
    method: "POST",
    userId: "qr-user",
    token: sessionToken,
    body: { ...body, approved: true },
  });
  assert.equal(noMfa.status, 403);

  const currentCode = await ownerTotpAt(secret, Math.floor(Date.now() / 30_000));
  const approved = await request("/api/auth/qr/approve", {
    method: "POST",
    userId: "qr-user",
    token: sessionToken,
    body: { ...body, approved: true, mfaCode: currentCode },
  });
  assert.equal(approved.status, 200);
  assert.equal(
    db.scalar("SELECT user_id FROM decave_qr_login_challenges WHERE id=?", challenge.challengeId),
    "qr-user",
  );

  const claimed = await request("/api/auth/qr/claim", {
    method: "POST",
    body: { challengeId: challenge.challengeId, secret: challenge.secret, client: "web" },
  });
  assert.equal(claimed.status, 200);
  const replayedClaim = await request("/api/auth/qr/claim", {
    method: "POST",
    body: { challengeId: challenge.challengeId, secret: challenge.secret, client: "web" },
  });
  assert.equal(replayedClaim.status, 410);
});

test("reset email GET never consumes the token and concurrent POST redemption succeeds once", async () => {
  seedUser("reset-user");
  const original = await hashPassword("old secure password");
  db.exec(
    "UPDATE decave_users SET password_salt=?,password_hash=? WHERE id='reset-user'",
    original.salt,
    original.hash,
  );
  const rawReset = "reset-token-concurrent";
  const rawSecure = "secure-token-scan";
  db.exec(
    "INSERT INTO decave_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at) VALUES(?,?,'reset_password',?,?,?)",
    "reset-token-row",
    "reset-user",
    tokenHash(rawReset),
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
  db.exec(
    "INSERT INTO decave_secure_account_tokens(token_hash,user_id,device_label,created_at,expires_at) VALUES(?,?,?,?,?)",
    tokenHash(rawSecure),
    "reset-user",
    "Browser",
    now,
    new Date(Date.now() + 3600_000).toISOString(),
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    tokenHash("reset-session"),
    "reset-user",
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );

  const resetGet = await request(`/api/auth/reset-password?token=${encodeURIComponent(rawReset)}`);
  const secureGet = await request(`/api/auth/secure-account?token=${encodeURIComponent(rawSecure)}`);
  assert.equal(resetGet.status, 302);
  assert.match(resetGet.headers.get("location") ?? "", /#token=reset-token-concurrent$/);
  assert.equal(secureGet.status, 302);
  assert.match(secureGet.headers.get("location") ?? "", /#token=secure-token-scan$/);
  assert.equal(db.scalar("SELECT consumed_at FROM decave_auth_tokens WHERE id='reset-token-row'"), null);
  assert.equal(
    db.scalar("SELECT used_at FROM decave_secure_account_tokens WHERE token_hash=?", tokenHash(rawSecure)),
    null,
  );
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='reset-user'"), 1);

  const outcomes = await Promise.all(
    ["new secure password one", "new secure password two"].map((nextPassword) =>
      request("/api/auth/reset-password", { method: "POST", body: { token: rawReset, password: nextPassword } }),
    ),
  );
  assert.deepEqual(outcomes.map((response) => response.status).sort(), [200, 400]);
  const stored = await db.prepare("SELECT password_salt,password_hash FROM decave_users WHERE id='reset-user'").first();
  const matches = await Promise.all(
    ["new secure password one", "new secure password two"].map((candidate) =>
      verifyPassword(candidate, stored.password_salt, stored.password_hash),
    ),
  );
  assert.equal(matches.filter(Boolean).length, 1);
  assert.ok(db.scalar("SELECT consumed_at FROM decave_auth_tokens WHERE id='reset-token-row'"));
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='reset-user'"), 0);
});
