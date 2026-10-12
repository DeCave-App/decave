import assert from "node:assert/strict";
import { register } from "node:module";
import { after, beforeEach, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi, HubRoom } = await import("../../worker/index.ts");
const { tokenHash } = await import("../../worker/db.ts");
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const store = await import("../../worker/bots/store.ts");
const engine = await import("../../worker/bots/engine.ts");
const limits = await import("../../worker/bots/limits.ts");
const events = await import("../../worker/bots/events.ts");
const timers = await import("../../worker/bots/timers.ts");

const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
  BOTS_BUILDER_ENABLED: "true",
};
await ensureHubFeatureSchema(env);
after(() => db.sqlite.close());

const seen = [];
events.setBotEventSpyForTests((event) => seen.push(event));
beforeEach(() => {
  seen.length = 0;
  limits.resetLimitsForTests();
});

const now = new Date().toISOString();
for (const id of ["u1", "u2", "u3"]) {
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
}

function makeHub(visibility = "private") {
  const hubId = Number(
    db.exec(
      "INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at) VALUES('Hub','x','u1',?,?,?)",
      visibility,
      now,
      now,
    ).lastInsertRowid,
  );
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,'u1','owner',?)", hubId, now);
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,'u2','member',?)", hubId, now);
  const room = (name, type = "text") =>
    Number(
      db.exec(
        "INSERT INTO decave_rooms(hub_id,name,type,kind,created_at,updated_at) VALUES(?,?,?,'chat',?,?)",
        hubId,
        name,
        type,
        now,
        now,
      ).lastInsertRowid,
    );
  const roleId = crypto.randomUUID();
  db.exec(
    "INSERT INTO decave_custom_roles(id,hub_id,name,position,created_at) VALUES(?,?,'Gamer',1,?)",
    roleId,
    hubId,
    now,
  );
  return { hubId, roleId, general: room("general"), voice: room("Lounge", "voice") };
}

const rule = (trigger, then, extra = {}) => ({
  v: 1,
  trigger,
  scope: { channels: [], roles: [] },
  cooldown: { perUser: 0, perChannel: 0 },
  then,
  ...extra,
});

async function publish(hub, rules) {
  const bot = await store.createBuilderBot(db, { hubId: hub.hubId, name: "Helper", description: "", createdBy: "u1" });
  for (const r of rules) await store.saveRuleDraft(db, bot.id, null, r, "u1");
  await store.publishBot(db, bot.id, "u1");
  await store.updateBotSettings(db, hub.hubId, bot.id, {
    capabilities: ["send_messages", "manage_roles", "manage_messages"],
  });
  engine.invalidateHubRules(hub.hubId);
  return bot;
}

const botTexts = (botId) =>
  db
    .prepare("SELECT text,visible_to_user_id,card_json,id FROM decave_messages WHERE bot_id=? ORDER BY rowid")
    .bind(botId)
    .all()
    .then((r) => r.results);

