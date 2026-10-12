import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const room = await import("../../worker/screen-sfu-room.ts");
const { canPull, trackNameFor, sfuDisabledResult, sfuCloses, keyRelayPayload, parseSdp, parseRid } = room;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hub = fs.readFileSync(path.join(root, "worker/HubRoom.ts"), "utf8");

const publish = { sessionId: "s-pub", trackName: "screen-b", mid: "0" };
const viewer = { connectionId: "a", voiceChannelId: 7, screenSfu: null };
const sharer = { connectionId: "b", voiceChannelId: 7, screenSfu: publish };

test("canPull only for another member of the same voice room who is publishing", () => {
  assert.equal(canPull(viewer, sharer), true);
  assert.equal(canPull({ ...viewer, voiceChannelId: null }, sharer), false);
  assert.equal(canPull(viewer, { ...sharer, voiceChannelId: 8 }), false);
  assert.equal(canPull(viewer, { ...sharer, screenSfu: null }), false);
  assert.equal(canPull(sharer, sharer), false);
  assert.equal(canPull(viewer, null), false);
  assert.equal(canPull({ ...viewer, voiceChannelId: null }, { ...sharer, voiceChannelId: null }), false);
});

test("trackNameFor and disabled result", () => {
  assert.equal(trackNameFor("abc"), "screen-abc");
  assert.deepEqual(sfuDisabledResult("r1"), {
    type: "RTC_SFU_RESULT",
    requestId: "r1",
    ok: false,
    error: "sfu-disabled",
  });
});

test("sfuCloses lists publish and pull sessions to close", () => {
  assert.deepEqual(sfuCloses({ screenSfu: null, sfuPullSessionId: null, sfuPulls: {} }), []);
  assert.deepEqual(sfuCloses({ screenSfu: publish, sfuPullSessionId: "s-pull", sfuPulls: { b: "3", c: "4" } }), [
    { sessionId: "s-pub", mids: ["0"] },
    { sessionId: "s-pull", mids: ["3", "4"] },
  ]);
});

test("input parsing rejects junk", () => {
  assert.equal(parseSdp({ type: "offer", sdp: 5 }, "offer"), null);
  assert.equal(parseSdp({ type: "answer", sdp: "v=0" }, "offer"), null);
  assert.deepEqual(parseSdp({ type: "offer", sdp: "v=0" }, "offer"), { type: "offer", sdp: "v=0" });
  assert.equal(parseRid("x"), null);
  assert.equal(parseRid("f"), "f");
  assert.equal(keyRelayPayload({ keyIndex: 256, envelope: {} }), null);
  assert.equal(keyRelayPayload({ keyIndex: 1, envelope: "str" }), null);
  assert.equal(keyRelayPayload({ keyIndex: 1, envelope: { x: "a".repeat(17_000) } }), null);
  assert.deepEqual(keyRelayPayload({ keyIndex: 3, envelope: { a: 1 } }), { keyIndex: 3, envelope: { a: 1 } });
});

test("HubRoom accepts the SFU message types", () => {
  for (const type of [
    "RTC_SFU_PUBLISH",
    "RTC_SFU_PULL",
    "RTC_SFU_LAYER",
    "RTC_SFU_RENEGOTIATE",
    "RTC_SFU_STOP",
    "RTC_SCREEN_KEY",
    "RTC_SCREEN_KEY_REQUEST",
    "RTC_SCREEN_MESH_REQUEST",
    "VOICE_SFU_CAPABLE",
  ]) {
    const start = hub.indexOf("REALTIME_MESSAGE_TYPES = new Set([");
    assert.ok(hub.slice(start, hub.indexOf("]);", start)).includes(`"${type}"`), type);
  }
});

