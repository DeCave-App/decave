import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const store = await import("../../worker/bots/store.ts");
const engine = await import("../../worker/bots/engine.ts");
const limits = await import("../../worker/bots/limits.ts");
const { registerAction } = await import("../../worker/bots/actions/registry.ts");
const { matchesTrigger } = await import("../../worker/bots/triggers.ts");
const { evaluateConditions } = await import("../../worker/bots/conditions.ts");

const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  BOTS_BUILDER_ENABLED: "true",
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
};
await ensureHubFeatureSchema(env);

const now = new Date().toISOString();
const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
db.exec(
  "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES('u1','owner','s','h',?)",
  now,
);
db.exec(
  "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES('u2','pal','s','h',?)",
  old,
);
let hubSeq = 0;
function makeHub() {
  const result = db.exec(
    "INSERT INTO decave_hubs(name,icon,owner_id,created_at,updated_at) VALUES(?,'x','u1',?,?)",
    `Hub ${++hubSeq}`,
    now,
    now,
  );
  const hubId = Number(result.lastInsertRowid);
  db.exec(
    "INSERT OR IGNORE INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,'u1','owner',?)",
    hubId,
    now,
  );
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,'u2','member',?)", hubId, now);
  return hubId;
}

const calls = [];
let failNext = null;
registerAction("sendMessage", {
  capability: "send_messages",
  async run(ctx, action) {
    calls.push({ text: action.text, vars: { ...ctx.vars }, dryRun: ctx.dryRun });
    if (failNext) {
      const reason = failNext;
      failNext = null;
      return { ok: false, reason };
    }
    return { ok: true };
  },
});
registerAction("webhook", {
  capability: "webhooks",
  async run() {
    calls.push({ text: "webhook" });
    return { ok: true };
  },
});

const baseRule = (overrides = {}) => ({
  v: 1,
  trigger: { type: "message", mode: "contains", pattern: "gg", caseSensitive: false },
  scope: { channels: [], roles: [] },
  cooldown: { perUser: 0, perChannel: 0 },
  then: [{ type: "sendMessage", channel: "", text: "hi" }],
  ...overrides,
});

async function setup(rules, botPatch) {
  const hubId = makeHub();
  const bot = await store.createBuilderBot(db, { hubId, name: "B", description: "", createdBy: "u1" });
  const ruleIds = [];
  for (const rule of rules) ruleIds.push(await store.saveRuleDraft(db, bot.id, null, rule, "u1"));
  await store.publishBot(db, bot.id, "u1");
  if (botPatch) await store.updateBotSettings(db, hubId, bot.id, botPatch);
  engine.invalidateHubRules(hubId);
  return { hubId, bot, ruleIds };
}

const event = (hubId, overrides = {}) => ({
  hubId,
  roomId: 7,
  kind: "message",
  actorId: "u2",
  actorIsBot: false,
  chainDepth: 0,
  data: { text: "GG all" },
  ...overrides,
});
const runs = (botId) => store.listRuns(db, botId);

let clock = 1_000_000;
beforeEach(() => {
  calls.length = 0;
  failNext = null;
  limits.resetLimitsForTests();
  limits.setLimitsClock(() => clock);
});

test("contains matches case-insensitively and runs", async () => {
  const { hubId, bot } = await setup([baseRule()]);
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 1);
  assert.equal((await runs(bot.id))[0].status, "ok");
});

test("regex capture is available as {match.1}", () => {
  const result = matchesTrigger(
    { type: "message", mode: "regex", pattern: "roll (\\d+)", caseSensitive: false },
    event(1, { data: { text: "please roll 20" } }),
  );
  assert.equal(result.match, true);
  assert.equal(result.vars["match.1"], "20");
});

test("a stored unsafe regex is skipped at match time and logged", async () => {
  const unsafe = { type: "message", mode: "regex", pattern: ".*.*.*.*x", caseSensitive: false };
  const { hubId, bot } = await setup([baseRule({ trigger: unsafe })]);
  await engine.dispatchBotEvent(env, event(hubId, { data: { text: "aaaa x" } }));
  assert.equal(calls.length, 0);
  const [entry] = await runs(bot.id);
  assert.equal(entry.status, "skipped");
  assert.equal(entry.detail, "Pattern not allowed");
});

