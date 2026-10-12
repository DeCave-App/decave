import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const store = await import("../../worker/bots/store.ts");
const engine = await import("../../worker/bots/engine.ts");
const limits = await import("../../worker/bots/limits.ts");
const timers = await import("../../worker/bots/timers.ts");

const db = new D1Mock();
const arms = [];
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  BOTS_BUILDER_ENABLED: "true",
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({
      fetch: async (request) => {
        if (new URL(request.url).pathname === "/internal/bot-timers/arm") arms.push(await request.json());
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
  const general = Number(
    db.exec(
      "INSERT INTO decave_rooms(hub_id,name,type,kind,private,created_at,updated_at) VALUES(?,'general','text','chat',0,?,?)",
      hubId,
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
  return { hubId, general, roleId };
}

const EVERY_5 = { type: "schedule", every: 5, timezone: "UTC" };
const ON_GG = { type: "message", mode: "contains", pattern: "gg", caseSensitive: false };

const rule = (trigger, then) => ({
  v: 1,
  trigger,
  scope: { channels: [], roles: [] },
  cooldown: { perUser: 0, perChannel: 0 },
  then,
});

async function setup(trigger, then) {
  const hub = makeHub();
  const bot = await store.createBuilderBot(db, { hubId: hub.hubId, name: "Clock", description: "", createdBy: "u1" });
  const actions = typeof then === "function" ? then(hub) : then;
  const ruleId = await store.saveRuleDraft(db, bot.id, null, rule(trigger, actions), "u1");
  await store.publishBot(db, bot.id, "u1");
  await store.updateBotSettings(db, hub.hubId, bot.id, {
    capabilities: ["send_messages", "manage_roles", "manage_messages"],
  });
  engine.invalidateHubRules(hub.hubId);
  return { ...hub, bot, ruleId, rule: rule(trigger, actions) };
}

const timerRows = (botId) =>
  db
    .prepare("SELECT key,room_id,fire_at,payload_json FROM decave_bot_timers WHERE bot_id=? ORDER BY fire_at")
    .bind(botId)
    .all()
    .then((r) => r.results);
const botMessages = (botId) =>
  db
    .prepare("SELECT * FROM decave_messages WHERE bot_id=? ORDER BY rowid")
    .bind(botId)
    .all()
    .then((r) => r.results);
const message = (hub, text) => ({
  hubId: hub.hubId,
  roomId: hub.general,
  kind: "message",
  actorId: "u2",
  actorIsBot: false,
  chainDepth: 0,
  data: { text },
});

let clock = Date.now();
beforeEach(() => {
  arms.length = 0;
  limits.resetLimitsForTests();
  clock = Date.now();
  limits.setLimitsClock(() => clock);
});

const iso = (d) => d.toISOString();

test("nextFireAt: every N minutes", () => {
  const from = new Date("2026-10-09T10:07:30.000Z");
  assert.equal(iso(timers.nextFireAt(EVERY_5, from)), "2026-10-09T10:12:30.000Z");
});

test("nextFireAt: daily 18:00 Europe/Athens across the 2026-10-25 DST change", () => {
  const t = { type: "schedule", daily: "18:00", timezone: "Europe/Athens" };
  // Summer time (UTC+3): 18:00 local is 15:00Z.
  const first = timers.nextFireAt(t, new Date("2026-10-24T10:00:00.000Z"));
  assert.equal(iso(first), "2026-10-24T15:00:00.000Z");
  // Clocks go back on 25 October: 18:00 local is now 16:00Z.
  const second = timers.nextFireAt(t, first);
  assert.equal(iso(second), "2026-10-25T16:00:00.000Z");
  assert.equal(iso(timers.nextFireAt(t, second)), "2026-10-26T16:00:00.000Z");
});

test("nextFireAt: weekly Monday", () => {
  const t = { type: "schedule", weekly: { day: 1, time: "09:30" }, timezone: "UTC" };
  // 2026-10-07 is a Wednesday.
  assert.equal(iso(timers.nextFireAt(t, new Date("2026-10-07T12:00:00Z"))), "2026-10-12T09:30:00.000Z");
  assert.equal(iso(timers.nextFireAt(t, new Date("2026-10-12T09:30:00Z"))), "2026-10-19T09:30:00.000Z");
});

test("nextFireAt: cron */15 * * * *", () => {
  const t = { type: "schedule", cron: "*/15 * * * *", timezone: "UTC" };
  assert.equal(iso(timers.nextFireAt(t, new Date("2026-10-09T10:07:00Z"))), "2026-10-09T10:15:00.000Z");
  assert.equal(iso(timers.nextFireAt(t, new Date("2026-10-09T10:15:00Z"))), "2026-10-09T10:30:00.000Z");
  assert.equal(iso(timers.nextFireAt(t, new Date("2026-10-09T23:50:00Z"))), "2026-10-10T00:00:00.000Z");
  assert.equal(timers.nextFireAt({ type: "schedule", cron: "nope", timezone: "UTC" }, new Date()), null);
});

test("a schedule fires once even when two alarms race, then re-arms the next occurrence", async () => {
  const hub = await setup(EVERY_5, [{ type: "sendMessage", channel: "trigger", text: "tick" }]);
  await timers.scheduleRuleTimers(env, hub.hubId, hub.bot.id, hub.ruleId, hub.rule);
  const [armed] = await timerRows(hub.bot.id);
  assert.ok(armed.key.startsWith(`sched:${hub.ruleId}:`));
  assert.equal(armed.room_id, hub.general);
  assert.ok(
    arms.some((a) => a.roomId === hub.general),
    "the room's alarm is woken",
  );

  const due = armed.fire_at + 1;
  clock = due;
  await Promise.all([timers.runDueBotTimers(env, hub.general, due), timers.runDueBotTimers(env, hub.general, due)]);
  await timers.runDueBotTimers(env, hub.general, due);
  const sent = await botMessages(hub.bot.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].room_id, hub.general);

  const [next] = await timerRows(hub.bot.id);
  assert.equal(next.fire_at, armed.fire_at + 5 * 60_000);
});

test("a schedule whose rule was unpublished is dropped silently", async () => {
  const hub = await setup(EVERY_5, [{ type: "sendMessage", channel: "trigger", text: "tick" }]);
  await timers.scheduleRuleTimers(env, hub.hubId, hub.bot.id, hub.ruleId, hub.rule);
  const [armed] = await timerRows(hub.bot.id);
  await store.deleteRule(db, hub.bot.id, hub.ruleId);
  await store.publishBot(db, hub.bot.id, "u1");
  engine.invalidateHubRules(hub.hubId);
  clock = armed.fire_at + 1;
  await timers.runDueBotTimers(env, hub.general, armed.fire_at + 1);
  assert.equal((await botMessages(hub.bot.id)).length, 0);
  assert.equal((await timerRows(hub.bot.id)).length, 0);
});

test("a temporary role is removed when its timer fires", async () => {
  const hub = await setup(ON_GG, (h) => [{ type: "addRole", roleId: h.roleId, durationMinutes: 30 }]);
  await engine.dispatchBotEvent(env, message(hub, "gg"));
  const hasRole = () =>
    db
      .prepare("SELECT 1 AS x FROM decave_member_roles WHERE hub_id=? AND user_id='u2' AND role_id=?")
      .bind(hub.hubId, hub.roleId)
      .first();
  assert.ok(await hasRole());
  const [timer] = await timerRows(hub.bot.id);
  assert.ok(timer.key.startsWith(`role:u2:${hub.roleId}:`));
  assert.ok(
    arms.some((a) => a.roomId === hub.general),
    "role timers wake the room's alarm",
  );
  clock = timer.fire_at + 1;
  await timers.runDueBotTimers(env, hub.general, timer.fire_at + 1);
  assert.equal(await hasRole(), null);
  assert.equal((await timerRows(hub.bot.id)).length, 0);
});

test("wait stores the remaining actions and resumes them with the earlier vars", async () => {
  const hub = await setup(ON_GG, [
    { type: "wait", minutes: 10 },
    { type: "sendMessage", channel: "trigger", text: "later {text}" },
  ]);
  await engine.dispatchBotEvent(env, message(hub, "gg folks"));
  assert.equal((await botMessages(hub.bot.id)).length, 0);
  const [timer] = await timerRows(hub.bot.id);
  assert.match(timer.key, /^wait:[0-9a-f-]{36}:0$/);
  assert.equal(timer.fire_at, clock + 10 * 60_000);
  assert.ok(arms.some((a) => a.roomId === hub.general));

  await timers.runDueBotTimers(env, hub.general, timer.fire_at - 1);
  assert.equal((await botMessages(hub.bot.id)).length, 0, "not due yet");
  clock = timer.fire_at;
  await timers.runDueBotTimers(env, hub.general, timer.fire_at);
  const sent = await botMessages(hub.bot.id);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes('"text":"later gg folks"'));
});

test("dry run describes the wait and keeps describing later actions", async () => {
  const hub = await setup(ON_GG, [
    { type: "wait", minutes: 15 },
    { type: "sendMessage", channel: "trigger", text: "later" },
  ]);
  const steps = await engine.dispatchBotEvent(env, message(hub, "gg"), { dryRun: true });
  assert.deepEqual(
    steps.map((s) => [s.action, s.description, s.ok]),
    [
      ["wait", "Would wait 15 minutes", true],
      ["sendMessage", "sendMessage: later", true],
    ],
  );
  assert.equal((await timerRows(hub.bot.id)).length, 0);
});

test("a failing timer is retried once a minute later, then dropped", async () => {
  const hub = await setup(ON_GG, []);
  await store.putTimer(db, {
    key: "role:u2:missing-role:x",
    hubId: hub.hubId,
    roomId: hub.general,
    botId: hub.bot.id,
    ruleId: hub.ruleId,
    fireAt: clock - 1000,
    payload: { kind: "role", op: "remove", userId: "u2", roleId: "missing-role" },
  });
  await timers.runDueBotTimers(env, hub.general, clock);
  const [retry] = await timerRows(hub.bot.id);
  assert.equal(retry.key, "role:u2:missing-role:x:retry");
  assert.equal(retry.fire_at, clock + 60_000);
  clock += 60_000;
  await timers.runDueBotTimers(env, hub.general, clock);
  assert.equal((await timerRows(hub.bot.id)).length, 0);
  const runs = await store.listRuns(db, hub.bot.id);
  assert.ok(runs.some((r) => r.status === "error" && /Timer failed twice/.test(r.detail)));
});

test("timers do nothing while the builder is switched off", async () => {
  const hub = await setup(EVERY_5, [{ type: "sendMessage", channel: "trigger", text: "tick" }]);
  await timers.scheduleRuleTimers(env, hub.hubId, hub.bot.id, hub.ruleId, hub.rule);
  const [armed] = await timerRows(hub.bot.id);
  await timers.runDueBotTimers({ ...env, BOTS_BUILDER_ENABLED: "false" }, hub.general, armed.fire_at + 1);
  assert.equal((await timerRows(hub.bot.id)).length, 1);
});

test("publishing replaces a bot's schedule timers with one per published schedule rule", async () => {
  const hub = await setup(EVERY_5, [{ type: "sendMessage", channel: "trigger", text: "tick" }]);
  await timers.syncBotSchedules(env, hub.hubId, hub.bot.id);
  clock += 60_000;
  await timers.syncBotSchedules(env, hub.hubId, hub.bot.id);
  const rows = await timerRows(hub.bot.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fire_at, clock + 5 * 60_000);
});

test("a schedule whose run throws keeps exactly one chain through its retry", async () => {
  const hub = await setup(EVERY_5, [{ type: "sendMessage", channel: "trigger", text: "tick" }]);
  await timers.scheduleRuleTimers(env, hub.hubId, hub.bot.id, hub.ruleId, hub.rule);
  const [armed] = await timerRows(hub.bot.id);
  let calls = 0;
  timers.setScheduleDispatchForTests(async (...args) => {
    calls += 1;
    if (calls === 1) throw new Error("boom");
    return engine.dispatchBotEvent(...args);
  });
  try {
    clock = armed.fire_at + 1;
    await timers.runDueBotTimers(env, hub.general, clock);
    let rows = await timerRows(hub.bot.id);
    assert.equal(rows.filter((r) => !r.key.endsWith(":retry")).length, 1);
    assert.equal(rows.filter((r) => r.key.endsWith(":retry")).length, 1);
    clock += 60_000;
    await timers.runDueBotTimers(env, hub.general, clock);
    rows = await timerRows(hub.bot.id);
    assert.deepEqual(
      rows.map((r) => r.fire_at),
      [armed.fire_at + 5 * 60_000],
    );
    assert.equal(calls, 2);
    assert.equal((await botMessages(hub.bot.id)).length, 1);
  } finally {
    timers.setScheduleDispatchForTests(null);
  }
});

async function putWait(hub, actions, event = message(hub, "gg")) {
  await store.putTimer(db, {
    key: `wait:${crypto.randomUUID()}:0`,
    hubId: hub.hubId,
    roomId: hub.general,
    botId: hub.bot.id,
    ruleId: hub.ruleId,
    fireAt: clock - 1,
    payload: { kind: "wait", actions, vars: {}, event },
  });
}

test("a wait is retried once when the run budget was spent before any action ran", async () => {
  const hub = await setup(ON_GG, []);
  await putWait(hub, [{ type: "sendMessage", channel: "trigger", text: "later" }]);
  while (limits.takeBudget(hub.hubId, "runs"));
  await timers.runDueBotTimers(env, hub.general, clock);
  const rows = await timerRows(hub.bot.id);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].key.endsWith(":retry"));
  limits.resetLimitsForTests();
  clock += 60_000;
  await timers.runDueBotTimers(env, hub.general, clock);
  assert.equal((await botMessages(hub.bot.id)).length, 1);
  assert.equal((await timerRows(hub.bot.id)).length, 0);
});

