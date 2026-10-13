// Editors for the list-shaped fields: slash command options, form fields and cards.
import { useTranslation } from "react-i18next";
import type { BotCard, BotCommandOption, BotFormField } from "../../../shared/bots/types.ts";
import { BOT_LIMITS } from "../../../shared/bots/types.ts";

const OPTION_TYPES: BotCommandOption["type"][] = ["text", "number", "user", "role", "channel", "choice"];

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="dcx-btn dcx-btn-sm dcx-btn-ghost" aria-label={label} onClick={onClick}>
      ×
    </button>
  );
}

export function OptionsEditor({ value, onChange }: { value: BotCommandOption[]; onChange: (v: unknown) => void }) {
  const { t } = useTranslation(["bots"]);
  const set = (i: number, patch: Partial<BotCommandOption>) =>
    onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="bb-list">
      {value.length === 0 && <small className="bb-hint">{t("bots.list.noOptions")}</small>}
      {value.map((option, i) => (
        <div key={i} className="bb-list-row">
          <input
            className="dcx-input"
            aria-label={t("bots.list.optionName")}
            placeholder={t("bots.list.optionNamePlaceholder")}
            value={option.name}
            onChange={(e) => set(i, { name: e.target.value.toLowerCase() })}
          />
          <select
            className="dcx-input"
            aria-label={t("bots.list.optionType")}
            value={option.type}
            onChange={(e) => {
              const type = e.target.value as BotCommandOption["type"];
              set(
                i,
                type === "choice" ? { type, choices: option.choices ?? ["a", "b"] } : { type, choices: undefined },
              );
            }}
          >
            {OPTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`bots.list.optionTypes.${type}`)}
              </option>
            ))}
          </select>
          {option.type === "choice" && (
            <input
              className="dcx-input"
              aria-label={t("bots.list.choices")}
              placeholder={t("bots.list.choicesPlaceholder")}
              value={(option.choices ?? []).join(", ")}
              onChange={(e) => set(i, { choices: e.target.value.split(",").map((c) => c.trim()) })}
            />
          )}
          <label className="bb-check">
            <input type="checkbox" checked={option.required} onChange={(e) => set(i, { required: e.target.checked })} />
            {t("bots.list.required")}
          </label>
          <RemoveButton label={t("bots.list.removeOption")} onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button
        type="button"
        className="dcx-btn dcx-btn-sm bb-add"
        disabled={value.length >= 10}
        onClick={() => onChange([...value, { name: `option${value.length + 1}`, type: "text", required: false }])}
      >
        {t("bots.list.addOption")}
      </button>
    </div>
  );
}

export function FormFieldsEditor({ value, onChange }: { value: BotFormField[]; onChange: (v: unknown) => void }) {
  const { t } = useTranslation(["bots"]);
  const set = (i: number, patch: Partial<BotFormField>) =>
    onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="bb-list">
      {value.map((f, i) => (
        <div key={i} className="bb-list-row">
          <input
            className="dcx-input"
            aria-label={t("bots.list.fieldLabel")}
            placeholder={t("bots.list.fieldLabelPlaceholder")}
            value={f.label}
            onChange={(e) => set(i, { label: e.target.value })}
          />
          <input
            className="dcx-input"
            aria-label={t("bots.list.fieldId")}
            placeholder={t("bots.list.fieldIdPlaceholder")}
            value={f.id}
            onChange={(e) => set(i, { id: e.target.value })}
          />
          <select
            className="dcx-input"
            aria-label={t("bots.list.fieldSize")}
            value={f.style}
            onChange={(e) => set(i, { style: e.target.value as BotFormField["style"] })}
          >
            <option value="short">{t("bots.list.short")}</option>
            <option value="long">{t("bots.list.long")}</option>
          </select>
          <label className="bb-check">
            <input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} />
            {t("bots.list.required")}
          </label>
          <RemoveButton label={t("bots.list.removeField")} onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button
        type="button"
        className="dcx-btn dcx-btn-sm bb-add"
        disabled={value.length >= BOT_LIMITS.formMaxFields}
        onClick={() =>
          onChange([...value, { id: `field${value.length + 1}`, label: "", style: "short", required: false }])
        }
      >
        {t("bots.list.addField")}
      </button>
    </div>
  );
}

export function CardEditor({ value, onChange }: { value: BotCard | undefined; onChange: (v: unknown) => void }) {
  const { t } = useTranslation(["bots"]);
  if (!value)
    return (
      <button type="button" className="dcx-btn dcx-btn-sm bb-add" onClick={() => onChange({ title: "", text: "" })}>
        {t("bots.list.addCard")}
      </button>
    );
  const set = (patch: Partial<BotCard>) => {
    const next: Record<string, unknown> = { ...value, ...patch };
    for (const key of Object.keys(next)) if (next[key] === "" || next[key] === undefined) delete next[key];
    onChange(next);
  };
  const buttons = value.buttons ?? [];
  return (
    <div className="bb-list bb-card-editor">
      <div className="bb-list-row">
        <input
          className="dcx-input"
          aria-label={t("bots.list.cardTitle")}
          placeholder={t("bots.list.cardTitlePlaceholder")}
          value={value.title ?? ""}
          onChange={(e) => set({ title: e.target.value })}
        />
        <input
          className="bb-color"
          type="color"
          aria-label={t("bots.list.cardColour")}
          value={value.color ?? "#7c5cff"}
          onChange={(e) => set({ color: e.target.value })}
        />
        <RemoveButton label={t("bots.list.removeCard")} onClick={() => onChange(undefined)} />
      </div>
      <textarea
        className="dcx-input"
        aria-label={t("bots.list.cardText")}
        placeholder={t("bots.list.cardTextPlaceholder")}
        rows={2}
        value={value.text ?? ""}
        onChange={(e) => set({ text: e.target.value })}
      />
      {buttons.map((b, i) => (
        <div key={i} className="bb-list-row">
          <input
            className="dcx-input"
            aria-label={t("bots.list.buttonLabel")}
            placeholder={t("bots.list.buttonLabel")}
            value={b.label}
            onChange={(e) =>
              set({ buttons: buttons.map((old, j) => (j === i ? { ...old, label: e.target.value } : old)) })
            }
          />
          <input
            className="dcx-input"
            aria-label={t("bots.list.buttonId")}
            placeholder={t("bots.list.buttonIdPlaceholder")}
            value={b.customId}
            onChange={(e) =>
              set({ buttons: buttons.map((old, j) => (j === i ? { ...old, customId: e.target.value } : old)) })
            }
          />
          <RemoveButton
            label={t("bots.list.removeButton")}
            onClick={() => set({ buttons: buttons.length > 1 ? buttons.filter((_, j) => j !== i) : undefined })}
          />
        </div>
      ))}
      <button
        type="button"
        className="dcx-btn dcx-btn-sm bb-add"
        disabled={buttons.length >= BOT_LIMITS.cardMaxButtons}
        onClick={() =>
          set({ buttons: [...buttons, { customId: `button${buttons.length + 1}`, label: "", style: "primary" }] })
        }
      >
        {t("bots.list.addButton")}
      </button>
      <small className="bb-hint">{t("bots.list.buttonHint")}</small>
    </div>
  );
}
