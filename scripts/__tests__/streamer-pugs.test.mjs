import assert from "node:assert/strict";
import { register } from "node:module";
import { after, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { tokenHash } = await import("../../worker/db.ts");
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const { pickMap, shuffled } = await import("../../shared/streamer-pugs.ts");
const { refreshFaceitLinks } = await import("../../worker/faceit/links.ts");
const { importTwitchClips, announceClipOfTheWeek } = await import("../../worker/twitch/clips.ts");
const { resetTwitchTokenForTests } = await import("../../worker/twitch/client.ts");
const { streamerUserErasureStatements } = await import("../../worker/streamer/routes.ts");

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
  BOTS_BUILDER_ENABLED: "true",
  FACEIT_API_KEY: "faceit-key",
  FACEIT_CLIENT_ID: "faceit-client",
  FACEIT_CLIENT_SECRET: "faceit-secret",
  TWITCH_CLIENT_ID: "client",
  TWITCH_CLIENT_SECRET: "secret",
  TWITCH_EVENTSUB_SECRET: "eventsub-test-secret-123",
};
await ensureHubFeatureSchema(env);
after(() => db.sqlite.close());

const now = new Date().toISOString();
const users = ["owner", "p1", "p2", "p3", "p4", "p5"];
for (const id of users) {
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
       age_assurance_method,created_at,updated_at)
     VALUES(?,'eligible','adult',0,'2026-10-v1-adults','self_attested',?,?)`,
    id,
    now,
    now,
  );
}
const hubId = Number(
  db.exec(
    "INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at) VALUES('Demo Academy','AA','owner','private',?,?)",
    now,
    now,
  ).lastInsertRowid,
);
for (const id of users)
  db.exec(
    "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,?,?)",
    hubId,
    id,
    id === "owner" ? "owner" : "member",
    now,
  );
db.exec(
  `INSERT INTO decave_streamer_hubs(hub_id,config_json,version,created_at,updated_at,community_features)
   VALUES(?,?,1,?,?,'{"pugs":true,"leaderboard":true,"twitch":true}')`,
  hubId,
  JSON.stringify({ streamUrl: "https://www.twitch.tv/demo_streamer", twitchAutoLive: true, twitchClips: true }),
  now,
  now,
);
const room = (name, type, kind = "chat") =>
  Number(
    db.exec(
      "INSERT INTO decave_rooms(hub_id,name,type,kind,category,position,created_at,updated_at) VALUES(?,?,?,?,'X',0,?,?)",
      hubId,
      name,
      type,
      kind,
      now,
      now,
    ).lastInsertRowid,
  );
const announcements = room("announcements", "text");
const clipsRoom = room("clips", "text", "forum");
const voiceA = room("5-Stack 1", "voice");
const voiceB = room("5-Stack 2", "voice");

function call(path, { method = "GET", body, as = "owner" } = {}) {
  const headers = new Headers({ authorization: `Bearer tok-${as}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return handleApi(
    new Request(`https://test.invalid${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
const pugCall = (action, body = {}, as = "owner") =>
  call(`/api/servers/${hubId}/streamer/pug/${action}`, { method: "POST", body, as });
const snapshot = async (as = "owner") => (await call(`/api/servers/${hubId}/streamer`, { as })).json();

// Fake FACEIT and Twitch.
const realFetch = globalThis.fetch;
let clipFeed = [];
const faceitTokenRequests = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "api.faceit.com" && url.pathname === "/auth/v1/oauth/token") {
    const form = new URLSearchParams(String(init.body));
    faceitTokenRequests.push({ auth: new Headers(init.headers).get("authorization"), form });
    return form.get("code") === "good-code"
      ? Response.json({ access_token: "faceit-access" })
      : new Response("{}", { status: 400 });
  }
  if (url.hostname === "api.faceit.com" && url.pathname === "/auth/v1/resources/userinfo")
    return Response.json({ guid: "0f1e2d3c-aaaa-bbbb-cccc-000000000001", nickname: "DemoPlayer" });
  if (url.hostname === "open.faceit.com") {
    if (url.pathname === "/data/v4/players" && url.searchParams.get("nickname") === "DemoPlayer")
      return Response.json({
        player_id: "fp-1",
        nickname: "DemoPlayer",
        games: { cs2: { faceit_elo: 2450, skill_level: 10 } },
      });
    if (url.pathname === "/data/v4/players/0f1e2d3c-aaaa-bbbb-cccc-000000000001")
      return Response.json({
        player_id: "fp-1",
        nickname: "DemoPlayer",
        games: { cs2: { faceit_elo: 2510, skill_level: 10 } },
      });
    return new Response("{}", { status: 404 });
  }
  if (url.hostname === "id.twitch.tv") return Response.json({ access_token: "t", expires_in: 3600 });
  if (url.hostname === "api.twitch.tv" && url.pathname === "/helix/clips") {
    const ids = url.searchParams.getAll("id");
    return Response.json({ data: ids.length ? clipFeed.filter((clip) => ids.includes(clip.id)) : clipFeed });
  }
  // Like Cloudflare Workers: only "follow" and "manual" redirect modes exist.
  if (init.redirect && !["follow", "manual"].includes(init.redirect))
    throw new TypeError(`Invalid redirect value: ${init.redirect}`);
  if (url.hostname === "static-cdn.jtvnw.net")
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), {
      headers: { "content-type": "image/jpeg" },
    });
  if (url.hostname === "evil.example") return new Response("nope", { headers: { "content-type": "image/jpeg" } });
  return realFetch(input, init);
};
after(() => {
  globalThis.fetch = realFetch;
});

test("map pick and team shuffle are deterministic with an injected random source", () => {
  assert.equal(
    pickMap(["Mirage", "Inferno", "Nuke"], ["Nuke", "Nuke", "Mirage"], () => 0),
    "Nuke",
  );
  assert.equal(
    pickMap(["Mirage", "Inferno"], ["Mirage", "Inferno"], () => 1),
    "Inferno",
    "a tie picks among leaders",
  );
  assert.equal(
    pickMap(["Mirage", "Inferno"], [null, "Dust II"], () => 0),
    "Mirage",
    "no valid votes: whole pool",
  );
  assert.deepEqual(
    shuffled([1, 2, 3], () => 0),
    [2, 3, 1],
  );
});

test("a PUG runs end to end: create, join, vote, random teams, result, leaderboard", async () => {
  assert.equal(
    (await pugCall("create", { teamSize: 2, maps: ["Mirage", "Nuke"], voiceA, voiceB }, "p1")).status,
    403,
    "only the creator opens a PUG",
  );
  const created = await pugCall("create", { teamSize: 2, maps: ["Mirage", "Nuke"], voiceA, voiceB });
  assert.equal(created.status, 200);
  assert.equal((await pugCall("create", { teamSize: 2, maps: ["Mirage"], voiceA, voiceB })).status, 409);

  for (const player of ["p1", "p2", "p3", "p4"]) assert.equal((await pugCall("join", {}, player)).status, 200);
  assert.equal((await pugCall("join", {}, "p5")).status, 409, "a 2v2 PUG holds 4 players");
  assert.equal((await pugCall("vote", { map: "Dust II" }, "p1")).status, 400, "only maps in the pool");
  for (const player of ["p1", "p2", "p3"]) await pugCall("vote", { map: "Nuke" }, player);
  assert.equal((await pugCall("start", {}, "p1")).status, 403);
  assert.equal((await pugCall("start")).status, 200);

  const live = (await snapshot("p1")).pug;
  assert.equal(live.status, "live");
  assert.equal(live.map, "Nuke", "the most voted map is played");
  assert.equal(live.players.filter((p) => p.team === "a").length, 2);
  assert.equal(live.players.filter((p) => p.team === "b").length, 2);
  assert.ok(live.myTeam === "a" || live.myTeam === "b");
  assert.equal((await pugCall("leave", {}, "p1")).status, 409, "no leaving a live PUG");

  assert.equal((await pugCall("result", { scoreA: 13, scoreB: 9 })).status, 200);
  const done = (await snapshot("p2")).pug;
  assert.equal(done.status, "done");
  assert.equal(done.scoreA, 13);

  const board = await (await call(`/api/servers/${hubId}/streamer/leaderboard`, { as: "p3" })).json();
  const winners = live.players.filter((p) => p.team === "a").map((p) => p.name);
  assert.deepEqual(
    board.rows
      .filter((row) => row.wins === 1)
      .map((row) => row.name)
      .sort(),
    winners.sort(),
  );
  assert.ok(board.rows.every((row) => row.games === 1));
  assert.ok(winners.includes(board.champion.name));
  assert.equal(board.faceitAvailable, true);

  // A new PUG can open once the last one is done.
  assert.equal((await pugCall("create", { teamSize: 5, maps: ["Mirage"], voiceA, voiceB })).status, 200);
  assert.equal((await pugCall("cancel")).status, 200);
});

test("PUG rooms must be two different voice rooms of the Hub", async () => {
  assert.equal((await pugCall("create", { teamSize: 2, maps: ["Mirage"], voiceA, voiceB: announcements })).status, 400);
  assert.equal((await pugCall("create", { teamSize: 2, maps: ["Mirage"], voiceA, voiceB: voiceA })).status, 400);
});

async function faceitConnect(as) {
  const response = await call("/api/account/faceit/connect", { method: "POST", as });
  assert.equal(response.status, 200);
  const target = new URL((await response.json()).url);
  return target;
}
function faceitCallback(state, { code = "good-code", cookieAs = null, bearerAs = null } = {}) {
  const headers = new Headers();
  if (cookieAs) headers.set("cookie", `__Host-decave_session=tok-${cookieAs}`);
  if (bearerAs) headers.set("authorization", `Bearer tok-${bearerAs}`);
  const url = new URL("https://app.de-cave.com/api/account/faceit/callback");
  url.searchParams.set("state", state);
  if (code) url.searchParams.set("code", code);
  return handleApi(new Request(url, { headers }), env);
}

test("FACEIT links only through FACEIT sign-in, bound to the browser that started it", async () => {
  // Typing a nickname no longer links anything.
  const byName = await call("/api/account/faceit", { method: "POST", body: { nickname: "DemoPlayer" }, as: "p1" });
  assert.notEqual(byName.status, 200);

  const target = await faceitConnect("owner");
  assert.equal(target.origin, "https://accounts.faceit.com");
  assert.equal(target.searchParams.get("client_id"), "faceit-client");
  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.equal(target.searchParams.get("redirect_uri"), "https://test.invalid/api/account/faceit/callback");
  const state = target.searchParams.get("state");

  // An API token is not proof that this browser belongs to the member; nothing is linked and the state is spent.
  const tokenOnly = await faceitCallback(state, { bearerAs: "owner" });
  assert.match(await tokenOnly.text(), /Sign in to finish FACEIT linking/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_faceit_links").get().n, 0);
  assert.match(await (await faceitCallback(state, { cookieAs: "owner" })).text(), /link expired/);

  // A different signed-in browser can't complete someone else's link.
  const other = (await faceitConnect("owner")).searchParams.get("state");
  assert.match(await (await faceitCallback(other, { cookieAs: "p1" })).text(), /Sign in to finish/);

  // The right browser completes it; the PKCE verifier and client secret go to FACEIT.
  const good = (await faceitConnect("owner")).searchParams.get("state");
  const done = await faceitCallback(good, { cookieAs: "owner" });
  assert.equal(done.status, 200);
  assert.match(await done.text(), /FACEIT linked/);
  const exchange = faceitTokenRequests.at(-1);
  assert.equal(exchange.auth, `Basic ${btoa("faceit-client:faceit-secret")}`);
  assert.ok((exchange.form.get("code_verifier") ?? "").length >= 43);

  let board = await (await call(`/api/servers/${hubId}/streamer/leaderboard`, { as: "p2" })).json();
  assert.equal(board.rows.find((row) => row.name === "user-owner").faceitElo, 2510);

  // A public PKCE client (no secret) sends client_id in the body instead of Basic auth.
  delete env.FACEIT_CLIENT_SECRET;
  db.exec("DELETE FROM decave_faceit_links");
  const pkce = (await faceitConnect("owner")).searchParams.get("state");
  assert.match(await (await faceitCallback(pkce, { cookieAs: "owner" })).text(), /FACEIT linked/);
  const publicExchange = faceitTokenRequests.at(-1);
  assert.equal(publicExchange.auth, null);
  assert.equal(publicExchange.form.get("client_id"), "faceit-client");
  env.FACEIT_CLIENT_SECRET = "faceit-secret";

  // The same FACEIT account can't be linked to a second DeCave account.
  const steal = (await faceitConnect("p1")).searchParams.get("state");
  assert.match(await (await faceitCallback(steal, { cookieAs: "p1" })).text(), /already linked/);

  db.exec("UPDATE decave_faceit_links SET elo=1, updated_at='2020-01-01T00:00:00.000Z'");
  await refreshFaceitLinks(env);
  board = await (await call(`/api/servers/${hubId}/streamer/leaderboard`, { as: "owner" })).json();
  assert.equal(board.myFaceit.elo, 2510, "the hourly refresh updates ELO");

  assert.equal((await call("/api/account/faceit", { method: "DELETE", as: "owner" })).status, 200);
  board = await (await call(`/api/servers/${hubId}/streamer/leaderboard`, { as: "owner" })).json();
  assert.equal(board.myFaceit, null);
});

test("new Twitch clips are posted once to the clips forum and the weekly winner is announced", async () => {
  resetTwitchTokenForTests();
  db.exec(
    "INSERT OR IGNORE INTO decave_twitch_hub_links(hub_id,broadcaster_id,created_at) VALUES(?, '4242', ?)",
    hubId,
    now,
  );
  clipFeed = [
    {
      id: "clip-1",
      url: "https://clips.twitch.tv/clip-1",
      title: "1v4 clutch",
      creator_name: "kwstassapou",
      view_count: 50,
      created_at: now,
    },
    {
      id: "clip-2",
      url: "https://clips.twitch.tv/clip-2",
      title: "Deagle onetap",
      creator_name: "mor3ko",
      view_count: 12,
      created_at: now,
    },
  ];
  await importTwitchClips(env);
  await importTwitchClips(env);
  const posts = db.sqlite
    .prepare("SELECT id,text,bot_id FROM decave_messages WHERE room_id=? ORDER BY created_at")
    .all(clipsRoom);
  assert.equal(posts.length, 2, "each clip is posted once");
  assert.ok(
    posts.every((post) => post.bot_id),
    "posted by the Twitch Clips bot",
  );
  assert.match(posts[0].text, /clips\.twitch\.tv\/clip-/);

  const clutch = posts.find((post) => post.text.includes("1v4 clutch"));
  for (const voter of ["p1", "p2"])
    db.exec(
      "INSERT INTO decave_message_reactions(message_id,user_id,emoji,created_at) VALUES(?,?,'🔥',?)",
      clutch.id,
      voter,
      now,
    );
  const monday18 = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    d.setUTCHours(18, 5, 0, 0);
    return d.getTime();
  })();
  db.exec("UPDATE decave_twitch_clips_posted SET posted_at=?", new Date(monday18 - 86_400_000).toISOString());
  await announceClipOfTheWeek(env, monday18);
  await announceClipOfTheWeek(env, monday18);
  const announced = db.sqlite.prepare("SELECT text FROM decave_messages WHERE room_id=?").all(announcements);
  assert.equal(announced.length, 1, "announced once per week");
  assert.match(announced[0].text, /Clip of the week \(2 votes\): 1v4 clutch/);
});

test("a chat clips room gets clips as bot chat messages", async () => {
  db.exec("UPDATE decave_rooms SET kind='chat' WHERE id=?", clipsRoom);
  clipFeed = [
    {
      id: "clip-3",
      url: "https://clips.twitch.tv/clip-3",
      title: "AWP ace",
      creator_name: "mor3ko",
      view_count: 3,
      created_at: new Date().toISOString(),
    },
  ];
  await importTwitchClips(env);
  const latest = db.sqlite
    .prepare("SELECT text FROM decave_messages WHERE room_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(clipsRoom);
  assert.match(latest.text, /^__DECAVE_BOT__/);
  const body = JSON.parse(latest.text.slice("__DECAVE_BOT__".length)).text;
  assert.equal(
    body,
    "🎬 AWP ace\nClipped by mor3ko\nhttps://clips.twitch.tv/clip-3\nReact to vote for Clip of the week.",
  );
  db.exec("UPDATE decave_rooms SET kind='forum' WHERE id=?", clipsRoom);
});

test("clip thumbnails are copied into Hub media and shown on the clip card", async () => {
  db.exec("UPDATE decave_rooms SET kind='chat' WHERE id=?", clipsRoom);
  const thumb = "https://static-cdn.jtvnw.net/twitch-clips-thumbnails-prod/clip-4/preview-480x272.jpg";
  clipFeed = [
    {
      id: "clip-4",
      url: "https://clips.twitch.tv/clip-4",
      title: "Jumping AWP",
      creator_name: "mor3ko",
      view_count: 9,
      created_at: new Date().toISOString(),
      thumbnail_url: thumb,
    },
    // Earlier clip posted without a thumbnail: the backfill adds one.
    {
      id: "clip-3",
      url: "https://clips.twitch.tv/clip-3",
      title: "AWP ace",
      creator_name: "mor3ko",
      view_count: 3,
      created_at: new Date(Date.now() - 60_000).toISOString(),
      thumbnail_url: thumb,
    },
  ];
  db.exec("UPDATE decave_twitch_clips_posted SET thumbnail_key=NULL WHERE clip_id='clip-3'");
  await importTwitchClips(env);
  const rows = db.sqlite
    .prepare(
      "SELECT clip_id,thumbnail_key,message_id FROM decave_twitch_clips_posted WHERE clip_id IN ('clip-3','clip-4')",
    )
    .all();
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row.thumbnail_key, new RegExp(`^hub-media/${hubId}/clip/[0-9a-f-]+$`), row.clip_id);
    assert.ok(env.MEDIA.objects.has(row.thumbnail_key), "stored in R2");
    const card = JSON.parse(
      db.sqlite.prepare("SELECT card_json FROM decave_messages WHERE id=?").get(row.message_id).card_json,
    );
    assert.equal(card.imageUrl, `https://app.de-cave.com/uploads/${row.thumbnail_key}`);
  }
  db.exec("UPDATE decave_rooms SET kind='forum' WHERE id=?", clipsRoom);
});

