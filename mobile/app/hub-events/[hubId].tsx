import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { cachedHub } from "@/src/lib/hub-list-cache";
import { listHubEvents } from "@/src/lib/hub-events-api";
import {
  addDays,
  applyEventUpdate,
  chatEventAnnouncement,
  formatCountdown,
  groupByDay,
  isEventLive,
  monthGrid,
  occurrenceKey,
  sameDay,
  startOfDay,
  type HubEvent,
} from "@/src/lib/hub-events-model";
import { EventComposerSheet } from "@/src/components/events/EventComposerSheet";
import { EventDetailSheet } from "@/src/components/events/EventDetailSheet";
import { formatDayHeading, formatMonth, formatTime, weekdayInitials } from "@/src/components/events/eventFormat";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { impactHaptic } from "@/src/lib/haptics";
import type { Hub } from "@/src/types";
import { colors } from "@/src/theme";

const AGENDA_DAYS = 60;

type CalendarMode = "agenda" | "month";

/** A Hub's calendar: upcoming agenda or a month grid, event details, RSVP and (for organisers) New event. */
export default function HubCalendarScreen() {
  const { t } = useTranslation(["events", "common"]);
  const params = useLocalSearchParams<{ hubId: string; event?: string; new?: string }>();
  const hubId = Number(params.hubId);
  const { token } = useSession();
  const { send, subscribe } = useRealtime();
  const [hub, setHub] = useState<Hub | null>(() => cachedHub(token, hubId));
  const [view, setView] = useState<CalendarMode>("agenda");
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [agendaDays, setAgendaDays] = useState(AGENDA_DAYS);
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ editing: HubEvent | null } | null>(null);

  const range = useMemo(() => {
    if (view === "month") {
      const grid = monthGrid(month);
      return { from: grid[0].getTime(), to: addDays(grid[grid.length - 1], 1).getTime() };
    }
    const from = startOfDay(new Date()).getTime();
    return { from, to: addDays(new Date(from), agendaDays).getTime() };
  }, [view, month, agendaDays]);

  const load = useCallback(async () => {
    if (!token || !hubId) return;
    setError("");
    try {
      const result = await listHubEvents(token, hubId, range.from, range.to);
      setEvents(result.events);
      setCanCreate(result.canCreate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("events.api.loadFailed"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, hubId, range.from, range.to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token || !hubId) return;
    void apiJson<Hub>(`/api/servers/${hubId}`, {}, token).then(setHub).catch(() => undefined);
  }, [token, hubId]);

  // Another member created, edited or cancelled an event in this Hub.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "HUB_EVENTS_CHANGED" && Number(event.serverId) === hubId) void load();
      }),
    [subscribe, hubId, load],
  );

  // Opened from a chat card (?event=<id>) or "New event" (?new=1).
  useEffect(() => {
    if (params.new === "1" && canCreate) setComposer({ editing: null });
  }, [params.new, canCreate]);
  useEffect(() => {
    if (!params.event || openKey) return;
    const match = events.find((item) => item.id === params.event);
    if (match) setOpenKey(occurrenceKey(match));
  }, [params.event, events, openKey]);

  const rooms = hub?.channels ?? [];
  const open = events.find((item) => occurrenceKey(item) === openKey) ?? null;
  const byDay = useMemo(() => groupByDay(events), [events]);
  const now = Date.now();

  const saved = (event: HubEvent, created: boolean) => {
    setComposer(null);
    impactHaptic();
    // Like web: an "everyone" event with an announcement room also gets a chat card.
    if (created && event.channelId && event.audience === "all") {
      send({ type: "CHAT_MESSAGE", text: chatEventAnnouncement(event), channelId: event.channelId, replyToId: null });
    }
    void load().then(() => setOpenKey(occurrenceKey(event)));
  };

  const renderEvent = (event: HubEvent) => {
    const live = isEventLive(event, now);
    const cancelled = event.cancelledAt !== null;
    return (
      <Pressable
        key={occurrenceKey(event)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.event, pressed && { opacity: 0.8 }]}
        onPress={() => setOpenKey(occurrenceKey(event))}
      >
        <View style={styles.eventTime}>
          <Text style={styles.eventTimeText}>{formatTime(event.occurrenceStart)}</Text>
          {live && <Text style={styles.live}>{t("events.status.live")}</Text>}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.eventTitle, cancelled && styles.struck]} numberOfLines={2}>{event.title}</Text>
          <Text style={styles.eventMeta} numberOfLines={1}>
            {cancelled
              ? t("events.kind.cancelled")
              : [
                  event.voiceChannelId ? t("events.kind.voice") : event.gameTag || t("events.kind.event"),
                  t("events.rsvp.goingCount", { count: event.rsvpCounts.going }),
                  !live && event.occurrenceStart > now ? formatCountdown(event.occurrenceStart, now) : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </Text>
        </View>
        {event.myRsvp === "going" && <Ionicons name="checkmark-circle" size={18} color={colors.green} />}
        {event.myRsvp === "maybe" && <Ionicons name="help-circle" size={18} color={colors.yellow} />}
      </Pressable>
    );
  };

  const agenda = Array.from(byDay.entries()).filter(([day]) => day >= startOfDay(new Date()).getTime());
  const selectedEvents = byDay.get(selectedDay.getTime()) ?? [];

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.cyan} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker} numberOfLines={1}>{hub?.name ?? ""}</Text>
          <Text style={styles.title}>{t("events.calendar.title")}</Text>
        </View>
        {canCreate && (
          <Pressable accessibilityRole="button" accessibilityLabel={t("events.composer.createTitle")} style={styles.add} onPress={() => setComposer({ editing: null })}>
            <Ionicons name="add" size={22} color="#061018" />
          </Pressable>
        )}
      </View>

      <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel={t("events.calendar.view")}>
        {(["agenda", "month"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === item }}
            style={[styles.segmentItem, view === item && styles.segmentOn]}
            onPress={() => setView(item)}
          >
            <Text style={[styles.segmentText, view === item && styles.segmentTextOn]}>{t(`events.calendar.views.${item}`)}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.cyan} onRefresh={() => { setRefreshing(true); void load(); }} />}
      >
        {!!error && <Text style={styles.error}>{error}</Text>}

        {view === "month" && (
          <View style={styles.month}>
            <View style={styles.monthNav}>
              <Pressable accessibilityRole="button" accessibilityLabel={t("events.calendar.previous.month")} style={styles.navButton} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                <Ionicons name="chevron-back" size={18} color={colors.text} />
              </Pressable>
              <Text style={styles.monthTitle}>{formatMonth(month.getTime())}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t("events.calendar.next.month")} style={styles.navButton} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                <Ionicons name="chevron-forward" size={18} color={colors.text} />
              </Pressable>
              <Pressable accessibilityRole="button" style={styles.today} onPress={() => { const today = startOfDay(new Date()); setMonth(today); setSelectedDay(today); }}>
                <Text style={styles.todayText}>{t("events.calendar.today")}</Text>
              </Pressable>
            </View>
            <View style={styles.weekRow}>
              {weekdayInitials().map((day, index) => <Text key={index} style={styles.weekday}>{day}</Text>)}
            </View>
            <View style={styles.grid}>
              {monthGrid(month).map((day) => {
                const count = byDay.get(day.getTime())?.length ?? 0;
                const inMonth = day.getMonth() === month.getMonth();
                const selected = sameDay(day, selectedDay);
                const today = sameDay(day, new Date());
                return (
                  <Pressable
                    key={day.getTime()}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t("events.calendar.dayLabel", { day: formatDayHeading(day.getTime()), count })}
                    style={[styles.cell, selected && styles.cellSelected]}
                    onPress={() => setSelectedDay(day)}
                  >
                    <Text style={[styles.cellText, !inMonth && styles.cellOut, today && styles.cellToday]}>{day.getDate()}</Text>
                    <View style={styles.dots}>
                      {Array.from({ length: Math.min(count, 3) }, (_, index) => <View key={index} style={styles.dot} />)}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.dayHeading}>{formatDayHeading(selectedDay.getTime())}</Text>
            {selectedEvents.length === 0 ? (
              <View style={styles.emptyRow}>
                <Text style={styles.muted}>{t("events.calendar.emptyTitle")}</Text>
                {canCreate && (
                  <Pressable accessibilityRole="button" onPress={() => setComposer({ editing: null })}>
                    <Text style={styles.link}>{t("events.calendar.plan")}</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              selectedEvents.map(renderEvent)
            )}
          </View>
        )}

        {view === "agenda" &&
          (loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.cyan} />
          ) : agenda.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={34} color={colors.muted} />
              <Text style={styles.emptyTitle}>{t("events.calendar.railEmpty")}</Text>
              <Text style={styles.muted}>{canCreate ? t("events.calendar.railCreate") : t("events.calendar.railWait")}</Text>
              {canCreate && (
                <Pressable accessibilityRole="button" style={styles.primary} onPress={() => setComposer({ editing: null })}>
                  <Text style={styles.primaryText}>{t("events.calendar.plan")}</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <>
              {agenda.map(([day, items]) => (
                <View key={day} style={styles.daySection}>
                  <Text style={styles.dayHeading}>{sameDay(new Date(day), new Date()) ? t("events.calendar.today") : formatDayHeading(day)}</Text>
                  {items.map(renderEvent)}
                </View>
              ))}
              <Pressable accessibilityRole="button" style={styles.more} onPress={() => setAgendaDays((days) => days + AGENDA_DAYS)}>
                <Text style={styles.link}>{t("events.calendar.next.agenda")}</Text>
              </Pressable>
            </>
          ))}
      </ScrollView>

      {open && (
        <EventDetailSheet
          event={open}
          hubId={hubId}
          rooms={rooms}
          token={token}
          onClose={() => setOpenKey(null)}
          onChanged={(updated) => setEvents((current) => applyEventUpdate(current, updated))}
          onEdit={(event) => {
            setOpenKey(null);
            setComposer({ editing: event });
          }}
          onCancelled={() => {
            setOpenKey(null);
            void load();
          }}
        />
      )}
      {composer && (
        <EventComposerSheet
          visible
          hubId={hubId}
          rooms={rooms}
          token={token}
          editing={composer.editing}
          defaultChannelId={null}
          onClose={() => setComposer(null)}
          onSaved={saved}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 2 },
  add: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  segment: { flexDirection: "row", marginHorizontal: 14, padding: 3, borderRadius: 12, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  segmentItem: { flex: 1, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colors.panel },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  segmentTextOn: { color: colors.text },
  scroll: { padding: 14, paddingBottom: 40, gap: 12 },
  error: { color: colors.red, fontSize: 13, fontWeight: "700" },
  daySection: { gap: 8 },
  dayHeading: { color: colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase", marginTop: 6 },
  event: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  eventTime: { width: 64, gap: 3 },
  eventTimeText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  live: { alignSelf: "flex-start", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, color: "#061018", fontSize: 10, fontWeight: "900", backgroundColor: colors.green },
  eventTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  struck: { textDecorationLine: "line-through", color: colors.muted },
  eventMeta: { color: colors.faint, fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 48, paddingHorizontal: 24 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  emptyRow: { gap: 6, paddingVertical: 8 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: "center" },
  link: { color: colors.cyan, fontSize: 14, fontWeight: "800" },
  primary: { marginTop: 6, paddingHorizontal: 18, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  primaryText: { color: "#061018", fontSize: 15, fontWeight: "900" },
  more: { alignItems: "center", padding: 12 },
  month: { gap: 8 },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  navButton: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  monthTitle: { flex: 1, textAlign: "center", color: colors.text, fontSize: 16, fontWeight: "900" },
  today: { paddingHorizontal: 10, height: 34, borderRadius: 10, justifyContent: "center", backgroundColor: colors.panel2 },
  todayText: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", color: colors.faint, fontSize: 11, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 12 },
  cellSelected: { backgroundColor: colors.cyanSoft },
  cellText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  cellOut: { color: colors.faint },
  cellToday: { color: colors.cyan, fontWeight: "900" },
  dots: { flexDirection: "row", gap: 2, height: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.cyan },
});
