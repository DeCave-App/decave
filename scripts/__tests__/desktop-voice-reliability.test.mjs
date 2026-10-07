import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_VOICE_PRE_JOIN_DEADLINE_MS,
  DESKTOP_VOICE_JOIN_TIMEOUT_MS,
  createAbortError,
  isAbortError,
  isCurrentChannelLoad,
  resolveDeletedChannel,
} from "../../src/voice/desktop-voice-reliability.ts";
import { readAppSource } from "./app-source.mjs";
import { handleHubEvent } from "../../src/realtime/events/hubs.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appSource = readAppSource();
const directCallSource = fs.readFileSync(path.join(root, "src/components/DirectCallOverlay.tsx"), "utf8");
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;

function ref(current) {
  return { current };
}

class FakeTrack {
  constructor(id, kind = "audio") {
    this.id = id;
    this.kind = kind;
    this.readyState = "live";
    this.enabled = true;
    this.stopped = false;
  }

  getSettings() {
    return { channelCount: 1, sampleRate: 48_000 };
  }

  stop() {
    this.stopped = true;
    this.readyState = "ended";
  }
}

class FakeStream {
  constructor(tracks = []) {
    this.tracks = [...tracks];
  }

  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

class FakeNode {
  connect(node) {
    return node;
  }
  disconnect() {}
}

class FakeGainNode extends FakeNode {
  constructor() {
    super();
    this.gain = { value: 1 };
  }
}

class FakeAnalyserNode extends FakeNode {
  constructor() {
    super();
    this.fftSize = 1024;
    this.smoothingTimeConstant = 0.25;
  }
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 48_000;
    this.state = "running";
  }

  createMediaStreamSource() {
    return new FakeNode();
  }
}

const buildStart = appSource.indexOf("  const buildMicrophonePipeline = async (");
const buildEnd = appSource.indexOf("\n  const acquireDirectCallMicrophone", buildStart);
const buildCode = transpile(
  `${appSource.slice(buildStart, buildEnd)}\nglobalThis.buildMicrophonePipeline = buildMicrophonePipeline;`,
);

function createBuildHarness(captures, overrides = {}) {
  const state = {
    errors: [],
    notices: [],
    states: [],
    labels: [],
    modes: [],
    disposed: 0,
  };
  const env = {
    console,
    MediaStream: FakeStream,
    AudioContext: FakeAudioContext,
    GainNode: FakeGainNode,
    AnalyserNode: FakeAnalyserNode,
    performance,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          const next = captures.shift();
          if (!next) throw new Error("unexpected capture");
          return next.promise;
        },
      },
    },
    audioSettingsRef: ref({
      inputDeviceId: "mic",
      outputDeviceId: "",
      inputVolume: 100,
      sensitivityMode: "auto",
      sensitivityDb: -42,
      noiseSuppression: "off",
      echoCancellation: true,
      autoGainControl: true,
      pushToTalk: false,
    }),
    microphoneBuildSerialRef: ref(0),
    localMicStreamRef: ref(null),
    rawMicStreamRef: ref(null),
    micTrackIdRef: ref(""),
    voiceChannelRef: ref(null),
    voiceActivationModuleLoadedRef: ref(false),
    rnnoiseBinaryRef: ref(null),
    directMicrophoneListenersRef: ref(new Set()),
    requestMicrophoneRecoveryRef: ref(() => {}),
    requestAiNoiseFallbackRef: ref(() => {}),
    audioContextRef: ref(new FakeAudioContext()),
    rnnoiseNodeRef: ref(null),
    clearVoiceNodeRef: ref(null),
    clearVoiceAiRuntimeRef: ref(null),
    clearVoiceAiNodeRef: ref(null),
    micSourceNodeRef: ref(null),
    micHighpassNodeRef: ref(null),
    inputGainNodeRef: ref(null),
    micAnalyserNodeRef: ref(null),
    micProcessedAnalyserNodeRef: ref(null),
    micProcessedTailNodeRef: ref(null),
    voiceActivationNodeRef: ref(null),
    micDestinationNodeRef: ref(null),
    micProcessingKeepAliveNodeRef: ref(null),
    clearVoiceModuleLoadedRef: ref(false),
    aiNoiseBypassedRef: ref(false),
    aiNoiseProcessorReadyRef: ref(false),
    aiNoiseSilentSinceRef: ref(null),
    micVoiceActivationAudibleRef: ref(true),
    voiceActivationMetricsRef: ref(null),
    voiceActivationMetricsUiAtRef: ref(0),
    isCurrentGeneration: (generation, currentGeneration) => generation === currentGeneration,
    createAbortError,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    hasDesktopActivityBridge: () => false,
    microphoneShouldBeEnabled: () => true,
    ensureAudioContext: async () => env.audioContextRef.current,
    createClearVoiceAiRuntime: async () => {
      throw new Error("not used");
    },
    loadRnnoise: async () => new ArrayBuffer(0),
    replaceMicrophoneTrackForPeers: async () => true,
    disposeCurrentMicrophoneGraph: () => {
      state.disposed += 1;
    },
    resetVoiceProcessingState: () => {},
    startMeterLoop: () => {},
    refreshAudioDevices: async () => {},
    setAudioSettingsError: (value) => state.errors.push(value),
    setAudioSettingsNotice: (value) => state.notices.push(value),
    setActiveNoiseSuppressionMode: (value) => state.modes.push(value),
    setMicrophoneCaptureState: (value) => state.states.push(value),
    setMicrophoneCaptureLabel: (value) => state.labels.push(value),
  };
  Object.assign(env, overrides);
  vmCreateContext(env, buildCode);
  return { env, state };
}

