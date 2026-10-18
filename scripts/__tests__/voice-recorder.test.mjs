import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_NOTE_BARS, VOICE_NOTE_MAX_MS, VOICE_NOTE_MIN_MS } from "../../shared/voice-note.ts";
import { MIME_PREFERENCE, createVoiceRecorderController } from "../../src/features/voice-notes/useVoiceRecorder.ts";

function rig({ gum, asyncStop = false, supported = ["audio/webm;codecs=opus"] } = {}) {
  const pending = [];
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const ownTrack = {
    stopped: 0,
    stop() {
      this.stopped++;
    },
  };
  const callTrack = {
    stopped: 0,
    stop() {
      this.stopped++;
    },
  };
  // The call's mic lives in its own stream on the same fake device; recording must never touch it.
  const callStream = { getTracks: () => [callTrack] };
  const stream = { getTracks: () => [ownTrack] };
  const recorders = [];
  class FakeRecorder {
    constructor(s, opts) {
      this.stream = s;
      this.opts = opts;
      this.state = "inactive";
      this.mimeType = opts.mimeType;
      recorders.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      const fire = () => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(100)], { type: this.mimeType }) });
        this.onstop?.();
      };
      if (asyncStop) pending.push(fire);
      else fire();
    }
    static isTypeSupported(m) {
      return supported.includes(m);
    }
  }
  const closed = [];
  class FakeAudioContext {
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 0,
        getByteTimeDomainData(a) {
          a.fill(192);
        },
      };
    }
    close() {
      closed.push(1);
      return Promise.resolve();
    }
  }
  const deps = {
    getUserMedia: gum ?? (async () => stream),
    MediaRecorder: FakeRecorder,
    AudioContext: FakeAudioContext,
    now: () => now,
    setInterval: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => timers.delete(id),
  };
  const advance = (ms) => {
    for (let i = 0; i < ms / 50; i++) {
      now += 50;
      for (const fn of [...timers.values()]) fn();
    }
  };
  const flush = () => pending.splice(0).forEach((f) => f());
  return {
    c: createVoiceRecorderController(deps),
    advance,
    flush,
    callStream,
    ownTrack,
    callTrack,
    recorders,
    closed,
    timers,
  };
}

test("auto-stops at 120000 ms and enters preview", async () => {
  const r = rig();
  await r.c.start();
  assert.equal(r.c.getSnapshot().state, "recording");
  r.advance(VOICE_NOTE_MAX_MS + 500);
  const s = r.c.getSnapshot();
  assert.equal(s.state, "preview");
  assert.equal(s.result.meta.ms, VOICE_NOTE_MAX_MS);
  assert.equal(r.timers.size, 0);
});

test("stop before the minimum returns to idle with no result", async () => {
  const r = rig();
  await r.c.start();
  r.advance(VOICE_NOTE_MIN_MS - 50);
  r.c.stop();
  const s = r.c.getSnapshot();
  assert.equal(s.state, "idle");
  assert.equal(s.result, null);
  assert.equal(r.ownTrack.stopped, 1);
});

test("permission and device errors surface as state, not throws", async () => {
  for (const [name, code] of [
    ["NotAllowedError", "permission"],
    ["NotFoundError", "no-device"],
  ]) {
    const r = rig({
      gum: async () => {
        throw Object.assign(new Error("x"), { name });
      },
    });
    await r.c.start();
    const s = r.c.getSnapshot();
    assert.equal(s.state, "error");
    assert.equal(s.error, code);
  }
});

test("stops only the tracks of its own stream", async () => {
  const r = rig();
  await r.c.start();
  r.advance(1000);
  r.c.stop();
  assert.equal(r.ownTrack.stopped, 1);
  assert.equal(r.callTrack.stopped, 0);
  assert.equal(r.callStream.getTracks().length, 1);
  assert.equal(r.closed.length, 1);
});

test("result carries 64-bar wave, elapsed ms, mime and bitrate", async () => {
  const r = rig();
  await r.c.start();
  r.advance(2000);
  r.c.stop();
  const s = r.c.getSnapshot();
  assert.equal(s.state, "preview");
  assert.equal(s.result.meta.ms, 2000);
  assert.equal(Buffer.from(s.result.meta.wave, "base64").length, VOICE_NOTE_BARS);
  assert.equal(s.result.meta.bytes, undefined);
  assert.equal(s.result.mime, "audio/webm;codecs=opus");
  assert.equal(r.recorders[0].opts.audioBitsPerSecond, 32000);
  r.c.discard();
  assert.equal(r.c.getSnapshot().state, "idle");
  assert.equal(r.c.getSnapshot().result, null);
});

test("unsupported when no recorder mime or MediaRecorder", async () => {
  const c = createVoiceRecorderController({
    ...{ getUserMedia: async () => ({ getTracks: () => [] }) },
    MediaRecorder: undefined,
    AudioContext: undefined,
    now: () => 0,
    setInterval: () => 1,
    clearInterval() {},
  });
  await c.start();
  assert.equal(c.getSnapshot().error, "unsupported");
});

test("discard while getUserMedia is pending releases the mic when it resolves", async () => {
  let resolveGum;
  const r = rig({ gum: () => new Promise((res) => (resolveGum = res)) });
  const started = r.c.start();
  r.c.discard();
  const track = {
    stopped: 0,
    stop() {
      this.stopped++;
    },
  };
  resolveGum({ getTracks: () => [track] });
  await started;
  assert.equal(track.stopped, 1);
  assert.equal(r.c.getSnapshot().state, "idle");
  assert.equal(r.recorders.length, 0);
  assert.equal(r.timers.size, 0);
});

test("a second stop during the async stop window keeps the full recording", async () => {
  const r = rig({ asyncStop: true });
  await r.c.start();
  r.advance(3000);
  r.c.stop();
  r.advance(100);
  r.c.stop();
  assert.equal(r.c.getSnapshot().state, "recording");
  r.flush();
  const s = r.c.getSnapshot();
  assert.equal(s.state, "preview");
  assert.equal(s.result.meta.ms, 3000);
  assert.equal(s.result.blob.size, 100);
});

test("discard during the async stop window yields idle", async () => {
  const r = rig({ asyncStop: true });
  await r.c.start();
  r.advance(3000);
  r.c.stop();
  r.c.discard();
  r.flush();
  assert.equal(r.c.getSnapshot().state, "idle");
  assert.equal(r.c.getSnapshot().result, null);
  assert.equal(r.ownTrack.stopped, 1);
});

test("mime preference order is AAC mp4, plain mp4, then webm opus", () => {
  assert.deepEqual(MIME_PREFERENCE, ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus"]);
});

test("the first supported preference wins", async () => {
  for (const [supported, want] of [
    [MIME_PREFERENCE, "audio/mp4;codecs=mp4a.40.2"],
    [["audio/mp4", "audio/webm;codecs=opus"], "audio/mp4"],
    [["audio/webm;codecs=opus"], "audio/webm;codecs=opus"],
  ]) {
    const r = rig({ supported });
    await r.c.start();
    r.advance(1000);
    r.c.stop();
    assert.equal(r.c.getSnapshot().result.mime, want);
  }
});
