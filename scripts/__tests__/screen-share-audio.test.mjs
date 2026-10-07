import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./app-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = readAppSource();
const electronMain = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
const electronPreload = fs.readFileSync(path.join(root, "electron/preload.cjs"), "utf8");

test("ordinary screen audio stays attached to the screen stream", () => {
  assert.match(
    app,
    /if \(\s*incomingStream\.getVideoTracks\(\)\.length > 0 &&\s*liveParticipant\.screenSharing === true/,
  );
  assert.match(app, /const incomingStream = event\.streams\[0\]/);
  assert.match(app, /setRemoteScreens/);
  assert.match(app, /const videoStream = event\.streams\[0\]/);
});

test("a screen-sharing participant's separate microphone remains voice audio", () => {
  assert.doesNotMatch(
    app,
    /liveParticipant\.screenSharing === true \|\| incomingStream\.getVideoTracks\(\)\.length > 0/,
  );
  assert.match(app, /participant-wide screenSharing flag/);
  assert.match(app, /stream: incomingStream/);
});

test("late display video demuxes only its associated system-audio track", () => {
  assert.match(app, /displayAudioTrackIds/);
  assert.match(app, /session\.remoteAudioStream\.removeTrack\(audioTrack\)/);
  assert.match(app, /The\s+\/\/ separate microphone stream remains attached and audible/);
});

test("muting a screen player never silences that person's microphone", () => {
  assert.match(app, /setScreenPlaybackMuted/);
  assert.match(app, /onMutedChange=\{\(muted\) => setScreenPlaybackMuted\(/);
  // The stream mute used to be folded into the voice element's mute and was
  // never cleared when the stream ended, leaving the person inaudible.
  assert.doesNotMatch(app, /screenAudioMutedRef/);
  assert.doesNotMatch(app, /screenAudioMuted\w*(\.current)?\[participant\.connectionId\]/);
  assert.match(app, /onVolumeChange=\{\(event\) => onMutedChange\?\.\(event\.currentTarget\.muted\)\}/);
});

test("system audio is only captured when the user opts in", () => {
  assert.match(app, /const captureSystemAudio = shareSystemAudio;/);
  assert.match(app, /audio: captureSystemAudio \? systemAudioConstraints : false/);
  assert.match(app, /echoCancellation: false/);
  assert.match(app, /audioTrack\.contentHint = "music"/);
});

test("desktop loopback excludes DeCave voice playback from the outgoing share", () => {
  assert.match(app, /restrictOwnAudio: true/);
  // The opened capture device is the proof, not the Electron version.
  assert.match(app, /!displayAudioExcludesOwnPlayback\(audioTrack\.getSettings\(\)\)/);
  assert.doesNotMatch(app, /desktopOwnAudioRestriction/);
  assert.doesNotMatch(electronMain, /supportsRestrictedScreenAudio/);
  assert.doesNotMatch(electronPreload, /getScreenShareAudioSupport/);
  assert.match(electronMain, /audio: "loopback"/);
  assert.match(app, /screen\.removeTrack\(audioTrack\)/);
  assert.match(app, /audioTrack\.stop\(\)/);
  assert.match(app, /started without system audio: this device cannot keep DeCave voices out/);
});

test("screen cards measure video RTP with timestamped byte deltas", () => {
  assert.match(app, /report\.type !== "inbound-rtp"/);
  assert.match(app, /inbound\.kind !== "video" && inbound\.mediaType !== "video"/);
  assert.match(app, /const deltaBytes = bytesReceived - previous\.bytesReceived/);
  assert.match(app, /const deltaSeconds = \(timestamp - previous\.timestamp\) \/ 1000/);
  assert.match(app, /bitrateKbps = Math\.round\(\(deltaBytes \* 8\) \/ deltaSeconds \/ 1000\)/);
  assert.match(app, /bitrateKbps >= 1000/);
});

test("screen profiles share capture and sender limits while prioritizing frame cadence", () => {
  assert.match(app, /"1440p60": \{ width: 2560, height: 1440, fps: 60, maxBitrate: 28_000_000 \}/);
  assert.match(app, /const target = SCREEN_SHARE_PROFILES\[quality\]/);
  assert.match(app, /parameters\.encodings\[0\]\.maxBitrate = target\.maxBitrate/);
  assert.match(app, /parameters\.encodings\[0\]\.maxFramerate = target\.fps/);
  assert.match(app, /degradationPreference = "maintain-framerate"/);
  assert.match(app, /videoTrack\.contentHint = "motion"/);
});
