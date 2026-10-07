import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HUB_HOME,
  HUB_HOME_LIMITS,
  HUB_HOME_SECTION_IDS,
  hubRulesList,
  moveHubHomeSection,
  normalizeHubHomeConfig,
  normalizeHubHomeSections,
} from "../../shared/hub-home.ts";

test("defaults show every section in the standard order", () => {
  assert.deepEqual(
    DEFAULT_HUB_HOME.sections.map((s) => s.id),
    [...HUB_HOME_SECTION_IDS],
  );
  assert.ok(DEFAULT_HUB_HOME.sections.every((s) => s.visible));
  assert.deepEqual(normalizeHubHomeConfig(undefined), DEFAULT_HUB_HOME);
});

test("saved order and visibility are kept; unknown and duplicate sections are dropped", () => {
  const sections = normalizeHubHomeSections([
    { id: "rules", visible: true },
    { id: "now", visible: false },
    { id: "bogus", visible: true },
    { id: "rules", visible: false },
    "events",
  ]);
  assert.deepEqual(sections.slice(0, 3), [
    { id: "rules", visible: true },
    { id: "now", visible: false },
    { id: "events", visible: true },
  ]);
  // Sections missing from the saved list come back visible, in default order.
  assert.deepEqual(
    sections.slice(3).map((s) => s.id),
    ["welcome", "catchUp", "about", "members"],
  );
  assert.equal(sections.length, HUB_HOME_SECTION_IDS.length);
});

test("garbage input falls back to defaults", () => {
  assert.deepEqual(normalizeHubHomeSections("nope"), DEFAULT_HUB_HOME.sections);
  assert.deepEqual(normalizeHubHomeConfig({ sections: 5, welcome: 7, rules: {} }), DEFAULT_HUB_HOME);
});

test("welcome and rules are trimmed, limited and cleaned", () => {
  const config = normalizeHubHomeConfig({
    welcome: "  Hi\r\nthere\u0007  " + "x".repeat(2000),
    rules: "\n  1. Be decent  \n\n- No spam\n" + Array.from({ length: 30 }, (_, i) => `rule ${i}`).join("\n"),
  });
  assert.ok(config.welcome.length <= HUB_HOME_LIMITS.welcome);
  assert.ok(!config.welcome.includes("\r") && !config.welcome.includes("\u0007"));
  const lines = config.rules.split("\n");
  assert.equal(lines.length, HUB_HOME_LIMITS.ruleLines);
  assert.equal(lines[0], "1. Be decent");
  assert.deepEqual(hubRulesList(config.rules).slice(0, 2), ["Be decent", "No spam"]);
});

test("moving a section swaps it with its neighbour and stops at the ends", () => {
  const start = DEFAULT_HUB_HOME.sections;
  assert.deepEqual(
    moveHubHomeSection(start, "now", -1)
      .map((s) => s.id)
      .slice(0, 2),
    ["now", "welcome"],
  );
  assert.deepEqual(moveHubHomeSection(start, "welcome", -1), start);
  assert.deepEqual(moveHubHomeSection(start, "members", 1), start);
  assert.notEqual(moveHubHomeSection(start, "members", 1), start); // always a new array
});
