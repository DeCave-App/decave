import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const store = await import("../../worker/bots/store.ts");
const engine = await import("../../worker/bots/engine.ts");
const limits = await import("../../worker/bots/limits.ts");
const { messageForClient, messagesForClient } = await import("../../worker/lib/messages.ts");

const db = new D1Mock();
const broadcasts = [];
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  BOTS_BUILDER_ENABLED: "true",
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({
      fetch: async (request) => {
        if (new URL(request.url).pathname === "/internal/broadcast") broadcasts.push(await request.json());
        return Response.json({ success: true });
      },
    }),
  },
};
await ensureHubFeatureSchema(env);

const now = new Date().toISOString();
for (const [id, name] of [
  ["u1", "owner"],
  ["u2", "pal"],
  ["u3", "staff"],
  ["u4", "outsider"],
])
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES(?,?,'s','h',?)",
    id,
    name,
    now,
  );

let hubSeq = 0;
function makeHub() {
  const hubId = Number(
    db.exec(
      "INSERT INTO decave_hubs(name,icon,owner_id,created_at,updated_at) VALUES(?,'x','u1',?,?)",
      `Hub ${++hubSeq}`,
      now,
      now,
    ).lastInsertRowid,
  );
  db.exec(
    "INSERT OR IGNORE INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,'u1','owner',?)",
    hubId,
    now,
  );
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,'u2','member',?)", hubId, now);
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,'u3','admin',?)", hubId, now);
  const room = (name, type = "text", extra = {}) =>
    Number(
      db.exec(
        "INSERT INTO decave_rooms(hub_id,name,type,kind,private,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        hubId,
        name,
        type,
        extra.kind ?? "chat",
        extra.private ?? 0,
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
  return {
    hubId,
    roleId,
    general: room("general"),
    other: room("other"),
    voice: room("Lounge", "voice"),
    forum: room("help", "text", { kind: "forum" }),
  };
}

const rule = (then, overrides = {}) => ({
  v: 1,
  trigger: { type: "message", mode: "contains", pattern: "gg", caseSensitive: false },
  scope: { channels: [], roles: [] },
  cooldown: { perUser: 0, perChannel: 0 },
  then,
  ...overrides,
});

const ALL_CAPS = ["send_messages", "manage_roles", "manage_messages", "create_polls", "create_events"];

async function setup(then, { publisher = "u1", patch = {}, hub = makeHub() } = {}) {
  const bot = await store.createBuilderBot(db, { hubId: hub.hubId, name: "Helper", description: "", createdBy: "u1" });
  await store.saveRuleDraft(db, bot.id, null, rule(then), publisher);
  await store.publishBot(db, bot.id, publisher);
  await store.updateBotSettings(db, hub.hubId, bot.id, { capabilities: ALL_CAPS, ...patch });
  engine.invalidateHubRules(hub.hubId);
  return { ...hub, bot };
}

function humanMessage(hub, roomId, author = "u2", text = "gg everyone") {
  const id = crypto.randomUUID();
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES(?,?,?,?,?,?)",
    id,
    roomId,
    hub.hubId,
    author,
    text,
    now,
  );
  return id;
}

async function fire(hub, overrides = {}) {
  const roomId = overrides.roomId ?? hub.general;
  const messageId = humanMessage(hub, roomId);
  const steps = await engine.dispatchBotEvent(
    env,
    {
      hubId: hub.hubId,
      roomId,
      kind: "message",
      actorId: "u2",
      actorIsBot: false,
      chainDepth: 0,
      data: { text: "gg all", messageId },
      ...overrides,
    },
    overrides.opts ?? {},
  );
  return { steps, messageId };
}

const botMessages = (botId) =>
  db
    .prepare("SELECT * FROM decave_messages WHERE bot_id=? ORDER BY rowid")
    .bind(botId)
    .all()
    .then((r) => r.results);

beforeEach(() => {
  broadcasts.length = 0;
  limits.resetLimitsForTests();
});

