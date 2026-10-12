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

async function startChallenge() {
  const started = await request("/api/auth/qr/start", {
    method: "POST",
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0", "CF-IPCountry": "PL" },
    body: { client: "desktop" },
  });
  assert.equal(started.status, 200);
  return started.json();
}

test("QR approval shows the requester first and needs explicit consent plus the second factor", async () => {
  seedUser("qr-user");
  seedSession("qr-user", "qr-approver");
  const secret = await enableUserMfa("qr-user");
  const challenge = await startChallenge();
  const body = { challengeId: challenge.challengeId, secret: challenge.secret };

  assert.equal((await request("/api/auth/qr/preview", { method: "POST", body })).status, 401);
  const preview = await request("/api/auth/qr/preview", { method: "POST", token: "qr-approver", body });
  const details = await preview.json();
  assert.equal(preview.status, 200);
  assert.match(details.deviceLabel, /desktop|Windows/i);
  assert.equal(details.locationLabel, "Poland");
  assert.equal(details.mfaRequired, true);
  const stored = await db
    .prepare("SELECT * FROM decave_qr_login_challenges WHERE id=?")
    .bind(challenge.challengeId)
    .first();
  assert.equal(stored.requester_country, "PL");
  assert.ok(!Object.values(stored).some((value) => String(value).includes("192.0.2")), "no address is stored");

  const legacy = await request("/api/auth/qr/approve", { method: "POST", token: "qr-approver", body });
  assert.equal(legacy.status, 400, "an old app cannot send a code, so an MFA approver is told to update");
  assert.equal((await legacy.json()).code, "QR_APPROVAL_UPDATE_REQUIRED");

  const noCode = await request("/api/auth/qr/approve", {
    method: "POST",
    token: "qr-approver",
    body: { ...body, approved: true },
  });
  assert.equal(noCode.status, 403);
  assert.equal(db.scalar("SELECT approved_at FROM decave_qr_login_challenges WHERE id=?", challenge.challengeId), null);

  const code = await ownerTotpAt(secret, Math.floor(Date.now() / 30_000));
  const approved = await request("/api/auth/qr/approve", {
    method: "POST",
    token: "qr-approver",
    body: { ...body, approved: true, mfaCode: code },
  });
  assert.equal(approved.status, 200);

  const claims = await Promise.all(
    [0, 1].map(() => request("/api/auth/qr/claim", { method: "POST", body: { ...body, client: "desktop" } })),
  );
  const statuses = claims.map((response) => response.status).sort();
  assert.equal(statuses[0], 200);
  assert.notEqual(statuses[1], 200, "a challenge is claimed only once");
  const winner = claims.find((response) => response.status === 200);
  const cookie = winner.headers.get("set-cookie") ?? "";
  assert.doesNotMatch(cookie, /Max-Age|Expires/i, "the QR session cookie is not persistent");
  assert.ok(db.scalar("SELECT claim_id FROM decave_qr_login_challenges WHERE id=?", challenge.challengeId));
  const sessionExpiry = Date.parse(
    db.scalar(
      "SELECT MAX(expires_at) FROM decave_sessions WHERE user_id='qr-user' AND token_hash<>?",
      tokenHash("qr-approver"),
    ),
  );
  assert.ok(sessionExpiry <= Date.now() + 12 * 3600_000 + 60_000, "the QR session is short-lived");
});

test("QR approval without two-factor sign-in needs only the explicit confirm", async () => {
  seedUser("qr-plain");
  seedSession("qr-plain", "qr-plain-session");
  const challenge = await startChallenge();
  const body = { challengeId: challenge.challengeId, secret: challenge.secret };
  const preview = await request("/api/auth/qr/preview", { method: "POST", token: "qr-plain-session", body });
  assert.equal((await preview.json()).mfaRequired, false);
  const approved = await request("/api/auth/qr/approve", {
    method: "POST",
    token: "qr-plain-session",
    body: { ...body, approved: true },
  });
  assert.equal(approved.status, 200);
  const again = await request("/api/auth/qr/preview", { method: "POST", token: "qr-plain-session", body });
  assert.equal(again.status, 400, "an approved challenge cannot be previewed or approved again");
});