test("clip thumbnails only come from Twitch's image servers", async () => {
  const { twitchClipThumbnail } = await import("../../worker/twitch/client.ts");
  assert.ok(await twitchClipThumbnail("https://static-cdn.jtvnw.net/x/preview.jpg"));
  assert.equal(await twitchClipThumbnail("https://evil.example/preview.jpg"), null);
  assert.equal(await twitchClipThumbnail("http://static-cdn.jtvnw.net/x/preview.jpg"), null);
});

test("PUGs, leaderboard and Twitch are custom: a Streamer Hub without them gets none", async () => {
  const plainHub = Number(
    db.exec(
      "INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at) VALUES('PUBG Hub','P','owner','private',?,?)",
      now,
      now,
    ).lastInsertRowid,
  );
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,'owner','owner',?)", plainHub, now);
  db.exec(
    "INSERT INTO decave_streamer_hubs(hub_id,config_json,version,created_at,updated_at) VALUES(?,'{}',1,?,?)",
    plainHub,
    now,
    now,
  );
  const snap = await (await call(`/api/servers/${plainHub}/streamer`)).json();
  assert.equal(snap.features.pugs, false);
  assert.equal(snap.features.leaderboard, false);
  assert.equal(snap.features.twitch, false);
  assert.equal(snap.pug, null);
  assert.equal(
    (
      await call(`/api/servers/${plainHub}/streamer/pug/create`, {
        method: "POST",
        body: { teamSize: 2, maps: ["Erangel"], voiceA, voiceB },
      })
    ).status,
    404,
  );
  assert.equal((await call(`/api/servers/${plainHub}/streamer/leaderboard`)).status, 404);
  const saved = await call(`/api/servers/${plainHub}/streamer/settings`, {
    method: "POST",
    body: {
      version: 1,
      creatorName: "",
      tagline: "",
      streamTitle: "",
      game: "PUBG",
      language: "",
      queueRules: "",
      onboarding: "",
      streamUrl: "https://www.twitch.tv/somebody",
      liveHours: 0,
      twitchAutoLive: "on",
      twitchClips: "on",
    },
  });
  assert.equal(saved.status, 200);
  const config = (await (await call(`/api/servers/${plainHub}/streamer`)).json()).config;
  assert.equal(config.twitchAutoLive, false, "creators can't switch on the custom Twitch features");
  assert.equal(config.twitchClips, false);
  const bots = await (await call(`/api/servers/${plainHub}/bot-builder`)).json();
  assert.ok(!bots.templates.some((t) => t.id === "liveAlerts"));
  const mine = await (await call(`/api/servers/${hubId}/bot-builder`)).json();
  assert.ok(mine.templates.some((t) => t.id === "liveAlerts"));
});

test("account erasure removes PUG history and the FACEIT link", async () => {
  await faceitCallback((await faceitConnect("p1")).searchParams.get("state"), { cookieAs: "p1" });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_faceit_links WHERE user_id='p1'").get().n, 1);
  await faceitConnect("p1");
  await db.batch(streamerUserErasureStatements(db, "p1"));
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_streamer_pug_players WHERE user_id='p1'").get().n,
    0,
  );
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_faceit_links WHERE user_id='p1'").get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_faceit_link_states WHERE user_id='p1'").get().n, 0);
});
