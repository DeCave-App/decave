import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyMeshAudio } from "../../src/voice/screen-sfu/screen-audio.ts";

const base = { streamId: "mic", hasVideo: false, screenSharing: true, cameraSharing: false, screenStreamId: "disp" };

test("audio-only stream whose id matches the advertised display stream is screen audio", () => {
  assert.equal(classifyMeshAudio({ ...base, streamId: "disp" }), "screen");
  assert.equal(classifyMeshAudio({ ...base, streamId: "disp", hasVideo: true }), "screen");
});

test("mic stream, even if it arrives after the display audio under a new id, is voice", () => {
  assert.equal(classifyMeshAudio({ ...base, streamId: "mic" }), "voice");
  assert.equal(classifyMeshAudio({ ...base, streamId: "mic-replaced-later" }), "voice");
  assert.equal(classifyMeshAudio({ ...base, streamId: "disp", screenSharing: false }), "voice", "not sharing");
});

test("no screenStreamId (older sharer): legacy rule, audio with video is screen, audio-only is voice", () => {
  const legacy = { ...base, screenStreamId: null };
  assert.equal(classifyMeshAudio({ ...legacy, streamId: "disp", hasVideo: true }), "screen");
  assert.equal(classifyMeshAudio({ ...legacy, streamId: "disp" }), "voice");
  assert.equal(classifyMeshAudio({ ...legacy, streamId: "cam", hasVideo: true, cameraSharing: true }), "voice");
});

test("HubRoom stores, broadcasts and clears screenStreamId", () => {
  const src = fs.readFileSync(new URL("../../worker/HubRoom.ts", import.meta.url), "utf8");
  const start = src.indexOf('if (type === "VOICE_SCREEN_STATE")');
  const handler = src.slice(start, start + 1500);
  assert.match(handler, /screenStreamId/);
  assert.match(handler, /\.length <= 128/);
  assert.match(src, /screenStreamId: s\.screenSharing \? \(s\.screenStreamId \?\? null\) : null/);
  const clears = src.match(/screenSharing: false,\s*\n\s*screenStreamId: null/g) ?? [];
  assert.ok(clears.length >= 4, `cleared on stop/leave paths (${clears.length})`);
});