test("sendMessage renders the template, stores the bot message and broadcasts it", async () => {
  const hub = await setup([{ type: "sendMessage", channel: "trigger", text: "Welcome {user|upper} @everyone" }]);
  const { steps } = await fire(hub);
  assert.deepEqual(
    steps.map((s) => [s.action, s.ok]),
    [["sendMessage", true]],
  );
  const [row] = await botMessages(hub.bot.id);
  assert.equal(row.room_id, hub.general);
  assert.equal(row.author_user_id, "u1");
  const message = await messageForClient(env, row.id);
  assert.ok(message.text.includes(`Welcome PAL @${String.fromCharCode(0x200b)}everyone`));
  assert.deepEqual(message.bot, {
    id: hub.bot.id,
    name: "Helper",
    color: hub.bot.color,
    avatarEmoji: hub.bot.avatar_emoji,
  });
  const sent = broadcasts.find((b) => b.event.type === "CHAT_MESSAGE");
  assert.equal(sent.filter.channelId, hub.general);
  assert.equal(sent.event.id, row.id);
});

test("an explicit channel id is used; a deleted channel is refused", async () => {
  const hub = await setup([{ type: "sendMessage", channel: "999999", text: "hi" }]);
  const { steps } = await fire(hub);
  assert.equal(steps[0].ok, false);
  assert.equal(steps[0].reason, "Channel no longer exists");
  assert.equal((await botMessages(hub.bot.id)).length, 0);
});

test("DM, group-chat and voice targets are refused", async () => {
  for (const channel of [crypto.randomUUID(), "dm:abc", "-4"]) {
    const hub = await setup([{ type: "sendMessage", channel, text: "hi" }]);
    const { steps } = await fire(hub);
    assert.equal(steps[0].reason, "Bots can only act in hub channels", channel);
  }
  const hub = makeHub();
  const bot = await setup([{ type: "sendMessage", channel: String(hub.voice), text: "hi" }], { hub });
  const { steps } = await fire(bot);
  assert.equal(steps[0].reason, "Bots can only post in text channels and forums");
});

test("a channel of another hub is refused", async () => {
  const otherHub = makeHub();
  const hub = await setup([{ type: "sendMessage", channel: String(otherHub.general), text: "hi" }]);
  const { steps } = await fire(hub);
  assert.equal(steps[0].reason, "Channel isn't in this hub");
});

test("a room outside the bot's allowed rooms is refused", async () => {
  const hub = makeHub();
  const bot = await setup([{ type: "sendMessage", channel: "trigger", text: "hi" }], {
    hub,
    patch: { allowedRoomIds: [hub.other] },
  });
  const { steps } = await fire(bot);
  assert.equal(steps[0].reason, "Bot isn't allowed in this channel");
});

test("a publisher who can no longer see a private room is refused", async () => {
  const hub = makeHub();
  db.exec("UPDATE decave_rooms SET private=1 WHERE id=?", hub.general);
  const bot = await setup([{ type: "sendMessage", channel: "trigger", text: "hi" }], { hub, publisher: "u2" });
  const { steps } = await fire(bot);
  assert.equal(steps[0].reason, "Publisher can't access this channel");
});

test("a publisher who left the hub refuses everything", async () => {
  const hub = makeHub();
  const bot = await setup(
    [
      { type: "setVariable", name: "count", scope: "hub", value: 1 },
      { type: "sendMessage", channel: "trigger", text: "hi" },
    ],
    { hub, publisher: "u3" },
  );
  db.exec("DELETE FROM decave_hub_members WHERE hub_id=? AND user_id='u3'", hub.hubId);
  const { steps } = await fire(bot);
  assert.equal(steps[0].reason, "Publisher is no longer in this hub");
});

test("addRole works for an owner-published bot and records the change", async () => {
  const hub2 = makeHub();
  const bot = await setup([{ type: "addRole", roleId: hub2.roleId }], { hub: hub2 });
  const { steps } = await fire(bot);
  assert.deepEqual(steps.at(-1), {
    ruleId: steps.at(-1).ruleId,
    action: "addRole",
    description: steps.at(-1).description,
    descriptionNotice: { code: "bots.run.server.roleStep", params: { action: "addRole", role: hub2.roleId } },
    ok: true,
  });
  const row = await db
    .prepare("SELECT 1 AS found FROM decave_member_roles WHERE hub_id=? AND user_id='u2' AND role_id=?")
    .bind(hub2.hubId, hub2.roleId)
    .first();
  assert.ok(row);
});

