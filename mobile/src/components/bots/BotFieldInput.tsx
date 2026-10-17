// One field of a trigger, condition or action, rendered from its catalogue
// descriptor, like web's src/features/bots/FieldInput.tsx and ListFields.tsx.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Switch, Text, View } from "react-native";
import type { BotFieldDescriptor } from "../../../../shared/bots/catalogue";
import type { BotRuleError } from "../../../../shared/bots/schema";
import { BOT_LIMITS, type BotCard, type BotCommandOption, type BotFormField, type BotTrigger } from "../../../../shared/bots/types";
import {
  deletedLabel,
  fieldError,
  fieldHint,
  fieldLabel,
  previewTemplate,
  weekdayName,
  type BotRefKind,
  type BotVariable,
  type CatalogueKind,
  type HubRef,
} from "@/src/lib/bot-builder-model";
import { botStyles, Chip, ChipRow, FieldShell, Input, NumberInput, Select, SmallButton } from "./BotControls";
import { colors } from "@/src/theme";

export type FieldEnv = { textRooms: HubRef[]; voiceRooms: HubRef[]; roles: HubRef[]; rules: HubRef[]; variables: BotVariable[] };

const UNITS = [
  { unit: "minutes", size: 1 },
  { unit: "hours", size: 60 },
  { unit: "days", size: 1440 },
] as const;

function TemplateInput({ value, onChange, variables, long }: { value: string; onChange: (value: string) => void; variables: BotVariable[]; long: boolean }) {
  const { t } = useTranslation(["bots"]);
  const [picking, setPicking] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <View style={botStyles.row}>
        <Input value={value} onChangeText={onChange} multiline={long} style={{ flex: 1 }} autoCapitalize="none" />
        <SmallButton label={t("bots.variable.insert")} onPress={() => setPicking((open) => !open)} />
      </View>
      {picking && (
        <ChipRow>
          {variables.map((variable) => (
            <Chip
              key={variable.name}
              label={`{${variable.name}}`}
              on={false}
              onPress={() => {
                onChange(`${value}{${variable.name}}`);
                setPicking(false);
              }}
            />
          ))}
        </ChipRow>
      )}
      {value.includes("{") && (
        <Text style={{ color: colors.faint, fontSize: 12 }} accessibilityLabel={t("bots.variable.previewLabel")}>
          {t("bots.variable.preview", { text: previewTemplate(value, variables) })}
        </Text>
      )}
    </View>
  );
}

function DurationInput({ value, onChange, optional }: { value: number | undefined; onChange: (value: number | undefined) => void; optional: boolean }) {
  const { t } = useTranslation(["bots"]);
  const unit = value && value % 1440 === 0 ? UNITS[2] : value && value % 60 === 0 ? UNITS[1] : UNITS[0];
  const [chosen, setChosen] = useState<number>(unit.size);
  const size = value === undefined ? chosen : unit.size;
  return (
    <View style={botStyles.row}>
      <NumberInput
        value={value === undefined ? undefined : value / size}
        optional={optional}
        placeholder={optional ? t("bots.field.keep") : undefined}
        onChange={(next) => onChange(next === undefined ? undefined : Math.max(0, Math.round(next * size)))}
      />
      <View style={{ flex: 1 }}>
        <Select
          label={t("bots.field.unit")}
          value={String(size)}
          options={UNITS.map((item) => ({ value: String(item.size), label: t(`bots.field.units.${item.unit}`) }))}
          onChange={(next) => {
            setChosen(Number(next));
            if (value !== undefined) onChange((value / size) * Number(next));
          }}
        />
      </View>
    </View>
  );
}

function RefSelect({ value, onChange, items, prefix, empty, extra, what, label }: { value: string; onChange: (value: string) => void; items: HubRef[]; prefix: string; empty: string; extra?: { value: string; label: string }[]; what: BotRefKind; label: string }) {
  const known = value === "" || items.some((item) => item.id === value) || extra?.some((item) => item.value === value);
  return (
    <Select
      label={label}
      value={value}
      placeholder={empty}
      onChange={onChange}
      options={[
        { value: "", label: empty },
        ...(extra ?? []),
        ...items.map((item) => ({ value: item.id, label: `${prefix}${item.name}` })),
        ...(known ? [] : [{ value, label: `${prefix}${deletedLabel(what)}` }]),
      ]}
    />
  );
}

