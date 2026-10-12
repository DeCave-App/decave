import test from "node:test";
import assert from "node:assert/strict";
import { createSfuSignaller } from "../../src/voice/screen-sfu/sfu-session.ts";

function setup() {
  const sent = [];
  const s = createSfuSignaller((p) => { sent.push(p); return true; });
  return { sent, s };
}

test("reply is matched by requestId and resolves with data", async () => {
  const { sent, s } = setup();
  const p = s.request("RTC_SFU_PUBLISH", { mid: "0" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "RTC_SFU_PUBLISH");
  assert.equal(sent[0].mid, "0");
  assert.equal(typeof sent[0].requestId, "string");
  assert.equal(s.handleResult({ type: "RTC_SFU_RESULT", requestId: sent[0].requestId, ok: true, sessionId: "s1" }), true);
  const r = await p;
  assert.equal(r.sessionId, "s1");
});

test("out-of-order replies resolve the right requests", async () => {
  const { sent, s } = setup();
  const a = s.request("RTC_SFU_PULL", { rid: "f" });
  const b = s.request("RTC_SFU_PULL", { rid: "p" });
  s.handleResult({ type: "RTC_SFU_RESULT", requestId: sent[1].requestId, ok: true, mid: "b" });
  s.handleResult({ type: "RTC_SFU_RESULT", requestId: sent[0].requestId, ok: true, mid: "a" });
  assert.equal((await a).mid, "a");
  assert.equal((await b).mid, "b");
});

test("timeout rejects", async () => {
  const { s } = setup();
  await assert.rejects(s.request("RTC_SFU_STOP", {}, 20), /timeout/);
});

test("ok:false rejects with the error code", async () => {
  const { sent, s } = setup();
  const p = s.request("RTC_SFU_LAYER", {});
  s.handleResult({ type: "RTC_SFU_RESULT", requestId: sent[0].requestId, ok: false, error: "forbidden" });
  await assert.rejects(p, (e) => e.message === "forbidden" && e.code === "forbidden");
});

test("unrelated frames return false", () => {
  const { s } = setup();
  assert.equal(s.handleResult({ type: "CHAT_MESSAGE" }), false);
  assert.equal(s.handleResult(null), false);
  assert.equal(s.handleResult("x"), false);
  assert.equal(s.handleResult({ type: "RTC_SFU_RESULT", requestId: "unknown", ok: true }), false);
});

test("send failure rejects immediately", async () => {
  const s = createSfuSignaller(() => false);
  await assert.rejects(s.request("RTC_SFU_STOP", {}), /not-connected/);
});

test("local SDP keeps only relay candidates", async () => {
  const { stripNonRelayCandidates } = await import("../../src/voice/screen-sfu/sfu-session.ts");
  const sdp = ["v=0", "a=candidate:1 1 udp 1 10.0.0.1 5000 typ host", "a=candidate:2 1 udp 1 1.2.3.4 3478 typ relay raddr 0.0.0.0 rport 0", "a=mid:0", ""].join("\r\n");
  const out = stripNonRelayCandidates(sdp);
  assert.doesNotMatch(out, /typ host/);
  assert.match(out, /typ relay/);
  assert.match(out, /a=mid:0/);
});

test("rejectAll fails pending requests with the code", async () => {
  const { s } = setup();
  const a = s.request("RTC_SFU_PULL", {});
  const b = s.request("RTC_SFU_STOP", {});
  s.rejectAll("socket-closed");
  await assert.rejects(a, (e) => e.code === "socket-closed");
  await assert.rejects(b, (e) => e.code === "socket-closed");
});

test("viewer attaches the decrypt transform before the answer is sent", async () => {
  const log = [];
  const receiver = { track: { kind: "video" }, getParameters: () => ({ codecs: [{ mimeType: "video/VP8" }] }) };
  Object.defineProperty(receiver, "transform", {
    set(v) { if (v) log.push("transform"); },
    get() { return null; },
  });
  const saved = { pc: globalThis.RTCPeerConnection, w: globalThis.Worker, st: globalThis.RTCRtpScriptTransform, ms: globalThis.MediaStream };
  globalThis.RTCPeerConnection = class {
    constructor(cfg) { assert.equal(cfg.iceTransportPolicy, "relay"); this.localDescription = null; }
    async setRemoteDescription() { log.push("setRemote"); }
    getTransceivers() { return [{ mid: "3", receiver }]; }
    async createAnswer() { log.push("createAnswer"); return { type: "answer", sdp: "v=0" }; }
    async setLocalDescription(d) { log.push("setLocal"); this.localDescription = d; }
    close() {}
  };
  globalThis.Worker = class { postMessage(m) { if (m.type === "key") log.push("key"); } addEventListener() {} terminate() {} };
  globalThis.RTCRtpScriptTransform = class {};
  globalThis.MediaStream = class { constructor(t) { this.tracks = t; } };
  try {
    const { createSfuViewer } = await import("../../src/voice/screen-sfu/sfu-session.ts");
    const signaller = {
      async request(type) {
        log.push(type);
        return type === "RTC_SFU_PULL" ? { offer: { type: "offer", sdp: "v=0" }, mid: "3" } : {};
      },
      handleResult: () => false,
      rejectAll() {},
    };
    const viewer = createSfuViewer({ signaller, iceServers: [{ urls: "turn:t.example:3478", username: "u", credential: "c" }] });
    viewer.setKey("sharer", 1, new Uint8Array(16));
    await viewer.pull("sharer", "f");
    const at = (x) => log.indexOf(x);
    assert.ok(at("transform") > at("setRemote"), log.join(","));
    assert.ok(at("transform") < at("createAnswer"), log.join(","));
    assert.ok(at("key") < at("RTC_SFU_RENEGOTIATE"), log.join(","));
    assert.ok(at("setLocal") < at("RTC_SFU_RENEGOTIATE"), log.join(","));
    viewer.close();
  } finally {
    globalThis.RTCPeerConnection = saved.pc; globalThis.Worker = saved.w;
    globalThis.RTCRtpScriptTransform = saved.st; globalThis.MediaStream = saved.ms;
  }
});

function withFakeRtc(pcClass, fn) {
  const saved = { pc: globalThis.RTCPeerConnection, w: globalThis.Worker, st: globalThis.RTCRtpScriptTransform, ms: globalThis.MediaStream };
  globalThis.RTCPeerConnection = pcClass;
  globalThis.Worker = class { postMessage() {} addEventListener() {} terminate() {} };
  globalThis.RTCRtpScriptTransform = class {};
  globalThis.MediaStream = class { constructor(t) { this.tracks = t; } };
  return fn().finally(() => {
    globalThis.RTCPeerConnection = saved.pc; globalThis.Worker = saved.w;
    globalThis.RTCRtpScriptTransform = saved.st; globalThis.MediaStream = saved.ms;
  });
}
const relayIce = [{ urls: "turn:t.example:3478", username: "u", credential: "c" }];

test("publisher stop is scoped to its own publish session", () =>
  withFakeRtc(
    class {
      constructor() { this.localDescription = null; }
      addTransceiver() {
        return { mid: "0", sender: { getParameters: () => ({ codecs: [{ mimeType: "video/VP8" }], encodings: [] }) } };
      }
      async createOffer() { return { type: "offer", sdp: "v=0" }; }
      async setLocalDescription(d) { this.localDescription = d; }
      async setRemoteDescription() {}
      close() {}
    },
    async () => {
      const { publishScreen } = await import("../../src/voice/screen-sfu/sfu-session.ts");
      const requests = [];
      const signaller = {
        async request(type, body) {
          requests.push({ type, body });
          return type === "RTC_SFU_PUBLISH" ? { sessionId: "s-1", answer: { type: "answer", sdp: "v=0" } } : {};
        },
        handleResult: () => false,
        rejectAll() {},
      };
      const pub = await publishScreen({ kind: "video" }, { signaller, iceServers: relayIce, codec: "vp8", fullEncoding: {} });
      await pub.stop();
      assert.deepEqual(requests.at(-1), { type: "RTC_SFU_STOP", body: { sessionId: "s-1" } });
    },
  ));

test("a pull whose mid has no transceiver leaves no stale mid behind", () => {
  const receiver = { track: { kind: "video" }, getParameters: () => ({ codecs: [{ mimeType: "video/VP8" }] }) };
  return withFakeRtc(
    class {
      constructor() { this.localDescription = null; }
      async setRemoteDescription() {}
      getTransceivers() { return [{ mid: "3", receiver }]; }
      async createAnswer() { return { type: "answer", sdp: "v=0" }; }
      async setLocalDescription(d) { this.localDescription = d; }
      close() {}
    },
    async () => {
      const { createSfuViewer } = await import("../../src/voice/screen-sfu/sfu-session.ts");
      let mid = "3";
      const requests = [];
      const signaller = {
        async request(type) {
          requests.push(type);
          return type === "RTC_SFU_PULL" ? { offer: { type: "offer", sdp: "v=0" }, mid } : {};
        },
        handleResult: () => false,
        rejectAll() {},
      };
      const viewer = createSfuViewer({ signaller, iceServers: relayIce });
      await viewer.pull("sharer", "p");
      mid = "9";
      await assert.rejects(viewer.pull("sharer", "p"), (e) => e.code === "no-track");
      await assert.rejects(viewer.setLayer("sharer", "f"), (e) => e.code === "not-pulled");
      assert.equal(requests.includes("RTC_SFU_LAYER"), false);
      viewer.close();
    },
  );
});
