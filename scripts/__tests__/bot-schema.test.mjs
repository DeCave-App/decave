import assert from "node:assert/strict";
import test from "node:test";
import { validateRule } from "../../shared/bots/schema.ts";

const ctx = () => ({
  channelIds: new Set(["c1", "c2"]),
  voiceRoomIds: new Set(["v1"]),
  roleIds: new Set(["r1"]),
  ruleIds: new Set(["rule1"]),
  builtInCommands: new Set(["giphy"]),
});

const dice = () => ({
  v: 1,
  trigger: { type: "command", name: "roll", options: [{ name: "sides", type: "number", required: false }] },
  scope: { channels: ["*"], roles: [] },
  cooldown: { perUser: 10, perChannel: 0 },
  when: { all: [{ type: "hasRole", roleId: "r1" }] },
  then: [{ type: "sendMessage", channel: "trigger", text: "🎲 {user} rolled {random 1-{args.sides|default:6}}" }],
  else: [],
});

const paths = (r) => (r.ok ? [] : r.errors.map((e) => e.path));
const run = (mutate) => {
  const rule = dice();
  mutate(rule);
  return validateRule(rule, ctx());
};
const msgTrigger = (pattern) => (r) => {
  r.trigger = { type: "message", mode: "regex", pattern, caseSensitive: false };
};

test("accepts the dice rule from the spec", () => {
  const r = validateRule(dice(), ctx());
  assert.equal(r.ok, true);
});

test("rejects unknown action type", () => {
  const r = run((x) => (x.then = [{ type: "explode" }]));
  assert.ok(paths(r).includes("then[0].type"));
});

test("rejects unknown top-level field", () => {
  const r = run((x) => (x.extra = 1));
  assert.ok(paths(r).includes("extra"));
});

test("rejects channel id not in hub", () => {
  const r = run((x) => (x.then = [{ type: "sendMessage", channel: "nope", text: "hi" }]));
  assert.ok(paths(r).includes("then[0].channel"));
});

test("rejects schedule every 4 minutes", () => {
  const r = run((x) => (x.trigger = { type: "schedule", every: 4, timezone: "UTC" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.message.includes("5 minutes")));
});

test("rejects cron that fires more often than every 5 minutes, and bad cron text", () => {
  for (const cron of ["* * * * *", "*/4 * * * *", "0,3 * * * *", "0,58 9 * * *", "nope"]) {
    const r = run((x) => (x.trigger = { type: "schedule", cron, timezone: "UTC" }));
    assert.equal(r.ok, false, cron);
    assert.ok(paths(r).includes("trigger.cron"), cron);
  }
  for (const cron of ["*/15 * * * *", "*/5 * * * *", "0 18 * * 1-5", "0,30 * * * *"]) {
    const r = run((x) => (x.trigger = { type: "schedule", cron, timezone: "UTC" }));
    assert.equal(r.ok, true, cron);
  }
});

test("rejects 21 actions", () => {
  const r = run((x) => (x.then = Array.from({ length: 21 }, () => ({ type: "stop" }))));
  assert.ok(paths(r).includes("then"));
});

test("rejects regex longer than 200 chars", () => {
  const r = run(msgTrigger("a".repeat(201)));
  assert.ok(paths(r).includes("trigger.pattern"));
});

test("rejects nested quantifier (a+)+", () => {
  const r = run(msgTrigger("(a+)+"));
  assert.ok(paths(r).includes("trigger.pattern"));
});

test("rejects command shadowing built-in", () => {
  const r = run((x) => (x.trigger = { type: "command", name: "giphy", options: [] }));
  assert.ok(paths(r).includes("trigger.name"));
});

test("rejects card with buttons and select", () => {
  const card = {
    buttons: [{ customId: "a", label: "A", style: "primary" }],
    select: { customId: "s", options: [{ label: "x", value: "x" }] },
  };
  const r = run((x) => (x.then = [{ type: "reply", text: "hi", card }]));
  assert.ok(paths(r).includes("then[0].card"));
});

test("rejects form with 6 fields", () => {
  const fields = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, label: "L", style: "short", required: false }));
  const r = run((x) => (x.then = [{ type: "openForm", formId: "f", title: "T", fields }]));
  assert.ok(paths(r).includes("then[0].fields"));
});

test("rejects wait over 10080 minutes", () => {
  const r = run((x) => (x.then = [{ type: "wait", minutes: 10081 }]));
  assert.ok(paths(r).includes("then[0].minutes"));
});

const REGEX_BAD = [
  ".{0,2000}.{0,2000}.{0,2000}x",
  "a{0,100}a{0,100}b",
  "a{0,100}a{0,100}a{0,100}a{0,100}b",
  "a+a+b",
  "x.*x.*y",
  ".*.*x",
  "(a?a?)+b",
  "(ab)+",
  "(a|b)*",
  "\\w+\\s+\\w+",
  "(?=x)",
  "(a)\\1",
  "(?<name>a)",
  "(?i)a",
  "((a))",
  "(a+|b)",
  "a|b",
  "a{2,20}",
  "a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?",
  "(",
  "[a-z",
];
const REGEX_GOOD = [
  "^!roll \\d+$",
  "gg+",
  "^hello (world|there)$",
  "\\bdeal\\b.*done",
  "colou?r",
  "^[a-z]{2,5}$",
  "lol+",
  "roll (\\d+)",
  "[(a+)]+",
  "\\(ok\\)",
];

test("regex whitelist: rejects anything outside the safe grammar", () => {
  for (const p of REGEX_BAD) assert.ok(paths(run(msgTrigger(p))).includes("trigger.pattern"), p);
});

test("regex whitelist: accepts simple safe patterns", () => {
  for (const p of REGEX_GOOD) assert.equal(run(msgTrigger(p)).ok, true, p);
});

test("regex whitelist: accepted patterns stay fast on 500-char adversarial input", () => {
  const inputs = ["a", "x", "1", " ", "ab", "a "].map((s) => s.repeat(Math.ceil(500 / s.length)).slice(0, 500));
  for (const p of REGEX_GOOD) {
    for (const flags of ["", "i"]) {
      const re = new RegExp(p, flags);
      for (const input of [...inputs, ...inputs.map((s) => s.slice(0, 499) + "!")]) {
        const start = performance.now();
        re.exec(input);
        const ms = performance.now() - start;
        assert.ok(ms < 50, `${p} took ${ms} ms`);
      }
    }
  }
});

test("voice triggers validate roomId against voice rooms only", () => {
  const voice = (roomId) => (r) => {
    r.trigger = { type: "voiceJoin", roomId };
  };
  assert.equal(run(voice("v1")).ok, true);
  assert.deepEqual(paths(run(voice("c1"))), ["trigger.roomId"]);
  assert.equal(run((r) => (r.trigger = { type: "voiceLeave" })).ok, true);
});
