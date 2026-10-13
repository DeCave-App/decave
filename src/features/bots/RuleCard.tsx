// One rule as a sentence card: When [trigger] · If [conditions] · Do [actions] ·
// Otherwise [else]. Collapsed it reads as a sentence; expanded every part is editable.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BotAction, BotCondition, BotRule, BotTrigger } from "../../../shared/bots/types.ts";
import { BOT_LIMITS } from "../../../shared/bots/types.ts";
import type { FieldEnv } from "./FieldInput";
import {
  defaultAction,
  defaultCondition,
  defaultTrigger,
  fieldError,
  ruleToSentence,
  sameRule,
  type BotNames,
} from "./model.ts";
import { PartEditor } from "./PartEditor";
import { PartList } from "./PartList";
import type { LocalRule } from "./useRuleDrafts";

type Part = { type: string } & Record<string, unknown>;

type Props = {
  rule: LocalRule;
  label: string;
  names: BotNames;
  env: FieldEnv;
  expanded: boolean;
  first: boolean;
  last: boolean;
  aiAvailable: boolean;
  onExpand: (open: boolean) => void;
  onEdit: (draft: BotRule) => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
  onAskAi: (description: string) => Promise<void>;
};

function ScopeOptions({ rule, env, onEdit }: { rule: BotRule; env: FieldEnv; onEdit: (draft: BotRule) => void }) {
  const { t } = useTranslation(["bots"]);
  const everywhere = rule.scope.channels.includes("*");
  const toggleRoom = (id: string) => {
    const current = rule.scope.channels.filter((c) => c !== "*");
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    onEdit({ ...rule, scope: { ...rule.scope, channels: next.length ? next : ["*"] } });
  };
  return (
    <details className="bb-more">
      <summary>{t("bots.ruleCard.scope")}</summary>
      <div className="bb-fields">
        <div className="bb-field wide">
          <span className="bb-field-label">{t("bots.ruleCard.rooms")}</span>
          <span className="bb-chips">
            <button
              type="button"
              className={`bb-chip${everywhere ? " on" : ""}`}
              aria-pressed={everywhere}
              onClick={() => onEdit({ ...rule, scope: { ...rule.scope, channels: ["*"] } })}
            >
              {t("bots.ruleCard.allRooms")}
            </button>
            {env.textRooms.map((room) => {
              const on = rule.scope.channels.includes(room.id);
              return (
                <button
                  key={room.id}
                  type="button"
                  className={`bb-chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleRoom(room.id)}
                >
                  #{room.name}
                </button>
              );
            })}
          </span>
        </div>
        <div className="bb-field">
          <label className="bb-field-label" htmlFor={`cd-user-${rule.trigger.type}`}>
            {t("bots.ruleCard.cooldownMember")}
          </label>
          <input
            id={`cd-user-${rule.trigger.type}`}
            className="dcx-input bb-num"
            type="number"
            min={0}
            value={rule.cooldown.perUser}
            onChange={(e) => onEdit({ ...rule, cooldown: { ...rule.cooldown, perUser: Number(e.target.value) } })}
          />
        </div>
        <div className="bb-field">
          <label className="bb-field-label" htmlFor={`cd-room-${rule.trigger.type}`}>
            {t("bots.ruleCard.cooldownRoom")}
          </label>
          <input
            id={`cd-room-${rule.trigger.type}`}
            className="dcx-input bb-num"
            type="number"
            min={0}
            value={rule.cooldown.perChannel}
            onChange={(e) => onEdit({ ...rule, cooldown: { ...rule.cooldown, perChannel: Number(e.target.value) } })}
          />
        </div>
      </div>
    </details>
  );
}

function AiEdit({ onAskAi }: { onAskAi: (description: string) => Promise<void> }) {
  const { t } = useTranslation(["bots"]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="bb-ai-edit"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        try {
          await onAskAi(text.trim());
          setText("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        className="dcx-input"
        aria-label={t("bots.ruleCard.aiLabel")}
        placeholder={t("bots.ruleCard.aiPlaceholder")}
        value={text}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="dcx-btn dcx-btn-sm" disabled={!text.trim() || busy}>
        {busy ? t("bots.ruleCard.thinking") : t("bots.ruleCard.change")}
      </button>
    </form>
  );
}

export function RuleCard(props: Props) {
  const { t } = useTranslation(["bots"]);
  const { rule, label, names, env, expanded, onEdit } = props;
  const draft = rule.draft;
  const errors = rule.errors;
  const conditionKey: "all" | "any" = draft.when?.any?.length && !draft.when?.all?.length ? "any" : "all";
  const conditions = (draft.when?.[conditionKey] ?? []) as Part[];
  const otherKey = conditionKey === "all" ? "any" : "all";
  const live = rule.published !== null;
  const changed = live && !sameRule(rule.saved ?? rule.draft, rule.published);

  const setConditions = (items: Part[], key: "all" | "any" = conditionKey) => {
    const when = { ...draft.when, [key]: items as unknown as BotCondition[] };
    if (!items.length) delete when[key];
    const next: BotRule = { ...draft, when };
    if (!when.all && !when.any) delete next.when;
    onEdit(next);
  };

  return (
    <article className={`bb-rule${expanded ? " open" : ""}${rule.enabled ? "" : " paused"}`} aria-label={label}>
      <header className="bb-rule-head">
        <button
          type="button"
          className="bb-rule-summary"
          aria-expanded={expanded}
          onClick={() => props.onExpand(!expanded)}
        >
          <span className="bb-rule-label">{label}</span>
          <span className="bb-sentence">{ruleToSentence(draft, names)}</span>
        </button>
        <span className="bb-rule-tools">
          <span
            className={`bb-status ${rule.status}`}
            title={rule.message ?? (errors.length ? errors.map((e) => e.message).join("\n") : undefined)}
          >
            {!rule.enabled
              ? t("bots.ruleCard.paused")
              : rule.status === "saved"
                ? !live
                  ? t("bots.ruleCard.new")
                  : changed
                    ? t("bots.ruleCard.changed")
                    : t("bots.status.live")
                : t(`bots.ruleCard.status.${rule.status}`)}
          </span>
          <label
            className="dcx-switch"
            title={rule.enabled ? t("bots.ruleCard.pauseTitle") : t("bots.ruleCard.resumeTitle")}
          >
            <input
              type="checkbox"
              aria-label={rule.enabled ? t("bots.ruleCard.pause", { label }) : t("bots.ruleCard.resume", { label })}
              checked={rule.enabled}
              disabled={!rule.id}
              onChange={props.onToggle}
            />
            <span aria-hidden="true" />
          </label>
          <button
            type="button"
            className="dcx-btn dcx-btn-sm dcx-btn-ghost"
            aria-label={t("bots.ruleCard.moveUp", { label })}
            title={t("bots.part.moveUp")}
            disabled={props.first}
            onClick={() => props.onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="dcx-btn dcx-btn-sm dcx-btn-ghost"
            aria-label={t("bots.ruleCard.moveDown", { label })}
            title={t("bots.part.moveDown")}
            disabled={props.last}
            onClick={() => props.onMove(1)}
          >
            ↓
          </button>
          <button type="button" className="dcx-btn dcx-btn-sm dcx-btn-ghost" onClick={props.onDuplicate}>
            {t("bots.ruleCard.duplicate")}
          </button>
          <button type="button" className="dcx-btn dcx-btn-sm dcx-btn-ghost bb-danger-text" onClick={props.onDelete}>
            {t("bots.ruleCard.delete")}
          </button>
        </span>
      </header>

      {!expanded && errors.length > 0 && (
        <p className="bb-error bb-rule-errors" role="alert">
          {errors.length > 1
            ? t("bots.ruleCard.errorsMore", { message: errors[0].message, count: errors.length - 1 })
            : t("bots.ruleCard.error", { message: errors[0].message })}
        </p>
      )}

      {expanded && (
        <div className="bb-rule-body">
          {rule.generated && <p className="dcx-notice dcx-notice-info bb-generated">{t("bots.ruleCard.generated")}</p>}
          {rule.message && <p className="dcx-notice dcx-notice-error">{rule.message}</p>}

          <section className="bb-step">
            <h5>{t("bots.ruleCard.when")}</h5>
            <PartEditor
              kind="triggers"
              value={draft.trigger as unknown as Part}
              path="trigger"
              errors={errors}
              env={env}
              onChange={(trigger) => onEdit({ ...draft, trigger: trigger as unknown as BotTrigger })}
              onTypeChange={(type) => onEdit({ ...draft, trigger: defaultTrigger(type as BotTrigger["type"]) })}
            />
            <ScopeOptions rule={draft} env={env} onEdit={onEdit} />
            {fieldError(errors, "", "scope") && <small className="bb-error">{fieldError(errors, "", "scope")}</small>}
          </section>

          <section className="bb-step">
            <h5>
              {t("bots.ruleCard.if")}
              {conditions.length > 1 && (
                <select
                  className="dcx-input bb-match"
                  aria-label={t("bots.ruleCard.match")}
                  value={conditionKey}
                  onChange={(e) => {
                    const key = e.target.value as "all" | "any";
                    const when = { [key]: conditions as unknown as BotCondition[] };
                    onEdit({ ...draft, when });
                  }}
                >
                  <option value="all">{t("bots.ruleCard.all")}</option>
                  <option value="any">{t("bots.ruleCard.any")}</option>
                </select>
              )}
            </h5>
            {conditions.length === 0 && <small className="bb-hint">{t("bots.ruleCard.always")}</small>}
            <PartList
              kind="conditions"
              items={conditions}
              path={`when.${conditionKey}`}
              errors={errors}
              env={env}
              limit={20}
              addLabel={t("bots.ruleCard.addCondition")}
              makeDefault={(type) => defaultCondition(type as BotCondition["type"]) as unknown as Part}
              onChange={(items) => setConditions(items)}
            />
            {(draft.when?.[otherKey]?.length ?? 0) > 0 && (
              <PartList
                kind="conditions"
                items={draft.when![otherKey] as unknown as Part[]}
                path={`when.${otherKey}`}
                errors={errors}
                env={env}
                limit={20}
                addLabel={t("bots.ruleCard.addConditionTo", { key: otherKey })}
                makeDefault={(type) => defaultCondition(type as BotCondition["type"]) as unknown as Part}
                onChange={(items) => setConditions(items, otherKey)}
              />
            )}
          </section>

          <section className="bb-step">
            <h5>{t("bots.ruleCard.do")}</h5>
            <PartList
              kind="actions"
              items={draft.then as unknown as Part[]}
              path="then"
              errors={errors}
              env={env}
              limit={BOT_LIMITS.actionsPerRule}
              addLabel={t("bots.ruleCard.addAction")}
              makeDefault={(type) => defaultAction(type as BotAction["type"]) as unknown as Part}
              onChange={(items) => onEdit({ ...draft, then: items as unknown as BotAction[] })}
            />
          </section>

          {(conditions.length > 0 || (draft.else?.length ?? 0) > 0) && (
            <section className="bb-step">
              <h5>{t("bots.ruleCard.otherwise")}</h5>
              <PartList
                kind="actions"
                items={(draft.else ?? []) as unknown as Part[]}
                path="else"
                errors={errors}
                env={env}
                limit={BOT_LIMITS.actionsPerRule}
                addLabel={t("bots.ruleCard.addAction")}
                makeDefault={(type) => defaultAction(type as BotAction["type"]) as unknown as Part}
                onChange={(items) => {
                  const next: BotRule = { ...draft, else: items as unknown as BotAction[] };
                  if (!items.length) delete next.else;
                  onEdit(next);
                }}
              />
            </section>
          )}

          {props.aiAvailable && rule.id && <AiEdit onAskAi={props.onAskAi} />}
        </div>
      )}
    </article>
  );
}