test("a 0.1.132 app (no approved field) can approve only for an account without MFA", async () => {
  seedUser("qr-legacy");
  seedSession("qr-legacy", "qr-legacy-session");
  const challenge = await startChallenge();
  const body = { challengeId: challenge.challengeId, secret: challenge.secret };
  const wrong = await request("/api/auth/qr/approve", {
    method: "POST",
    token: "qr-legacy-session",
    body: { ...body, approved: false },
  });
  assert.equal(wrong.status, 400, "a present but non-true approved field is rejected");
  assert.equal((await wrong.json()).code, "QR_APPROVAL_UPDATE_REQUIRED");
  const legacy = await request("/api/auth/qr/approve", { method: "POST", token: "qr-legacy-session", body });
  assert.equal(legacy.status, 200);
  assert.ok(db.scalar("SELECT approved_at FROM decave_qr_login_challenges WHERE id=?", challenge.challengeId));
});

const { revokeAccountSessions } = await import("../../worker/lib/sessions.ts");

async function approvedGrant(id) {
  seedUser(id);
  seedSession(id, id + "-session");
  const challenge = await startChallenge();
  const body = { challengeId: challenge.challengeId, secret: challenge.secret };
  const response = await request("/api/auth/qr/approve", {
    method: "POST",
    token: id + "-session",
    body: { ...body, approved: true },
  });
  assert.equal(response.status, 200);
  return body;
}

test("logout-all removes approved QR and pending MFA grants only for that account", async () => {
  const body = await approvedGrant("qr-revoke");
  const other = await approvedGrant("qr-control");
  db.exec(
    "INSERT INTO decave_user_login_challenges(token_hash,user_id,stay_signed_in,expires_at,created_at) VALUES('pending','qr-revoke',0,?,?)",
    new Date(Date.now() + 60_000).toISOString(),
    now,
  );
  const response = await request("/api/auth/logout-all", { method: "POST", token: "qr-revoke-session" });
  assert.equal(response.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_user_login_challenges WHERE user_id='qr-revoke'"), 0);
  const refused = await request("/api/auth/qr/claim", { method: "POST", body });
  assert.notEqual(refused.status, 200);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='qr-revoke'"), 0);
  const allowed = await request("/api/auth/qr/claim", { method: "POST", body: other });
  assert.equal(allowed.status, 200, "another account's unrevoked grant remains usable");
});

async function interceptWrite(pattern, before, operation) {
  const original = db.prepare;
  let hit = false;
  db.prepare = function (sql) {
    const statement = original.call(this, sql);
    if (pattern.test(sql)) {
      const run = statement.run;
      statement.run = async () => {
        if (!hit) {
          hit = true;
          await before();
        }
        return run();
      };
    }
    return statement;
  };
  try {
    await operation();
    assert.equal(hit, true, "race was exercised");
  } finally {
    db.prepare = original;
  }
}

test("revocation between QR authentication and approval cannot create a grant", async () => {
  seedUser("qr-approve-race");
  seedSession("qr-approve-race", "qr-approve-race-session");
  const challenge = await startChallenge();
  await interceptWrite(
    /UPDATE decave_qr_login_challenges SET user_id=/,
    () => revokeAccountSessions(env, "qr-approve-race", "password_changed"),
    async () => {
      const response = await request("/api/auth/qr/approve", {
        method: "POST",
        token: "qr-approve-race-session",
        body: { challengeId: challenge.challengeId, secret: challenge.secret, approved: true },
      });
      assert.notEqual(response.status, 200);
    },
  );
  assert.equal(db.scalar("SELECT approved_at FROM decave_qr_login_challenges WHERE id=?", challenge.challengeId), null);
});

test("revocation after QR claim but before issuance cannot create a session", async () => {
  const body = await approvedGrant("qr-claim-race");
  await interceptWrite(
    /INSERT INTO decave_sessions/,
    () => revokeAccountSessions(env, "qr-claim-race", "password_reset"),
    async () => {
      const response = await request("/api/auth/qr/claim", { method: "POST", body });
      assert.notEqual(response.status, 200);
    },
  );
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='qr-claim-race'"), 0);
});
