import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { Avatar } from "@/src/components/Avatar";
import { impactHaptic, tapHaptic } from "@/src/lib/haptics";
import { loadLastVoiceRoom, onLastVoiceRoomSaved, voiceRoomHref, type LastVoiceRoom } from "@/src/lib/last-voice-room";
import { useVoice } from "@/src/providers/VoiceProvider";
import { colors } from "@/src/theme";

/** Ping → 1–3 bars; null while unknown. */
function signalBars(pingMs: number | null): number | null {
  if (pingMs == null) return null;
  if (pingMs < 120) return 3;
  if (pingMs < 250) return 2;
  return 1;
}

/**
 * Compact live voice bar: who's talking, connection quality, and mute /
 * deafen / leave, so a room keeps going while you browse the rest of the app.
 * Tap the bar to open the full voice room.
 */
export function VoiceFloatingBar({ location, style }: { location?: string | null; style?: object }) {
  const pathname = usePathname();
  const {
    voiceChannelId,
    voiceStatus,
    recoveryState,
    participants,
    speakingUserIds,
    pingMs,
    muted,
    deafened,
    serverMuted,
    serverDeafened,
    toggleMute,
    toggleDeafen,
    leaveVoice,
  } = useVoice();
  const [room, setRoom] = useState<LastVoiceRoom | null>(null);

  useEffect(() => {
    let alive = true;
    void loadLastVoiceRoom().then((saved) => alive && setRoom(saved));
    const stop = onLastVoiceRoomSaved((saved) => setRoom(saved));
    return () => {
      alive = false;
      stop();
    };
  }, [voiceChannelId]);

  const speakers = useMemo(() => {
    const ids = new Set(speakingUserIds);
    return participants.filter((p) => ids.has(p.userId)).slice(0, 3);
  }, [participants, speakingUserIds]);

  const inVoice = voiceStatus !== "disconnected" && voiceChannelId != null;
  if (!inVoice || pathname.startsWith("/voice/")) return null;

  const reconnecting = recoveryState === "reconnecting" || voiceStatus !== "connected";
  const failed = recoveryState === "failed";
  const bars = reconnecting ? null : signalBars(pingMs);
  const matchingRoom = room?.channelId === voiceChannelId ? room : null;
  const title = failed ? "Connection lost" : reconnecting ? "Reconnecting…" : speakers.length ? `${speakers.map((p) => p.username).join(", ")} talking` : "Voice connected";
  const place = location || matchingRoom?.name || "Voice room";
  const micLocked = serverMuted || serverDeafened;

  const open = () => {
    tapHaptic();
    router.push((matchingRoom ? voiceRoomHref(matchingRoom) : `/voice/${voiceChannelId}`) as any);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${place}. Open voice room`}
      onPress={open}
      style={[styles.bar, style]}
    >
      {speakers.length ? (
        <View style={styles.speakers}>
          {speakers.map((p, index) => (
            <View key={p.connectionId} style={[styles.speaker, index > 0 && { marginLeft: -9 }]}>
              <Avatar username={p.username} avatarUrl={p.avatarUrl} size={22} />
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.dot, (reconnecting || failed) && { backgroundColor: failed ? colors.red : colors.yellow }]} />
      )}
      <View style={styles.copy}>
        <Text style={[styles.state, (reconnecting || failed) && { color: failed ? colors.red : colors.yellow }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.placeRow}>
          {bars != null && (
            <View style={styles.bars} accessibilityLabel={`Signal ${bars} of 3`}>
              {[1, 2, 3].map((n) => (
                <View key={n} style={[styles.signalBar, { height: 3 + n * 3 }, n <= bars && { backgroundColor: bars === 1 ? colors.yellow : colors.green }]} />
              ))}
            </View>
          )}
          <Text style={styles.place} numberOfLines={1}>
            {place}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"}
        accessibilityState={{ disabled: micLocked, selected: muted }}
        disabled={micLocked}
        hitSlop={4}
        onPress={() => {
          impactHaptic();
          toggleMute();
        }}
        style={({ pressed }) => [styles.button, (muted || micLocked) && styles.buttonOff, pressed && styles.pressed]}
      >
        <Ionicons name={muted || micLocked ? "mic-off" : "mic"} size={18} color={muted || micLocked ? colors.red : colors.text} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={deafened ? "Undeafen" : "Deafen"}
        accessibilityHint="Silences everyone in the room for you, and mutes your microphone"
        accessibilityState={{ disabled: serverDeafened, selected: deafened }}
        disabled={serverDeafened}
        hitSlop={4}
        onPress={() => {
          impactHaptic();
          toggleDeafen();
        }}
        style={({ pressed }) => [styles.button, (deafened || serverDeafened) && styles.buttonOff, pressed && styles.pressed]}
      >
        <Ionicons name={deafened || serverDeafened ? "volume-mute" : "headset"} size={18} color={deafened || serverDeafened ? colors.red : colors.text} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Leave voice room"
        hitSlop={4}
        onPress={() => {
          impactHaptic();
          leaveVoice();
        }}
        style={({ pressed }) => [styles.button, styles.leave, pressed && styles.pressed]}
      >
        <Ionicons name="call" size={18} color={colors.red} style={{ transform: [{ rotate: "135deg" }] }} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: 12,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.35)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.green, marginHorizontal: 4 },
  speakers: { flexDirection: "row" },
  speaker: { borderRadius: 13, borderWidth: 2, borderColor: colors.green },
  copy: { flex: 1, minWidth: 0 },
  state: { color: "#6EE7B7", fontSize: 13, fontWeight: "900" },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  place: { flexShrink: 1, color: colors.muted, fontSize: 12, fontWeight: "600" },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 1.5, height: 12 },
  signalBar: { width: 3, borderRadius: 1, backgroundColor: colors.border },
  button: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  buttonOff: { backgroundColor: colors.redSoft },
  leave: { backgroundColor: "rgba(239,68,68,0.18)" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
});
