import test from "node:test";
import assert from "node:assert/strict";
import { screenBitratePerViewer } from "../../src/app/voice.ts";

test("one viewer gets the full preset", () => {
  assert.equal(screenBitratePerViewer(8_000_000, 1), 8_000_000);
  assert.equal(screenBitratePerViewer(28_000_000, 1), 28_000_000);
});

test("more viewers split the uplink budget", () => {
  assert.equal(screenBitratePerViewer(8_000_000, 2), 6_000_000);
  assert.equal(screenBitratePerViewer(8_000_000, 4), 3_000_000);
  assert.equal(screenBitratePerViewer(28_000_000, 2), 14_000_000);
});

test("never drops below the floor and handles zero viewers", () => {
  assert.equal(screenBitratePerViewer(8_000_000, 20), 1_500_000);
  assert.equal(screenBitratePerViewer(8_000_000, 0), 8_000_000);
});
