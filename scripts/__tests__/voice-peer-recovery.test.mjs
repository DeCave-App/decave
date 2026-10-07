import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./app-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = readAppSource();
const directCall = fs.readFileSync(path.join(root, "src/components/DirectCallOverlay.tsx"), "utf8");
const electronMain = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");

test("voice peers use bounded ICE recovery instead of requiring a channel rejoin", () => {
  assert.match(app, /session\.restartAttempts >= 3/);
  assert.match(app, /pc\.restartIce\(\)/);
  assert.match(app, /pc\.connectionState === "disconnected"/);
  assert.match(app, /pc\.iceConnectionState === "failed"/);
  assert.match(app, /window\.setTimeout\(\(\) => ensurePeer\(live\), 750\)/);
});

test("voice peers queue trickle ICE until the remote description is installed", () => {
  assert.match(app, /pendingIceCandidates: RTCIceCandidateInit\[\]/);
  assert.match(app, /remoteDescriptionPending: boolean/);
  assert.match(app, /session\.remoteDescriptionPending = true/);
  assert.match(app, /if \(!session\.pc\.remoteDescription \|\| session\.remoteDescriptionPending\) \{/);
  assert.match(app, /session\.pendingIceCandidates\.length >= 128/);
  assert.match(app, /session\.pendingIceCandidates\.push\(candidate\)/);
  assert.match(
    app,
    /await pc\.setRemoteDescription\(\s*withVoiceOpusBitrate\(description, voiceBitrateForListeners\(peerSessionsRef\.current\.size\)\),?\s*\)/,
  );
  assert.match(app, /const queuedCandidates = session\.pendingIceCandidates\.splice\(0\)/);
  assert.match(app, /await pc\.addIceCandidate\(queuedCandidate\)/);
});

test("voice peers serialize signaling and rebuild a connected peer with no inbound audio", () => {
  assert.match(app, /signalingQueue: Promise<void>/);
  assert.match(app, /const enqueuePeerSignaling =/);
  assert.match(app, /session\.signalingQueue\.then\(guardedOperation, guardedOperation\)/);
  assert.match(app, /remoteAudioTrackAttached: boolean/);
  assert.match(app, /session\.remoteAudioTrackAttached = true/);
  assert.match(app, /connected peer has no inbound voice track/);
});

test("voice state refreshes recreate missing peer sessions", () => {
  assert.match(app, /const ensureVoicePeersFromState = \(participants: VoiceParticipant\[\]\)/);
  assert.match(app, /ensureVoicePeersFromState\(participants\)/);
  assert.match(app, /ensureVoicePeersFromState\(\[participant\]\)/);
  assert.match(
    app,
    /participant\.connectionId === selfConnectionId \|\| participant\.channelId !== voiceChannelRef\.current/,
  );
});

test("stalled remote audio and suspended playback are resumed", () => {
  assert.match(app, /event\.track\.onmute/);
  assert.match(app, /event\.track\.onunmute = \(\) => resumeRemoteAudio\(\)/);
  assert.match(app, /amplified\.context\.resume\(\)/);
  assert.match(app, /audio\.play\(\)/);
  assert.match(app, /recoverVoiceMediaIfNeeded/);
  assert.match(app, /forcePeerRebuild/);
  assert.match(app, /inbound audio RTP remained stalled/);
  assert.match(app, /session\.resumeAudio\(\)/);
});

test("desktop backgrounding cannot freeze the real microphone path closed", () => {
  assert.match(electronMain, /backgroundThrottling:\s*false/);
  assert.doesNotMatch(app, /activeGate\.gain\.setTargetAtTime/);
  assert.match(app, /microphone source remained muted/);
  assert.match(app, /processed microphone track ended/);
  assert.match(app, /audio context stayed suspended/);
});

test("microphone recovery reuses the dedicated sender and preserves every mute mode", () => {
  assert.match(app, /microphoneSender: RTCRtpSender \| null/);
  assert.match(app, /await sender\.replaceTrack\(newTrack\)/);
  assert.match(app, /session\.microphoneSender = sender/);
  assert.match(app, /non-screen audio sender instead of adding a second microphone sender/);
  assert.match(app, /audioSettingsRef\.current\.pushToTalk && !pushToTalkHeldRef\.current/);
  assert.match(app, /processedTrack\.enabled = microphoneShouldBeEnabled\(\)/);
  assert.match(app, /window\.addEventListener\("blur", release\)/);
});

test("Voice & Audio opens a real live microphone preview", () => {
  assert.match(app, /if \(!showSettings \|\| settingsWindow\.settingsTab !== "voice"\) return/);
  assert.match(app, /await buildMicrophonePipeline\(audioSettingsRef\.current\)/);
  assert.match(app, /setMicrophoneCaptureLabel\(raw\.getAudioTracks\(\)\[0\]\?\.label/);
  assert.doesNotMatch(app, /micTestActive \? "Mic test live" : "Microphone ready"/);
});

test("local voice processors never leak raw audio during startup or processor failure", () => {
  assert.match(app, /getSettings\(\)\.channelCount/);
  assert.match(app, /maxChannels: sourceChannelCount/);
  assert.match(app, /rnnoise\.onprocessorerror/);
  assert.match(app, /aiNoiseProcessorReadyRef/);
  assert.match(app, /analyser\.connect\(voiceActivation, 0, 1\)/);
  assert.match(app, /processedTail\.connect\(voiceActivation, 0, 0\)/);
  assert.match(app, /rawAnalyser\.disconnect\(gate, 0, 0\)/);
  assert.match(app, /meaningfulRawInput = db >= -68 && rms >= 0\.00035/);
  assert.match(app, /workletOutputDead = processedRms <= 0\.000001/);
  assert.match(app, /now - aiNoiseSilentSinceRef\.current >= 2_500/);
  assert.doesNotMatch(app, /processedDb <= -76/);
  assert.doesNotMatch(app, /processedDb <= db - 20/);
  assert.match(app, /processedInvalid/);
  assert.match(app, /bypassAiNoiseProcessorNow\(\)/);
  assert.doesNotMatch(app, /rawAnalyser\.connect\(gate\)/);
  assert.match(app, /processed\/silent path attached to the gate/);
  assert.match(app, /micProcessingKeepAliveNodeRef/);
  assert.match(app, /processingKeepAlive\.connect\(context\.destination\)/);
  assert.doesNotMatch(app, /noiseSuppression: fallbackMode/);
  assert.doesNotMatch(app, /enabled automatically/);
  assert.match(app, /so Standard is being used/);
  assert.match(app, /browser processing is being used/);
});

test("voice activation threshold controls the outgoing audio-thread track", () => {
  assert.match(app, /VoiceActivationProcessor\.worklet\.ts\?worker&url/);
  assert.match(app, /new AudioWorkletNode\(context, "decave-voice-activation"/);
  assert.match(app, /thresholdDb: settings\.sensitivityMode === "auto"/);
  assert.match(app, /enabled: !settings\.pushToTalk/);
  assert.match(app, /voiceActivation\.connect\(destination\)/);
  assert.match(app, /Voice activation worklet failed; bypassing it so the microphone stays live/);
});

test("DeCave AI applies rumble filtering without a post-denoise compressor", () => {
  assert.match(app, /new BiquadFilterNode\(context, \{[\s\S]*?type: "highpass"[\s\S]*?frequency: 75/);
  assert.match(
    app,
    /(?:const|let) highpass(?:\s*:\s*BiquadFilterNode \| null)?\s*=\s*effectiveMode === "ai"|highpass =\s*effectiveMode === "ai"/,
  );
  assert.match(app, /(?:const processedTail =|processedTail =) customProcessor \? tail : null/);
  assert.doesNotMatch(app, /new DynamicsCompressorNode\(context/);
  assert.doesNotMatch(app, /tail\.connect\(voiceCompressor\)/);
});

test("Standard uses the shared local worklet with a safe fallback", () => {
  assert.match(app, /clearVoiceWorkletPath/);
  assert.match(app, /ensureAudioContext\(false, true\)/);
  assert.match(app, /new AudioWorkletNode\(context, "decave-clearvoice"/);
  assert.match(app, /processorOptions: \{ mode: effectiveMode \}/);
  assert.match(app, /effectiveMode === "standard" \|\| effectiveMode === "strong"/);
  assert.match(app, /ClearVoice audio worklet failed/);
  assert.match(app, /let clearVoice: AudioWorkletNode \| null = null/);
});

test("direct calls use the shared processed microphone and preserve sender identity on rebuild", () => {
  assert.match(app, /acquireDirectCallMicrophone/);
  assert.match(app, /acquireMicrophone=\{acquireDirectCallMicrophone\}/);
  assert.match(app, /directMicrophoneLeaseCountRef/);
  assert.match(app, /directMicrophoneListenersRef/);
  assert.match(directCall, /acquireMicrophone: \(\) => Promise<DirectCallMicrophoneLease>/);
  assert.match(directCall, /microphoneLease = await acquireMicrophone\(\)/);
  assert.match(directCall, /sender\.replaceTrack\(nextAudioTrack\)/);
  assert.match(directCall, /senderUsesProcessedTrack: sender\.track\?\.id === nextAudioTrack\.id/);
  assert.doesNotMatch(directCall, /audio: \{ echoCancellation: true, noiseSuppression: true, autoGainControl: true \}/);
});

test("local processing does not stack browser noise suppression or automatic gain control", () => {
  assert.match(app, /noiseSuppression: browserFallback/);
  assert.match(app, /autoGainControl: \(browserFallback \|\| effectiveMode === "off"\) && settings\.autoGainControl/);
  assert.match(app, /desktopCustomCaptureCompensation/);
  assert.match(app, /\? 1\.5\s*:\s*1/);
  assert.match(app, /requestedMode/);
  assert.match(app, /activeMode/);
  assert.match(app, /rawTrackId/);
  assert.match(app, /processedTrackId/);
  assert.match(app, /senderUsesProcessedTrack/);
  assert.match(app, /setActiveNoiseSuppressionMode\("off"\)/);
});

test("voice channel exposes a direct noise-suppression mode switch", () => {
  assert.match(app, /const cycleNoiseSuppression = \(\) =>/);
  assert.match(app, /const modes: NoiseSuppressionMode\[\] = \["off", "strong", "ai"\]/);
  assert.match(app, /\["strong", "Standard", "ClearVoice"/);
  assert.match(app, /\[\s*"ai",\s*"DeCave ClearVoice",\s*"Noise Suppression by DeCave"/);
  assert.doesNotMatch(app, /\["standard", "Standard"/);
  assert.doesNotMatch(app, /Active path:/);
  assert.doesNotMatch(app, /ClearVoice DSP/);
  assert.match(app, /className=\{`voice-channel-icon-button voice-noise-button/);
  assert.match(app, /voice-noise-mode-badge/);
  assert.match(app, /onClick=\{cycleNoiseSuppression\}/);
  assert.match(app, /Noise suppression: \$\{noiseSuppressionLabel\(activeNoiseSuppressionMode\)\}/);
});
