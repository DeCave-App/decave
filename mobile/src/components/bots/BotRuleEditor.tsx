// Edit one bot rule: When [trigger] (rooms, cooldowns) · If [conditions] ·
// Do [actions] · Otherwise [actions], like web's RuleCard expanded. Checked
// with the same validator the server uses before it is saved.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { validateRule, type BotRuleError } from "../../../../shared/bots/schema";
import { BOT_LIMITS, type BotAction, type BotCondition, type BotRule, type BotTrigger } from "../../../../shared/bots/types";
import {
  defaultPart,
  fieldError,
  ruleContextFor,
  ruleToSentence,
  translateRuleErrors,
  variablesFor,
  type BotHub,
  type BotNames,
  type BotPart,
} from "@/src/lib/bot-builder-model";
import { BotApiError } from "@/src/lib/bot-builder-api";
import { BotPartEditor, BotPartList } from "./BotPartEditor";
import { botStyles, Chip, ChipRow, FieldShell, NumberInput } from "./BotControls";
import type { FieldEnv } from "./BotFieldInput";
import { colors } from "@/src/theme";

export function BotRuleEditor({
  visible,
  label,
  initial,
  hub,
  names,
  ruleRefs,
  savedRuleIds,
  serverErrors,
  onSave,
  onClose,
}: {
  visible: boolean;
  label: string;
  initial: BotRule;
  hub: BotHub;
  names: BotNames;
  /** Other rules, for "Run rule" (id and label). */
  ruleRefs: { id: string; name: string }[];
  savedRuleIds: string[];
  /** Errors the server sent for this rule (after a publish attempt). */
  serverErrors: BotRuleError[];
  onSave: (draft: BotRule) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation(["bots", "common"]);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<BotRule>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [remoteErrors, setRemoteErrors] = useState<BotRuleError[]>(serverErrors);

  useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setMessage("");
    setSubmitted(false);
    setRemoteErrors(serverErrors);
  }, [visible]);

  const localErrors = useMemo(() => {
    const result = validateRule(draft, ruleContextFor(hub, savedRuleIds));
    return result.ok ? [] : translateRuleErrors(result.errors);
  }, [draft, hub, savedRuleIds]);
  const errors = submitted || remoteErrors.length ? [...localErrors, ...remoteErrors] : [];
  const env: FieldEnv = { ...hub, rules: ruleRefs, variables: variablesFor(draft.trigger) };

  const edit = (next: BotRule) => {
    setDraft(next);
    setRemoteErrors([]);
  };
  const conditionKey: "all" | "any" = draft.when?.any?.length && !draft.when?.all?.length ? "any" : "all";
  const conditions = (draft.when?.[conditionKey] ?? []) as unknown as BotPart[];
  const otherKey = conditionKey === "all" ? "any" : "all";
  const setConditions = (items: BotPart[], key: "all" | "any" = conditionKey) => {
    const when = { ...draft.when, [key]: items as unknown as BotCondition[] };
    if (!items.length) delete when[key];
    const next: BotRule = { ...draft, when };
    if (!when.all && !when.any) delete next.when;
    edit(next);
  };
  const everywhere = draft.scope.channels.includes("*");
  const toggleRoom = (id: string) => {
    const current = draft.scope.channels.filter((channel) => channel !== "*");
    const next = current.includes(id) ? current.filter((channel) => channel !== id) : [...current, id];
    edit({ ...draft, scope: { ...draft.scope, channels: next.length ? next : ["*"] } });
  };

  const save = async () => {
    setSubmitted(true);
    if (localErrors.length || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await onSave(draft);
      onClose();
    } catch (cause) {
      if (cause instanceof BotApiError && cause.errors.length) setRemoteErrors(cause.errors);
      setMessage(cause instanceof Error ? cause.message : t("bots.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onClose}>
            <Text style={styles.headerAction}>{t("common.actions.cancel")}</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{label}</Text>
          <Pressable accessibilityRole="button" hitSlop={8} disabled={saving} onPress={() => void save()}>
            {saving ? <ActivityIndicator color={colors.cyan} /> : <Text style={[styles.headerAction, styles.save]}>{t("common.actions.save")}</Text>}
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
          <Text style={styles.sentence}>{ruleToSentence(draft, names)}</Text>
          {!!message && <Text style={styles.error}>{message}</Text>}
          {submitted && localErrors.length > 0 && (
            <Text style={styles.error}>
              {localErrors.length > 1
                ? t("bots.ruleCard.errorsMore", { message: localErrors[0].message, count: localErrors.length - 1 })
                : t("bots.ruleCard.error", { message: localErrors[0].message })}
            </Text>
          )}

          <Text style={styles.step}>{t("bots.ruleCard.when")}</Text>
          <BotPartEditor
            kind="triggers"
            value={draft.trigger as unknown as BotPart}
            path="trigger"
            errors={errors}
            env={env}
            onChange={(trigger) => edit({ ...draft, trigger: trigger as unknown as BotTrigger })}
            onTypeChange={(type) => edit({ ...draft, trigger: defaultPart("triggers", type) as unknown as BotTrigger })}
          />
          <View style={botStyles.card}>
            <Text style={botStyles.sectionTitle}>{t("bots.ruleCard.scope")}</Text>
            <FieldShell label={t("bots.ruleCard.rooms")} error={fieldError(errors, "", "scope")}>
              <ChipRow>
                <Chip label={t("bots.ruleCard.allRooms")} on={everywhere} onPress={() => edit({ ...draft, scope: { ...draft.scope, channels: ["*"] } })} />
                {hub.textRooms.map((room) => (
                  <Chip key={room.id} label={`#${room.name}`} on={draft.scope.channels.includes(room.id)} onPress={() => toggleRoom(room.id)} />
                ))}
              </ChipRow>
            </FieldShell>
            <View style={botStyles.row}>
              <View style={{ flex: 1 }}>
                <FieldShell label={t("bots.ruleCard.cooldownMember")}>
                  <NumberInput value={draft.cooldown.perUser} onChange={(perUser) => edit({ ...draft, cooldown: { ...draft.cooldown, perUser: Math.max(0, perUser ?? 0) } })} />
                </FieldShell>
              </View>
              <View style={{ flex: 1 }}>
                <FieldShell label={t("bots.ruleCard.cooldownRoom")}>
                  <NumberInput value={draft.cooldown.perChannel} onChange={(perChannel) => edit({ ...draft, cooldown: { ...draft.cooldown, perChannel: Math.max(0, perChannel ?? 0) } })} />
                </FieldShell>
              </View>
            </View>
          </View>

          <Text style={styles.step}>{t("bots.ruleCard.if")}</Text>
          {conditions.length > 1 && (
            <ChipRow>
              <Chip label={t("bots.ruleCard.all")} on={conditionKey === "all"} onPress={() => edit({ ...draft, when: { all: conditions as unknown as BotCondition[] } })} />
              <Chip label={t("bots.ruleCard.any")} on={conditionKey === "any"} onPress={() => edit({ ...draft, when: { any: conditions as unknown as BotCondition[] } })} />
            </ChipRow>
          )}
          {conditions.length === 0 && <Text style={botStyles.muted}>{t("bots.ruleCard.always")}</Text>}
          <BotPartList
            kind="conditions"
            items={conditions}
            path={`when.${conditionKey}`}
            errors={errors}
            env={env}
            limit={20}
            addLabel={t("bots.ruleCard.addCondition")}
            makeDefault={(type) => defaultPart("conditions", type)}
            onChange={(items) => setConditions(items)}
          />
          {(draft.when?.[otherKey]?.length ?? 0) > 0 && (
            <BotPartList
              kind="conditions"
              items={draft.when![otherKey] as unknown as BotPart[]}
              path={`when.${otherKey}`}
              errors={errors}
              env={env}
              limit={20}
              addLabel={t("bots.ruleCard.addConditionTo", { key: otherKey })}
              makeDefault={(type) => defaultPart("conditions", type)}
              onChange={(items) => setConditions(items, otherKey)}
            />
          )}

          <Text style={styles.step}>{t("bots.ruleCard.do")}</Text>
          <BotPartList
            kind="actions"
            items={draft.then as unknown as BotPart[]}
            path="then"
            errors={errors}
            env={env}
            limit={BOT_LIMITS.actionsPerRule}
            addLabel={t("bots.ruleCard.addAction")}
            makeDefault={(type) => defaultPart("actions", type)}
            onChange={(items) => edit({ ...draft, then: items as unknown as BotAction[] })}
          />

          {(conditions.length > 0 || (draft.else?.length ?? 0) > 0) && (
            <>
              <Text style={styles.step}>{t("bots.ruleCard.otherwise")}</Text>
              <BotPartList
                kind="actions"
                items={(draft.else ?? []) as unknown as BotPart[]}
                path="else"
                errors={errors}
                env={env}
                limit={BOT_LIMITS.actionsPerRule}
                addLabel={t("bots.ruleCard.addAction")}
                makeDefault={(type) => defaultPart("actions", type)}
                onChange={(items) => {
                  const next: BotRule = { ...draft, else: items as unknown as BotAction[] };
                  if (!items.length) delete next.else;
                  edit(next);
                }}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerAction: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.text, fontSize: 16, fontWeight: "900" },
  save: { color: colors.cyan, fontWeight: "900" },
  content: { padding: 16, gap: 12 },
  sentence: { color: colors.muted, fontSize: 13, lineHeight: 19, padding: 10, borderRadius: 12, backgroundColor: colors.panel2 },
  step: { color: colors.cyan, fontSize: 13, fontWeight: "900", textTransform: "uppercase", marginTop: 8 },
  error: { color: colors.red, fontSize: 13, fontWeight: "700" },
});
