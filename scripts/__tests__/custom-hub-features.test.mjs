import assert from "node:assert/strict";
import { register } from "node:module";
import { after, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { tokenHash } = await import("../../worker/db.ts");
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const { recheckTwitchSubscribers } = await import("../../worker/twitch/subs.ts");
const { streamerUserErasureStatements } = await import("../../worker/streamer/routes.ts");
const { hubArtworkUrl } = await import("../../shared/bots/card-view.ts");

const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
  STREAMER_HUBS_ENABLED: "true",
  STREAMER_GIVEAWAYS_ENABLED: "true",
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "client-secret-for-tests",
  TWITCH_EVENTSUB_SECRET: "eventsub-test-secret-123",
};
await ensureHubFeatureSchema(env);
after(() => db.sqlite.close());

const now = new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const users = { owner: 0, sub: 30, fan: 30, newbie: 0 };
for (const [id, joinedDays] of Object.entries(users)) {
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id) VALUES(?,?,'s','h',?,?)",
    id,
    `user-${id}`,
    now,
    `DC-${id}`,
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    tokenHash(`tok-${id}`),
    id,
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
  db.exec(
    `INSERT INTO decave_user_safety_profiles(user_id,age_status,age_band,teen_safety_mode,age_policy_version,
       age_assurance_method,created_at,updated_at) VALUES(?,'eligible','adult',0,'2026-10-v1-adults','self_attested',?,?)`,
    id,
    now,
    now,
  );
  users[id] = joinedDays;
}
function makeHub(name, features) {
  const hubId = Number(
    db.exec(
      "INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at) VALUES(?,'H','owner','private',?,?)",
      name,
      now,
      now,
    ).lastInsertRowid,
  );
  for (const [id, days] of Object.entries(users))
    db.exec(
      "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,?,?)",
      hubId,
      id,
      id === "owner" ? "owner" : "member",
      daysAgo(days),
    );
  db.exec(
    `INSERT INTO decave_streamer_hubs(hub_id,config_json,version,created_at,updated_at,community_features)
     VALUES(?,'{}',1,?,?,?)`,
    hubId,
    now,
    now,
    JSON.stringify(features),
  );
  return hubId;
}
const custom = makeHub("Demo Academy", { twitch: true, subRoles: true, voiceLimits: true, faceitBadges: true });
const plain = makeHub("Other Hub", {});
db.exec("INSERT INTO decave_twitch_hub_links(hub_id,broadcaster_id,created_at) VALUES(?, '4242', ?)", custom, now);
const voiceRoom = (hubId) =>
  Number(
    db.exec(
      "INSERT INTO decave_rooms(hub_id,name,type,kind,category,position,created_at,updated_at) VALUES(?,'Premier 1','voice','chat','V',0,?,?)",
      hubId,
      now,
      now,
    ).lastInsertRowid,
  );

