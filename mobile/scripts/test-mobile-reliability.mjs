import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(mobileRoot, relativePath), "utf8");
const voiceSource = read("src/providers/VoiceProvider.tsx");
const callsSource = read("src/providers/DirectCallProvider.tsx");

function compile(code, globals, exportedName) {
  const context = vm.createContext({ console: { ...console, warn: () => {} }, ...globals });
  const output = ts.transpileModule(`${code}\nglobalThis.${exportedName} = ${exportedName};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(output, context, { filename: "mobile-reliability-runtime.ts" });
  return context;
}

function captureRuntime({ initialTrack, replacementStream, replacementError, delayed = false, senderFailure }) {
  const captureStart = voiceSource.indexOf("function captureConstraints");
  const captureEnd = voiceSource.indexOf("export function VoiceProvider", captureStart);
  const replaceStart = voiceSource.indexOf("  const replaceMicrophoneTrack");
  const replaceEnd = voiceSource.indexOf("  const ensureMicrophone", replaceStart);
  const stream = { getAudioTracks: () => [initialTrack], getTracks: () => [initialTrack] };
  const state = { status: null, message: "", error: "", localEnabledCalls: 0, replacementResolve: null };
  const replacementPromise = delayed
    ? new Promise((resolve) => { state.replacementResolve = resolve; })
    : Promise.resolve(replacementError ? Promise.reject(replacementError) : replacementStream);
  const mediaDevices = {
    getUserMedia: async () => {
      if (replacementError && !delayed) throw replacementError;
      return replacementPromise;
    },
  };
  const refs = {
    localStreamRef: { current: stream },
    peerSessionsRef: { current: new Map() },
    captureOperationRef: { current: 0 },
  };
  const senderCalls = [];
  for (const [index, shouldFail] of (senderFailure ?? []).entries()) {
    const sender = {
      track: initialTrack,
      replaceTrack: async (track) => {
        senderCalls.push({ index, track });
        if (shouldFail && senderCalls.filter((call) => call.index === index).length === 1) throw new Error("replace failed");
        sender.track = track;
      },
    };
    refs.peerSessionsRef.current.set(`peer-${index}`, { pc: { getSenders: () => [sender] } });
  }
  const globals = {
    ...refs,
    mediaDevices,
    setLocalTrackEnabled: () => { state.localEnabledCalls += 1; },
    setCaptureStatus: (value) => { state.status = value; },
    setCaptureStatusMessage: (value) => { state.message = value; },
    setVoiceError: (value) => { state.error = value; },
    ...voiceTimers(),
  };
  const code = voiceSource.slice(captureStart, captureEnd) + voiceSource.slice(replaceStart, replaceEnd) + "\n";
  const context = compile(code, globals, "applyActiveVoiceSettings");
  return { context, refs, state, senderCalls, stream, replacementStream, replacementPromise };
}

function track(id, { apply = "reject", settings = {} } = {}) {
  const state = { id, enabled: true, stopped: 0, applyCalls: [], settings: { ...settings } };
  return Object.assign(state, {
    applyConstraints: async (constraints) => {
      state.applyCalls.push(constraints);
      if (apply === "reject") throw new Error("constraints rejected");
      Object.assign(state.settings, constraints);
    },
    getSettings: () => ({ ...state.settings }),
    stop: () => { state.stopped += 1; },
  });
}

function streamFor(...tracks) {
  return { getAudioTracks: () => tracks.filter((item) => item.kind !== "video"), getTracks: () => tracks };
}

function voiceTimers() {
  const timers = new Map();
  let nextId = 0;
  return {
    timers,
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function testCaptureFallbackAndRollback() {
  const oldTrack = track("old", { apply: "reject" });
  const newTrack = track("new", { apply: "success", settings: { echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
  const replacement = streamFor(newTrack);
  const runtime = captureRuntime({ initialTrack: oldTrack, replacementStream: replacement, senderFailure: [false, false] });
  await runtime.context.applyActiveVoiceSettings({ echoCancellation: true, noiseSuppression: false, autoGainControl: true });
  assert.equal(runtime.refs.localStreamRef.current, replacement);
  assert.equal(oldTrack.stopped, 1);
  assert.deepEqual(runtime.senderCalls.map(({ track: item }) => item.id), ["new", "new"]);
  assert.equal(runtime.state.status, "replaced");

  const rollbackOld = track("rollback-old", { apply: "reject" });
  const rollbackNew = track("rollback-new");
  const rollback = captureRuntime({ initialTrack: rollbackOld, replacementStream: streamFor(rollbackNew), senderFailure: [false, true] });
  await rollback.context.applyActiveVoiceSettings({ echoCancellation: false, noiseSuppression: true, autoGainControl: false });
  assert.equal(rollback.refs.localStreamRef.current.getAudioTracks()[0], rollbackOld);
  assert.equal(rollbackNew.stopped, 1);
  assert.deepEqual(rollback.senderCalls.map(({ index, track: item }) => `${index}:${item.id}`), ["0:rollback-new", "1:rollback-new", "0:rollback-old"]);
  assert.equal(rollback.state.status, "unsupported");
  assert.match(rollback.state.error, /could not be applied/);
}

async function testCaptureGenerationCancellation() {
  const oldTrack = track("cancel-old", { apply: "reject" });
  const replacementTrack = track("cancel-new");
  const runtime = captureRuntime({ initialTrack: oldTrack, replacementStream: streamFor(replacementTrack), delayed: true, senderFailure: [false] });
  const pending = runtime.context.applyActiveVoiceSettings({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  runtime.refs.captureOperationRef.current += 1;
  runtime.state.replacementResolve(runtime.replacementStream);
  await pending;
  assert.equal(runtime.refs.localStreamRef.current.getAudioTracks()[0], oldTrack);
  assert.equal(replacementTrack.stopped, 1);
  assert.equal(runtime.senderCalls.length, 0);
  assert.equal(runtime.state.error, "");
}

async function testBoundedIceRecoveryCancellation() {
  const recoveryStart = voiceSource.indexOf("  const schedulePeerRecovery");
  const recoveryEnd = voiceSource.indexOf("  const handleDescription", recoveryStart);
  const timers = voiceTimers();
  const state = { enqueued: 0, closed: 0, errors: [] };
  const session = {
    participant: { connectionId: "peer-1" }, recoveryTimer: null, recoveryAttempts: 0,
    pc: { connectionState: "connected", restartIce: async () => {}, setLocalDescription: async () => {}, createOffer: async () => ({}) },
  };
  const refs = { peerSessionsRef: { current: new Map([["peer-1", session]]) }, voiceChannelRef: { current: 42 }, voiceOperationGenerationRef: { current: 7 } };
  const context = compile(voiceSource.slice(recoveryStart, recoveryEnd), {
    ...refs, ...timers, MAX_PEER_RECOVERY_ATTEMPTS: 3, PEER_RECOVERY_DELAYS_MS: [250, 750, 1500],
    setRecoveryState: () => {}, setRecoveryAttempt: () => {}, setVoiceError: (message) => state.errors.push(message),
    closePeer: () => { state.closed += 1; }, queueLocalTracksToPeer: async () => {},
    enqueuePeerSignaling: async (_session, operation) => { state.enqueued += 1; await operation(); },
    sendDescription: () => true,
  }, "schedulePeerRecovery");
  context.schedulePeerRecovery(session);
  assert.equal(session.recoveryAttempts, 1);
  const timer = [...timers.timers.values()][0];
  assert.equal(timer.delay, 250);
  refs.voiceOperationGenerationRef.current += 1;
  await timer.callback();
  assert.equal(state.enqueued, 0, "a stale recovery timer must not restart ICE");

  session.recoveryTimer = null;
  session.recoveryAttempts = 3;
  refs.voiceOperationGenerationRef.current = 9;
  context.schedulePeerRecovery(session);
  assert.equal(state.closed, 1, "recovery is bounded after three attempts");
  assert.equal(state.errors.length, 2);
}

async function testStatsSpeakingAndUnavailable() {
  const statsStart = voiceSource.lastIndexOf("    let cancelled = false;");
  const statsEnd = voiceSource.indexOf("    return () => { cancelled = true; };", statsStart) + "    return () => { cancelled = true; };".length;
  const timers = voiceTimers();
  const speaking = { ids: null, available: null };
  const stats = {
    peerSessionsRef: { current: new Map([
      ["loud", { participant: { userId: "loud-user" }, pc: { getStats: async () => ({ forEach: (callback) => callback({ type: "inbound-rtp", kind: "audio", audioLevel: 0.2 }) }) } }],
      ["quiet", { participant: { userId: "quiet-user" }, pc: { getStats: async () => ({ forEach: (callback) => callback({ type: "inbound-rtp", kind: "audio", audioLevel: 0.01 }) }) } }],
    ]) },
    voiceOperationGenerationRef: { current: 3 }, voiceChannelRef: { current: 9 }, voiceChannelId: 9,
    setSpeakingAvailable: (value) => { speaking.available = value; }, setSpeakingUserIds: (value) => { speaking.ids = typeof value === "function" ? value(speaking.ids ?? []) : value; }, setPingMs: () => {},
    ...timers,
  };
  const context = compile(`globalThis.startStats = () => { ${voiceSource.slice(statsStart, statsEnd)} };`, stats, "startStats");
  const cleanup = context.startStats();
  await flush();
  assert.equal(speaking.available, true);
  assert.deepEqual([...speaking.ids], ["loud-user"]);
  cleanup();

  const unavailable = { ids: ["stale"], available: true };
  const unavailableStats = {
    peerSessionsRef: { current: new Map([["no-stats", { participant: { userId: "no-stats" }, pc: {} }]]) },
    voiceOperationGenerationRef: { current: 1 }, voiceChannelRef: { current: 9 }, voiceChannelId: 9,
    setSpeakingAvailable: (value) => { unavailable.available = value; }, setSpeakingUserIds: (value) => { unavailable.ids = typeof value === "function" ? value(unavailable.ids) : value; }, setPingMs: () => {},
    ...voiceTimers(),
  };
  const unavailableContext = compile(`globalThis.startStats = () => { ${voiceSource.slice(statsStart, statsEnd)} };`, unavailableStats, "startStats");
  const stop = unavailableContext.startStats();
  await flush();
  assert.equal(unavailable.available, false);
  assert.deepEqual([...unavailable.ids], []);
  stop();
}

async function testRevocationCleanup() {
  const resetStart = voiceSource.indexOf("  const resetVoiceLocal");
  const resetEnd = voiceSource.indexOf("  const failVoice", resetStart);
  const trackToStop = track("local");
  const cameraTrack = track("camera");
  const screenTrack = track("screen");
  const refs = {
    voiceOperationGenerationRef: { current: 4 }, captureOperationRef: { current: 6 },
    voiceRecoveryRef: { current: { timer: 1, generation: 4 } }, joinTimeoutRef: { current: 2 },
    localStreamRef: { current: streamFor(trackToStop) }, localCameraStreamRef: { current: streamFor(cameraTrack) }, localScreenStreamRef: { current: streamFor(screenTrack) },
    peerSessionsRef: { current: new Map([["peer", {}]]) },
    voiceChannelRef: { current: 3 }, pendingVoiceChannelRef: { current: 3 }, participantsRef: { current: [{ userId: "peer" }] },
    mutedRef: { current: true }, deafenedRef: { current: true }, serverMutedRef: { current: true }, serverDeafenedRef: { current: true },
    locallyMutedUserIdsRef: { current: new Set(["peer"]) }, iceServersRef: { current: ["custom"] },
  };
  const updates = {};
  const context = compile(voiceSource.slice(resetStart, resetEnd), {
    ...refs, fallbackIceServers: ["fallback"],
    clearVoiceRecovery: () => { refs.voiceRecoveryRef.current = null; }, clearJoinTimeout: () => { refs.joinTimeoutRef.current = null; },
    stopCamera: () => { refs.localCameraStreamRef.current = null; cameraTrack.stop(); },
    stopScreenShare: () => { refs.localScreenStreamRef.current = null; screenTrack.stop(); },
    closeAllPeers: () => { refs.peerSessionsRef.current.clear(); },
    stopMicrophone: () => { refs.localStreamRef.current = null; trackToStop.stop(); },
    ...Object.fromEntries(["setVoiceOwnerGeneration", "setVoiceChannelId", "setParticipants", "setRemoteVideos", "setVoiceStatus", "setCaptureStatus", "setCaptureStatusMessage", "setSpeakingUserIds", "setSpeakingAvailable", "setPingMs", "setLocallyMutedUserIds", "setMuted", "setDeafened", "setServerMuted", "setServerDeafened", "setCameraSharing", "setScreenSharing", "setScreenShareError", "setVoiceError"].map((name) => [name, (value) => { updates[name] = value; }])),
  }, "resetVoiceLocal");
  context.resetVoiceLocal(true);
  assert.equal(refs.voiceOperationGenerationRef.current, 5);
  assert.equal(refs.captureOperationRef.current, 7);
  assert.equal(refs.voiceChannelRef.current, null);
  assert.equal(refs.pendingVoiceChannelRef.current, null);
  assert.equal(refs.localStreamRef.current, null);
  assert.equal(refs.localCameraStreamRef.current, null);
  assert.equal(refs.localScreenStreamRef.current, null);
  assert.equal(updates.setVoiceStatus, "disconnected");
  assert.equal(updates.setVoiceOwnerGeneration, null);
  assert.equal(updates.setSpeakingAvailable, false);
  assert.equal(updates.setVoiceError, undefined, "revocation cleanup preserves the specific access error");
  assert.equal(trackToStop.stopped, 1);
  assert.equal(cameraTrack.stopped, 1);
  assert.equal(screenTrack.stopped, 1);
}

async function testDirectCallRevocation() {
  const resetStart = callsSource.indexOf("  const resetLocal");
  const resetEnd = callsSource.indexOf("  const failCall", resetStart);
  const eventStart = callsSource.indexOf("    const type = event?.type;");
  const eventEnd = callsSource.indexOf("    if (type === \"DM_CALL_RINGING\")", eventStart);
  const updates = {};
  const calls = [];
  const refs = {
    phaseRef: { current: "connected" }, outgoingRef: { current: true }, iceServersRef: { current: ["turn"] },
    connectedAtRef: { current: Date.now() },
  };
  const context = compile(
    `${callsSource.slice(resetStart, resetEnd)}\nglobalThis.handleEvent = (event) => { ${callsSource.slice(eventStart, eventEnd)} };`,
    {
      ...refs,
      closePeer: () => calls.push("closePeer"), stopLocalMedia: () => calls.push("stopLocalMedia"),
      clearCallVerdict: () => {},
      ...Object.fromEntries(["setCallPeer", "setCallVideo", "setCallPhase", "setMuted", "setCameraEnabled", "setDurationSeconds", "setVolumeOpen", "setMinimized", "setError"].map((name) => [name, (value) => { updates[name] = value; }])),
    },
    "handleEvent",
  );
  context.handleEvent({ type: "ACCESS_REVOKED" });
  assert.deepEqual(calls, ["closePeer", "stopLocalMedia"]);
  assert.equal(updates.setError, "Your access changed, so this call was ended.");
  assert.equal(updates.setCallPhase, "idle");
  assert.equal(updates.setCallPeer, null);
  assert.equal(refs.outgoingRef.current, false);
  assert.deepEqual([...refs.iceServersRef.current], []);
}

await testCaptureFallbackAndRollback();
await testCaptureGenerationCancellation();
await testBoundedIceRecoveryCancellation();
await testStatsSpeakingAndUnavailable();
await testRevocationCleanup();
await testDirectCallRevocation();
console.log("mobile reliability runtime checks passed (6)");
