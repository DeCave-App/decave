import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const { hasPermission, tokenHash } = await import("../../worker/db.ts");
const { handleApi } = await import("../../worker/index.ts");
const store = await import("../../worker/bots/store.ts");
const { botsEnabled } = await import("../../worker/bots/flags.ts");
const { HUB_BOT_CAPABILITIES, normalizeHubBotCapabilities } = await import("../../worker/lib/hub-bots.ts");

const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
};
await ensureHubFeatureSchema(env);

const now = new Date().toISOString();
db.exec(
  "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES('u1','owner','s','h',?)",
  now,
);
db.exec(
  "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES('u2','mod','s','h',?)",
  now,
);
function makeHub(name) {
  const result = db.exec(
    "INSERT INTO decave_hubs(name,icon,owner_id,created_at,updated_at) VALUES(?,'x','u1',?,?)",
    name,
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}
const hubId = makeHub("Hub A");

const rule = (command) => ({
  v: 1,
  trigger: { type: "command", name: command, options: [] },
  scope: { channels: [], roles: [] },
  cooldown: { perUser: 0, perChannel: 0 },
  then: [{ type: "sendMessage", text: "hi" }],
});

test("builder bot has kind builder and no usable token", async () => {
  const bot = await store.createBuilderBot(db, { hubId, name: "Helper", description: "d", createdBy: "u1" });
  assert.equal(bot.kind, "builder");
  assert.equal(bot.enabled, 1);
  assert.equal(db.scalar("SELECT token_hash FROM decave_hub_bots WHERE id=?", bot.id), `builder:${bot.id}`);
  assert.equal((await store.listBots(db, hubId)).length, 1);
  assert.equal((await store.getBot(db, hubId, bot.id))?.id, bot.id);
  assert.equal(await store.getBot(db, hubId + 99, bot.id), null);
});

test("drafts are invisible until published; publish copies drafts and sets publishedBy", async () => {
  const bot = await store.createBuilderBot(db, { hubId, name: "Pub", description: "", createdBy: "u1" });
  const ruleId = await store.saveRuleDraft(db, bot.id, null, rule("hello"), "u1");
  assert.deepEqual(await store.listPublishedRules(db, hubId), []);
  await store.saveRuleDraft(db, bot.id, ruleId, rule("hello"), "u1");
  await store.publishBot(db, bot.id, "u2");
  const published = await store.listPublishedRules(db, hubId);
  assert.equal(published.length, 1);
  assert.equal(published[0].botId, bot.id);
  assert.equal(published[0].ruleId, ruleId);
  assert.equal(published[0].publishedBy, "u2");
  assert.equal(published[0].rule.trigger.name, "hello");
  assert.equal((await store.getBot(db, hubId, bot.id)).published_by, "u2");
});

test("a second bot cannot take a command name already used in the hub", async () => {
  const other = await store.createBuilderBot(db, { hubId, name: "Other", description: "", createdBy: "u1" });
  await store.saveRuleDraft(db, other.id, null, rule("hello"), "u1");
  await assert.rejects(store.publishBot(db, other.id, "u1"), /BOT_COMMAND_TAKEN/);
  // Another hub may reuse the name.
  const hub2 = makeHub("Hub B");
  const bot2 = await store.createBuilderBot(db, { hubId: hub2, name: "B", description: "", createdBy: "u1" });
  await store.saveRuleDraft(db, bot2.id, null, rule("hello"), "u1");
  await store.publishBot(db, bot2.id, "u1");
});

test("republishing the same bot replaces its own commands", async () => {
  const hub = makeHub("Hub C");
  const bot = await store.createBuilderBot(db, { hubId: hub, name: "C", description: "", createdBy: "u1" });
  const ruleId = await store.saveRuleDraft(db, bot.id, null, rule("ping"), "u1");
  await store.publishBot(db, bot.id, "u1");
  await store.saveRuleDraft(db, bot.id, ruleId, rule("pong"), "u1");
  await store.publishBot(db, bot.id, "u1");
  assert.deepEqual(
    db.sqlite
      .prepare("SELECT name FROM decave_bot_commands WHERE hub_id=?")
      .all(hub)
      .map((row) => row.name),
    ["pong"],
  );
});

test("hub bot limit is 25", async () => {
  const hub = makeHub("Hub Full");
  for (let i = 0; i < 25; i++)
    await store.createBuilderBot(db, { hubId: hub, name: `b${i}`, description: "", createdBy: "u1" });
  await assert.rejects(
    store.createBuilderBot(db, { hubId: hub, name: "b26", description: "", createdBy: "u1" }),
    /BOT_LIMIT/,
  );
});

test("50 failed runs pause the bot; ok resets the streak", async () => {
  const hub = makeHub("Hub Runs");
  const bot = await store.createBuilderBot(db, { hubId: hub, name: "R", description: "", createdBy: "u1" });
  for (let i = 0; i < 49; i++)
    await store.logRun(db, { botId: bot.id, ruleId: null, trigger: "message", status: "error", detail: "x" });
  assert.equal((await store.getBot(db, hub, bot.id)).enabled, 1);
  await store.logRun(db, { botId: bot.id, ruleId: null, trigger: "message", status: "ok", detail: "" });
  assert.equal((await store.getBot(db, hub, bot.id)).failure_streak, 0);
  for (let i = 0; i < 50; i++)
    await store.logRun(db, { botId: bot.id, ruleId: null, trigger: "message", status: "error", detail: "x" });
  assert.equal((await store.getBot(db, hub, bot.id)).enabled, 0);
  const errors = await store.listRuns(db, bot.id, { errorsOnly: true, limit: 10 });
  assert.equal(errors.length, 10);
  assert.ok(errors.every((run) => run.status === "error"));
});

test("timers: same key stored once, taken once", async () => {
  const timer = { key: "t1", hubId, roomId: 7, botId: "b", ruleId: "r", fireAt: 1000, payload: { userId: "u1" } };
  await store.putTimer(db, timer);
  await store.putTimer(db, timer);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_bot_timers WHERE key='t1'"), 1);
  assert.equal(await store.nextTimerAt(db, 7), 1000);
  assert.deepEqual(await store.takeDueTimers(db, 7, 999), []);
  const due = await store.takeDueTimers(db, 7, 1000);
  assert.equal(due.length, 1);
  assert.equal(due[0].key, "t1");
  assert.deepEqual(due[0].payload, { userId: "u1" });
  assert.deepEqual(await store.takeDueTimers(db, 7, 5000), []);
  assert.equal(await store.nextTimerAt(db, 7), null);
});

test("variables are scoped and the name count is available", async () => {
  const hub = makeHub("Hub Vars");
  await store.setVariable(db, hub, "points", "user", "u1", 5);
  await store.setVariable(db, hub, "points", "user", "u2", 7);
  await store.setVariable(db, hub, "motd", "hub", null, "hi");
  assert.equal(await store.getVariable(db, hub, "points", "user", "u1"), 5);
  assert.equal(await store.getVariable(db, hub, "points", "user", "u2"), 7);
  assert.equal(await store.getVariable(db, hub, "motd", "hub", null), "hi");
  assert.equal(await store.getVariable(db, hub, "none", "hub", null), null);
  assert.equal(await store.countVariableNames(db, hub), 2);
});

test("AI usage counts per hub per day", async () => {
  const hub = makeHub("Hub AI");
  assert.equal(await store.incrementAiUsage(db, hub, "2026-10-09"), 1);
  assert.equal(await store.incrementAiUsage(db, hub, "2026-10-09"), 2);
  assert.equal(await store.incrementAiUsage(db, hub, "2026-10-10"), 1);
});

test("deleteBot removes rules, commands, runs and timers of that bot", async () => {
  const hub = makeHub("Hub Del");
  const bot = await store.createBuilderBot(db, { hubId: hub, name: "D", description: "", createdBy: "u1" });
  await store.saveRuleDraft(db, bot.id, null, rule("gone"), "u1");
  await store.publishBot(db, bot.id, "u1");
  await store.logRun(db, { botId: bot.id, ruleId: null, trigger: "x", status: "ok", detail: "" });
  await store.putTimer(db, { key: "d1", hubId: hub, roomId: 1, botId: bot.id, ruleId: "r", fireAt: 1, payload: {} });
  await store.deleteBot(db, hub, bot.id);
  for (const table of ["decave_bot_rules", "decave_bot_commands", "decave_bot_runs", "decave_bot_timers"])
    assert.equal(db.scalar(`SELECT COUNT(*) FROM ${table} WHERE bot_id=?`, bot.id), 0, table);
  assert.equal(await store.getBot(db, hub, bot.id), null);
});

test("manageBots is granted by a custom role holding only manageRooms", async () => {
  const hub = makeHub("Hub Perm");
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,'member',?)", hub, "u2", now);
  db.exec(
    "INSERT INTO decave_custom_roles(id,hub_id,name,permissions_json,created_at) VALUES('role-rooms',?,?,?,?)",
    hub,
    "rooms",
    JSON.stringify(["manageRooms"]),
    now,
  );
  db.exec("INSERT INTO decave_member_roles(hub_id,user_id,role_id) VALUES(?,?,'role-rooms')", hub, "u2");
  assert.equal(await hasPermission(db, hub, "u2", "manageBots"), true);
  assert.equal(await hasPermission(db, hub, "u2", "viewAudit"), false);
});

