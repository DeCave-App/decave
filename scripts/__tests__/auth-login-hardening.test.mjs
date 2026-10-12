import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { test, after } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const {
  hashPassword,
  passwordHashNeedsUpgrade,
  tokenHash,
  verifyPassword,
  sessionPublicId,
  DUMMY_PASSWORD_HASH,
  PASSWORD_SCRYPT_OPTIONS,
} = await import("../../worker/db.ts");
const { ownerEncryptMfa, ownerTotpAt } = await import("../../worker/lib/mfa.ts");

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const db = new D1Mock();
const sentEmails = [];
const authKeys = [];
const recoveryKeys = [];
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: {
    send: async (message) => {
      sentEmails.push(message);
      return { messageId: "test" };
    },
  },
  AUTH_RATE_LIMITER: {
    limit: async ({ key }) => {
      authKeys.push(key);
      return { success: true };
    },
  },
  RECOVERY_RATE_LIMITER: {
    limit: async ({ key }) => {
      recoveryKeys.push(key);
      return { success: true };
    },
  },
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
const passwordHash = await hashPassword(password);

function request(path, { method = "GET", body, form, token, headers = {}, ctx } = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);
  let payload;
  if (form) payload = new URLSearchParams(form);
  else if (body !== undefined) {
    requestHeaders.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }
  return handleApi(
    new Request(`https://test.invalid${path}`, { method, headers: requestHeaders, body: payload }),
    env,
    ctx,
  );
}