test("a publisher who is not the hub owner can't manage roles (mirrors the role-assign route)", async () => {
  for (const publisher of ["u3", "u2"]) {
    const hub = makeHub();
    const bot = await setup([{ type: "addRole", roleId: hub.roleId }], { hub, publisher });
    const { steps } = await fire(bot);
    assert.equal(steps[0].reason, "Publisher can't manage this role", publisher);
  }
});

test("a role demoted publisher (admin -> member) is refused and a role of another hub is refused", async () => {
  const hub = makeHub();
  const bot = await setup([{ type: "removeRole", roleId: hub.roleId }], { hub, publisher: "u3" });
  db.exec("UPDATE decave_hub_members SET role='member' WHERE hub_id=? AND user_id='u3'", hub.hubId);
  assert.equal((await fire(bot)).steps[0].reason, "Publisher can't manage this role");

  const other = makeHub();
  const owned = await setup([{ type: "addRole", roleId: other.roleId }]);
  assert.equal((await fire(owned)).steps[0].reason, "Role no longer exists");
});

test("a missing manage_roles capability is refused before the handler runs", async () => {
  const hub = makeHub();
  const bot = await setup([{ type: "addRole", roleId: hub.roleId }], {
    hub,
    patch: { capabilities: ["send_messages"] },
  });
  const { steps } = await fire(bot);
  assert.equal(steps[0].reason, "Bot isn't allowed to manage_roles");
});

test("toggleRole with a duration writes a revert timer", async () => {
  const hub = makeHub();
  const bot = await setup([{ type: "toggleRole", roleId: hub.roleId, durationMinutes: 30 }], { hub });
  const { steps } = await fire(bot);
  assert.equal(steps[0].ok, true);
  const timers = await db.prepare("SELECT * FROM decave_bot_timers WHERE bot_id=?").bind(bot.bot.id).all();
  assert.equal(timers.results.length, 1);
  const timer = timers.results[0];
  assert.match(timer.key, new RegExp(`^role:u2:${hub.roleId}:\\d{4}-\\d\\d-\\d\\dT`));
  assert.deepEqual(JSON.parse(timer.payload_json), { kind: "role", op: "remove", userId: "u2", roleId: hub.roleId });
  assert.equal(timer.room_id, hub.general);
});

test("privateNotice is visible only to its target, in reads and in the broadcast", async () => {
  const hub = await setup([{ type: "privateNotice", text: "Only for you" }]);
  await fire(hub);
  const [row] = await botMessages(hub.bot.id);
  assert.equal(row.visible_to_user_id, "u2");
  assert.equal(await messageForClient(env, row.id), null);
  assert.equal(await messageForClient(env, row.id, "u1"), null);
  assert.equal((await messageForClient(env, row.id, "u2")).id, row.id);
  assert.deepEqual(await messagesForClient(env, [row.id], "u3"), []);
  const sent = broadcasts.find((b) => b.event.type === "CHAT_MESSAGE");
  assert.deepEqual(sent.filter, { channelId: hub.general, userIds: ["u2"] });
});

test("editMessage refuses a human message and edits the bot's own", async () => {
  const hub = makeHub();
  const human = humanMessage(hub, hub.general, "u1", "mine");
  const bot = await setup([{ type: "editMessage", messageRef: human, text: "hacked" }], { hub });
  assert.equal((await fire(bot)).steps[0].reason, "Bots can only edit their own messages");
  assert.equal((await db.prepare("SELECT text FROM decave_messages WHERE id=?").bind(human).first()).text, "mine");

  const hub2 = makeHub();
  const poster = await setup([{ type: "sendMessage", channel: "trigger", text: "v1" }], { hub: hub2 });
  await fire(poster);
  const [own] = await botMessages(poster.bot.id);
  await store.saveRuleDraft(
    db,
    poster.bot.id,
    null,
    rule([{ type: "editMessage", messageRef: own.id, text: "v2" }]),
    "u1",
  );
  db.exec("DELETE FROM decave_bot_rules WHERE bot_id=? AND published_json LIKE '%sendMessage%'", poster.bot.id);
  await store.publishBot(db, poster.bot.id, "u1");
  engine.invalidateHubRules(hub2.hubId);
  const { steps } = await fire(poster);
  assert.equal(steps[0].ok, true);
  assert.match((await messageForClient(env, own.id)).text, /v2/);
});