test("token bots stay kind token and builder bots cannot authenticate via the token API", async () => {
  const hub = makeHub("Hub Tok");
  db.exec(
    "INSERT INTO decave_hub_bots(id,hub_id,name,token_hash,created_by,created_at) VALUES('tok1',?,'T',?,'u1',?)",
    hub,
    tokenHash("a".repeat(64)),
    now,
  );
  const builder = await store.createBuilderBot(db, { hubId: hub, name: "B", description: "", createdBy: "u1" });
  const kinds = Object.fromEntries((await store.listBots(db, hub)).map((bot) => [bot.id, bot.kind]));
  assert.equal(kinds.tok1, "token");
  assert.equal(kinds[builder.id], "builder");
  // No raw token hashes to a builder row.
  assert.equal(
    db.scalar("SELECT COUNT(*) FROM decave_hub_bots WHERE kind='builder' AND token_hash=?", tokenHash("a".repeat(64))),
    0,
  );
  const post = (token) =>
    handleApi(
      new Request("https://decave.test/api/bots/messages", {
        method: "POST",
        headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ roomId: 1, content: "hi" }),
      }),
      env,
    );
  assert.equal((await post("b".repeat(64))).status, 401);
  assert.equal((await post(`builder:${builder.id}`)).status, 401);
});

