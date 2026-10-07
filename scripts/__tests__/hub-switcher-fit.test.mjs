import test from "node:test";
import assert from "node:assert/strict";
import { pillsThatFit } from "../../src/features/hub-sidebar/hubSwitcherFit.ts";

test("all pills fit when there is room", () => {
  assert.deepEqual(pillsThatFit([40, 40, 40], 0, 400, 80), [0, 1, 2]);
});

test("the active hub is always kept, even when it is last", () => {
  const visible = pillsThatFit([40, 40, 40, 40, 40, 120], 5, 260, 84);
  assert.ok(visible.includes(5));
  assert.deepEqual(visible, [0, 5]);
});

test("pills stay in their original order and stop at the first that does not fit", () => {
  assert.deepEqual(pillsThatFit([40, 40, 200, 40], 1, 200, 60), [0, 1]);
});

test("no pills, or a negative budget, still returns the active one", () => {
  assert.deepEqual(pillsThatFit([], 0, 100, 0), []);
  assert.deepEqual(pillsThatFit([40, 40], 1, 10, 80), [1]);
});
