// Voice engine: microphone capture and processing (ClearVoice, RNNoise, the
// voice gate), the input meter, peer connections and signaling, joining and
// leaving voice, and screen-share senders.
//
// It is created once per app. Everything here reads React state only through
// refs and changes it through state setters, so it behaves the same no matter
// which render created it; App passes those refs and setters in.

import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import {
  applyVoiceCodecPreferences,
  applyVoiceSenderParameters,
  voiceBitrateForListeners,
  withVoiceOpusBitrate,
} from "./voice-transport";
import { hasRelayIceServer, isRelayIceCandidate, RELAY_UNAVAILABLE_MESSAGE } from "./relay-policy";
import { inputMeterLevelDb } from "./input-meter";
import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWasmSimdPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import clearVoiceWorkletPath from "../audio/clearvoice/ClearVoiceProcessor.worklet.ts?worker&url";
import voiceActivationWorkletPath from "../audio/clearvoice/VoiceActivationProcessor.worklet.ts?worker&url";
import { createClearVoiceAiRuntime, type ClearVoiceAiRuntime } from "../audio/clearvoice/ClearVoiceAiRuntime";
import type { VoiceActivationGateMetrics } from "../audio/clearvoice/VoiceActivationGate";
import type { ExtraSettings } from "../features/settings";
import {
  createAbortError,
  DESKTOP_VOICE_JOIN_TIMEOUT_MS,
  DESKTOP_VOICE_PRE_JOIN_DEADLINE_MS,
  isAbortError,
  isCurrentGeneration,
} from "./desktop-voice-reliability";
import type {
  Server,
  VoiceParticipant,
  UserContextMenuState,
  PeerSession,
  RemoteScreen,
  NoiseSuppressionMode,
  DirectCallMicrophoneLease,
  ScreenQuality,
  SoundboardSound,
  AudioSettings,
  SinkableAudioElement,
  VoiceJoinAttempt,
} from "../app/types";
import { AUDIO_SETTINGS_KEY } from "../app/settings-storage";
import { SCREEN_SHARE_PROFILES, microphoneErrorMessage } from "../app/voice";
import { clamp } from "../app/format";
import { hasDesktopActivityBridge } from "../app/desktop";
import { callDescriptionAuth, checkCallDescription, clearCallVerdict } from "../e2ee/call-verification";

export type VoiceEngineDeps = {
  extraSettingsRef: MutableRefObject<ExtraSettings>;
  setSoundboardNotice: Dispatch<SetStateAction<string>>;
  myUserIdRef: MutableRefObject<string | undefined>;
  setUserContextMenu: Dispatch<SetStateAction<UserContextMenuState | null>>;
  setVoiceParticipants: Dispatch<SetStateAction<VoiceParticipant[]>>;
  setVoiceChannelId: Dispatch<SetStateAction<number | null>>;
  setVoiceStatus: Dispatch<SetStateAction<string>>;
  setVoiceError: Dispatch<SetStateAction<string>>;
  setIsServerMuted: Dispatch<SetStateAction<boolean>>;
  setIsServerDeafened: Dispatch<SetStateAction<boolean>>;
  setIsScreenSharing: Dispatch<SetStateAction<boolean>>;
  setIsCameraOn: Dispatch<SetStateAction<boolean>>;
  setLocalScreenStream: Dispatch<SetStateAction<MediaStream | null>>;
  setLocalCameraStream: Dispatch<SetStateAction<MediaStream | null>>;
  setRemoteScreens: Dispatch<SetStateAction<Record<string, RemoteScreen>>>;
  setScreenAudioMuted: Dispatch<SetStateAction<Record<string, boolean>>>;
  setRemoteCameras: Dispatch<SetStateAction<Record<string, RemoteScreen>>>;
  setAudioSettings: Dispatch<SetStateAction<AudioSettings>>;
  setVoiceUserVolumes: Dispatch<SetStateAction<Record<string, number>>>;
  setAudioInputs: Dispatch<SetStateAction<MediaDeviceInfo[]>>;
  setAudioOutputs: Dispatch<SetStateAction<MediaDeviceInfo[]>>;
  setMicLevelDb: Dispatch<SetStateAction<number>>;
  setAutoSensitivityDb: Dispatch<SetStateAction<number>>;
  setMicTestActive: Dispatch<SetStateAction<boolean>>;
  setMicrophoneCaptureState: Dispatch<SetStateAction<"idle" | "starting" | "ready" | "error">>;
  setMicrophoneCaptureLabel: Dispatch<SetStateAction<string>>;
  setAudioSettingsError: Dispatch<SetStateAction<string>>;
  setAudioSettingsNotice: Dispatch<SetStateAction<string>>;
  setAudioOutputError: Dispatch<SetStateAction<string>>;
  setVoiceActivationMetrics: Dispatch<SetStateAction<Partial<VoiceActivationGateMetrics> | null>>;
  setActiveNoiseSuppressionMode: Dispatch<SetStateAction<NoiseSuppressionMode>>;
  socketRef: MutableRefObject<WebSocket | null>;
  voiceReconnectChannelRef: MutableRefObject<number | null>;
  voiceServerIdRef: MutableRefObject<number | null>;
  voiceJoinAttemptRef: MutableRefObject<VoiceJoinAttempt | null>;
  voiceJoinStartedAtRef: MutableRefObject<number | null>;
  activeServerRef: MutableRefObject<number>;
  serversRef: MutableRefObject<Server[]>;
  selfConnectionIdRef: MutableRefObject<string>;
  voiceChannelRef: MutableRefObject<number | null>;
  voiceParticipantsRef: MutableRefObject<VoiceParticipant[]>;
  localMicStreamRef: MutableRefObject<MediaStream | null>;
  rawMicStreamRef: MutableRefObject<MediaStream | null>;
  directMicrophoneLeaseCountRef: MutableRefObject<number>;
  audioContextRef: MutableRefObject<AudioContext | null>;
  clearVoiceNodeRef: MutableRefObject<AudioWorkletNode | null>;
  inputGainNodeRef: MutableRefObject<GainNode | null>;
  voiceActivationNodeRef: MutableRefObject<AudioWorkletNode | null>;
  autoSensitivityDbRef: MutableRefObject<number>;
  micLevelDbRef: MutableRefObject<number>;
  micVoiceActivationAudibleRef: MutableRefObject<boolean>;
  voiceActivationMetricsRef: MutableRefObject<Partial<VoiceActivationGateMetrics> | null>;
  micTrackIdRef: MutableRefObject<string>;
  microphoneBuildSerialRef: MutableRefObject<number>;
  microphoneMutedSinceRef: MutableRefObject<number | null>;
  requestMicrophoneRecoveryRef: MutableRefObject<(reason: string) => void>;
  requestAiNoiseFallbackRef: MutableRefObject<(reason: string) => void>;
  micTestAudioRef: MutableRefObject<SinkableAudioElement | null>;
  micTestActiveRef: MutableRefObject<boolean>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  voiceUserVolumesRef: MutableRefObject<Record<string, number>>;
  isMutedRef: MutableRefObject<boolean>;
  isServerMutedRef: MutableRefObject<boolean>;
  isServerDeafenedRef: MutableRefObject<boolean>;
  localScreenStreamRef: MutableRefObject<MediaStream | null>;
  localCameraStreamRef: MutableRefObject<MediaStream | null>;
  screenQualityRef: MutableRefObject<ScreenQuality>;
  peerSessionsRef: MutableRefObject<Map<string, PeerSession>>;
  remoteAudioElementsRef: MutableRefObject<Map<string, HTMLAudioElement>>;
  remoteGainContextsRef: MutableRefObject<
    Map<
      string,
      {
        context: AudioContext;
        gain: GainNode;
        source: MediaStreamAudioSourceNode;
        trackId: string;
        destination: MediaStreamAudioDestinationNode;
      }
    >
  >;
  locallyMutedUsersRef: MutableRefObject<Set<string>>;
  pushToTalkHeldRef: MutableRefObject<boolean>;
  isDeafenedRef: MutableRefObject<boolean>;
  iceServersRef: MutableRefObject<RTCIceServer[]>;
  sendSocket: (payload: unknown) => boolean;
  loadIceServers: () => Promise<RTCIceServer[]>;
};

const ref = <T>(current: T): { current: T } => ({ current });

