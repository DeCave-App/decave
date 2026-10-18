import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";

const { createPlaybackQueue, createPlayedTracker, nextSpeed, SILENT_CLIP } =
  await import("../../src/features/voice-notes/playback.ts");
const { isLocallyPlayed, markLocallyPlayed } = await import("../../src/features/voice-notes/played-state.ts");
const { loadVoiceNoteBlob, createVoiceSource, voiceMimeFromName } =
  await import("../../src/features/voice-notes/load-voice-audio.ts");

function fakeAudio({ reject = false } = {}) {
  const listeners = {};
  return {
    src: "",
    currentTime: 0,
    playbackRate: 1,
    paused: true,
    reject,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    emit(type) {
      listeners[type]?.();
    },
    async play() {
      if (this.reject) throw new Error("NotAllowedError");
      this.paused = false;
      this.emit("play");
    },
    pause() {
      this.paused = true;
      this.emit("pause");
    },
  };
}

function handlers(log, tag) {
  return {
    onTime: () => {},
    onPlaying: () => log.push(`${tag}:playing`),
    onPaused: () => log.push(`${tag}:paused`),
    onEnded: () => log.push(`${tag}:ended`),
    onError: () => log.push(`${tag}:error`),
  };
}

test("starting B pauses A on the one shared element", async () => {
  const el = fakeAudio();
  let created = 0;
  const q = createPlaybackQueue(() => (created++, el));
  const log = [];
  await q.play("a", "blob:a", 0, 1, handlers(log, "a"));
  await q.play("b", "blob:b", 2, 1.5, handlers(log, "b"));
  assert.equal(created, 1);
  assert.equal(el.src, "blob:b");
  assert.equal(el.currentTime, 2);
  assert.equal(el.playbackRate, 1.5);
  assert.ok(log.includes("a:paused"));
  assert.equal(q.current(), "b");
});

test("on A ended, plays the next unplayed id; null stops", async () => {
  const q = createPlaybackQueue(() => fakeAudio());
  const started = [];
  q.subscribe("b", () => started.push("b"));
  await q.play("a", "blob:a", 0, 1, handlers([], "a"));
  q.onEnded("a", () => "b");
  assert.deepEqual(started, ["b"]);
  await q.play("a", "blob:a", 0, 1, handlers([], "a"));
  q.onEnded("a", () => null);
  assert.deepEqual(started, ["b"]);
  assert.equal(q.current(), null);
});

test("a rejected play() resets the queue and notifies the bubble", async () => {
  const el = fakeAudio({ reject: true });
  const q = createPlaybackQueue(() => el);
  const log = [];
  const ok = await q.play("a", "blob:a", 0, 1, handlers(log, "a"));
  assert.equal(ok, false);
  assert.equal(q.current(), null);
  assert.deepEqual(log, ["a:error"]);
  el.reject = false;
  assert.equal(await q.play("a", "blob:a", 0, 1, handlers(log, "a")), true);
});

test("prime unlocks the shared element synchronously with a silent clip, once", () => {
  const calls = [];
  const el = fakeAudio();
  el.play = function () {
    calls.push(["play", this.src]);
    return Promise.reject(Object.assign(new Error("interrupted"), { name: "AbortError" }));
  };
  el.pause = () => calls.push(["pause"]);
  let created = 0;
  const q = createPlaybackQueue(() => (created++, el));
  q.prime();
  // Both happened before any await: still inside the tap.
  assert.deepEqual(calls, [["play", SILENT_CLIP], ["pause"]]);
  q.prime();
  assert.equal(calls.length, 2, "only once");
  assert.equal(created, 1);
});

test("an AbortError from play() (quick pause) is not reported as an error", async () => {
  const el = fakeAudio();
  el.play = async () => {
    throw Object.assign(new Error("The play() request was interrupted by a call to pause()."), { name: "AbortError" });
  };
  const q = createPlaybackQueue(() => el);
  const log = [];
  assert.equal(await q.play("a", "blob:a", 0, 1, handlers(log, "a")), false);
  assert.deepEqual(log, []);
});

