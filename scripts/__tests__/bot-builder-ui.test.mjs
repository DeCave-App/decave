// Pure helpers behind the bot builder UI: rule sentences, draft dirtiness, defaults, sample events.
import assert from "node:assert/strict";
import { test } from "node:test";

const model = await import("../../src/features/bots/model.ts");
const { TEMPLATES } = await import("../../shared/bots/templates.ts");

const names = {
  channels: { 10: "general", 11: "rules" },
  voice: { 20: "Lounge" },
  roles: { r1: "Member" },
  rules: {},
};

const dice = TEMPLATES.find((t) => t.id === "dice").rules({ firstTextRoomId: "10" })[0];
const welcome = TEMPLATES.find((t) => t.id === "welcome").rules({ firstTextRoomId: "10" })[0];

test("ruleToSentence describes the dice rule", () => {
  assert.equal(
    model.ruleToSentence(dice, names),
    'When someone uses /roll · Do send "🎲 {user} rolled …" in the same channel',
  );
});

test("ruleToSentence names rooms and roles and covers If and Otherwise", () => {
  const rule = {
    ...welcome,
    when: { all: [{ type: "lacksRole", roleId: "r1" }] },
    then: [...welcome.then, { type: "addRole", roleId: "r1" }],
    else: [{ type: "stop" }],
  };
  assert.equal(
    model.ruleToSentence(rule, names),
    'When someone joins the Hub · If they don\'t have @Member · Do send "Welcome …" in #general, then give @Member · Otherwise stop',
  );
});

test("ruleToSentence marks ids that are missing or deleted", () => {
  const rule = {
    ...welcome,
    then: [
      { type: "sendMessage", channel: "99", text: "Hi" },
      { type: "addRole", roleId: "" },
    ],
  };
  assert.equal(
    model.ruleToSentence(rule, names),
    'When someone joins the Hub · Do send "Hi" in #deleted room (pick another), then give (pick a role)',
  );
});

test("isRuleDirty compares draft and published ignoring key order", () => {
  assert.equal(model.isRuleDirty({ draft: dice, published: null }), true);
  assert.equal(model.isRuleDirty({ draft: dice, published: structuredClone(dice) }), false);
  const reordered = Object.fromEntries(Object.entries(dice).reverse());
  assert.equal(model.isRuleDirty({ draft: dice, published: reordered }), false);
  const edited = structuredClone(dice);
  edited.then[0].text = "changed";
  assert.equal(model.isRuleDirty({ draft: edited, published: dice }), true);
});

test("sameRule detects local edits not yet autosaved", () => {
  const local = structuredClone(dice);
  assert.equal(model.sameRule(local, dice), true);
  local.cooldown.perUser = 5;
  assert.equal(model.sameRule(local, dice), false);
});

test("default parts follow the catalogue and pass the shared validator once filled", async () => {
  const { validateRule } = await import("../../shared/bots/schema.ts");
  const ctx = {
    channelIds: new Set(["10"]),
    voiceRoomIds: new Set(["20"]),
    roleIds: new Set(["r1"]),
    ruleIds: new Set(),
    builtInCommands: new Set(["help"]),
  };
  const rule = model.newRule("command");
  rule.trigger.name = "hello";
  rule.then = [{ ...model.defaultAction("sendMessage"), text: "Hi {user}" }];
  assert.equal(validateRule(rule, ctx).ok, true);
  assert.deepEqual(model.defaultAction("wait"), { type: "wait", minutes: 5 });
  assert.equal(model.defaultTrigger("schedule").every, 60);
});

test("sampleEvent fills trigger data for a test run", () => {
  assert.deepEqual(model.sampleEvent(dice.trigger), {
    kind: "command",
    data: { command: "roll", args: { sides: "" } },
  });
  assert.deepEqual(model.sampleEvent({ type: "reactionAdded", emoji: "✅" }), {
    kind: "reactionAdded",
    data: { emoji: "✅" },
  });
});

test("errorsFor picks the errors of one part of the rule", () => {
  const errors = [
    { path: "then[0].text", message: "a" },
    { path: "then[1].roleId", message: "b" },
    { path: "trigger.name", message: "c" },
  ];
  assert.deepEqual(
    model.errorsFor(errors, "then[0]").map((e) => e.message),
    ["a"],
  );
  assert.equal(model.fieldError(errors, "then[1]", "roleId"), "b");
  assert.equal(model.fieldError(errors, "trigger", "name"), "c");
});

test("missingCapabilities lists what the rules need but the bot lacks", () => {
  const rule = {
    ...welcome,
    then: [...welcome.then, { type: "addRole", roleId: "r1" }],
    else: [{ type: "pin", messageRef: "trigger" }],
  };
  assert.deepEqual(model.missingCapabilities([rule], ["send_messages"]), ["manage_roles", "manage_messages"]);
  assert.deepEqual(model.missingCapabilities([dice], ["send_messages"]), []);
});