export function createVoiceEngine(deps: VoiceEngineDeps) {
  const {
    extraSettingsRef,
    setSoundboardNotice,
    myUserIdRef,
    setUserContextMenu,
    setVoiceParticipants,
    setVoiceChannelId,
    setVoiceStatus,
    setVoiceError,
    setIsServerMuted,
    setIsServerDeafened,
    setIsScreenSharing,
    setIsCameraOn,
    setLocalScreenStream,
    setLocalCameraStream,
    setRemoteScreens,
    setScreenAudioMuted,
    setRemoteCameras,
    setAudioSettings,
    setVoiceUserVolumes,
    setAudioInputs,
    setAudioOutputs,
    setMicLevelDb,
    setAutoSensitivityDb,
    setMicTestActive,
    setMicrophoneCaptureState,
    setMicrophoneCaptureLabel,
    setAudioSettingsError,
    setAudioSettingsNotice,
    setAudioOutputError,
    setVoiceActivationMetrics,
    setActiveNoiseSuppressionMode,
    socketRef,
    voiceReconnectChannelRef,
    voiceServerIdRef,
    voiceJoinAttemptRef,
    voiceJoinStartedAtRef,
    activeServerRef,
    serversRef,
    selfConnectionIdRef,
    voiceChannelRef,
    voiceParticipantsRef,
    localMicStreamRef,
    rawMicStreamRef,
    directMicrophoneLeaseCountRef,
    audioContextRef,
    clearVoiceNodeRef,
    inputGainNodeRef,
    voiceActivationNodeRef,
    autoSensitivityDbRef,
    micLevelDbRef,
    micVoiceActivationAudibleRef,
    voiceActivationMetricsRef,
    micTrackIdRef,
    microphoneBuildSerialRef,
    microphoneMutedSinceRef,
    requestMicrophoneRecoveryRef,
    requestAiNoiseFallbackRef,
    micTestAudioRef,
    micTestActiveRef,
    audioSettingsRef,
    voiceUserVolumesRef,
    isMutedRef,
    isServerMutedRef,
    isServerDeafenedRef,
    localScreenStreamRef,
    localCameraStreamRef,
    screenQualityRef,
    peerSessionsRef,
    remoteAudioElementsRef,
    remoteGainContextsRef,
    locallyMutedUsersRef,
    pushToTalkHeldRef,
    isDeafenedRef,
    iceServersRef,
    sendSocket,
    loadIceServers,
  } = deps;

  const voiceJoinGenerationRef = ref(0);

  const directMicrophoneListenersRef = ref(new Set<(stream: MediaStream) => Promise<void> | void>());

  const micSourceNodeRef = ref<MediaStreamAudioSourceNode | null>(null);

  const rnnoiseNodeRef = ref<RnnoiseWorkletNode | null>(null);

  const clearVoiceAiRuntimeRef = ref<ClearVoiceAiRuntime | null>(null);

  const clearVoiceAiNodeRef = ref<AudioWorkletNode | null>(null);

  const micHighpassNodeRef = ref<BiquadFilterNode | null>(null);

  const micAnalyserNodeRef = ref<AnalyserNode | null>(null);

  const micProcessedAnalyserNodeRef = ref<AnalyserNode | null>(null);

  const micProcessedTailNodeRef = ref<AudioNode | null>(null);

  const micDestinationNodeRef = ref<MediaStreamAudioDestinationNode | null>(null);

  const micProcessingKeepAliveNodeRef = ref<GainNode | null>(null);

  const rnnoiseBinaryRef = ref<ArrayBuffer | null>(null);

  const rnnoiseModuleLoadedRef = ref(false);

  const clearVoiceModuleLoadedRef = ref(false);

  const voiceActivationModuleLoadedRef = ref(false);

  const micMeterFrameRef = ref<number | null>(null);

  const meterLastUiRef = ref(0);

  const autoSensitivityUiRef = ref(0);

  const voiceActivationMetricsUiAtRef = ref(0);

  const microphoneRecoveryBusyRef = ref(false);

  const aiNoiseSilentSinceRef = ref<number | null>(null);

  const aiNoiseFallbackBusyRef = ref(false);

  const aiNoiseBypassedRef = ref(false);

  const aiNoiseProcessorReadyRef = ref(false);

  const microphoneShouldBeEnabled = () =>
    !(
      isMutedRef.current ||
      isDeafenedRef.current ||
      isServerMutedRef.current ||
      isServerDeafenedRef.current ||
      (audioSettingsRef.current.pushToTalk && !pushToTalkHeldRef.current)
    );

  const applyMicrophoneEnabledState = () => {
    const enabled = microphoneShouldBeEnabled();
    for (const track of localMicStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
    return enabled;
  };

  /** Settings → Voice → Per-person volume: back to 100% (all when no id). */
  const resetVoiceUserVolumes = (userId?: string) => {
    const next = userId ? { ...voiceUserVolumesRef.current } : {};
    if (userId) delete next[userId];
    voiceUserVolumesRef.current = next;
    setVoiceUserVolumes(next);
    for (const participant of voiceParticipantsRef.current) {
      if (!userId || participant.userId === userId) applyVoiceUserVolume(participant);
    }
  };

  /** Effective playback volume: the person's own volume scaled by Settings → Voice → Output volume. */
  const getVoiceUserVolume = (userId: string): number =>
    clamp(((voiceUserVolumesRef.current[userId] ?? 100) * extraSettingsRef.current.outputVolume) / 100, 0, 200);

  /** Push the current volumes to a live participant's audio element (no state change). */
  const applyVoiceUserVolume = (participant: VoiceParticipant) => {
    const nextVolume = getVoiceUserVolume(participant.userId);
    const audio = remoteAudioElementsRef.current.get(participant.connectionId);
    const amplified = remoteGainContextsRef.current.get(participant.connectionId);
    if ((nextVolume > 100 && !amplified) || (amplified && amplified.context.state !== "running")) {
      peerSessionsRef.current.get(participant.connectionId)?.resumeAudio();
      return;
    }
    if (!audio) return;
    if (amplified) {
      amplified.gain.gain.value = nextVolume / 100;
      audio.volume = 1;
    } else {
      audio.volume = Math.min(1, nextVolume / 100);
    }
  };

  const changeVoiceUserVolume = (participant: VoiceParticipant, volume: number) => {
    const storedVolume = clamp(volume, 0, 200);
    const next = {
      ...voiceUserVolumesRef.current,
      [participant.userId]: storedVolume,
    };
    voiceUserVolumesRef.current = next;
    setVoiceUserVolumes(next);
    const nextVolume = getVoiceUserVolume(participant.userId);

    const audio = remoteAudioElementsRef.current.get(participant.connectionId);
    const amplified = remoteGainContextsRef.current.get(participant.connectionId);
    // Keep normal per-user changes local to this element. Re-entering the
    // complete resume path for every slider tick can rebuild a MediaStream
    // graph while other participants are playing, which makes Chromium drop
    // the shared voice output on some devices.
    if ((nextVolume > 100 && !amplified) || (amplified && amplified.context.state !== "running")) {
      peerSessionsRef.current.get(participant.connectionId)?.resumeAudio();
      return;
    }
    if (!audio) return;
    if (amplified) {
      amplified.gain.gain.value = nextVolume / 100;
      audio.volume = 1;
    } else {
      audio.volume = Math.min(1, nextVolume / 100);
    }
    audio.muted =
      isDeafenedRef.current || isServerDeafenedRef.current || locallyMutedUsersRef.current.has(participant.userId);
    if (!audio.muted) void audio.play().catch(() => {});
  };

  const moderateVoiceUser = (
    participant: VoiceParticipant,
    action: "kick" | "mute" | "unmute" | "deafen" | "undeafen",
  ) => {
    sendSocket({ type: "VOICE_MODERATE", targetConnectionId: participant.connectionId, action });
    setUserContextMenu(null);
  };

  // Only the stream player's own audio. The person's microphone plays through
  // a separate voice element, so muting a stream must never silence their voice.
  const setScreenPlaybackMuted = (connectionId: string, muted: boolean) => {
    setScreenAudioMuted((current) =>
      current[connectionId] === muted ? current : { ...current, [connectionId]: muted },
    );
  };

  const configureVoiceActivation = (
    settings: AudioSettings = audioSettingsRef.current,
    thresholdDb = settings.sensitivityMode === "auto" ? autoSensitivityDbRef.current : settings.sensitivityDb,
  ) => {
    voiceActivationNodeRef.current?.port.postMessage({
      type: "configure",
      enabled: !settings.pushToTalk,
      automatic: settings.sensitivityMode === "auto",
      thresholdDb,
    });
  };

  const resetVoiceProcessingState = () => {
    try {
      voiceActivationNodeRef.current?.port.postMessage({ type: "reset" });
    } catch {}
    try {
      clearVoiceAiRuntimeRef.current?.reset();
    } catch {}
    voiceActivationMetricsRef.current = null;
    voiceActivationMetricsUiAtRef.current = 0;
    setVoiceActivationMetrics(null);
  };

  const saveAudioSettings = (next: AudioSettings) => {
    audioSettingsRef.current = next;
    setAudioSettings(next);
    configureVoiceActivation(next);
    try {
      localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Local storage may be unavailable.
    }
  };

  const refreshAudioDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter((device) => device.kind === "audioinput"));
      setAudioOutputs(devices.filter((device) => device.kind === "audiooutput"));
    } catch (error) {
      console.warn("Could not enumerate audio devices:", error);
    }
  };

  const setAudioSink = async (element: SinkableAudioElement, outputDeviceId: string): Promise<boolean> => {
    if (typeof element.setSinkId !== "function") {
      if (outputDeviceId) {
        setAudioOutputError("This desktop runtime cannot select an output device. Using the system default.");
        if (audioSettingsRef.current.outputDeviceId === outputDeviceId) {
          const next = { ...audioSettingsRef.current, outputDeviceId: "" };
          audioSettingsRef.current = next;
          setAudioSettings(next);
        }
      }
      return false;
    }
    if (!outputDeviceId) {
      try {
        await element.setSinkId("");
        return true;
      } catch (error) {
        console.warn("Could not select the system default audio output:", error);
        setAudioOutputError("Audio output is unavailable. Check your speakers or headset.");
        return false;
      }
    }
    try {
      await element.setSinkId(outputDeviceId);
      return true;
    } catch (error) {
      console.warn("Could not select audio output device; falling back to the system default:", error);
      try {
        await element.setSinkId("");
        setAudioOutputError("The selected output is unavailable. Using the system default output.");
        if (audioSettingsRef.current.outputDeviceId === outputDeviceId) {
          const next = { ...audioSettingsRef.current, outputDeviceId: "" };
          audioSettingsRef.current = next;
          setAudioSettings(next);
        }
      } catch (fallbackError) {
        console.warn("Could not restore the system default audio output:", fallbackError);
        setAudioOutputError("Audio output is unavailable. Check your speakers or headset.");
      }
      return false;
    }
  };

  const stopMeterLoop = () => {
    if (micMeterFrameRef.current !== null) {
      cancelAnimationFrame(micMeterFrameRef.current);
      micMeterFrameRef.current = null;
    }
    setMicLevelDb(-80);
  };

  const disposeCurrentMicrophoneGraph = () => {
    try {
      micSourceNodeRef.current?.disconnect();
      rnnoiseNodeRef.current?.disconnect();
      rnnoiseNodeRef.current?.destroy();
      clearVoiceNodeRef.current?.disconnect();
      clearVoiceAiRuntimeRef.current?.dispose();
      micHighpassNodeRef.current?.disconnect();
      inputGainNodeRef.current?.disconnect();
      micAnalyserNodeRef.current?.disconnect();
      micProcessedAnalyserNodeRef.current?.disconnect();
      micProcessedTailNodeRef.current?.disconnect();
      voiceActivationNodeRef.current?.disconnect();
      micDestinationNodeRef.current?.disconnect();
      micProcessingKeepAliveNodeRef.current?.disconnect();
    } catch {
      // Nodes may already be disconnected.
    }

    micSourceNodeRef.current = null;
    rnnoiseNodeRef.current = null;
    clearVoiceNodeRef.current = null;
    clearVoiceAiRuntimeRef.current = null;
    clearVoiceAiNodeRef.current = null;
    micHighpassNodeRef.current = null;
    inputGainNodeRef.current = null;
    micAnalyserNodeRef.current = null;
    micProcessedAnalyserNodeRef.current = null;
    micProcessedTailNodeRef.current = null;
    voiceActivationNodeRef.current = null;
    micDestinationNodeRef.current = null;
    micProcessingKeepAliveNodeRef.current = null;
    micVoiceActivationAudibleRef.current = true;
    aiNoiseSilentSinceRef.current = null;
    aiNoiseBypassedRef.current = false;
    aiNoiseProcessorReadyRef.current = false;
    voiceActivationMetricsRef.current = null;
    voiceActivationMetricsUiAtRef.current = 0;
    setVoiceActivationMetrics(null);
  };

  const stopMicrophonePipeline = () => {
    // A direct call may be sharing this exact processed track with Hub voice.
    // Keep the graph alive until the last direct-call lease is released.
    if (directMicrophoneLeaseCountRef.current > 0) return;
    microphoneBuildSerialRef.current += 1;
    stopMeterLoop();

    const testAudio = micTestAudioRef.current;
    if (testAudio) {
      testAudio.pause();
      testAudio.srcObject = null;
    }
    setMicTestActive(false);
    micTestActiveRef.current = false;

    disposeCurrentMicrophoneGraph();

    for (const track of localMicStreamRef.current?.getTracks() ?? []) track.stop();
    localMicStreamRef.current = null;
    for (const track of rawMicStreamRef.current?.getTracks() ?? []) track.stop();
    rawMicStreamRef.current = null;
    micTrackIdRef.current = "";
    setActiveNoiseSuppressionMode("off");
    setMicrophoneCaptureState("idle");
    setMicrophoneCaptureLabel("");
  };

  const ensureAudioContext = async (
    needsRnnoise: boolean,
    needsClearVoice: boolean,
    needsVoiceActivation = true,
    needsClearVoiceAi = false,
  ): Promise<AudioContext> => {
    let context = audioContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = context;
      rnnoiseModuleLoadedRef.current = false;
      clearVoiceModuleLoadedRef.current = false;
      voiceActivationModuleLoadedRef.current = false;
      rnnoiseBinaryRef.current = null;
    }

    if (context.state === "suspended") await context.resume();

    if (needsRnnoise || needsClearVoice || needsVoiceActivation || needsClearVoiceAi) {
      if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") {
        throw new Error("DeCave local noise suppression is not supported by this browser.");
      }
    }
    if (needsRnnoise) {
      if (context.sampleRate !== 48000) {
        throw new Error(
          `DeCave AI requires 48 kHz audio. This browser opened the audio engine at ${context.sampleRate} Hz.`,
        );
      }
      if (!rnnoiseBinaryRef.current) {
        rnnoiseBinaryRef.current = await loadRnnoise({
          url: rnnoiseWasmPath,
          simdUrl: rnnoiseWasmSimdPath,
        });
      }
      if (!rnnoiseModuleLoadedRef.current) {
        await context.audioWorklet.addModule(rnnoiseWorkletPath);
        rnnoiseModuleLoadedRef.current = true;
      }
    }
    if (needsClearVoice && !clearVoiceModuleLoadedRef.current) {
      await context.audioWorklet.addModule(clearVoiceWorkletPath);
      clearVoiceModuleLoadedRef.current = true;
    }
    if (needsVoiceActivation && !voiceActivationModuleLoadedRef.current) {
      await context.audioWorklet.addModule(voiceActivationWorkletPath);
      voiceActivationModuleLoadedRef.current = true;
    }

    return context;
  };

  // Voice-only transport tuning: prefer redundant audio (RED), prioritize the
  // microphone over camera and screen share, and cap its bitrate for the
  // listener count. In a mesh call every listener gets a separate copy.
  const configureMicrophoneSender = (pc: RTCPeerConnection, sender: RTCRtpSender) => {
    applyVoiceCodecPreferences(
      pc.getTransceivers().find((transceiver) => transceiver.sender === sender),
      RTCRtpReceiver.getCapabilities?.("audio"),
    );
    void applyVoiceSenderParameters(sender, peerSessionsRef.current.size);
  };

  const refreshMicrophoneSenderParameters = () => {
    const listeners = peerSessionsRef.current.size;
    for (const session of peerSessionsRef.current.values()) {
      if (session.microphoneSender) void applyVoiceSenderParameters(session.microphoneSender, listeners);
    }
  };

  const replaceMicrophoneTrackForPeers = async (
    oldTrackId: string,
    newTrack: MediaStreamTrack,
    stream: MediaStream,
    isCurrent?: () => boolean,
  ): Promise<boolean> => {
    const replaced: Array<{ sender: RTCRtpSender; oldTrack: MediaStreamTrack | null }> = [];
    const addedSenders: Array<{ session: PeerSession; sender: RTCRtpSender }> = [];
    const rollback = async () => {
      for (const item of [...replaced].reverse()) {
        // A newer build may already have taken ownership of this sender.
        if (item.sender.track === newTrack) await item.sender.replaceTrack(item.oldTrack).catch(() => {});
      }
      for (const item of [...addedSenders].reverse()) {
        if (item.sender.track !== newTrack) continue;
        item.session.pc.removeTrack(item.sender);
        if (item.session.microphoneSender === item.sender) item.session.microphoneSender = null;
      }
    };
    for (const session of peerSessionsRef.current.values()) {
      if (isCurrent && !isCurrent()) {
        await rollback();
        return false;
      }
      const senders = session.pc.getSenders();
      const screenTrackIds = new Set(localScreenStreamRef.current?.getAudioTracks().map((track) => track.id) ?? []);
      let sender =
        session.microphoneSender && senders.includes(session.microphoneSender) ? session.microphoneSender : null;
      sender ??= senders.find((item) => item.track?.kind === "audio" && item.track.id === oldTrackId) ?? null;
      // A recovered browser track may no longer have the old ID. Reuse the
      // non-screen audio sender instead of adding a second microphone sender,
      // which can remain unnegotiated and silently transmit nothing.
      sender ??= senders.find((item) => item.track?.kind === "audio" && !screenTrackIds.has(item.track.id)) ?? null;
      if (sender) {
        try {
          const oldTrack = sender.track;
          await sender.replaceTrack(newTrack);
          if (isCurrent && !isCurrent()) {
            replaced.push({ sender, oldTrack });
            await rollback();
            return false;
          }
          session.microphoneSender = sender;
          replaced.push({ sender, oldTrack });
        } catch (error) {
          console.warn("Could not replace microphone track; retaining the current microphone:", error);
          await rollback();
          return false;
        }
      } else {
        if (isCurrent && !isCurrent()) {
          await rollback();
          return false;
        }
        const added = session.pc.addTrack(newTrack, stream);
        session.microphoneSender = added;
        configureMicrophoneSender(session.pc, added);
        addedSenders.push({ session, sender: added });
      }
    }
    return true;
  };

  const bypassAiNoiseProcessorNow = () => {
    if (
      aiNoiseBypassedRef.current ||
      (!rnnoiseNodeRef.current && !clearVoiceNodeRef.current && !clearVoiceAiNodeRef.current)
    )
      return;
    const rawAnalyser = micAnalyserNodeRef.current;
    const processedAnalyser = micProcessedAnalyserNodeRef.current;
    const processedTail = micProcessedTailNodeRef.current;
    const gate = voiceActivationNodeRef.current;
    if (!rawAnalyser || !processedAnalyser || !gate) return;
    try {
      processedAnalyser.disconnect();
    } catch {}
    try {
      processedTail?.disconnect();
    } catch {}
    try {
      // Never expose the raw microphone after a local processor reports a
      // failure. Keep the processed/silent path attached to the gate instead;
      // leaking keyboard hits or room noise is worse than a temporary mute.
      try {
        rawAnalyser.disconnect(gate, 0, 0);
      } catch {}
      if (processedTail) processedTail.connect(gate);
      aiNoiseBypassedRef.current = true;
      aiNoiseProcessorReadyRef.current = false;
    } catch (error) {
      console.warn("Could not immediately bypass the failed DeCave AI processor:", error);
    }
  };

  const startMeterLoop = () => {
    stopMeterLoop();
    const analyser = micAnalyserNodeRef.current;
    if (!analyser) return;

    const samples = new Float32Array(analyser.fftSize);
    const processedSamples = new Float32Array(analyser.fftSize);
    autoSensitivityDbRef.current = -45;

    const tick = (now: number) => {
      const activeAnalyser = micAnalyserNodeRef.current;
      if (!activeAnalyser) return;

      activeAnalyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / Math.max(1, samples.length));
      const db = clamp(20 * Math.log10(Math.max(rms, 0.0001)), -80, 0);
      micLevelDbRef.current = db;

      const processedAnalyser = micProcessedAnalyserNodeRef.current;
      const customNoiseProcessor = rnnoiseNodeRef.current ?? clearVoiceNodeRef.current ?? clearVoiceAiNodeRef.current;
      if (customNoiseProcessor && processedAnalyser) {
        processedAnalyser.getFloatTimeDomainData(processedSamples);
        let processedSum = 0;
        let processedInvalid = false;
        for (let i = 0; i < processedSamples.length; i += 1) {
          const sample = processedSamples[i];
          if (!Number.isFinite(sample)) {
            processedInvalid = true;
            break;
          }
          processedSum += sample * sample;
        }
        if (processedInvalid || !Number.isFinite(processedSum)) {
          aiNoiseSilentSinceRef.current = null;
          requestAiNoiseFallbackRef.current("RNNoise produced invalid audio samples");
          micMeterFrameRef.current = requestAnimationFrame(tick);
          return;
        }
        const processedRms = Math.sqrt(processedSum / Math.max(1, processedSamples.length));
        const workletOutputDead = processedRms <= 0.000001;

        // Custom worklets can emit zeroes while their processor starts. Keep the
        // processed path attached throughout startup; never expose the raw
        // microphone merely because the processor is still warming up.
        if (!aiNoiseProcessorReadyRef.current && !aiNoiseBypassedRef.current && !workletOutputDead) {
          aiNoiseProcessorReadyRef.current = true;
        }

        // Strong attenuation is normal and is not itself a failure. If a local
        // processor stays silent, retain the processed/silent route rather than
        // failing open to unprocessed room noise.
        const meaningfulRawInput = db >= -68 && rms >= 0.00035;
        // The neural model deliberately emits digital silence for noise-only
        // input. Its worker reports missed deadlines/errors separately; zero
        // output alone must not disable successful neural suppression.
        if (!clearVoiceAiNodeRef.current && !aiNoiseBypassedRef.current && meaningfulRawInput && workletOutputDead) {
          aiNoiseSilentSinceRef.current ??= now;
          if (now - aiNoiseSilentSinceRef.current >= 2_500) {
            aiNoiseSilentSinceRef.current = null;
            requestAiNoiseFallbackRef.current(
              "Local noise processor produced digital silence while the microphone had input",
            );
          }
        } else {
          aiNoiseSilentSinceRef.current = null;
        }
      } else {
        aiNoiseSilentSinceRef.current = null;
      }

      if (now - meterLastUiRef.current > 80) {
        meterLastUiRef.current = now;
        setMicLevelDb(
          inputMeterLevelDb({
            rawDb: db,
            pushToTalk: audioSettingsRef.current.pushToTalk,
            gate: voiceActivationNodeRef.current ? voiceActivationMetricsRef.current : null,
          }),
        );
      }
      if (now - autoSensitivityUiRef.current > 250) {
        autoSensitivityUiRef.current = now;
        setAutoSensitivityDb(autoSensitivityDbRef.current);
      }

      micMeterFrameRef.current = requestAnimationFrame(tick);
    };

    micMeterFrameRef.current = requestAnimationFrame(tick);
  };

  const buildMicrophonePipeline = async (
    settings: AudioSettings = audioSettingsRef.current,
    forceBrowserProcessing = false,
    signal?: AbortSignal,
  ): Promise<MediaStream> => {
    const serial = ++microphoneBuildSerialRef.current;
    const previousProcessed = localMicStreamRef.current;
    const previousTrack = previousProcessed?.getAudioTracks()[0];
    const previousTrackId = previousTrack?.id ?? micTrackIdRef.current;
    const assertBuildIsCurrent = () => {
      if (signal?.aborted || !isCurrentGeneration(serial, microphoneBuildSerialRef.current)) {
        throw createAbortError("The microphone setup was cancelled.");
      }
    };

    assertBuildIsCurrent();

    setAudioSettingsError("");
    setAudioSettingsNotice("");

    let effectiveMode = forceBrowserProcessing ? ("off" as NoiseSuppressionMode) : settings.noiseSuppression;

    let context: AudioContext;
    let clearVoiceAiRuntime: ClearVoiceAiRuntime | null = null;
    let useLegacyRnnoise = false;
    let browserFallback = forceBrowserProcessing;
    const ensureBrowserContext = async (): Promise<AudioContext> => {
      try {
        return await ensureAudioContext(false, false, true);
      } catch (voiceActivationError) {
        console.warn("Audio-thread voice activation unavailable; using a fail-open microphone:", voiceActivationError);
        setAudioSettingsNotice(
          "Voice activation is unavailable on this device, so the microphone is using a safe always-on fallback.",
        );
        return ensureAudioContext(false, false, false);
      }
    };
    try {
      if (effectiveMode === "ai") {
        context = await ensureAudioContext(false, false, true, true);
        try {
          clearVoiceAiRuntime = await createClearVoiceAiRuntime(context, { targetSpeaker: true });
        } catch (clearVoiceAiError) {
          console.warn("ClearVoice V6 unavailable; trying the legacy local RNNoise fallback:", clearVoiceAiError);
          try {
            context = await ensureAudioContext(true, false, true);
            useLegacyRnnoise = true;
            setAudioSettingsNotice(
              "ClearVoice V6 could not start on this device, so the local RNNoise fallback is being used.",
            );
          } catch (rnnoiseError) {
            console.warn("RNNoise unavailable; falling back to Standard:", rnnoiseError);
            effectiveMode = "strong";
            setAudioSettingsNotice("DeCave ClearVoice could not start on this device, so Standard is being used.");
            try {
              context = await ensureAudioContext(false, true);
            } catch (clearVoiceError) {
              console.warn("ClearVoice unavailable; falling back to browser processing:", clearVoiceError);
              effectiveMode = "off";
              browserFallback = true;
              setAudioSettingsNotice(
                "Local noise processing is unavailable on this device, so browser processing is being used.",
              );
              context = await ensureBrowserContext();
            }
          }
        }
      } else {
        context = await ensureAudioContext(false, effectiveMode === "standard" || effectiveMode === "strong");
      }
    } catch (error) {
      if (effectiveMode === "ai") {
        console.warn("DeCave ClearVoice unavailable; falling back to browser processing:", error);
        effectiveMode = "off";
        browserFallback = true;
        setAudioSettingsNotice(
          "Local noise processing is unavailable on this device, so browser processing is being used.",
        );
        context = await ensureBrowserContext();
      } else if (effectiveMode === "standard" || effectiveMode === "strong") {
        console.warn("ClearVoice unavailable; falling back to browser processing:", error);
        effectiveMode = "off";
        browserFallback = true;
        setAudioSettingsNotice("ClearVoice could not start on this device, so browser processing is being used.");
        context = await ensureBrowserContext();
      } else {
        context = await ensureBrowserContext();
      }
    }

    const constraints: MediaTrackConstraints = {
      echoCancellation: settings.echoCancellation,
      // Do not stack Chromium's NS/AGC with ClearVoice or RNNoise. AGC can
      // raise the residual keyboard/fan floor after local processing attenuates it.
      noiseSuppression: browserFallback,
      autoGainControl: (browserFallback || effectiveMode === "off") && settings.autoGainControl,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
    };
    if (settings.inputDeviceId) {
      constraints.deviceId = { exact: settings.inputDeviceId };
    }

    let raw: MediaStream;
    let captureCancelled = false;
    const capture = new Promise<MediaStream>((resolve, reject) => {
      const onAbort = () => {
        captureCancelled = true;
        reject(createAbortError("The microphone setup was cancelled."));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      void navigator.mediaDevices
        .getUserMedia({ audio: constraints, video: false })
        .then((stream) => {
          signal?.removeEventListener("abort", onAbort);
          if (captureCancelled) {
            for (const track of stream.getTracks()) track.stop();
            return;
          }
          resolve(stream);
        })
        .catch((error) => {
          signal?.removeEventListener("abort", onAbort);
          if (!captureCancelled) reject(error);
        });
    });
    try {
      raw = await capture;
    } catch (error) {
      clearVoiceAiRuntime?.dispose();
      throw error;
    }
    if (signal?.aborted || serial !== microphoneBuildSerialRef.current) {
      clearVoiceAiRuntime?.dispose();
      for (const track of raw.getTracks()) track.stop();
      throw createAbortError("The microphone setup was superseded by a newer request.");
    }
    for (const track of raw.getAudioTracks()) {
      track.onended = () => {
        if (serial === microphoneBuildSerialRef.current && voiceChannelRef.current !== null)
          requestMicrophoneRecoveryRef.current("microphone source ended");
      };
      track.onmute = () => {
        if (serial === microphoneBuildSerialRef.current && voiceChannelRef.current !== null)
          microphoneMutedSinceRef.current = Date.now();
      };
      track.onunmute = () => {
        microphoneMutedSinceRef.current = null;
      };
    }

    let source!: MediaStreamAudioSourceNode;
    let rnnoise: RnnoiseWorkletNode | null = null;
    let clearVoice: AudioWorkletNode | null = null;
    let clearVoiceAi: AudioWorkletNode | null = null;
    let highpass: BiquadFilterNode | null = null;
    let inputGain!: GainNode;
    let analyser!: AnalyserNode;
    let processedAnalyser: AnalyserNode | null = null;
    let processedTail: AudioNode | null = null;
    let processingKeepAlive: GainNode | null = null;
    let voiceActivation: AudioWorkletNode | null = null;
    let destination: MediaStreamAudioDestinationNode | null = null;
    let processedTrack!: MediaStreamTrack;
    let processed!: MediaStream;

    const disposeCandidate = () => {
      try {
        source?.disconnect();
        rnnoise?.disconnect();
        rnnoise?.destroy();
        clearVoice?.disconnect();
        clearVoiceAiRuntime?.dispose();
        highpass?.disconnect();
        inputGain?.disconnect();
        analyser?.disconnect();
        processedAnalyser?.disconnect();
        processedTail?.disconnect();
        voiceActivation?.disconnect();
        destination?.disconnect();
        processingKeepAlive?.disconnect();
      } catch {
        // Candidate nodes may already be disconnected during cancellation.
      }
      for (const track of raw.getTracks()) track.stop();
      for (const track of processed?.getTracks() ?? []) {
        if (track !== raw.getAudioTracks()[0]) track.stop();
      }
    };

    try {
      source = context.createMediaStreamSource(raw);

      // ClearVoice V6 and the RNNoise compatibility fallback both receive the
      // same rumble pre-filter. Standard keeps the filter inside the
      // shared DSP core so native ports can use the identical algorithm.
      highpass =
        effectiveMode === "ai"
          ? new BiquadFilterNode(context, {
              type: "highpass",
              frequency: 75,
              Q: 0.707,
            })
          : null;
      // Chromium's browser AGC remains enabled on the web fallback, but local
      // ClearVoice/RNNoise deliberately disables it to avoid raising the noise
      // floor. Electron therefore needs a small fixed capture compensation so
      // an otherwise identical microphone does not sound quieter than the web
      // app. Keep this before suppression so the denoiser still sees the same
      // signal relationship and leave Off/browser processing unchanged.
      const desktopCustomCaptureCompensation =
        hasDesktopActivityBridge() &&
        (effectiveMode === "ai" || effectiveMode === "standard" || effectiveMode === "strong")
          ? 1.5
          : 1;
      inputGain = new GainNode(context, {
        gain: (clamp(settings.inputVolume, 0, 200) / 100) * desktopCustomCaptureCompensation,
      });
      analyser = new AnalyserNode(context, {
        fftSize: 1024,
        smoothingTimeConstant: 0.25,
      });
      if (highpass) {
        source.connect(highpass);
        highpass.connect(inputGain);
      } else {
        source.connect(inputGain);
      }
      inputGain.connect(analyser);
      let tail: AudioNode = analyser;

      if (effectiveMode === "ai" && clearVoiceAiRuntime && !useLegacyRnnoise) {
        clearVoiceAi = clearVoiceAiRuntime.node;
        clearVoiceAi.onprocessorerror = () => {
          requestAiNoiseFallbackRef.current("ClearVoice V6 audio worklet failed");
        };
        clearVoiceAi.port.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (!data || typeof data !== "object") return;
          const message = data as { type?: unknown; reason?: unknown };
          if (message.type === "error" || message.type === "underrun") {
            requestAiNoiseFallbackRef.current(
              typeof message.reason === "string" ? message.reason : "ClearVoice V6 missed an audio deadline",
            );
          }
        };
        tail.connect(clearVoiceAi);
        processedAnalyser = new AnalyserNode(context, {
          fftSize: 1024,
          smoothingTimeConstant: 0.2,
        });
        clearVoiceAi.connect(processedAnalyser);
        tail = processedAnalyser;
      } else if (effectiveMode === "ai") {
        const wasmBinary = rnnoiseBinaryRef.current;
        if (!wasmBinary) throw new Error("RNNoise WASM did not load.");
        const sourceChannelCount = clamp(Number(raw.getAudioTracks()[0]?.getSettings().channelCount) || 1, 1, 2);
        rnnoise = new RnnoiseWorkletNode(context, {
          wasmBinary,
          maxChannels: sourceChannelCount,
        });
        rnnoise.onprocessorerror = () => {
          requestAiNoiseFallbackRef.current("RNNoise audio worklet failed");
        };
        tail.connect(rnnoise);
        processedAnalyser = new AnalyserNode(context, {
          fftSize: 1024,
          smoothingTimeConstant: 0.2,
        });
        rnnoise.connect(processedAnalyser);
        tail = processedAnalyser;
      } else if (effectiveMode === "standard" || effectiveMode === "strong") {
        clearVoice = new AudioWorkletNode(context, "decave-clearvoice", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: "explicit",
          outputChannelCount: [1],
          processorOptions: { mode: effectiveMode },
        });
        clearVoice.onprocessorerror = () => {
          requestAiNoiseFallbackRef.current("ClearVoice audio worklet failed");
        };
        tail.connect(clearVoice);
        processedAnalyser = new AnalyserNode(context, {
          fftSize: 1024,
          smoothingTimeConstant: 0.2,
        });
        clearVoice.connect(processedAnalyser);
        tail = processedAnalyser;
      }
      const customProcessor = effectiveMode === "ai" || effectiveMode === "standard" || effectiveMode === "strong";
      // Do not add a post-denoise compressor here. It can make residual room or
      // impact noise feel louder and makes the user's activation threshold less
      // predictable. Standard already has a soft limiter, and
      // the final voice-activation stage below is the only gain decision for the
      // transmitted track.
      processedTail = customProcessor ? tail : null;
      if (customProcessor && processedTail) {
        // The raw path is kept connected during processor startup so a failure
        // cannot mute the microphone. A zero-gain monitor keeps the custom path
        // pulled by the Web Audio graph while that raw path is active; without
        // it, an unconnected worklet may never render and the app would mistake
        // startup silence for a failed processor.
        processingKeepAlive = new GainNode(context, { gain: 0 });
        processedTail.connect(processingKeepAlive);
        processingKeepAlive.connect(context.destination);
      }
      // Voice activation is the final audio-thread stage for every supported
      // suppression mode. This makes the threshold affect the actual WebRTC track
      // rather than only the speaking indicator, and it keeps working while the
      // window is minimized. The raw track remains the fail-open fallback when
      // AudioWorklet is unavailable.
      if (voiceActivationModuleLoadedRef.current) {
        voiceActivation = new AudioWorkletNode(context, "decave-voice-activation", {
          numberOfInputs: 3,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: "explicit",
          outputChannelCount: [1],
          processorOptions: {
            enabled: !settings.pushToTalk,
            automatic: settings.sensitivityMode === "auto",
            thresholdDb: settings.sensitivityMode === "auto" ? autoSensitivityDbRef.current : settings.sensitivityDb,
          },
        });
        destination = context.createMediaStreamDestination();
        // Input 1 is only a raw sidechain for threshold detection. The transmitted
        // input 0 stays on the processed path from the first quantum, including
        // processor startup, so a silent processor can never leak raw microphone
        // audio into the call.
        if (customProcessor && processedTail) {
          analyser.connect(voiceActivation, 0, 1);
          processedTail.connect(voiceActivation, 0, 0);
          // ClearVoice's speech score (input 2) lets the gate hold quiet
          // syllables open; Standard and RNNoise leave the input unconnected.
          clearVoiceAi?.connect(voiceActivation, 1, 2);
        } else tail.connect(voiceActivation, 0, 0);
        voiceActivation.connect(destination);
        voiceActivation.port.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (!data || typeof data !== "object") return;
          const message = data as { type?: unknown; metrics?: { audible?: unknown; thresholdDb?: unknown } };
          if (message.type === "state" && message.metrics && typeof message.metrics.audible === "boolean") {
            const metrics = message.metrics as Partial<VoiceActivationGateMetrics>;
            micVoiceActivationAudibleRef.current = message.metrics.audible;
            voiceActivationMetricsRef.current = {
              ...(voiceActivationMetricsRef.current ?? {}),
              ...metrics,
            };
            if (typeof message.metrics.thresholdDb === "number")
              autoSensitivityDbRef.current = message.metrics.thresholdDb;
            const now = performance.now();
            if (now - voiceActivationMetricsUiAtRef.current >= 100) {
              voiceActivationMetricsUiAtRef.current = now;
              setVoiceActivationMetrics(voiceActivationMetricsRef.current);
            }
          }
        };
        voiceActivation.onprocessorerror = () => {
          if (!destination) return;
          console.warn("Voice activation worklet failed; bypassing it so the microphone stays live.");
          try {
            voiceActivation?.disconnect();
          } catch {}
          try {
            const fallbackTail = customProcessor && processedTail ? processedTail : analyser;
            fallbackTail.connect(destination);
            micVoiceActivationAudibleRef.current = true;
            if (voiceActivationNodeRef.current === voiceActivation) voiceActivationNodeRef.current = null;
            setAudioSettingsNotice(
              customProcessor
                ? "Voice activation stopped unexpectedly; DeCave kept the processed microphone path active."
                : "Voice activation stopped unexpectedly, so DeCave switched to a safe always-on microphone.",
            );
          } catch (error) {
            requestMicrophoneRecoveryRef.current(
              `voice activation failed and could not bypass: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        };
        processedTrack = destination.stream.getAudioTracks()[0];
        if (!processedTrack) {
          for (const track of raw.getTracks()) track.stop();
          throw new Error("Could not create the processed microphone track.");
        }
        processed = new MediaStream([processedTrack]);
      } else {
        // AudioWorklet is unavailable. Keep the exact browser-processed track so
        // a threshold failure can never take the user's microphone offline.
        processedTrack = raw.getAudioTracks()[0];
        if (!processedTrack) {
          for (const track of raw.getTracks()) track.stop();
          throw new Error("Could not create the microphone track.");
        }
        processed = raw;
      }
      processedTrack.contentHint = "speech";
      processedTrack.enabled = microphoneShouldBeEnabled();
      processedTrack.onended = () => {
        if (serial === microphoneBuildSerialRef.current && voiceChannelRef.current !== null)
          requestMicrophoneRecoveryRef.current("processed microphone track ended");
      };
    } catch (error) {
      // Every node and track created for this candidate is released if any
      // constructor, worklet, connection, or destination setup fails.
      disposeCandidate();
      throw error;
    }

    // Keep the current graph alive while the candidate is fully constructed
    // and every active Hub sender has accepted its replacement. A settings
    // change or recovery request that supersedes this build must dispose only
    // its own candidate and leave the current call usable.
    let peerReplacementCommitted = false;
    try {
      assertBuildIsCurrent();
      if (voiceChannelRef.current !== null && previousTrackId) {
        const peersUpdated = await replaceMicrophoneTrackForPeers(previousTrackId, processedTrack, processed, () =>
          isCurrentGeneration(serial, microphoneBuildSerialRef.current),
        );
        if (!peersUpdated) throw new Error("The current voice peers could not accept the new microphone.");
        peerReplacementCommitted = true;
      }
      assertBuildIsCurrent();
      try {
        await Promise.all(Array.from(directMicrophoneListenersRef.current, (listener) => listener(processed)));
      } catch (error) {
        // A direct call must acknowledge the new track before this candidate
        // becomes current. Propagate the failure so the peer replacement above
        // can roll back every sender and the candidate can be disposed.
        throw error instanceof Error ? error : new Error("A direct-call microphone binding rejected the new track.");
      }
      assertBuildIsCurrent();
    } catch (error) {
      if (
        peerReplacementCommitted &&
        previousTrackId &&
        previousProcessed &&
        isCurrentGeneration(serial, microphoneBuildSerialRef.current)
      ) {
        const rollbackTrack = previousTrack ?? previousProcessed.getAudioTracks()[0];
        if (rollbackTrack) {
          await replaceMicrophoneTrackForPeers(processedTrack.id, rollbackTrack, previousProcessed).catch(() => false);
        }
      }
      disposeCandidate();
      throw error;
    }

    disposeCurrentMicrophoneGraph();
    if (previousProcessed && previousProcessed !== processed) {
      for (const track of previousProcessed.getTracks()) track.stop();
    }
    for (const track of rawMicStreamRef.current?.getTracks() ?? []) track.stop();

    rawMicStreamRef.current = raw;
    micSourceNodeRef.current = source;
    rnnoiseNodeRef.current = rnnoise;
    clearVoiceNodeRef.current = clearVoice;
    clearVoiceAiRuntimeRef.current = clearVoiceAiRuntime;
    clearVoiceAiNodeRef.current = clearVoiceAi;
    micHighpassNodeRef.current = highpass;
    inputGainNodeRef.current = inputGain;
    micAnalyserNodeRef.current = analyser;
    micProcessedAnalyserNodeRef.current = processedAnalyser;
    micProcessedTailNodeRef.current = processedTail;
    voiceActivationNodeRef.current = voiceActivation;
    micDestinationNodeRef.current = destination;
    micProcessingKeepAliveNodeRef.current = processingKeepAlive;
    localMicStreamRef.current = processed;
    micTrackIdRef.current = processedTrack.id;
    resetVoiceProcessingState();
    setActiveNoiseSuppressionMode(effectiveMode);
    console.info("[DeCave voice] microphone pipeline ready", {
      requestedMode: settings.noiseSuppression,
      activeMode: effectiveMode,
      clearVoiceAiInitialized: Boolean(clearVoiceAi),
      processingImplementation: clearVoiceAi
        ? "clearvoice-ai-v6"
        : rnnoise
          ? "rnnoise-fallback"
          : effectiveMode === "strong"
            ? "clearvoice-strong"
            : effectiveMode === "standard"
              ? "clearvoice-standard"
              : "browser-or-raw",
      rnnoiseInitialized: Boolean(rnnoise),
      audioContextSampleRate: context.sampleRate,
      inputSampleRate: raw.getAudioTracks()[0]?.getSettings().sampleRate ?? null,
      rawTrackId: raw.getAudioTracks()[0]?.id ?? null,
      processedTrackId: processedTrack.id,
      browserNoiseSuppression: constraints.noiseSuppression,
      browserAutoGainControl: constraints.autoGainControl,
    });
    setMicrophoneCaptureState("ready");
    setMicrophoneCaptureLabel(raw.getAudioTracks()[0]?.label || "Default microphone");

    startMeterLoop();
    await refreshAudioDevices();

    return processed;
  };

  const acquireDirectCallMicrophone = async (): Promise<DirectCallMicrophoneLease> => {
    directMicrophoneLeaseCountRef.current += 1;
    let released = false;
    try {
      const stream = localMicStreamRef.current ?? (await buildMicrophonePipeline(audioSettingsRef.current));
      const subscribe = (listener: (nextStream: MediaStream) => void) => {
        directMicrophoneListenersRef.current.add(listener);
        return () => directMicrophoneListenersRef.current.delete(listener);
      };
      const release = () => {
        if (released) return;
        released = true;
        directMicrophoneLeaseCountRef.current = Math.max(0, directMicrophoneLeaseCountRef.current - 1);
        if (
          directMicrophoneLeaseCountRef.current === 0 &&
          voiceChannelRef.current === null &&
          !micTestActiveRef.current
        ) {
          stopMicrophonePipeline();
        }
      };
      return { stream, subscribe, release };
    } catch (error) {
      directMicrophoneLeaseCountRef.current = Math.max(0, directMicrophoneLeaseCountRef.current - 1);
      throw error;
    }
  };

  const recoverMicrophonePipeline = async (reason: string) => {
    if (voiceChannelRef.current === null || microphoneRecoveryBusyRef.current) return;
    microphoneRecoveryBusyRef.current = true;
    console.warn(`Rebuilding voice microphone pipeline: ${reason}`);
    try {
      const context = audioContextRef.current;
      if (context?.state === "suspended") await context.resume().catch(() => undefined);
      await buildMicrophonePipeline(audioSettingsRef.current);
      microphoneMutedSinceRef.current = null;
      setVoiceError("");
    } catch (error) {
      console.error("Could not recover the voice microphone pipeline:", error);
      setVoiceError(
        error instanceof Error ? error.message : "The microphone stopped and could not recover automatically.",
      );
    } finally {
      microphoneRecoveryBusyRef.current = false;
    }
  };

  requestMicrophoneRecoveryRef.current = (reason) => {
    void recoverMicrophonePipeline(reason);
  };

  requestAiNoiseFallbackRef.current = (reason) => {
    if (
      aiNoiseFallbackBusyRef.current ||
      !["ai", "standard", "strong"].includes(audioSettingsRef.current.noiseSuppression)
    )
      return;
    aiNoiseFallbackBusyRef.current = true;
    console.warn(`Recovering DeCave noise processing: ${reason}`);
    const useBrowser = Boolean(clearVoiceNodeRef.current);
    const failedSerial = microphoneBuildSerialRef.current;
    // Keep processed/silent output only while a replacement processor starts.
    // Never leave a failed worklet permanently connected as the "fallback".
    bypassAiNoiseProcessorNow();
    void (async () => {
      try {
        await buildMicrophonePipeline({ ...audioSettingsRef.current, noiseSuppression: "strong" }, useBrowser);
        setAudioSettingsNotice(
          useBrowser
            ? "Local noise processing stopped; browser noise suppression is keeping your microphone available."
            : "DeCave ClearVoice stopped; Standard noise suppression is keeping your microphone available.",
        );
      } catch (error) {
        // A settings change or leaving the call owns the newer graph.
        if (microphoneBuildSerialRef.current === failedSerial + 1) {
          setAudioSettingsError("Noise suppression could not recover. Reselect your microphone in Voice & Audio.");
          console.error("Noise suppression recovery failed:", error);
        }
      } finally {
        aiNoiseFallbackBusyRef.current = false;
      }
    })();
  };

  const rebuildMicrophoneIfActive = async (next: AudioSettings) => {
    saveAudioSettings(next);
    if (!localMicStreamRef.current) return;
    try {
      const stream = await buildMicrophonePipeline(next);
      if (micTestActiveRef.current && micTestAudioRef.current) {
        micTestAudioRef.current.srcObject = stream;
        await setAudioSink(micTestAudioRef.current, next.outputDeviceId);
        await micTestAudioRef.current.play().catch(() => undefined);
      }
    } catch (error) {
      console.error("Could not rebuild microphone pipeline:", error);
      setAudioSettingsError(microphoneErrorMessage(error));
    }
  };

  const startMicTest = async () => {
    setAudioSettingsError("");
    try {
      const stream = localMicStreamRef.current ?? (await buildMicrophonePipeline(audioSettingsRef.current));
      let audio = micTestAudioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audio.volume = 0.85;
        micTestAudioRef.current = audio;
      }
      audio.srcObject = stream;
      await setAudioSink(audio, audioSettingsRef.current.outputDeviceId);
      await audio.play();
      micTestActiveRef.current = true;
      setMicTestActive(true);
    } catch (error) {
      console.error("Microphone test failed:", error);
      setAudioSettingsError(microphoneErrorMessage(error));
    }
  };

  const stopMicTest = () => {
    const audio = micTestAudioRef.current;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    micTestActiveRef.current = false;
    setMicTestActive(false);
    if (voiceChannelRef.current === null && directMicrophoneLeaseCountRef.current === 0) stopMicrophonePipeline();
  };

  const upsertVoiceParticipant = (participant: VoiceParticipant) => {
    if (participant.userId === myUserIdRef.current) selfConnectionIdRef.current = participant.connectionId;
    setVoiceParticipants((current) => {
      const existingIndex = current.findIndex((item) => item.connectionId === participant.connectionId);
      if (existingIndex < 0) return [...current, participant];
      const next = [...current];
      next[existingIndex] = participant;
      return next;
    });
  };

  const closePeer = (connectionId: string) => {
    clearCallVerdict(connectionId);
    const session = peerSessionsRef.current.get(connectionId);
    if (session) {
      if (session.recoveryTimer !== null) window.clearTimeout(session.recoveryTimer);
      for (const track of session.remoteAudioStream.getTracks()) {
        track.onmute = null;
        track.onunmute = null;
        track.onended = null;
      }
      session.pc.onicecandidate = null;
      session.pc.ontrack = null;
      session.pc.onnegotiationneeded = null;
      session.pc.onconnectionstatechange = null;
      session.pc.oniceconnectionstatechange = null;
      session.pc.close();
      peerSessionsRef.current.delete(connectionId);
      refreshMicrophoneSenderParameters();
    }

    const amplified = remoteGainContextsRef.current.get(connectionId);
    if (amplified) {
      try {
        amplified.source.disconnect();
        amplified.gain.disconnect();
        void amplified.context.close();
      } catch {}
      remoteGainContextsRef.current.delete(connectionId);
    }

    const audio = remoteAudioElementsRef.current.get(connectionId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      remoteAudioElementsRef.current.delete(connectionId);
    }

    setRemoteScreens((current) => {
      if (!current[connectionId]) return current;
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
  };

  const closeAllPeers = () => {
    for (const connectionId of Array.from(peerSessionsRef.current.keys())) {
      closePeer(connectionId);
    }
  };

  const configureScreenSender = async (sender: RTCRtpSender, pc: RTCPeerConnection) => {
    if (sender.track?.kind !== "video") return;

    try {
      const transceiver = pc.getTransceivers().find((item) => item.sender === sender);
      const capabilities = RTCRtpSender.getCapabilities?.("video");
      if (!transceiver || !capabilities?.codecs?.length) return;

      const rank = (mimeType: string) => {
        const mime = mimeType.toLowerCase();
        if (mime === "video/h264") return 0;
        if (mime === "video/vp9") return 1;
        if (mime === "video/vp8") return 2;
        if (mime === "video/av1") return 3;
        return 4;
      };

      const codecs = [...capabilities.codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
      transceiver.setCodecPreferences(codecs);
    } catch (error) {
      console.warn("Could not set screen-share codec preference:", error);
    }

    try {
      const parameters = sender.getParameters();
      const quality = screenQualityRef.current;
      const target = SCREEN_SHARE_PROFILES[quality];
      if (sender.track) sender.track.contentHint = target.fps >= 60 ? "motion" : "detail";
      if (parameters.encodings.length > 0) {
        parameters.encodings[0].maxBitrate = target.maxBitrate;
        parameters.encodings[0].maxFramerate = target.fps;
        // Fast presets preserve cadence during congestion; 30 FPS presets
        // preserve pixels for text and UI so the image stays readable.
        const tunable = parameters as RTCRtpSendParameters & { degradationPreference?: string };
        if (target.fps >= 60) tunable.degradationPreference = "maintain-framerate";
        else tunable.degradationPreference = "maintain-resolution";
        await sender.setParameters(parameters);
      }
    } catch (error) {
      console.warn("Could not apply screen-share bitrate preferences:", error);
    }
  };

  const addLocalTracksToPeer = (session: PeerSession) => {
    const existingTrackIds = new Set(
      session.pc
        .getSenders()
        .map((sender) => sender.track?.id)
        .filter((id): id is string => Boolean(id)),
    );
    const addStream = (stream: MediaStream | null, configureScreen = false, microphone = false) => {
      if (!stream) return;
      for (const track of stream.getTracks()) {
        if (existingTrackIds.has(track.id)) {
          if (microphone && track.kind === "audio") {
            session.microphoneSender =
              session.pc.getSenders().find((sender) => sender.track?.id === track.id) ?? session.microphoneSender;
          }
          continue;
        }
        const sender = session.pc.addTrack(track, stream);
        if (microphone && track.kind === "audio") session.microphoneSender = sender;
        existingTrackIds.add(track.id);
        if (microphone && track.kind === "audio") {
          configureMicrophoneSender(session.pc, sender);
          console.info("[DeCave voice] microphone sender bound", {
            rawTrackId: rawMicStreamRef.current?.getAudioTracks()[0]?.id ?? null,
            processedTrackId: track.id,
            senderTrackId: sender.track?.id ?? null,
            senderUsesProcessedTrack: sender.track?.id === track.id,
          });
        }
        if (configureScreen && track.kind === "video") {
          // Do not let onnegotiationneeded publish SDP before codec, bitrate,
          // and degradation preferences are installed on this sender.
          session.screenConfigPending = session.screenConfigPending
            .then(() => configureScreenSender(sender, session.pc))
            .catch((error) => {
              console.warn("Could not finish screen sender configuration:", error);
            });
        }
      }
    };
    addStream(localMicStreamRef.current, false, true);
    addStream(localScreenStreamRef.current, true);
    addStream(localCameraStreamRef.current);
  };

  const enqueuePeerSignaling = (session: PeerSession, operation: () => Promise<void>): Promise<void> => {
    const guardedOperation = async () => {
      if (peerSessionsRef.current.get(session.participant.connectionId) !== session) return;
      await operation();
    };
    const next = session.signalingQueue.then(guardedOperation, guardedOperation);
    // Keep the chain usable after a rejected operation. The operation itself
    // reports its failure, so a later description or candidate must still run.
    session.signalingQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const ensurePeer = (participant: VoiceParticipant): PeerSession => {
    const existing = peerSessionsRef.current.get(participant.connectionId);
    if (existing) {
      existing.participant = participant;
      addLocalTracksToPeer(existing);
      return existing;
    }

    // Relay-only: media always flows through TURN so peers never learn each
    // other's IP addresses. ICE restarts gather fresh relay candidates.
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceTransportPolicy: "relay",
      iceCandidatePoolSize: 2,
      bundlePolicy: "max-bundle",
    });
    const localConnectionId =
      selfConnectionIdRef.current ||
      voiceParticipantsRef.current.find((item) => item.userId === myUserIdRef.current)?.connectionId ||
      "";
    const session: PeerSession = {
      pc,
      microphoneSender: null,
      participant,
      polite: localConnectionId > participant.connectionId,
      signalingQueue: Promise.resolve(),
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      remoteDescriptionPending: false,
      remoteAudioStream: new MediaStream(),
      remoteAudioTrackAttached: false,
      missingInboundAudioSamples: 0,
      recoveryTimer: null,
      restartAttempts: 0,
      screenConfigPending: Promise.resolve(),
      lastInboundAudioBytes: 0,
      lastInboundAudioPackets: 0,
      mutedInboundSamples: 0,
      pendingIceCandidates: [],
      resumeAudio: () => {},
      recover: () => {},
    };
    peerSessionsRef.current.set(participant.connectionId, session);

    const resumeRemoteAudio = () => {
      if (peerSessionsRef.current.get(participant.connectionId) !== session) return;
      let amplified = remoteGainContextsRef.current.get(participant.connectionId);
      const voiceTrack = session.remoteAudioStream.getAudioTracks().find((track) => track.readyState === "live");
      if (amplified && (amplified.context.state === "closed" || !voiceTrack)) {
        try {
          amplified.source.disconnect();
          amplified.gain.disconnect();
        } catch {}
        if (amplified.context.state !== "closed") void amplified.context.close().catch(() => {});
        remoteGainContextsRef.current.delete(participant.connectionId);
        amplified = undefined;
      }
      if (amplified && voiceTrack && amplified.trackId !== voiceTrack.id) {
        amplified.source.disconnect();
        amplified.source = amplified.context.createMediaStreamSource(new MediaStream([voiceTrack]));
        amplified.source.connect(amplified.gain);
        amplified.trackId = voiceTrack.id;
      }
      if (!amplified && getVoiceUserVolume(participant.userId) > 100 && voiceTrack) {
        let context: AudioContext | null = null;
        try {
          context = new AudioContext();
          const source = context.createMediaStreamSource(new MediaStream([voiceTrack]));
          const gain = context.createGain();
          const destination = context.createMediaStreamDestination();
          source.connect(gain).connect(destination);
          amplified = { context, gain, source, destination, trackId: voiceTrack.id };
          remoteGainContextsRef.current.set(participant.connectionId, amplified);
        } catch (error) {
          if (context) void context.close().catch(() => {});
          console.warn("Voice amplification unavailable; using normal playback:", error);
        }
      }
      if (amplified?.context.state === "suspended") {
        // Keep direct playback until resume actually succeeds. A denied or
        // pending resume must never replace a working stream with silence.
        const pending = amplified;
        void pending.context
          .resume()
          .then(() => {
            if (
              pending.context.state === "running" &&
              remoteGainContextsRef.current.get(participant.connectionId) === pending
            )
              resumeRemoteAudio();
          })
          .catch(() => {});
      }
      const activeAmplifier = amplified?.context.state === "running" ? amplified : undefined;
      const audio = remoteAudioElementsRef.current.get(participant.connectionId);
      if (audio) {
        const stream = activeAmplifier?.destination.stream ?? session.remoteAudioStream;
        if (audio.srcObject !== stream) audio.srcObject = stream;
        audio.volume = activeAmplifier ? 1 : Math.min(1, getVoiceUserVolume(participant.userId) / 100);
        if (amplified) amplified.gain.gain.value = getVoiceUserVolume(participant.userId) / 100;
        audio.muted =
          isDeafenedRef.current || isServerDeafenedRef.current || locallyMutedUsersRef.current.has(participant.userId);
        if (!audio.muted) void audio.play().catch(() => {});
      }
    };
    session.resumeAudio = resumeRemoteAudio;

    session.recover = (reason: string, immediate = false, forcePeerRebuild = false) => {
      if (pc.connectionState === "closed" || voiceChannelRef.current === null) return;
      resumeRemoteAudio();
      if (
        !forcePeerRebuild &&
        pc.connectionState === "connected" &&
        (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")
      )
        return;
      if (session.recoveryTimer !== null) return;
      const delay = immediate ? 0 : 2_500;
      session.recoveryTimer = window.setTimeout(() => {
        session.recoveryTimer = null;
        if (pc.connectionState === "closed" || voiceChannelRef.current === null) return;
        if (forcePeerRebuild) {
          console.warn(`Recreating connected voice peer after media stall: ${reason}`);
          const live = voiceParticipantsRef.current.find((item) => item.connectionId === participant.connectionId);
          closePeer(participant.connectionId);
          if (live) window.setTimeout(() => ensurePeer(live), 250);
          return;
        }
        if (
          pc.connectionState === "connected" &&
          (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed")
        ) {
          session.restartAttempts = 0;
          resumeRemoteAudio();
          return;
        }
        if (session.restartAttempts >= 3) {
          console.warn(`Voice peer recovery exhausted for ${participant.connectionId}: ${reason}`);
          closePeer(participant.connectionId);
          setVoiceError("Voice connection could not recover automatically. Reconnecting the peer…");
          const live = voiceParticipantsRef.current.find((item) => item.connectionId === participant.connectionId);
          if (live) window.setTimeout(() => ensurePeer(live), 750);
          return;
        }
        session.restartAttempts += 1;
        console.warn(`Restarting voice ICE (${session.restartAttempts}/3): ${reason}`);
        try {
          pc.restartIce();
          window.setTimeout(() => {
            if (
              pc.connectionState !== "connected" &&
              pc.connectionState !== "closed" &&
              pc.iceConnectionState !== "connected" &&
              pc.iceConnectionState !== "completed"
            )
              session.recover("ICE restart timed out", true);
          }, 6_000);
        } catch (error) {
          console.warn("Voice ICE restart was unavailable.", error);
        }
      }, delay);
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || !isRelayIceCandidate(event.candidate)) return;
      sendSocket({
        type: "RTC_ICE_CANDIDATE",
        targetConnectionId: participant.connectionId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => {
      if (event.track.kind === "audio") {
        const incomingStream = event.streams[0] ?? new MediaStream([event.track]);
        // Route by the track's actual MediaStream association, never by the
        // participant-wide screenSharing flag. A sharing participant sends a
        // microphone stream and a separate display stream; treating all of
        // their audio as display audio makes their microphone disappear for
        // listeners whose signalling/track events arrive in a different order.
        const liveParticipant =
          voiceParticipantsRef.current.find((item) => item.connectionId === participant.connectionId) ??
          session.participant;
        if (
          incomingStream.getVideoTracks().length > 0 &&
          liveParticipant.screenSharing === true &&
          liveParticipant.cameraSharing !== true
        ) {
          event.track.contentHint = "music";
          setRemoteScreens((current) => ({
            ...current,
            [participant.connectionId]: {
              connectionId: participant.connectionId,
              username: participant.username,
              stream: incomingStream,
            },
          }));
          return;
        }
        if (!session.remoteAudioStream.getTracks().some((track) => track.id === event.track.id))
          session.remoteAudioStream.addTrack(event.track);
        session.remoteAudioTrackAttached = true;
        session.missingInboundAudioSamples = 0;
        event.track.onended = () => {
          session.remoteAudioStream.removeTrack(event.track);
          session.remoteAudioTrackAttached = session.remoteAudioStream
            .getAudioTracks()
            .some((track) => track.readyState === "live");
          if (!session.remoteAudioTrackAttached) session.recover("remote voice track ended", true, true);
        };
        event.track.onmute = () => {
          window.setTimeout(() => {
            if (
              peerSessionsRef.current.get(participant.connectionId) === session &&
              event.track.muted &&
              event.track.readyState === "live"
            )
              session.recover("remote audio track stalled", true, true);
          }, 2_000);
        };
        event.track.onunmute = () => resumeRemoteAudio();
        let audio = remoteAudioElementsRef.current.get(participant.connectionId);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audio.muted =
            isDeafenedRef.current ||
            isServerDeafenedRef.current ||
            locallyMutedUsersRef.current.has(participant.userId);
          audio.volume = Math.min(1, getVoiceUserVolume(participant.userId) / 100);
          void setAudioSink(audio as SinkableAudioElement, audioSettingsRef.current.outputDeviceId);
          remoteAudioElementsRef.current.set(participant.connectionId, audio);
        }
        const rearmRemoteAudio = () => {
          if (audio && !audio.muted) void audio.play().catch(() => {});
        };
        audio.onloadedmetadata = rearmRemoteAudio;
        audio.oncanplay = rearmRemoteAudio;
        audio.onstalled = () => session.recover("remote audio playback stalled", true, true);
        audio.onerror = () => session.recover("remote audio playback failed", true, true);
        audio.srcObject =
          remoteGainContextsRef.current.get(participant.connectionId)?.destination.stream ?? session.remoteAudioStream;
        audio.volume = Math.min(1, getVoiceUserVolume(participant.userId) / 100);
        resumeRemoteAudio();
        return;
      }

      if (event.track.kind === "video") {
        const videoStream = event.streams[0] ?? new MediaStream([event.track]);
        const liveParticipant =
          voiceParticipantsRef.current.find((item) => item.connectionId === participant.connectionId) ??
          session.participant;
        const cameraVideo = liveParticipant.cameraSharing === true && liveParticipant.screenSharing !== true;
        if (!cameraVideo) {
          // Display audio may arrive before the display video and initially look
          // like an audio-only stream. Once the shared stream's video arrives,
          // remove only its associated audio tracks from the voice stream. The
          // separate microphone stream remains attached and audible.
          const displayAudioTrackIds = new Set(videoStream.getAudioTracks().map((track) => track.id));
          for (const audioTrack of session.remoteAudioStream.getAudioTracks()) {
            if (displayAudioTrackIds.has(audioTrack.id)) session.remoteAudioStream.removeTrack(audioTrack);
          }
          session.remoteAudioTrackAttached = session.remoteAudioStream
            .getAudioTracks()
            .some((track) => track.readyState === "live");
          resumeRemoteAudio();
        }
        const setter = cameraVideo ? setRemoteCameras : setRemoteScreens;
        setter((current) => ({
          ...current,
          [participant.connectionId]: {
            connectionId: participant.connectionId,
            username: participant.username,
            stream: videoStream,
          },
        }));
        event.track.onended = () =>
          setter((current) => {
            if (!current[participant.connectionId]) return current;
            const next = { ...current };
            delete next[participant.connectionId];
            return next;
          });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        if (session.recoveryTimer !== null) window.clearTimeout(session.recoveryTimer);
        session.recoveryTimer = null;
        session.restartAttempts = 0;
        resumeRemoteAudio();
      } else if (pc.connectionState === "disconnected") {
        session.recover("peer connection disconnected");
      } else if (pc.connectionState === "failed") {
        session.recover("peer connection failed", true);
      } else if (pc.connectionState === "closed") closePeer(participant.connectionId);
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected") session.recover("ICE disconnected");
      else if (pc.iceConnectionState === "failed") session.recover("ICE failed", true);
      else if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") resumeRemoteAudio();
    };

    pc.onnegotiationneeded = () => {
      void enqueuePeerSignaling(session, async () => {
        try {
          session.makingOffer = true;
          await session.screenConfigPending;
          if (pc.signalingState !== "stable") return;
          await pc.setLocalDescription();
          if (!pc.localDescription) return;
          sendSocket({
            type: "RTC_DESCRIPTION",
            targetConnectionId: participant.connectionId,
            description: pc.localDescription,
            ...callDescriptionAuth(participant.userId, pc.localDescription.sdp),
          });
        } catch (error) {
          console.error("WebRTC negotiation error:", error);
        } finally {
          session.makingOffer = false;
        }
      });
    };

    addLocalTracksToPeer(session);
    // One more listener: existing microphone senders may need a lower cap.
    refreshMicrophoneSenderParameters();
    return session;
  };

  const ensureVoicePeersFromState = (participants: VoiceParticipant[]) => {
    // VOICE_STATE is also delivered after realtime reconnects. Do not rely only
    // on the one-shot VOICE_JOINED/VOICE_PEER_JOINED signaling events: if one of
    // those events was missed, the participant can be visible while no local
    // peer exists to receive their microphone.
    if (voiceChannelRef.current === null) return;
    const selfConnectionId = selfConnectionIdRef.current;
    for (const participant of participants) {
      if (participant.connectionId === selfConnectionId || participant.channelId !== voiceChannelRef.current) continue;
      ensurePeer(participant);
    }
  };

  const handleRtcDescription = async (
    participant: VoiceParticipant,
    description: RTCSessionDescriptionInit,
    auth?: unknown,
  ) => {
    const session = ensurePeer(participant);
    await enqueuePeerSignaling(session, async () => {
      const { pc } = session;
      // A description whose fingerprints aren't signed by the participant's account
      // key, when they have one, could be the server's: don't connect to it. Checked
      // inside the signaling queue so candidates keep their order.
      if ((await checkCallDescription(participant, description, auth, false)) === "rejected") {
        console.warn("Ignored a voice description that failed its encryption check.");
        return;
      }
      try {
        const readyForOffer =
          !session.makingOffer && (pc.signalingState === "stable" || session.isSettingRemoteAnswerPending);
        const offerCollision = description.type === "offer" && !readyForOffer;
        session.ignoreOffer = !session.polite && offerCollision;
        if (session.ignoreOffer) return;
        session.isSettingRemoteAnswerPending = description.type === "answer";
        session.remoteDescriptionPending = true;
        // Negotiate the room-size voice step so a peer joining a large room
        // starts at the same rate later cap changes would give it.
        await pc.setRemoteDescription(
          withVoiceOpusBitrate(description, voiceBitrateForListeners(peerSessionsRef.current.size)),
        );
        session.remoteDescriptionPending = false;
        session.isSettingRemoteAnswerPending = false;
        // WebSocket events are ordered, but their async handlers are not awaited.
        // Serialize descriptions and candidates per peer so an ICE candidate
        // cannot race setRemoteDescription or another SDP operation.
        const queuedCandidates = session.pendingIceCandidates.splice(0);
        for (const queuedCandidate of queuedCandidates) {
          try {
            await pc.addIceCandidate(queuedCandidate);
          } catch (error) {
            if (!session.ignoreOffer) console.warn("Could not apply queued voice ICE candidate:", error);
          }
        }
        if (description.type === "offer") {
          await pc.setLocalDescription();
          if (pc.localDescription) {
            sendSocket({
              type: "RTC_DESCRIPTION",
              targetConnectionId: participant.connectionId,
              description: pc.localDescription,
              ...callDescriptionAuth(participant.userId, pc.localDescription.sdp),
            });
          }
        }
      } catch (error) {
        session.remoteDescriptionPending = false;
        session.isSettingRemoteAnswerPending = false;
        console.error("Could not apply WebRTC description:", error);
      }
    });
  };

  const handleRtcCandidate = async (participant: VoiceParticipant, candidate: RTCIceCandidateInit) => {
    // Relay-only: never apply a host/srflx candidate a peer may have sent.
    if (!isRelayIceCandidate(candidate)) return;
    const session = ensurePeer(participant);
    await enqueuePeerSignaling(session, async () => {
      if (!session.pc.remoteDescription || session.remoteDescriptionPending) {
        // Bound memory even if a malformed or abandoned negotiation keeps
        // producing candidates without ever delivering a usable description.
        if (session.pendingIceCandidates.length >= 128) session.pendingIceCandidates.shift();
        session.pendingIceCandidates.push(candidate);
        return;
      }
      try {
        await session.pc.addIceCandidate(candidate);
      } catch (error) {
        if (!session.ignoreOffer) {
          console.error("Could not add ICE candidate:", error);
        }
      }
    });
  };

  const cancelVoiceJoinAttempt = (message?: string, _preserveRecoveryCounter = false) => {
    const attempt = voiceJoinAttemptRef.current;
    if (attempt) {
      if (attempt.timer !== null) {
        window.clearTimeout(attempt.timer);
        attempt.timer = null;
      }
      attempt.controller.abort();
      voiceJoinAttemptRef.current = null;
      voiceJoinStartedAtRef.current = null;
    }
    voiceJoinGenerationRef.current += 1;
    if (message) {
      setVoiceStatus("Disconnected");
      setVoiceError(message);
    }
  };

  const finishVoiceJoinAttempt = (channelId: number) => {
    const attempt = voiceJoinAttemptRef.current;
    if (!attempt || attempt.channelId !== channelId) return;
    if (attempt.timer !== null) {
      window.clearTimeout(attempt.timer);
      attempt.timer = null;
    }
    voiceJoinAttemptRef.current = null;
  };

  const acceptsVoiceJoinAcknowledgement = (channelId: number) => {
    const attempt = voiceJoinAttemptRef.current;
    if (attempt) {
      return attempt.channelId === channelId && !attempt.controller.signal.aborted;
    }
    return voiceChannelRef.current === channelId;
  };

  const cleanupVoiceLocal = (clearPresence: boolean, preserveMicrophone = false, preserveRecoveryCounter = false) => {
    cancelVoiceJoinAttempt(undefined, preserveRecoveryCounter);
    closeAllPeers();
    if (!preserveMicrophone) stopMicrophonePipeline();
    for (const track of localScreenStreamRef.current?.getTracks() ?? []) track.stop();
    localScreenStreamRef.current = null;
    setLocalScreenStream(null);
    for (const track of localCameraStreamRef.current?.getTracks() ?? []) track.stop();
    localCameraStreamRef.current = null;
    setLocalCameraStream(null);
    voiceChannelRef.current = null;
    voiceServerIdRef.current = null;
    setVoiceChannelId(null);
    setVoiceStatus("Disconnected");
    setIsServerMuted(false);
    setIsServerDeafened(false);
    setIsScreenSharing(false);
    setIsCameraOn(false);
    setRemoteScreens({});
    setRemoteCameras({});
    if (clearPresence) setVoiceParticipants([]);
    else {
      const selfConnectionId = selfConnectionIdRef.current;
      setVoiceParticipants((current) =>
        current.filter(
          (participant) => participant.connectionId !== selfConnectionId && participant.userId !== myUserIdRef.current,
        ),
      );
    }
  };

  const joinVoiceChannel = async (channelId: number, recoveryRetry = false) => {
    if (!channelId || voiceChannelRef.current === channelId) return;
    const pendingAttempt = voiceJoinAttemptRef.current;
    if (pendingAttempt && pendingAttempt.channelId === channelId && !pendingAttempt.controller.signal.aborted) return;
    cancelVoiceJoinAttempt(undefined, recoveryRetry);
    const generation = ++voiceJoinGenerationRef.current;
    const controller = new AbortController();
    const attempt = {
      generation,
      channelId,
      controller,
      timer: null as number | null,
      deadlineExpired: false,
    };
    voiceJoinAttemptRef.current = attempt;
    const joinStartedAt = performance.now();
    voiceJoinStartedAtRef.current = joinStartedAt;
    const isAttemptCurrent = () =>
      voiceJoinAttemptRef.current === attempt &&
      isCurrentGeneration(generation, voiceJoinGenerationRef.current) &&
      !controller.signal.aborted;
    const joinDeadlineError = new Error(
      "Voice join timed out before the connection was ready. Check your connection, and microphone permissions, then try again.",
    );
    let rejectJoinDeadline: (reason?: unknown) => void = () => {};
    const joinDeadline = new Promise<never>((_, reject) => {
      rejectJoinDeadline = reject;
    });
    // The promise is also intentionally handled when the pre-join timer is
    // replaced by the post-send acknowledgement timer.
    void joinDeadline.catch(() => {});
    const armVoiceJoinPreJoinDeadline = () => {
      if (!isAttemptCurrent()) return;
      if (attempt.timer !== null) window.clearTimeout(attempt.timer);
      attempt.timer = window.setTimeout(() => {
        if (!isAttemptCurrent()) return;
        attempt.deadlineExpired = true;
        rejectJoinDeadline(joinDeadlineError);
        controller.abort();
      }, DESKTOP_VOICE_PRE_JOIN_DEADLINE_MS);
    };
    const armVoiceJoinAcknowledgementTimeout = () => {
      if (!isAttemptCurrent()) return;
      if (attempt.timer !== null) {
        window.clearTimeout(attempt.timer);
        attempt.timer = null;
      }
      attempt.timer = window.setTimeout(() => {
        if (!isAttemptCurrent()) return;
        cancelVoiceJoinAttempt();
        cleanupVoiceLocal(false);
        setVoiceStatus("Disconnected");
        setVoiceError("The voice server did not acknowledge the join. Check your connection and try again.");
      }, DESKTOP_VOICE_JOIN_TIMEOUT_MS);
    };
    const abortPromise = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        reject(createAbortError("The voice join was cancelled."));
        return;
      }
      controller.signal.addEventListener("abort", () => reject(createAbortError("The voice join was cancelled.")), {
        once: true,
      });
    });
    const cancellable = <T>(promise: Promise<T>) => Promise.race([promise, joinDeadline, abortPromise]);
    armVoiceJoinPreJoinDeadline();
    voiceServerIdRef.current =
      serversRef.current.find((server) => server.channels.some((channel) => channel.id === channelId))?.id ??
      activeServerRef.current;
    setVoiceError("");
    setVoiceStatus("Connecting...");
    try {
      const microphoneReady = localMicStreamRef.current
        ? Promise.resolve()
        : buildMicrophonePipeline(audioSettingsRef.current, false, controller.signal);
      resetVoiceProcessingState();
      if (localScreenStreamRef.current) {
        for (const track of localScreenStreamRef.current.getTracks()) track.stop();
        localScreenStreamRef.current = null;
        setLocalScreenStream(null);
        setIsScreenSharing(false);
      }
      if (localCameraStreamRef.current) {
        for (const track of localCameraStreamRef.current.getTracks()) track.stop();
        localCameraStreamRef.current = null;
        setLocalCameraStream(null);
        setIsCameraOn(false);
      }
      closeAllPeers();
      setRemoteScreens({});
      setRemoteCameras({});

      const [, iceServers] = await cancellable(Promise.all([microphoneReady, loadIceServers()]));
      if (!isAttemptCurrent()) throw createAbortError("The voice join was cancelled.");
      // Voice is relay-only. A STUN-only list (TURN not configured) can never
      // connect, so fail the join visibly instead of joining a silent room.
      if (!hasRelayIceServer(iceServers)) throw new Error(RELAY_UNAVAILABLE_MESSAGE);
      if (!sendSocket({ type: "VOICE_JOIN", channelId })) throw new Error("WebSocket is not connected");
      armVoiceJoinAcknowledgementTimeout();
    } catch (error) {
      const deadlineExpired = attempt.deadlineExpired && voiceJoinAttemptRef.current === attempt;
      if ((!isAttemptCurrent() && !deadlineExpired) || isAbortError(error)) return;
      cancelVoiceJoinAttempt();
      cleanupVoiceLocal(false);
      voiceServerIdRef.current = null;
      const message = microphoneErrorMessage(error);
      console.error("Could not join voice channel:", error);
      setVoiceStatus("Disconnected");
      setVoiceError(message);
    }
  };

  const leaveVoice = () => {
    voiceReconnectChannelRef.current = null;
    // F6: also leave when a join is in flight (VOICE_JOIN may already be sent).
    if (voiceChannelRef.current !== null || voiceJoinAttemptRef.current !== null) sendSocket({ type: "VOICE_LEAVE" });
    cleanupVoiceLocal(false);
  };

  const playSoundboardSound = (sound: SoundboardSound) => {
    if (voiceChannelRef.current === null) {
      setSoundboardNotice("Join a voice room to use the soundboard.");
      return;
    }
    if (!sendSocket({ type: "VOICE_SOUNDBOARD_PLAY", soundId: sound.id })) {
      setSoundboardNotice("Voice connection is not ready.");
    }
  };

  const popOutStream = (title: string, stream: MediaStream) => {
    // Electron permits this one named about:blank child window from the trusted
    // DeCave renderer. All other popup/navigation requests remain denied in the
    // desktop main process. Web builds continue to use the browser popup policy.
    const popup = window.open("about:blank", "decave-stream", "width=1100,height=700,resizable=yes");
    if (!popup) {
      setVoiceError(
        hasDesktopActivityBridge()
          ? "DeCave Desktop could not open the stream window. Update/restart the desktop client and try again."
          : "Pop-up blocked. Allow pop-ups for DeCave to use Pop Out.",
      );
      return;
    }

    popup.document.head.replaceChildren();
    const style = popup.document.createElement("style");
    style.textContent =
      "html,body{margin:0;background:#05070d;width:100%;height:100%;overflow:hidden}" +
      "body{display:grid;place-items:center}" +
      "video{width:100%;height:100%;object-fit:contain;background:#05070d}";
    popup.document.head.appendChild(style);
    popup.document.title = title.slice(0, 120);
    popup.document.body.replaceChildren();

    const video = popup.document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.controls = true;
    video.srcObject = stream;
    popup.document.body.appendChild(video);
    popup.addEventListener(
      "beforeunload",
      () => {
        video.srcObject = null;
      },
      { once: true },
    );
    popup.focus();
    void video.play().catch(() => undefined);
  };

  const stopCamera = () => {
    const camera = localCameraStreamRef.current;
    if (!camera) return;
    const ids = new Set(camera.getTracks().map((track) => track.id));
    for (const session of peerSessionsRef.current.values()) {
      for (const sender of session.pc.getSenders())
        if (sender.track && ids.has(sender.track.id)) {
          session.pc.removeTrack(sender);
        }
    }
    for (const track of camera.getTracks()) track.stop();
    localCameraStreamRef.current = null;
    setLocalCameraStream(null);
    setIsCameraOn(false);
    sendSocket({ type: "VOICE_CAMERA_STATE", cameraSharing: false });
  };

  const rejoinVoiceAfterRealtimeReconnect = async (channelId: number, socket: WebSocket) => {
    if (!channelId || socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) return;
    setVoiceError("");
    setVoiceStatus("Connecting...");
    try {
      // The reconnect path uses the same cancellable, acknowledged join as a
      // manual join. This prevents a reconnect from sending an old channel
      // join without a timeout or from racing a newer manual selection.
      await joinVoiceChannel(channelId);
    } catch (error) {
      console.error("Could not restore voice after realtime reconnect:", error);
      voiceReconnectChannelRef.current = null;
      setVoiceStatus("Disconnected");
      setVoiceError(error instanceof Error ? error.message : "Voice could not reconnect automatically.");
    }
  };

  return {
    applyMicrophoneEnabledState,
    resetVoiceUserVolumes,
    getVoiceUserVolume,
    applyVoiceUserVolume,
    changeVoiceUserVolume,
    moderateVoiceUser,
    setScreenPlaybackMuted,
    saveAudioSettings,
    refreshAudioDevices,
    setAudioSink,
    stopMicrophonePipeline,
    replaceMicrophoneTrackForPeers,
    buildMicrophonePipeline,
    acquireDirectCallMicrophone,
    rebuildMicrophoneIfActive,
    startMicTest,
    stopMicTest,
    upsertVoiceParticipant,
    closePeer,
    configureScreenSender,
    addLocalTracksToPeer,
    ensurePeer,
    ensureVoicePeersFromState,
    handleRtcDescription,
    handleRtcCandidate,
    cancelVoiceJoinAttempt,
    finishVoiceJoinAttempt,
    acceptsVoiceJoinAcknowledgement,
    cleanupVoiceLocal,
    joinVoiceChannel,
    leaveVoice,
    playSoundboardSound,
    popOutStream,
    stopCamera,
    rejoinVoiceAfterRealtimeReconnect,
  };
}

export type VoiceEngine = ReturnType<typeof createVoiceEngine>;
