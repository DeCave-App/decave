import assert from "node:assert/strict";
import test from "node:test";
import { renderTemplate } from "../../shared/bots/render.ts";

const zero = () => 0;

test("random range and variables", () => {
  assert.equal(renderTemplate("{user} rolled {random 1-6}", { user: "Ana" }, zero), "Ana rolled 1");
});

test("random choice", () => {
  assert.equal(
    renderTemplate("{random:a|b|c}", {}, () => 0.99),
    "c",
  );
});

test("filters and defaults", () => {
  assert.equal(renderTemplate("{args.sides|default:6}", {}), "6");
  assert.equal(renderTemplate("{user|upper}", { user: "Ana" }), "ANA");
  assert.equal(renderTemplate("{user|lower}", { user: "Ana" }), "ana");
});

test("nested resolves inner first", () => {
  assert.equal(
    renderTemplate("{random 1-{args.sides|default:6}}", {}, () => 0.99),
    "6",
  );
});

test("unknown variable renders empty", () => {
  assert.equal(renderTemplate("a{nope}b", {}), "ab");
});

test("date is an ISO UTC date", () => {
  assert.match(renderTemplate("{date}", {}), /^\d{4}-\d{2}-\d{2}$/);
});

test("broadcast mentions are neutralised", () => {
  const out = renderTemplate("{m}", { m: "@everyone hi @here" });
  assert.ok(out.includes("@​everyone"));
  assert.ok(out.includes("@​here"));
});

test("output is capped", () => {
  assert.ok(renderTemplate("{big}", { big: "x".repeat(10000) }).length <= 2000);
});

test("unbalanced braces are returned literally", () => {
  assert.equal(renderTemplate("{{{", {}), "{{{");
});

test("braces inside values are not re-expanded", () => {
  assert.equal(renderTemplate("{a}", { a: "{user}", user: "Ana" }), "{user}");
});

test("inherited object properties are not variables", () => {
  assert.equal(renderTemplate("{constructor}{toString}{__proto__}", {}), "");
});

test("values cannot forge internal sentinels", () => {
  assert.equal(renderTemplate("{a}", { a: "0" }), "0");
});

test("cap does not split a surrogate pair", () => {
  const out = renderTemplate("{a}", { a: "x".repeat(1999) + "😀" });
  assert.equal(out, "x".repeat(1999));
});