function seedUser(id, extra = {}) {
  const email = `${id}@example.test`;
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,
      email_verified_at,requires_email_verification,platform_role,status,must_reset_password)
     VALUES(?,?,?,?,?,?,?,?,?,0,'user','online',0)`,
    id,
    `user-${id}`,
    passwordHash.salt,
    passwordHash.hash,
    now,
    `DC-${id
      .replace(/[^a-z0-9]/gi, "")
      .padEnd(16, "0")
      .slice(0, 16)}`,
    email,
    email,
    now,
  );
  for (const [column, value] of Object.entries(extra)) {
    db.exec(`UPDATE decave_users SET ${column}=? WHERE id=?`, value, id);
  }
  return email;
}

function seedSession(userId, raw) {
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    tokenHash(raw),
    userId,
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
}

async function enableUserMfa(userId) {
  const secret = "JBSWY3DPEHPK3PXP";
  db.exec(
    "INSERT INTO decave_user_mfa(user_id,secret_ciphertext,enabled_at,created_at,updated_at) VALUES(?,?,?,?,?)",
    userId,
    await ownerEncryptMfa(env, secret),
    now,
    now,
    now,
  );
  return secret;
}

const login = (identifier, extra = {}) =>
  request("/api/auth/login", { method: "POST", body: { identifier, password, turnstileToken: "test" }, ...extra });

test("legacy password hashes still verify and are upgraded to current scrypt parameters at sign-in", async () => {
  const salt = "legacy-fixture-salt";
  const legacy = scryptSync(password, salt, 64, { N: 1 << 14, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }).toString("hex");
  assert.equal(await verifyPassword(password, salt, legacy), true);
  assert.equal(passwordHashNeedsUpgrade(legacy), true);
  assert.match(passwordHash.hash, /^scrypt-v2\$/);
  assert.equal(passwordHashNeedsUpgrade(passwordHash.hash), false);

  const email = seedUser("legacy-hash");
  db.exec("UPDATE decave_users SET password_salt=?,password_hash=? WHERE id='legacy-hash'", salt, legacy);
  const response = await login(email);
  assert.equal(response.status, 200);
  const stored = await db
    .prepare("SELECT password_salt,password_hash FROM decave_users WHERE id='legacy-hash'")
    .first();
  assert.match(stored.password_hash, /^scrypt-v2\$/);
  assert.equal(await verifyPassword(password, stored.password_salt, stored.password_hash), true);
});

test("current scrypt parameters stay within a small per-hash memory budget", () => {
  const { N, r, p } = PASSWORD_SCRYPT_OPTIONS;
  assert.ok(128 * N * r <= 8 * 1024 * 1024, "scrypt memory per hash must stay <= 8 MiB");
  assert.ok(N * r * p > (1 << 14) * 8, "current parameters must cost more than the legacy ones");
  const fixture = scryptSync(password, "v2-fixture-salt", 64, { N: 1 << 13, r: 8, p: 3, maxmem: 16 * 1024 * 1024 });
  return verifyPassword(password, "v2-fixture-salt", `scrypt-v2$${fixture.toString("hex")}`).then((ok) =>
    assert.equal(ok, true),
  );
});

test("unknown emails verify against a current-version dummy hash", () => {
  assert.match(DUMMY_PASSWORD_HASH, /^scrypt-v2\$0{128}$/);
  assert.equal(passwordHashNeedsUpgrade(DUMMY_PASSWORD_HASH), false);
  const auth = source("worker/routes/auth.ts");
  assert.match(auth, /user\?\.password_hash \?\? DUMMY_PASSWORD_HASH/);
  assert.doesNotMatch(auth, /password_hash \?\? "00"\.repeat\(64\)/);
});

test("login is throttled per account as well as per address, with a normalized key", async () => {
  authKeys.length = 0;
  for (const identifier of [" Person@example.test ", "person@EXAMPLE.test"]) {
    const response = await login(identifier, { headers: { "CF-Connecting-IP": "192.0.2.4" } });
    assert.equal(response.status, 401);
  }
  const accountKeys = authKeys.filter((key) => key.startsWith("login-account:"));
  assert.equal(accountKeys.length, 2);
  assert.equal(accountKeys[0], accountKeys[1]);
  assert.ok(!accountKeys[0].includes("person"), "the key does not carry the email itself");
});

test("a self-disabled account with two-factor sign-in is reactivated only after the second factor", async () => {
  const email = seedUser("selfoff-mfa", { suspended_at: now, suspension_reason: "Self-disabled by account holder" });
  const secret = await enableUserMfa("selfoff-mfa");
  const first = await login(email);
  const challenge = await first.json();
  assert.equal(first.status, 200);
  assert.equal(challenge.mfaRequired, true);
  assert.ok(db.scalar("SELECT suspended_at FROM decave_users WHERE id='selfoff-mfa'"), "the password alone does not");

  const wrong = await request("/api/auth/mfa-login", {
    method: "POST",
    body: { challengeToken: challenge.challengeToken, mfaCode: "000000" },
  });
  assert.equal(wrong.status, 403);
  assert.ok(db.scalar("SELECT suspended_at FROM decave_users WHERE id='selfoff-mfa'"));

  const code = await ownerTotpAt(secret, Math.floor(Date.now() / 30_000));
  const done = await request("/api/auth/mfa-login", {
    method: "POST",
    body: { challengeToken: challenge.challengeToken, mfaCode: code },
  });
  assert.equal(done.status, 200);
  assert.equal(db.scalar("SELECT suspended_at FROM decave_users WHERE id='selfoff-mfa'"), null);
});

test("password-only self-deletion is restored at sign-in; admin suspensions are not lifted", async () => {
  const selfDeleted = seedUser("selfdel", {
    deleted_at: now,
    delete_after: new Date(Date.now() + 86400_000).toISOString(),
    deletion_reason: "Self-service account deletion",
  });
  assert.equal((await login(selfDeleted)).status, 200);
  assert.equal(db.scalar("SELECT deleted_at FROM decave_users WHERE id='selfdel'"), null);

  const adminSuspended = seedUser("adminsusp", { suspended_at: now, suspension_reason: "Spam" });
  assert.equal((await login(adminSuspended)).status, 403);
  assert.ok(db.scalar("SELECT suspended_at FROM decave_users WHERE id='adminsusp'"));

  const adminSuspendedMfa = seedUser("adminsusp-mfa", { suspended_at: now, suspension_reason: "Spam" });
  await enableUserMfa("adminsusp-mfa");
  assert.equal((await login(adminSuspendedMfa)).status, 403, "no second-factor challenge is issued");
});

test("the sessions list exposes an opaque id and revoke-by-id still works", async () => {
  seedUser("sess-user");
  seedSession("sess-user", "sess-current");
  seedSession("sess-user", "sess-other");
  seedUser("sess-stranger");
  seedSession("sess-stranger", "sess-stranger-token");

  const listed = await request("/api/auth/sessions", { token: "sess-current" });
  const { sessions } = await listed.json();
  assert.equal(listed.status, 200);
  assert.equal(sessions.length, 2);
  for (const session of sessions) {
    assert.match(session.id, /^[0-9a-f]{32}$/);
    assert.notEqual(session.id, tokenHash("sess-current"));
    assert.notEqual(session.id, tokenHash("sess-other"));
  }
  const other = sessions.find((session) => !session.current);
  assert.equal(other.id, sessionPublicId(tokenHash("sess-other")));

  const byHash = await request("/api/auth/sessions/revoke", {
    method: "POST",
    token: "sess-current",
    body: { id: tokenHash("sess-other") },
  });
  assert.equal(byHash.status, 400, "a raw token hash is no longer accepted");
  const foreign = await request("/api/auth/sessions/revoke", {
    method: "POST",
    token: "sess-current",
    body: { id: sessionPublicId(tokenHash("sess-stranger-token")) },
  });
  assert.equal(foreign.status, 404);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='sess-stranger'"), 1);

  const revoked = await request("/api/auth/sessions/revoke", {
    method: "POST",
    token: "sess-current",
    body: { id: other.id },
  });
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).current, false);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE token_hash=?", tokenHash("sess-other")), 0);
});

test("forgot-password answers the same for known and unknown emails and defers the work", async () => {
  const email = seedUser("forgot-user");
  sentEmails.length = 0;
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise), passThroughOnException() {} };
  const known = await request("/api/auth/forgot-password", {
    method: "POST",
    body: { email, turnstileToken: "t" },
    ctx,
  });
  const knownBody = await known.json();
  assert.equal(pending.length, 1, "the lookup and email run after the response");
  await Promise.all(pending);
  assert.equal(sentEmails.length, 1);

  const unknownPending = [];
  const unknown = await request("/api/auth/forgot-password", {
    method: "POST",
    body: { email: "nobody@example.test", turnstileToken: "t" },
    ctx: { waitUntil: (promise) => unknownPending.push(promise), passThroughOnException() {} },
  });
  assert.equal(unknownPending.length, 1, "unknown emails take the same deferred path");
  assert.equal(unknown.status, known.status);
  assert.deepEqual(await unknown.json(), knownBody);
});

test("opening a reset link never consumes it and concurrent submissions succeed once", async () => {
  seedUser("reset-user");
  seedSession("reset-user", "reset-session");
  const rawReset = "reset-token-concurrent";
  db.exec(
    "INSERT INTO decave_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at) VALUES(?,?,'reset_password',?,?,?)",
    "reset-token-row",
    "reset-user",
    tokenHash(rawReset),
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
  for (let index = 0; index < 2; index += 1) {
    const opened = await request(`/api/auth/reset?token=${encodeURIComponent(rawReset)}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get("referrer-policy"), "no-referrer");
  }
  assert.equal(db.scalar("SELECT consumed_at FROM decave_auth_tokens WHERE id='reset-token-row'"), null);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='reset-user'"), 1);

  const candidates = ["new secure password one", "new secure password two"];
  const outcomes = await Promise.all(
    candidates.map((next) =>
      request("/api/auth/reset-password-form", { method: "POST", form: { token: rawReset, password: next } }),
    ),
  );
  assert.deepEqual(outcomes.map((response) => response.status).sort(), [200, 400]);
  const stored = await db.prepare("SELECT password_salt,password_hash FROM decave_users WHERE id='reset-user'").first();
  const matches = await Promise.all(
    candidates.map((c) => verifyPassword(c, stored.password_salt, stored.password_hash)),
  );
  assert.equal(matches.filter(Boolean).length, 1);
  assert.ok(db.scalar("SELECT claim_id FROM decave_auth_tokens WHERE id='reset-token-row'"));
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='reset-user'"), 0);

  const replay = await request("/api/auth/reset-password-form", {
    method: "POST",
    form: { token: rawReset, password: "third secure password" },
  });
  assert.equal(replay.status, 400);
});