test("the 201st variable name is refused", async () => {
  const hub = makeHub();
  for (let i = 0; i < 200; i++)
    db.exec(
      "INSERT INTO decave_bot_variables(hub_id,name,scope,user_id,type,value) VALUES(?,?,'hub','','text','x')",
      hub.hubId,
      `v${i}`,
    );
  const bot = await setup([{ type: "setVariable", name: "fresh", scope: "hub", value: "y" }], { hub });
  assert.equal((await fire(bot)).steps[0].reason, "Variable limit reached");
});

test("addVariable adds to a user variable and resetVariable clears it", async () => {
  const hub = makeHub();
  const bot = await setup(
    [
      { type: "addVariable", name: "xp", scope: "user", value: 5 },
      { type: "addVariable", name: "xp", scope: "user" },
    ],
    { hub },
  );
  await fire(bot);
  assert.equal(await store.getVariable(db, hub.hubId, "xp", "user", "u2"), 6);
  await store.updateBotSettings(db, hub.hubId, bot.bot.id, { enabled: false });
  const reset = await setup([{ type: "resetVariable", name: "xp", scope: "user" }], { hub });
  await fire(reset);
  assert.equal(await store.getVariable(db, hub.hubId, "xp", "user", "u2"), null);
});

test("messages stop at the hub's per-minute message budget", async () => {
  const hub = await setup([{ type: "sendMessage", channel: "trigger", text: "hi" }]);
  for (let i = 0; i < 30; i++) limits.takeBudget(hub.hubId, "messages");
  assert.equal((await fire(hub)).steps[0].reason, "Message limit reached");
});

test("budget misses are logged as limited and do not count toward auto-pause", async () => {
  for (const [budget, then] of [
    ["messages", [{ type: "sendMessage", channel: "trigger", text: "hi" }]],
    ["webhooks", [{ type: "webhook", url: "https://example.com/h", method: "GET" }]],
  ]) {
    const hub = await setup(then, { patch: { capabilities: [...ALL_CAPS, "webhooks"] } });
    const max = budget === "messages" ? 30 : 10;
    for (let i = 0; i < max; i++) limits.takeBudget(hub.hubId, budget);
    await fire(hub);
    const run = db.prepare("SELECT status FROM decave_bot_runs WHERE bot_id=? ORDER BY id DESC").bind(hub.bot.id);
    assert.equal((await run.first()).status, "limited", budget);
    assert.equal((await store.getBot(db, hub.hubId, hub.bot.id)).failure_streak, 0, budget);
  }
});

test("dry run checks guards but writes nothing", async () => {
  const hub = makeHub();
  const bot = await setup(
    [
      { type: "sendMessage", channel: "trigger", text: "hi" },
      { type: "addRole", roleId: hub.roleId },
      { type: "setVariable", name: "n", scope: "hub", value: 1 },
    ],
    { hub },
  );
  const { steps } = await fire(bot, { opts: { dryRun: true } });
  assert.deepEqual(
    steps.map((s) => s.ok),
    [true, true, true],
  );
  assert.equal((await botMessages(bot.bot.id)).length, 0);
  assert.equal(await store.getVariable(db, hub.hubId, "n", "hub", null), null);
  assert.equal(broadcasts.length, 0);
});

test("reply, pin and react act on the trigger message", async () => {
  const hub = await setup([
    { type: "reply", text: "noted" },
    { type: "pin", messageRef: "trigger" },
    { type: "react", emoji: "👍" },
  ]);
  const { steps, messageId } = await fire(hub);
  assert.deepEqual(
    steps.map((s) => s.ok),
    [true, true, true],
  );
  const [reply] = await botMessages(hub.bot.id);
  assert.equal(reply.reply_to_id, messageId);
  const trigger = await db.prepare("SELECT pinned FROM decave_messages WHERE id=?").bind(messageId).first();
  assert.equal(trigger.pinned, 1);
  const reaction = await db
    .prepare("SELECT emoji FROM decave_message_reactions WHERE message_id=?")
    .bind(messageId)
    .first();
  assert.equal(reaction.emoji, "👍");
});

test("react refuses poll and forum vote emoji", async () => {
  const hub = await setup([{ type: "react", emoji: "poll_0" }]);
  assert.equal((await fire(hub)).steps[0].reason, "That emoji is reserved");
});