function call(path, { method = "GET", body, as = "u2" } = {}) {
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

class FakeSocket {
  constructor(state) {
    this.attachment = state;
    this.sent = [];
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
  close() {}
}

function socketFor(userId, hubId, extra = {}) {
  return new FakeSocket({
    connectionId: `c-${userId}-${Math.random()}`,
    peerAddress: "test",
    authDeadlineAt: 0,
    client: "web",
    userId,
    sessionHash: tokenHash(`tok-${userId}`),
    username: `user-${userId}`,
    serverId: hubId,
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
    lastPresenceTouchAt: Date.now(),
    ...extra,
  });
}

function hubRoomWith(sockets) {
  const ctx = {
    getWebSockets: () => sockets,
    acceptWebSocket() {},
    waitUntil() {},
    storage: { async setAlarm() {}, async deleteAlarm() {}, async get() {}, async put() {} },
  };
  return new HubRoom(ctx, env);
}

async function say(hub, text, userId = "u2") {
  const socket = socketFor(userId, hub.hubId);
  await hubRoomWith([socket]).webSocketMessage(
    socket,
    JSON.stringify({ type: "CHAT_MESSAGE", channelId: hub.general, text }),
  );
  await events.settleBotEventsForTests();
  return socket;
}

const humanRows = (hub, text) =>
  db
    .prepare("SELECT id FROM decave_messages WHERE room_id=? AND text=? AND bot_id IS NULL")
    .bind(hub.general, text)
    .all()
    .then((r) => r.results);

const ROLL = {
  type: "command",
  name: "roll",
  options: [
    { name: "sides", type: "number", required: true },
    { name: "note", type: "text", required: false },
  ],
};

test("/roll 20 posts the bot reply and keeps the message as normal text", async () => {
  const hub = makeHub();
  const bot = await publish(hub, [rule(ROLL, [{ type: "reply", text: "rolled {args.sides} {args.note}" }])]);
  await say(hub, '/roll 20 "good luck"');
  assert.equal((await humanRows(hub, '/roll 20 "good luck"')).length, 1);
  const [reply] = await botTexts(bot.id);
  assert.ok(reply.text.includes("rolled 20 good luck"), reply.text);
  // The bot's own reply goes to message rules as a bot message, one chain level deeper.
  assert.deepEqual(
    seen.map((e) => [e.kind, e.data.command, e.data.args, e.actorIsBot, e.chainDepth]),
    [
      ["command", "roll", { sides: 20, note: "good luck" }, false, 0],
      ["message", undefined, undefined, true, 1],
    ],
  );
});

test("a bad option skips the run and privately shows the usage", async () => {
  const hub = makeHub();
  const bot = await publish(hub, [rule(ROLL, [{ type: "reply", text: "rolled {args.sides}" }])]);
  await say(hub, "/roll lots");
  const rows = await botTexts(bot.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visible_to_user_id, "u2");
  assert.ok(rows[0].text.includes("Usage: /roll <sides> [note]"), rows[0].text);
  const runs = await store.listRuns(db, bot.id);
  assert.equal(runs[0].status, "skipped");
  assert.match(runs[0].detail, /Invalid sides/);
});

test("an unknown /command is saved as text and only reaches message rules", async () => {
  const hub = makeHub();
  const bot = await publish(hub, [rule(ROLL, [{ type: "reply", text: "rolled" }])]);
  await say(hub, "/nope 1");
  assert.equal((await humanRows(hub, "/nope 1")).length, 1);
  assert.deepEqual(
    seen.map((e) => e.kind),
    ["message"],
  );
  assert.equal((await botTexts(bot.id)).length, 0);
});

test("joining a hub runs the Welcome rule: welcome message and role", async () => {
  const hub = makeHub("public");
  const bot = await publish(hub, [
    rule({ type: "memberJoin" }, [
      { type: "sendMessage", channel: String(hub.general), text: "Welcome {user}" },
      { type: "addRole", roleId: hub.roleId },
    ]),
  ]);
  const res = await call(`/api/servers/${hub.hubId}/join`, { method: "POST", as: "u3" });
  assert.equal(res.status, 200);
  await events.settleBotEventsForTests();
  assert.equal((await botTexts(bot.id)).length, 1);
  const role = await db
    .prepare("SELECT 1 AS found FROM decave_member_roles WHERE hub_id=? AND user_id='u3' AND role_id=?")
    .bind(hub.hubId, hub.roleId)
    .first();
  assert.ok(role);
  // Joining again changes nothing, so no second join event.
  seen.length = 0;
  await call(`/api/servers/${hub.hubId}/join`, { method: "POST", as: "u3" });
  await events.settleBotEventsForTests();
  assert.equal(seen.length, 0);
  await call(`/api/servers/${hub.hubId}/leave`, { method: "POST", as: "u3" });
  await events.settleBotEventsForTests();
  assert.deepEqual(
    seen.map((e) => [e.kind, e.actorId]),
    [["memberLeave", "u3"]],
  );
});

test("reaction roles: adding the reaction adds the role, removing it removes it", async () => {
  const hub = makeHub();
  const id = crypto.randomUUID();
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,?,?,'u1','Pick',?)",
    id,
    hub.general,
    hub.hubId,
    now,
  );
  await publish(hub, [
    rule({ type: "reactionAdded", emoji: "🎮", messageId: id }, [{ type: "addRole", roleId: hub.roleId }]),
    rule({ type: "reactionRemoved", emoji: "🎮", messageId: id }, [{ type: "removeRole", roleId: hub.roleId }]),
  ]);
  const hasRole = () =>
    db
      .prepare("SELECT 1 AS found FROM decave_member_roles WHERE hub_id=? AND user_id='u2' AND role_id=?")
      .bind(hub.hubId, hub.roleId)
      .first();
  const react = () =>
    call(`/api/channels/${hub.general}/messages/${id}/reactions`, { method: "POST", body: { emoji: "🎮" } });
  assert.equal((await react()).status, 200);
  await events.settleBotEventsForTests();
  assert.ok(await hasRole());
  assert.equal((await react()).status, 200);
  await events.settleBotEventsForTests();
  assert.equal(await hasRole(), null);
});