function vmCreateContext(env, code) {
  // Kept in one helper so the test harnesses below all execute App closures in
  // the same way, without importing React or mounting the full application.
  vm.createContext(env);
  vm.runInContext(code, env);
}

test("a slower message response cannot win after a newer channel load", async () => {
  let generation = 0;
  let activeChannel = 11;
  const applied = [];

  const load = async (channelId, delay) => {
    const requestGeneration = ++generation;
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (isCurrentChannelLoad(channelId, activeChannel, requestGeneration, generation)) {
      applied.push(channelId);
    }
  };

  const slow = load(11, 35);
  activeChannel = 22;
  const fast = load(22, 5);
  await Promise.all([slow, fast]);
  assert.deepEqual(applied, [22]);
});

test("deleted channels resolve to the server fallback and never reselect the deleted room", () => {
  const servers = [
    {
      id: 3,
      channels: [
        { id: 7, type: "voice" },
        { id: 9, type: "text" },
      ],
    },
    {
      id: 4,
      channels: [
        { id: 12, type: "text" },
        { id: 13, type: "voice" },
      ],
    },
  ];
  assert.equal(resolveDeletedChannel(servers, 3, 7, 9)?.channel.id, 9);
  assert.equal(resolveDeletedChannel(servers, 3, 7, 7)?.channel.id, 9);
  assert.equal(resolveDeletedChannel(servers, 4, 12, 999)?.channel.id, 13);
  assert.equal(resolveDeletedChannel(servers, 8, 7, 999), null);
});

test("voice join cancellation has an explicit bounded pre-join deadline", () => {
  assert.equal(DESKTOP_VOICE_PRE_JOIN_DEADLINE_MS, 60_000);
  assert.equal(DESKTOP_VOICE_JOIN_TIMEOUT_MS, 20_000);
  assert.ok(DESKTOP_VOICE_PRE_JOIN_DEADLINE_MS > DESKTOP_VOICE_JOIN_TIMEOUT_MS);
  assert.match(appSource, /const armVoiceJoinPreJoinDeadline = \(\) =>/);
  assert.match(
    appSource,
    /const cancellable = <T,?>\(promise: Promise<T>\) => Promise\.race\(\[promise, joinDeadline, abortPromise\]\)/,
  );
  assert.match(appSource, /armVoiceJoinPreJoinDeadline\(\);/);
  assert.match(appSource, /Voice join timed out before the connection was ready/);
  assert.equal(isAbortError(createAbortError("cancelled")), true);
  assert.equal(isAbortError(new Error("ordinary failure")), false);
});

test("voice reconnect reuses the shared guarded join path", async () => {
  const reconnectStart = appSource.indexOf("  const rejoinVoiceAfterRealtimeReconnect = async (");
  const reconnectEnd = appSource.indexOf("\n  return {", reconnectStart);
  const code = transpile(
    `${appSource.slice(reconnectStart, reconnectEnd)}\nglobalThis.rejoinVoiceAfterRealtimeReconnect = rejoinVoiceAfterRealtimeReconnect;`,
  );
  const socket = { readyState: 1 };
  const joins = [];
  const statuses = [];
  const errors = [];
  const env = {
    console,
    WebSocket: { OPEN: 1 },
    socketRef: ref(socket),
    setVoiceError: (value) => errors.push(value),
    setVoiceStatus: (value) => statuses.push(value),
    joinVoiceChannel: async (channelId) => joins.push(channelId),
  };
  vm.createContext(env);
  vm.runInContext(code, env);

  await env.rejoinVoiceAfterRealtimeReconnect(42, socket);
  assert.deepEqual(joins, [42]);
  assert.deepEqual(statuses, ["Connecting..."]);
  assert.deepEqual(errors, [""]);
});