function call(path, { method = "GET", body, as = "owner", cookie = false } = {}) {
  const headers = new Headers(
    cookie ? { cookie: `__Host-decave_session=tok-${as}` } : { authorization: `Bearer tok-${as}` },
  );
  if (body !== undefined) headers.set("content-type", "application/json");
  return handleApi(
    new Request(`https://app.de-cave.com${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

// Fake Twitch for member sign-in: "sub-code" belongs to a subscriber, "fan-code" to a non-subscriber.
let revoked = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "id.twitch.tv" && url.pathname === "/oauth2/token") {
    const form = new URLSearchParams(String(init.body));
    if (form.get("grant_type") === "refresh_token") {
      if (revoked) return new Response("{}", { status: 400 });
      const who = form.get("refresh_token").split("-")[0];
      return Response.json({ access_token: `${who}-access`, refresh_token: `${who}-refresh2` });
    }
    if (form.get("grant_type") === "client_credentials")
      return Response.json({ access_token: "app", expires_in: 3600 });
    const who = form.get("code").split("-")[0];
    return Response.json({ access_token: `${who}-access`, refresh_token: `${who}-refresh` });
  }
  if (url.hostname === "api.twitch.tv") {
    const who = (new Headers(init.headers).get("authorization") ?? "").replace("Bearer ", "").split("-")[0];
    if (url.pathname === "/helix/users") return Response.json({ data: [{ id: `tw-${who}`, login: `${who}_gr` }] });
    if (url.pathname === "/helix/subscriptions/user")
      return who === "sub" ? Response.json({ data: [{ tier: "1000" }] }) : new Response("{}", { status: 404 });
  }
  return realFetch(input, init);
};
after(() => {
  globalThis.fetch = realFetch;
});

async function linkTwitch(as) {
  const started = await call("/api/account/twitch/connect", { method: "POST", as });
  assert.equal(started.status, 200);
  const target = new URL((await started.json()).url);
  assert.equal(target.searchParams.get("scope"), "user:read:subscriptions");
  const callback = `/api/account/twitch/callback?state=${target.searchParams.get("state")}&code=${as}-code`;
  return call(callback, { as, cookie: true });
}
const roleNames = (hubId, userId) =>
  db.sqlite
    .prepare(
      "SELECT r.name FROM decave_member_roles m JOIN decave_custom_roles r ON r.id=m.role_id WHERE m.hub_id=? AND m.user_id=?",
    )
    .all(hubId, userId)
    .map((row) => row.name);

test("voice room player caps can be set only on Hubs with the feature", async () => {
  const capped = voiceRoom(custom);
  const other = voiceRoom(plain);
  assert.equal((await call(`/api/channels/${capped}`, { method: "PATCH", body: { userLimit: 5 } })).status, 200);
  assert.equal((await call(`/api/channels/${capped}`, { method: "PATCH", body: { userLimit: 500 } })).status, 400);
  await call(`/api/channels/${other}`, { method: "PATCH", body: { userLimit: 5 } });
  const limits = Object.fromEntries(
    db.sqlite
      .prepare("SELECT id,user_limit FROM decave_rooms WHERE id IN (?,?)")
      .all(capped, other)
      .map((r) => [r.id, r.user_limit]),
  );
  assert.equal(limits[capped], 5);
  assert.equal(limits[other], 0, "other Hubs can't set a cap");
  const servers = await (await call("/api/servers")).json();
  const hub = servers.find((s) => s.id === custom);
  assert.equal(hub.channels.find((c) => c.id === capped).userLimit, 5);
  assert.deepEqual(hub.communityFeatures, { voiceLimits: true, subRoles: true, faceitBadges: true });
  assert.equal(servers.find((s) => s.id === plain).communityFeatures.voiceLimits, false);
});

test("Twitch subscribers get the Subs role; non-subscribers don't; revoked links lose it", async () => {
  const linked = await linkTwitch("sub");
  assert.match(await linked.text(), /Twitch linked/);
  assert.deepEqual(roleNames(custom, "sub"), ["Subs"]);
  assert.deepEqual(roleNames(plain, "sub"), [], "only Hubs with the feature");
  const stored = db.sqlite
    .prepare("SELECT refresh_token_enc FROM decave_twitch_member_links WHERE user_id='sub'")
    .get();
  assert.ok(!stored.refresh_token_enc.includes("sub-refresh"), "refresh token is stored encrypted");

  await linkTwitch("fan");
  assert.deepEqual(roleNames(custom, "fan"), []);

  const snap = await (await call(`/api/servers/${custom}/streamer`, { as: "sub" })).json();
  assert.deepEqual(snap.twitchMember, { linked: true, login: "sub_gr", subscribed: true, tier: "1000" });
  const plainSnap = await (await call(`/api/servers/${plain}/streamer`, { as: "sub" })).json();
  assert.equal(plainSnap.twitchMember, undefined);

  // A token-only callback can't complete someone else's link.
  const started = await call("/api/account/twitch/connect", { method: "POST", as: "newbie" });
  const state = new URL((await started.json()).url).searchParams.get("state");
  const bearer = await call(`/api/account/twitch/callback?state=${state}&code=newbie-code`, { as: "newbie" });
  assert.match(await bearer.text(), /Sign in to finish Twitch linking/);
});

test("giveaway rules: subscribers only, minimum days in the Hub, and the subscriber bonus", async () => {
  const create = (body) =>
    call(`/api/servers/${custom}/streamer/giveaways/create`, {
      method: "POST",
      body: {
        title: "Logitech G Pro",
        rules: "One per member",
        closesAt: new Date(Date.now() + 3_600_000).toISOString(),
        ...body,
      },
    });
  const subsOnly = await (await create({ subsOnly: true })).json();
  const enter = (id, as) =>
    call(`/api/servers/${custom}/streamer/giveaways/enter`, { method: "POST", body: { id }, as });
  assert.equal((await enter(subsOnly.id, "fan")).status, 403);
  assert.equal((await enter(subsOnly.id, "sub")).status, 200);

  const veterans = await (await create({ minMemberDays: 7 })).json();
  const newbie = await enter(veterans.id, "newbie");
  assert.equal(newbie.status, 403);
  assert.match((await newbie.json()).error, /7 days in the Hub/);
  assert.equal((await enter(veterans.id, "fan")).status, 200);

  const snap = await (await call(`/api/servers/${custom}/streamer`, { as: "fan" })).json();
  const rules = snap.giveaways.find((g) => g.id === subsOnly.id).conditions;
  assert.deepEqual(rules, { subsOnly: true, minMemberDays: 0, subBonus: false });

  // Other Hubs can't attach rules.
  const plainGiveaway = await (
    await call(`/api/servers/${plain}/streamer/giveaways/create`, {
      method: "POST",
      body: { title: "X", rules: "Y", closesAt: new Date(Date.now() + 3_600_000).toISOString(), subsOnly: true },
    })
  ).json();
  const stored = db.sqlite
    .prepare("SELECT conditions_json FROM decave_streamer_giveaways WHERE id=?")
    .get(plainGiveaway.id);
  assert.equal(stored.conditions_json, "{}");
});

test("the daily re-check removes the role when Twitch revokes the link", async () => {
  db.exec("UPDATE decave_twitch_member_links SET checked_at='2020-01-01T00:00:00.000Z'");
  await recheckTwitchSubscribers(env);
  assert.deepEqual(roleNames(custom, "sub"), ["Subs"], "still subscribed");
  revoked = true;
  db.exec("UPDATE decave_twitch_member_links SET checked_at='2020-01-01T00:00:00.000Z'");
  await recheckTwitchSubscribers(env);
  assert.deepEqual(roleNames(custom, "sub"), []);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_twitch_member_links WHERE user_id='sub'").get().n,
    0,
  );
  revoked = false;
});

test("FACEIT level badges show only on Hubs with the feature", async () => {
  db.exec(
    "INSERT INTO decave_faceit_links(user_id,player_id,nickname,elo,level,updated_at) VALUES('fan','fp-fan','FanGR',1650,7,?)",
    now,
  );
  const members = await (await call(`/api/servers/${custom}/members`)).json();
  assert.equal(members.find((m) => m.username === "user-fan").faceitLevel, 7);
  const plainMembers = await (await call(`/api/servers/${plain}/members`)).json();
  assert.equal(plainMembers.find((m) => m.username === "user-fan").faceitLevel, undefined);
});

test("welcome cards show only this server's Hub artwork inline", () => {
  const base = "https://app.de-cave.com";
  assert.equal(
    hubArtworkUrl("https://app.de-cave.com/uploads/hub-media/13/header/9fb7bddd-f9dd", base),
    "https://app.de-cave.com/uploads/hub-media/13/header/9fb7bddd-f9dd",
  );
  assert.equal(hubArtworkUrl("https://evil.example/uploads/hub-media/13/header/x", base), null);
  assert.equal(hubArtworkUrl("https://app.de-cave.com/uploads/attachments/13/x", base), null);
});

test("erasure removes Twitch member links and subscriber records", async () => {
  await linkTwitch("sub");
  await db.batch(streamerUserErasureStatements(db, "sub"));
  for (const table of [
    "decave_twitch_member_links",
    "decave_twitch_hub_subscribers",
    "decave_twitch_member_link_states",
  ])
    assert.equal(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id='sub'`).get().n, 0, table);
});