test("a wait is not retried after an action ran, nor on a deterministic refusal", async () => {
  const hub = await setup(ON_GG, []);
  await putWait(hub, [
    { type: "sendMessage", channel: "trigger", text: "one" },
    { type: "sendMessage", channel: "999999", text: "two" },
  ]);
  await putWait(hub, [{ type: "sendMessage", channel: "trigger", text: "deep" }], {
    ...message(hub, "gg"),
    chainDepth: 3,
  });
  await timers.runDueBotTimers(env, hub.general, clock);
  assert.equal((await timerRows(hub.bot.id)).length, 0);
  assert.equal((await botMessages(hub.bot.id)).length, 1);
});

test("deleting a rule or publishing without it removes its pending schedule and wait timers", async () => {
  const hub = await setup(EVERY_5, [{ type: "sendMessage", channel: "trigger", text: "tick" }]);
  await timers.syncBotSchedules(env, hub.hubId, hub.bot.id);
  await putWait(hub, [{ type: "sendMessage", channel: "trigger", text: "later" }]);
  await store.putTimer(db, {
    key: "role:u2:r:x",
    hubId: hub.hubId,
    roomId: hub.general,
    botId: hub.bot.id,
    ruleId: hub.ruleId,
    fireAt: clock + 1e6,
    payload: { kind: "role", op: "remove", userId: "u2", roleId: "r" },
  });
  await store.deleteRule(db, hub.bot.id, hub.ruleId);
  await store.publishBot(db, hub.bot.id, "u1");
  await timers.syncBotSchedules(env, hub.hubId, hub.bot.id);
  assert.deepEqual(
    (await timerRows(hub.bot.id)).map((r) => r.key),
    ["role:u2:r:x"],
  );

  const draft = makeHub();
  const bot = await store.createBuilderBot(db, { hubId: draft.hubId, name: "D", description: "", createdBy: "u1" });
  const ruleId = await store.saveRuleDraft(db, bot.id, null, rule(ON_GG, []), "u1");
  await putWait({ ...draft, bot, ruleId }, []);
  await store.deleteRule(db, bot.id, ruleId);
  assert.equal((await timerRows(bot.id)).length, 0);
});
