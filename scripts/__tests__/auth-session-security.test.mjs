import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi, HubRoom } = await import("../../worker/index.ts");
const sessions = await import("../../worker/lib/sessions.ts");
const push = await import("../../worker/push.ts");
const pushPolicy = await import("../../worker/push-policy.ts");
const { hashPassword } = await import("../../worker/db.ts");
const { verifySteamOpenIdCallback } = await import("../../worker/lib/activity.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");

const now = "2099-01-01T00:00:00.000Z";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const db = new D1Mock();
const broadcasts = [];
let failBroadcast = false;
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
        const payload = await request
          .clone()
          .json()
          .catch(() => null);
        if (failBroadcast && new URL(request.url).pathname === "/internal/broadcast")
          throw new Error("simulated Durable Object RPC failure");
        broadcasts.push(payload);
        return Response.json({ success: true });
      },
    }),
  },
};

function seedUser(id, { role = "user", salt = "salt", passwordHash = "hash" } = {}) {
  db.exec(
    `INSERT INTO decave_users
     (id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,platform_role,status,
      must_reset_password,deleted_at,erased_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,0,NULL,NULL)`,
    id,
    `user-${id}`,
    salt,
    passwordHash,
    now,
    `DC-${id.slice(1).padStart(16, "0")}`,
    `${id}@example.test`,
    `${id}@example.test`,
    role,
    "online",
  );
}

function seedSession(userId, rawToken) {
  const sessionHash = hash(rawToken);
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    sessionHash,
    userId,
    "2100-01-01T00:00:00.000Z",
    now,
  );
  return sessionHash;
}

function socketState(userId, sessionHash, overrides = {}) {
  return {
    connectionId: `connection-${userId}`,
    peerAddress: "test",
    authDeadlineAt: 0,
    client: "web",
    userId,
    sessionHash,
    username: `user-${userId}`,
    serverId: 0,
    channelId: 0,
    voiceChannelId: null,
    voiceMuted: false,
    voiceDeafened: false,
    voiceServerMuted: false,
    voiceServerDeafened: false,
    screenSharing: false,
    allowStreamPreview: true,
    cameraSharing: false,
    dmCallId: null,
    dmCallPeerUserId: null,
    dmCallPeerConnectionId: null,
    dmCallIncoming: false,
    dmCallAccepted: false,
    dmCallVideo: false,
    identifiedAt: Date.now(),
    identifyFailures: 0,
    rateLimitViolations: 0,
    lastPresenceTouchAt: 0,
    ...overrides,
  };
}

class FakeSocket {
  constructor(state) {
    this.attachment = state;
    this.sent = [];
    this.closed = [];
  }
  serializeAttachment(value) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close(code, reason) {
    this.closed.push({ code, reason });
  }
}

function roomFor(sockets) {
  const ctx = {
    getWebSockets: () => sockets,
    acceptWebSocket() {},
    storage: { async setAlarm() {}, async deleteAlarm() {} },
  };
  return new HubRoom(ctx, env);
}