test("the bubble primes playback before its first await", () => {
  const src = fs.readFileSync("src/features/voice-notes/VoiceNoteBubble.tsx", "utf8");
  assert.match(src, /const start = useCallback\(async \(\) => \{\s*voicePlayback\.prime\(\);/);
  assert.match(src, /const toggle = \(\) => \{\s*if \(!playing\) voicePlayback\.prime\(\);/);
});

test("release stops only the playing bubble", async () => {
  const el = fakeAudio();
  const q = createPlaybackQueue(() => el);
  await q.play("a", "blob:a", 0, 1, handlers([], "a"));
  q.release("b");
  assert.equal(el.paused, false);
  q.release("a");
  assert.equal(el.paused, true);
  assert.equal(q.current(), null);
});

test("played fires once after listening past 50%; seeking past 50% does not count", () => {
  let n = 0;
  const t = createPlayedTracker(() => n++);
  t.update(0, 10);
  t.update(90, 100 * 0 + 100); // a jump, not listening
  assert.equal(n, 0);
  const t3 = createPlayedTracker(() => n++);
  for (let s = 0; s <= 6; s += 1) t3.update(s, 10);
  assert.equal(n, 1);
  t3.update(7, 10);
  t3.end();
  assert.equal(n, 1);
  let m = 0;
  const t2 = createPlayedTracker(() => m++);
  t2.end();
  t2.end();
  assert.equal(m, 1);
});

test("mime is derived from the attachment name", () => {
  assert.equal(voiceMimeFromName("Voice message.webm"), "audio/webm");
  assert.equal(voiceMimeFromName("Voice message.m4a"), "audio/mp4");
  assert.equal(voiceMimeFromName("a.MP4"), "audio/mp4");
  assert.equal(voiceMimeFromName("a.ogg"), "audio/ogg");
  assert.equal(voiceMimeFromName(undefined), "");
});

test("disposing while loading revokes and never yields a playable url", async () => {
  const revoked = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const src = createVoiceSource({
    load: async () => (await gate, new Blob(["x"])),
    createUrl: () => "blob:1",
    revokeUrl: (u) => revoked.push(u),
  });
  const p = src.ensure();
  src.dispose();
  release();
  assert.equal(await p, null);
  assert.deepEqual(revoked, []);
  assert.equal(await src.ensure(), null);
  const live = createVoiceSource({
    load: async () => new Blob(["x"]),
    createUrl: () => "blob:2",
    revokeUrl: (u) => revoked.push(u),
  });
  assert.equal(await live.ensure(), "blob:2");
  live.dispose();
  assert.deepEqual(revoked, ["blob:2"]);
});

test("speed cycles 1 -> 1.5 -> 2 -> 1", () => {
  assert.equal(nextSpeed(1), 1.5);
  assert.equal(nextSpeed(1.5), 2);
  assert.equal(nextSpeed(2), 1);
});

test("played-state caps at 2000 newest and survives throwing localStorage", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  for (let i = 0; i < 2100; i++) markLocallyPlayed("acc", `m${i}`);
  assert.equal(isLocallyPlayed("acc", "m2099"), true);
  assert.equal(isLocallyPlayed("acc", "m0"), false);
  assert.equal(isLocallyPlayed("other", "m2099"), false);
  assert.equal(JSON.parse(store.get("decave.voiceNote.played.acc")).length, 2000);
  globalThis.localStorage = {
    getItem() {
      throw new Error("no");
    },
    setItem() {
      throw new Error("no");
    },
  };
  assert.equal(isLocallyPlayed("acc", "m2099"), false);
  assert.doesNotThrow(() => markLocallyPlayed("acc", "x"));
  delete globalThis.localStorage;
  assert.equal(isLocallyPlayed("acc", "x"), false);
});

test("encrypted note: blob has meta.bytes size; plain note untouched", async () => {
  const padded = new Uint8Array(131072).fill(7);
  const fetchImpl = async () => new Response(padded);
  const blob = await loadVoiceNoteBlob({
    url: "https://x/a",
    meta: { ms: 1000, wave: "", bytes: 5000 },
    decrypt: (b) => b,
    mime: "audio/webm",
    fetchImpl,
  });
  assert.equal(blob.size, 5000);
  const plain = await loadVoiceNoteBlob({
    url: "https://x/a",
    meta: { ms: 1000, wave: "" },
    decrypt: null,
    mime: "audio/webm",
    fetchImpl,
  });
  assert.equal(plain.size, 131072);
  await assert.rejects(
    loadVoiceNoteBlob({
      url: "u",
      meta: { ms: 1, wave: "" },
      decrypt: null,
      mime: "",
      fetchImpl: async () => new Response("", { status: 404 }),
    }),
  );
});
