// Audio device controls: output device, input volume and the noise suppression cycle.

import type { MutableRefObject } from "react";
import type { NoiseSuppressionMode, AudioSettings, SinkableAudioElement } from "../types";
import { clamp } from "../format";
import { hasDesktopActivityBridge } from "../desktop";

export type AudioDeviceActionsDeps = {
  activeNoiseSuppressionMode: NoiseSuppressionMode;
  audioContextRef: MutableRefObject<AudioContext | null>;
  inputGainNodeRef: MutableRefObject<GainNode | null>;
  micTestAudioRef: MutableRefObject<SinkableAudioElement | null>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  remoteAudioElementsRef: MutableRefObject<Map<string, HTMLAudioElement>>;
  setAudioSink: (element: SinkableAudioElement, outputDeviceId: string) => Promise<boolean>;
  rebuildMicrophoneIfActive: (next: AudioSettings) => Promise<void>;
  saveAudioSettings: (next: AudioSettings) => void;
};

/** Called once per render with that render's values. */
export function createAudioDeviceActions(deps: AudioDeviceActionsDeps) {
  const {
    activeNoiseSuppressionMode,
    audioContextRef,
    inputGainNodeRef,
    micTestAudioRef,
    audioSettingsRef,
    remoteAudioElementsRef,
    setAudioSink,
    rebuildMicrophoneIfActive,
    saveAudioSettings,
  } = deps;

  const applyOutputDevice = async (outputDeviceId: string) => {
    const tasks: Promise<boolean>[] = [];
    for (const audio of remoteAudioElementsRef.current.values()) {
      tasks.push(setAudioSink(audio as SinkableAudioElement, outputDeviceId));
    }
    if (micTestAudioRef.current) {
      tasks.push(setAudioSink(micTestAudioRef.current, outputDeviceId));
    }
    await Promise.all(tasks);
  };

  const cycleNoiseSuppression = () => {
    // Keep V6 available from the in-channel control. If this device cannot
    // initialize it, buildMicrophonePipeline performs the normal safe fallback
    // and reports the actual active mode instead of hiding the choice.
    const modes: NoiseSuppressionMode[] = ["off", "strong", "ai"];
    const current = activeNoiseSuppressionMode;
    const next = modes[(Math.max(0, modes.indexOf(current)) + 1) % modes.length];
    const nextSettings: AudioSettings = {
      ...audioSettingsRef.current,
      noiseSuppression: next,
    };
    void rebuildMicrophoneIfActive(nextSettings);
  };

  const changeInputVolume = (value: number) => {
    const next = {
      ...audioSettingsRef.current,
      inputVolume: clamp(value, 0, 200),
    };
    saveAudioSettings(next);
    const context = audioContextRef.current;
    const gain = inputGainNodeRef.current;
    if (context && gain) {
      const desktopCustomCaptureCompensation =
        hasDesktopActivityBridge() &&
        (audioSettingsRef.current.noiseSuppression === "ai" ||
          audioSettingsRef.current.noiseSuppression === "standard" ||
          audioSettingsRef.current.noiseSuppression === "strong")
          ? 1.5
          : 1;
      gain.gain.setTargetAtTime((next.inputVolume / 100) * desktopCustomCaptureCompensation, context.currentTime, 0.01);
    }
  };

  return {
    applyOutputDevice,
    cycleNoiseSuppression,
    changeInputVolume,
  };
}