test("read-only chat rooms: staff and chosen roles post, everyone else can only read", async () => {
  const { canPostInChatRoom, getRoom } = await import("../../worker/db.ts");
  const rules = Number(
    db.exec(
      "INSERT INTO decave_rooms(hub_id,name,type,kind,category,position,created_at,updated_at) VALUES(?,'rules','text','chat','I',0,?,?)",
      plain,
      now,
      now,
    ).lastInsertRowid,
  );
  assert.equal((await call(`/api/channels/${rules}`, { method: "PATCH", body: { postPolicy: "staff" } })).status, 200);
  let room = await getRoom(db, rules);
  assert.equal(await canPostInChatRoom(db, room, "owner"), true);
  assert.equal(await canPostInChatRoom(db, room, "fan"), false);

  const servers = await (await call("/api/servers", { as: "fan" })).json();
  const seen = servers.find((s) => s.id === plain).channels.find((c) => c.id === rules);
  assert.equal(seen.canPost, false, "members see the room but can't post");
  assert.equal(seen.postPolicy, "staff");

  db.exec(
    "INSERT INTO decave_custom_roles(id,hub_id,name,color,permissions_json,position,created_at) VALUES('vip',?,'VIP','#fff','[]',0,?)",
    plain,
    now,
  );
  db.exec("INSERT INTO decave_member_roles(hub_id,user_id,role_id) VALUES(?,'fan','vip')", plain);
  assert.equal(
    (await call(`/api/channels/${rules}`, { method: "PATCH", body: { postPolicy: "roles", postRoleIds: ["vip"] } }))
      .status,
    200,
  );
  room = await getRoom(db, rules);
  assert.equal(await canPostInChatRoom(db, room, "fan"), true, "VIP role can post");
  assert.equal(await canPostInChatRoom(db, room, "newbie"), false);
  assert.equal(
    (await call(`/api/channels/${rules}`, { method: "PATCH", body: { postPolicy: "roles", postRoleIds: ["nope"] } }))
      .status,
    400,
  );
  assert.equal((await call(`/api/channels/${rules}`, { method: "PATCH", body: { postPolicy: "owners" } })).status, 400);
});