test("role assignment dispatches roleAdded and roleRemoved for the changed roles", async () => {
  const hub = makeHub();
  const res = await call(`/api/servers/${hub.hubId}/members/DC-u2/custom-roles`, {
    method: "PATCH",
    body: { roleIds: [hub.roleId] },
    as: "u1",
  });
  assert.equal(res.status, 200);
  await call(`/api/servers/${hub.hubId}/members/DC-u2/custom-roles`, {
    method: "PATCH",
    body: { roleIds: [] },
    as: "u1",
  });
  await events.settleBotEventsForTests();
  assert.deepEqual(
    seen.map((e) => [e.kind, e.actorId, e.data.roleId]),
    [
      ["roleAdded", "u2", hub.roleId],
      ["roleRemoved", "u2", hub.roleId],
    ],
  );
});

async function cardMessage(hub, bot, card, visibleTo = null) {
  const id = crypto.randomUUID();
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,bot_id,card_json,visible_to_user_id) VALUES(?,?,?,'u1','card',?,?,?,?)",
    id,
    hub.general,
    hub.hubId,
    now,
    bot.id,
    JSON.stringify(card),
    visibleTo,
  );
  return id;
}

test("a button click dispatches a component event for a control on the bot's card", async () => {
  const hub = makeHub();
  const bot = await publish(hub, [
    rule({ type: "component", customId: "choice" }, [{ type: "sendMessage", channel: "trigger", text: "picked" }]),
  ]);
  const messageId = await cardMessage(hub, bot, {
    text: "Pick",
    buttons: [{ customId: "choice", label: "Go", style: "primary" }],
  });
  const res = await call(`/api/rooms/${hub.general}/bot-interactions`, {
    method: "POST",
    body: { messageId, customId: "choice" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.ok((await botTexts(bot.id)).some((row) => row.text.includes("picked")));

  const bad = await call(`/api/rooms/${hub.general}/bot-interactions`, {
    method: "POST",
    body: { messageId, customId: "other" },
  });
  assert.equal(bad.status, 400);
  const human = crypto.randomUUID();
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,?,?,'u1','x',?)",
    human,
    hub.general,
    hub.hubId,
    now,
  );
  const notBot = await call(`/api/rooms/${hub.general}/bot-interactions`, {
    method: "POST",
    body: { messageId: human, customId: "choice" },
  });
  assert.equal(notBot.status, 404);
  const outsider = await call(`/api/rooms/${hub.general}/bot-interactions`, {
    method: "POST",
    body: { messageId, customId: "choice" },
    as: "u3",
  });
  assert.equal(outsider.status, 404);
});

test("a select needs one of its own values", async () => {
  const hub = makeHub();
  const bot = await publish(hub, [
    rule({ type: "component", customId: "game" }, [{ type: "reply", text: "ok {value}" }]),
  ]);
  const messageId = await cardMessage(hub, bot, {
    select: { customId: "game", options: [{ label: "Chess", value: "chess" }] },
  });
  const path = `/api/rooms/${hub.general}/bot-interactions`;
  assert.equal((await call(path, { method: "POST", body: { messageId, customId: "game", value: "go" } })).status, 400);
  assert.equal(
    (await call(path, { method: "POST", body: { messageId, customId: "game", value: "chess" } })).status,
    200,
  );
  assert.ok((await botTexts(bot.id)).some((row) => row.text.includes("ok chess")));
});

test("forms: opened by a button, submitted once, field rules enforced", async () => {
  const hub = makeHub();
  const fields = [
    { id: "name", label: "Name", style: "short", required: true },
    { id: "why", label: "Why", style: "long", required: false },
  ];
  const bot = await publish(hub, [
    rule({ type: "component", customId: "apply" }, [{ type: "openForm", formId: "app", title: "Apply", fields }]),
    rule({ type: "formSubmit", formId: "app" }, [
      { type: "sendMessage", channel: "trigger", text: "Thanks {field.name}" },
    ]),
  ]);
  const messageId = await cardMessage(hub, bot, { buttons: [{ customId: "apply", label: "Apply", style: "primary" }] });
  const formPath = `/api/rooms/${hub.general}/bot-forms/app`;

  // Not opened yet: refused.
  assert.equal((await call(formPath, { method: "POST", body: { fields: { name: "Ann" } } })).status, 404);

  const opened = await call(`/api/rooms/${hub.general}/bot-interactions`, {
    method: "POST",
    body: { messageId, customId: "apply" },
  });
  assert.deepEqual(await opened.json(), { ok: true, form: { formId: "app", title: "Apply", fields } });

  const six = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, "x"]));
  assert.equal((await call(formPath, { method: "POST", body: { fields: six } })).status, 400);
  assert.equal((await call(formPath, { method: "POST", body: { fields: { bogus: "x" } } })).status, 400);
  assert.equal((await call(formPath, { method: "POST", body: { fields: { name: "x".repeat(1001) } } })).status, 400);
  assert.equal((await call(formPath, { method: "POST", body: { fields: { why: "no name" } } })).status, 400);
  // Another member can't submit a form opened for u2.
  assert.equal((await call(formPath, { method: "POST", body: { fields: { name: "Eve" } }, as: "u1" })).status, 404);

  const ok = await call(formPath, { method: "POST", body: { fields: { name: "Ann" } } });
  assert.equal(ok.status, 200);
  assert.ok((await botTexts(bot.id)).some((row) => row.text.includes("Thanks Ann")));
  assert.equal((await call(formPath, { method: "POST", body: { fields: { name: "Ann" } } })).status, 404);
  assert.equal(
    (await call(`/api/rooms/${hub.general}/bot-forms/made-up`, { method: "POST", body: { fields: { name: "A" } } }))
      .status,
    404,
  );
});