test("deleteTrigger removes the trigger message", async () => {
  const hub = await setup([{ type: "deleteTrigger" }]);
  const { steps, messageId } = await fire(hub);
  assert.equal(steps[0].ok, true);
  assert.equal(await db.prepare("SELECT id FROM decave_messages WHERE id=?").bind(messageId).first(), null);
  assert.ok(broadcasts.find((b) => b.event.type === "MESSAGE_DELETED"));
});

test("startPoll posts a poll and createEvent creates a hub event", async () => {
  const hub = await setup([
    { type: "startPoll", question: "Best map?", options: ["Dust", "Mirage"] },
    { type: "createEvent", title: "Scrim {user}", startsInMinutes: 60, durationMinutes: 90 },
  ]);
  const { steps } = await fire(hub);
  assert.deepEqual(
    steps.map((s) => s.ok),
    [true, true],
  );
  const [poll] = await botMessages(hub.bot.id);
  assert.equal(poll.text, `__DECAVE_POLL__${JSON.stringify({ question: "Best map?", options: ["Dust", "Mirage"] })}`);
  const event = await db.prepare("SELECT * FROM decave_hub_events WHERE hub_id=?").bind(hub.hubId).first();
  assert.equal(event.title, "Scrim pal");
  assert.equal(event.created_by, "u1");
  assert.equal(event.ends_at - event.starts_at, 90 * 60_000);
});

test("createThread needs a forum channel and posts a forum post there", async () => {
  const chat = await setup([{ type: "createThread", name: "Help" }]);
  assert.equal((await fire(chat)).steps[0].reason, "Threads need a forum channel");
  const hub = makeHub();
  const forum = await setup([{ type: "createThread", name: "Help for {user}" }], { hub });
  const { steps } = await fire(forum, { roomId: hub.forum });
  assert.equal(steps[0].ok, true);
  const state = await db
    .prepare("SELECT title FROM decave_forum_post_state WHERE channel_id=?")
    .bind(hub.forum)
    .first();
  assert.equal(state.title, "Help for pal");
});

test("openForm hands the form to the interaction and refuses outside one", async () => {
  const form = {
    type: "openForm",
    formId: "apply",
    title: "Apply",
    fields: [{ id: "why", label: "Why?", style: "long", required: true }],
  };
  const hub = await setup([form]);
  assert.equal((await fire(hub)).steps[0].reason, "Forms need a command or button");
  const interaction = {};
  const { steps } = await fire(hub, { kind: "message", opts: { interaction } });
  assert.equal(steps[0].ok, true);
  assert.deepEqual(interaction.form, { formId: "apply", title: "Apply", fields: form.fields });
});

test("stop ends the rule and runRule runs another rule one level deeper", async () => {
  const hub = makeHub();
  const bot = await store.createBuilderBot(db, { hubId: hub.hubId, name: "Flow", description: "", createdBy: "u1" });
  const target = await store.saveRuleDraft(
    db,
    bot.id,
    null,
    rule([{ type: "setVariable", name: "ran", scope: "hub", value: "{text}" }], {
      trigger: { type: "message", mode: "exact", pattern: "never matches", caseSensitive: true },
    }),
    "u1",
  );
  await store.saveRuleDraft(
    db,
    bot.id,
    null,
    rule([
      { type: "runRule", ruleId: target },
      { type: "stop" },
      { type: "setVariable", name: "after", scope: "hub", value: 1 },
    ]),
    "u1",
  );
  await store.publishBot(db, bot.id, "u1");
  engine.invalidateHubRules(hub.hubId);
  await fire({ ...hub, bot });
  assert.equal(await store.getVariable(db, hub.hubId, "ran", "hub", null), "gg all");
  assert.equal(await store.getVariable(db, hub.hubId, "after", "hub", null), null);
  const { steps } = await fire({ ...hub, bot }, { chainDepth: 2 });
  assert.equal(steps[0].reason, "Bot chain too deep");
});

test("messages without a bot keep their existing client shape", async () => {
  const hub = makeHub();
  const id = humanMessage(hub, hub.general, "u2", "plain");
  const message = await messageForClient(env, id);
  assert.deepEqual(Object.keys(message).sort(), [
    "attachment",
    "avatarUrl",
    "channelId",
    "editedAt",
    "id",
    "pinned",
    "reactions",
    "replyToId",
    "role",
    "text",
    "timestamp",
    "userId",
    "username",
  ]);
});

