// expo-audio wiring for the voice-note recorder: AAC .m4a, mono, ~40 kbps, with
// metering for the live waveform. The pure state machine is recorder.ts.

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { deleteVoiceFile } from "./audio-file";
import {
  createVoiceRecorderController,
  meteringToLevel,
  type VoiceNoteDraft,
  type VoiceRecordMode,
  type VoiceRecorderSnapshot,
} from "./recorder";

export type { VoiceNoteDraft } from "./recorder";

const RECORDING_OPTIONS: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 40000,
  isMeteringEnabled: true,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: "audio/mp4" },
};

export type VoiceRecorder = VoiceRecorderSnapshot & {
  start(mode?: VoiceRecordMode): Promise<void>;
  stop(): Promise<VoiceNoteDraft | null>;
  /** Hold mode ended: the draft to send, or null. Reads the controller, not the last render. */
  releaseHold(): Promise<VoiceNoteDraft | null>;
  discard(): Promise<void>;
};

/**
 * `inCall`: a voice room or call owns the audio session (WebRTC sets it to
 * play-and-record already). Then the audio mode is left exactly as it is, so the
 * call's routing is not clobbered while recording or afterwards.
 */
export function useVoiceRecorder({ inCall }: { inCall: boolean }): VoiceRecorder {
  const native = useAudioRecorder(RECORDING_OPTIONS);
  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;

  const controller = useMemo(() => {
    let modeChanged = false;
    const restoreMode = async () => {
      if (!modeChanged) return;
      modeChanged = false;
      if (inCallRef.current) return; // a call started meanwhile: it owns the session now
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    };
    return createVoiceRecorderController({
      requestPermission: async () => (await requestRecordingPermissionsAsync()).granted,
      begin: async () => {
        if (!inCallRef.current) {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          modeChanged = true;
        }
        await native.prepareToRecordAsync();
        native.record();
      },
      end: async () => {
        try {
          await native.stop();
        } catch {
          /* never started */
        }
        await restoreMode();
        return native.uri;
      },
      deleteFile: deleteVoiceFile,
      level: () => {
        try {
          return meteringToLevel(native.getStatus().metering);
        } catch {
          return 0;
        }
      },
      now: () => Date.now(),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
      subscribeAppState: (listener) => {
        const sub = AppState.addEventListener("change", listener);
        return () => sub.remove();
      },
    });
  }, [native]);

  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(
    () => () => {
      void controller.discard();
      controller.dispose();
    },
    [controller],
  );
  return {
    ...snap,
    start: controller.start,
    stop: controller.stop,
    releaseHold: controller.releaseHold,
    discard: controller.discard,
  };
}
