import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Screen } from "@/src/components/Screen";
import { Avatar } from "@/src/components/Avatar";
import { apiJson } from "@/src/lib/api";
import { cachedHubList, loadHubList } from "@/src/lib/hub-list-cache";
import { useSession } from "@/src/providers/SessionProvider";
import { useUnread } from "@/src/providers/UnreadProvider";
import { impactHaptic } from "@/src/lib/haptics";
import type { DmConversation, Hub } from "@/src/types";
import { colors } from "@/src/theme";

type RoomItem = { hub: Hub; channelId: number; name: string; type: string; unread: number; mentions: number };

/** Unread rooms (mentions first) and unread DMs in one list, like web's Inbox. */
export default function InboxScreen() {
  const { t } = useTranslation(["common"]);
  const { token } = useSession();
  const { rooms, roomMentions, roomHubs, dms, markAllRead } = useUnread();
  const [hubs, setHubs] = useState<Hub[]>(() => cachedHubList("mine", token) ?? []);
  const [conversations, setConversations] = useState<DmConversation[]>([]);

  useEffect(() => {
    if (!token) return;
    void loadHubList("mine", token, { maxAgeMs: 30_000 }).then(setHubs).catch(() => undefined);
    void apiJson<{ conversations: DmConversation[] }>("/api/dms", {}, token)
      .then((value) => setConversations(value.conversations ?? []))
      .catch(() => undefined);
  }, [token]);

  const roomItems = useMemo(() => {
    const items: RoomItem[] = [];
    for (const [channelId, unread] of Object.entries(rooms)) {
      const hub = hubs.find((item) => String(item.id) === roomHubs[channelId]);
      const room = hub?.channels?.find((channel) => String(channel.id) === channelId);
      if (!hub || !room) continue;
      items.push({ hub, channelId: room.id, name: room.name, type: room.type, unread, mentions: roomMentions[channelId] ?? 0 });
    }
    return items.sort((a, b) => b.mentions - a.mentions || b.unread - a.unread);
  }, [rooms, roomMentions, roomHubs, hubs]);

  const dmItems = useMemo(
    () =>
      Object.entries(dms)
        .map(([userId, count]) => ({ count, conversation: conversations.find((item) => item.user.id === userId) ?? null, userId }))
        .filter((item) => item.conversation)
        .sort((a, b) => Date.parse(b.conversation!.latestTimestamp) - Date.parse(a.conversation!.latestTimestamp)),
    [dms, conversations],
  );
  const total = roomItems.length + dmItems.length;

  const openRoom = (item: RoomItem) => {
    const forum = item.type === "forum" ? "&forum=1" : "";
    const path = item.type === "voice" ? "voice" : "channel";
    router.push(`/${path}/${item.channelId}?hubId=${item.hub.id}&name=${encodeURIComponent(item.name)}${forum}` as never);
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.cyan} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{t("common.inbox.kicker")}</Text>
          <Text style={styles.title}>{t("common.inbox.title")}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={total === 0}
          style={[styles.markAll, total === 0 && { opacity: 0.4 }]}
          onPress={() => {
            impactHaptic();
            markAllRead();
          }}
        >
          <Ionicons name="checkmark-done" size={16} color={colors.cyan} />
          <Text style={styles.markAllText}>{t("common.inbox.markAllRead")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {total === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={40} color={colors.green} />
            <Text style={styles.emptyTitle}>{t("common.inbox.emptyTitle")}</Text>
            <Text style={styles.emptyBody}>{t("common.inbox.emptyBody")}</Text>
          </View>
        ) : null}

        {dmItems.map(({ conversation, count, userId }) => (
          <Pressable key={userId} accessibilityRole="button" style={styles.row} onPress={() => router.push(`/dm/${encodeURIComponent(userId)}` as never)}>
            <Avatar username={conversation!.user.username} avatarUrl={conversation!.user.avatarUrl} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{conversation!.user.username}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{t("common.inbox.privateMessage")}</Text>
            </View>
            <Badge count={count} tone="violet" />
          </Pressable>
        ))}

        {roomItems.map((item) => (
          <Pressable key={item.channelId} accessibilityRole="button" style={styles.row} onPress={() => openRoom(item)}>
            <View style={styles.roomIcon}>
              <Ionicons
                name={item.type === "voice" ? "volume-high-outline" : item.type === "forum" ? "albums-outline" : "chatbubble-ellipses-outline"}
                size={18}
                color={item.mentions ? colors.red : colors.cyan}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>#{item.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.mentions
                  ? t("common.inbox.roomMentions", { hub: item.hub.name, count: item.mentions })
                  : t("common.inbox.roomUnread", { hub: item.hub.name, count: item.unread })}
              </Text>
            </View>
            <Badge count={item.mentions || item.unread} tone={item.mentions ? "red" : "cyan"} />
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

function Badge({ count, tone }: { count: number; tone: "red" | "cyan" | "violet" }) {
  const background = tone === "red" ? colors.red : tone === "violet" ? colors.violet : colors.cyan;
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 2 },
  markAll: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, height: 34, borderRadius: 10, backgroundColor: colors.panel2 },
  markAllText: { color: colors.cyan, fontSize: 12, fontWeight: "800" },
  list: { padding: 14, gap: 8, paddingBottom: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  roomIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  rowSub: { color: colors.muted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  badge: { minWidth: 24, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 60, paddingHorizontal: 24 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  emptyBody: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: "center" },
});
