import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { register } from "node:module";
import { test, after } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { hashPassword, tokenHash } = await import("../../worker/db.ts");
const { ownerEncryptMfa, ownerTotpAt } = await import("../../worker/lib/mfa.ts");

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

const changeEmail = (token, body) => request("/api/auth/add-email", { method: "POST", token, body });
const currentEmail = (id) => db.scalar("SELECT email FROM decave_users WHERE id=?", id);

test("an account with 2FA needs a fresh authenticator code to change its email", async () => {
  const oldEmail = seedUser("em-mfa");
  seedSession("em-mfa", "em-mfa-session");
  const secret = await enableUserMfa("em-mfa");
  const base = { email: "new-mfa@example.test", password };

  // A released app that never sends mfaCode fails closed with an update hint.
  const legacy = await changeEmail("em-mfa-session", base);
  assert.equal(legacy.status, 403);
  const legacyBody = await legacy.json();
  assert.equal(legacyBody.code, "MFA_REQUIRED");
  assert.match(legacyBody.error, /update DeCave to change your email/i);
  assert.equal(currentEmail("em-mfa"), oldEmail);

  const wrong = await changeEmail("em-mfa-session", { ...base, mfaCode: "000000" });
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).code, "MFA_INVALID");
  assert.equal(currentEmail("em-mfa"), oldEmail);

  const badPassword = await changeEmail("em-mfa-session", { ...base, password: "wrong password!!", mfaCode: "000000" });
  assert.equal(badPassword.status, 403, "the current password is still checked first");

  const code = await ownerTotpAt(secret, Math.floor(Date.now() / 30_000));
  sentEmails.length = 0;
  const ok = await changeEmail("em-mfa-session", { ...base, mfaCode: code });
  assert.equal(ok.status, 200);
  assert.equal(currentEmail("em-mfa"), "new-mfa@example.test");
  const notice = sentEmails.find((message) => message.to === oldEmail);
  assert.ok(notice, "the old address is told about the change");
  assert.match(notice.text, /new-mfa@example\.test/);
  assert.doesNotMatch(notice.html, /href=|token/i, "the notice carries no action links or tokens");
  assert.ok(
    sentEmails.some((message) => message.to === "new-mfa@example.test"),
    "the new address gets verification",
  );

  const replay = await changeEmail("em-mfa-session", { email: "again@example.test", password, mfaCode: code });
  assert.equal(replay.status, 403, "the same authenticator code cannot be replayed");
  assert.equal(currentEmail("em-mfa"), "new-mfa@example.test");
});

test("the email-change notice escapes the username and new address", async () => {
  const oldEmail = seedUser("em-html", { username: "<b>evil</b>" });
  seedSession("em-html", "em-html-session");
  sentEmails.length = 0;
  const ok = await changeEmail("em-html-session", { email: "x+<i>@example.test", password });
  if (ok.status === 200) {
    const notice = sentEmails.find((message) => message.to === oldEmail);
    assert.ok(notice);
    assert.doesNotMatch(notice.html, /<b>evil<\/b>|<i>/);
  } else {
    assert.equal(ok.status, 400, "an address with markup is rejected outright");
  }
  const plain = await changeEmail("em-html-session", { email: "plain-html@example.test", password });
  assert.equal(plain.status, 200);
  const notice = sentEmails.find((message) => message.to === oldEmail);
  assert.ok(notice);
  assert.match(notice.html, /&lt;b&gt;evil&lt;\/b&gt;/);
});

test("an account without 2FA changes its email with only the password, as before", async () => {
  const oldEmail = seedUser("em-plain");
  seedSession("em-plain", "em-plain-session");
  sentEmails.length = 0;
  const ok = await changeEmail("em-plain-session", { email: "new-plain@example.test", password });
  assert.equal(ok.status, 200);
  assert.equal(currentEmail("em-plain"), "new-plain@example.test");
  assert.ok(sentEmails.some((message) => message.to === oldEmail));
});

test("an unverified previous address gets no change notice", async () => {
  seedUser("em-unverified", { email_verified_at: null });
  seedSession("em-unverified", "em-unverified-session");
  sentEmails.length = 0;
  const ok = await changeEmail("em-unverified-session", { email: "new-unverified@example.test", password });
  assert.equal(ok.status, 200);
  assert.deepEqual(
    sentEmails.map((message) => message.to),
    ["new-unverified@example.test"],
  );
});
