import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Avatar } from "@/src/components/Avatar";
import { Screen } from "@/src/components/Screen";
import { API_BASE, apiJson } from "@/src/lib/api";
import { loadLastVoiceRoom, voiceRoomHref, type LastVoiceRoom } from "@/src/lib/last-voice-room";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useVoice } from "@/src/providers/VoiceProvider";
import { colors } from "@/src/theme";
import type {
  AccountUser,
  DmConversation,
  Hub,
  SocialState,
} from "@/src/types";

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function assetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^(https?:|data:|file:)/i.test(value)) return value;
  return `${API_BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

export default function HomeScreen() {
  const { user, token } = useSession();
  const { connectionState, lastEvent } = useRealtime();
  const {
    voiceChannelId,
    voiceStatus,
    recoveryState: voiceRecoveryState,
    recoveryAttempt: voiceRecoveryAttempt,
    retryVoice,
    participants,
  } = useVoice();

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [social, setSocial] = useState<SocialState>({
    friends: [],
    incoming: [],
    outgoing: [],
  });
  const [dms, setDms] = useState<DmConversation[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRoom, setLastRoom] = useState<LastVoiceRoom | null>(null);
  const inVoice = voiceChannelId != null && voiceStatus !== "disconnected";

  const load = async () => {
    if (!token) return;

    try {
      const [nextHubs, nextSocial, dmData] = await Promise.all([
        apiJson<Hub[]>("/api/servers", {}, token),
        apiJson<SocialState>("/api/social", {}, token),
        apiJson<{ conversations: DmConversation[] }>("/api/dms", {}, token),
      ]);

      setHubs(nextHubs);
      setSocial(nextSocial);
      setDms(dmData.conversations ?? []);
    } catch {}
  };

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    void loadLastVoiceRoom().then(setLastRoom);
  }, [voiceChannelId, voiceStatus]);

  useEffect(() => {
    const type = lastEvent?.type;

    if (
      type === "SOCIAL_REFRESH" ||
      type === "SERVERS_REFRESH" ||
      type === "DM_MESSAGE" ||
      type === "ROOM_ACTIVITY"
    ) {
      void load();
    }
  }, [lastEvent]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onlineFriends = useMemo(
    () => social.friends.filter((friend) => friend.online).slice(0, 8),
    [social.friends],
  );

  const recentDms = useMemo(
    () =>
      [...dms]
        .sort(
          (a, b) =>
            Date.parse(b.latestTimestamp || "") -
            Date.parse(a.latestTimestamp || ""),
        )
        .slice(0, 4),
    [dms],
  );

  return (
    <Screen>
      <ScrollView keyboardDismissMode="on-drag"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.cyan}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.brandCopy}>
              <Text style={styles.eyebrow}>DECAVE</Text>
              <Text style={styles.greeting} numberOfLines={1}>
                Hey, {user?.username || "there"}
              </Text>
              <View style={styles.connectionRow}>
                <View
                  style={[
                    styles.connectionDot,
                    connectionState === "connected" &&
                      styles.connectionDotOnline,
                  ]}
                />
                <Text style={styles.connectionText}>
                  {connectionState === "connected"
                    ? "Connected"
                    : "Reconnecting"}
                </Text>
              </View>
            </View>
          </View>

        </View>

        {voiceRecoveryState !== "idle" && (
          <Pressable accessibilityRole="button"
            style={styles.voiceBanner}
            onPress={() => {
              if (voiceChannelId !== null) router.push(`/voice/${voiceChannelId}`);
              else retryVoice();
            }}
          >
            <View style={styles.voiceIcon}>
              <Ionicons name="headset" size={19} color={colors.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.voiceTitle}>
                {voiceRecoveryState === "failed"
                  ? "Voice needs attention"
                  : voiceRecoveryState === "reconnecting"
                    ? "Recovering voice"
                    : "Voice connected"}
              </Text>
              <Text style={styles.voiceText}>
                {voiceRecoveryState === "reconnecting"
                  ? `Rejoining (attempt ${voiceRecoveryAttempt || 1}/3)…`
                  : voiceRecoveryState === "failed"
                    ? "Tap to retry when realtime is connected."
                    : `Room ${voiceChannelId} · ${voiceStatus}`}
              </Text>
            </View>
            <Text style={styles.voiceReturn}>
              {voiceChannelId !== null ? "Return" : "Retry"}
            </Text>
          </Pressable>
        )}

        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <Text maxFontSizeMultiplier={1.3} style={styles.heroKicker}>YOUR SPACE</Text>
          <Text style={styles.heroTitle}>Everything that matters, one tap away.</Text>
          <Text style={styles.heroText}>
            Jump back into a conversation, find your crew, or open a Hub.
          </Text>

          <View style={styles.heroActions}>
            <QuickButton
              icon="compass-outline"
              label="Discover Hubs"
              onPress={() => router.navigate("/hubs?mode=discover")}
            />
            <QuickButton
              icon="color-palette-outline"
              label="Appearance"
              onPress={() => router.push("/appearance")}
            />
            <QuickButton
              icon="settings-outline"
              label="Settings"
              onPress={() => router.push("/settings")}
            />
          </View>
        </View>

        {(inVoice || lastRoom) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={inVoice ? "Open your voice room" : `Rejoin ${lastRoom?.name}`}
            onPress={() => {
              if (inVoice && lastRoom?.channelId === voiceChannelId) router.push(voiceRoomHref(lastRoom));
              else if (inVoice) router.push(`/voice/${voiceChannelId}`);
              else if (lastRoom) router.push(voiceRoomHref(lastRoom));
            }}
            style={({ pressed }) => [styles.liveCard, inVoice && styles.liveCardOn, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.liveIcon, inVoice && { backgroundColor: colors.greenSoft }]}>
              <Ionicons name="volume-high" size={20} color={inVoice ? colors.green : colors.cyan} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.liveKicker, inVoice && { color: colors.green }]}>
                {inVoice ? (voiceStatus === "connected" ? "LIVE NOW" : "CONNECTING") : "JUMP BACK IN"}
              </Text>
              <Text style={styles.liveTitle} numberOfLines={1}>
                {inVoice && lastRoom?.channelId !== voiceChannelId ? "Voice room" : lastRoom?.name ?? "Voice room"}
              </Text>
              <Text style={styles.liveMeta} numberOfLines={1}>
                {inVoice
                  ? `${participants.length} ${participants.length === 1 ? "person" : "people"} in the room`
                  : "Tap to rejoin your last voice room"}
              </Text>
            </View>
            <View style={[styles.liveAction, inVoice && { backgroundColor: colors.panel2 }]}>
              <Text style={styles.liveActionText}>{inVoice ? "Open" : "Join"}</Text>
            </View>
          </Pressable>
        )}

        <SectionHeader
          title="Friends online"
          action={onlineFriends.length > 0 ? "See all" : undefined}
          onAction={() => router.push("/friends")}
        />

        {onlineFriends.length === 0 ? (
          <View style={styles.compactEmpty}>
            <Ionicons
              name="moon-outline"
              size={18}
              color={colors.faint}
            />
            <Text style={styles.compactEmptyText}>
              Your friends are quiet right now.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.friendRail}
          >
            {onlineFriends.map((friend) => (
              <FriendBubble key={friend.id} friend={friend} />
            ))}
          </ScrollView>
        )}

        <SectionHeader
          title="Recent messages"
          action={recentDms.length > 0 ? "Open DMs" : undefined}
          onAction={() => router.push("/dms")}
        />

        {recentDms.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={22}
                color={colors.cyan}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyTitle}>No recent conversations</Text>
              <Text style={styles.emptyText}>
                Start a DM from your Friends tab.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.dmList}>
            {recentDms.map((conversation) => (
              <Pressable accessibilityRole="button"
                key={conversation.user.id}
                style={({ pressed }) => [
                  styles.dmRow,
                  pressed && styles.rowPressed,
                ]}
                onPress={() =>
                  router.push(
                    `/dm/${encodeURIComponent(
                      conversation.user.id,
                    )}?username=${encodeURIComponent(
                      conversation.user.username,
                    )}`,
                  )
                }
              >
                <View>
                  <Avatar
                    username={conversation.user.username}
                    avatarUrl={conversation.user.avatarUrl}
                    size={46}
                  />
                  {conversation.user.online && (
                    <View style={styles.onlineBadge} />
                  )}
                </View>

                <View style={styles.dmCopy}>
                  <View style={styles.dmHeading}>
                    <Text style={styles.dmName} numberOfLines={1}>
                      {conversation.user.username}
                    </Text>
                    <Text style={styles.dmTime}>
                      {relativeTime(conversation.latestTimestamp)}
                    </Text>
                  </View>
                  <Text style={styles.dmPreview} numberOfLines={1}>
                    {conversation.latestMessage || "Open conversation"}
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.faint}
                />
              </Pressable>
            ))}
          </View>
        )}

        <SectionHeader
          title="Your Hubs"
          action={hubs.length > 0 ? "All Hubs" : undefined}
          onAction={() => router.push("/hubs")}
        />

        {hubs.length === 0 ? (
          <View style={styles.emptyHub}>
            <View style={styles.emptyIcon}>
              <Ionicons name="grid-outline" size={23} color={colors.violet} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyTitle}>No Hubs yet</Text>
              <Text style={styles.emptyText}>
                Create one or discover a public community when you're ready.
              </Text>
            </View>
            <Pressable accessibilityRole="button"
              style={styles.smallPrimary}
              onPress={() => router.push("/hubs")}
            >
              <Text style={styles.smallPrimaryText}>Explore</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.hubList}>
            {hubs.slice(0, 4).map((hub) => (
              <HubRow key={hub.id} hub={hub} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function QuickButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button"
      style={({ pressed }) => [
        styles.quickButton,
        pressed && styles.quickPressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.quickIcon}>
        <Ionicons name={icon as any} size={20} color={colors.cyan} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
    </Pressable>
  );
}

function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {!!action && (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

function FriendBubble({ friend }: { friend: AccountUser }) {
  return (
    <Pressable accessibilityRole="button"
      style={styles.friendBubble}
      onPress={() =>
        router.push(
          `/dm/${encodeURIComponent(friend.id)}?username=${encodeURIComponent(
            friend.username,
          )}`,
        )
      }
    >
      <View style={styles.friendAvatar}>
        <Avatar
          username={friend.username}
          avatarUrl={friend.avatarUrl}
          size={52}
        />
        <View style={styles.friendOnline} />
      </View>
      <Text style={styles.friendName} numberOfLines={1}>
        {friend.username}
      </Text>
    </Pressable>
  );
}

function HubRow({ hub }: { hub: Hub }) {
  return (
    <Pressable accessibilityRole="button"
      style={({ pressed }) => [
        styles.hubRow,
        pressed && styles.rowPressed,
      ]}
      onPress={() => router.push(`/hub/${hub.id}`)}
    >
      <HubIcon hub={hub} size={50} />

      <View style={styles.hubCopy}>
        <View style={styles.hubNameRow}>
          <Text style={styles.hubName} numberOfLines={1}>
            {hub.name}
          </Text>
          {hub.visibility === "private" && (
            <Ionicons name="lock-closed" size={12} color={colors.faint} />
          )}
        </View>
        <Text style={styles.hubMeta} numberOfLines={1}>
          {hub.onlineCount ?? 0} online · {hub.memberCount ?? 0} members
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

function HubIcon({ hub, size }: { hub: Hub; size: number }) {
  const accent = hub.accent || colors.violet;

  if (hub.iconUrl) {
    return (
      <View
        style={[
          styles.hubIconShell,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: accent,
          },
        ]}
      >
        <Image
          source={{ uri: assetUrl(hub.iconUrl)! }}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: size / 2,
          }}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.hubIconShell,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: accent,
        },
      ]}
    >
      <Text style={styles.hubIconText}>
        {(hub.icon || hub.name.slice(0, 1)).slice(0, 2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  liveCard: { marginTop: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  liveCardOn: { borderColor: "rgba(67,226,154,0.35)" },
  liveIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft },
  liveKicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  liveTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 2 },
  liveMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  liveAction: { paddingHorizontal: 16, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet },
  liveActionText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  brand: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    minWidth: 0,
  },
  brandCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: colors.cyan,
    fontSize: 12,
    lineHeight: 11,
    letterSpacing: 2.1,
    fontWeight: "900",
  },
  greeting: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "900",
    marginTop: 1,
  },
  connectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  connectionDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: colors.yellow,
  },
  connectionDotOnline: {
    backgroundColor: colors.green,
  },
  connectionText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  voiceBanner: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 11,
    marginBottom: 12,
    borderRadius: 17,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: "rgba(67,226,154,.28)",
  },
  voiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(67,226,154,.12)",
  },
  voiceTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  voiceText: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  voiceReturn: {
    color: colors.green,
    fontSize: 13,
    fontWeight: "900",
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 24,
    padding: 18,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  heroGlow: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 99,
    right: -58,
    top: -92,
    backgroundColor: "rgba(124,92,255,.18)",
  },
  heroKicker: {
    color: colors.violet,
    fontSize: 12,
    letterSpacing: 1.8,
    fontWeight: "900",
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    marginTop: 6,
    maxWidth: 290,
  },
  heroText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
    maxWidth: 300,
  },
  heroActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 17,
  },
  quickButton: {
    flex: 1,
    alignItems: "center",
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 14,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  quickLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  sectionHeader: {
    marginTop: 24,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  sectionAction: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: "800",
  },
  friendRail: {
    gap: 12,
    paddingRight: 12,
  },
  friendBubble: {
    width: 62,
    alignItems: "center",
  },
  friendAvatar: {
    position: "relative",
  },
  friendOnline: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 13,
    height: 13,
    borderRadius: 99,
    backgroundColor: colors.green,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  friendName: {
    width: 62,
    textAlign: "center",
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  compactEmpty: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  compactEmptyText: {
    color: colors.muted,
    fontSize: 13,
  },
  dmList: {
    gap: 8,
  },
  dmRow: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 17,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    opacity: 0.78,
    borderColor: "rgba(95,225,255,.30)",
  },
  onlineBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 99,
    backgroundColor: colors.green,
    borderWidth: 2,
    borderColor: colors.panel,
  },
  dmCopy: {
    flex: 1,
    minWidth: 0,
  },
  dmHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dmName: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  dmTime: {
    color: colors.faint,
    fontSize: 12,
    fontWeight: "700",
  },
  dmPreview: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  emptyCard: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderRadius: 17,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyHub: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderRadius: 17,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15,
    marginTop: 3,
  },
  smallPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: colors.violet,
  },
  smallPrimaryText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
  hubList: {
    gap: 8,
  },
  hubRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 10,
    borderRadius: 17,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hubIconShell: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
    borderWidth: 2,
  },
  hubIconText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  hubCopy: {
    flex: 1,
    minWidth: 0,
  },
  hubNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hubName: {
    maxWidth: "88%",
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  hubMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },});
