import assert from "node:assert/strict";
import { register } from "node:module";
import { test, after } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { hashPassword, tokenHash } = await import("../../worker/db.ts");

const db = new D1Mock();
const sentEmails = [];
let emailFails = false;
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: {
    send: async (message) => {
      if (emailFails) throw new Error("mail down");
      sentEmails.push(message);
      return { messageId: "test" };
    },
  },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ success: true, count: 0, userIds: [] }) }),
  },
};
after(() => db.sqlite.close());

const now = new Date().toISOString();
const passwordHash = await hashPassword("correct horse battery staple");

function seedUser(id, { role = "user", verified = true } = {}) {
  const email = `${id}@example.test`;
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,
      email_verified_at,requires_email_verification,platform_role,status,must_reset_password)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,'online',0)`,
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
    verified ? now : null,
    verified ? 0 : 1,
    role,
  );
}

seedUser("rv-owner", { role: "owner" });
db.exec(
  "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
  tokenHash("rv-owner-session"),
  "rv-owner",
  new Date(Date.now() + 3600_000).toISOString(),
  now,
);
db.exec(
  "INSERT INTO decave_owner_reauth(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
  tokenHash("rv-reauth"),
  "rv-owner",
  new Date(Date.now() + 600_000).toISOString(),
  now,
);

function resend(target, { reauth = "rv-reauth" } = {}) {
  const headers = new Headers({ authorization: "Bearer rv-owner-session" });
  if (reauth) headers.set("X-DeCave-Owner-Reauth", reauth);
  return handleApi(
    new Request(`https://test.invalid/api/admin/accounts/user-${target}/resend-verification`, {
      method: "POST",
      headers,
    }),
    env,
  );
}

const liveVerifyTokens = (userId) =>
  db.scalar(
    "SELECT COUNT(*) FROM decave_auth_tokens WHERE user_id=? AND purpose='verify_email' AND consumed_at IS NULL",
    userId,
  );

test("an owner can resend the verification email and only the newest link stays usable", async () => {
  seedUser("rv-pending", { verified: false });
  db.exec(
    "INSERT INTO decave_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at) VALUES('old','rv-pending','verify_email','old-hash',?,?)",
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );

  const response = await resend("rv-pending");
  assert.equal(response.status, 200);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "rv-pending@example.test");
  assert.equal(liveVerifyTokens("rv-pending"), 1);
  assert.ok(db.scalar("SELECT consumed_at FROM decave_auth_tokens WHERE id='old'"));

  // The emailed link verifies the account.
  const token = decodeURIComponent(JSON.stringify(sentEmails[0]).match(/#token=([0-9a-f]+)/)[1]);
  const verify = await handleApi(
    new Request("https://test.invalid/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }),
    env,
  );
  assert.equal(verify.status, 200);
  assert.ok(db.scalar("SELECT email_verified_at FROM decave_users WHERE id='rv-pending'"));
});

test("resending is refused without owner re-authentication or for a verified email", async () => {
  seedUser("rv-other", { verified: false });
  assert.equal((await resend("rv-other", { reauth: "" })).status, 428);

  seedUser("rv-done");
  const response = await resend("rv-done");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "admin.verificationNotNeeded");
});

test("a failed send leaves no usable link behind", async () => {
  seedUser("rv-fail", { verified: false });
  emailFails = true;
  try {
    const response = await resend("rv-fail");
    assert.equal(response.status, 502);
    assert.equal(liveVerifyTokens("rv-fail"), 0);
  } finally {
    emailFails = false;
  }
});
