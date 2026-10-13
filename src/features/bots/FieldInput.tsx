// One field of a trigger, condition or action, rendered from its catalogue
// descriptor. Lists (command options, form fields, cards) live in ListFields.
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BotFieldDescriptor } from "../../../shared/bots/catalogue.ts";
import { CardEditor, FormFieldsEditor, OptionsEditor } from "./ListFields";
import { fieldHint, fieldLabel, type CatalogueKind } from "./catalogueText";
import { deletedLabel, type BotRefKind, type HubRef } from "./model.ts";
import { weekdayName } from "../shared/dateParts";
import { TemplatePreview, VariablePicker, type BotVariable } from "./VariablePicker";

export type FieldEnv = {
  textRooms: HubRef[];
  voiceRooms: HubRef[];
  roles: HubRef[];
  rules: HubRef[];
  variables: BotVariable[];
};

type Props = {
  field: BotFieldDescriptor;
  /** The trigger, condition or action the field belongs to (for its translated label). */
  part: { kind: CatalogueKind; type: string };
  value: unknown;
  onChange: (value: unknown) => void;
  env: FieldEnv;
  error?: string;
};

const UNITS = [
  { unit: "minutes", size: 1 },
  { unit: "hours", size: 60 },
  { unit: "days", size: 1440 },
] as const;

function TemplateInput({
  value,
  onChange,
  variables,
  id,
  long,
}: {
  value: string;
  onChange: (v: string) => void;
  variables: BotVariable[];
  id: string;
  long: boolean;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  return (
    <span className="bb-template">
      <span className="bb-template-row">
        {long ? (
          <textarea
            id={id}
            ref={ref}
            className="dcx-input"
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input id={id} ref={ref} className="dcx-input" value={value} onChange={(e) => onChange(e.target.value)} />
        )}
        <VariablePicker variables={variables} inputRef={ref} value={value} onChange={onChange} />
      </span>
      <TemplatePreview text={value} variables={variables} />
    </span>
  );
}

function DurationInput({
  value,
  onChange,
  id,
  optional,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  id: string;
  optional: boolean;
}) {
  const { t } = useTranslation(["bots"]);
  const unit = value && value % 1440 === 0 ? UNITS[2] : value && value % 60 === 0 ? UNITS[1] : UNITS[0];
  return (
    <span className="bb-inline">
      <input
        id={id}
        className="dcx-input bb-num"
        type="number"
        min={optional ? 0 : 1}
        placeholder={optional ? t("bots.field.keep") : undefined}
        value={value === undefined ? "" : value / unit.size}
        onChange={(e) => {
          if (e.target.value === "" && optional) return onChange(undefined);
          onChange(Math.max(0, Math.round(Number(e.target.value) * unit.size)));
        }}
      />
      <select
        className="dcx-input bb-unit"
        aria-label={t("bots.field.unit")}
        value={unit.size}
        onChange={(e) => onChange(value === undefined ? undefined : (value / unit.size) * Number(e.target.value))}
      >
        {UNITS.map((u) => (
          <option key={u.size} value={u.size}>
            {t(`bots.field.units.${u.unit}`)}
          </option>
        ))}
      </select>
    </span>
  );
}

function RefSelect({
  what,
  id,
  value,
  onChange,
  items,
  prefix,
  empty,
  extra,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  items: HubRef[];
  prefix: string;
  empty: string;
  extra?: { value: string; label: string }[];
  what: BotRefKind;
}) {
  const known = value === "" || items.some((i) => i.id === value) || extra?.some((e) => e.value === value);
  return (
    <select id={id} className="dcx-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {extra?.map((e) => (
        <option key={e.value} value={e.value}>
          {e.label}
        </option>
      ))}
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {prefix}
          {item.name}
        </option>
      ))}
      {!known && (
        <option value={value}>
          {prefix}
          {deletedLabel(what)}
        </option>
      )}
    </select>
  );
}

