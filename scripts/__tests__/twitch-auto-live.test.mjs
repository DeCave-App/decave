import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { register } from "node:module";
import { after, beforeEach, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const { syncTwitchAutoLive, TWITCH_EVENTSUB_PATH } = await import("../../worker/twitch/auto-live.ts");
const { resetTwitchTokenForTests } = await import("../../worker/twitch/client.ts");
const events = await import("../../worker/bots/events.ts");
const { matchesTrigger } = await import("../../worker/bots/triggers.ts");
const { twitchLoginFromUrl } = await import("../../shared/streamer-mode.ts");

const SECRET = "eventsub-test-secret-123";
const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
  BOTS_BUILDER_ENABLED: "true",
  STREAMER_HUBS_ENABLED: "true",
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TWITCH_EVENTSUB_SECRET: SECRET,
};
await ensureHubFeatureSchema(env);
after(() => db.sqlite.close());

const seen = [];
events.setBotEventSpyForTests((event) => seen.push(event));

// Fake Twitch: token, user lookup, stream lookup, subscription create/delete.
const twitchCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.hostname !== "id.twitch.tv" && url.hostname !== "api.twitch.tv") return realFetch(input, init);
  twitchCalls.push(`${method} ${url.pathname}${url.search}`);
  if (url.pathname === "/oauth2/token") return Response.json({ access_token: "app-token", expires_in: 3600 });
  if (url.pathname === "/helix/users") {
    const login = url.searchParams.get("login");
    return Response.json({ data: login === "demo_streamer" ? [{ id: "4242", login: "demo_streamer" }] : [] });
  }
  if (url.pathname === "/helix/streams")
    return Response.json({ data: [{ title: "Iremia gia na paroume ELO", game_name: "Counter-Strike" }] });
  if (url.pathname === "/helix/eventsub/subscriptions" && method === "POST") {
    const body = JSON.parse(init.body);
    return Response.json({ data: [{ id: `sub-${body.type}` }] }, { status: 202 });
  }
  if (url.pathname === "/helix/eventsub/subscriptions" && method === "DELETE")
    return new Response(null, { status: 204 });
  return new Response("unexpected", { status: 500 });
};
after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  seen.length = 0;
  twitchCalls.length = 0;
  resetTwitchTokenForTests();
});

const now = new Date().toISOString();
db.exec(
  "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id) VALUES('u1','streamer','s','h',?,'DC-u1')",
  now,
);
function makeStreamerHub(config) {
  const hubId = Number(
    db.exec(
      "INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at) VALUES('Demo Academy','AA','u1','private',?,?)",
      now,
      now,
    ).lastInsertRowid,
  );
  db.exec(
    `INSERT INTO decave_streamer_hubs(hub_id,config_json,version,created_at,updated_at,community_features)
     VALUES(?,?,1,?,?,'{"twitch":true}')`,
    hubId,
    JSON.stringify(config),
    now,
    now,
  );
  return hubId;
}
const configOf = (hubId) =>
  JSON.parse(db.sqlite.prepare("SELECT config_json FROM decave_streamer_hubs WHERE hub_id=?").get(hubId).config_json);

function eventSubRequest(
  type,
  body,
  { messageId = crypto.randomUUID(), timestamp = new Date().toISOString(), secret = SECRET } = {},
) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret)
    .update(messageId + timestamp + raw)
    .digest("hex")}`;
  return new Request(`https://app.de-cave.com${TWITCH_EVENTSUB_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Twitch-Eventsub-Message-Id": messageId,
      "Twitch-Eventsub-Message-Timestamp": timestamp,
      "Twitch-Eventsub-Message-Signature": signature,
      "Twitch-Eventsub-Message-Type": type,
    },
    body: raw,
  });
}
const streamNotification = (type) => ({
  subscription: { type, condition: { broadcaster_user_id: "4242" } },
  event: { broadcaster_user_id: "4242", broadcaster_user_login: "demo_streamer" },
});

test("only plain Twitch channel URLs are linkable", () => {
  assert.equal(twitchLoginFromUrl("https://www.twitch.tv/Demo_Streamer"), "demo_streamer");
  assert.equal(twitchLoginFromUrl("https://www.twitch.tv/demo_streamer/clip/abc"), null);
  assert.equal(twitchLoginFromUrl("https://www.youtube.com/@demo_streamer"), null);
  assert.equal(twitchLoginFromUrl(""), null);
});