test("runRule spends the run budget; a refused linked run stops and logs limited", async () => {
  const hub = makeHub();
  const bot = await store.createBuilderBot(db, { hubId: hub.hubId, name: "Loop", description: "", createdBy: "u1" });
  const target = await store.saveRuleDraft(
    db,
    bot.id,
    null,
    rule([{ type: "setVariable", name: "linked", scope: "hub", value: 1 }], {
      trigger: { type: "message", mode: "exact", pattern: "never matches", caseSensitive: true },
    }),
    "u1",
  );
  await store.saveRuleDraft(
    db,
    bot.id,
    null,
    rule([
      { type: "runRule", ruleId: target },
      { type: "setVariable", name: "after", scope: "hub", value: 1 },
    ]),
    "u1",
  );
  await store.publishBot(db, bot.id, "u1");
  engine.invalidateHubRules(hub.hubId);
  // Leave exactly one run: the triggering rule takes it, the linked run is refused.
  for (let i = 0; i < 119; i++) limits.takeBudget(hub.hubId, "runs");
  await fire({ ...hub, bot });
  assert.equal(await store.getVariable(db, hub.hubId, "linked", "hub", null), null);
  assert.equal(await store.getVariable(db, hub.hubId, "after", "hub", null), null);
  const runs = await store.listRuns(db, bot.id);
  assert.ok(runs.some((r) => r.status === "limited" && r.rule_id === target));
});

test("react spends the message budget", async () => {
  const hub = await setup([{ type: "react", emoji: "👍" }]);
  for (let i = 0; i < 30; i++) limits.takeBudget(hub.hubId, "messages");
  assert.equal((await fire(hub)).steps[0].reason, "Message limit reached");
});

test("a timed role from a memberJoin rule is anchored to the hub's first text room", async () => {
  const hub = makeHub();
  const bot = await store.createBuilderBot(db, { hubId: hub.hubId, name: "Greeter", description: "", createdBy: "u1" });
  await store.saveRuleDraft(
    db,
    bot.id,
    null,
    rule([{ type: "addRole", roleId: hub.roleId, durationMinutes: 10080 }], { trigger: { type: "memberJoin" } }),
    "u1",
  );
  await store.publishBot(db, bot.id, "u1");
  await store.updateBotSettings(db, hub.hubId, bot.id, { capabilities: ALL_CAPS });
  engine.invalidateHubRules(hub.hubId);
  const steps = await engine.dispatchBotEvent(env, {
    hubId: hub.hubId,
    roomId: null,
    kind: "memberJoin",
    actorId: "u2",
    actorIsBot: false,
    chainDepth: 0,
    data: {},
  });
  assert.equal(steps[0].ok, true);
  const timer = await db.prepare("SELECT * FROM decave_bot_timers WHERE bot_id=?").bind(bot.id).first();
  assert.equal(timer.room_id, hub.general);
  assert.ok(timer.fire_at - Date.now() > 10079 * 60_000);
});

test("reply into a locked forum post is refused", async () => {
  const hub = makeHub();
  // A member publisher is not forum staff, so the lock applies.
  await setup([{ type: "reply", text: "hi" }], { hub, publisher: "u2" });
  const post = humanMessage(
    hub,
    hub.forum,
    "u2",
    `__DECAVE_FORUM_POST_V1__${JSON.stringify({ version: 1, title: "Q", tags: [], body: "" })}`,
  );
  db.exec("UPDATE decave_forum_post_state SET locked=1 WHERE message_id=?", post);
  const steps = await engine.dispatchBotEvent(env, {
    hubId: hub.hubId,
    roomId: hub.forum,
    kind: "message",
    actorId: "u2",
    actorIsBot: false,
    chainDepth: 0,
    data: { text: "gg", messageId: post },
  });
  assert.equal(steps[0].reason, "This post is locked");
});

test("the shared action-to-capability map matches every registered handler", async () => {
  const { getAction } = await import("../../worker/bots/actions/registry.ts");
  const { ACTION_CAPABILITY } = await import("../../shared/bots/capabilities.ts");
  const { ACTION_TYPES } = await import("../../shared/bots/catalogue.ts");
  for (const type of ACTION_TYPES) assert.equal(ACTION_CAPABILITY[type], getAction(type)?.capability ?? null, type);
});
