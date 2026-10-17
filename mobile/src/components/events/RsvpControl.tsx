import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { HubEventRsvpStatus } from "../../../../shared/hub-events";
import { HubEventApiError, rsvpHubEvent } from "@/src/lib/hub-events-api";
import { isEventFull, isEventOver, type HubEvent } from "@/src/lib/hub-events-model";
import { tapHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";

const OPTIONS: HubEventRsvpStatus[] = ["going", "maybe", "declined"];

/** Going / Maybe / Can't go with counts; tapping your current answer clears it, like web. */
export function RsvpControl({
  event,
  token,
  onChanged,
}: {
  event: HubEvent;
  token: string | null;
  onChanged: (event: HubEvent) => void;
}) {
  const { t } = useTranslation(["events"]);
  const [busy, setBusy] = useState<HubEventRsvpStatus | "clear" | null>(null);
  const [error, setError] = useState("");
  const full = isEventFull(event);
  const over = isEventOver(event, Date.now());
  const cancelled = event.cancelledAt !== null;

  const choose = async (status: HubEventRsvpStatus) => {
    if (busy || !token) return;
    tapHaptic();
    const next = event.myRsvp === status ? null : status;
    setBusy(next ?? "clear");
    setError("");
    try {
      onChanged(await rsvpHubEvent(token, event.hubId, event.id, next));
    } catch (cause) {
      setError(
        cause instanceof HubEventApiError && cause.code === "EVENT_FULL"
          ? t("events.rsvp.fullError")
          : cause instanceof Error
            ? cause.message
            : t("events.rsvp.saveFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  if (over || cancelled) return <Text style={styles.note}>{cancelled ? t("events.kind.cancelled") : t("events.rsvp.ended")}</Text>;

  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t("events.rsvp.label")}>
        {OPTIONS.map((option) => {
          const active = event.myRsvp === option;
          const disabled = busy !== null || (option === "going" && full);
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              accessibilityHint={option === "going" && full ? t("events.rsvp.full") : undefined}
              disabled={disabled}
              style={[styles.button, active && (option === "declined" ? styles.activeDeclined : styles.active), disabled && !active && styles.disabled]}
              onPress={() => void choose(option)}
            >
              {busy === option ? (
                <ActivityIndicator size="small" color={colors.cyan} />
              ) : (
                <>
                  <Text style={[styles.label, active && styles.labelActive]}>{t(`events.rsvp.${option}`)}</Text>
                  <Text style={[styles.count, active && styles.labelActive]}>{event.rsvpCounts[option]}</Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
      {event.capacity !== null && (
        <Text style={styles.note}>
          {t("events.rsvp.goingSpots", {
            count: event.rsvpCounts.going,
            left: Math.max(0, event.capacity - event.rsvpCounts.going),
            capacity: event.capacity,
          })}
        </Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: "row", gap: 8 },
  button: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  active: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  activeDeclined: { borderColor: colors.red, backgroundColor: colors.redSoft },
  disabled: { opacity: 0.45 },
  label: { color: colors.text, fontSize: 13, fontWeight: "800" },
  labelActive: { color: colors.cyan },
  count: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  note: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  error: { color: colors.red, fontSize: 12, fontWeight: "700" },
});
