import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InShellContext } from "@/src/components/Screen";
import { Avatar } from "@/src/components/Avatar";
import { apiJson, absoluteMediaUrl } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { useUnread } from "@/src/providers/UnreadProvider";
import { useVoice } from "@/src/providers/VoiceProvider";
import { VoiceFloatingBar } from "@/src/components/VoiceFloatingBar";
import { tapHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";
import type { Hub } from "@/src/types";

const HUB_TINTS = ["#7C3AED", "#DB2777", "#0891B2", "#16A34A", "#EA580C", "#4F46E5"];

type RailItem = {
  key: string;
  label: string;
  icon: string;
  activeIcon: string;
  href: string;
};

const RAIL: RailItem[] = [
  { key: "/home", label: "Home", icon: "home-outline", activeIcon: "home", href: "/home" },
  { key: "/dms", label: "DMs", icon: "chatbubble-outline", activeIcon: "chatbubble", href: "/dms" },
  { key: "/hubs", label: "Hubs", icon: "grid-outline", activeIcon: "grid", href: "/hubs" },
  { key: "/squad-finder", label: "Squad", icon: "game-controller-outline", activeIcon: "game-controller", href: "/squad-finder" },
  { key: "/friends", label: "Friends", icon: "people-outline", activeIcon: "people", href: "/friends" },
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Lounge layout for the main tabs: Hub pills across the top, the voice bar while
 * connected, and an iOS-style tab bar at the bottom.
 */
export function LoungeShell({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { token, user } = useSession();
  const { voiceChannelId } = useVoice();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const unread = useUnread();

  const loadHubs = useCallback(async () => {
    if (!token) return;
    try {
      setHubs(await apiJson<Hub[]>("/api/servers", {}, token));
    } catch (error) {
      console.warn("[lounge] could not load hubs", error);
    }
  }, [token]);

  // Refresh when returning to the tabs so new or left Hubs show up.
  useEffect(() => {
    void loadHubs();
  }, [loadHubs, pathname]);

  const voiceLocation = useMemo(() => {
    if (voiceChannelId == null) return null;
    for (const hub of hubs) {
      const channel = hub.channels?.find((item) => item.id === voiceChannelId);
      if (channel) return `${channel.name} · ${hub.name}`;
    }
    return "Voice room";
  }, [hubs, voiceChannelId]);

  const openHubId = /^\/hub\/(\d+)/.exec(pathname)?.[1];
  const activeRail = openHubId ? "/hubs" : pathname;


  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View pointerEvents="none" style={styles.glow} />

      <View style={styles.header}>
        <Image source={require("../../assets/decave-mark.png")} style={styles.logo} accessibilityLabel="DeCave logo" />
        <Text style={styles.brand}>DeCave</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discover public Hubs"
          hitSlop={8}
          onPress={() => router.navigate("/hubs?mode=discover")}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
        >
          <Ionicons name="compass-outline" size={20} color={colors.lilac} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          accessibilityState={{ selected: pathname === "/profile" }}
          onPress={() => router.navigate("/profile")}
          style={({ pressed }) => [
            styles.profileRing,
            pathname === "/profile" && styles.profileRingActive,
            pressed && styles.pressed,
          ]}
        >
          <Avatar username={user?.username ?? "?"} avatarUrl={user?.avatarUrl} size={30} online />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.hubStrip}
        contentContainerStyle={styles.hubStripContent}
      >
        {hubs.map((hub, index) => {
          const tint = hub.accent || HUB_TINTS[index % HUB_TINTS.length];
          const icon = absoluteMediaUrl(hub.iconUrl);
          const open = String(hub.id) === openHubId;
          return (
            <Pressable
              key={hub.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${hub.name}`}
              accessibilityState={{ selected: open }}
              onPress={() => {
                if (open) return;
                // Switching Hubs from a Hub screen swaps it; from the tabs it stacks on top.
                if (openHubId) router.replace(`/hub/${hub.id}`);
                else router.push(`/hub/${hub.id}`);
              }}
              style={({ pressed }) => [styles.pill, open && styles.pillOpen, pressed && styles.pressed]}
            >
              {icon ? (
                <Image source={{ uri: icon }} style={styles.pillIcon} />
              ) : (
                <View style={[styles.pillIcon, { backgroundColor: tint }]}>
                  <Text style={styles.pillIconText}>{initials(hub.name)}</Text>
                </View>
              )}
              <Text maxFontSizeMultiplier={1.3} style={[styles.pillText, open && styles.pillTextOpen]} numberOfLines={1}>
                {hub.name}
              </Text>
              {!!unread.hubs[String(hub.id)] && (
                <View style={[styles.badge, !!unread.hubMentions[String(hub.id)] && styles.badgeMention]}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.badgeText}>
                    {unread.hubMentions[String(hub.id)] ? "@" : unread.hubs[String(hub.id)] > 99 ? "99+" : unread.hubs[String(hub.id)]}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add or join a Hub"
          onPress={() => router.navigate("/hubs")}
          style={({ pressed }) => [styles.addPill, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={18} color={colors.muted} />
        </Pressable>
      </ScrollView>

      <View style={styles.body}>
        <View style={styles.content}>
          <InShellContext.Provider value={true}>{children}</InShellContext.Provider>
        </View>
      </View>

      <VoiceFloatingBar location={voiceLocation} style={{ marginBottom: 6 }} />

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom - 6, 8) }]}>
        {RAIL.map((item) => {
          const active = activeRail === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (!active) tapHaptic();
                router.navigate(item.href as any);
              }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <View style={[styles.tabIcon, active && styles.tabIconActive]}>
                <Ionicons name={(active ? item.activeIcon : item.icon) as any} size={22} color={active ? "#FFFFFF" : colors.muted} />
                {item.key === "/dms" && unread.dmTotal > 0 && (
                  <View style={[styles.badge, styles.tabBadge]}>
                    <Text maxFontSizeMultiplier={1.3} style={styles.badgeText}>{unread.dmTotal > 99 ? "99+" : unread.dmTotal}</Text>
                  </View>
                )}
              </View>
              <Text maxFontSizeMultiplier={1.3} style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: "hidden" },
  glow: {
    position: "absolute",
    top: -220,
    left: -180,
    width: 480,
    height: 480,
    borderRadius: 240,
    backgroundColor: "rgba(124,58,237,0.22)",
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 6 },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 10,
    shadowColor: colors.violet,
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  brand: { color: colors.text, fontSize: 19, fontWeight: "900", letterSpacing: -0.4 },
  hubStrip: { flexGrow: 0, marginTop: 12 },
  hubStripContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  pill: {
    height: 38,
    maxWidth: 170,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: 19,
    backgroundColor: colors.wash,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillOpen: {
    backgroundColor: colors.violet,
    borderColor: "transparent",
    shadowColor: colors.violet,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pillTextOpen: { color: "#FFFFFF" },
  pillIcon: { width: 26, height: 26, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  pillIconText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  pillText: { color: colors.text, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  addPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violet,
  },
  badgeMention: { backgroundColor: colors.red },
  badgeText: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "900" },
  headerButton: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.wash },
  tabBar: {
    flexDirection: "row",
    paddingTop: 6,
    paddingHorizontal: 6,
    backgroundColor: colors.nav,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 2 },
  tabIcon: { width: 52, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  tabIconActive: { backgroundColor: colors.violet },
  tabLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  tabLabelActive: { color: colors.strong },
  tabBadge: { position: "absolute", top: -3, right: 4, backgroundColor: colors.red },
  profileRing: { padding: 2, borderRadius: 24, backgroundColor: colors.violet },
  profileRingActive: { backgroundColor: colors.lilac },
  content: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },});
