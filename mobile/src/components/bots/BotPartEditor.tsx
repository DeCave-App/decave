// A trigger, condition or action: a type picker plus its catalogue fields, and
// an ordered list of conditions or actions with add, remove and move, like
// web's PartEditor.tsx and PartList.tsx.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { CATALOGUE, type BotCatalogueEntry } from "../../../../shared/bots/catalogue";
import type { BotRuleError } from "../../../../shared/bots/schema";
import type { BotTrigger } from "../../../../shared/bots/types";
import { entryDescription, entryLabel, fieldError, type BotPart, type CatalogueKind } from "@/src/lib/bot-builder-model";
import { BotFieldInput, ScheduleInput, type FieldEnv } from "./BotFieldInput";
import { botStyles, Select, SmallButton } from "./BotControls";
import { colors } from "@/src/theme";

export function BotPartEditor({
  kind,
  value,
  path,
  errors,
  env,
  onChange,
  onTypeChange,
  tools,
}: {
  kind: CatalogueKind;
  value: BotPart;
  /** Error path of this part, e.g. "trigger" or "then[2]". */
  path: string;
  errors: BotRuleError[];
  env: FieldEnv;
  onChange: (next: BotPart) => void;
  onTypeChange: (type: string) => void;
  tools?: ReactNode;
}) {
  const { t } = useTranslation(["bots"]);
  const catalogue = CATALOGUE[kind] as Record<string, BotCatalogueEntry>;
  const entry = catalogue[value.type];
  const partError = errors.find((e) => e.path === path)?.message;
  return (
    <View style={[botStyles.card, partError ? { borderColor: colors.red } : null]}>
      <View style={botStyles.row}>
        <View style={{ flex: 1 }}>
          <Select
            label={t(`bots.part.${kind}`)}
            value={value.type}
            options={Object.entries(catalogue).map(([type, item]) => ({ value: type, label: entryLabel(kind, type, item), detail: entryDescription(kind, type, item) }))}
            onChange={onTypeChange}
          />
        </View>
        {tools}
      </View>
      {entry && <Text style={botStyles.muted}>{entryDescription(kind, value.type, entry)}</Text>}
      {entry?.fields.map((field) =>
        field.kind === "schedule" ? (
          <ScheduleInput
            key={field.key}
            value={value as unknown as Extract<BotTrigger, { type: "schedule" }>}
            errors={errors}
            onChange={(next) => onChange(next as unknown as BotPart)}
          />
        ) : (
          <BotFieldInput
            key={field.key}
            field={field}
            part={{ kind, type: value.type }}
            value={value[field.key]}
            env={env}
            error={fieldError(errors, path, field.key)}
            onChange={(next) => {
              const copy: BotPart = { ...value, [field.key]: next };
              if (next === undefined) delete copy[field.key];
              onChange(copy);
            }}
          />
        ),
      )}
      {!!partError && <Text style={{ color: colors.red, fontSize: 12, fontWeight: "700" }}>{partError}</Text>}
    </View>
  );
}

export function BotPartList({
  kind,
  items,
  path,
  errors,
  env,
  limit,
  addLabel,
  makeDefault,
  onChange,
}: {
  kind: "conditions" | "actions";
  items: BotPart[];
  path: string;
  errors: BotRuleError[];
  env: FieldEnv;
  limit: number;
  addLabel: string;
  makeDefault: (type: string) => BotPart;
  onChange: (items: BotPart[]) => void;
}) {
  const { t } = useTranslation(["bots"]);
  const types = Object.keys(CATALOGUE[kind]);
  const replace = (i: number, next: BotPart) => onChange(items.map((item, j) => (j === i ? next : item)));
  const move = (i: number, delta: number) => {
    const list = [...items];
    [list[i], list[i + delta]] = [list[i + delta], list[i]];
    onChange(list);
  };
  const listError = errors.find((e) => e.path === path)?.message;
  return (
    <View style={{ gap: 10 }}>
      {items.map((item, i) => (
        <BotPartEditor
          key={i}
          kind={kind}
          value={item}
          path={`${path}[${i}]`}
          errors={errors}
          env={env}
          onChange={(next) => replace(i, next)}
          onTypeChange={(type) => replace(i, makeDefault(type))}
          tools={
            <>
              {kind === "actions" && items.length > 1 && (
                <>
                  <SmallButton label={t("bots.part.moveUp")} icon="arrow-up" disabled={i === 0} onPress={() => move(i, -1)} />
                  <SmallButton label={t("bots.part.moveDown")} icon="arrow-down" disabled={i === items.length - 1} onPress={() => move(i, 1)} />
                </>
              )}
              <SmallButton label={t("bots.part.remove")} icon="close" danger onPress={() => onChange(items.filter((_item, j) => j !== i))} />
            </>
          }
        />
      ))}
      {!!listError && <Text style={{ color: colors.red, fontSize: 12, fontWeight: "700" }}>{listError}</Text>}
      <Pressable accessibilityRole="button" disabled={items.length >= limit} onPress={() => onChange([...items, makeDefault(types[0])])} style={{ opacity: items.length >= limit ? 0.4 : 1 }}>
        <Text style={botStyles.link}>{addLabel}</Text>
      </Pressable>
    </View>
  );
}