test("regex triggers only see the first 500 characters", () => {
  const trigger = { type: "message", mode: "regex", pattern: "gg", caseSensitive: false };
  assert.equal(matchesTrigger(trigger, event(1, { data: { text: "a".repeat(498) + "gg" } })).match, true);
  assert.equal(matchesTrigger(trigger, event(1, { data: { text: "a".repeat(499) + "gg" } })).match, false);
});

test("a stored bypass regex is skipped at match time", async () => {
  const unsafe = { type: "message", mode: "regex", pattern: "a+a+b", caseSensitive: false };
  const { hubId, bot } = await setup([baseRule({ trigger: unsafe })]);
  await engine.dispatchBotEvent(env, event(hubId, { data: { text: "aaab" } }));
  assert.equal(calls.length, 0);
  assert.equal((await runs(bot.id))[0].detail, "Pattern not allowed");
});

test("message text is capped before matching", () => {
  const result = matchesTrigger(
    { type: "message", mode: "contains", pattern: "gg", caseSensitive: false },
    event(1, { data: { text: "a".repeat(2500) + "gg" } }),
  );
  assert.equal(result.match, false);
});

test("scope channels excluding the room do not run", async () => {
  const { hubId } = await setup([baseRule({ scope: { channels: ["99"], roles: [] } })]);
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 0);
});

test("hasRole false runs the else branch", async () => {
  const { hubId } = await setup([
    baseRule({
      when: { all: [{ type: "hasRole", roleId: "r-missing" }] },
      then: [{ type: "sendMessage", channel: "", text: "then" }],
      else: [{ type: "sendMessage", channel: "", text: "else" }],
    }),
  ]);
  await engine.dispatchBotEvent(env, event(hubId));
  assert.deepEqual(
    calls.map((c) => c.text),
    ["else"],
  );
});

test("role, account age and channel conditions read real data", async () => {
  limits.setLimitsClock(() => Date.now());
  const hubId = makeHub();
  db.exec("INSERT INTO decave_custom_roles(id,hub_id,name,created_at) VALUES(?,?,'Mod',?)", `r${hubId}`, hubId, now);
  db.exec("INSERT INTO decave_member_roles(hub_id,user_id,role_id) VALUES(?,'u2',?)", hubId, `r${hubId}`);
  const ctx = { env, event: event(hubId), vars: {} };
  assert.equal(await evaluateConditions({ all: [{ type: "hasRole", roleId: `r${hubId}` }] }, ctx), true);
  assert.equal(await evaluateConditions({ all: [{ type: "lacksRole", roleId: `r${hubId}` }] }, ctx), false);
  assert.equal(await evaluateConditions({ all: [{ type: "accountAge", minDays: 3 }] }, ctx), true);
  assert.equal(await evaluateConditions({ all: [{ type: "memberAge", minDays: 3 }] }, ctx), false);
  assert.equal(
    await evaluateConditions(
      {
        any: [
          { type: "channelIs", channelId: "8" },
          { type: "channelIs", channelId: "7" },
        ],
      },
      ctx,
    ),
    true,
  );
});

test("per-user cooldown skips the second run and logs skipped", async () => {
  const { hubId, bot } = await setup([baseRule({ cooldown: { perUser: 10, perChannel: 0 } })]);
  await engine.dispatchBotEvent(env, event(hubId));
  clock += 5_000;
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 1);
  assert.equal((await runs(bot.id))[0].status, "skipped");
  clock += 6_000;
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 2);
});

test("the 121st run in one minute is limited", async () => {
  const { hubId, bot } = await setup([baseRule()]);
  for (let i = 0; i < 121; i++) await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 120);
  assert.equal((await runs(bot.id))[0].status, "limited");
});

test("bot authors are ignored unless allowBotTriggers; depth 3 is limited", async () => {
  const { hubId, bot } = await setup([baseRule()]);
  await engine.dispatchBotEvent(env, event(hubId, { actorIsBot: true, chainDepth: 1 }));
  assert.equal(calls.length, 0);
  assert.equal((await runs(bot.id)).length, 0);
  const allowed = await setup([baseRule({ allowBotTriggers: true })]);
  await engine.dispatchBotEvent(env, event(allowed.hubId, { actorIsBot: true, chainDepth: 1 }));
  assert.equal(calls.length, 1);
  await engine.dispatchBotEvent(env, event(allowed.hubId, { actorIsBot: true, chainDepth: 3 }));
  assert.equal(calls.length, 1);
  assert.equal((await runs(allowed.bot.id))[0].status, "limited");
});

