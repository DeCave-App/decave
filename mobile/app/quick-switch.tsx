import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Screen } from "@/src/components/Screen";
import { Avatar } from "@/src/components/Avatar";
import { apiJson } from "@/src/lib/api";
import { cachedHubList, loadHubList } from "@/src/lib/hub-list-cache";
import { useSession } from "@/src/providers/SessionProvider";
import type { AccountUser, Hub, SocialState } from "@/src/types";
import { colors } from "@/src/theme";

type Row =
  | { kind: "heading"; key: string; label: string }
  | { kind: "goto"; key: string; label: string; icon: keyof typeof Ionicons.glyphMap; href: string }
  | { kind: "hub"; key: string; hub: Hub }
  | { kind: "room"; key: string; hub: Hub; id: number; name: string; type: string }
  | { kind: "friend"; key: string; friend: AccountUser };

const matches = (text: string, query: string) => text.toLowerCase().includes(query);

/** Search and quick switch: jump to a Hub, room, friend or screen, like web's command palette. */
export default function QuickSwitchScreen() {
  const { t } = useTranslation(["common", "settings"]);
  const { token } = useSession();
  const [query, setQuery] = useState("");
  const [hubs, setHubs] = useState<Hub[]>(() => cachedHubList("mine", token) ?? []);
  const [friends, setFriends] = useState<AccountUser[]>([]);

  useEffect(() => {
    if (!token) return;
    void loadHubList("mine", token, { maxAgeMs: 30_000 }).then(setHubs).catch(() => undefined);
    void apiJson<SocialState>("/api/social", {}, token)
      .then((value) => setFriends(value.friends ?? []))
      .catch(() => undefined);
  }, [token]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const goto: Row[] = [
      { kind: "goto", key: "inbox", label: t("common.commandPalette.openInbox"), icon: "file-tray-outline", href: "/inbox" },
      { kind: "goto", key: "settings", label: t("common.bottomBar.settings"), icon: "settings-outline", href: "/settings" },
      { kind: "goto", key: "friends", label: t("common.bottomBar.friends"), icon: "people-outline", href: "/(tabs)/friends" },
      { kind: "goto", key: "squad", label: t("common.rail.squad"), icon: "game-controller-outline", href: "/(tabs)/squad-finder" },
      { kind: "goto", key: "dms", label: t("common.rail.dms"), icon: "chatbubbles-outline", href: "/(tabs)/dms" },
    ].filter((row) => !q || matches(row.label, q)) as Row[];
    const hubRows: Row[] = hubs.filter((hub) => !q || matches(hub.name, q)).slice(0, 8).map((hub) => ({ kind: "hub", key: `hub:${hub.id}`, hub }));
    const roomRows: Row[] = q
      ? hubs
          .flatMap((hub) => (hub.channels ?? []).map((room) => ({ kind: "room" as const, key: `room:${room.id}`, hub, id: room.id, name: room.name, type: room.type })))
          .filter((row) => matches(row.name, q) || matches(row.hub.name, q))
          .slice(0, 20)
      : [];
    const friendRows: Row[] = friends.filter((friend) => !q || matches(friend.username, q)).slice(0, 8).map((friend) => ({ kind: "friend", key: `friend:${friend.id}`, friend }));
    const out: Row[] = [];
    const group = (label: string, items: Row[]) => {
      if (items.length) out.push({ kind: "heading", key: `h:${label}`, label }, ...items);
    };
    group(t("common.commandPalette.groupGoTo"), goto);
    group(t("common.commandPalette.groupHubs"), hubRows);
    group(t("common.commandPalette.groupRooms"), roomRows);
    group(t("common.commandPalette.groupFriends"), friendRows);
    return out;
  }, [query, hubs, friends, t]);

  const open = (row: Row) => {
    if (row.kind === "goto") router.replace(row.href as never);
    else if (row.kind === "hub") router.replace(`/hub/${row.hub.id}` as never);
    else if (row.kind === "room") {
      const path = row.type === "voice" ? "voice" : "channel";
      router.replace(`/${path}/${row.id}?hubId=${row.hub.id}&name=${encodeURIComponent(row.name)}${row.type === "forum" ? "&forum=1" : ""}` as never);
    } else if (row.kind === "friend") router.replace(`/dm/${encodeURIComponent(row.friend.id)}` as never);
  };

  return (
    <Screen>
      <View style={styles.top}>
        <View style={styles.search}>
          <Ionicons name="search" size={17} color={colors.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("common.commandPalette.placeholder")}
            accessibilityLabel={t("common.commandPalette.label")}
            placeholderTextColor={colors.faint}
            autoFocus
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => {
              const first = rows.find((row) => row.kind !== "heading");
              if (first) open(first);
            }}
            style={styles.input}
          />
        </View>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.back()}>
          <Text style={styles.cancel}>{t("common.actions.cancel")}</Text>
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("common.commandPalette.noResults")}</Text>
            <Text style={styles.muted}>{t("common.commandPalette.noResultsHint")}</Text>
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === "heading") return <Text style={styles.heading}>{item.label}</Text>;
          return (
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.panel2 }]} onPress={() => open(item)}>
              {item.kind === "friend" ? (
                <Avatar username={item.friend.username} avatarUrl={item.friend.avatarUrl} size={32} />
              ) : (
                <View style={styles.icon}>
                  <Ionicons
                    name={
                      item.kind === "goto"
                        ? item.icon
                        : item.kind === "hub"
                          ? "grid-outline"
                          : item.type === "voice"
                            ? "volume-high-outline"
                            : item.type === "forum"
                              ? "albums-outline"
                              : "chatbubble-ellipses-outline"
                    }
                    size={17}
                    color={colors.cyan}
                  />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.label} numberOfLines={1}>
                  {item.kind === "goto" ? item.label : item.kind === "hub" ? item.hub.name : item.kind === "room" ? (item.type === "text" ? `#${item.name}` : item.name) : item.friend.username}
                </Text>
                {item.kind === "room" && <Text style={styles.muted} numberOfLines={1}>{item.hub.name}</Text>}
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 44, borderRadius: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, color: colors.text, fontSize: 16 },
  cancel: { color: colors.cyan, fontSize: 15, fontWeight: "700" },
  heading: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, color: colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft },
  label: { color: colors.text, fontSize: 15, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 12, marginTop: 1 },
  empty: { alignItems: "center", gap: 6, paddingVertical: 48, paddingHorizontal: 24 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
});