function OptionsEditor({ value, onChange }: { value: BotCommandOption[]; onChange: (value: unknown) => void }) {
  const { t } = useTranslation(["bots"]);
  const set = (i: number, patch: Partial<BotCommandOption>) => onChange(value.map((option, j) => (j === i ? { ...option, ...patch } : option)));
  const types: BotCommandOption["type"][] = ["text", "number", "user", "role", "channel", "choice"];
  return (
    <View style={{ gap: 8 }}>
      {value.length === 0 && <Text style={botStyles.muted}>{t("bots.list.noOptions")}</Text>}
      {value.map((option, i) => (
        <View key={i} style={[botStyles.card, { padding: 10 }]}>
          <View style={botStyles.row}>
            <Input
              style={{ flex: 1 }}
              accessibilityLabel={t("bots.list.optionName")}
              placeholder={t("bots.list.optionNamePlaceholder")}
              autoCapitalize="none"
              value={option.name}
              onChangeText={(text) => set(i, { name: text.toLowerCase() })}
            />
            <SmallButton label={t("bots.list.removeOption")} icon="close" onPress={() => onChange(value.filter((_item, j) => j !== i))} />
          </View>
          <Select
            label={t("bots.list.optionType")}
            value={option.type}
            options={types.map((type) => ({ value: type, label: t(`bots.list.optionTypes.${type}`) }))}
            onChange={(type) =>
              set(i, type === "choice" ? { type: "choice", choices: option.choices ?? ["a", "b"] } : { type: type as BotCommandOption["type"], choices: undefined })
            }
          />
          {option.type === "choice" && (
            <Input
              accessibilityLabel={t("bots.list.choices")}
              placeholder={t("bots.list.choicesPlaceholder")}
              value={(option.choices ?? []).join(", ")}
              onChangeText={(text) => set(i, { choices: text.split(",").map((choice) => choice.trim()) })}
            />
          )}
          <View style={botStyles.row}>
            <Text style={[botStyles.muted, { flex: 1 }]}>{t("bots.list.required")}</Text>
            <Switch value={option.required} onValueChange={(required) => set(i, { required })} />
          </View>
        </View>
      ))}
      <Pressable accessibilityRole="button" disabled={value.length >= 10} onPress={() => onChange([...value, { name: `option${value.length + 1}`, type: "text", required: false }])}>
        <Text style={botStyles.link}>{t("bots.list.addOption")}</Text>
      </Pressable>
    </View>
  );
}

