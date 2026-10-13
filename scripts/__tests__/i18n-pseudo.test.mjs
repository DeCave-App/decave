import assert from "node:assert/strict";
import { test } from "node:test";

const { pseudoLocalize, pseudoCatalog } = await import("../../shared/i18n/pseudo.ts");

const stripProtected = (value) => value.replace(/\{\{[^}]*\}\}/g, "").replace(/<\/?\d+\s*\/?>/g, "");

test("pseudoLocalize brackets, accents and pads the text", () => {
  const out = pseudoLocalize("Save");
  assert.ok(out.startsWith("["), out);
  assert.ok(out.endsWith("]"), out);
  assert.doesNotMatch(stripProtected(out), /[A-Za-z]/);
  assert.ok(out.length >= "Save".length * 1.35, out);
});

test("pseudoLocalize keeps placeholders and Trans tags verbatim", () => {
  const input = "Hi {{name}}, <1>open</1>";
  const out = pseudoLocalize(input);
  assert.ok(out.includes("{{name}}"), out);
  assert.ok(out.includes("<1>"), out);
  assert.ok(out.includes("</1>"), out);
  assert.doesNotMatch(stripProtected(out), /[A-Za-z]/);
  assert.ok(out.length >= input.length * 1.35, out);
});

test("pseudoLocalize keeps formatted placeholders and nesting", () => {
  const out = pseudoLocalize("{{count, number}} new $t(common.app.name)");
  assert.ok(out.includes("{{count, number}}"), out);
  assert.ok(out.includes("$t(common.app.name)"), out);
});

test("pseudoCatalog maps nested catalogs", () => {
  const out = pseudoCatalog({ app: { name: "DeCave", tagline: "Chat" }, count: 3, list: ["Hi"] });
  assert.equal(typeof out.app.name, "string");
  assert.notEqual(out.app.name, "DeCave");
  assert.ok(out.app.name.startsWith("["));
  assert.ok(out.app.tagline.startsWith("["));
  assert.equal(out.count, 3);
  assert.ok(out.list[0].startsWith("["));
});
