import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import { readAppSource } from "./app-source.mjs";

const app = readAppSource();
const volumeSource = app.slice(app.indexOf("  const getVoiceUserVolume"), app.indexOf("  const moderateVoiceUser"));
const volumeCode = ts.transpileModule(`${volumeSource}\nglobalThis.changeVoiceUserVolume = changeVoiceUserVolume;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = app.slice(
  app.indexOf("  const enqueuePeerSignaling ="),
  app.indexOf("  const ensureVoicePeersFromState ="),
);
const code = ts.transpileModule(
  source + "\nglobalThis.ensure = ensurePeer; globalThis.enqueue = enqueuePeerSignaling;",
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
class Stream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(t) {
    this.tracks.push(t);
  }
  removeTrack(t) {
    this.tracks = this.tracks.filter((item) => item !== t);
  }
}
class Audio {
  set volume(value) {
    if (value < 0 || value > 1) throw new RangeError("volume");
    this.level = value;
  }
  get volume() {
    return this.level;
  }
  play() {
    return Promise.resolve();
  }
}
class Context {
  state = "suspended";
  createMediaStreamSource() {
    return {
      connect(node) {
        return node;
      },
      disconnect() {},
    };
  }
  createGain() {
    return {
      gain: { value: 1 },
      connect(node) {
        return node;
      },
    };
  }
  createMediaStreamDestination() {
    return { stream: new Stream([{ id: "boosted", kind: "audio" }]) };
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
function setup(volume = 100, flags = {}) {
  const ref = (current) => ({ current });
  const participant = { connectionId: "b", userId: "user", channelId: 1, ...flags };
  const env = {
    console,
    MediaStream: Stream,
    Audio,
    AudioContext: Context,
    RTCPeerConnection: class {
      constructor(configuration) {
        this.configuration = configuration;
      }
      connectionState = "connected";
      iceConnectionState = "connected";
      signalingState = "stable";
    },
    peerSessionsRef: ref(new Map()),
    iceServersRef: ref([
      { urls: "turn:turn.example.test:3478", username: "session-user", credential: "session-credential" },
    ]),
    hasUsableRelayIceServers: (value) =>
      Array.isArray(value) &&
      value.some(
        (server) =>
          typeof server.username === "string" &&
          !!server.username &&
          typeof server.credential === "string" &&
          !!server.credential &&
          (Array.isArray(server.urls) ? server.urls : [server.urls]).some(
            (url) => typeof url === "string" && /^turns?:/i.test(url),
          ),
      ),
    selfConnectionIdRef: ref("a"),
    voiceParticipantsRef: ref([participant]),
    currentUser: { id: "self" },
    remoteGainContextsRef: ref(new Map()),
    remoteAudioElementsRef: ref(new Map()),
    screenAudioMutedRef: ref({}),
    isDeafenedRef: ref(false),
    isServerDeafenedRef: ref(false),
    locallyMutedUsersRef: ref(new Set()),
    audioSettingsRef: ref({ outputDeviceId: "headset" }),
    protectedVoiceSessionRef: ref(null),
    voiceChannelRef: ref(1),
    getVoiceUserVolume: () => volume,
    addLocalTracksToPeer() {},
    refreshMicrophoneSenderParameters() {},
    setAudioSink(audio, sink) {
      audio.sink = sink;
    },
    setRemoteScreens(update) {
      env.screens = update(env.screens ?? {});
    },
    setRemoteCameras(update) {
      env.cameras = update(env.cameras ?? {});
    },
  };
  vm.createContext(env);
  vm.runInContext(code, env);
  const session = env.ensure(participant);
  return {
    env,
    session,
    participant,
    setVolume(value) {
      volume = value;
    },
  };
}
function track(session, stream, kind = "audio") {
  const incoming = stream.getTracks().find((t) => t.kind === kind);
  session.pc.ontrack({ track: incoming, streams: [stream] });
}
const mic = () => ({ id: "mic", kind: "audio", readyState: "live" });

test("saved 150% volume attaches playback without throwing and uses the selected sink", () => {
  const { env, session } = setup(150);
  assert.equal(session.pc.configuration.iceTransportPolicy, "relay");
  assert.equal(env.iceServersRef.current[0].username, "session-user");
  assert.doesNotThrow(() => track(session, new Stream([mic()])));
  const audio = env.remoteAudioElementsRef.current.get("b");
  const boost = env.remoteGainContextsRef.current.get("b");
  assert.equal(audio.sink, "headset");
  assert.equal(audio.srcObject, boost.destination.stream);
  assert.equal(audio.volume, 1);
  assert.equal(boost.gain.gain.value, 1.5);
  assert.equal(boost.context.state, "running");
  env.locallyMutedUsersRef.current.add("user");
  session.resumeAudio();
  assert.equal(audio.muted, true);
  env.isDeafenedRef.current = true;
  session.resumeAudio();
  env.isDeafenedRef.current = false;
  session.resumeAudio();
  assert.equal(audio.muted, true, "undeafen must preserve local mute");
});

test("changing one participant volume only updates that participant playback", () => {
  const ref = (current) => ({ current });
  const first = new Audio();
  const second = new Audio();
  const resumed = [];
  const env = {
    console,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    voiceUserVolumesRef: ref({ first: 100, second: 100 }),
    extraSettingsRef: ref({ outputVolume: 100 }),
    setVoiceUserVolumes() {},
    peerSessionsRef: ref(
      new Map([
        [
          "first-connection",
          {
            resumeAudio() {
              resumed.push("first");
            },
          },
        ],
        [
          "second-connection",
          {
            resumeAudio() {
              resumed.push("second");
            },
          },
        ],
      ]),
    ),
    remoteAudioElementsRef: ref(
      new Map([
        ["first-connection", first],
        ["second-connection", second],
      ]),
    ),
    remoteGainContextsRef: ref(new Map()),
    screenAudioMutedRef: ref({}),
    isDeafenedRef: ref(false),
    isServerDeafenedRef: ref(false),
    locallyMutedUsersRef: ref(new Set()),
  };
  vm.createContext(env);
  vm.runInContext(volumeCode, env);
  env.changeVoiceUserVolume({ connectionId: "first-connection", userId: "first" }, 80);
  assert.equal(first.volume, 0.8);
  assert.equal(second.volume, undefined);
  assert.deepEqual(resumed, []);
});

test("Settings output volume scales each participant's own volume", () => {
  const ref = (current) => ({ current });
  const first = new Audio();
  const env = {
    console,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    voiceUserVolumesRef: ref({ first: 100 }),
    extraSettingsRef: ref({ outputVolume: 50 }),
    setVoiceUserVolumes() {},
    peerSessionsRef: ref(new Map([["first-connection", { resumeAudio() {} }]])),
    remoteAudioElementsRef: ref(new Map([["first-connection", first]])),
    remoteGainContextsRef: ref(new Map()),
    screenAudioMutedRef: ref({}),
    isDeafenedRef: ref(false),
    isServerDeafenedRef: ref(false),
    locallyMutedUsersRef: ref(new Set()),
  };
  vm.createContext(env);
  vm.runInContext(volumeCode, env);
  env.changeVoiceUserVolume({ connectionId: "first-connection", userId: "first" }, 80);
  assert.equal(first.volume, 0.4);
  assert.equal(env.voiceUserVolumesRef.current.first, 80, "the stored per-person volume is not scaled");
});

test("boost can be enabled during a call and volume is not applied twice", () => {
  const { env, session, setVolume } = setup();
  track(session, new Stream([mic()]));
  setVolume(180);
  session.resumeAudio();
  const audio = env.remoteAudioElementsRef.current.get("b");
  assert.equal(env.remoteGainContextsRef.current.get("b").gain.gain.value, 1.8);
  setVolume(50);
  session.resumeAudio();
  assert.equal(audio.volume, 1);
  assert.equal(env.remoteGainContextsRef.current.get("b").gain.gain.value, 0.5);
});

test("denied amplifier resume retains audible direct playback", async () => {
  const { env, session } = setup(180);
  env.AudioContext = class extends Context {
    resume() {
      return Promise.reject(new Error("autoplay denied"));
    }
  };
  track(session, new Stream([mic()]));
  await new Promise((resolve) => setImmediate(resolve));
  const audio = env.remoteAudioElementsRef.current.get("b");
  assert.equal(audio.srcObject, session.remoteAudioStream);
  assert.equal(audio.volume, 1);
});

test("pending amplifier resume switches only after running and preserves mute", async () => {
  const { env, session } = setup(180);
  let resume;
  env.AudioContext = class extends Context {
    resume() {
      return new Promise((resolve) => {
        resume = () => {
          this.state = "running";
          resolve();
        };
      });
    }
  };
  track(session, new Stream([mic()]));
  const audio = env.remoteAudioElementsRef.current.get("b");
  assert.equal(audio.srcObject, session.remoteAudioStream);
  env.isDeafenedRef.current = true;
  resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audio.srcObject, env.remoteGainContextsRef.current.get("b").destination.stream);
  assert.equal(audio.muted, true);
});

test("closed amplifier is replaced and removing the last voice track disconnects its source", () => {
  const { env, session } = setup(150);
  track(session, new Stream([mic()]));
  const old = env.remoteGainContextsRef.current.get("b");
  old.context.state = "closed";
  session.resumeAudio();
  assert.notEqual(env.remoteGainContextsRef.current.get("b"), old);
  session.remoteAudioStream.removeTrack(session.remoteAudioStream.getAudioTracks()[0]);
  session.resumeAudio();
  assert.equal(env.remoteGainContextsRef.current.size, 0);
  assert.equal(env.remoteAudioElementsRef.current.get("b").srcObject, session.remoteAudioStream);
});

test("a combined camera/microphone stream remains audible", () => {
  const { env, session } = setup(100, { cameraSharing: true });
  const stream = new Stream([mic(), { id: "camera", kind: "video" }]);
  track(session, stream);
  track(session, stream, "video");
  assert.equal(session.remoteAudioStream.getAudioTracks().length, 1);
  assert.ok(env.remoteAudioElementsRef.current.get("b"));
  assert.equal(env.screens, undefined);
});

test("screen system audio stays separate from the microphone", () => {
  const { env, session } = setup(100, { screenSharing: true });
  track(session, new Stream([mic()]));
  const screen = new Stream([
    { id: "system", kind: "audio" },
    { id: "display", kind: "video" },
  ]);
  track(session, screen);
  assert.equal(session.remoteAudioStream.getAudioTracks()[0].id, "mic");
  assert.equal(env.screens.b.stream, screen);
});

test("a queued negotiation is ignored when its peer was replaced", async () => {
  const { env, session } = setup();
  let called = false;
  const pending = env.enqueue(session, async () => {
    called = true;
  });
  env.peerSessionsRef.current.delete("b");
  await pending;
  assert.equal(called, false);
});

test("a negotiationneeded callback queued before a remote offer does not send an extra answer", async () => {
  const { session } = setup();
  session.pc.signalingState = "have-remote-offer";
  let called = false;
  session.pc.setLocalDescription = async () => {
    called = true;
  };
  session.pc.onnegotiationneeded();
  await session.signalingQueue;
  assert.equal(called, false);
});

test("a failed noise processor starts a replacement without changing the saved mode", async () => {
  const start = app.indexOf("  requestAiNoiseFallbackRef.current = (reason) => {");
  const end = app.indexOf("\n  const rebuildMicrophoneIfActive", start);
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const calls = [];
  const env = {
    console,
    requestAiNoiseFallbackRef: { current: null },
    aiNoiseFallbackBusyRef: { current: false },
    audioSettingsRef: { current: { noiseSuppression: "ai", inputDeviceId: "mic" } },
    clearVoiceNodeRef: { current: null },
    microphoneBuildSerialRef: { current: 4 },
    bypassAiNoiseProcessorNow() {
      calls.push("hold-processed");
    },
    async buildMicrophonePipeline(settings, browser) {
      calls.push({ settings, browser });
      await pending;
    },
    setAudioSettingsNotice() {},
    setAudioSettingsError() {},
  };
  vm.createContext(env);
  vm.runInContext(
    ts.transpileModule(app.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    env,
  );
  env.requestAiNoiseFallbackRef.current("deadline missed");
  env.requestAiNoiseFallbackRef.current("duplicate error");
  assert.equal(calls.length, 2, "duplicate errors must share the in-flight recovery");
  assert.equal(calls[0], "hold-processed");
  assert.equal(calls[1].settings.noiseSuppression, "strong");
  assert.equal(calls[1].settings.inputDeviceId, "mic");
  assert.equal(calls[1].browser, false);
  assert.equal(env.audioSettingsRef.current.noiseSuppression, "ai");
  complete();
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.aiNoiseFallbackBusyRef.current, false);
  env.clearVoiceNodeRef.current = {};
  env.requestAiNoiseFallbackRef.current("standard failed");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.at(-1).browser, true);
});

test("late display video rebinds boosted playback to the remaining microphone", () => {
  const { env, session } = setup(150, { screenSharing: true });
  const display = new Stream([{ id: "system", kind: "audio", readyState: "live" }]);
  track(session, display);
  track(session, new Stream([mic()]));
  display.addTrack({ id: "display", kind: "video" });
  track(session, display, "video");
  assert.equal(env.remoteGainContextsRef.current.get("b").trackId, "mic");
  assert.equal(session.remoteAudioStream.getAudioTracks().length, 1);
});