function Control({ field, value, onChange, env, id }: Omit<Props, "error"> & { id: string }) {
  const { t } = useTranslation(["bots"]);
  const str = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  switch (field.kind) {
    case "number":
      return (
        <input
          id={id}
          className="dcx-input bb-num"
          type="number"
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" && !field.required ? undefined : Number(e.target.value))}
        />
      );
    case "boolean":
      return (
        <label className="dcx-switch">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span aria-hidden="true" />
        </label>
      );
    case "channel":
      return (
        <RefSelect
          id={id}
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
          id={id}
          value={str}
          onChange={(v) => onChange(v || undefined)}
          items={env.voiceRooms}
          what="voiceRoom"
          prefix=""
          empty={field.required ? t("bots.field.pickVoiceRoom") : t("bots.field.anyVoiceRoom")}
        />
      );
    case "role":
      return (
        <RefSelect
          id={id}
          value={str}
          onChange={onChange}
          items={env.roles}
          what="role"
          prefix="@"
          empty={t("bots.field.pickRole")}
        />
      );
    case "rule":
      return (
        <RefSelect
          id={id}
          value={str}
          onChange={onChange}
          items={env.rules}
          what="rule"
          prefix=""
          empty={t("bots.field.pickRule")}
        />
      );
    case "emoji":
      return (
        <input
          id={id}
          className="dcx-input bb-emoji"
          value={str}
          maxLength={32}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      );
    case "choice": {
      const choices = field.choices ?? [];
      if (field.multiple) {
        const picked = Array.isArray(value) ? (value as (string | number)[]) : [];
        return (
          <span className="bb-chips" role="group" id={id}>
            {choices.map((c) => {
              const on = picked.includes(c);
              return (
                <button
                  key={String(c)}
                  type="button"
                  className={`bb-chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() =>
                    onChange(
                      on
                        ? picked.filter((p) => p !== c)
                        : [...picked, c].sort((a, b) => choices.indexOf(a) - choices.indexOf(b)),
                    )
                  }
                >
                  {field.key === "days" ? weekdayName(Number(c), "short") : String(c)}
                </button>
              );
            })}
          </span>
        );
      }
      return (
        <select
          id={id}
          className="dcx-input"
          value={str}
          onChange={(e) => {
            const picked = choices.find((c) => String(c) === e.target.value);
            onChange(picked ?? e.target.value);
          }}
        >
          {choices.map((c) => (
            <option key={String(c)} value={String(c)}>
              {String(c)}
            </option>
          ))}
        </select>
      );
    }
    case "duration":
      return (
        <DurationInput
          id={id}
          value={typeof value === "number" ? value : undefined}
          onChange={onChange}
          optional={!field.required}
        />
      );
    case "template": {
      if (field.multiple) {
        const list = Array.isArray(value) ? (value as string[]) : [];
        return (
          <span className="bb-list">
            {list.map((item, i) => (
              <span key={i} className="bb-inline">
                <TemplateInput
                  id={`${id}-${i}`}
                  value={item}
                  long={false}
                  variables={env.variables}
                  onChange={(v) => onChange(list.map((old, j) => (j === i ? v : old)))}
                />
                <button
                  type="button"
                  className="dcx-btn dcx-btn-sm dcx-btn-ghost"
                  aria-label={t("bots.field.removeChoice")}
                  disabled={list.length <= 2}
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="dcx-btn dcx-btn-sm bb-add"
              disabled={list.length >= 10}
              onClick={() => onChange([...list, ""])}
            >
              {t("bots.field.addChoice")}
            </button>
          </span>
        );
      }
      return (
        <TemplateInput
          id={id}
          value={str}
          onChange={(v) => onChange(v === "" && !field.required ? undefined : v)}
          variables={env.variables}
          long={field.key === "text" || field.key === "body"}
        />
      );
    }
    case "options":
      return <OptionsEditor value={Array.isArray(value) ? value : []} onChange={onChange} />;
    case "form":
      return <FormFieldsEditor value={Array.isArray(value) ? value : []} onChange={onChange} />;
    case "card":
      return <CardEditor value={value && typeof value === "object" ? value : undefined} onChange={onChange} />;
    default:
      return (
        <input
          id={id}
          className="dcx-input"
          value={str}
          onChange={(e) => onChange(e.target.value === "" && !field.required ? undefined : e.target.value)}
        />
      );
  }
}

export function FieldInput(props: Props) {
  const { t } = useTranslation(["bots"]);
  const id = useId();
  const { field, error, part } = props;
  const wide = ["template", "options", "form", "card"].includes(field.kind);
  return (
    <div className={`bb-field${wide ? " wide" : ""}${error ? " invalid" : ""}`}>
      <label className="bb-field-label" htmlFor={id}>
        {fieldLabel(part.kind, part.type, field)}
        {!field.required && <span className="bb-optional">{t("bots.field.optional")}</span>}
      </label>
      <Control {...props} id={id} />
      {error ? (
        <small className="bb-error" role="alert">
          {error}
        </small>
      ) : field.hint && !["options", "form", "card"].includes(field.kind) ? (
        <small className="bb-hint">{fieldHint(part.kind, part.type, field)}</small>
      ) : null}
    </div>
  );
}