test("turning auto-live on links the hub and subscribes once per channel", async () => {
  const hubA = makeStreamerHub({});
  const hubB = makeStreamerHub({});
  const config = { streamUrl: "https://www.twitch.tv/demo_streamer", twitchAutoLive: true };
  assert.equal(await syncTwitchAutoLive(env, hubA, config), null);
  assert.equal(await syncTwitchAutoLive(env, hubB, config), null);
  assert.equal(
    twitchCalls.filter((c) => c.startsWith("POST /helix/eventsub")).length,
    2,
    "online + offline, not per hub",
  );
  const links = db.sqlite.prepare("SELECT hub_id FROM decave_twitch_hub_links WHERE broadcaster_id='4242'").all();
  assert.equal(links.length, 2);

  await syncTwitchAutoLive(env, hubA, { ...config, twitchAutoLive: false });
  assert.ok(!twitchCalls.some((c) => c.startsWith("DELETE")), "channel still used by hub B");
  await syncTwitchAutoLive(env, hubB, { ...config, twitchAutoLive: false });
  assert.equal(twitchCalls.filter((c) => c.startsWith("DELETE")).length, 2, "last hub off releases the subscriptions");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_twitch_broadcasters").get().n, 0);
});

test("auto-live explains what's wrong instead of failing silently", async () => {
  const hub = makeStreamerHub({});
  assert.match(
    await syncTwitchAutoLive(env, hub, { streamUrl: "https://www.youtube.com/@x", twitchAutoLive: true }),
    /Twitch channel link/,
  );
  assert.match(
    await syncTwitchAutoLive(env, hub, { streamUrl: "https://www.twitch.tv/nobody_here", twitchAutoLive: true }),
    /no channel called/,
  );
  assert.match(
    await syncTwitchAutoLive({ ...env, TWITCH_CLIENT_ID: "" }, hub, {
      streamUrl: "https://www.twitch.tv/demo_streamer",
      twitchAutoLive: true,
    }),
    /isn't available/,
  );
});

test("EventSub: challenge, signature, replay and live/offline", async () => {
  const hub = makeStreamerHub({
    streamUrl: "https://www.twitch.tv/demo_streamer",
    twitchAutoLive: true,
    streamTitle: "old",
  });
  await syncTwitchAutoLive(env, hub, { streamUrl: "https://www.twitch.tv/demo_streamer", twitchAutoLive: true });

  const challenge = await handleApi(
    eventSubRequest("webhook_callback_verification", { challenge: "pong-123", subscription: {} }),
    env,
  );
  assert.equal(challenge.status, 200);
  assert.equal(await challenge.text(), "pong-123");

  const forged = await handleApi(
    eventSubRequest("notification", streamNotification("stream.online"), { secret: "wrong-secret-xyz" }),
    env,
  );
  assert.equal(forged.status, 403);
  const stale = await handleApi(
    eventSubRequest("notification", streamNotification("stream.online"), {
      timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    }),
    env,
  );
  assert.equal(stale.status, 403);
  assert.equal(configOf(hub).liveUntil, undefined, "rejected deliveries change nothing");

  const messageId = "msg-online-1";
  const online = await handleApi(
    eventSubRequest("notification", streamNotification("stream.online"), { messageId }),
    env,
  );
  assert.equal(online.status, 204);
  const live = configOf(hub);
  assert.ok(Date.parse(live.liveUntil) > Date.now());
  assert.equal(live.streamTitle, "Iremia gia na paroume ELO");
  assert.equal(live.game, "Counter-Strike");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, "streamLive");
  assert.equal(seen[0].hubId, hub);
  assert.deepEqual(matchesTrigger({ type: "streamLive" }, seen[0]).vars, {
    "stream.title": "Iremia gia na paroume ELO",
    "stream.game": "Counter-Strike",
    "stream.url": "https://www.twitch.tv/demo_streamer",
    streamer: "demo_streamer",
  });

  const retry = await handleApi(
    eventSubRequest("notification", streamNotification("stream.online"), { messageId }),
    env,
  );
  assert.equal(retry.status, 204);
  assert.equal(seen.length, 1, "a retried delivery is not announced twice");

  await handleApi(eventSubRequest("notification", streamNotification("stream.offline")), env);
  assert.equal(configOf(hub).liveUntil, null);
  assert.equal(seen.at(-1).kind, "streamOffline");
});

test("a hub that turned auto-live off is left alone", async () => {
  const hub = makeStreamerHub({ streamUrl: "https://www.twitch.tv/demo_streamer", twitchAutoLive: false });
  db.exec(
    "INSERT OR IGNORE INTO decave_twitch_hub_links(hub_id,broadcaster_id,created_at) VALUES(?, '4242', ?)",
    hub,
    now,
  );
  await handleApi(eventSubRequest("notification", streamNotification("stream.online")), env);
  assert.equal(configOf(hub).liveUntil, undefined);
  assert.ok(!seen.some((event) => event.hubId === hub));
});
