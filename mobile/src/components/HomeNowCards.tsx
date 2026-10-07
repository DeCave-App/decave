import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Avatar } from "@/src/components/Avatar";
import { tapHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";
import type { AccountUser, Hub, VoiceParticipant } from "@/src/types";

type LiveRoom = { channelId: number; name: string; hub: Hub; people: VoiceParticipant[] };

/**
 * Home's "what's happening now" pair: the busiest live voice room in your Hubs,
 * and friends who are playing something. Side by side, each half the width.
 */
export function HomeNowCards({
  hubs,
  participants,
  friends,
  myUserId,
}: {
  hubs: Hub[];
  participants: VoiceParticipant[];
  friends: AccountUser[];
  myUserId?: string;
}) {
  const liveRooms = useMemo(() => {
    const byChannel = new Map<number, VoiceParticipant[]>();
    for (const participant of participants) {
      const list = byChannel.get(participant.channelId) ?? [];
      list.push(participant);
      byChannel.set(participant.channelId, list);
    }
    const rooms: LiveRoom[] = [];
    for (const hub of hubs) {
      for (const channel of hub.channels ?? []) {
        const people = byChannel.get(channel.id);
        if (people?.length) rooms.push({ channelId: channel.id, name: channel.name, hub, people });
      }
    }
    return rooms.sort((a, b) => b.people.length - a.people.length);
  }, [hubs, participants]);

  const playing = useMemo(
    () => friends.filter((friend) => friend.online && (friend.activityText || friend.statusText)).slice(0, 3),
    [friends],
  );

  const top = liveRooms[0];
  const imIn = !!top && top.people.some((person) => person.userId === myUserId);

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          top ? `Live now: ${top.people.length} in ${top.name}, ${top.hub.name}. ${imIn ? "Open" : "Join"}` : "No one is in voice right now"
        }
        disabled={!top}
        onPress={() => {
          if (!top) return;
          tapHaptic();
          router.push(
            `/voice/${top.channelId}?hubId=${top.hub.id}&name=${encodeURIComponent(top.name)}${top.hub.isSquad ? "&squad=1" : ""}` as any,
          );
        }}
        style={({ pressed }) => [styles.card, top && styles.liveCard, pressed && styles.pressed]}
      >
        <View style={styles.kickerRow}>
          <View style={[styles.liveDot, !top && styles.liveDotIdle]} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.kicker, top && styles.kickerLive]}>
            LIVE NOW
          </Text>
        </View>
        {top ? (
          <>
            <View style={styles.faces}>
              {top.people.slice(0, 4).map((person, index) => (
                <View key={person.connectionId} style={[styles.face, index > 0 && { marginLeft: -10 }]}>
                  <Avatar username={person.username} avatarUrl={person.avatarUrl} size={28} />
                </View>
              ))}
              {top.people.length > 4 && <Text style={styles.more}>+{top.people.length - 4}</Text>}
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {top.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {top.people.length} in voice · {top.hub.name}
            </Text>
            <View style={styles.footer}>
              <Text maxFontSizeMultiplier={1.3} style={styles.action}>{imIn ? "Open" : "Join"}</Text>
              {liveRooms.length > 1 && (
                <Text maxFontSizeMultiplier={1.3} style={styles.otherRooms} numberOfLines={1}>
                  +{liveRooms.length - 1} more
                </Text>
              )}
            </View>
          </>
        ) : (
          <>
            <Ionicons name="volume-mute-outline" size={22} color={colors.faint} style={{ marginTop: 6 }} />
            <Text style={styles.emptyText}>No one's in voice right now.</Text>
          </>
        )}
      </Pressable>

      <View style={styles.card} accessibilityLabel="Friends playing">
        <View style={styles.kickerRow}>
          <Ionicons name="game-controller" size={12} color={colors.violet} />
          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>
            FRIENDS PLAYING
          </Text>
        </View>
        {playing.length ? (
          playing.map((friend) => (
            <Pressable
              key={friend.id}
              accessibilityRole="button"
              accessibilityLabel={`${friend.username}, ${friend.activityText || friend.statusText}. Message`}
              onPress={() => {
                tapHaptic();
                router.push(`/dm/${encodeURIComponent(friend.id)}?username=${encodeURIComponent(friend.username)}` as any);
              }}
              style={({ pressed }) => [styles.friend, pressed && styles.pressed]}
            >
              <Avatar username={friend.username} avatarUrl={friend.avatarUrl} size={26} online />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.friendName} numberOfLines={1}>
                  {friend.username}
                </Text>
                <Text style={styles.friendActivity} numberOfLines={1}>
                  {friend.activityText || friend.statusText}
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <>
            <Ionicons name="moon-outline" size={22} color={colors.faint} style={{ marginTop: 6 }} />
            <Text style={styles.emptyText}>No friends are playing yet.</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginBottom: 22 },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 168,
    padding: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  liveCard: { borderColor: "rgba(52,211,153,0.4)" },
  pressed: { opacity: 0.8 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  kickerLive: { color: colors.green },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  liveDotIdle: { backgroundColor: colors.faint },
  faces: { flexDirection: "row", alignItems: "center", marginBottom: 9 },
  face: { borderRadius: 16, borderWidth: 2, borderColor: colors.panel },
  more: { marginLeft: 6, color: colors.muted, fontSize: 12, fontWeight: "800" },
  title: { color: colors.text, fontSize: 16, fontWeight: "900" },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  footer: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 10 },
  action: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 11,
    overflow: "hidden",
    backgroundColor: colors.violet,
  },
  otherRooms: { flexShrink: 1, color: colors.muted, fontSize: 12, fontWeight: "700" },
  friend: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  friendName: { color: colors.text, fontSize: 13, fontWeight: "800" },
  friendActivity: { color: colors.muted, fontSize: 12 },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 8 },
});
