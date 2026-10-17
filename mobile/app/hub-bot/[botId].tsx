import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { validateRule, type BotRuleError } from "../../../shared/bots/schema";
import { BOT_LIMITS, type BotRule } from "../../../shared/bots/types";
import {
  BotApiError,
  createBotsApi,
  type BuilderBot,
  type BuilderRun,
  type DryRunStep,
  type PublishError,
} from "@/src/lib/bot-builder-api";
import {
  CAPABILITIES,
  capabilityDescription,
  capabilityLabel,
  capabilityPhrase,
  missingCapabilities,
  namesFor,
  newRule,
  ruleContextFor,
  ruleLabel,
  ruleToSentence,
  sameRule,
  sampleEvent,
  type BotHub,
} from "@/src/lib/bot-builder-model";
import { BotRuleEditor } from "@/src/components/bots/BotRuleEditor";
import { botStyles, Chip, ChipRow, FieldShell, Input, Select, SmallButton } from "@/src/components/bots/BotControls";
import { runNoticeText } from "@/src/lib/server-notice";
import { timeAgo } from "@/src/lib/bots";
import type { Hub } from "@/src/types";
import { impactHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";

type Tab = "rules" | "test" | "activity" | "settings";
const TABS: Tab[] = ["rules", "test", "activity", "settings"];
type Editing = { ruleId: string | null; draft: BotRule; label: string };

/** One builder bot: Publish, and the Rules / Test / Activity / Settings tabs, like web's BotPage. */
export default function HubBotScreen() {
  const { t } = useTranslation(["bots", "common"]);
  const params = useLocalSearchParams<{ botId: string; hubId: string }>();
  const hubId = Number(params.hubId);
  const { token } = useSession();
  const api = useMemo(() => (token ? createBotsApi(token, hubId) : null), [token, hubId]);
  const [bot, setBot] = useState<BuilderBot | null>(null);
  const [hub, setHub] = useState<BotHub>({ textRooms: [], voiceRooms: [], roles: [] });
  const [tab, setTab] = useState<Tab>("rules");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishErrors, setPublishErrors] = useState<PublishError[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const overview = await api.overview();
      const found = overview.bots.find((item) => item.id === params.botId) ?? null;
      setBot(found);
      if (!found) setMessage({ kind: "error", text: t("bots.section.loadFailed") });
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : t("bots.section.loadFailed") });
    }
  }, [api, params.botId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token || !hubId) return;
    void (async () => {
      const [server, roles] = await Promise.all([
        apiJson<Hub>(`/api/servers/${hubId}`, {}, token).catch(() => null),
        apiJson<{ id: string; name: string }[]>(`/api/servers/${hubId}/roles`, {}, token).catch(() => []),
      ]);
      const channels = server?.channels ?? [];
      setHub({
        textRooms: channels.filter((room) => room.type === "text").map((room) => ({ id: String(room.id), name: room.name })),
        voiceRooms: channels.filter((room) => room.type === "voice").map((room) => ({ id: String(room.id), name: room.name })),
        roles: (Array.isArray(roles) ? roles : []).map((role) => ({ id: role.id, name: role.name })),
      });
    })();
  }, [token, hubId]);

  const rules = bot?.rules ?? [];
  const ruleIds = rules.map((rule) => rule.id);
  const names = useMemo(() => namesFor(hub, ruleIds), [hub, ruleIds.join()]);
  const ruleErrors = useMemo(
    () =>
      Object.fromEntries(
        rules.map((rule) => {
          const result = validateRule(rule.draft, ruleContextFor(hub, ruleIds));
          return [rule.id, result.ok ? [] : result.errors] as const;
        }),
      ) as Record<string, BotRuleError[]>,
    [rules, hub, ruleIds.join()],
  );
  const invalid = rules.filter((rule) => (ruleErrors[rule.id]?.length ?? 0) > 0 || publishErrors.some((e) => e.ruleId === rule.id)).length;

  if (!bot || !api) {
    return (
      <Screen>
        <Header title="" onBack={() => router.back()} />
        {message ? <Text style={[styles.notice, styles.noticeError]}>{message.text}</Text> : <ActivityIndicator style={{ marginTop: 40 }} color={colors.cyan} />}
      </Screen>
    );
  }

  const run = async (key: string, work: () => Promise<void>, fallback: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await work();
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : fallback });
    } finally {
      setBusy("");
    }
  };

  const missing = missingCapabilities(rules.map((rule) => rule.draft), bot.capabilities);
  const hasChanges = bot.hasUnpublishedChanges;
  const blockReason = invalid ? t("bots.page.needsFixing", { count: invalid }) : !hasChanges ? t("bots.page.allPublished") : "";

  const publish = async () => {
    setPublishing(true);
    setMessage(null);
    try {
      setBot(await api.publish(bot.id));
      setPublishErrors([]);
      impactHaptic();
      setMessage({ kind: "info", text: t("bots.page.published") });
    } catch (cause) {
      if (cause instanceof BotApiError && cause.errors.length) {
        setPublishErrors(cause.errors as PublishError[]);
        setTab("rules");
      }
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : t("bots.page.publishFailed") });
    } finally {
      setPublishing(false);
    }
  };

  const saveRule = async (ruleId: string | null, draft: BotRule) => {
    await api.saveRule(bot.id, ruleId, draft);
    setPublishErrors((current) => current.filter((error) => error.ruleId !== ruleId));
    await load();
  };

  const deleteRule = (ruleId: string, index: number, published: boolean) =>
    Alert.alert(
      t("bots.rules.deleteLabel"),
      published ? t("bots.rules.deletePublished", { label: ruleLabel(index) }) : t("bots.rules.deleteDraft", { label: ruleLabel(index) }),
      [
        { text: t("bots.rules.cancel"), style: "cancel" },
        { text: t("bots.ruleCard.delete"), style: "destructive", onPress: () => void run(`delete:${ruleId}`, async () => { await api.deleteRule(bot.id, ruleId); await load(); }, t("bots.settings.saveFailed")) },
      ],
    );

  const moveRule = (index: number, delta: -1 | 1) => {
    const ids = [...ruleIds];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void run("move", async () => { await api.reorder(bot.id, ids); await load(); }, t("bots.settings.saveFailed"));
  };

  const editingErrors = editing?.ruleId ? publishErrors.filter((error) => error.ruleId === editing.ruleId) : [];

  return (
    <Screen>
      <Header
        title={bot.name}
        subtitle={`${!bot.enabled ? t("bots.status.off") : hasChanges ? t("bots.status.unpublished") : t("bots.status.live")} · ${t("bots.page.ruleCount", { count: rules.length })}`}
        avatar={bot.avatarEmoji || "🤖"}
        color={bot.color}
        onBack={() => router.back()}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityHint={blockReason || t("bots.page.publishTitle")}
            disabled={!!blockReason || publishing}
            style={[styles.publish, (!!blockReason || publishing) && { opacity: 0.45 }]}
            onPress={() => void publish()}
          >
            {publishing ? <ActivityIndicator color="#061018" /> : <Text style={styles.publishText}>{t("bots.page.publish")}</Text>}
          </Pressable>
        }
      />
      {!!blockReason && (hasChanges || invalid > 0) && <Text style={styles.blockReason}>{blockReason}</Text>}

      <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel={t("bots.page.sections")}>
        {TABS.map((id) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={[styles.tab, tab === id && styles.tabOn]} onPress={() => setTab(id)}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{t(`bots.page.tabs.${id}`)}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {message && <Text style={[styles.notice, message.kind === "error" ? styles.noticeError : styles.noticeInfo]}>{message.text}</Text>}
        {bot.pausedReason === "errors" && (
          <View style={[styles.notice, styles.noticeError, styles.noticeRow]}>
            <Text style={[styles.noticeText, { flex: 1 }]}>{t("bots.page.pausedNotice")}</Text>
            <SmallButton label={t("bots.page.resume")} onPress={() => void run("resume", async () => setBot(await api.update(bot.id, { enabled: true })), t("bots.page.resumeFailed"))} />
          </View>
        )}
        {missing.length > 0 && (
          <View style={[styles.notice, styles.noticeWarn, styles.noticeRow]}>
            <Text style={[styles.noticeText, { flex: 1 }]}>
              {t("bots.page.missingCapabilities", { list: missing.map(capabilityPhrase).join(", ") }).replace(/<\/?strong>/g, "")}
            </Text>
            <SmallButton label={t("bots.page.allow")} onPress={() => void run("allow", async () => setBot(await api.update(bot.id, { capabilities: [...bot.capabilities, ...missing] })), t("bots.page.updateFailed"))} />
          </View>
        )}

        {tab === "rules" && (
          <>
            {rules.length === 0 && (
              <View style={botStyles.card}>
                <Text style={botStyles.sectionTitle}>{t("bots.rules.emptyTitle")}</Text>
                <Text style={botStyles.muted}>{t("bots.rules.emptyHint")}</Text>
              </View>
            )}
            {rules.map((rule, index) => {
              const errors = [...(ruleErrors[rule.id] ?? []), ...publishErrors.filter((e) => e.ruleId === rule.id)];
              const live = rule.published !== null;
              const changed = live && !sameRule(rule.draft, rule.published);
              const status = !rule.enabled
                ? t("bots.ruleCard.paused")
                : errors.length
                  ? t("bots.ruleCard.status.invalid")
                  : !live
                    ? t("bots.ruleCard.new")
                    : changed
                      ? t("bots.ruleCard.changed")
                      : t("bots.status.live");
              return (
                <View key={rule.id} style={[botStyles.card, !rule.enabled && { opacity: 0.7 }, errors.length > 0 && { borderColor: colors.red }]}>
                  <Pressable accessibilityRole="button" onPress={() => setEditing({ ruleId: rule.id, draft: rule.draft, label: ruleLabel(index) })}>
                    <View style={botStyles.row}>
                      <Text style={styles.ruleLabel}>{ruleLabel(index)}</Text>
                      <Text style={[styles.status, errors.length > 0 && { color: colors.red }]}>{status}</Text>
                    </View>
                    <Text style={styles.sentence}>{ruleToSentence(rule.draft, names)}</Text>
                    {errors.length > 0 && (
                      <Text style={styles.ruleError}>
                        {errors.length > 1 ? t("bots.ruleCard.errorsMore", { message: errors[0].message, count: errors.length - 1 }) : t("bots.ruleCard.error", { message: errors[0].message })}
                      </Text>
                    )}
                  </Pressable>
                  <View style={botStyles.row}>
                    <Switch
                      accessibilityLabel={rule.enabled ? t("bots.ruleCard.pause", { label: ruleLabel(index) }) : t("bots.ruleCard.resume", { label: ruleLabel(index) })}
                      value={rule.enabled}
                      disabled={!!busy}
                      onValueChange={(enabled) => void run(`toggle:${rule.id}`, async () => { await api.setRuleEnabled(bot.id, rule.id, enabled); await load(); }, t("bots.settings.saveFailed"))}
                    />
                    <View style={{ flex: 1 }} />
                    <SmallButton label={t("bots.ruleCard.moveUp", { label: ruleLabel(index) })} icon="arrow-up" disabled={index === 0 || !!busy} onPress={() => moveRule(index, -1)} />
                    <SmallButton label={t("bots.ruleCard.moveDown", { label: ruleLabel(index) })} icon="arrow-down" disabled={index === rules.length - 1 || !!busy} onPress={() => moveRule(index, 1)} />
                    <SmallButton
                      label={t("bots.ruleCard.duplicate")}
                      icon="copy-outline"
                      disabled={rules.length >= BOT_LIMITS.rulesPerBot}
                      onPress={() => setEditing({ ruleId: null, draft: rule.draft, label: ruleLabel(rules.length) })}
                    />
                    <SmallButton label={t("bots.ruleCard.delete")} icon="trash-outline" danger onPress={() => deleteRule(rule.id, index, live)} />
                  </View>
                </View>
              );
            })}
            <Pressable
              accessibilityRole="button"
              style={styles.addRule}
              onPress={() => {
                if (rules.length >= BOT_LIMITS.rulesPerBot) {
                  setMessage({ kind: "error", text: t("bots.rules.limit", { count: BOT_LIMITS.rulesPerBot }) });
                  return;
                }
                setEditing({ ruleId: null, draft: newRule(), label: ruleLabel(rules.length) });
              }}
            >
              <Ionicons name="add" size={18} color={colors.cyan} />
              <Text style={botStyles.link}>{t("bots.rules.add")}</Text>
            </Pressable>
          </>
        )}

        {tab === "test" && <TestTab api={api} botId={bot.id} bot={bot} names={names} hub={hub} />}
        {tab === "activity" && <ActivityTab api={api} botId={bot.id} ruleLabels={Object.fromEntries(rules.map((rule, i) => [rule.id, ruleLabel(i)]))} />}
        {tab === "settings" && (
          <SettingsTab
            api={api}
            bot={bot}
            hub={hub}
            onChanged={setBot}
            onDeleted={() => router.back()}
          />
        )}
      </ScrollView>

      {editing && (
        <BotRuleEditor
          visible
          label={editing.label}
          initial={editing.draft}
          hub={hub}
          names={names}
          ruleRefs={rules.filter((rule) => rule.id !== editing.ruleId).map((rule) => ({ id: rule.id, name: ruleLabel(rules.indexOf(rule)) }))}
          savedRuleIds={ruleIds}
          serverErrors={editingErrors}
          onSave={(draft) => saveRule(editing.ruleId, draft)}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
  );
}

function Header({ title, subtitle, avatar, color, onBack, right }: { title: string; subtitle?: string; avatar?: string; color?: string | null; onBack: () => void; right?: ReactNode }) {
  const { t } = useTranslation(["common"]);
  return (
    <View style={styles.top}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={onBack}>
        <Ionicons name="chevron-back" size={22} color={colors.cyan} />
      </Pressable>
      {!!avatar && (
        <View style={[styles.avatar, color ? { backgroundColor: color } : null]}>
          <Text style={{ fontSize: 20 }}>{avatar}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

function TestTab({ api, botId, bot, names, hub }: { api: ReturnType<typeof createBotsApi>; botId: string; bot: BuilderBot; names: ReturnType<typeof namesFor>; hub: BotHub }) {
  const { t } = useTranslation(["bots"]);
  const rules = bot.rules;
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? "");
  const rule = rules.find((item) => item.id === ruleId) ?? rules[0];
  const [roomId, setRoomId] = useState("");
  const trigger = rule?.draft.trigger;
  const sample = useMemo(() => (trigger ? sampleEvent(trigger) : null), [JSON.stringify(trigger ?? null)]);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [steps, setSteps] = useState<DryRunStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(sample?.data ?? {});
    setSteps(null);
  }, [sample]);

  if (!rule || !sample || !trigger) return <Text style={botStyles.muted}>{t("bots.test.empty")}</Text>;
  const args = (data.args ?? {}) as Record<string, string>;

  const runTest = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.test(botId, rule.id, { kind: sample.kind, data, ...(roomId ? { roomId } : {}) });
      setSteps(result.steps);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.test.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={botStyles.muted}>{t("bots.test.intro")}</Text>
      <FieldShell label={t("bots.test.rule")}>
        <Select
          label={t("bots.test.rule")}
          value={rule.id}
          options={rules.map((item, i) => ({ value: item.id, label: ruleLabel(i), detail: ruleToSentence(item.draft, names) }))}
          onChange={setRuleId}
        />
      </FieldShell>
      <FieldShell label={t("bots.test.room")}>
        <Select
          label={t("bots.test.room")}
          value={roomId}
          options={[{ value: "", label: t("bots.test.firstRoom") }, ...hub.textRooms.map((room) => ({ value: room.id, label: `#${room.name}` }))]}
          onChange={setRoomId}
        />
      </FieldShell>
      {trigger.type === "command" &&
        trigger.options.map((option) => (
          <FieldShell key={option.name} label={`/${trigger.name} ${option.name}`}>
            <Input value={args[option.name] ?? ""} onChangeText={(value) => setData({ ...data, args: { ...args, [option.name]: value } })} />
          </FieldShell>
        ))}
      {trigger.type === "message" && (
        <FieldShell label={t("bots.test.message")}>
          <Input value={String(data.text ?? "")} onChangeText={(text) => setData({ ...data, text })} />
        </FieldShell>
      )}
      {trigger.type === "component" && (
        <FieldShell label={t("bots.variable.value")}>
          <Input value={String(data.value ?? "")} onChangeText={(value) => setData({ ...data, value })} />
        </FieldShell>
      )}
      {!sameRule(rule.draft, rule.published) && rule.published !== null && <Text style={[styles.notice, styles.noticeWarn]}>{t("bots.test.unsaved")}</Text>}
      <Pressable accessibilityRole="button" style={styles.primary} disabled={busy} onPress={() => void runTest()}>
        {busy ? <ActivityIndicator color="#061018" /> : <Text style={styles.primaryText}>{t("bots.test.run")}</Text>}
      </Pressable>
      {!!error && <Text style={[styles.notice, styles.noticeError]}>{error}</Text>}
      {steps && (
        <View style={{ gap: 6 }} accessibilityLabel={t("bots.test.steps")}>
          {steps.length === 0 && <Text style={botStyles.muted}>{t("bots.test.noMatch")}</Text>}
          {steps.map((step, i) => (
            <View key={i} style={botStyles.row}>
              <Ionicons name={step.ok ? "checkmark-circle" : "close-circle"} size={18} color={step.ok ? colors.green : colors.red} />
              <Text style={[botStyles.muted, { flex: 1, color: colors.text }]}>
                {runNoticeText(step.descriptionNotice, step.description)}
                {step.reason ? <Text style={{ color: colors.red }}> {runNoticeText(step.reasonNotice, step.reason)}</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ActivityTab({ api, botId, ruleLabels }: { api: ReturnType<typeof createBotsApi>; botId: string; ruleLabels: Record<string, string> }) {
  const { t } = useTranslation(["bots"]);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [runs, setRuns] = useState<BuilderRun[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setRuns((await api.runs(botId, errorsOnly)).runs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.activity.loadFailed"));
    }
  }, [api, botId, errorsOnly, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const now = Date.now();
  return (
    <View style={{ gap: 10 }}>
      <View style={botStyles.row}>
        <Text style={[botStyles.muted, { flex: 1 }]}>{t("bots.activity.errorsOnly")}</Text>
        <Switch value={errorsOnly} onValueChange={setErrorsOnly} />
        <SmallButton label={t("bots.activity.refresh")} icon="refresh" onPress={() => void load()} />
      </View>
      {!!error && <Text style={[styles.notice, styles.noticeError]}>{error}</Text>}
      {runs?.length === 0 && <Text style={botStyles.muted}>{errorsOnly ? t("bots.activity.noErrors") : t("bots.activity.empty")}</Text>}
      {runs?.map((item) => (
        <View key={item.id} style={[botStyles.card, { padding: 10, gap: 4 }]}>
          <View style={botStyles.row}>
            <Text style={[styles.status, item.status === "error" && { color: colors.red }]}>{item.status}</Text>
            <Text style={[botStyles.muted, { flex: 1 }]} numberOfLines={1}>
              {(item.rule_id && ruleLabels[item.rule_id]) || t("bots.activity.deletedRule")} · {item.trigger}
            </Text>
            <Text style={botStyles.muted}>{timeAgo(item.created_at, now)}</Text>
          </View>
          {!!item.detail && <Text style={[botStyles.muted, { color: colors.text }]}>{runNoticeText(item.notice, item.detail)}</Text>}
        </View>
      ))}
    </View>
  );
}

const BOT_COLOURS = ["#7c5cff", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#ec4899", "#94a3b8"];

function SettingsTab({ api, bot, hub, onChanged, onDeleted }: { api: ReturnType<typeof createBotsApi>; bot: BuilderBot; hub: BotHub; onChanged: (bot: BuilderBot) => void; onDeleted: () => void }) {
  const { t } = useTranslation(["bots", "common"]);
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [avatar, setAvatar] = useState(bot.avatarEmoji ?? "");
  const [color, setColor] = useState(bot.color ?? "#7c5cff");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const update = async (patch: Parameters<ReturnType<typeof createBotsApi>["update"]>[1], key: string) => {
    setBusy(key);
    setError("");
    try {
      onChanged(await api.update(bot.id, patch));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.settings.saveFailed"));
    } finally {
      setBusy("");
    }
  };
  const lookDirty = name.trim() !== bot.name || description.trim() !== bot.description || avatar !== (bot.avatarEmoji ?? "") || color !== (bot.color ?? "#7c5cff");

  const exportBot = async () => {
    try {
      const data = await api.exportBot(bot.id);
      const text = JSON.stringify(data, null, 2);
      await Share.share({ message: text, title: `${bot.name}.decave-bot.json` });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bots.settings.exportFailed"));
    }
  };

  const remove = () =>
    Alert.alert(t("bots.settings.deleteTitle", { name: bot.name }), t("bots.settings.deleteDescription"), [
      { text: t("common.actions.cancel"), style: "cancel" },
      {
        text: t("bots.settings.delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            setBusy("delete");
            try {
              await api.remove(bot.id);
              onDeleted();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : t("bots.settings.deleteFailed"));
            } finally {
              setBusy("");
            }
          })(),
      },
    ]);

  return (
    <View style={{ gap: 12 }}>
      {!!error && <Text style={[styles.notice, styles.noticeError]}>{error}</Text>}
      <View style={botStyles.card}>
        <View style={botStyles.row}>
          <View style={{ flex: 1 }}>
            <Text style={botStyles.sectionTitle}>{t("bots.settings.on")}</Text>
            <Text style={botStyles.muted}>{t("bots.settings.onHint")}</Text>
          </View>
          <Switch accessibilityLabel={t("bots.settings.on")} value={bot.enabled} disabled={busy === "enabled"} onValueChange={(enabled) => void update({ enabled }, "enabled")} />
        </View>
      </View>
      <View style={botStyles.card}>
        <FieldShell label={t("bots.settings.name")}>
          <Input maxLength={32} value={name} onChangeText={setName} />
        </FieldShell>
        <FieldShell label={t("bots.settings.avatar")}>
          <Input maxLength={16} value={avatar} onChangeText={(value) => setAvatar(value.trim())} style={{ width: 96 }} />
        </FieldShell>
        <FieldShell label={t("bots.settings.colour")}>
          <View style={[botStyles.row, { flexWrap: "wrap" }]}>
            {BOT_COLOURS.map((colour) => (
              <Pressable
                key={colour}
                accessibilityRole="button"
                accessibilityState={{ selected: color === colour }}
                accessibilityLabel={`${t("bots.settings.colour")} ${colour}`}
                onPress={() => setColor(colour)}
                style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colour, borderWidth: color === colour ? 3 : 0, borderColor: colors.text }}
              />
            ))}
          </View>
        </FieldShell>
        <FieldShell label={t("bots.settings.description")}>
          <Input maxLength={180} value={description} onChangeText={setDescription} />
        </FieldShell>
        <Pressable
          accessibilityRole="button"
          style={[styles.primary, (!lookDirty || !name.trim()) && { opacity: 0.45 }]}
          disabled={!lookDirty || !name.trim() || busy === "look"}
          onPress={() => void update({ name: name.trim(), description: description.trim(), color, ...(avatar ? { avatarEmoji: avatar } : {}) }, "look")}
        >
          <Text style={styles.primaryText}>{t("bots.settings.save")}</Text>
        </Pressable>
      </View>
      <View style={botStyles.card}>
        <Text style={botStyles.sectionTitle}>{t("bots.settings.rooms")}</Text>
        <Text style={botStyles.muted}>{t("bots.settings.roomsHint")}</Text>
        <ChipRow>
          {hub.textRooms.map((room) => {
            const id = Number(room.id);
            const on = bot.allowedRoomIds.includes(id);
            return (
              <Chip
                key={room.id}
                label={`#${room.name}`}
                on={on}
                disabled={busy === `room:${id}`}
                onPress={() => void update({ allowedRoomIds: on ? bot.allowedRoomIds.filter((item) => item !== id) : [...bot.allowedRoomIds, id] }, `room:${id}`)}
              />
            );
          })}
        </ChipRow>
      </View>
      <View style={botStyles.card}>
        <Text style={botStyles.sectionTitle}>{t("bots.settings.capabilities")}</Text>
        <Text style={botStyles.muted}>{t("bots.settings.capabilitiesHint")}</Text>
        {CAPABILITIES.map((id) => (
          <View key={id} style={botStyles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.capability}>{capabilityLabel(id)}</Text>
              <Text style={botStyles.muted}>{capabilityDescription(id)}</Text>
            </View>
            <Switch
              accessibilityLabel={capabilityLabel(id)}
              value={bot.capabilities.includes(id)}
              disabled={busy === `cap:${id}`}
              onValueChange={() => {
                const next = bot.capabilities.includes(id) ? bot.capabilities.filter((item) => item !== id) : [...bot.capabilities, id];
                if (next.length) void update({ capabilities: next }, `cap:${id}`);
              }}
            />
          </View>
        ))}
      </View>
      <View style={botStyles.card}>
        <View style={botStyles.row}>
          <View style={{ flex: 1 }}>
            <Text style={botStyles.sectionTitle}>{t("bots.settings.export")}</Text>
            <Text style={botStyles.muted}>{t("bots.settings.exportHint")}</Text>
          </View>
          <SmallButton label={t("bots.settings.export")} onPress={() => void exportBot()} />
        </View>
        <View style={botStyles.row}>
          <View style={{ flex: 1 }}>
            <Text style={botStyles.sectionTitle}>{t("bots.settings.delete")}</Text>
            <Text style={botStyles.muted}>{t("bots.settings.deleteHint")}</Text>
          </View>
          <SmallButton label={t("bots.ruleCard.delete")} danger onPress={remove} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  title: { color: colors.text, fontSize: 18, fontWeight: "900" },
  subtitle: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  publish: { paddingHorizontal: 14, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  publishText: { color: "#061018", fontSize: 14, fontWeight: "900" },
  blockReason: { marginHorizontal: 14, color: colors.faint, fontSize: 12, fontWeight: "700", textAlign: "right" },
  tabs: { flexDirection: "row", marginHorizontal: 14, marginTop: 8, padding: 3, borderRadius: 12, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: colors.panel },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  tabTextOn: { color: colors.text },
  scroll: { padding: 14, paddingBottom: 40, gap: 12 },
  notice: { padding: 10, borderRadius: 12, overflow: "hidden" },
  noticeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  noticeText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  noticeError: { color: colors.red, backgroundColor: colors.redSoft },
  noticeInfo: { color: colors.cyan, backgroundColor: colors.cyanSoft },
  noticeWarn: { color: colors.yellow, backgroundColor: colors.panel2 },
  ruleLabel: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "900" },
  status: { color: colors.cyan, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  sentence: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  ruleError: { color: colors.red, fontSize: 12, fontWeight: "700", marginTop: 4 },
  addRule: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 8 },
  primary: { height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  primaryText: { color: "#061018", fontSize: 15, fontWeight: "900" },
  capability: { color: colors.text, fontSize: 14, fontWeight: "800" },
});
