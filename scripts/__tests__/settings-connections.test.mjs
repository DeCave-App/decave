import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");

const NOW = "2099-01-01T00:00:00.000Z";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");
const tokenFor = (userId) => `connections-token-${userId}`;
const pub = (userId) => `DC-${userId.slice(1).padStart(16, "0")}`;

const db = new D1Mock();
for (const userId of ["u1", "u2"]) {
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    userId,
    `user-${userId}`,
    "salt",
    "hash",
    NOW,
    pub(userId),
    "",
    "online",
    "",
    "",
    "#7c5cff",
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hashToken(tokenFor(userId)),
    userId,
    "2100-01-01T00:00:00.000Z",
    NOW,
  );
}
db.exec("INSERT INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2',?)", NOW);
db.exec(
  "INSERT INTO decave_twitch_member_links(user_id,twitch_user_id,login,refresh_token_enc,linked_at,checked_at) VALUES('u1','tw1','streamer_one','x',?,?)",
  NOW,
  NOW,
);

const baseEnv = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  TWITCH_CLIENT_ID: "twitch-client",
  TWITCH_CLIENT_SECRET: "twitch-secret",
  TWITCH_EVENTSUB_SECRET: "eventsub-secret-123",
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ userIds: [], count: 0, success: true }) }),
  },
};

async function api(pathname, userId, { method = "GET", body, env = baseEnv } = {}) {
  const headers = new Headers();
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
  return { response, data: await response.json().catch(() => null) };
}

test("connections list every provider with its link and visibility", async () => {
  const { response, data } = await api("/api/account/connections", "u1");
  assert.equal(response.status, 200);
  assert.deepEqual(
    data.connections.map((item) => item.provider),
    ["steam", "twitch", "faceit"],
  );
  const twitch = data.connections.find((item) => item.provider === "twitch");
  assert.deepEqual(twitch, {
    provider: "twitch",
    linked: true,
    displayName: "streamer_one",
    showOnProfile: false,
    available: true,
  });
  const steam = data.connections.find((item) => item.provider === "steam");
  assert.equal(steam.linked, false);
  assert.equal(steam.available, true);
  assert.equal((await api("/api/account/connections", null)).response.status, 401);
});

test("FACEIT is unavailable without its client id", async () => {
  const { data } = await api("/api/account/connections", "u1");
  assert.equal(data.connections.find((item) => item.provider === "faceit").available, false);
  const configured = await api("/api/account/connections", "u1", { env: { ...baseEnv, FACEIT_CLIENT_ID: "fc" } });
  assert.equal(configured.data.connections.find((item) => item.provider === "faceit").available, true);
});

test("show on profile is saved and only then shown to other people", async () => {
  const before = await api(`/api/users/${pub("u1")}/profile`, "u2");
  assert.equal(before.response.status, 200);
  assert.deepEqual(before.data.connections, []);

  const saved = await api("/api/account/connections/twitch/visibility", "u1", {
    method: "PUT",
    body: { showOnProfile: true },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.showOnProfile, true);
  const mine = await api("/api/account/connections", "u1");
  assert.equal(mine.data.connections.find((item) => item.provider === "twitch").showOnProfile, true);

  const after = await api(`/api/users/${pub("u1")}/profile`, "u2");
  assert.deepEqual(after.data.connections, [{ provider: "twitch", displayName: "streamer_one" }]);

  // A visible but unlinked provider is never shown.
  await api("/api/account/connections/steam/visibility", "u1", { method: "PUT", body: { showOnProfile: true } });
  const still = await api(`/api/users/${pub("u1")}/profile`, "u2");
  assert.deepEqual(
    still.data.connections.map((item) => item.provider),
    ["twitch"],
  );
});

test("unknown providers and users are 404 with an error code", async () => {
  const unknown = await api("/api/account/connections/myspace/visibility", "u1", {
    method: "PUT",
    body: { showOnProfile: true },
  });
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.data.code, "connections.unknownProvider");
  const bad = await api("/api/account/connections/twitch/visibility", "u1", { method: "PUT", body: { nope: 1 } });
  assert.equal(bad.response.status, 400);
  const nobody = await api("/api/users/DC-9999999999999999/profile", "u2");
  assert.equal(nobody.response.status, 404);
});
