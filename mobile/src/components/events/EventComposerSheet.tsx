import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HUB_EVENT_AUDIENCES, HUB_EVENT_RECURRENCES } from "../../../../shared/hub-events";
import { apiJson } from "@/src/lib/api";
import { createHubEvent, HubEventApiError, updateHubEvent, type HubEventBody } from "@/src/lib/hub-events-api";
import {
  DEFAULT_EVENT_DURATION_MS,
  defaultEventStart,
  draftEndsAt,
  EVENT_DURATIONS,
  EVENT_LIMITS,
  EVENT_REMINDERS,
  validateEventDraft,
  viewerTimeZone,
  type EventDraft,
  type HubEvent,
} from "@/src/lib/hub-events-model";
import type { Channel } from "@/src/types";
import { dateLocale } from "@/src/lib/date-locale";
import { hour12Preference } from "@/src/lib/account-preferences-store";
import { colorMode, colors } from "@/src/theme";

type Role = { id: string; name: string };
type Member = { userId: string; username: string };

function initialDraft(editing: HubEvent | null, rooms: readonly Channel[], defaultChannelId: number | null): EventDraft {
  const duration = editing ? (editing.endsAt !== null ? editing.endsAt - editing.startsAt : null) : DEFAULT_EVENT_DURATION_MS;
  const preset = duration !== null && EVENT_DURATIONS.some((item) => item.ms === duration);
  const startsAt = editing?.startsAt ?? defaultEventStart(Date.now());
  return {
    title: editing?.title ?? "",
    description: editing?.description ?? "",
    coverUrl: editing?.coverUrl ?? "",
    startsAt,
    endMode: duration === null ? "none" : preset ? "duration" : "end",
    durationMs: preset && duration ? duration : DEFAULT_EVENT_DURATION_MS,
    endsAtInput: startsAt + (duration ?? DEFAULT_EVENT_DURATION_MS),
    recurrence: editing?.recurrence ?? "none",
    voiceChannelId: editing ? editing.voiceChannelId : null,
    channelId: editing ? editing.channelId : (defaultChannelId ?? rooms.find((room) => room.type === "text")?.id ?? null),
    audience: editing?.audience ?? "all",
    roleIds: editing?.audience === "roles" ? editing.audienceIds : [],
    memberIds: editing?.audience === "members" ? editing.audienceIds : [],
    reminderMinutes: editing ? editing.reminderMinutes : 30,
    capacity: editing?.capacity ? String(editing.capacity) : "",
    gameTag: editing?.gameTag ?? "",
  };
}