test("the composer command list shows published commands to members only", async () => {
  const hub = makeHub();
  await publish(hub, [rule(ROLL, [{ type: "reply", text: "r" }])]);
  const res = await call(`/api/servers/${hub.hubId}/bot-commands`);
  assert.equal(res.status, 200);
  const { commands } = await res.json();
  assert.deepEqual(
    commands.map((c) => [c.name, c.botName, c.options.length]),
    [["roll", "Helper", 2]],
  );
  assert.equal((await call(`/api/servers/${hub.hubId}/bot-commands`, { as: "u3" })).status, 403);
  env.BOTS_BUILDER_ENABLED = "false";
  const off = await call(`/api/servers/${hub.hubId}/bot-commands`);
  env.BOTS_BUILDER_ENABLED = "true";
  assert.equal(off.status, 404);
});

test("dispatch failures never fail the user's request", async () => {
  const hub = makeHub();
  await publish(hub, [rule(ROLL, [{ type: "reply", text: "r" }])]);
  db.exec("ALTER TABLE decave_bot_rules RENAME TO decave_bot_rules_away");
  try {
    const socket = await say(hub, "/roll 3");
    assert.equal((await humanRows(hub, "/roll 3")).length, 1);
    assert.equal(socket.sent.filter((e) => e.type === "ERROR").length, 0);
    const id = crypto.randomUUID();
    db.exec(
      "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,?,?,'u1','x',?)",
      id,
      hub.general,
      hub.hubId,
      now,
    );
    engine.invalidateHubRules(hub.hubId);
    const res = await call(`/api/channels/${hub.general}/messages/${id}/reactions`, {
      method: "POST",
      body: { emoji: "👍" },
    });
    assert.equal(res.status, 200);
    await events.settleBotEventsForTests();
  } finally {
    db.exec("ALTER TABLE decave_bot_rules_away RENAME TO decave_bot_rules");
  }
});

