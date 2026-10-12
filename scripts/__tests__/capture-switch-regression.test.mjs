import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { location: { origin: "https://app.example.test", protocol: "https:", host: "app.example.test" } };
const { createVoiceControlActions } = await import("../../src/app/actions/voice-controls.ts");
delete globalThis.window;

function createTrack(kind, id) {
  return {
    id,
    kind,
    contentHint: "",
    stopped: false,
    onended: null,
    getSettings: () => ({}),
    applyConstraints: async () => {},
    stop() {
      this.stopped = true;
    },
  };
}

function createStream(kind, id) {
  const tracks = [createTrack(kind, id)];
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    removeTrack(track) {
      const index = tracks.indexOf(track);
      if (index !== -1) tracks.splice(index, 1);
    },
  };
}

function makeHarness(initial = {}) {
  const voiceChannelRef = { current: 7 };
  const localScreenStreamRef = { current: initial.screen ?? null };
  const localCameraStreamRef = { current: initial.camera ?? null };
  const values = {
    isScreenSharing: Boolean(initial.screen),
    isCameraOn: Boolean(initial.camera),
    voiceError: "",
    localScreenStream: initial.screen ?? null,
    localCameraStream: initial.camera ?? null,
  };
  const updates = [];
  const set = (key) => (next) => {
    values[key] = typeof next === "function" ? next(values[key]) : next;
    updates.push([key, values[key]]);
  };
  const sockets = [];
  const stopCamera = () => {
    const camera = localCameraStreamRef.current;
    if (!camera) return;
    for (const track of camera.getTracks()) track.stop();
    localCameraStreamRef.current = null;
    set("localCameraStream")(null);
    set("isCameraOn")(false);
    sockets.push({ type: "VOICE_CAMERA_STATE", cameraSharing: false });
  };
  const actions = createVoiceControlActions({
    currentUser: null,
    extraSettingsRef: { current: {} },
    voiceChannelRef,
    privacySettingsRef: { current: { allowStreamPreviews: true } },
    isMutedRef: { current: false },
    localScreenStreamRef,
    localCameraStreamRef,
    cameraStartInFlightRef: { current: false },
    screenShareInFlightRef: { current: false },
    screenQualityRef: { current: "720p30" },
    peerSessionsRef: { current: new Map() },
    isDeafenedRef: { current: false },
    playUiSound: () => {},
    currentServer: { id: 1 },
    authorizedFetch: async () => new Response("{}"),
    sendSocket: (payload) => {
      sockets.push(payload);
      return true;
    },
    applyMicrophoneEnabledState: () => true,
    addLocalTracksToPeer: () => {},
    screenSfu: { begin: async () => {}, end: () => {} },
    stopCamera,
    soundboard: {
      setSoundboardNotice: () => {},
      soundboardBusy: false,
      setSoundboardBusy: () => {},
      setSoundboardSounds: () => {},
    },
    cameraShareOptions: { shareSystemAudio: false, cameraEffect: "none", setCameraEffectNotice: () => {} },
    voiceCall: {
      setVoiceError: set("voiceError"),
      isMuted: false,
      setIsMuted: () => {},
      isDeafened: false,
      setIsDeafened: () => {},
      setSoundboardNotice: () => {},
    },
    callMedia: {
      isScreenSharing: values.isScreenSharing,
      setIsScreenSharing: set("isScreenSharing"),
      isCameraOn: values.isCameraOn,
      setIsCameraOn: set("isCameraOn"),
      setLocalScreenStream: set("localScreenStream"),
      setLocalCameraStream: set("localCameraStream"),
    },
  });
  return { actions, values, updates, sockets, voiceChannelRef, localScreenStreamRef, localCameraStreamRef };
}

function withMediaDevices(mediaDevices, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices } });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else delete globalThis.navigator;
    });
}

test("canceling screen selection leaves the current camera running", async () => {
  const camera = createStream("video", "camera-old");
  const harness = makeHarness({ camera });
  await withMediaDevices(
    {
      getDisplayMedia: async () => {
        throw new DOMException("Picker dismissed", "NotAllowedError");
      },
    },
    () => harness.actions.startScreenShare(),
  );

  assert.equal(camera.getTracks()[0].stopped, false);
  assert.equal(harness.localCameraStreamRef.current, camera);
  assert.equal(harness.values.isCameraOn, true);
  assert.equal(harness.localScreenStreamRef.current, null);
  assert.equal(
    harness.sockets.some((event) => event.type === "VOICE_CAMERA_STATE" && !event.cameraSharing),
    false,
  );
});

test("camera capture failure leaves the current screen share running", async () => {
  const screen = createStream("video", "screen-old");
  const harness = makeHarness({ screen });
  await withMediaDevices(
    {
      getSupportedConstraints: () => ({}),
      getUserMedia: async () => {
        throw new DOMException("Permission dismissed", "NotAllowedError");
      },
    },
    () => harness.actions.startCamera(),
  );

  assert.equal(screen.getTracks()[0].stopped, false);
  assert.equal(harness.localScreenStreamRef.current, screen);
  assert.equal(harness.values.isScreenSharing, true);
  assert.equal(harness.localCameraStreamRef.current, null);
  assert.equal(
    harness.sockets.some((event) => event.type === "VOICE_SCREEN_STATE" && !event.screenSharing),
    false,
  );
});