test("HubRoom publishes only under the server-chosen track name and gates on the flag", () => {
  assert.match(hub, /const trackName = trackNameFor\(state\.connectionId\);/);
  assert.match(hub, /pushTrack\(sessionId, offer, mid, trackName\)/);
  assert.doesNotMatch(hub, /data\.trackName/);
  assert.match(hub, /screenSfuEnabled\(this\.env\)/);
  assert.match(hub, /sfuDisabledResult\(/);
  assert.match(hub, /canPull\(/);
});

test("voice leave, disconnect and stop release SFU sessions", () => {
  const releases = hub.match(/this\.releaseScreenSfu\(/g) ?? [];
  assert.ok(
    releases.length >= 4,
    `expected releaseScreenSfu in leaveVoice, leaveVoiceQuiet, close, stop; got ${releases.length}`,
  );
  for (const fn of ["private async leaveVoiceQuiet", "private async leaveVoice(", "async webSocketClose"]) {
    const start = hub.indexOf(fn);
    assert.ok(start >= 0, fn);
    assert.match(hub.slice(start, start + 1500), /this\.releaseScreenSfu\(/, fn);
  }
  assert.match(hub, /closeTracks\(/);
});

test("pruneViewerPull drops a stopped sharer's pull and names the mid to close", () => {
  const v = { connectionId: "a", sfuPullSessionId: "s-pull", sfuPulls: { b: "3", c: "4" } };
  const r = room.pruneViewerPull(v, "b");
  assert.deepEqual(r.viewer.sfuPulls, { c: "4" });
  assert.equal(r.viewer.connectionId, "a");
  assert.deepEqual(r.close, { sessionId: "s-pull", mids: ["3"] });
  const none = room.pruneViewerPull(v, "z");
  assert.equal(none.close, null);
  assert.equal(none.viewer, v);
});

test("releasing a publish prunes viewers; relays use the public user id", () => {
  const start = hub.indexOf("private releaseScreenSfu");
  assert.match(hub.slice(start, start + 2500), /pruneViewerPull\(/);
  const relay = hub.indexOf('type === "RTC_SCREEN_KEY" || type === "RTC_SCREEN_KEY_REQUEST"');
  const block = hub.slice(relay, relay + 1500);
  assert.match(block, /state\.publicUserId/);
  assert.match(block, /fromUserId = publicIdOf\(sender\)/);
  assert.doesNotMatch(block, /fromUserId: state\.userId/);
});

test("a scoped RTC_SFU_STOP only releases the publish it names", () => {
  const current = { sessionId: "s-new" };
  assert.equal(room.stopReleasesPublish(current, "s-old"), false, "stale stop keeps the newer publish");
  assert.equal(room.stopReleasesPublish(current, "s-new"), true);
  assert.equal(room.stopReleasesPublish(current, undefined), true, "unscoped stop (older clients) still releases");
  assert.equal(room.stopReleasesPublish(current, ""), true);
  assert.equal(room.stopReleasesPublish(null, "s-new"), false);
  const start = hub.indexOf('type === "RTC_SFU_STOP"');
  assert.match(hub.slice(start, start + 600), /stopReleasesPublish\(state\.screenSfu, data\.sessionId\)/);
});

test("screen sharing off releases the SFU publish (lost RTC_SFU_STOP)", () => {
  const start = hub.indexOf('if (type === "VOICE_SCREEN_STATE") {');
  const block = hub.slice(start, start + 1800);
  assert.match(block, /!sharing && state\.screenSfu \? this\.releaseScreenSfu\(state, true\)/);
  assert.match(block, /broadcastVoiceState\(\)/);
});

test("kill switch: VOICE_JOINED says whether SFU is offered; capability ignored while off", () => {
  assert.match(hub, /type: "VOICE_JOINED",[\s\S]{0,120}screenSfu: screenSfuEnabled\(this\.env\)/);
  const start = hub.indexOf('type === "VOICE_SFU_CAPABLE"');
  assert.match(hub.slice(start, start + 400), /data\.capable === true && screenSfuEnabled\(this\.env\)/);
});

test("public user id is cached on voice join for key relays", () => {
  const start = hub.indexOf('if (type === "VOICE_JOIN") {');
  assert.match(hub.slice(start, start + 2500), /publicUserId: participant\.userId/);
});