test("the actual microphone pipeline rejects a superseded capture and stops its late track", async () => {
  let resolveCapture;
  const lateCapture = new Promise((resolve) => {
    resolveCapture = resolve;
  });
  const captures = [{ promise: lateCapture }];
  const { env } = createBuildHarness(captures);
  const firstBuild = env.buildMicrophonePipeline();

  // A second build supersedes the first before the first getUserMedia call
  // resolves. This exercises App's serial guard rather than a reimplemented
  // Promise.race.
  const secondTrack = new FakeTrack("new-mic");
  let resolveSecondCapture;
  const secondCapture = new Promise((resolve) => {
    resolveSecondCapture = resolve;
  });
  captures.push({ promise: secondCapture });
  const secondBuild = env.buildMicrophonePipeline();
  resolveSecondCapture(new FakeStream([secondTrack]));
  await secondBuild;

  const lateTrack = new FakeTrack("late-mic");
  resolveCapture(new FakeStream([lateTrack]));
  await assert.rejects(firstBuild, (error) => isAbortError(error));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateTrack.stopped, true, "a superseded late capture must be stopped");
  assert.equal(env.localMicStreamRef.current.getAudioTracks()[0].id, "new-mic");
});

test("a microphone graph constructor failure releases the candidate capture", async () => {
  const rawTrack = new FakeTrack("raw");
  const captures = [{ promise: Promise.resolve(new FakeStream([rawTrack])) }];
  class FailingGainNode {
    constructor() {
      throw new Error("gain constructor failed");
    }
  }
  const { env } = createBuildHarness(captures, { GainNode: FailingGainNode });
  await assert.rejects(env.buildMicrophonePipeline(), /gain constructor failed/);
  assert.equal(rawTrack.stopped, true, "graph setup failure must stop the raw capture");
  assert.equal(env.localMicStreamRef.current, null, "failed candidate must not replace the active stream");
});

test("a direct-call listener rejection rolls back the sender and disposes the candidate", async () => {
  const oldTrack = new FakeTrack("old");
  const previous = new FakeStream([oldTrack]);
  const nextTrack = new FakeTrack("next");
  const replacementCalls = [];
  const captures = [{ promise: Promise.resolve(new FakeStream([nextTrack])) }];
  const { env } = createBuildHarness(captures);
  env.localMicStreamRef.current = previous;
  env.micTrackIdRef.current = oldTrack.id;
  env.voiceChannelRef.current = 42;
  env.replaceMicrophoneTrackForPeers = async (...args) => {
    replacementCalls.push(args);
    return true;
  };
  env.directMicrophoneListenersRef.current.add(() => Promise.reject(new Error("direct binding rejected")));

  await assert.rejects(env.buildMicrophonePipeline(), /direct-call microphone binding rejected/);
  assert.equal(replacementCalls.length, 2, "the failed listener must trigger a sender rollback");
  assert.equal(replacementCalls[1][0], "next");
  assert.equal(replacementCalls[1][1], oldTrack);
  assert.equal(nextTrack.stopped, true, "the rejected candidate must be disposed");
  assert.equal(env.localMicStreamRef.current, previous, "the existing stream must remain current");
});

test("the actual peer microphone replacement rolls back every committed sender on cancellation", async () => {
  const replaceStart = appSource.indexOf("  const replaceMicrophoneTrackForPeers = async (");
  const replaceEnd = appSource.indexOf("\n  const bypassAiNoiseProcessorNow", replaceStart);
  const code = transpile(
    `${appSource.slice(replaceStart, replaceEnd)}\nglobalThis.replaceMicrophoneTrackForPeers = replaceMicrophoneTrackForPeers;`,
  );
  const oldOne = new FakeTrack("old-one");
  const oldTwo = new FakeTrack("old-two");
  const candidate = new FakeTrack("candidate");
  let current = true;
  const makeSession = (track) => {
    const sender = {
      track,
      async replaceTrack(next) {
        this.track = next;
      },
    };
    const pc = {
      getSenders: () => [sender],
      addTrack: () => {
        throw new Error("unexpected addTrack");
      },
      removeTrack: () => {},
    };
    return { pc, microphoneSender: sender, sender };
  };
  const first = makeSession(oldOne);
  const second = makeSession(oldTwo);
  const env = {
    console,
    peerSessionsRef: ref(
      new Map([
        ["one", first],
        ["two", second],
      ]),
    ),
    localScreenStreamRef: ref(null),
    protectedVoiceSessionRef: ref(null),
  };
  vm.createContext(env);
  vm.runInContext(code, env);
  const result = await env.replaceMicrophoneTrackForPeers(
    "old-one",
    candidate,
    new FakeStream([candidate]),
    () => current,
  );
  // The callback is checked after each awaited replaceTrack. Flip it after
  // the first sender commits, forcing App's real rollback path.
  assert.equal(result, true);
  assert.equal(first.sender.track, candidate);
  assert.equal(second.sender.track, candidate);

  first.sender.track = oldOne;
  second.sender.track = oldTwo;
  let checks = 0;
  const cancelled = await env.replaceMicrophoneTrackForPeers("old-one", candidate, new FakeStream([candidate]), () => {
    checks += 1;
    return checks < 2;
  });
  assert.equal(cancelled, false);
  assert.equal(first.sender.track, oldOne);
  assert.equal(second.sender.track, oldTwo);
});

