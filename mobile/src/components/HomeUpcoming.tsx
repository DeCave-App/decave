// Home: Jump back in (the last voice room) and the next events across my Hubs,
// like web's jumpBack and events widgets (src/app/views/HomePage.tsx).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { listHubEvents } from "@/src/lib/hub-events-api";
import { eventEnd, formatCountdown, isEventLive, type HubEvent } from "@/src/lib/hub-events-model";
import { loadLastVoiceRoom, onLastVoiceRoomSaved, voiceRoomHref, type LastVoiceRoom } from "@/src/lib/last-voice-room";
import type { Hub } from "@/src/types";
import { colors } from "@/src/theme";

const EVENT_DAYS = 14;
/** Hubs asked for events, so a long Hub list doesn't fan out into dozens of requests. */
const EVENT_HUBS_MAX = 12;
const EVENTS_SHOWN = 5;

export function JumpBackCard({ hubs, connectedChannelId }: { hubs: Hub[]; connectedChannelId: number | null }) {
  const { t } = useTranslation(["chat"]);
  const [room, setRoom] = useState<LastVoiceRoom | null>(null);
  useEffect(() => {
    void loadLastVoiceRoom().then(setRoom).catch(() => undefined);
    return onLastVoiceRoomSaved(setRoom);
  }, []);
  // Hidden while already in a voice room (the live banner covers it) or once the room is gone.
  const hub = room ? hubs.find((item) => item.id === room.hubId) : null;
  const stillThere = !!room && (room.squad || !!hub?.channels?.some((channel) => channel.id === room.channelId));
  if (!room || connectedChannelId !== null || !stillThere) return null;
  return (
    <Pressable accessibilityRole="button" style={styles.jump} onPress={() => router.push(voiceRoomHref(room) as never)}>
      <View style={styles.jumpIcon}>
        <Ionicons name="flash-outline" size={18} color={colors.cyan} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>{t("chat.home.jumpBack.jumpBackIn")}</Text>
        <Text style={styles.jumpTitle} numberOfLines={1}>
          {room.name}
          {hub ? <Text style={styles.muted}> · {hub.name}</Text> : null}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

type UpcomingEvent = HubEvent & { hubName: string };

export function UpcomingEventsCard({ hubs, token }: { hubs: Hub[]; token: string | null }) {
  const { t } = useTranslation(["chat", "events"]);
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const hubKey = hubs.slice(0, EVENT_HUBS_MAX).map((hub) => hub.id).join(",");

  useEffect(() => {
    if (!token || !hubKey) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    const now = Date.now();
    const to = now + EVENT_DAYS * 86_400_000;
    const asked = hubs.slice(0, EVENT_HUBS_MAX);
    void Promise.all(
      asked.map((hub) =>
        listHubEvents(token, hub.id, now - 6 * 3_600_000, to)
          .then((result) => result.events.map((event) => ({ ...event, hubName: hub.name })))
          .catch(() => [] as UpcomingEvent[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      setEvents(
        lists
          .flat()
          .filter((event) => event.cancelledAt === null && eventEnd(event) > Date.now())
          .sort((a, b) => a.occurrenceStart - b.occurrenceStart),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [token, hubKey]);

  const now = Date.now();
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="calendar-outline" size={16} color={colors.cyan} />
        <Text style={styles.kicker}>{t("chat.home.widget.events.title")}</Text>
      </View>
      {events === null ? (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={colors.cyan} />
          <Text style={styles.muted}>{t("chat.home.events.syncingHint")}</Text>
        </View>
      ) : events.length === 0 ? (
        <>
          <Text style={styles.title}>{t("chat.home.events.emptyTitle")}</Text>
          <Text style={styles.muted}>{t("chat.home.events.emptyHint")}</Text>
        </>
      ) : (
        events.slice(0, EVENTS_SHOWN).map((event) => {
          const live = isEventLive(event, now);
          return (
            <Pressable
              key={`${event.id}:${event.occurrenceStart}`}
              accessibilityRole="button"
              style={styles.event}
              onPress={() => router.push(`/hub-events/${event.hubId}?event=${encodeURIComponent(event.id)}` as never)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{event.title}</Text>
                <Text style={styles.muted} numberOfLines={1}>{event.hubName}</Text>
              </View>
              <Text style={[styles.when, live && styles.live]}>{live ? t("chat.home.events.liveNow") : formatCountdown(event.occurrenceStart, now)}</Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  jump: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 12, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  jumpIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft },
  jumpTitle: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 2 },
  card: { padding: 14, gap: 8, marginBottom: 16, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: colors.text, fontSize: 14, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  event: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  when: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  live: { color: colors.green },
});
