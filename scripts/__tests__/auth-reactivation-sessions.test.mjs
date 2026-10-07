import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { test, after } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const worker = await import("../../worker/index.ts");
const { handleApi } = worker;
const { hashPassword, passwordHashNeedsUpgrade, tokenHash, sessionPublicId, DUMMY_PASSWORD_HASH } =
  await import("../../worker/db.ts");
const { securityHeaders, sameOriginWriteAllowed, webSocketOriginAllowed } = await import("../../worker/lib/http.ts");
const { ownerEncryptMfa, ownerTotpAt } = await import("../../worker/lib/mfa.ts");

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const db = new D1Mock();
const sentEmails = [];
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
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
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

function request(path, { method = "GET", body, token, headers = {}, ctx } = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  return handleApi(
    new Request(`https://test.invalid${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
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

const login = (identifier) =>
  request("/api/auth/login", { method: "POST", body: { identifier, password, turnstileToken: "test" } });

test("a self-disabled MFA account is reactivated only after the second factor succeeds", async () => {
  const email = seedUser("selfoff-mfa", {
    suspended_at: now,
    suspension_reason: "Self-disabled by account holder",
  });
  const secret = await enableUserMfa("selfoff-mfa");

  const first = await login(email);
  const challenge = await first.json();
  assert.equal(first.status, 200);
  assert.equal(challenge.mfaRequired, true);
  assert.ok(
    db.scalar("SELECT suspended_at FROM decave_users WHERE id='selfoff-mfa'"),
    "the password alone must not lift the self-disable",
  );

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
  assert.equal(db.scalar("SELECT suspension_reason FROM decave_users WHERE id='selfoff-mfa'"), "");
});

test("password-only self-deletion is restored at sign-in; admin suspensions are not liftable", async () => {
  const selfDeleted = seedUser("selfdel", {
    deleted_at: now,
    delete_after: new Date(Date.now() + 86400_000).toISOString(),
    deletion_reason: "Self-service account deletion",
  });
  const restored = await login(selfDeleted);
  assert.equal(restored.status, 200);
  assert.equal(db.scalar("SELECT deleted_at FROM decave_users WHERE id='selfdel'"), null);

  const adminSuspended = seedUser("adminsusp", { suspended_at: now, suspension_reason: "Spam" });
  const blocked = await login(adminSuspended);
  assert.equal(blocked.status, 403);
  assert.ok(db.scalar("SELECT suspended_at FROM decave_users WHERE id='adminsusp'"));

  const adminSuspendedMfa = seedUser("adminsusp-mfa", { suspended_at: now, suspension_reason: "Spam" });
  await enableUserMfa("adminsusp-mfa");
  const blockedBeforeChallenge = await login(adminSuspendedMfa);
  assert.equal(blockedBeforeChallenge.status, 403, "no MFA challenge is issued for an admin-suspended account");
});

test("unknown identifiers verify against a current-version (v2 scrypt) dummy hash", () => {
  assert.match(DUMMY_PASSWORD_HASH, /^scrypt-v2\$0{128}$/);
  assert.equal(passwordHashNeedsUpgrade(DUMMY_PASSWORD_HASH), false);
  const auth = source("worker/routes/auth.ts");
  assert.match(auth, /user\?\.password_hash \?\? DUMMY_PASSWORD_HASH/);
  assert.doesNotMatch(auth, /password_hash \?\? "00"\.repeat\(64\)/);
});

test("the sessions list exposes an opaque id and revoke rejects raw token hashes", async () => {
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
  assert.equal(byHash.status, 400);
  const foreign = await request("/api/auth/sessions/revoke", {
    method: "POST",
    token: "sess-current",
    body: { id: sessionPublicId(tokenHash("sess-stranger-token")) },
  });
  assert.equal(foreign.status, 404, "another account's session cannot be revoked");
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

test("forgot-password responds before the account lookup and email run (waitUntil)", async () => {
  const email = seedUser("forgot-user");
  const pending = [];
  sentEmails.length = 0;
  const response = await request("/api/auth/forgot-password", {
    method: "POST",
    body: { email, turnstileToken: "test" },
    ctx: { waitUntil: (promise) => pending.push(promise), passThroughOnException() {} },
  });
  assert.equal(response.status, 200);
  const knownBody = await response.json();
  assert.equal(pending.length, 1, "the reset work is deferred to waitUntil");
  await Promise.all(pending);
  assert.equal(sentEmails.length, 1);
  assert.equal(
    db.scalar("SELECT COUNT(*) FROM decave_auth_tokens WHERE user_id='forgot-user' AND purpose='reset_password'"),
    1,
  );

  const unknownPending = [];
  const unknown = await request("/api/auth/forgot-password", {
    method: "POST",
    body: { email: "nobody@example.test", turnstileToken: "test" },
    ctx: { waitUntil: (promise) => unknownPending.push(promise), passThroughOnException() {} },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknownPending.length, 1, "unknown emails take the same deferred path");
  assert.deepEqual(await unknown.json(), knownBody, "known and unknown emails get the same response");
});

test("QR sign-in issues a short non-persistent session", () => {
  const auth = source("worker/routes/auth.ts");
  const claim = auth.slice(auth.indexOf('p === "/api/auth/qr/claim"'));
  const block = claim.slice(0, claim.indexOf("return null;"));
  assert.match(block, /createSession\(env, user\.id, SHORT_SESSION_TTL_MS\)/);
  assert.match(block, /sessionCookie\(request, sessionToken, null\)/);
  assert.doesNotMatch(block, /30 \* 86400/);
  assert.match(auth, /const SHORT_SESSION_TTL_MS = 12 \* 60 \* 60 \* 1000;/);
});

test("current-password checks are throttled per account, not per IP", async () => {
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

  const account = source("worker/routes/account.ts");
  for (const key of ["account-username", "account-phone", "account-state"]) {
    assert.match(account, new RegExp("key: `" + key + ":\\$\\{user\\.id\\}`"));
  }
  assert.doesNotMatch(account, /requestKey\(request, `account-/);
  assert.match(source("worker/routes/auth.ts"), /key: `add-email:\$\{user\.id\}`/);
});

