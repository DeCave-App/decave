// Stream privacy: a screen share from a client that sends no allowStreamPreview
// (the mobile app before 0.1.95) must follow the account setting, not allow previews.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { screenPreviewAllowed } = await import("../../worker/lib/account-preferences.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hub = fs.readFileSync(path.join(root, "worker/HubRoom.ts"), "utf8");

test("an explicit allowStreamPreview wins without reading the account", async () => {
  let reads = 0;
  const stored = async () => {
    reads += 1;
    return true;
  };
  assert.equal(await screenPreviewAllowed(false, stored), false);
  assert.equal(await screenPreviewAllowed(true, stored), true);
  assert.equal(reads, 0);
});

test("a missing allowStreamPreview follows the account's Stream privacy setting", async () => {
  assert.equal(await screenPreviewAllowed(undefined, async () => false), false);
  assert.equal(await screenPreviewAllowed(undefined, async () => true), true);
  assert.equal(await screenPreviewAllowed("no", async () => false), false);
});

test("HubRoom's VOICE_SCREEN_STATE uses the account fallback, not a default of allowed", () => {
  const start = hub.indexOf('if (type === "VOICE_SCREEN_STATE") {');
  const block = hub.slice(start, hub.indexOf('if (type === "VOICE_SOUNDBOARD_PLAY")', start));
  assert.match(block, /screenPreviewAllowed\(data\.allowStreamPreview/);
  assert.doesNotMatch(block, /data\.allowStreamPreview !== false/);
});
