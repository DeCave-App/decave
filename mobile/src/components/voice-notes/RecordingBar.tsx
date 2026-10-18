// The recording bar laid over the composer: live waveform and timer while
// recording (stop button in tap mode, "slide left to cancel" while holding),
// then a preview with play/scrub, delete and send.

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { VOICE_NOTE_MAX_MS, decodeWave, formatVoiceDuration } from "@/src/lib/voice-note";
import { colors } from "@/src/theme";
import { voicePlayback } from "./expo-player";
import type { VoiceNoteDraft, VoiceRecorder } from "./useVoiceRecorder";
import { Waveform } from "./Waveform";

const BARS_SHOWN = 40;

function Preview({ draft, busy, onSend, onDelete }: { draft: VoiceNoteDraft; busy: boolean; onSend: () => void; onDelete: () => void }) {
  const { t } = useTranslation(["chat"]);
  const id = `preview:${draft.uri}`;
  const total = draft.meta.ms;
  const levels = useMemo(() => decodeWave(draft.meta.wave), [draft.meta.wave]);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const setPosition = (ms: number) => {
    posRef.current = ms;
    setPos(ms);
  };
  useEffect(() => () => voicePlayback.release(id), [id]);

  const toggle = () => {
    if (playing) {
      voicePlayback.pause(id);
      return;
    }
    void voicePlayback.play(id, draft.uri, posRef.current / 1000, 1, {
      onTime: (s) => setPosition(Math.min(total, s * 1000)),
      onPlaying: () => setPlaying(true),
      onPaused: () => setPlaying(false),
      onEnded: () => {
        setPlaying(false);
        setPosition(0);
        voicePlayback.onEnded(id, () => null);
      },
      onError: () => setPlaying(false),
    });
  };
  const seek = (ratio: number) => {
    setPosition(ratio * total);
    voicePlayback.seek(id, (ratio * total) / 1000);
  };

  return (
    <View style={styles.bar} accessibilityLabel={t("chat.voice.previewLabel")}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("chat.voice.delete")} style={styles.icon} onPress={onDelete} disabled={busy} hitSlop={6}>
        <Ionicons name="trash-outline" size={19} color={colors.red} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? t("chat.voice.pause") : t("chat.voice.play")} style={styles.icon} onPress={toggle} hitSlop={6}>
        <Ionicons name={playing ? "pause" : "play"} size={19} color={colors.cyan} />
      </Pressable>
      <Waveform levels={levels} progress={total ? pos / total : 0} onSeek={seek} label={t("chat.voice.scrub")} />
      <Text style={styles.timer}>{formatVoiceDuration(playing || pos > 0 ? pos : total)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("chat.voice.send")} style={styles.send} onPress={onSend} disabled={busy}>
        {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}
      </Pressable>
    </View>
  );
}

export function RecordingBar({
  recorder,
  holding,
  cancelArmed,
  busy,
  onSend,
}: {
  recorder: VoiceRecorder;
  /** Hold-to-record: no stop button, release sends; leave room for the mic button. */
  holding: boolean;
  cancelArmed: boolean;
  busy: boolean;
  onSend: (draft: VoiceNoteDraft) => void;
}) {
  const { t } = useTranslation(["chat"]);
  const { state, error, elapsedMs, liveLevels, result } = recorder;

  if (state === "error") {
    return (
      <View style={styles.bar} accessibilityRole="alert">
        <Text style={styles.error} numberOfLines={3}>
          {error === "permission" ? t("chat.voice.errorPermissionMobile") : t("chat.voice.errorUnsupported")}
        </Text>
        {error === "permission" && (
          <Pressable accessibilityRole="button" style={styles.textButton} onPress={() => void Linking.openSettings()}>
            <Text style={styles.textButtonLabel}>{t("chat.voice.openSettings")}</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={t("chat.voice.dismiss")} style={styles.icon} onPress={() => void recorder.discard()} hitSlop={6}>
          <Ionicons name="close" size={19} color={colors.muted} />
        </Pressable>
      </View>
    );
  }

  if (state === "preview" && result) {
    return <Preview draft={result} busy={busy} onSend={() => onSend(result)} onDelete={() => void recorder.discard()} />;
  }

  const shown = liveLevels.slice(-BARS_SHOWN);
  const padded = shown.length < BARS_SHOWN ? [...Array<number>(BARS_SHOWN - shown.length).fill(0), ...shown] : shown;
  return (
    <View style={[styles.bar, holding && styles.barHolding]} accessibilityLabel={t("chat.voice.recording")}>
      {!holding && (
        <Pressable accessibilityRole="button" accessibilityLabel={t("chat.voice.delete")} style={styles.icon} onPress={() => void recorder.discard()} hitSlop={6}>
          <Ionicons name="trash-outline" size={19} color={colors.red} />
        </Pressable>
      )}
      <View style={styles.recDot} />
      <Text style={styles.timer}>
        {formatVoiceDuration(elapsedMs)} / {formatVoiceDuration(VOICE_NOTE_MAX_MS)}
      </Text>
      {holding ? (
        <Text style={[styles.hint, cancelArmed && { color: colors.red }]} numberOfLines={1}>
          ‹ {t("chat.voice.slideToCancel")}
        </Text>
      ) : (
        <Waveform levels={padded} progress={1} activeColor={colors.red} />
      )}
      {!holding && (
        <Pressable accessibilityRole="button" accessibilityLabel={t("chat.voice.stop")} style={styles.stop} onPress={() => void recorder.stop()}>
          <Ionicons name="stop" size={16} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flex: 1,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  barHolding: { paddingLeft: 10 },
  icon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.red },
  timer: { color: colors.text, fontSize: 12, fontVariant: ["tabular-nums"] },
  hint: { flex: 1, color: colors.muted, fontSize: 12, textAlign: "center" },
  stop: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.red },
  send: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet },
  error: { flex: 1, color: colors.text, fontSize: 12 },
  textButton: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.panel2 },
  textButtonLabel: { color: colors.cyan, fontSize: 12, fontWeight: "700" },
});
