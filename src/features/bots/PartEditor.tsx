// One trigger, condition or action: a type dropdown plus its catalogue fields.
import type { ReactNode } from "react";
import { CATALOGUE, type BotCatalogueEntry } from "../../../shared/bots/catalogue.ts";
import type { BotRuleError } from "../../../shared/bots/schema.ts";
import type { BotTrigger } from "../../../shared/bots/types.ts";
import { FieldInput, type FieldEnv } from "./FieldInput";
import { fieldError } from "./model.ts";
import { ScheduleInput } from "./ScheduleInput";

export type PartKind = keyof typeof CATALOGUE;
type Part = { type: string } & Record<string, unknown>;

type Props = {
  kind: PartKind;
  value: Part;
  /** Error path of this part, e.g. "trigger" or "then[2]". */
  path: string;
  errors: BotRuleError[];
  env: FieldEnv;
  onChange: (next: Part) => void;
  onTypeChange: (type: string) => void;
  /** Buttons shown next to the type select (move, remove). */
  tools?: ReactNode;
};

export function PartEditor({ kind, value, path, errors, env, onChange, onTypeChange, tools }: Props) {
  const catalogue = CATALOGUE[kind] as Record<string, BotCatalogueEntry>;
  const entry = catalogue[value.type];
  const partError = errors.find((e) => e.path === path)?.message;
  return (
    <div className={`bb-part${partError ? " invalid" : ""}`}>
      <div className="bb-part-head">
        <select
          className="dcx-input bb-type"
          aria-label={kind === "triggers" ? "Trigger" : kind === "conditions" ? "Condition" : "Action"}
          value={value.type}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          {Object.entries(catalogue).map(([type, item]) => (
            <option key={type} value={type}>
              {item.label}
            </option>
          ))}
        </select>
        {entry && <small className="bb-hint bb-part-desc">{entry.description}</small>}
        {tools && <span className="bb-part-tools">{tools}</span>}
      </div>
      {entry && entry.fields.length > 0 && (
        <div className="bb-fields">
          {entry.fields.map((field) =>
            field.kind === "schedule" ? (
              <ScheduleInput
                key={field.key}
                value={value as unknown as Extract<BotTrigger, { type: "schedule" }>}
                errors={errors}
                onChange={(next) => onChange(next as unknown as Part)}
              />
            ) : (
              <FieldInput
                key={field.key}
                field={field}
                value={value[field.key]}
                env={env}
                error={fieldError(errors, path, field.key)}
                onChange={(next) => {
                  const copy: Part = { ...value, [field.key]: next };
                  if (next === undefined) delete copy[field.key];
                  onChange(copy);
                }}
              />
            ),
          )}
        </div>
      )}
      {partError && (
        <small className="bb-error" role="alert">
          {partError}
        </small>
      )}
    </div>
  );
}