test("CSP derives the realtime origin from the request and drops unused hosts", async () => {
  const csp = securityHeaders(new Response("ok"), new Request("https://staging.example.test/")).headers.get(
    "Content-Security-Policy",
  );
  assert.match(csp, /connect-src [^;]*wss:\/\/staging\.example\.test/);
  assert.doesNotMatch(csp, /giphy-analytics/);
  assert.doesNotMatch(csp, /wss:\/\/(app\.)?de-cave\.com/);
  const local = securityHeaders(new Response("ok"), new Request("http://127.0.0.1:8787/")).headers.get(
    "Content-Security-Policy",
  );
  assert.match(local, /ws:\/\/127\.0\.0\.1:8787/);
});

test("writes reject browser cross-origin fetch metadata; /ws enforces an Origin allowlist", async () => {
  const write = (headers) => new Request("https://app.example.test/api/x", { method: "POST", headers });
  assert.equal(sameOriginWriteAllowed(write({})), true, "native clients send no fetch metadata");
  assert.equal(sameOriginWriteAllowed(write({ "Sec-Fetch-Site": "same-origin" })), true);
  assert.equal(sameOriginWriteAllowed(write({ "Sec-Fetch-Site": "none" })), true);
  assert.equal(sameOriginWriteAllowed(write({ "Sec-Fetch-Site": "same-site" })), false);
  assert.equal(sameOriginWriteAllowed(write({ "Sec-Fetch-Site": "cross-site" })), false);
  assert.equal(
    sameOriginWriteAllowed(write({ "Sec-Fetch-Site": "same-origin", Origin: "https://evil.example" })),
    false,
  );

  const ws = (url, origin) =>
    new Request(url, { headers: { Upgrade: "websocket", ...(origin ? { Origin: origin } : {}) } });
  assert.equal(webSocketOriginAllowed(ws("https://app.de-cave.com/ws")), true, "native mobile omits Origin");
  assert.equal(webSocketOriginAllowed(ws("https://app.de-cave.com/ws", "https://app.de-cave.com")), true);
  assert.equal(webSocketOriginAllowed(ws("https://staging.example.test/ws", "https://staging.example.test")), true);
  assert.equal(webSocketOriginAllowed(ws("https://app.de-cave.com/ws", "https://evil.example")), false);
  assert.equal(webSocketOriginAllowed(ws("https://app.de-cave.com/ws", "https://de-cave.com")), false);
  assert.equal(webSocketOriginAllowed(ws("https://app.de-cave.com/ws", "http://app.de-cave.com")), false);
  assert.equal(webSocketOriginAllowed(ws("https://app.de-cave.com/ws", "null")), false);
  assert.equal(webSocketOriginAllowed(ws("https://app.de-cave.com/ws", "http://localhost:5173")), false);
  assert.equal(webSocketOriginAllowed(ws("http://127.0.0.1:8787/ws", "http://localhost:5173")), true);

  const blocked = await worker.default.fetch(ws("https://app.de-cave.com/ws", "https://evil.example"), env, {
    waitUntil() {},
    passThroughOnException() {},
  });
  assert.equal(blocked.status, 403);
});

test("realtime admission keys never keep the raw client IP", () => {
  const hubRoom = source("worker/HubRoom.ts");
  const fn = hubRoom.slice(hubRoom.indexOf("function peerAddressForRequest"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
  assert.match(body, /peerAddressTag\(address, ipHashKey\)/);
  assert.doesNotMatch(body, /\? address :/);
  assert.match(hubRoom, /peerAddressForRequest\(request, this\.env\.SECURITY_IP_HASH_KEY\)/);
  assert.match(hubRoom, /normalizedPeerAddress\(attached\.peerAddress, this\.env\.SECURITY_IP_HASH_KEY\)/);
});
