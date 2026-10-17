import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../../mobile/src/lib/bot-builder-model.ts");
const { CATALOGUE } = await import("../../shared/bots/catalogue.ts");
const { validateRule } = await import("../../shared/bots/schema.ts");
const { BUILT_IN_COMMANDS } = await import("../../shared/bots/builtins.ts");

const hub = {
  textRooms: [{ id: "10", name: "general" }],
  voiceRooms: [{ id: "20", name: "Lounge" }],
  roles: [{ id: "r1", name: "Member" }],
};

test("every catalogue type gets a default part of that type", () => {
  for (const kind of ["triggers", "conditions", "actions"]) {
    for (const type of Object.keys(CATALOGUE[kind])) {
      const part = model.defaultPart(kind, type);
      assert.equal(part.type, type);
      for (const field of CATALOGUE[kind][type].fields)
        if (field.required && field.kind !== "schedule") assert.ok(field.key in part, `${kind}.${type}.${field.key}`);
    }
  }
});

test("a new rule with a command name passes the server's validator", () => {
  const rule = model.newRule();
  rule.trigger.name = "hello";
  rule.then[0].text = "Hi {user}";
  const result = validateRule(rule, model.ruleContextFor(hub, []));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(!BUILT_IN_COMMANDS.includes("hello"));
});

test("schedule and condition defaults are valid out of the box", () => {
  const rule = model.newRule("schedule");
  rule.then = [{ type: "sendMessage", channel: "10", text: "Daily reminder" }];
  rule.when = { all: [model.defaultPart("conditions", "weekday"), model.defaultPart("conditions", "chance")] };
  const result = validateRule(rule, model.ruleContextFor(hub, []));
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("template preview matches web's stand-in renderer", () => {
  const vars = [{ name: "user", label: "User", sample: "Sam" }];
  assert.equal(model.previewTemplate("Hi {user|upper}, roll {random 1-6} {nope|default:x}", vars), "Hi SAM, roll 1 x");
  assert.equal(model.previewTemplate("{random:a|b}", vars), "a");
});

test("unpublished changes compare by content, not key order", () => {
  assert.equal(model.sameRule({ v: 1, a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1, v: 1 }), true);
  assert.equal(model.sameRule({ v: 1 }, null), false);
});

test("capabilities the rules need but the bot lacks", () => {
  const rule = model.newRule();
  rule.then = [
    { type: "addRole", roleId: "r1" },
    { type: "reply", text: "ok" },
  ];
  assert.deepEqual(model.missingCapabilities([rule], ["send_messages"]), ["manage_roles"]);
});
