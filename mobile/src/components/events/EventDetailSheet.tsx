import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Channel } from "@/src/types";
import { cancelHubEvent, downloadHubEventIcs } from "@/src/lib/hub-events-api";
import { formatCountdown, isEventLive, isEventOver, type HubEvent } from "@/src/lib/hub-events-model";
import { formatTimeRange } from "./eventFormat";
import { RsvpControl } from "./RsvpControl";
import { colors } from "@/src/theme";

/** Everything about one event occurrence, like web's EventDetailDrawer. */
export function EventDetailSheet({
  event,
  hubId,
  rooms,
  token,
  onClose,
  onChanged,
  onEdit,
  onCancelled,
}: {
  event: HubEvent | null;
  hubId: number;
  rooms: readonly Channel[];
  token: string | null;
  onClose: () => void;
  onChanged: (event: HubEvent) => void;
  onEdit: (event: HubEvent) => void;
  onCancelled: (eventId: string) => void;
}) {
  const { t } = useTranslation(["events", "common"]);
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<"" | "ics" | "cancel">("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!event) return null;
  const voiceRoom = rooms.find((room) => room.id === event.voiceChannelId) ?? null;
  const textRoom = rooms.find((room) => room.id === event.channelId) ?? null;
  const cancelled = event.cancelledAt !== null;
  const live = isEventLive(event, now);
  const over = isEventOver(event, now);

  const addToCalendar = async () => {
    if (!token || busy) return;
    setBusy("ics");
    try {
      const file = await downloadHubEventIcs(token, hubId, event.id, event.title);
      if (Platform.OS === "ios") await Share.share({ url: file.uri, title: file.fileName });
      else await Share.share({ title: file.fileName, message: file.text });
    } catch (cause) {
      Alert.alert(t("events.drawer.addToCalendar"), cause instanceof Error ? cause.message : t("events.api.icsFailed"));
    } finally {
      setBusy("");
    }
  };

  const cancelEvent = () =>
    Alert.alert(t("events.drawer.cancelEvent"), event.title, [
      { text: t("events.drawer.keep"), style: "cancel" },
      {
        text: t("events.drawer.confirmCancelYes"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            if (!token) return;
            setBusy("cancel");
            try {
              await cancelHubEvent(token, hubId, event.id);
              onCancelled(event.id);
            } catch (cause) {
              Alert.alert(t("events.drawer.cancelEvent"), cause instanceof Error ? cause.message : t("events.drawer.cancelFailed"));
            } finally {
              setBusy("");
            }
          })(),
      },
    ]);

  const openRoom = (room: Channel) => {
    onClose();
    const path = room.type === "voice" ? "voice" : "channel";
    router.push(`/${path}/${room.id}?hubId=${hubId}&name=${encodeURIComponent(room.name)}` as never);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.topBar}>
          <Text style={styles.kicker}>{t("events.drawer.hubEvent")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("events.drawer.close")} hitSlop={8} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          {!!event.coverUrl && /^https:\/\//.test(event.coverUrl) && <Image source={{ uri: event.coverUrl }} style={styles.cover} resizeMode="cover" />}
          <View style={styles.badges}>
            {live && <Text style={[styles.badge, styles.badgeLive]}>{t("events.status.live")}</Text>}
            {cancelled && <Text style={[styles.badge, styles.badgeCancelled]}>{t("events.kind.cancelled")}</Text>}
            {over && !cancelled && <Text style={styles.badge}>{t("events.status.ended")}</Text>}
            {event.recurrence !== "none" && <Text style={styles.badge}>{t(`events.composer.repeatsChip.${event.recurrence}`)}</Text>}
            {!!event.gameTag && <Text style={styles.badge}>{event.gameTag}</Text>}
          </View>
          <Text style={[styles.title, cancelled && styles.struck]} accessibilityRole="header">{event.title}</Text>

          <Section label={t("events.drawer.when")}>
            <Text style={styles.value}>
              {formatTimeRange(event.occurrenceStart, event.occurrenceEnd)}
              {!cancelled && !over && !live ? t("events.drawer.startsIn", { countdown: formatCountdown(event.occurrenceStart, now) }) : ""}
              {over ? t("events.drawer.ended") : ""}
            </Text>
          </Section>

          {(voiceRoom || textRoom) && (
            <Section label={t("events.drawer.where")}>
              {voiceRoom && (
                <Pressable accessibilityRole="button" style={styles.roomButton} onPress={() => openRoom(voiceRoom)}>
                  <Ionicons name="volume-high-outline" size={17} color={colors.cyan} />
                  <Text style={styles.roomText}>{t("events.drawer.joinVoice", { name: voiceRoom.name })}</Text>
                </Pressable>
              )}
              {textRoom && (
                <Pressable accessibilityRole="button" style={styles.roomButton} onPress={() => openRoom(textRoom)}>
                  <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.cyan} />
                  <Text style={styles.roomText}>{t("events.drawer.openRoom", { name: textRoom.name })}</Text>
                </Pressable>
              )}
            </Section>
          )}

          {!!event.description && <Text style={styles.description}>{event.description}</Text>}

          <Section label={t("events.drawer.going")}>
            <RsvpControl event={event} token={token} onChanged={onChanged} />
          </Section>

          <Text style={styles.audience}>
            {event.audience === "all"
              ? t("events.drawer.audienceAll")
              : event.audience === "roles"
                ? t("events.drawer.audienceRoles", { count: event.audienceIds.length })
                : t("events.drawer.audienceMembers", { count: event.audienceIds.length })}
          </Text>

          {!cancelled && (
            <Pressable accessibilityRole="button" style={styles.action} disabled={!!busy} onPress={() => void addToCalendar()}>
              {busy === "ics" ? <ActivityIndicator color={colors.cyan} /> : <Ionicons name="calendar-outline" size={18} color={colors.cyan} />}
              <Text style={styles.actionText}>{t("events.drawer.addToCalendar")}</Text>
            </Pressable>
          )}
          {event.canManage && !cancelled && (
            <View style={styles.manageRow}>
              <Pressable accessibilityRole="button" style={[styles.action, { flex: 1 }]} disabled={!!busy} onPress={() => onEdit(event)}>
                <Ionicons name="create-outline" size={18} color={colors.cyan} />
                <Text style={styles.actionText}>{t("events.drawer.edit")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={[styles.action, styles.danger, { flex: 1 }]} disabled={!!busy} onPress={cancelEvent}>
                {busy === "cancel" ? <ActivityIndicator color={colors.red} /> : <Ionicons name="close-circle-outline" size={18} color={colors.red} />}
                <Text style={[styles.actionText, { color: colors.red }]}>{t("events.drawer.cancelEvent")}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.solid },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  kicker: { flex: 1, color: colors.cyan, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  close: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  content: { padding: 16, gap: 14 },
  cover: { width: "100%", aspectRatio: 16 / 7, borderRadius: 14, backgroundColor: colors.panel2 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, color: colors.muted, fontSize: 11, fontWeight: "900", backgroundColor: colors.panel2 },
  badgeLive: { color: "#061018", backgroundColor: colors.green },
  badgeCancelled: { color: colors.red, backgroundColor: colors.redSoft },
  title: { color: colors.text, fontSize: 22, fontWeight: "900" },
  struck: { textDecorationLine: "line-through", color: colors.muted },
  section: { gap: 6 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  value: { color: colors.text, fontSize: 15, fontWeight: "700", lineHeight: 21 },
  roomButton: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  roomText: { color: colors.cyan, fontSize: 15, fontWeight: "800" },
  description: { color: colors.text, fontSize: 15, lineHeight: 22 },
  audience: { color: colors.faint, fontSize: 12, fontWeight: "700" },
  action: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.redSoft },
  actionText: { color: colors.cyan, fontSize: 15, fontWeight: "800" },
  manageRow: { flexDirection: "row", gap: 10 },
});