test("current-password checks are throttled per account, not per address", async () => {
  seedUser("pw-user");
  seedSession("pw-user", "pw-session");
  recoveryKeys.length = 0;
  for (const ip of ["192.0.2.1", "198.51.100.7"]) {
    const response = await request("/api/auth/change-password", {
      method: "POST",
      token: "pw-session",
      headers: { "CF-Connecting-IP": ip },
      body: {
        currentPassword: "wrong password!!",
        newPassword: "another password 1",
        confirmPassword: "another password 1",
      },
    });
    assert.equal(response.status, 403);
  }
  assert.deepEqual(recoveryKeys, ["change-password:pw-user", "change-password:pw-user"]);

  recoveryKeys.length = 0;
  const env429 = env.RECOVERY_RATE_LIMITER;
  env.RECOVERY_RATE_LIMITER = {
    limit: async ({ key }) => {
      recoveryKeys.push(key);
      return { success: !key.startsWith("current-password:") };
    },
  };
  const blocked = await request("/api/account/mfa/setup", {
    method: "POST",
    token: "pw-session",
    body: { currentPassword: password },
  });
  env.RECOVERY_RATE_LIMITER = env429;
  assert.equal(blocked.status, 429);
  assert.ok(recoveryKeys.includes("current-password:pw-user"));
  for (const path of [
    "worker/routes/account.ts",
    "worker/routes/dm-keys.ts",
    "worker/routes/admin/owner-security.ts",
  ]) {
    const text = source(path);
    const checks = text.match(/await verifyPassword\(/g)?.length ?? 0;
    const throttles = text.match(/await currentPasswordThrottle\(/g)?.length ?? 0;
    assert.equal(throttles, checks, `${path} throttles every current-password check`);
  }
});
