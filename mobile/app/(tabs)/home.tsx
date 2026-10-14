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
import { HomeNowCards } from "@/src/components/HomeNowCards";
import { API_BASE, apiJson } from "@/src/lib/api";
import { loadHubList } from "@/src/lib/hub-list-cache";
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
import { decryptConversationPreviews } from "@/src/lib/e2ee/client";
import { useTranslation } from "react-i18next";
import { i18next } from "@/src/i18n";
import { dateLocale } from "@/src/lib/date-locale";

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return i18next.t("common.mobile.time.now");
  if (minutes < 60) return i18next.t("common.mobile.time.minutes", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18next.t("common.mobile.time.hours", { count: hours });

  const days = Math.floor(hours / 24);
  if (days < 7) return i18next.t("common.mobile.time.days", { count: days });

  return new Date(timestamp).toLocaleDateString(dateLocale(), {
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
  const { t } = useTranslation(["common"]);
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

  const load = async () => {
    if (!token) return;

    try {
      const [nextHubs, nextSocial, dmData] = await Promise.all([
        // Through the shared cache, so the Hubs tab and Hub pills open with this list.
        loadHubList("mine", token),
        apiJson<SocialState>("/api/social", {}, token),
        apiJson<{ conversations: DmConversation[] }>("/api/dms", {}, token),
      ]);

      setHubs(nextHubs);
      setSocial(nextSocial);
      setDms(await decryptConversationPreviews(dmData.conversations ?? []));
    } catch {}
  };

  useEffect(() => {
    void load();
  }, [token]);

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
              <Text style={styles.eyebrow}>{t("common.mobile.home.decave")}</Text>
              <Text style={styles.greeting} numberOfLines={1}>
                {user?.username ? t("common.mobile.home.heyUsername", { username: user.username }) : t("common.mobile.home.heyThere")}
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
                    ? t("common.connection.connected")
                    : t("common.mobile.home.reconnecting")}
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
                  ? t("common.mobile.home.voiceNeedsAttention")
                  : voiceRecoveryState === "reconnecting"
                    ? t("common.mobile.home.recoveringVoice")
                    : t("common.mobile.home.voiceConnected")}
              </Text>
              <Text style={styles.voiceText}>
                {voiceRecoveryState === "reconnecting"
                  ? t("common.mobile.home.rejoiningAttemptVoicerecoveryattempt3", { voiceRecoveryAttempt: voiceRecoveryAttempt || 1 })
                  : voiceRecoveryState === "failed"
                    ? t("common.mobile.home.tapToRetryWhenRealtime")
                    : t("common.mobile.home.roomVoicechannelidVoicestatus", { voiceChannelId, voiceStatus: t(`common.mobile.home.voiceStatus.${voiceStatus}`) })}
              </Text>
            </View>
            <Text style={styles.voiceReturn}>
              {voiceChannelId !== null ? t("common.mobile.home.return") : t("common.actions.retry")}
            </Text>
          </Pressable>
        )}


        <HomeNowCards hubs={hubs} participants={participants} friends={social.friends} myUserId={user?.id} />

        <SectionHeader
          title={t("common.mobile.home.friendsOnline")}
          action={onlineFriends.length > 0 ? t("common.mobile.home.seeAll") : undefined}
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
              {t("common.mobile.home.yourFriendsAreQuietRight")}
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
          title={t("common.mobile.home.recentMessages")}
          action={recentDms.length > 0 ? t("common.mobile.home.openDms") : undefined}
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
              <Text style={styles.emptyTitle}>{t("common.mobile.home.noRecentConversations")}</Text>
              <Text style={styles.emptyText}>
                {t("common.mobile.home.startADmFromYour")}
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
                    {conversation.latestMessage || t("common.mobile.home.openConversation")}
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
          title={t("common.commandPalette.groupHubs")}
          action={hubs.length > 0 ? t("common.mobile.home.allHubs") : undefined}
          onAction={() => router.push("/hubs")}
        />

        {hubs.length === 0 ? (
          <View style={styles.emptyHub}>
            <View style={styles.emptyIcon}>
              <Ionicons name="grid-outline" size={23} color={colors.violet} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyTitle}>{t("common.mobile.home.noHubsYet")}</Text>
              <Text style={styles.emptyText}>
                {t("common.mobile.home.createOneOrDiscoverA")}
              </Text>
            </View>
            <Pressable accessibilityRole="button"
              style={styles.smallPrimary}
              onPress={() => router.push("/hubs")}
            >
              <Text style={styles.smallPrimaryText}>{t("common.mobile.home.explore")}</Text>
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
  const { t } = useTranslation(["common"]);
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
          {t("common.mobile.home.onlinecountOnlineMembercountMembers", { onlineCount: hub.onlineCount ?? 0, memberCount: hub.memberCount ?? 0 })}
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
