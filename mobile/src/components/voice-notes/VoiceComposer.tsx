// The composer's voice-note part. `children` is the normal composer row (plus,
// text box, send); the mic button sits after it while there is no text. A tap on
// the mic starts tap mode (recording bar with stop, then preview); holding it
// records until release, which sends, and sliding left more than 80 px cancels.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { errorHaptic, impactHaptic, tapHaptic } from "@/src/lib/haptics";
import { useDirectCall } from "@/src/providers/DirectCallProvider";
import { useVoice } from "@/src/providers/VoiceProvider";
import { colors } from "@/src/theme";
import { createMicGesture } from "./mic-gesture";
import { RecordingBar } from "./RecordingBar";
import { useVoiceRecorder, type VoiceNoteDraft } from "./useVoiceRecorder";

export function VoiceComposer({
  showMic,
  disabled = false,
  onSend,
  children,
}: {
  /** True while the text box is empty (and nothing else is being composed). */
  showMic: boolean;
  disabled?: boolean;
  /** Resolves once sent; on rejection the preview stays so it can be sent again. */
  onSend: (draft: VoiceNoteDraft) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useTranslation(["chat"]);
  const { voiceChannelId } = useVoice();
  const { phase } = useDirectCall();
  const recorder = useVoiceRecorder({ inCall: voiceChannelId != null || phase !== "idle" });
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const send = useCallback(
    (draft: VoiceNoteDraft) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      onSend(draft)
        .then(() => {
          impactHaptic();
          return recorderRef.current.discard(); // deletes the recording file
        })
        .catch((error: unknown) => {
          errorHaptic();
          Alert.alert(t("chat.voice.sendFailed"), error instanceof Error && error.message ? error.message : undefined);
        })
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [onSend, t],
  );

  const setHold = (value: boolean) => {
    holdingRef.current = value;
    setHolding(value);
    if (!value) setCancelArmed(false);
  };

  const gesture = useMemo(
    () =>
      createMicGesture({
        onTap: () => {
          tapHaptic();
          void recorderRef.current.start();
        },
        onHoldStart: () => {
          tapHaptic();
          setHold(true);
          void recorderRef.current.start("hold");
        },
        onHoldRelease: () => {
          setHold(false);
          // Also covers a note that stopped itself at 2:00 while held, and a release
          // before the recorder started (discarded).
          void recorderRef.current.releaseHold().then((draft) => {
            if (draft) send(draft);
          });
        },
        onHoldCancel: () => {
          setHold(false);
          impactHaptic();
          void recorderRef.current.discard();
        },
        onCancelArmed: setCancelArmed,
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      }),
    [send],
  );

  const active = recorder.state !== "idle" || holding;
  const mic = (
    <View
      style={[styles.mic, holding && styles.micHolding, disabled && styles.micDisabled]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={t("chat.voice.record")}
      accessibilityHint={t("chat.voice.holdHint")}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={() => void recorder.start()}
      onStartShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => !holdingRef.current}
      onResponderGrant={(e) => gesture.press(e.nativeEvent.pageX)}
      onResponderMove={(e) => gesture.move(e.nativeEvent.pageX)}
      onResponderRelease={() => gesture.release()}
      onResponderTerminate={() => gesture.terminate()}
    >
      <Ionicons name="mic" size={20} color="#fff" />
    </View>
  );

  return (
    <>
      {active ? (
        <RecordingBar recorder={recorder} holding={holding} cancelArmed={cancelArmed} busy={busy} onSend={send} />
      ) : (
        children
      )}
      {(active ? holding : showMic) ? mic : null}
    </>
  );
}

const styles = StyleSheet.create({
  mic: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violet,
  },
  micHolding: { backgroundColor: colors.red, transform: [{ scale: 1.12 }] },
  micDisabled: { opacity: 0.34 },
});
