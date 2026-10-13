// The Rules tab: the bot's rule cards, add / duplicate / reorder, and AI drafts.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BOT_LIMITS, type BotRule } from "../../../shared/bots/types.ts";
import type { FieldEnv } from "./FieldInput";
import { newRule, ruleLabel, variablesFor, type BotNames } from "./model.ts";
import { RuleCard } from "./RuleCard";
import type { LocalRule, useRuleDrafts } from "./useRuleDrafts";
import type { HubRef } from "./model.ts";
import { DescribeBox } from "./DescribeBox";

type Drafts = ReturnType<typeof useRuleDrafts>;

type Props = {
  drafts: Drafts;
  names: BotNames;
  hub: { textRooms: HubRef[]; voiceRooms: HubRef[]; roles: HubRef[] };
  ai: { available: boolean; remaining: number };
  unsupported: string[];
  onGenerate: (description: string, ruleId?: string) => Promise<{ rules: BotRule[]; unsupported: string[] } | null>;
};

export function RulesTab({ drafts, names, hub, ai, unsupported, onGenerate }: Props) {
  const { t } = useTranslation(["bots"]);
  const [open, setOpen] = useState<string | null>(() => drafts.rules.find((r) => r.status === "invalid")?.key ?? null);
  const [confirmDelete, setConfirmDelete] = useState<LocalRule | null>(null);
  const [error, setError] = useState("");
  const ruleRefs: HubRef[] = useMemo(
    () => drafts.rules.flatMap((r, i) => (r.id ? [{ id: r.id, name: ruleLabel(i) }] : [])),
    [drafts.rules],
  );

  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("bots.newBot.genericError"));
    }
  };

  const full = drafts.rules.length >= BOT_LIMITS.rulesPerBot;

  return (
    <div className="bb-rules">
      {error && <p className="dcx-notice dcx-notice-error">{error}</p>}
      {unsupported.length > 0 && (
        <div className="dcx-notice dcx-notice-warn">
          <strong>{t("bots.rules.unsupported")}</strong>
          <ul>
            {unsupported.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}
      {drafts.rules.length === 0 && (
        <div className="bb-empty">
          <strong>{t("bots.rules.emptyTitle")}</strong>
          <span>{t("bots.rules.emptyHint")}</span>
        </div>
      )}
      {drafts.rules.map((rule, i) => {
        const env: FieldEnv = {
          ...hub,
          rules: ruleRefs.filter((r) => r.id !== rule.id),
          variables: variablesFor(rule.draft.trigger),
        };
        return (
          <RuleCard
            key={rule.key}
            rule={rule}
            label={ruleLabel(i)}
            names={names}
            env={env}
            expanded={open === rule.key}
            first={i === 0}
            last={i === drafts.rules.length - 1}
            aiAvailable={ai.available && ai.remaining > 0}
            onExpand={(value) => setOpen(value ? rule.key : null)}
            onEdit={(draft) => drafts.edit(rule.key, draft)}
            onToggle={() => void run(() => drafts.toggle(rule.key))}
            onDuplicate={() => {
              if (full) return setError(t("bots.rules.limit", { count: BOT_LIMITS.rulesPerBot }));
              setOpen(drafts.add(structuredClone(rule.draft)));
            }}
            onDelete={() => setConfirmDelete(rule)}
            onMove={(delta) => void run(() => drafts.move(rule.key, delta))}
            onAskAi={async (description) => {
              const result = await onGenerate(description, rule.id ?? undefined);
              if (result?.rules[0]) drafts.edit(rule.key, result.rules[0], true);
            }}
          />
        );
      })}

      <div className="bb-rules-foot">
        <button
          type="button"
          className="dcx-btn dcx-btn-primary"
          disabled={full}
          onClick={() => setOpen(drafts.add(newRule("command")))}
        >
          {t("bots.rules.add")}
        </button>
        {ai.available && (
          <DescribeBox
            compact
            remaining={ai.remaining}
            placeholder={t("bots.rules.describePlaceholder")}
            onSubmit={async (description) => {
              const result = await onGenerate(description);
              let last: string | null = null;
              for (const rule of result?.rules ?? []) last = drafts.add(rule, true);
              if (last) setOpen(last);
            }}
          />
        )}
      </div>

      {confirmDelete && (
        <div className="bb-confirm" role="alertdialog" aria-label={t("bots.rules.deleteLabel")}>
          <span>
            {confirmDelete.published
              ? t("bots.rules.deletePublished", { label: ruleLabel(drafts.rules.indexOf(confirmDelete)) })
              : t("bots.rules.deleteDraft", { label: ruleLabel(drafts.rules.indexOf(confirmDelete)) })}
          </span>
          <button
            type="button"
            className="dcx-btn dcx-btn-sm dcx-btn-danger"
            onClick={() => {
              const target = confirmDelete;
              setConfirmDelete(null);
              void run(() => drafts.remove(target.key));
            }}
          >
            {t("bots.ruleCard.delete")}
          </button>
          <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => setConfirmDelete(null)}>
            {t("bots.rules.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