test("flag and capabilities", () => {
  assert.equal(botsEnabled({}), false);
  assert.equal(botsEnabled({ BOTS_BUILDER_ENABLED: "false" }), false);
  assert.equal(botsEnabled({ BOTS_BUILDER_ENABLED: "true" }), true);
  for (const capability of ["manage_roles", "manage_messages", "webhooks", "send_messages"])
    assert.ok(HUB_BOT_CAPABILITIES.includes(capability));
  assert.deepEqual(normalizeHubBotCapabilities(["webhooks", "bogus", "send_messages"]), ["webhooks", "send_messages"]);
});

test("deleting and reordering a published rule stay drafts until publish; pausing is immediate", async () => {
  const hub = makeHub("Hub drafts");
  const bot = await store.createBuilderBot(db, { hubId: hub, name: "Drafty", description: "", createdBy: "u1" });
  const a = await store.saveRuleDraft(db, bot.id, null, rule("alpha"), "u1");
  const b = await store.saveRuleDraft(db, bot.id, null, rule("beta"), "u1");
  await store.publishBot(db, bot.id, "u1");
  const live = async () => (await store.listPublishedRules(db, hub)).map((r) => r.ruleId);
  const commands = () => db.scalar("SELECT COUNT(*) FROM decave_bot_commands WHERE bot_id=?", bot.id);
  assert.deepEqual(await live(), [a, b]);

  await store.reorderRules(db, bot.id, [b, a]);
  assert.deepEqual(await live(), [a, b], "reorder does not change live order");
  assert.deepEqual(
    (await store.listDraftRules(db, bot.id)).map((r) => r.ruleId),
    [b, a],
  );
  assert.equal(await store.hasPendingStructureChanges(db, bot.id), true);

  assert.equal(await store.deleteRule(db, bot.id, a), true);
  assert.deepEqual(await live(), [a, b], "deleted published rule keeps running until publish");
  assert.equal(commands(), 2);
  assert.deepEqual(
    (await store.listDraftRules(db, bot.id)).map((r) => r.ruleId),
    [b],
  );

  await store.publishBot(db, bot.id, "u1");
  assert.deepEqual(await live(), [b]);
  assert.equal(commands(), 1);
  assert.equal(await store.hasPendingStructureChanges(db, bot.id), false);

  const fresh = await store.saveRuleDraft(db, bot.id, null, rule("gamma"), "u1");
  assert.equal(await store.deleteRule(db, bot.id, fresh), true);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_bot_rules WHERE id=?", fresh), 0);

  assert.equal(await store.setRuleEnabled(db, bot.id, b, false), true);
  assert.deepEqual(await live(), []);
  assert.equal((await store.listDraftRules(db, bot.id))[0].enabled, false);
  await store.setRuleEnabled(db, bot.id, b, true);
  assert.deepEqual(await live(), [b]);
});

test("a malformed stored row is skipped, not fatal for the rest", async () => {
  await store.putTimer(db, { key: "good", hubId, roomId: 9, botId: "b", ruleId: "r", fireAt: 10, payload: { a: 1 } });
  db.exec(
    "INSERT INTO decave_bot_timers(key,hub_id,room_id,bot_id,rule_id,fire_at,payload_json) VALUES('bad',?,9,'b','r',11,'{oops')",
    hubId,
  );
  const due = await store.takeDueTimers(db, 9, 100);
  assert.deepEqual(
    due.map((timer) => timer.key),
    ["good"],
  );
  assert.equal(await store.nextTimerAt(db, 9), null, "the bad row is consumed, not retried forever");

  const hub = makeHub("Hub bad rows");
  const bot = await store.createBuilderBot(db, { hubId: hub, name: "Rows", description: "", createdBy: "u1" });
  const okId = await store.saveRuleDraft(db, bot.id, null, rule("fine"), "u1");
  const badId = await store.saveRuleDraft(db, bot.id, null, rule("broken"), "u1");
  await store.publishBot(db, bot.id, "u1");
  db.exec("UPDATE decave_bot_rules SET draft_json='{', published_json='{' WHERE id=?", badId);
  assert.deepEqual(
    (await store.listPublishedRules(db, hub)).map((entry) => entry.ruleId),
    [okId],
  );
  assert.deepEqual(
    (await store.listDraftRules(db, bot.id)).map((entry) => entry.ruleId),
    [okId],
  );
});
