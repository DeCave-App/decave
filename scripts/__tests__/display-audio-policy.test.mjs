import assert from "node:assert/strict";
import test from "node:test";
import {
  discardUnapprovedDisplayAudio,
  displayAudioExcludesOwnPlayback,
} from "../../src/voice/display-audio-policy.ts";
import { readAppSource } from "./app-source.mjs";

test("unexpected capture audio is stopped and removed before protected transport", () => {
  const stopped = [];
  const removed = [];
  const tracks = [0, 1].map((id) => ({ stop: () => stopped.push(id) }));
  discardUnapprovedDisplayAudio({ getAudioTracks: () => tracks, removeTrack: (track) => removed.push(track) }, false);
  assert.deepEqual(stopped, [0, 1]);
  assert.deepEqual(removed, tracks);
  const app = readAppSource();
  const capture = app.indexOf("const screen = await navigator.mediaDevices.getDisplayMedia");
  const discard = app.indexOf("discardUnapprovedDisplayAudio(screen, captureSystemAudio)", capture);
  const publish = app.indexOf("localScreenStreamRef.current = screen", capture);
  assert(capture >= 0 && discard > capture && publish > discard);
});

test("explicit legacy system audio is preserved for its own capture checks", () => {
  discardUnapprovedDisplayAudio(
    {
      getAudioTracks: () => {
        throw new Error("must not touch permitted audio");
      },
      removeTrack: () => {},
    },
    true,
  );
});

test("system audio is only kept when the capture device excludes DeCave playback", () => {
  // Measured on Electron 43.4 / Windows 11: restrictOwnAudio opens this device.
  assert.equal(displayAudioExcludesOwnPlayback({ deviceId: "loopbackWithoutChrome", restrictOwnAudio: true }), true);
  // Windows 10 has no process loopback; Chromium falls back to the whole mix
  // even when the restriction was requested, so the reported flag is not trusted.
  assert.equal(displayAudioExcludesOwnPlayback({ deviceId: "loopback", restrictOwnAudio: true }), false);
  assert.equal(displayAudioExcludesOwnPlayback({ deviceId: "loopbackWithMute", restrictOwnAudio: true }), false);
  assert.equal(displayAudioExcludesOwnPlayback({ deviceId: "loopbackAllDevices" }), false);
  // Browser tab/window audio reports its own ids; fall back to the applied setting.
  assert.equal(displayAudioExcludesOwnPlayback({ deviceId: "tab-audio", suppressLocalAudioPlayback: true }), true);
  assert.equal(displayAudioExcludesOwnPlayback({ deviceId: "tab-audio" }), false);
  assert.equal(displayAudioExcludesOwnPlayback({}), false);
});
