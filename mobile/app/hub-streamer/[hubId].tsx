import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { cachedHub } from "@/src/lib/hub-list-cache";
import { createStreamerApi, type StreamerSnapshot } from "@/src/lib/streamer-api";
import { isCreator, isLive } from "../../../shared/streamer-mode";
import { useSession } from "@/src/providers/SessionProvider";
import { Button, Card, GiveawaysSection, HighlightsSection, LeaderboardSection, PugSection, QueueSection, TwitchSection } from "@/src/components/streamer/StreamerSections";
import type { Hub } from "@/src/types";
import { colors } from "@/src/theme";

/** A Streamer Hub's overview: live status, community queue, giveaways, clips, PUGs and leaderboard, like web's. */
export default function HubStreamerScreen() {
  const { t } = useTranslation(["streamer", "common"]);
  const params = useLocalSearchParams<{ hubId: string }>();
  const hubId = Number(params.hubId);
  const { token } = useSession();
  const api = useMemo(() => (token ? createStreamerApi(token, hubId) : null), [token, hubId]);
  const [hub, setHub] = useState<Hub | null>(() => cachedHub(token, hubId));
  const [data, setData] = useState<StreamerSnapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setData(await api.snapshot());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("streamer.errors.unavailable"));
    } finally {
      setRefreshing(false);
    }
  }, [api, t]);

  useEffect(() => {
    void load();
    if (token) void apiJson<Hub>(`/api/servers/${hubId}`, {}, token).then(setHub).catch(() => undefined);
    // Back from a Twitch or FACEIT sign-in in the browser.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => sub.remove();
  }, [load, token, hubId]);

  // Polled like web: every 5 s while my turn is called, a PUG I joined is open
  // or a session is running for the creator, otherwise every 20 s.
  const fast =
    data?.queue.mine?.status === "called" ||
    (data?.pug?.joined === true && data.pug.status === "open") ||
    (!!data && isCreator(data.role) && !!data.session);
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void load();
    }, fast ? 5000 : 20_000);
    return () => clearInterval(timer);
  }, [fast, !!data, load]);

  const perform = async (path: string, payload: unknown): Promise<boolean> => {
    if (!api || busy) return false;
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ text: await api.mutate(path, payload), error: false });
      await load();
      return true;
    } catch (cause) {
      setStatus({ text: cause instanceof Error ? cause.message : t("streamer.errors.generic"), error: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const link = async (provider: "twitch" | "faceit") => {
    if (!api) return;
    try {
      const { url } = await api.connect(provider);
      await Linking.openURL(url);
      setStatus({ text: provider === "twitch" ? t("streamer.notices.twitchFinish") : t("streamer.notices.faceitFinish"), error: false });
    } catch {
      setStatus({ text: provider === "twitch" ? t("streamer.errors.twitchUnavailable") : t("streamer.errors.faceitUnavailable"), error: true });
    }
  };
  const unlink = async (provider: "twitch" | "faceit") => {
    if (!api) return;
    try {
      await api.unlink(provider);
      setStatus({ text: provider === "twitch" ? t("streamer.notices.twitchUnlinked") : t("streamer.notices.faceitUnlinked"), error: false });
      await load();
    } catch (cause) {
      setStatus({ text: cause instanceof Error ? cause.message : t("streamer.errors.generic"), error: true });
    }
  };

  const voiceRooms = (hub?.channels ?? []).filter((room) => room.type === "voice").map((room) => ({ id: room.id, name: room.name }));
  const owner = !!data && isCreator(data.role);
  const live = !!data && isLive(data.config);
  const hubName = hub?.name ?? "";
  const displayName = data?.config.creatorName || hubName;

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.cyan} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{t("streamer.overview.eyebrowStreamer")}</Text>
          <Text style={styles.title} numberOfLines={1}>{owner ? t("streamer.overview.headingOwner") : t("streamer.overview.headingMember", { hub: hubName })}</Text>
        </View>
        {busy && <ActivityIndicator color={colors.cyan} />}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.cyan} onRefresh={() => { setRefreshing(true); void load(); }} />}
      >
        {!!status && <Text style={[styles.status, status.error && styles.statusError]} accessibilityLiveRegion="polite">{status.text}</Text>}
        {!data ? (
          error ? (
            <View style={styles.center}>
              <Text style={styles.error}>{error}</Text>
              <Button label={t("streamer.overview.retry")} onPress={() => void load()} />
            </View>
          ) : (
            <View style={styles.center}>
              <ActivityIndicator color={colors.cyan} />
              <Text style={styles.muted}>{t("streamer.overview.loading")}</Text>
            </View>
          )
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={[styles.badge, live ? styles.badgeLive : null]}>{live ? t("streamer.overview.badgeLive") : t("streamer.overview.badgeOffline")}</Text>
              <Text style={styles.heroTitle}>{live ? t("streamer.overview.heroLive", { name: displayName }) : t("streamer.overview.heroWelcome", { hub: hubName })}</Text>
              {!!data.config.tagline && <Text style={styles.muted}>{data.config.tagline}</Text>}
              {live && (!!data.config.streamTitle || !!data.config.game) && (
                <Text style={styles.body}>{[data.config.streamTitle, data.config.game].filter(Boolean).join(" · ")}</Text>
              )}
              {!!data.config.streamUrl && (
                <Button label={live ? t("streamer.overview.watchStream") : t("streamer.overview.visitChannel")} primary={live} onPress={() => void Linking.openURL(data.config.streamUrl)} />
              )}
            </View>

            {!!data.config.onboarding && (
              <Card title={t("streamer.panels.welcome")} icon="sparkles-outline">
                <Text style={styles.body}>{data.config.onboarding}</Text>
              </Card>
            )}

            <QueueSection data={data} owner={owner} perform={perform} api={api!} />
            <PugSection data={data} owner={owner} perform={perform} voiceRooms={voiceRooms} hubId={hubId} />
            <GiveawaysSection data={data} owner={owner} perform={perform} />
            <TwitchSection data={data} onLink={() => void link("twitch")} onRecheck={() => void (async () => { try { await api!.recheckTwitch(); setStatus({ text: t("streamer.notices.subscriptionChecked"), error: false }); await load(); } catch (cause) { setStatus({ text: cause instanceof Error ? cause.message : t("streamer.errors.generic"), error: true }); } })()} onUnlink={() => void unlink("twitch")} />
            <LeaderboardSection data={data} api={api!} onLink={() => void link("faceit")} onUnlink={() => void unlink("faceit")} />
            <HighlightsSection data={data} owner={owner} perform={perform} />

            <Card title={t("streamer.cards.events.title")} icon="calendar-outline">
              <Text style={styles.muted}>{owner ? t("streamer.cards.events.ownerDescription") : t("streamer.cards.events.memberDescription")}</Text>
              <Button label={t("streamer.events.viewAll")} onPress={() => router.push(`/hub-events/${hubId}` as never)} />
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 2 },
  scroll: { padding: 14, paddingBottom: 40, gap: 12 },
  center: { alignItems: "center", gap: 10, paddingVertical: 40 },
  hero: { padding: 16, gap: 8, borderRadius: 20, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  heroTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  badge: { alignSelf: "flex-start", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, color: colors.muted, fontSize: 11, fontWeight: "900", backgroundColor: colors.panel2 },
  badgeLive: { color: "#fff", backgroundColor: colors.red },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  error: { color: colors.red, fontSize: 13, textAlign: "center" },
  status: { padding: 10, borderRadius: 12, overflow: "hidden", color: colors.cyan, backgroundColor: colors.cyanSoft, fontSize: 13 },
  statusError: { color: colors.red, backgroundColor: colors.redSoft },
});
