import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi, describeSessionDevice } = await import("../../worker/index.ts");
const { hashPassword } = await import("../../worker/db.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const settings = await import("../../src/features/settings/extraSettings.ts");

const NOW = "2099-01-01T00:00:00.000Z";
const PASSWORD = "correct horse battery staple";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `settings-token-${userId}`;
const pub = (userId) => `DC-${userId.slice(1).padStart(16, "0")}`;

const db = new D1Mock();
const { salt, hash } = await hashPassword(PASSWORD);
for (const userId of ["u1", "u2", "u3"]) {
  db.exec(
    `INSERT INTO decave_users
     (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
      email,email_normalized,email_verified_at,requires_email_verification,platform_role,
      suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId,
    `user-${userId}`,
    salt,
    hash,
    NOW,
    pub(userId),
    "",
    "online",
    "",
    "",
    "#7c5cff",
    `${userId}@example.test`,
    `${userId}@example.test`,
    NOW,
    0,
    "user",
    null,
    null,
    "",
    0,
    null,
    null,
    "",
    null,
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken(tokenFor(userId)),
    userId,
    "2100-01-01T00:00:00.000Z",
    NOW,
  );
  // A mobile session, so the web sign-ins below (which replace web/legacy
  // sessions) leave the API session these tests use alone.
  db.exec(
    "INSERT INTO decave_session_clients(token_hash,user_id,client,device_label,created_at) VALUES(?,?,?,?,?)",
    hashToken(tokenFor(userId)),
    userId,
    "mobile",
    "Mobile app",
    NOW,
  );
}
// u1 and u2 are friends who have exchanged DMs; u3 is a stranger.
db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2',?)", NOW);
db.exec(
  "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES('m1','u1','u2','hello from u1',?)",
  NOW,
);
db.exec(
  "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES('m2','u2','u1','secret reply from u2',?)",
  NOW,
);

const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: { send: async () => ({ messageId: "test" }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  OWNER_MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/internal/online-users" || url.pathname === "/internal/count")
          return Response.json({ userIds: [], count: 0 });
        return Response.json({ success: true });
      },
    }),
  },
};

async function api(pathname, userId, { method = "GET", body, headers: extra = {} } = {}) {
  const headers = new Headers(extra);
  if (userId) headers.set("authorization", `Bearer ${tokenFor(userId)}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await handleApi(
    new Request(`https://test.invalid${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return {
    response,
    data: await response
      .clone()
      .json()
      .catch(() => null),
  };
}

// RFC 6238 TOTP, matching the Worker's SHA-1 / 6 digits / 30 s parameters.
function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    acc = 0;
  const out = [];
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    acc = (acc << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret, offsetSteps = 0) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const code =
    ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

async function login(email) {
  return api("/api/auth/login", null, {
    method: "POST",
    body: { identifier: email, password: PASSWORD, turnstileToken: "test", client: "web" },
  });
}

let secret = "";
let recoveryCodes = [];

test("two-factor setup needs the password and a valid code, then returns recovery codes", async () => {
  assert.deepEqual((await api("/api/account/mfa", "u1")).data, {
    enabled: false,
    enabledAt: null,
    recoveryCodesRemaining: 0,
  });
  assert.equal(
    (await api("/api/account/mfa/setup", "u1", { method: "POST", body: { currentPassword: "wrong" } })).response.status,
    403,
  );

  const setup = await api("/api/account/mfa/setup", "u1", { method: "POST", body: { currentPassword: PASSWORD } });
  assert.equal(setup.response.status, 200);
  secret = setup.data.secret;
  assert.match(setup.data.otpauth, /^otpauth:\/\/totp\/DeCave:/);
  assert.equal((await api("/api/account/mfa", "u1")).data.enabled, false, "setup alone does not turn it on");

  assert.equal(
    (
      await api("/api/account/mfa/enable", "u1", {
        method: "POST",
        body: { code: "000000" === totp(secret) ? "111111" : "000000" },
      })
    ).response.status,
    403,
  );
  const enabled = await api("/api/account/mfa/enable", "u1", { method: "POST", body: { code: totp(secret) } });
  assert.equal(enabled.response.status, 200);
  recoveryCodes = enabled.data.recoveryCodes;
  assert.equal(recoveryCodes.length, 10);
  assert.ok(recoveryCodes.every((code) => /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code)));
  const status = (await api("/api/account/mfa", "u1")).data;
  assert.equal(status.enabled, true);
  assert.equal(status.recoveryCodesRemaining, 10);
});

test("sign-in with two-factor on issues a challenge instead of a session", async () => {
  const first = await login("u1@example.test");
  assert.equal(first.response.status, 200);
  assert.equal(first.data.mfaRequired, true);
  assert.equal(first.data.mfaKind, "user");
  assert.equal(first.data.user, undefined, "no account data before the second factor");
  assert.equal(first.response.headers.get("set-cookie"), null, "no session cookie before the second factor");

  const bad = await api("/api/auth/mfa-login", null, {
    method: "POST",
    body: { challengeToken: first.data.challengeToken, mfaCode: "12345" },
  });
  assert.equal(bad.response.status, 403);

  const attempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      api("/api/auth/mfa-login", null, {
        method: "POST",
        body: { challengeToken: first.data.challengeToken, mfaCode: totp(secret, 1) },
      }),
    ),
  );
  assert.deepEqual(
    attempts.map(({ response }) => response.status).sort(),
    [200, 403],
    "concurrent requests can redeem the same TOTP timestep only once",
  );
  const good = attempts.find(({ response }) => response.status === 200);
  assert.ok(good);
  assert.equal(good.response.status, 200);
  assert.equal(good.data.user.username, "user-u1");
  assert.ok(good.response.headers.get("set-cookie"));

  const replayChallenge = await login("u1@example.test");
  const replayedTotp = await api("/api/auth/mfa-login", null, {
    method: "POST",
    body: { challengeToken: replayChallenge.data.challengeToken, mfaCode: totp(secret, 1) },
  });
  assert.equal(replayedTotp.response.status, 403, "a TOTP timestep cannot authenticate twice");

  const replay = await api("/api/auth/mfa-login", null, {
    method: "POST",
    body: { challengeToken: first.data.challengeToken, mfaCode: totp(secret) },
  });
  assert.equal(replay.response.status, 401, "a challenge works once");
});

test("a recovery code signs in once and then stops working", async () => {
  const code = recoveryCodes[0];
  const first = await login("u1@example.test");
  const used = await api("/api/auth/mfa-login", null, {
    method: "POST",
    body: { challengeToken: first.data.challengeToken, mfaCode: code.toLowerCase() },
  });
  assert.equal(used.response.status, 200);
  assert.equal(used.data.recoveryCodesRemaining, 9);

  const second = await login("u1@example.test");
  const reused = await api("/api/auth/mfa-login", null, {
    method: "POST",
    body: { challengeToken: second.data.challengeToken, mfaCode: code },
  });
  assert.equal(reused.response.status, 403);
});

test("accounts without two-factor still sign in directly", async () => {
  const result = await login("u2@example.test");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.mfaRequired, undefined);
  assert.equal(result.data.user.username, "user-u2");
});

test("new recovery codes and turning two-factor off need the password and a code", async () => {
  assert.equal(
    (
      await api("/api/account/mfa/recovery-codes", "u1", {
        method: "POST",
        body: { currentPassword: PASSWORD, code: "000000" === totp(secret) ? "111111" : "000000" },
      })
    ).response.status,
    403,
  );
  const fresh = await api("/api/account/mfa/recovery-codes", "u1", {
    method: "POST",
    body: { currentPassword: PASSWORD, code: recoveryCodes[1] },
  });
  assert.equal(fresh.response.status, 200);
  assert.equal(fresh.data.recoveryCodes.length, 10);
  const first = await login("u1@example.test");
  assert.equal(
    (
      await api("/api/auth/mfa-login", null, {
        method: "POST",
        body: { challengeToken: first.data.challengeToken, mfaCode: recoveryCodes[1] },
      })
    ).response.status,
    403,
    "old codes stop working",
  );

  assert.equal(
    (
      await api("/api/account/mfa/disable", "u1", {
        method: "POST",
        body: { currentPassword: "wrong", code: fresh.data.recoveryCodes[0] },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await api("/api/account/mfa/disable", "u1", {
        method: "POST",
        body: { currentPassword: PASSWORD, code: fresh.data.recoveryCodes[0] },
      })
    ).response.status,
    200,
  );
  const after = await login("u1@example.test");
  assert.equal(after.data.mfaRequired, undefined);
  assert.equal(after.data.user.username, "user-u1");
});

test("data export contains your own messages and direct messages you received", async () => {
  const { response } = await api("/api/account/export", "u1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="decave-data-/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const text = await response.text();
  const data = JSON.parse(text);
  assert.equal(data.account.username, "user-u1");
  assert.deepEqual(
    data.friends.map((friend) => friend.username),
    ["user-u2"],
  );
  assert.deepEqual(
    data.directMessagesSent.map((message) => message.text),
    ["hello from u1"],
  );
  assert.equal(data.complete, true);
  // Direct messages received are part of the account holder's own
  // conversations (access/portability); they are listed separately.
  assert.deepEqual(
    data.directMessagesReceived.map((message) => [message.sender, message.text]),
    [["user-u2", "secret reply from u2"]],
  );
  assert.ok(!text.includes(hash), "never includes the password hash");
});

test("profile display name and pronouns are cleaned and saved", async () => {
  const { data } = await api("/api/profile", "u1", {
    method: "PUT",
    body: { displayName: "  Ilias​   The\u0007Great  ", pronouns: "he/him".repeat(10) },
  });
  assert.equal(data.user.displayName, "Ilias TheGreat");
  assert.equal(data.user.pronouns.length, 24);
  const unchanged = await api("/api/profile", "u1", { method: "PUT", body: { bio: "hi" } });
  assert.equal(unchanged.data.user.displayName, "Ilias TheGreat", "omitting the fields keeps them");
});

test("banners upload through the API and are only served to people who share context", async () => {
  const png = "data:image/png;base64," + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");
  const uploaded = await api("/api/profile/banner", "u1", { method: "PUT", body: { imageDataUrl: png } });
  assert.equal(uploaded.response.status, 200);
  assert.match(uploaded.data.user.bannerUrl, new RegExp(`^/api/users/${pub("u1")}/banner\\?v=`));
  assert.ok(!uploaded.data.user.bannerUrl.includes("u1/"), "the internal account id never appears in the URL");
  assert.equal((await api(`/api/users/${pub("u1")}/banner`, "u1")).response.status, 200, "you can see your own banner");
  assert.equal((await api(`/api/users/${pub("u1")}/banner`, "u3")).response.status, 403, "strangers cannot");
  assert.equal(
    (await api("/api/profile/banner", "u1", { method: "PUT", body: { imageDataUrl: "data:image/gif;base64,AAAA" } }))
      .response.status,
    400,
  );
  const removed = await api("/api/profile/banner", "u1", { method: "DELETE" });
  assert.equal(removed.data.user.bannerUrl, null);
});

test("session names describe the browser, system and country", () => {
  const chromeWin =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
  assert.equal(describeSessionDevice(chromeWin, "web", "GR"), "Chrome on Windows · Greece");
  assert.equal(
    describeSessionDevice(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "web",
      "",
    ),
    "Safari on macOS",
  );
  assert.equal(
    describeSessionDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) DeCave/0.1.120 Electron/31", "desktop", "XX"),
    "DeCave Desktop on macOS",
  );
  assert.equal(describeSessionDevice("", "mobile", "T1"), "DeCave Mobile");
});

test("quiet hours handle windows that cross midnight and let mentions through when asked", () => {
  const at = (h, m = 0) => new Date(2030, 0, 1, h, m);
  const night = { enabled: true, start: "23:00", end: "08:00", allowMentions: true };
  assert.equal(settings.isWithinQuietHours(night, at(23, 30)), true);
  assert.equal(settings.isWithinQuietHours(night, at(3)), true);
  assert.equal(settings.isWithinQuietHours(night, at(8)), false);
  assert.equal(settings.isWithinQuietHours(night, at(12)), false);
  assert.equal(settings.isWithinQuietHours({ ...night, enabled: false }, at(3)), false);
  assert.equal(settings.isWithinQuietHours({ ...night, start: "13:00", end: "15:00" }, at(14)), true);
  assert.equal(settings.quietHoursSilences(night, "dm", at(3)), false);
  assert.equal(settings.quietHoursSilences(night, "mention", at(3)), false);
  assert.equal(settings.quietHoursSilences(night, "other", at(3)), true);
  assert.equal(settings.quietHoursSilences({ ...night, allowMentions: false }, "dm", at(3)), true);
});

test("extra settings normalise bad input and follow the system theme only when asked", () => {
  const skins = ["nebula", "bright", "pearl"];
  const parsed = settings.normalizeExtraSettings(
    {
      themeMode: "system",
      lightSkin: "nope",
      darkSkin: "pearl",
      outputVolume: 999,
      quietHours: { start: "25:00", end: "07:30" },
    },
    skins,
  );
  assert.equal(parsed.lightSkin, "bright");
  assert.equal(parsed.darkSkin, "pearl");
  assert.equal(parsed.outputVolume, 200);
  assert.equal(parsed.quietHours.start, "23:00");
  assert.equal(parsed.quietHours.end, "07:30");
  assert.equal(settings.resolveSkin(parsed, "nebula", true), "pearl");
  assert.equal(settings.resolveSkin(parsed, "nebula", false), "bright");
  assert.equal(settings.resolveSkin({ ...parsed, themeMode: "manual" }, "nebula", false), "nebula");
  assert.equal(settings.motionReduced({ ...parsed, motion: "system" }, true), true);
  assert.equal(settings.motionReduced({ ...parsed, motion: "full" }, true), false);
  assert.equal(settings.detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)"), "mac");
  assert.equal(settings.platformName(settings.detectPlatform("", "Win32")), "Windows");
});