test("direct messages never reach the bot engine", async () => {
  const hub = makeHub();
  const bot = await publish(hub, [
    rule({ type: "message", mode: "contains", pattern: "gg", caseSensitive: false }, [{ type: "reply", text: "hi" }]),
  ]);
  db.exec("INSERT OR IGNORE INTO decave_friendships(user_a,user_b,created_at) VALUES('u1','u2',?)", now);
  const socket = socketFor("u2", hub.hubId);
  await hubRoomWith([socket]).webSocketMessage(
    socket,
    JSON.stringify({ type: "DM_MESSAGE", targetUserId: "DC-u1", text: "gg /roll 20" }),
  );
  await events.settleBotEventsForTests();
  const saved = await db.prepare("SELECT COUNT(*) AS n FROM decave_direct_messages WHERE from_user_id='u2'").first();
  assert.equal(saved.n, 1);
  assert.equal(seen.length, 0);
  assert.equal((await store.listRuns(db, bot.id)).length, 0);
});

test("voice join and leave fire once per real change, not per device", async () => {
  const hub = makeHub();
  const phone = socketFor("u2", hub.hubId);
  const laptop = socketFor("u2", hub.hubId);
  const room = hubRoomWith([phone, laptop]);
  await room.webSocketMessage(phone, JSON.stringify({ type: "VOICE_JOIN", channelId: hub.voice }));
  await events.settleBotEventsForTests();
  // The newest device takes over the same room: no change.
  await room.webSocketMessage(laptop, JSON.stringify({ type: "VOICE_JOIN", channelId: hub.voice }));
  await events.settleBotEventsForTests();
  await room.webSocketMessage(laptop, JSON.stringify({ type: "VOICE_LEAVE" }));
  await events.settleBotEventsForTests();
  assert.deepEqual(
    seen.map((e) => [e.kind, e.roomId, e.data.roomId, e.actorId]),
    [
      ["voiceJoin", hub.voice, String(hub.voice), "u2"],
      ["voiceLeave", hub.voice, String(hub.voice), "u2"],
    ],
  );
});

test("a hub event start fires hubEventStart rules at its start time", async () => {
  const hub = makeHub();
  const bot = await publish(hub, [
    rule({ type: "hubEventStart" }, [{ type: "sendMessage", channel: "trigger", text: "Starting!" }]),
  ]);
  const startsAt = Date.now() + 3 * 3600_000;
  const res = await call(`/api/servers/${hub.hubId}/events`, {
    method: "POST",
    as: "u1",
    body: {
      title: "Raid night",
      startsAt,
      endsAt: startsAt + 3600_000,
      timezone: "UTC",
      channelId: String(hub.general),
    },
  });
  assert.equal(res.status, 201, await res.clone().text());
  await events.settleBotEventsForTests();
  const timer = await db.prepare("SELECT * FROM decave_bot_timers WHERE key LIKE 'hubevent:%'").first();
  assert.equal(timer.fire_at, startsAt);
  await timers.runAllDueBotTimers(env, startsAt + 1000);
  await events.settleBotEventsForTests();
  assert.ok((await botTexts(bot.id)).some((row) => row.text.includes("Starting!")));
});

