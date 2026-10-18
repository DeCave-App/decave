// A voice note in a conversation: play/pause, waveform (tap or drag to seek),
// duration, speed chip (1x → 1.5x → 2x, remembered on this phone), an accent dot
// while unplayed, and "Played" on the sender's own note once someone played it.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { decodeWave, formatVoiceDuration, type VoiceNoteMeta } from "@/src/lib/voice-note";
import { colors } from "@/src/theme";
import { deleteVoiceFile, loadVoiceNoteFile } from "./audio-file";
import { voicePlayback } from "./expo-player";
import { createConversationOrder, createPlayedTracker, nextSpeed, type PlaybackHandlers } from "./playback";
import { readVoiceSpeed, subscribeVoiceStore, writeVoiceSpeed } from "./store";
import { Waveform } from "./Waveform";

/** Render order of the bubbles, so a finished note can start the next unplayed one. */
const conversationOrder = createConversationOrder();

export type VoiceNoteBubbleProps = {
  conversationId: string;
  messageId: string;
  /** Position in the conversation (the message time); later notes auto-play after this one. */
  order: number;
  meta: VoiceNoteMeta;
  url: string;
  token: string | null;
  /** Decrypts an end-to-end encrypted note after download. */
  decrypt?: ((bytes: Uint8Array) => Uint8Array) | null;
  name?: string;
  mimeType?: string;
  mine: boolean;
  played: boolean;
  onPlayed: () => void;
  /** Hands the file to the share sheet when it cannot be played here. */
  onSave?: () => void;
};