test("the actual desktop sink helper falls back to the system output and clears stale preference", async () => {
  const sinkStart = appSource.indexOf("  const setAudioSink = async (");
  const sinkEnd = appSource.indexOf("\n  const stopMeterLoop", sinkStart);
  const code = transpile(`${appSource.slice(sinkStart, sinkEnd)}\nglobalThis.setAudioSink = setAudioSink;`);
  const settings = { outputDeviceId: "headset" };
  const errors = [];
  const updates = [];
  const calls = [];
  const element = {
    async setSinkId(id) {
      calls.push(id);
      if (id === "headset") throw new Error("device removed");
    },
  };
  const env = {
    console,
    audioSettingsRef: ref(settings),
    setAudioOutputError: (value) => errors.push(value),
    setAudioSettings: (value) => {
      updates.push(value);
    },
  };
  vm.createContext(env);
  vm.runInContext(code, env);
  assert.equal(await env.setAudioSink(element, "headset"), false);
  assert.deepEqual(calls, ["headset", ""]);
  assert.equal(env.audioSettingsRef.current.outputDeviceId, "");
  assert.equal(updates.at(-1).outputDeviceId, "");
  assert.match(errors.at(-1), /system default/);
});

test("direct-call mute toggles the cloned track without muting Hub's shared track", () => {
  const toggleStart = directCallSource.indexOf("  const toggleMicrophone = () => {");
  const toggleEnd = directCallSource.indexOf("\n  useEffect(", toggleStart);
  const code = transpile(
    `${directCallSource.slice(toggleStart, toggleEnd)}\nglobalThis.toggleMicrophone = toggleMicrophone;`,
  );
  const shared = new FakeTrack("shared");
  const direct = new FakeTrack("direct");
  const sender = {
    track: direct,
    replaceTrack: async (next) => {
      sender.track = next;
    },
  };
  const env = {
    console,
    muted: false,
    localStreamRef: ref(new FakeStream([direct])),
    microphoneLeaseRef: ref({ stream: new FakeStream([shared]) }),
    pcRef: ref({ getSenders: () => [sender] }),
    setMuted: (value) => {
      env.muted = value;
    },
    setError: () => {},
  };
  vm.createContext(env);
  vm.runInContext(code, env);
  env.toggleMicrophone();
  assert.equal(env.muted, true);
  assert.equal(direct.enabled, false);
  assert.equal(shared.enabled, true);
  env.toggleMicrophone();
  assert.equal(env.muted, false);
  assert.equal(direct.enabled, true);
  assert.equal(shared.enabled, true);
});

test("ACCESS_REVOKED executes App teardown and clears the reconnect target", () => {
  const calls = [];
  const context = {
    serversRef: ref([{ id: 3, channels: [{ id: 7 }] }]),
    activeServerRef: ref(3),
    voiceChannelRef: ref(7),
    voiceServerIdRef: ref(3),
    voiceReconnectChannelRef: ref(7),
    voiceJoinAttemptRef: ref(null),
    protectedVoiceSessionRef: ref(null),
    protectedVoiceSignalContext: () => ({}),
    realtimeReconnectEnabledRef: ref(true),
    sendSocket: (payload) => {
      calls.push(payload);
      return true;
    },
    cleanupVoiceLocal: (clearPresence) => {
      calls.push(["cleanup", clearPresence]);
      context.voiceChannelRef.current = null;
    },
    setVoiceError: (value) => calls.push(["error", value]),
    setMessages: (value) => calls.push(["messages", value]),
    loadServers: async () => [],
    logout: async () => {},
    setAuthError: (value) => calls.push(["auth", value]),
  };
  const handled = handleHubEvent({ type: "ACCESS_REVOKED", serverId: 3, message: "Hub access revoked" }, context);
  assert.equal(handled, true);
  assert.equal(
    context.realtimeReconnectEnabledRef.current,
    true,
    "account realtime remains enabled for logout handling",
  );
  assert.equal(context.voiceReconnectChannelRef.current, null, "revoked voice must not be rejoined");
  assert.equal(calls[0].type, "VOICE_LEAVE");
  assert.equal(calls[1][0], "cleanup");
  assert.equal(calls[1][1], true);
  assert.equal(calls[2][0], "error");
  assert.equal(calls[2][1], "Hub access revoked");
  assert.equal(calls[3][0], "messages");
  assert.deepEqual([...calls[3][1]], []);
});