test("bad command input is skipped, never auto-pauses the bot, and is capped by the run budget", async () => {
  const hub = makeHub();
  const bot = await publish(hub, [rule(ROLL, [{ type: "reply", text: "rolled" }])]);
  const bad = () =>
    events.dispatchHubMessage(env, {
      hubId: hub.hubId,
      roomId: hub.general,
      messageId: crypto.randomUUID(),
      text: "/roll x",
      actorId: "u2",
      actorIsBot: false,
      chainDepth: 0,
    });
  for (let i = 0; i < 60; i++) await bad();
  const row = await store.getBot(db, hub.hubId, bot.id);
  assert.equal(row.enabled, 1);
  assert.equal(row.failure_streak, 0);
  const runs = await db
    .prepare("SELECT status, COUNT(*) AS n FROM decave_bot_runs WHERE bot_id=? GROUP BY status")
    .bind(bot.id)
    .all();
  assert.deepEqual(
    runs.results.map((r) => [r.status, r.n]),
    [["skipped", 60]],
  );

  limits.resetLimitsForTests();
  const count = async () =>
    (await db.prepare("SELECT COUNT(*) AS n FROM decave_bot_runs WHERE bot_id=?").bind(bot.id).first()).n;
  for (let i = 0; i < 120; i++) await bad();
  const before = await count();
  const messagesBefore = (await botTexts(bot.id)).length;
  await bad();
  assert.equal(await count(), before);
  assert.equal((await botTexts(bot.id)).length, messagesBefore);
});

test("a timeout that ends a voice session fires voiceLeave", async () => {
  const hub = makeHub();
  const socket = socketFor("u2", hub.hubId);
  const room = hubRoomWith([socket]);
  await room.webSocketMessage(socket, JSON.stringify({ type: "VOICE_JOIN", channelId: hub.voice }));
  await events.settleBotEventsForTests();
  seen.length = 0;
  db.exec(
    "INSERT INTO decave_timeouts(hub_id,user_id,timed_out_by,expires_at,created_at) VALUES(?,'u2','u1',?,datetime('now'))",
    hub.hubId,
    new Date(Date.now() + 600_000).toISOString(),
  );
  const res = await room.fetch(
    new Request("https://internal.decave/internal/recheck-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hubId: hub.hubId }),
    }),
  );
  assert.equal(res.status, 200);
  await events.settleBotEventsForTests();
  assert.deepEqual(
    seen.map((e) => [e.kind, e.roomId, e.actorId]),
    [["voiceLeave", hub.voice, "u2"]],
  );
});

test("kicking a member fires memberLeave once", async () => {
  const hub = makeHub();
  const res = await call(`/api/servers/${hub.hubId}/members/DC-u2/kick`, { method: "POST", body: {}, as: "u1" });
  assert.equal(res.status, 200);
  await events.settleBotEventsForTests();
  assert.deepEqual(
    seen.map((e) => [e.kind, e.data.reason]),
    [["memberLeave", "kicked"]],
  );
});

test("member variables render names, the public id and an @mention, never the database id", async () => {
  const hub = makeHub("public");
  const bot = await publish(hub, [
    rule({ type: "memberJoin" }, [
      {
        type: "sendMessage",
        channel: String(hub.general),
        text: "Welcome {user.mention}! {user}|{user.name}|{user.id}",
      },
    ]),
  ]);
  await call(`/api/servers/${hub.hubId}/join`, { method: "POST", as: "u3" });
  await events.settleBotEventsForTests();
  const [row] = await botTexts(bot.id);
  assert.ok(row.text.includes("Welcome @user-u3! user-u3|user-u3|DC-u3"), row.text);
  assert.ok(!row.text.includes("|u3|"));
});
