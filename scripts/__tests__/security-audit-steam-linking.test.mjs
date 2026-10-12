import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");

const hash = (value) => createHash("sha256").update(value).digest("hex");

function createContext() {
  const db = new D1Mock();
  const env = {
    DB: db,
    MEDIA: new MediaMock(),
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  return { db, env };
}

function seedUser(db, id) {
  db.exec(
    `INSERT INTO decave_users
     (id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,platform_role,status,
      must_reset_password,deleted_at,erased_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,0,NULL,NULL)`,
    id,
    `user-${id}`,
    "salt",
    "hash",
    new Date().toISOString(),
    `DC-${id}`,
    `${id}@example.test`,
    `${id}@example.test`,
    "user",
    "online",
  );
}

function seedSession(db, userId, token, expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()) {
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hash(token),
    userId,
    expiresAt,
    new Date().toISOString(),
  );
}

function steamAssertion(returnTo, steamId) {
  const callback = new URL(returnTo);
  const claimedId = `https://steamcommunity.com/openid/id/${steamId}`;
  callback.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  callback.searchParams.set("openid.mode", "id_res");
  callback.searchParams.set("openid.return_to", returnTo);
  callback.searchParams.set("openid.realm", new URL(returnTo).origin);
  callback.searchParams.set("openid.op_endpoint", "https://steamcommunity.com/openid/login");
  callback.searchParams.set("openid.claimed_id", claimedId);
  callback.searchParams.set("openid.identity", claimedId);
  callback.searchParams.set("openid.signed", "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle");
  callback.searchParams.set("openid.sig", "c2lnbmVkLWFzc2VydGlvbi1maXh0dXJl");
  callback.searchParams.set("openid.response_nonce", "2026-10-10T12:00:00Zsynthetic-nonce");
  callback.searchParams.set("openid.assoc_handle", "{HMAC-SHA256}{synthetic-association}");
  return callback;
}

async function beginSteamLink({ env }, sessionToken) {
  const response = await handleApi(
    new Request("https://app.example.test/api/integrations/steam/connect", {
      method: "POST",
      headers: { cookie: `__Host-decave_session=${sessionToken}` },
    }),
    env,
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  const steamOpenIdUrl = new URL(data.url);
  const returnTo = steamOpenIdUrl.searchParams.get("openid.return_to");
  assert.ok(returnTo);
  return {
    state: new URL(returnTo).searchParams.get("state"),
    callback: steamAssertion(returnTo, "76561198000000000"),
  };
}

function callbackRequest(callback, { cookie, authorization } = {}) {
  const headers = { "Sec-Fetch-Site": "cross-site" };
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  return new Request(callback, { headers });
}

function mockSteamVerification() {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    assert.equal(String(input), "https://steamcommunity.com/openid/login");
    const submitted = new URLSearchParams(init.body);
    assert.equal(submitted.get("openid.mode"), "check_authentication");
    assert.equal(submitted.get("openid.sig"), "c2lnbmVkLWFzc2VydGlvbi1maXh0dXJl");
    assert.equal(
      submitted.get("openid.signed"),
      "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    );
    return new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n");
  };
  return { requests, restore: () => (globalThis.fetch = originalFetch) };
}

async function invokeCallback(context, callback, options) {
  return handleApi(callbackRequest(callback, options), context.env);
}

function storedLink(db, steamId = "76561198000000000") {
  return db.sqlite.prepare("SELECT user_id,steam_id FROM decave_steam_links WHERE steam_id=?").get(steamId);
}

test("Steam callback rejects a forwarded state URL without a completing-browser session", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedSession(context.db, "attacker", "attacker-session-token");
  const { state, callback } = await beginSteamLink(context, "attacker-session-token");
  const verifier = mockSteamVerification();

  try {
    const response = await invokeCallback(context, callback);
    const page = await response.text();
    assert.equal(response.status, 400);
    assert.match(page, /Steam was not linked/);
    assert.match(page, /sign in to the same account that started linking/i);
    assert.match(page, /<a href="\/"/);
    assert.doesNotMatch(page, new RegExp(state));
    assert.equal(verifier.requests.length, 0, "an unauthenticated callback is rejected before contacting Steam");
    assert.equal(storedLink(context.db), undefined);
    assert.equal(context.db.scalar("SELECT COUNT(*) FROM decave_steam_link_states WHERE state=?", state), 0);
  } finally {
    verifier.restore();
  }
});

test("Steam callback rejects a valid session belonging to a different DeCave user", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedUser(context.db, "victim");
  seedSession(context.db, "attacker", "attacker-session-token");
  seedSession(context.db, "victim", "victim-session-token");
  const { state, callback } = await beginSteamLink(context, "attacker-session-token");
  const verifier = mockSteamVerification();

  try {
    const response = await invokeCallback(context, callback, {
      cookie: "__Host-decave_session=victim-session-token",
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Steam was not linked/);
    assert.equal(verifier.requests.length, 0, "a mismatched browser user is rejected before contacting Steam");
    assert.equal(storedLink(context.db), undefined);
    assert.equal(context.db.scalar("SELECT COUNT(*) FROM decave_steam_link_states WHERE state=?", state), 0);
  } finally {
    verifier.restore();
  }
});

