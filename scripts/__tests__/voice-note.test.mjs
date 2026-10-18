import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  VOICE_NOTE_BARS,
  VOICE_NOTE_MAX_BYTES,
  VOICE_NOTE_MAX_MS,
  VOICE_NOTE_PAD_STEP,
  decodeWave,
  encodeWave,
  formatVoiceDuration,
  padVoiceNote,
  parseVoiceNoteMeta,
  unpadVoiceNote,
  voiceNoteFileName,
} from "../../shared/voice-note.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wave64 = Buffer.alloc(64, 7).toString("base64");

test("constants", () => {
  assert.equal(VOICE_NOTE_MAX_MS, 120_000);
  assert.equal(VOICE_NOTE_MAX_BYTES, 3 * 1024 * 1024);
  assert.equal(VOICE_NOTE_PAD_STEP, 131072);
  assert.equal(VOICE_NOTE_BARS, 64);
});

test("pad rounds up to 128 KB steps", () => {
  assert.equal(padVoiceNote(new Uint8Array(1)).length, 131072);
  assert.equal(padVoiceNote(new Uint8Array(131072)).length, 131072);
  assert.equal(padVoiceNote(new Uint8Array(131073)).length, 262144);
});

test("unpad restores the original", () => {
  const x = new Uint8Array(300_000);
  for (let i = 0; i < x.length; i++) x[i] = (i * 31 + 7) & 255;
  assert.deepEqual(unpadVoiceNote(padVoiceNote(x), x.length), x);
});

test("unpad rejects a length beyond the data", () => {
  assert.throws(() => unpadVoiceNote(new Uint8Array(10), 11));
});

test("wave round-trips to 64 bars", () => {
  const out = decodeWave(encodeWave(Array(200).fill(0.5)));
  assert.equal(out.length, 64);
  for (const v of out) assert.ok(Math.abs(v - 0.5) <= 1 / 255);
});

test("wave handles short and empty input and clamps", () => {
  assert.equal(decodeWave(encodeWave([])).length, 64);
  assert.equal(decodeWave(encodeWave([1, 2, -3])).length, 64);
  assert.ok(decodeWave(encodeWave([5])).every((v) => v === 1));
});

test("meta validation", () => {
  assert.deepEqual(parseVoiceNoteMeta({ ms: 42000, wave: wave64, extra: 1 }), { ms: 42000, wave: wave64 });
  assert.deepEqual(parseVoiceNoteMeta({ ms: 1, wave: wave64, bytes: 500 }), { ms: 1, wave: wave64, bytes: 500 });
  for (const ms of [0, 120_001, NaN, "5", undefined]) assert.equal(parseVoiceNoteMeta({ ms, wave: wave64 }), null);
  assert.equal(parseVoiceNoteMeta({ ms: 5, wave: Buffer.alloc(63).toString("base64") }), null);
  assert.equal(parseVoiceNoteMeta({ ms: 5, wave: "!!!" }), null);
  for (const bytes of [0, -1, VOICE_NOTE_MAX_BYTES + 1, 1.5]) {
    assert.equal(parseVoiceNoteMeta({ ms: 5, wave: wave64, bytes }), null);
  }
  assert.equal(parseVoiceNoteMeta(null), null);
  assert.equal(parseVoiceNoteMeta("x"), null);
});

test("durations", () => {
  assert.equal(formatVoiceDuration(42_000), "0:42");
  assert.equal(formatVoiceDuration(120_000), "2:00");
  assert.equal(formatVoiceDuration(400), "0:01");
});

test("file names", () => {
  assert.equal(voiceNoteFileName("audio/webm;codecs=opus"), "Voice message.webm");
  assert.equal(voiceNoteFileName("audio/mp4"), "Voice message.mp4");
  assert.equal(voiceNoteFileName("audio/mp4;codecs=mp4a.40.2"), "Voice message.m4a");
  for (const m of ["audio/m4a", "audio/x-m4a", "audio/aac"]) assert.equal(voiceNoteFileName(m), "Voice message.m4a");
});

test("the mobile app carries an identical copy of voice-note.ts", () => {
  const shared = fs.readFileSync(path.join(root, "shared/voice-note.ts"), "utf8");
  const mobile = fs.readFileSync(path.join(root, "mobile/src/lib/voice-note.ts"), "utf8");
  assert.equal(mobile, shared, "run node scripts/dev/sync-dm-e2ee.mjs");
});
