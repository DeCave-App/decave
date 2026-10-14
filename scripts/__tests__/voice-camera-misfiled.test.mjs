// A camera whose video track arrives before the sender's cameraSharing flag is
// filed as a screen share. The VOICE_STATE that then says "camera on, screen
// off" must move it to cameras, not delete it (phone cameras never showed on
// web and desktop because of this).
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
globalThis.window ??= {
  location: { origin: "https://app.example.test", protocol: "https:", host: "app.example.test" },
};
const { handleVoiceEvent, misfiledCameras } = await import("../../src/realtime/events/voice.ts");

const stream = { id: "phone-camera" };
const misfiled = { b: { connectionId: "b", username: "phone", stream } };

test("misfiledCameras picks screens whose sender shares a camera and no screen", () => {
  assert.deepEqual(
    misfiledCameras(misfiled, [{ connectionId: "b", cameraSharing: true, screenSharing: false }]),
    misfiled,
  );
  assert.deepEqual(misfiledCameras(misfiled, [{ connectionId: "b", cameraSharing: true, screenSharing: true }]), {});
  assert.deepEqual(misfiledCameras(misfiled, [{ connectionId: "b", cameraSharing: false, screenSharing: false }]), {});
  assert.deepEqual(misfiledCameras({}, [{ connectionId: "b", cameraSharing: true }]), {});
});

function voiceStateRun(screens, cameras, participants) {
  const state = { screens, cameras };
  const context = new Proxy(
    {
      remoteScreensRef: { current: screens },
      screenSfu: undefined,
      screenSfuViewer: undefined,
      setRemoteScreens: (update) => (state.screens = update(state.screens)),
      setRemoteCameras: (update) => (state.cameras = update(state.cameras)),
    },
    { get: (target, key) => (key in target ? target[key] : () => undefined) },
  );
  assert.equal(handleVoiceEvent({ type: "VOICE_STATE", participants }, context), true);
  return state;
}

test("VOICE_STATE moves a camera that was filed as a screen share", () => {
  const state = voiceStateRun(misfiled, {}, [
    { connectionId: "b", userId: "u", username: "phone", cameraSharing: true, screenSharing: false },
  ]);
  assert.deepEqual(state.screens, {});
  assert.equal(state.cameras.b?.stream, stream);
});

test("VOICE_STATE still drops screens and cameras that stopped", () => {
  const state = voiceStateRun(misfiled, { c: { connectionId: "c", username: "x", stream: {} } }, [
    { connectionId: "b", userId: "u", username: "phone", cameraSharing: false, screenSharing: false },
    { connectionId: "c", userId: "v", username: "x", cameraSharing: false, screenSharing: false },
  ]);
  assert.deepEqual(state.screens, {});
  assert.deepEqual(state.cameras, {});
});

test("a real screen share stays a screen share", () => {
  const state = voiceStateRun(misfiled, {}, [
    { connectionId: "b", userId: "u", username: "phone", cameraSharing: false, screenSharing: true },
  ]);
  assert.equal(state.screens.b?.stream, stream);
  assert.deepEqual(state.cameras, {});
});