test("a successful screen capture replaces the camera only after capture is ready", async () => {
  const camera = createStream("video", "camera-old");
  const screen = createStream("video", "screen-new");
  const harness = makeHarness();
  let cameraWasRunningWhenPickerCompleted = false;
  const devices = {
    getSupportedConstraints: () => ({}),
    getUserMedia: async () => camera,
    getDisplayMedia: async () => {
      cameraWasRunningWhenPickerCompleted = !camera.getTracks()[0].stopped;
      return screen;
    },
  };
  await withMediaDevices(devices, async () => {
    await harness.actions.startCamera();
    await harness.actions.startScreenShare();
  });

  assert.equal(cameraWasRunningWhenPickerCompleted, true);
  assert.equal(camera.getTracks()[0].stopped, true);
  assert.equal(harness.localCameraStreamRef.current, null);
  assert.equal(harness.localScreenStreamRef.current, screen);
  assert.equal(harness.values.isScreenSharing, true);
  assert.equal(screen.getVideoTracks()[0].onended instanceof Function, true);
  camera.getVideoTracks()[0].onended();
  assert.equal(harness.localScreenStreamRef.current, screen);
  assert.equal(screen.getTracks()[0].stopped, false);
});

test("a successful camera capture replaces the screen only after capture is ready", async () => {
  const screen = createStream("video", "screen-old");
  const camera = createStream("video", "camera-new");
  const harness = makeHarness();
  let screenWasRunningWhenCameraCompleted = false;
  const devices = {
    getDisplayMedia: async () => screen,
    getSupportedConstraints: () => ({}),
    getUserMedia: async () => {
      screenWasRunningWhenCameraCompleted = !screen.getTracks()[0].stopped;
      return camera;
    },
  };
  await withMediaDevices(devices, async () => {
    await harness.actions.startScreenShare();
    await harness.actions.startCamera();
  });

  assert.equal(screenWasRunningWhenCameraCompleted, true);
  assert.equal(screen.getTracks()[0].stopped, true);
  assert.equal(harness.localScreenStreamRef.current, null);
  assert.equal(harness.localCameraStreamRef.current, camera);
  assert.equal(harness.values.isCameraOn, true);
  assert.equal(camera.getVideoTracks()[0].onended instanceof Function, true);
  screen.getVideoTracks()[0].onended();
  assert.equal(harness.localCameraStreamRef.current, camera);
  assert.equal(camera.getTracks()[0].stopped, false);
});

test("leaving voice while the display picker is open stops the candidate stream", async () => {
  const camera = createStream("video", "camera-old");
  const screen = createStream("video", "screen-after-leave");
  const harness = makeHarness({ camera });
  let resolveCapture;
  const picker = new Promise((resolve) => {
    resolveCapture = resolve;
  });
  const capture = withMediaDevices({ getDisplayMedia: () => picker }, () => harness.actions.startScreenShare());
  await Promise.resolve();
  harness.voiceChannelRef.current = null;
  resolveCapture(screen);
  await capture;

  assert.equal(screen.getTracks()[0].stopped, true);
  assert.equal(harness.localCameraStreamRef.current, camera);
  assert.equal(camera.getTracks()[0].stopped, false);
  assert.equal(harness.localScreenStreamRef.current, null);
  assert.equal(harness.values.isScreenSharing, false);
});

test("camera and screen prompts cannot race each other", async () => {
  const screenHarness = makeHarness();
  const screen = createStream("video", "screen-prompt");
  let finishScreenPicker;
  let screenPickerStarted;
  const screenPickerReady = new Promise((resolve) => {
    screenPickerStarted = resolve;
  });
  const screenPicker = new Promise((resolve) => {
    finishScreenPicker = resolve;
  });
  let cameraRequestsDuringScreenPrompt = 0;
  const screenPromptTask = withMediaDevices(
    {
      getDisplayMedia: () => {
        screenPickerStarted();
        return screenPicker;
      },
      getSupportedConstraints: () => ({}),
      getUserMedia: async () => {
        cameraRequestsDuringScreenPrompt++;
        return createStream("video", "unexpected-camera");
      },
    },
    () => screenHarness.actions.startScreenShare(),
  );
  await screenPickerReady;
  await screenHarness.actions.startCamera();
  assert.equal(cameraRequestsDuringScreenPrompt, 0);
  finishScreenPicker(screen);
  await screenPromptTask;

  const cameraHarness = makeHarness();
  const camera = createStream("video", "camera-prompt");
  let finishCameraPicker;
  let cameraPickerStarted;
  const cameraPickerReady = new Promise((resolve) => {
    cameraPickerStarted = resolve;
  });
  const cameraPicker = new Promise((resolve) => {
    finishCameraPicker = resolve;
  });
  let displayRequestsDuringCameraPrompt = 0;
  const cameraPromptTask = withMediaDevices(
    {
      getDisplayMedia: async () => {
        displayRequestsDuringCameraPrompt++;
        return createStream("video", "unexpected-screen");
      },
      getSupportedConstraints: () => ({}),
      getUserMedia: () => {
        cameraPickerStarted();
        return cameraPicker;
      },
    },
    () => cameraHarness.actions.startCamera(),
  );
  await cameraPickerReady;
  await cameraHarness.actions.startScreenShare();
  assert.equal(displayRequestsDuringCameraPrompt, 0);
  finishCameraPicker(camera);
  await cameraPromptTask;
});