function FormFieldsEditor({ value, onChange }: { value: BotFormField[]; onChange: (value: unknown) => void }) {
  const { t } = useTranslation(["bots"]);
  const set = (i: number, patch: Partial<BotFormField>) => onChange(value.map((field, j) => (j === i ? { ...field, ...patch } : field)));
  return (
    <View style={{ gap: 8 }}>
      {value.map((field, i) => (
        <View key={i} style={[botStyles.card, { padding: 10 }]}>
          <View style={botStyles.row}>
            <Input style={{ flex: 1 }} accessibilityLabel={t("bots.list.fieldLabel")} placeholder={t("bots.list.fieldLabelPlaceholder")} value={field.label} onChangeText={(label) => set(i, { label })} />
            <SmallButton label={t("bots.list.removeField")} icon="close" onPress={() => onChange(value.filter((_item, j) => j !== i))} />
          </View>
          <Input accessibilityLabel={t("bots.list.fieldId")} placeholder={t("bots.list.fieldIdPlaceholder")} autoCapitalize="none" value={field.id} onChangeText={(id) => set(i, { id })} />
          <ChipRow>
            <Chip label={t("bots.list.short")} on={field.style === "short"} onPress={() => set(i, { style: "short" })} />
            <Chip label={t("bots.list.long")} on={field.style === "long"} onPress={() => set(i, { style: "long" })} />
          </ChipRow>
          <View style={botStyles.row}>
            <Text style={[botStyles.muted, { flex: 1 }]}>{t("bots.list.required")}</Text>
            <Switch value={field.required} onValueChange={(required) => set(i, { required })} />
          </View>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={value.length >= BOT_LIMITS.formMaxFields}
        onPress={() => onChange([...value, { id: `field${value.length + 1}`, label: "", style: "short", required: false }])}
      >
        <Text style={botStyles.link}>{t("bots.list.addField")}</Text>
      </Pressable>
    </View>
  );
}

const CARD_COLOURS = ["#7c5cff", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#ec4899", "#94a3b8"];

function CardEditor({ value, onChange }: { value: BotCard | undefined; onChange: (value: unknown) => void }) {
  const { t } = useTranslation(["bots"]);
  if (!value)
    return (
      <Pressable accessibilityRole="button" onPress={() => onChange({ title: "", text: "" })}>
        <Text style={botStyles.link}>{t("bots.list.addCard")}</Text>
      </Pressable>
    );
  const set = (patch: Partial<BotCard>) => {
    const next: Record<string, unknown> = { ...value, ...patch };
    for (const key of Object.keys(next)) if (next[key] === "" || next[key] === undefined) delete next[key];
    onChange(next);
  };
  const buttons = value.buttons ?? [];
  return (
    <View style={[botStyles.card, { padding: 10 }]}>
      <View style={botStyles.row}>
        <Input style={{ flex: 1 }} accessibilityLabel={t("bots.list.cardTitle")} placeholder={t("bots.list.cardTitlePlaceholder")} value={value.title ?? ""} onChangeText={(title) => set({ title })} />
        <SmallButton label={t("bots.list.removeCard")} icon="close" onPress={() => onChange(undefined)} />
      </View>
      <Input multiline accessibilityLabel={t("bots.list.cardText")} placeholder={t("bots.list.cardTextPlaceholder")} value={value.text ?? ""} onChangeText={(text) => set({ text })} />
      <View style={[botStyles.row, { flexWrap: "wrap" }]} accessibilityLabel={t("bots.list.cardColour")}>
        {CARD_COLOURS.map((colour) => (
          <Pressable
            key={colour}
            accessibilityRole="button"
            accessibilityState={{ selected: (value.color ?? "#7c5cff") === colour }}
            accessibilityLabel={`${t("bots.list.cardColour")} ${colour}`}
            onPress={() => set({ color: colour })}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colour, borderWidth: (value.color ?? "#7c5cff") === colour ? 3 : 0, borderColor: colors.text }}
          />
        ))}
      </View>
      {buttons.map((button, i) => (
        <View key={i} style={botStyles.row}>
          <Input
            style={{ flex: 1 }}
            accessibilityLabel={t("bots.list.buttonLabel")}
            placeholder={t("bots.list.buttonLabel")}
            value={button.label}
            onChangeText={(label) => set({ buttons: buttons.map((old, j) => (j === i ? { ...old, label } : old)) })}
          />
          <Input
            style={{ flex: 1 }}
            accessibilityLabel={t("bots.list.buttonId")}
            placeholder={t("bots.list.buttonIdPlaceholder")}
            autoCapitalize="none"
            value={button.customId}
            onChangeText={(customId) => set({ buttons: buttons.map((old, j) => (j === i ? { ...old, customId } : old)) })}
          />
          <SmallButton label={t("bots.list.removeButton")} icon="close" onPress={() => set({ buttons: buttons.length > 1 ? buttons.filter((_item, j) => j !== i) : undefined })} />
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={buttons.length >= BOT_LIMITS.cardMaxButtons}
        onPress={() => set({ buttons: [...buttons, { customId: `button${buttons.length + 1}`, label: "", style: "primary" }] })}
      >
        <Text style={botStyles.link}>{t("bots.list.addButton")}</Text>
      </Pressable>
      <Text style={botStyles.muted}>{t("bots.list.buttonHint")}</Text>
    </View>
  );
}

type Schedule = Extract<BotTrigger, { type: "schedule" }>;
type ScheduleMode = "every" | "daily" | "weekly" | "cron";
const FRESH: Record<ScheduleMode, Partial<Schedule>> = {
  every: { every: 60 },
  daily: { daily: "09:00" },
  weekly: { weekly: { day: 1, time: "09:00" } },
  cron: { cron: "0 9 * * 1-5" },
};

/** The schedule trigger's fields: one of every / daily / weekly / cron, plus a time zone. */
export function ScheduleInput({ value, onChange, errors }: { value: Schedule; onChange: (next: Schedule) => void; errors: BotRuleError[] }) {
  const { t } = useTranslation(["bots"]);
  const mode: ScheduleMode = value.daily !== undefined ? "daily" : value.weekly !== undefined ? "weekly" : value.cron !== undefined ? "cron" : "every";
  const error = fieldError(errors, "trigger", mode) ?? fieldError(errors, "trigger", "timezone") ?? errors.find((e) => e.path === "trigger")?.message;
  return (
    <FieldShell label={t("bots.schedule.label")} error={error} hint={t("bots.schedule.hint")}>
      <ChipRow>
        {(["every", "daily", "weekly", "cron"] as const).map((item) => (
          <Chip key={item} label={t(`bots.schedule.${item}`)} on={mode === item} onPress={() => onChange({ type: "schedule", timezone: value.timezone, ...FRESH[item] } as Schedule)} />
        ))}
      </ChipRow>
      {mode === "every" && (
        <View style={botStyles.row}>
          <NumberInput accessibilityLabel={t("bots.schedule.minutesLabel")} value={value.every} onChange={(every) => onChange({ ...value, every: every ?? 0 })} />
          <Text style={botStyles.muted}>{t("bots.schedule.minutes")}</Text>
        </View>
      )}
      {mode === "daily" && (
        <Input accessibilityLabel={t("bots.schedule.time")} placeholder="09:00" keyboardType="numbers-and-punctuation" value={value.daily ?? ""} onChangeText={(daily) => onChange({ ...value, daily })} />
      )}
      {mode === "weekly" && value.weekly && (
        <>
          <Select
            label={t("bots.schedule.day")}
            value={String(value.weekly.day)}
            options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({ value: String(day), label: weekdayName(day, "long") }))}
            onChange={(day) => onChange({ ...value, weekly: { ...value.weekly!, day: Number(day) } })}
          />
          <Input
            accessibilityLabel={t("bots.schedule.time")}
            placeholder="09:00"
            keyboardType="numbers-and-punctuation"
            value={value.weekly.time}
            onChangeText={(time) => onChange({ ...value, weekly: { ...value.weekly!, time } })}
          />
        </>
      )}
      {mode === "cron" && <Input accessibilityLabel={t("bots.schedule.cronExpression")} autoCapitalize="none" value={value.cron ?? ""} onChangeText={(cron) => onChange({ ...value, cron })} />}
      <Input accessibilityLabel={t("bots.schedule.timezone")} placeholder={t("bots.schedule.timezone")} autoCapitalize="none" value={value.timezone} onChangeText={(timezone) => onChange({ ...value, timezone })} />
    </FieldShell>
  );
}

function Control({ field, value, onChange, env, label }: { field: BotFieldDescriptor; value: unknown; onChange: (value: unknown) => void; env: FieldEnv; label: string }) {
  const { t } = useTranslation(["bots"]);
  const str = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  switch (field.kind) {
    case "number":
      return <NumberInput accessibilityLabel={label} value={typeof value === "number" ? value : undefined} optional={!field.required} onChange={onChange} />;
    case "boolean":
      return <Switch accessibilityLabel={label} value={value === true} onValueChange={onChange} />;
    case "channel":
      return (
        <RefSelect
          label={label}
          value={str}
          onChange={onChange}
          items={env.textRooms}
          what="room"
          prefix="#"
          empty={t("bots.field.pickRoom")}
          extra={field.key === "channel" ? [{ value: "trigger", label: t("bots.field.sameRoom") }] : undefined}
        />
      );
    case "voiceRoom":
      return (
        <RefSelect
          label={label}
          value={str}
          onChange={(next) => onChange(next || undefined)}
          items={env.voiceRooms}
          what="voiceRoom"
          prefix=""
          empty={field.required ? t("bots.field.pickVoiceRoom") : t("bots.field.anyVoiceRoom")}
        />
      );
    case "role":
      return <RefSelect label={label} value={str} onChange={onChange} items={env.roles} what="role" prefix="@" empty={t("bots.field.pickRole")} />;
    case "rule":
      return <RefSelect label={label} value={str} onChange={onChange} items={env.rules} what="rule" prefix="" empty={t("bots.field.pickRule")} />;
    case "emoji":
      return <Input accessibilityLabel={label} value={str} maxLength={32} onChangeText={(text) => onChange(text.trim())} style={{ width: 96 }} />;
    case "choice": {
      const choices = field.choices ?? [];
      if (field.multiple) {
        const picked = Array.isArray(value) ? (value as (string | number)[]) : [];
        return (
          <ChipRow>
            {choices.map((choice) => {
              const on = picked.includes(choice);
              return (
                <Chip
                  key={String(choice)}
                  label={field.key === "days" ? weekdayName(Number(choice), "short") : String(choice)}
                  on={on}
                  onPress={() => onChange(on ? picked.filter((item) => item !== choice) : [...picked, choice].sort((a, b) => choices.indexOf(a) - choices.indexOf(b)))}
                />
              );
            })}
          </ChipRow>
        );
      }
      return choices.length <= 4 ? (
        <ChipRow>
          {choices.map((choice) => (
            <Chip key={String(choice)} label={String(choice)} on={String(choice) === str} onPress={() => onChange(choice)} />
          ))}
        </ChipRow>
      ) : (
        <Select label={label} value={str} options={choices.map((choice) => ({ value: String(choice), label: String(choice) }))} onChange={(next) => onChange(choices.find((choice) => String(choice) === next) ?? next)} />
      );
    }
    case "duration":
      return <DurationInput value={typeof value === "number" ? value : undefined} onChange={onChange} optional={!field.required} />;
    case "template": {
      if (field.multiple) {
        const list = Array.isArray(value) ? (value as string[]) : [];
        return (
          <View style={{ gap: 8 }}>
            {list.map((item, i) => (
              <View key={i} style={botStyles.row}>
                <View style={{ flex: 1 }}>
                  <TemplateInput value={item} long={false} variables={env.variables} onChange={(next) => onChange(list.map((old, j) => (j === i ? next : old)))} />
                </View>
                <SmallButton label={t("bots.field.removeChoice")} icon="close" disabled={list.length <= 2} onPress={() => onChange(list.filter((_item, j) => j !== i))} />
              </View>
            ))}
            <Pressable accessibilityRole="button" disabled={list.length >= 10} onPress={() => onChange([...list, ""])}>
              <Text style={botStyles.link}>{t("bots.field.addChoice")}</Text>
            </Pressable>
          </View>
        );
      }
      return (
        <TemplateInput
          value={str}
          onChange={(next) => onChange(next === "" && !field.required ? undefined : next)}
          variables={env.variables}
          long={field.key === "text" || field.key === "body"}
        />
      );
    }
    case "options":
      return <OptionsEditor value={Array.isArray(value) ? (value as BotCommandOption[]) : []} onChange={onChange} />;
    case "form":
      return <FormFieldsEditor value={Array.isArray(value) ? (value as BotFormField[]) : []} onChange={onChange} />;
    case "card":
      return <CardEditor value={value && typeof value === "object" ? (value as BotCard) : undefined} onChange={onChange} />;
    default:
      return <Input accessibilityLabel={label} value={str} autoCapitalize="none" onChangeText={(text) => onChange(text === "" && !field.required ? undefined : text)} />;
  }
}

export function BotFieldInput({ field, part, value, onChange, env, error }: { field: BotFieldDescriptor; part: { kind: CatalogueKind; type: string }; value: unknown; onChange: (value: unknown) => void; env: FieldEnv; error?: string }) {
  const label = fieldLabel(part.kind, part.type, field);
  const showHint = !!field.hint && !["options", "form", "card"].includes(field.kind);
  return (
    <FieldShell label={label} optional={!field.required} error={error} hint={showHint ? fieldHint(part.kind, part.type, field) : undefined}>
      <Control field={field} value={value} onChange={onChange} env={env} label={label} />
    </FieldShell>
  );
}