test("Steam callback rejects an expired completing-browser session", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedSession(context.db, "attacker", "attacker-session-token");
  const { state, callback } = await beginSteamLink(context, "attacker-session-token");
  context.db.exec(
    "UPDATE decave_sessions SET expires_at=? WHERE token_hash=?",
    new Date(Date.now() - 60_000).toISOString(),
    hash("attacker-session-token"),
  );
  const verifier = mockSteamVerification();

  try {
    const response = await invokeCallback(context, callback, {
      cookie: "__Host-decave_session=attacker-session-token",
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Steam was not linked/);
    assert.equal(verifier.requests.length, 0, "expired browser sessions cannot complete Steam linking");
    assert.equal(storedLink(context.db), undefined);
    assert.equal(context.db.scalar("SELECT COUNT(*) FROM decave_steam_link_states WHERE state=?", state), 0);
  } finally {
    verifier.restore();
  }
});

test("Steam callback does not accept a bearer token without a browser cookie", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedSession(context.db, "attacker", "attacker-session-token");
  const { callback } = await beginSteamLink(context, "attacker-session-token");
  const verifier = mockSteamVerification();

  try {
    const response = await invokeCallback(context, callback, {
      authorization: "Bearer attacker-session-token",
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Steam was not linked/);
    assert.equal(verifier.requests.length, 0, "Authorization is not browser-session proof");
    assert.equal(storedLink(context.db), undefined);
  } finally {
    verifier.restore();
  }
});

test("matching completing-browser session verifies and links Steam to the initiating user", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedSession(context.db, "attacker", "attacker-session-token");
  const { state, callback } = await beginSteamLink(context, "attacker-session-token");
  const verifier = mockSteamVerification();

  try {
    const response = await invokeCallback(context, callback, {
      cookie: "__Host-decave_session=attacker-session-token",
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Steam connected/);
    assert.equal(verifier.requests.length, 1);
    const link = storedLink(context.db);
    assert.equal(link?.user_id, "attacker");
    assert.equal(link?.steam_id, "76561198000000000");
    assert.equal(context.db.scalar("SELECT COUNT(*) FROM decave_steam_link_states WHERE state=?", state), 0);
  } finally {
    verifier.restore();
  }
});

test("a successful Steam callback cannot be replayed", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedSession(context.db, "attacker", "attacker-session-token");
  const { callback } = await beginSteamLink(context, "attacker-session-token");
  const verifier = mockSteamVerification();

  try {
    const requestOptions = { cookie: "__Host-decave_session=attacker-session-token" };
    const first = await invokeCallback(context, callback, requestOptions);
    assert.equal(first.status, 200);
    const replay = await invokeCallback(context, callback, requestOptions);
    assert.equal(replay.status, 400);
    assert.match(await replay.text(), /Steam link expired/);
    assert.equal(verifier.requests.length, 1, "replay is rejected before contacting Steam");
    assert.equal(storedLink(context.db)?.user_id, "attacker");
  } finally {
    verifier.restore();
  }
});

test("concurrent Steam callbacks atomically claim the one-use state", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedSession(context.db, "attacker", "attacker-session-token");
  const { callback } = await beginSteamLink(context, "attacker-session-token");
  const verifier = mockSteamVerification();

  try {
    const options = { cookie: "__Host-decave_session=attacker-session-token" };
    const responses = await Promise.all([
      invokeCallback(context, callback, options),
      invokeCallback(context, callback, options),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
    assert.equal(verifier.requests.length, 1, "only the request that claims state may contact Steam");
    assert.equal(context.db.scalar("SELECT COUNT(*) FROM decave_steam_links"), 1);
  } finally {
    verifier.restore();
  }
});

test("an expired Steam link state cannot reach Steam verification", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedSession(context.db, "attacker", "attacker-session-token");
  const { state, callback } = await beginSteamLink(context, "attacker-session-token");
  context.db.exec(
    "UPDATE decave_steam_link_states SET expires_at=? WHERE state=?",
    new Date(Date.now() - 60_000).toISOString(),
    state,
  );
  const verifier = mockSteamVerification();

  try {
    const response = await invokeCallback(context, callback, {
      cookie: "__Host-decave_session=attacker-session-token",
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Steam link expired/);
    assert.equal(verifier.requests.length, 0);
    assert.equal(context.db.scalar("SELECT COUNT(*) FROM decave_steam_link_states WHERE state=?", state), 0);
  } finally {
    verifier.restore();
  }
});

test("Steam account collision still leaves the existing owner linked", async () => {
  const context = createContext();
  seedUser(context.db, "attacker");
  seedUser(context.db, "victim");
  seedSession(context.db, "attacker", "attacker-session-token");
  const { callback } = await beginSteamLink(context, "attacker-session-token");
  context.db.exec(
    `INSERT INTO decave_steam_links
      (user_id,steam_id,persona_name,avatar_url,profile_url,linked_at,updated_at)
     VALUES(?,?,?,?,?,?,?)`,
    "victim",
    "76561198000000000",
    "Existing owner",
    "",
    "https://steamcommunity.com/profiles/76561198000000000/",
    new Date().toISOString(),
    new Date().toISOString(),
  );
  const verifier = mockSteamVerification();

  try {
    const response = await invokeCallback(context, callback, {
      cookie: "__Host-decave_session=attacker-session-token",
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Steam account already linked/);
    assert.equal(verifier.requests.length, 1);
    const link = storedLink(context.db);
    assert.equal(link?.user_id, "victim");
    assert.equal(link?.steam_id, "76561198000000000");
  } finally {
    verifier.restore();
  }
});