test("a failing action logs error with its reason and stops the rule", async () => {
  const { hubId, bot } = await setup([
    baseRule({
      then: [
        { type: "sendMessage", channel: "", text: "one" },
        { type: "sendMessage", channel: "", text: "two" },
      ],
    }),
  ]);
  failNext = "Room is gone";
  await engine.dispatchBotEvent(env, event(hubId));
  assert.deepEqual(
    calls.map((c) => c.text),
    ["one"],
  );
  const [run] = await runs(bot.id);
  assert.equal(run.status, "error");
  assert.match(run.detail, /Room is gone/);
});

test("a missing capability fails the run", async () => {
  const { hubId, bot } = await setup([baseRule({ then: [{ type: "webhook", url: "https://x.test", method: "GET" }] })]);
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 0);
  assert.match((await runs(bot.id))[0].detail, /Bot isn't allowed to webhooks/);
});

test("dry run passes dryRun, returns steps and writes no run log", async () => {
  const { hubId, bot, ruleIds } = await setup([
    baseRule({ then: [{ type: "sendMessage", channel: "", text: "hello {user}" }] }),
  ]);
  const steps = await engine.dispatchBotEvent(env, event(hubId), { dryRun: true, onlyRuleId: ruleIds[0] });
  assert.equal(calls[0].dryRun, true);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].ruleId, ruleIds[0]);
  assert.equal(steps[0].action, "sendMessage");
  assert.equal(steps[0].ok, true);
  assert.ok(steps[0].description.length > 0);
  assert.equal((await runs(bot.id)).length, 0);
});

test("a disabled bot or the flag off runs nothing", async () => {
  const { hubId } = await setup([baseRule()], { enabled: false });
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 0);
  const on = await setup([baseRule()]);
  await engine.dispatchBotEvent({ ...env, BOTS_BUILDER_ENABLED: "false" }, event(on.hubId));
  assert.equal(calls.length, 0);
});

test("dispatch never throws when a handler throws", async () => {
  registerAction("react", {
    capability: null,
    async run() {
      throw new Error("boom");
    },
  });
  const { hubId, bot } = await setup([baseRule({ then: [{ type: "react", emoji: "x" }] })]);
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal((await runs(bot.id))[0].status, "error");
});

test("command options live under args.* and cannot override reserved vars", async () => {
  const { hubId } = await setup([
    baseRule({ trigger: { type: "command", name: "give", options: [{ name: "user", type: "text", required: true }] } }),
  ]);
  await engine.dispatchBotEvent(
    env,
    event(hubId, { kind: "command", data: { command: "give", args: { user: "u1" } } }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].vars.user, "pal");
  assert.equal(calls[0].vars["args.user"], "u1");
});

test("match.0 is the matched text in its original case", () => {
  const result = matchesTrigger(
    { type: "message", mode: "contains", pattern: "gg", caseSensitive: false },
    event(1, { data: { text: "well GG all" } }),
  );
  assert.equal(result.vars["match.0"], "GG");
});

test("failed conditions without else do not start the cooldown; else does", async () => {
  const when = { all: [{ type: "variable", name: "gate", scope: "hub", op: "=", value: "open" }] };
  const cooldown = { perUser: 10, perChannel: 0 };
  const { hubId } = await setup([baseRule({ when, cooldown })]);
  await engine.dispatchBotEvent(env, event(hubId));
  await store.setVariable(db, hubId, "gate", "hub", null, "open");
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 1);

  const withElse = await setup([
    baseRule({ when, cooldown, else: [{ type: "sendMessage", channel: "", text: "else" }] }),
  ]);
  await engine.dispatchBotEvent(env, event(withElse.hubId));
  await store.setVariable(db, withElse.hubId, "gate", "hub", null, "open");
  await engine.dispatchBotEvent(env, event(withElse.hubId));
  assert.deepEqual(
    calls.slice(1).map((c) => c.text),
    ["else"],
  );
});

test("an error that auto-pauses the bot stops it at once", async () => {
  const { hubId, bot } = await setup([baseRule()]);
  db.exec("UPDATE decave_hub_bots SET failure_streak=49 WHERE id=?", bot.id);
  failNext = "nope";
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal((await store.getBot(db, hubId, bot.id)).enabled, 0);
  await engine.dispatchBotEvent(env, event(hubId));
  assert.equal(calls.length, 1);
});