/** Create or edit a Hub event, like web's EventComposerSheet (both steps on one page). */
export function EventComposerSheet({
  visible,
  hubId,
  rooms,
  token,
  editing,
  defaultChannelId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  hubId: number;
  rooms: readonly Channel[];
  token: string | null;
  editing: HubEvent | null;
  defaultChannelId: number | null;
  onClose: () => void;
  onSaved: (event: HubEvent, created: boolean) => void;
}) {
  const { t } = useTranslation(["events", "common"]);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<EventDraft>(() => initialDraft(editing, rooms, defaultChannelId));
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    setDraft(initialDraft(editing, rooms, defaultChannelId));
    setSubmitted(false);
    setServerError("");
    setFieldError({});
    setMemberSearch("");
    // Re-seed only when the sheet opens.
  }, [visible, editing?.id]);

  useEffect(() => {
    if (!visible || !token) return;
    let cancelled = false;
    void apiJson<Role[]>(`/api/servers/${hubId}/roles`, {}, token)
      .then((value) => { if (!cancelled && Array.isArray(value)) setRoles(value); })
      .catch(() => undefined);
    void apiJson<Member[]>(`/api/servers/${hubId}/members`, {}, token)
      .then((value) => { if (!cancelled && Array.isArray(value)) setMembers(value); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [visible, token, hubId]);

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const errors = validateEventDraft(draft, Date.now(), editing);
  const errorText = (field: string) => {
    if (fieldError[field]) return fieldError[field];
    const error = submitted ? errors[field] : undefined;
    return error ? t(`events.composer.errors.${error.key}`, { max: error.params?.max ?? 0 }) : "";
  };
  const textRooms = rooms.filter((room) => room.type === "text");
  const voiceRooms = rooms.filter((room) => room.type === "voice");
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return members.filter((member) => !q || member.username.toLowerCase().includes(q)).slice(0, 50);
  }, [members, memberSearch]);

  const save = async () => {
    setSubmitted(true);
    setFieldError({});
    if (Object.keys(errors).length || busy || !token) return;
    const endsAt = draftEndsAt(draft);
    const body: HubEventBody = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      coverUrl: draft.coverUrl.trim() || null,
      endsAt,
      timezone: editing?.timezone ?? viewerTimeZone(),
      recurrence: draft.recurrence,
      audience: draft.audience,
      audienceIds: draft.audience === "roles" ? draft.roleIds : draft.audience === "members" ? draft.memberIds : [],
      reminderMinutes: draft.reminderMinutes,
      capacity: draft.capacity.trim() ? Number(draft.capacity) : null,
      gameTag: draft.gameTag.trim() || null,
      channelId: draft.channelId,
      voiceChannelId: draft.voiceChannelId,
    };
    if (!editing || draft.startsAt !== editing.startsAt) body.startsAt = draft.startsAt;
    setBusy(true);
    setServerError("");
    try {
      const saved = editing ? await updateHubEvent(token, hubId, editing.id, body) : await createHubEvent(token, hubId, body);
      onSaved(saved, !editing);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("events.composer.saveFailed");
      if (cause instanceof HubEventApiError && cause.field) setFieldError({ [cause.field]: message });
      else setServerError(message);
    } finally {
      setBusy(false);
    }
  };

  const toggleId = (key: "roleIds" | "memberIds", id: string) =>
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id],
    }));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("events.composer.close")} hitSlop={8} onPress={onClose}>
            <Text style={styles.headerAction}>{t("events.composer.cancel")}</Text>
          </Pressable>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {editing ? t("events.composer.editTitle") : t("events.composer.createTitle")}
          </Text>
          <Pressable accessibilityRole="button" disabled={busy} hitSlop={8} onPress={() => void save()}>
            {busy ? <ActivityIndicator color={colors.cyan} /> : <Text style={[styles.headerAction, styles.save]}>{editing ? t("events.composer.save") : t("events.composer.createTitle")}</Text>}
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          <Field label={t("events.composer.title")} error={errorText("title")}>
            <TextInput
              value={draft.title}
              onChangeText={(value) => set("title", value)}
              placeholder={t("events.composer.titlePlaceholder")}
              placeholderTextColor={colors.faint}
              maxLength={EVENT_LIMITS.titleMax}
              style={styles.input}
            />
          </Field>

          <Field label={t("events.composer.starts")} error={errorText("startsAt")}>
            <DateTimeField value={draft.startsAt} minimumDate={editing ? undefined : new Date()} onChange={(value) => setDraft((current) => ({ ...current, startsAt: value, endsAtInput: current.endMode === "end" ? Math.max(current.endsAtInput, value + 30 * 60_000) : current.endsAtInput }))} />
          </Field>

          <Field label={t("events.composer.ends")} error={errorText("endsAt")}>
            <Chips
              options={[
                { id: "duration", label: t("events.composer.endDuration") },
                { id: "end", label: t("events.composer.endTime") },
                { id: "none", label: t("events.composer.endNone") },
              ]}
              value={draft.endMode}
              onChange={(value) => set("endMode", value as EventDraft["endMode"])}
            />
            {draft.endMode === "duration" && (
              <Chips
                options={EVENT_DURATIONS.map((item) => ({ id: String(item.ms), label: t(`events.composer.durations.${item.id}`) }))}
                value={String(draft.durationMs)}
                onChange={(value) => set("durationMs", Number(value))}
              />
            )}
            {draft.endMode === "end" && (
              <DateTimeField value={draft.endsAtInput} minimumDate={new Date(draft.startsAt)} onChange={(value) => set("endsAtInput", value)} />
            )}
          </Field>

          <Field label={t("events.composer.repeats")}>
            <Chips
              options={HUB_EVENT_RECURRENCES.map((item) => ({ id: item, label: t(`events.composer.recurrence.${item}`) }))}
              value={draft.recurrence}
              onChange={(value) => set("recurrence", value as EventDraft["recurrence"])}
            />
          </Field>

          {voiceRooms.length > 0 && (
            <Field label={t("events.composer.voiceRoom")} error={errorText("voiceChannelId")}>
              <Chips
                options={[{ id: "", label: t("events.composer.noVoiceRoom") }, ...voiceRooms.map((room) => ({ id: String(room.id), label: room.name }))]}
                value={draft.voiceChannelId ? String(draft.voiceChannelId) : ""}
                onChange={(value) => set("voiceChannelId", value ? Number(value) : null)}
              />
            </Field>
          )}

          {textRooms.length > 0 && (
            <Field label={t("events.composer.announce")} error={errorText("channelId")}>
              <Chips
                options={[{ id: "", label: t("events.composer.noAnnounce") }, ...textRooms.map((room) => ({ id: String(room.id), label: `#${room.name}` }))]}
                value={draft.channelId ? String(draft.channelId) : ""}
                onChange={(value) => set("channelId", value ? Number(value) : null)}
              />
            </Field>
          )}

          <Field label={stripTags(t("events.composer.description"))} error={errorText("description")}>
            <TextInput
              value={draft.description}
              onChangeText={(value) => set("description", value)}
              placeholder={t("events.composer.descriptionPlaceholder")}
              placeholderTextColor={colors.faint}
              maxLength={EVENT_LIMITS.descriptionMax}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.multiline]}
            />
          </Field>

          <Field label={stripTags(t("events.composer.cover"))} error={errorText("coverUrl")}>
            <TextInput
              value={draft.coverUrl}
              onChangeText={(value) => set("coverUrl", value)}
              placeholder={URL_EXAMPLE}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
          </Field>

          <Text style={styles.sectionTitle}>{t("events.composer.audience")}</Text>
          <Field label={t("events.composer.audienceLabel")} error={errorText("audienceIds")}>
            <Chips
              options={HUB_EVENT_AUDIENCES.map((item) => ({ id: item, label: t(`events.composer.audiences.${item}`) }))}
              value={draft.audience}
              onChange={(value) => set("audience", value as EventDraft["audience"])}
            />
            {draft.audience === "roles" &&
              (roles.length === 0 ? (
                <Text style={styles.hint}>{t("events.composer.noRoles")}</Text>
              ) : (
                <View style={styles.wrap}>
                  {roles.map((role) => (
                    <Toggle key={role.id} label={role.name} on={draft.roleIds.includes(role.id)} onPress={() => toggleId("roleIds", role.id)} />
                  ))}
                </View>
              ))}
            {draft.audience === "members" && (
              <View style={{ gap: 8 }}>
                <TextInput
                  value={memberSearch}
                  onChangeText={setMemberSearch}
                  placeholder={t("events.composer.searchPlaceholder")}
                  accessibilityLabel={t("events.composer.search")}
                  placeholderTextColor={colors.faint}
                  style={styles.input}
                />
                <Text style={styles.hint}>{t("events.composer.selected", { count: draft.memberIds.length })}</Text>
                <View style={styles.wrap}>
                  {filteredMembers.length === 0 ? (
                    <Text style={styles.hint}>{t("events.composer.noMatch")}</Text>
                  ) : (
                    filteredMembers.map((member) => (
                      <Toggle key={member.userId} label={member.username} on={draft.memberIds.includes(member.userId)} onPress={() => toggleId("memberIds", member.userId)} />
                    ))
                  )}
                </View>
              </View>
            )}
          </Field>

          <Field label={t("events.composer.reminder")}>
            <Chips
              options={EVENT_REMINDERS.map((item) => ({ id: String(item.minutes), label: t(`events.composer.reminders.${item.id}`) }))}
              value={String(draft.reminderMinutes)}
              onChange={(value) => set("reminderMinutes", value === "null" ? null : Number(value))}
            />
          </Field>

          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Field label={stripTags(t("events.composer.capacity"))} error={errorText("capacity")}>
                <TextInput
                  value={draft.capacity}
                  onChangeText={(value) => set("capacity", value.replace(/[^0-9]/g, ""))}
                  placeholder={t("events.composer.unlimited")}
                  placeholderTextColor={colors.faint}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={stripTags(t("events.composer.gameTag"))} error={errorText("gameTag")}>
                <TextInput
                  value={draft.gameTag}
                  onChangeText={(value) => set("gameTag", value)}
                  placeholder={t("events.composer.gameTagPlaceholder")}
                  placeholderTextColor={colors.faint}
                  maxLength={EVENT_LIMITS.gameTagMax}
                  style={styles.input}
                />
              </Field>
            </View>
          </View>

          {!!serverError && <Text style={styles.error}>{serverError}</Text>}
          <Pressable accessibilityRole="button" style={styles.primary} disabled={busy} onPress={() => void save()}>
            {busy ? <ActivityIndicator color="#061018" /> : <Text style={styles.primaryText}>{editing ? t("events.composer.save") : t("events.composer.createTitle")}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A URL shape, the same in every language (web uses the same). */
const URL_EXAMPLE = "https://";

/** Web's labels carry an <em>optional</em> marker; plain text here. */
const stripTags = (value: string) => value.replace(/<[^>]+>/g, "").trim();

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Chips({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map((option) => (
        <Toggle key={option.id} label={option.label} on={option.id === value} onPress={() => onChange(option.id)} />
      ))}
    </ScrollView>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Date and time: one compact picker on iOS, date then time dialogs on Android. */
function DateTimeField({ value, minimumDate, onChange }: { value: number; minimumDate?: Date; onChange: (value: number) => void }) {
  if (Platform.OS === "ios") {
    return (
      <View style={styles.pickerRow}>
        <DateTimePicker
          value={new Date(value)}
          mode="datetime"
          display="compact"
          minimumDate={minimumDate}
          minuteInterval={5}
          themeVariant={colorMode}
          onChange={(_event: DateTimePickerEvent, date?: Date) => {
            if (date) onChange(date.getTime());
          }}
        />
      </View>
    );
  }
  const open = () =>
    DateTimePickerAndroid.open({
      value: new Date(value),
      mode: "date",
      minimumDate,
      onChange: (event, date) => {
        if (event.type !== "set" || !date) return;
        DateTimePickerAndroid.open({
          value: date,
          mode: "time",
          is24Hour: !hour12Preference(),
          onChange: (timeEvent, time) => {
            if (timeEvent.type === "set" && time) onChange(time.getTime());
          },
        });
      },
    });
  return (
    <Pressable accessibilityRole="button" style={styles.input} onPress={open}>
      <Text style={styles.pickerText}>
        {new Date(value).toLocaleString(dateLocale(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: hour12Preference() })}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerAction: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  save: { color: colors.cyan, fontWeight: "900" },
  content: { padding: 16, gap: 14 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 8 },
  field: { gap: 8 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  hint: { color: colors.faint, fontSize: 12 },
  error: { color: colors.red, fontSize: 12, fontWeight: "700" },
  input: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 15 },
  multiline: { minHeight: 110 },
  pickerRow: { flexDirection: "row", alignItems: "center" },
  pickerText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  chips: { gap: 8, paddingRight: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { maxWidth: 220, paddingHorizontal: 12, height: 34, justifyContent: "center", borderRadius: 99, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  chipTextOn: { color: colors.cyan },
  twoCol: { flexDirection: "row", gap: 10 },
  primary: { marginTop: 8, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  primaryText: { color: "#061018", fontSize: 16, fontWeight: "900" },
});
