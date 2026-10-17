import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { listHubEvents } from "@/src/lib/hub-events-api";
import {
  DEFAULT_EVENT_DURATION_MS,
  formatCountdown,
  isEventLive,
  type ChatEventPayload,
  type HubEvent,
} from "@/src/lib/hub-events-model";
import { dateLocale } from "@/src/lib/date-locale";
import { RsvpControl } from "./RsvpControl";
import { formatTimeRange } from "./eventFormat";
import { colors } from "@/src/theme";

// API events announced in chat, by id, so scrolling back and forth doesn't refetch.
const announced = new Map<string, HubEvent | null>();

/** Chat card for `__DECAVE_EVENT__` messages: date, countdown, RSVP (for API events) and Details, like web. */
export function EventChatCard({ payload, hubId, token }: { payload: ChatEventPayload; hubId: number; token: string | null }) {
  const { t } = useTranslation(["events"]);
  const [now, setNow] = useState(() => Date.now());
  const [event, setEvent] = useState<HubEvent | null>(() => (payload.eventId ? (announced.get(payload.eventId) ?? null) : null));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const eventId = payload.eventId;
    if (!eventId || !token || !hubId || announced.has(eventId)) return;
    const start = Date.parse(payload.startAt);
    if (!Number.isFinite(start)) return;
    let cancelled = false;
    // The announcement carries the series start; look just around it.
    void listHubEvents(token, hubId, start - 60_000, start + 60_000)
      .then((result) => {
        const match = result.events.find((item) => item.id === eventId) ?? null;
        announced.set(eventId, match);
        if (!cancelled) setEvent(match);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [payload.eventId, payload.startAt, token, hubId]);

  const start = event ? event.occurrenceStart : Date.parse(payload.startAt);
  const valid = Number.isFinite(start);
  const end = event ? (event.occurrenceEnd ?? start + DEFAULT_EVENT_DURATION_MS) : start + DEFAULT_EVENT_DURATION_MS;
  const title = event?.title ?? payload.title;
  const description = event?.description ?? payload.description;
  const cancelled = Boolean(event?.cancelledAt);
  const live = event ? isEventLive(event, now) : valid && start <= now && end > now;
  const ended = valid && end <= now;
  const date = new Date(valid ? start : 0);

  return (
    <View style={[styles.card, cancelled && { opacity: 0.7 }]}>
      <View style={styles.row}>
        <View style={styles.date}>
          <Text style={styles.day}>{valid ? date.getDate() : "?"}</Text>
          <Text style={styles.monthText}>{valid ? date.toLocaleDateString(dateLocale(), { month: "short" }).toUpperCase() : t("events.card.dateFallback")}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.kickerRow}>
            <Text style={styles.kicker}>{t("events.card.kicker")}</Text>
            {live && <Text style={[styles.badge, styles.live]}>{t("events.status.live")}</Text>}
            {cancelled && <Text style={[styles.badge, styles.cancelled]}>{t("events.kind.cancelled")}</Text>}
            {!live && !ended && !cancelled && valid && <Text style={styles.badge}>{formatCountdown(start, now)}</Text>}
            {ended && !cancelled && <Text style={styles.badge}>{t("events.status.ended")}</Text>}
          </View>
          <Text style={[styles.title, cancelled && styles.struck]} numberOfLines={2}>{title}</Text>
          {valid && <Text style={styles.when}>{formatTimeRange(start, event ? event.occurrenceEnd : null)}</Text>}
        </View>
      </View>
      {!!description && <Text style={styles.description} numberOfLines={3}>{description}</Text>}
      {event && !cancelled && <RsvpControl event={event} token={token} onChanged={(updated) => { announced.set(updated.id, updated); setEvent(updated); }} />}
      {payload.eventId && (
        <Pressable accessibilityRole="button" style={styles.details} onPress={() => router.push(`/hub-events/${hubId}?event=${encodeURIComponent(payload.eventId!)}` as never)}>
          <Text style={styles.detailsText}>{t("events.card.details")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 4, padding: 12, gap: 10, borderRadius: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, maxWidth: 440 },
  row: { flexDirection: "row", gap: 12 },
  date: { width: 50, height: 54, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft },
  day: { color: colors.cyan, fontSize: 20, fontWeight: "900" },
  monthText: { color: colors.cyan, fontSize: 10, fontWeight: "900" },
  kickerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  badge: { overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, color: colors.muted, fontSize: 10, fontWeight: "900", backgroundColor: colors.panel },
  live: { color: "#061018", backgroundColor: colors.green },
  cancelled: { color: colors.red, backgroundColor: colors.redSoft },
  title: { color: colors.text, fontSize: 15, fontWeight: "900" },
  struck: { textDecorationLine: "line-through" },
  when: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  description: { color: colors.text, fontSize: 13, lineHeight: 18 },
  details: { alignSelf: "flex-start", paddingVertical: 4 },
  detailsText: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
});
