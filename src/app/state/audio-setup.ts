// Audio setup shown in Voice & video settings: available devices, the mic
// test and live level, microphone capture state, voice activation metrics,
// and audio errors and notices.

import { useState } from "react";
import type { VoiceActivationGateMetrics } from "../../audio/clearvoice/VoiceActivationGate";

export function useAudioSetupState() {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [micLevelDb, setMicLevelDb] = useState(-80);
  const [autoSensitivityDb, setAutoSensitivityDb] = useState(-45);
  const [micTestActive, setMicTestActive] = useState(false);
  const [microphoneCaptureState, setMicrophoneCaptureState] = useState<"idle" | "starting" | "ready" | "error">("idle");
  const [microphoneCaptureLabel, setMicrophoneCaptureLabel] = useState("");
  const [audioSettingsError, setAudioSettingsError] = useState("");
  const [audioSettingsNotice, setAudioSettingsNotice] = useState("");
  const [audioOutputError, setAudioOutputError] = useState("");
  const [voiceActivationMetrics, setVoiceActivationMetrics] = useState<Partial<VoiceActivationGateMetrics> | null>(
    null,
  );
  const [aiNoiseAvailable] = useState(
    () =>
      typeof AudioContext !== "undefined" &&
      typeof AudioWorkletNode !== "undefined" &&
      typeof WebAssembly !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof MessageChannel !== "undefined",
  );

  return {
    audioInputs,
    setAudioInputs,
    audioOutputs,
    setAudioOutputs,
    micLevelDb,
    setMicLevelDb,
    autoSensitivityDb,
    setAutoSensitivityDb,
    micTestActive,
    setMicTestActive,
    microphoneCaptureState,
    setMicrophoneCaptureState,
    microphoneCaptureLabel,
    setMicrophoneCaptureLabel,
    audioSettingsError,
    setAudioSettingsError,
    audioSettingsNotice,
    setAudioSettingsNotice,
    audioOutputError,
    setAudioOutputError,
    voiceActivationMetrics,
    setVoiceActivationMetrics,
    aiNoiseAvailable,
  };
}

export type AudioSetupState = ReturnType<typeof useAudioSetupState>;