export function VoiceNoteBubble({
  conversationId,
  messageId,
  order,
  meta,
  url,
  token,
  decrypt = null,
  name,
  mimeType,
  mine,
  played,
  onPlayed,
  onSave,
}: VoiceNoteBubbleProps) {
  const { t } = useTranslation(["chat"]);
  const levels = useMemo(() => decodeWave(meta.wave), [meta.wave]);
  const durationSec = meta.ms / 1000;
  const speed = useSyncExternalStore(subscribeVoiceStore, readVoiceSpeed, readVoiceSpeed);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const onPlayedRef = useRef(onPlayed);
  onPlayedRef.current = onPlayed;
  const playedRef = useRef(played);
  playedRef.current = played;
  const trackerRef = useRef(
    createPlayedTracker(() => {
      if (!playedRef.current) onPlayedRef.current();
    }),
  );
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgressState] = useState(0);
  const progressRef = useRef(0);
  const setProgress = (ratio: number) => {
    progressRef.current = ratio;
    setProgressState(ratio);
  };

  // The decrypted, unpadded audio lives in a cache file while this bubble exists.
  const fileRef = useRef<string | null>(null);
  const loadingRef = useRef<Promise<string> | null>(null);
  const mounted = useRef(true);

  const unplayed = !mine && !played;
  useEffect(() => {
    conversationOrder.set(conversationId, messageId, order, unplayed);
  }, [conversationId, messageId, order, unplayed]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      voicePlayback.release(messageId);
      conversationOrder.remove(conversationId, messageId);
      deleteVoiceFile(fileRef.current);
      fileRef.current = null;
    };
  }, [conversationId, messageId]);

  const handlers = useMemo<PlaybackHandlers>(
    () => ({
      onTime: (seconds) => {
        if (durationSec > 0) setProgress(Math.min(1, seconds / durationSec));
        trackerRef.current.update(seconds, durationSec);
      },
      onPlaying: () => setPlaying(true),
      onPaused: () => {
        setPlaying(false);
        trackerRef.current.break();
      },
      onEnded: () => {
        setPlaying(false);
        setProgress(0);
        trackerRef.current.end();
        voicePlayback.onEnded(messageId, () => conversationOrder.nextUnplayed(conversationId, messageId));
      },
      onError: () => {
        setPlaying(false);
        setFailed(true);
      },
    }),
    [conversationId, durationSec, messageId],
  );

  const ensureFile = useCallback(async (): Promise<string | null> => {
    if (fileRef.current) return fileRef.current;
    loadingRef.current ??= loadVoiceNoteFile({ url, token, meta, decrypt, name, mimeType });
    setLoading(true);
    try {
      const uri = await loadingRef.current;
      if (!mounted.current) {
        deleteVoiceFile(uri);
        return null;
      }
      fileRef.current = uri;
      return uri;
    } finally {
      loadingRef.current = null;
      if (mounted.current) setLoading(false);
    }
  }, [url, token, meta, decrypt, name, mimeType]);

  const start = useCallback(async () => {
    try {
      const uri = await ensureFile();
      if (!uri) return;
      setFailed(false);
      trackerRef.current.break();
      const startAt = progressRef.current >= 1 ? 0 : progressRef.current * durationSec;
      await voicePlayback.play(messageId, uri, startAt, speedRef.current, handlers);
    } catch {
      if (mounted.current) setFailed(true);
    }
  }, [ensureFile, durationSec, handlers, messageId]);

  useEffect(() => voicePlayback.subscribe(messageId, () => void start()), [messageId, start]);

  const toggle = () => {
    if (playing) voicePlayback.pause(messageId);
    else void start();
  };

  const seekTo = (ratio: number) => {
    setProgress(ratio);
    trackerRef.current.break();
    voicePlayback.seek(messageId, ratio * durationSec);
  };

  const cycleSpeed = () => {
    const next = nextSpeed(speed);
    writeVoiceSpeed(next);
    voicePlayback.setRate(messageId, next);
  };

  const retry = () => {
    deleteVoiceFile(fileRef.current);
    fileRef.current = null;
    setFailed(false);
    void start();
  };

  if (failed) {
    return (
      <View style={[styles.bubble, styles.errorBubble]}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.red} />
        <Text style={styles.errorText}>{t("chat.voice.errorPlay")}</Text>
        <Pressable accessibilityRole="button" style={styles.textButton} onPress={retry}>
          <Text style={styles.textButtonLabel}>{t("chat.voice.retry")}</Text>
        </Pressable>
        {onSave && (
          <Pressable accessibilityRole="button" style={styles.textButton} onPress={onSave}>
            <Text style={styles.textButtonLabel}>{t("chat.voice.download")}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const shownMs = playing || progress > 0 ? meta.ms * progress : meta.ms;
  return (
    <View style={styles.bubble}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? t("chat.voice.pause") : t("chat.voice.play")}
        style={[styles.play, mine && styles.playMine]}
        onPress={toggle}
        hitSlop={6}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name={playing ? "pause" : "play"} size={18} color="#fff" />
        )}
      </Pressable>
      <View style={styles.body}>
        <Waveform levels={levels} progress={progress} onSeek={seekTo} label={t("chat.voice.scrub")} />
        <View style={styles.meta}>
          <Text style={styles.time}>{formatVoiceDuration(shownMs)}</Text>
          {unplayed && <View style={styles.dot} accessibilityLabel={t("chat.voice.unplayed")} />}
          {mine && played && <Text style={styles.played}>{t("chat.voice.played")}</Text>}
          <View style={styles.spacer} />
          <Pressable accessibilityRole="button" accessibilityLabel={t("chat.voice.speed")} style={styles.speed} onPress={cycleSpeed} hitSlop={6}>
            <Text style={styles.speedText}>{speed}×</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 220, maxWidth: 280, paddingVertical: 2 },
  errorBubble: { flexWrap: "wrap", gap: 8 },
  play: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet },
  playMine: { backgroundColor: colors.cyan },
  body: { flex: 1, gap: 2 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { color: colors.muted, fontSize: 11, fontVariant: ["tabular-nums"] },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.cyan },
  played: { color: colors.muted, fontSize: 11 },
  spacer: { flex: 1 },
  speed: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.panel2 },
  speedText: { color: colors.text, fontSize: 11, fontWeight: "700" },
  errorText: { color: colors.text, fontSize: 12, flexShrink: 1 },
  textButton: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.panel2 },
  textButtonLabel: { color: colors.cyan, fontSize: 12, fontWeight: "700" },
});