test("public realtime presence omits invisible users and batches more than 100 socket identities", async () => {
  const sockets = [];
  let expectedVoice44 = 0;
  let expectedVoice45 = 0;
  for (let index = 0; index < 110; index += 1) {
    const userId = `presence-${String(index).padStart(3, "0")}`;
    seedUser(userId);
    const invisible = index % 10 === 0;
    if (invisible) db.exec("UPDATE decave_users SET status='invisible' WHERE id=?", userId);
    else if (index % 2 === 0) expectedVoice44 += 1;
    else expectedVoice45 += 1;
    sockets.push(new FakeSocket(socketState(userId, hash(userId), { voiceChannelId: index % 2 === 0 ? 44 : 45 })));
  }
  sockets.push(new FakeSocket(socketState("presence-001", hash("presence-001"), { voiceChannelId: 45 })));

  const room = roomFor(sockets);
  const online = await room.fetch(new Request("https://hub.invalid/internal/online-users"));
  assert.equal(online.status, 200);
  const onlineData = await online.json();
  assert.equal(onlineData.userIds.length, 99);
  assert.equal(onlineData.userIds.includes("presence-000"), false);
  assert.equal(onlineData.userIds.includes("presence-001"), true);
  assert.deepEqual(Object.keys(onlineData).sort(), ["userIds"]);

  const countResponse = await room.fetch(
    new Request("https://hub.invalid/internal/count", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  assert.deepEqual(await countResponse.json(), { count: 99 });
  const voiceResponse = await room.fetch(
    new Request("https://hub.invalid/internal/voice-counts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelIds: [44, 45] }),
    }),
  );
  assert.deepEqual(await voiceResponse.json(), { counts: { 44: expectedVoice44, 45: expectedVoice45 } });
});

test("Steam OpenID accepts a valid assertion without optional realm but pins the callback and endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n");
  };
  const state = "trusted-state-42";
  const returnTo = `https://app.example.test/api/integrations/steam/callback?state=${state}`;
  const callback = new URL("https://app.example.test/api/integrations/steam/callback");
  callback.searchParams.set("state", state);
  callback.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  callback.searchParams.set("openid.mode", "id_res");
  callback.searchParams.set("openid.return_to", returnTo);
  callback.searchParams.set("openid.op_endpoint", "https://steamcommunity.com/openid/login");
  callback.searchParams.set("openid.claimed_id", "https://steamcommunity.com/openid/id/76561198000000000");
  callback.searchParams.set("openid.identity", "https://steamcommunity.com/openid/id/76561198000000000");

  try {
    assert.equal(await verifySteamOpenIdCallback(callback), "76561198000000000");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://steamcommunity.com/openid/login");
    assert.match(requests[0].init.body, /openid\.mode=check_authentication/);

    const changedReturn = new URL(callback);
    changedReturn.searchParams.set("openid.return_to", "https://attacker.example/callback");
    assert.equal(await verifySteamOpenIdCallback(changedReturn), null);
    const changedEndpoint = new URL(callback);
    changedEndpoint.searchParams.set("openid.op_endpoint", "https://attacker.example/openid/login");
    assert.equal(await verifySteamOpenIdCallback(changedEndpoint), null);
    assert.equal(requests.length, 1, "untrusted callbacks are rejected before contacting Steam");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function api(path, rawToken, { method = "GET", body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (rawToken) requestHeaders.set("authorization", `Bearer ${rawToken}`);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  const response = await handleApi(
    new Request(`https://test.invalid${path}`, {
      method,
      headers: requestHeaders,
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

test("single-session revocation removes only that session's push and websocket credentials", async () => {
  seedUser("u1");
  seedUser("u2");
  const firstHash = seedSession("u1", "u1-session-one");
  const peerHash = seedSession("u1", "u1-session-two");
  seedSession("u2", "u2-session");
  db.exec(
    "INSERT INTO decave_ws_tokens(token_hash,user_id,session_hash,expires_at,created_at,used_at) VALUES(?,?,?,?,?,NULL)",
    hash("ws-one"),
    "u1",
    firstHash,
    "2100-01-01T00:00:00.000Z",
    now,
  );
  db.exec(
    "INSERT INTO decave_ws_tokens(token_hash,user_id,session_hash,expires_at,created_at,used_at) VALUES(?,?,?,?,?,NULL)",
    hash("ws-two"),
    "u1",
    peerHash,
    "2100-01-01T00:00:00.000Z",
    now,
  );
  db.exec(
    "INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES(?,?,?,?,?)",
    "ExpoPushToken[aaaaaaaaaaaaaaaaaaaa]",
    "u1",
    firstHash,
    "ios",
    now,
  );
  db.exec(
    "INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES(?,?,?,?,?)",
    "ExpoPushToken[bbbbbbbbbbbbbbbbbbbb]",
    "u1",
    peerHash,
    "ios",
    now,
  );

  failBroadcast = true;
  await assert.rejects(sessions.revokeSession(env, firstHash, "logout"), /simulated Durable Object RPC failure/);
  failBroadcast = false;
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE user_id='u1'"), 1);
  assert.equal(db.scalar("SELECT token_hash FROM decave_sessions WHERE user_id='u1'"), peerHash);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_ws_tokens WHERE session_hash=?", firstHash), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_ws_tokens WHERE session_hash=?", peerHash), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_push_tokens WHERE session_hash=?", firstHash), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_push_tokens WHERE session_hash=?", peerHash), 1);
});

test("push registration and delivery reject sessions claimed by account erasure", async () => {
  seedUser("u6");
  const sessionHash = seedSession("u6", "u6-session");
  db.exec("UPDATE decave_users SET erasure_started_at=? WHERE id='u6'", now);
  assert.equal(await sessions.isActiveSession(env, "u6", sessionHash), false);

  const token = "ExpoPushToken[cccccccccccccccccccc]";
  await push.registerPushToken(env, "u6", sessionHash, token, "ios");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_push_tokens WHERE user_id='u6'"), 0);

  // A pre-existing session-bound row must also be filtered at delivery time.
  db.exec(
    "INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES(?,?,?,?,?)",
    token,
    "u6",
    sessionHash,
    "ios",
    now,
  );
  const originalFetch = globalThis.fetch;
  let deliveries = 0;
  globalThis.fetch = async () => {
    deliveries++;
    return new Response("[]", { status: 200 });
  };
  try {
    await push.sendPush(env, ["u6"], { title: "Test", body: "Test", route: "/" });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(deliveries, 0);
});

test("push stale-token cleanup handles more than forty expired registrations", async () => {
  seedUser("u8");
  const sessionHash = seedSession("u8", "u8-session");
  for (let index = 0; index < 45; index++) {
    db.exec(
      "INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES(?,?,?,?,?)",
      `ExpoPushToken[stale${String(index).padStart(10, "0")}]`,
      "u8",
      sessionHash,
      "ios",
      now,
    );
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: payload.map(() => ({ details: { error: "DeviceNotRegistered" } })) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await push.sendPush(env, ["u8"], { title: "Test", body: "Test", route: "/" });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_push_tokens WHERE user_id='u8'"), 0);
});

test("hibernated revoked sockets cannot receive fanout, profile, voice, or direct-call events", async () => {
  const staleHash = hash("u1-session-one");
  const activeHash = hash("u2-session");
  db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2',?)", now);
  const stale = new FakeSocket(socketState("u1", staleHash, { voiceChannelId: 44 }));
  const active = new FakeSocket(socketState("u2", activeHash));
  const peer = new FakeSocket(socketState("u1", hash("u1-session-two"), { identifiedAt: Date.now() + 1000 }));
  const room = roomFor([stale, active, peer]);

  await room.fetch(
    new Request("https://internal.decave/internal/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: { type: "PRIVATE_EVENT", value: "private" } }),
    }),
  );
  assert.equal(stale.closed.length, 1, "a persisted stale attachment is closed even when the revoke RPC failed");
  assert.ok(stale.sent.some((event) => event.type === "SESSION_REVOKED"));
  assert.ok(!stale.sent.some((event) => event.type === "PRIVATE_EVENT"));
  assert.ok(active.sent.some((event) => event.type === "PRIVATE_EVENT"));

  stale.sent.length = 0;
  active.sent.length = 0;
  await room["broadcastUsers"]();
  await room["broadcastVoiceState"]();
  assert.ok(!stale.sent.some((event) => ["USERS_UPDATE", "SERVERS_UPDATE", "VOICE_STATE"].includes(event.type)));
  assert.ok(active.sent.some((event) => event.type === "USERS_UPDATE"));
  assert.ok(active.sent.some((event) => event.type === "VOICE_STATE"));

  stale.sent.length = 0;
  active.sent.length = 0;
  peer.sent.length = 0;
  stale.attachment = { ...stale.attachment, voiceChannelId: null, identifiedAt: Date.now() + 2000 };
  await room.webSocketMessage(active, JSON.stringify({ type: "DM_CALL_START", targetUserId: "DC-0000000000000001" }));
  assert.ok(!stale.sent.some((event) => event.type === "DM_CALL_INCOMING"));
  assert.ok(peer.sent.some((event) => event.type === "DM_CALL_INCOMING"));
  assert.ok(active.sent.some((event) => event.type === "DM_CALL_RINGING"));
});

test("legacy authenticated attachment without a persisted session hash is rejected", async () => {
  const legacy = new FakeSocket(socketState("u2", null));
  const room = roomFor([legacy]);
  await room.webSocketMessage(legacy, JSON.stringify({ type: "PING" }));
  assert.ok(legacy.closed.some((entry) => entry.code === 4001));
  assert.ok(legacy.sent.some((event) => event.type === "SESSION_REVOKED"));
  assert.ok(!legacy.sent.some((event) => event.type === "PONG"));
});

test("server push policy defaults previews hidden and enforces the Hub-message toggle", () => {
  const settings = pushPolicy.pushSettingsFromJson(JSON.stringify({ notifications: { hubMessages: false } }));
  assert.equal(settings.preview, "hidden");
  assert.equal(pushPolicy.shouldPush(settings, { kind: "mention", hubId: 1, roomId: 10 }), false);
  assert.deepEqual(pushPolicy.pushText(settings, "Alice", "#general", "secret text"), {
    title: "DeCave",
    body: "New message in a Hub",
  });
});

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let acc = 0;
  const out = [];
  for (const char of value) {
    acc = (acc << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const code =
    ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

test("enrolled owner MFA replacement needs a factor and always clears old recovery and reauth rows", async () => {
  const password = "correct horse battery staple";
  const credentials = await hashPassword(password);
  seedUser("u3", { role: "owner", salt: credentials.salt, passwordHash: credentials.hash });
  const ownerToken = "owner-session";
  seedSession("u3", ownerToken);

  const bootstrap = await api("/api/admin/security/mfa/setup", ownerToken, {
    method: "POST",
    body: { currentPassword: password },
  });
  assert.equal(bootstrap.response.status, 200, "pending MFA bootstrap remains password-only");
  const enabled = await api("/api/admin/security/mfa/enable", ownerToken, {
    method: "POST",
    body: { code: totp(bootstrap.data.secret) },
  });
  assert.equal(enabled.response.status, 200);

  for (const recoveryCount of [10, 1, 0]) {
    if (recoveryCount !== 10) {
      const codes = db.sqlite
        .prepare("SELECT id FROM decave_owner_recovery_codes WHERE user_id='u3' ORDER BY id")
        .all();
      for (const row of codes.slice(recoveryCount))
        db.exec("DELETE FROM decave_owner_recovery_codes WHERE id=?", row.id);
    }
    const reauth = `reauth-${recoveryCount}`;
    db.exec(
      "INSERT INTO decave_owner_reauth(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
      hash(reauth),
      "u3",
      "2100-01-01T00:00:00.000Z",
      now,
    );
    const beforeSecret = db.scalar("SELECT secret_ciphertext FROM decave_owner_mfa WHERE user_id='u3'");

    const passwordOnly = await api("/api/admin/security/mfa/setup", ownerToken, {
      method: "POST",
      body: { currentPassword: password },
    });
    assert.equal(passwordOnly.response.status, 428, "password-only replacement cannot bypass the enrolled factor");
    assert.equal(db.scalar("SELECT secret_ciphertext FROM decave_owner_mfa WHERE user_id='u3'"), beforeSecret);
    assert.equal(db.scalar("SELECT COUNT(*) FROM decave_owner_reauth WHERE token_hash=?", hash(reauth)), 1);

    const replacement = await api("/api/admin/security/mfa/setup", ownerToken, {
      method: "POST",
      headers: { "X-DeCave-Owner-Reauth": reauth },
      body: { currentPassword: password },
    });
    assert.equal(replacement.response.status, 200);
    assert.notEqual(db.scalar("SELECT secret_ciphertext FROM decave_owner_mfa WHERE user_id='u3'"), beforeSecret);
    assert.equal(db.scalar("SELECT COUNT(*) FROM decave_owner_recovery_codes WHERE user_id='u3'"), 0);
    assert.equal(db.scalar("SELECT COUNT(*) FROM decave_owner_reauth WHERE user_id='u3'"), 0);

    if (recoveryCount !== 0) {
      const enabledAgain = await api("/api/admin/security/mfa/enable", ownerToken, {
        method: "POST",
        body: { code: totp(replacement.data.secret) },
      });
      assert.equal(enabledAgain.response.status, 200);
    }
  }
});
