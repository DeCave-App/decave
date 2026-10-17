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

// The provider slices call i18next's `t`; give them the English catalogs so
// assertions see the text English users get.
const englishCatalogs = Object.fromEntries(
  fs
    .readdirSync(path.join(mobileRoot, "../shared/i18n/locales/en"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => [
      file.slice(0, -".json".length),
      JSON.parse(fs.readFileSync(path.join(mobileRoot, "../shared/i18n/locales/en", file), "utf8")),
    ]),
);
const englishPlurals = new Intl.PluralRules("en");

function englishT(key, options = {}) {
  const lookup = (fullKey) =>
    fullKey.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), englishCatalogs);
  const value =
    (typeof options.count === "number" ? lookup(`${key}_${englishPlurals.select(options.count)}`) : undefined) ??
    lookup(key) ??
    options.defaultValue ??
    key;
  return String(value).replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name) => String(options[name] ?? ""));
}

function compile(code, globals, exportedName) {
  const context = vm.createContext({ console: { ...console, warn: () => {} }, t: englishT, ...globals });
  const output = ts.transpileModule(`${code}\nglobalThis.${exportedName} = ${exportedName};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(output, context, { filename: "mobile-reliability-runtime.ts" });
  return context;
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mediaTrack(id) {
  return {
    id,
    kind: "video",
    stopped: 0,
    enabled: true,
    onended: null,
    stop() { this.stopped += 1; },
  };
}

function videoStream(track) {
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
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
    callOperationGenerationRef: { current: 0 }, callOperationPendingRef: { current: false },
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

function voiceCaptureRuntime({ permission, cameraMedia, screenMedia, queuePeer, cameraAdvert } = {}) {
  const refs = {
    voiceOperationGenerationRef: { current: 1 },
    voiceChannelRef: { current: 10 },
    sessionScopeRef: { current: { identity: "account-a:token-a", generation: 1 } },
    localCameraStreamRef: { current: null },
    localScreenStreamRef: { current: null },
    cameraStartInFlightRef: { current: false },
    peerSessionsRef: { current: new Map() },
    voiceSettingsRef: { current: { screenShareQuality: "balanced" } },
  };
  const state = { events: [], errors: [], screenErrors: [], cameraSharing: [], localCameraStreams: [], cameraFacings: [], screenSharing: [], stopCamera: 0, stopScreen: 0, cameraMediaCalls: 0, screenMediaCalls: 0, advertWaits: 0 };
  const permissionRequest = permission ?? Promise.resolve("granted");
  const mediaDevices = {
    getUserMedia: async () => { state.cameraMediaCalls += 1; return cameraMedia ? await cameraMedia : videoStream(mediaTrack("camera")); },
    getDisplayMedia: async () => { state.screenMediaCalls += 1; return screenMedia ? await screenMedia : videoStream(mediaTrack("screen")); },
  };
  const makePeer = () => {
    const senders = [];
    return {
      senders,
      pc: {
        getSenders: () => senders,
        removeTrack: (sender) => { const index = senders.indexOf(sender); if (index >= 0) senders.splice(index, 1); },
      },
    };
  };
  const oldPeer = makePeer();
  refs.peerSessionsRef.current.set("peer-a", oldPeer);
  const globals = {
    ...refs,
    sessionIdentity: "account-a:token-a",
    sessionGeneration: 1,
    Platform: { OS: "android" },
    PermissionsAndroid: {
      PERMISSIONS: { CAMERA: "camera" }, RESULTS: { GRANTED: "granted" },
      request: async () => await permissionRequest,
    },
    mediaDevices,
    requestIosBroadcast: async () => true,
    send: (event) => { state.events.push(event); return true; },
    setVoiceError: (value) => state.errors.push(value),
    setScreenShareError: (value) => state.screenErrors.push(value),
    setCameraSharing: (value) => state.cameraSharing.push(value),
    setLocalCameraStream: (value) => state.localCameraStreams.push(value),
    setCameraFacing: (value) => state.cameraFacings.push(value),
    trackFacing: (track) => (track?.getSettings?.()?.facingMode === "environment" ? "environment" : "user"),
    cameraFlipInFlightRef: { current: false },
    waitForCameraAdvert: async () => { state.advertWaits += 1; if (cameraAdvert) await cameraAdvert; },
    setScreenSharing: (value) => state.screenSharing.push(value),
    stopCamera: () => { state.stopCamera += 1; refs.localCameraStreamRef.current = null; },
    stopScreenShare: () => { state.stopScreen += 1; refs.localScreenStreamRef.current = null; },
    errorMessage: (_cause, fallback) => fallback,
    console: { warn() {} },
    queueLocalTracksToPeer: async (session) => {
      if (queuePeer) await queuePeer(session, refs);
      else {
        const tracks = [
          ...((refs.localCameraStreamRef.current?.getTracks?.()) ?? []),
          ...((refs.localScreenStreamRef.current?.getTracks?.()) ?? []),
        ];
        for (const track of tracks) session.pc.getSenders().push({ track });
      }
    },
  };
  const code = sourceBetween(voiceSource, "  const requestCamera =", "  realtimeEventHandlerRef.current =") +
    "\nglobalThis.startScreenShare = startScreenShare;";
  const context = compile(code, globals, "startCamera");
  return { context, refs, state, oldPeer, makePeer };
}

function switchVoiceAccount(runtime) {
  runtime.context.sessionIdentity = "account-b:token-b";
  runtime.context.sessionGeneration = 2;
  runtime.refs.sessionScopeRef.current = { identity: "account-b:token-b", generation: 2 };
  runtime.refs.voiceOperationGenerationRef.current += 1;
  runtime.refs.voiceChannelRef.current = 20;
  runtime.refs.peerSessionsRef.current = new Map([["peer-b", runtime.makePeer()]]);
}

async function testVoiceLateCameraPermissionAfterAccountSwitch() {
  const permission = deferred();
  const cameraMedia = deferred();
  const runtime = voiceCaptureRuntime({ permission: permission.promise, cameraMedia: cameraMedia.promise });
  const pending = runtime.context.startCamera();
  await flush();
  switchVoiceAccount(runtime);
  permission.resolve("granted");
  assert.equal(await pending, false);
  assert.equal(runtime.state.cameraMediaCalls, 0);
  assert.equal(runtime.state.events.length, 0);
  assert.equal(runtime.refs.localCameraStreamRef.current, null);
}

async function testVoiceLateCameraMediaAfterAccountSwitch() {
  const cameraMedia = deferred();
  const runtime = voiceCaptureRuntime({ cameraMedia: cameraMedia.promise });
  const pending = runtime.context.startCamera();
  await flush();
  switchVoiceAccount(runtime);
  const track = mediaTrack("late-camera");
  cameraMedia.resolve(videoStream(track));
  assert.equal(await pending, false);
  assert.equal(track.stopped, 1);
  assert.equal(runtime.state.events.length, 0);
  assert.equal([...runtime.refs.peerSessionsRef.current.values()][0].pc.getSenders().length, 0);
  assert.equal(runtime.refs.localCameraStreamRef.current, null);
}

async function testVoiceLateScreenMediaAfterRoomSwitch() {
  const screenMedia = deferred();
  const runtime = voiceCaptureRuntime({ screenMedia: screenMedia.promise });
  const pending = runtime.context.startScreenShare();
  await flush();
  runtime.refs.voiceOperationGenerationRef.current += 1;
  runtime.refs.voiceChannelRef.current = 11;
  runtime.refs.peerSessionsRef.current = new Map([["peer-next-room", runtime.makePeer()]]);
  const track = mediaTrack("late-screen");
  screenMedia.resolve(videoStream(track));
  assert.equal(await pending, false);
  assert.equal(track.stopped, 1);
  assert.equal(runtime.state.events.length, 0);
  assert.equal([...runtime.refs.peerSessionsRef.current.values()][0].pc.getSenders().length, 0);
  assert.equal(runtime.refs.localScreenStreamRef.current, null);
}

async function testVoiceSameAccountCaptureAndEndedCallbacks() {
  const runtime = voiceCaptureRuntime();
  const camera = videoStream(mediaTrack("camera-a"));
  const originalGetUserMedia = runtime.context.mediaDevices.getUserMedia;
  runtime.context.mediaDevices.getUserMedia = async () => camera;
  assert.equal(await runtime.context.startCamera(), true);
  assert.equal(runtime.refs.localCameraStreamRef.current, camera);
  assert.equal(runtime.state.events[0].cameraSharing, true);
  const cameraTrack = camera.getVideoTracks()[0];
  assert.equal(typeof cameraTrack.onended, "function");
  cameraTrack.onended();
  assert.equal(runtime.state.stopCamera, 1, "a current camera track end still stops its capture");
  assert.equal(runtime.refs.localCameraStreamRef.current, null);

  switchVoiceAccount(runtime);
  const accountBStream = videoStream(mediaTrack("camera-b"));
  runtime.refs.localCameraStreamRef.current = accountBStream;
  cameraTrack.onended();
  assert.equal(runtime.state.stopCamera, 1, "an old track callback cannot stop the new account's camera");
  assert.equal(runtime.refs.localCameraStreamRef.current, accountBStream);

  // A still-current capture retains the normal stop behavior on track end.
  runtime.context.sessionIdentity = "account-b:token-b";
  runtime.context.sessionGeneration = 2;
  runtime.refs.sessionScopeRef.current = { identity: "account-b:token-b", generation: 2 };
  runtime.refs.voiceOperationGenerationRef.current += 1;
  runtime.refs.localCameraStreamRef.current = null;
  const screen = videoStream(mediaTrack("screen-b"));
  runtime.context.mediaDevices.getDisplayMedia = async () => screen;
  assert.equal(await runtime.context.startScreenShare(), true);
  screen.getVideoTracks()[0].onended();
  assert.equal(runtime.state.stopScreen, 1);
  runtime.context.mediaDevices.getUserMedia = originalGetUserMedia;
}

async function testVoiceRoomSwitchDuringPeerQueue() {
  const queueStarted = deferred();
  const queueRelease = deferred();
  const track = mediaTrack("queued-camera");
  const runtime = voiceCaptureRuntime({
    cameraMedia: Promise.resolve(videoStream(track)),
    queuePeer: async (session, refs) => {
      session.pc.getSenders().push({ track: refs.localCameraStreamRef.current.getVideoTracks()[0] });
      queueStarted.resolve();
      await queueRelease.promise;
    },
  });
  const pending = runtime.context.startCamera();
  await queueStarted.promise;
  runtime.refs.voiceOperationGenerationRef.current += 1;
  runtime.refs.voiceChannelRef.current = 11;
  queueRelease.resolve();
  assert.equal(await pending, false);
  assert.equal(track.stopped, 1);
  assert.equal(runtime.oldPeer.pc.getSenders().length, 0);
  assert.equal(runtime.refs.localCameraStreamRef.current, null);
}

async function testVoiceCameraWaitsForAdvertBeforeAttaching() {
  // Peers classify the video track by our VOICE_STATE flags, so the track must
  // not reach any peer connection until the server has advertised cameraSharing.
  const advert = deferred();
  const track = mediaTrack("advert-camera");
  const runtime = voiceCaptureRuntime({ cameraMedia: Promise.resolve(videoStream(track)), cameraAdvert: advert.promise });
  const pending = runtime.context.startCamera();
  await flush();
  assert.equal(runtime.state.events.length, 1);
  assert.deepEqual({ ...runtime.state.events[0] }, { type: "VOICE_CAMERA_STATE", cameraSharing: true });
  assert.equal(runtime.state.advertWaits, 1);
  assert.equal(runtime.oldPeer.pc.getSenders().length, 0, "no camera sender before the advert");
  assert.equal(runtime.refs.localCameraStreamRef.current, null, "renegotiations cannot pick the camera up early");
  assert.equal(await runtime.context.startCamera(), false, "a second tap while waiting does not open another camera");
  assert.equal(runtime.state.cameraMediaCalls, 1);
  advert.resolve();
  assert.equal(await pending, true);
  assert.equal(runtime.oldPeer.pc.getSenders().length, 1);
  assert.equal(runtime.oldPeer.pc.getSenders()[0].track, track);
  assert.deepEqual([...runtime.state.cameraSharing], [true]);
  assert.equal(runtime.state.localCameraStreams.at(-1)?.getVideoTracks()[0], track, "the self view gets the stream");
  assert.equal(runtime.refs.cameraStartInFlightRef.current, false);
}

async function testVoiceCameraLeaveDuringAdvert() {
  const advert = deferred();
  const track = mediaTrack("advert-left-camera");
  const runtime = voiceCaptureRuntime({ cameraMedia: Promise.resolve(videoStream(track)), cameraAdvert: advert.promise });
  const pending = runtime.context.startCamera();
  await flush();
  runtime.refs.voiceOperationGenerationRef.current += 1;
  runtime.refs.voiceChannelRef.current = null;
  advert.resolve();
  assert.equal(await pending, false);
  assert.equal(track.stopped, 1);
  assert.equal(runtime.oldPeer.pc.getSenders().length, 0);
  assert.equal(runtime.refs.localCameraStreamRef.current, null);
  assert.equal(runtime.refs.cameraStartInFlightRef.current, false);
}

function directCallRuntime({ permission, media, ice, phase = "idle" } = {}) {
  const state = { events: [], eventSockets: [], errors: [], permissionCalls: [], apiTokens: [], mediaCalls: 0, iceWrites: [], localStream: null, remoteStream: null };
  const refs = {
    sessionIdentityRef: { current: "account-a:token-a" },
    callOperationGenerationRef: { current: 0 }, callOperationPendingRef: { current: false },
    phaseRef: { current: phase }, videoRef: { current: false }, peerRef: { current: phase === "incoming" ? { userId: "friend" } : null },
    outgoingRef: { current: false }, localStreamRef: { current: null }, remoteStreamRef: { current: null },
    pcRef: { current: null }, pendingCandidatesRef: { current: [] }, iceServersRef: { current: [] }, connectedAtRef: { current: null },
  };
  const permissionResult = permission ?? Promise.resolve("granted");
  const mediaResult = media ?? Promise.resolve(videoStream(mediaTrack("call-media")));
  const iceResult = ice ?? Promise.resolve({ iceServers: [{ urls: "turn:relay.example" }] });
  const socketRef = { current: "socket-a" };
  const globals = {
    ...refs,
    sessionIdentity: "account-a:token-a", token: "token-a", user: { id: "account-a" }, connectionState: "connected",
    socketRef,
    PermissionsAndroid: {
      PERMISSIONS: { RECORD_AUDIO: "microphone", CAMERA: "camera" }, RESULTS: { GRANTED: "granted" },
      request: async (permissionName) => { state.permissionCalls.push(permissionName); return await permissionResult; },
    },
    Platform: { OS: "android" },
    mediaDevices: { getUserMedia: async () => { state.mediaCalls += 1; return await mediaResult; } },
    apiJson: async (_path, _options, authToken) => { state.apiTokens.push(authToken); return await iceResult; },
    hasRelayIceServer: (servers) => servers.some((server) => String(server.urls).startsWith("turn:")),
    RELAY_UNAVAILABLE_MESSAGE: "relay unavailable",
    provisionalPeer: (userId, username) => ({ userId, username, connectionId: "provisional" }),
    send: (event) => { state.events.push(event); state.eventSockets.push(socketRef.current); return true; },
    clearCallVerdict: () => {},
    closePeer: () => { refs.pcRef.current = null; refs.remoteStreamRef.current = null; state.remoteStream = null; },
    stopLocalMedia: () => {
      for (const track of refs.localStreamRef.current?.getTracks?.() ?? []) track.stop();
      refs.localStreamRef.current = null;
      state.localStream = null;
    },
    setPeer: (value) => { refs.peerRef.current = value; },
    setVideo: (value) => { refs.videoRef.current = value; },
    setPhase: (value) => { refs.phaseRef.current = value; },
    setMuted: () => {}, setCameraEnabled: () => {}, setCameraFacing: () => {}, trackFacing: () => "user", setDurationSeconds: () => {}, setVolumeOpen: () => {}, setMinimized: () => {},
    setError: (value) => state.errors.push(value),
    setLocalStream: (value) => { state.localStream = value; },
    setRemoteStream: (value) => { state.remoteStream = value; },
    errorMessage: (_cause, fallback) => fallback,
    callDescriptionAuth: () => ({}),
  };
  const operationStart = callsSource.indexOf("  const isCurrentCallOperation");
  const operationEnd = callsSource.indexOf("  const sendDescription", operationStart);
  const flowStart = callsSource.indexOf("  const startCall");
  const flowEnd = callsSource.indexOf("  const declineCall", flowStart);
  const authStart = callsSource.indexOf('    if (phaseRef.current !== "idle" || callOperationPendingRef.current) resetLocal();');
  const authEnd = callsSource.indexOf("\n  }, [user?.id, token]);", authStart);
  assert.notEqual(authStart, -1, "auth-change effect must reset pending call setup");
  const code = callsSource.slice(operationStart, operationEnd) + callsSource.slice(flowStart, flowEnd) +
    `\nglobalThis.acceptCall = acceptCall;\nglobalThis.runAuthReset = () => { ${callsSource.slice(authStart, authEnd)} };`;
  const context = compile(code, globals, "startCall");
  return { context, refs, state, socketRef };
}

function switchDirectCallAccount(runtime) {
  runtime.context.sessionIdentity = "account-b:token-b";
  runtime.context.token = "token-b";
  runtime.context.user = { id: "account-b" };
  runtime.refs.sessionIdentityRef.current = "account-b:token-b";
  runtime.refs.callOperationGenerationRef.current += 1;
  runtime.socketRef.current = "socket-b";
  runtime.context.runAuthReset();
}

async function testDirectCallLateIceAfterAccountSwitch() {
  const ice = deferred();
  const runtime = directCallRuntime({ ice: ice.promise });
  const pending = runtime.context.startCall("friend", false);
  await flush();
  switchDirectCallAccount(runtime);
  ice.resolve({ iceServers: [{ urls: "turn:relay.example" }] });
  assert.equal(await pending, false);
  assert.equal(runtime.state.permissionCalls.length, 0);
  assert.equal(runtime.state.mediaCalls, 0);
  assert.equal(runtime.state.events.length, 0);
  assert.deepEqual([...runtime.refs.iceServersRef.current], []);
}

async function testDirectCallLatePermissionAfterAccountSwitch() {
  const permission = deferred();
  const runtime = directCallRuntime({ permission: permission.promise });
  const pending = runtime.context.startCall("friend", false);
  await flush();
  assert.deepEqual(runtime.state.permissionCalls, ["microphone"]);
  switchDirectCallAccount(runtime);
  permission.resolve("granted");
  assert.equal(await pending, false);
  assert.equal(runtime.state.mediaCalls, 0);
  assert.equal(runtime.state.events.length, 0);
  assert.equal(runtime.refs.phaseRef.current, "idle");
}

async function testDirectCallLateMediaAfterAccountSwitch() {
  const media = deferred();
  const runtime = directCallRuntime({ media: media.promise });
  const pending = runtime.context.startCall("friend", false);
  await flush();
  assert.equal(runtime.state.mediaCalls, 1);
  switchDirectCallAccount(runtime);
  const track = mediaTrack("late-call-media");
  media.resolve(videoStream(track));
  assert.equal(await pending, false);
  assert.equal(track.stopped, 1);
  assert.equal(runtime.state.events.length, 0);
  assert.equal(runtime.refs.localStreamRef.current, null);
  assert.equal(runtime.state.localStream, null);
}

async function testDirectCallSameAccountAndPendingAcceptReset() {
  const runtime = directCallRuntime();
  assert.equal(await runtime.context.startCall("friend", true), true);
  assert.equal(runtime.refs.phaseRef.current, "ringing");
  assert.deepEqual(runtime.state.events.map((event) => event.type), ["DM_CALL_START"]);
  assert.deepEqual(runtime.state.eventSockets, ["socket-a"]);
  assert.equal(runtime.refs.localStreamRef.current.getTracks()[0].stopped, 0);

  const permission = deferred();
  const incoming = directCallRuntime({ phase: "incoming", permission: permission.promise });
  const accepting = incoming.context.acceptCall();
  await flush();
  assert.equal(incoming.refs.callOperationPendingRef.current, true);
  switchDirectCallAccount(incoming);
  permission.resolve("granted");
  await accepting;
  assert.equal(incoming.refs.phaseRef.current, "idle");
  assert.equal(incoming.state.events.length, 0, "a stale accept cannot accept or decline the new account's call");
  assert.equal(incoming.state.mediaCalls, 0);
}

await testCaptureFallbackAndRollback();
await testCaptureGenerationCancellation();
await testBoundedIceRecoveryCancellation();
await testStatsSpeakingAndUnavailable();
await testRevocationCleanup();
await testDirectCallRevocation();
await testVoiceLateCameraPermissionAfterAccountSwitch();
await testVoiceLateCameraMediaAfterAccountSwitch();
await testVoiceLateScreenMediaAfterRoomSwitch();
await testVoiceSameAccountCaptureAndEndedCallbacks();
await testVoiceRoomSwitchDuringPeerQueue();
await testVoiceCameraWaitsForAdvertBeforeAttaching();
await testVoiceCameraLeaveDuringAdvert();
await testDirectCallLateIceAfterAccountSwitch();
await testDirectCallLatePermissionAfterAccountSwitch();
await testDirectCallLateMediaAfterAccountSwitch();
await testDirectCallSameAccountAndPendingAcceptReset();
console.log("mobile reliability runtime checks passed (17)");
