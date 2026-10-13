// The Activity tab: the bot's run log (kept 30 days), filterable to errors.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { preferredTimeOptions } from "../../app/locale";
import { formatDateParts } from "../shared/dateParts";
import { CATALOGUE, type BotCatalogueEntry } from "../../../shared/bots/catalogue.ts";
import { entryLabel } from "./catalogueText";
import { runNoticeText } from "./runText";
import type { BotRun, BotsApi } from "./api";

type Props = { api: BotsApi; botId: string; ruleLabels: Record<string, string> };

const STATUSES: readonly string[] = ["ok", "error", "limited", "skipped"] satisfies BotRun["status"][];

function triggerName(type: string): string {
  const entry = (CATALOGUE.triggers as Record<string, BotCatalogueEntry>)[type];
  return entry ? entryLabel("triggers", type, entry) : type;
}

function when(value: string): string {
  const date = new Date(value.includes("T") || value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? value
    : formatDateParts(date, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        ...preferredTimeOptions(),
      });
}

export function ActivityTab({ api, botId, ruleLabels }: Props) {
  const { t } = useTranslation(["bots"]);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [runs, setRuns] = useState<BotRun[] | null>(null);
  const [error, setError] = useState("");

  // Only the newest request may fill the list (a slow older one must not win).
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    setError("");
    try {
      const { runs } = await api.runs(botId, errorsOnly);
      if (request === latest.current) setRuns(runs);
    } catch (caught) {
      if (request === latest.current)
        setError(caught instanceof Error ? caught.message : t("bots.activity.loadFailed"));
    }
  }, [api, botId, errorsOnly]);

  useEffect(() => {
    // Clear the old list so a filter change never shows stale rows.
    setRuns(null);
    void load();
  }, [load]);

  return (
    <div className="bb-activity">
      <div className="bb-activity-bar">
        <label className="bb-check">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          {t("bots.activity.errorsOnly")}
        </label>
        <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => void load()}>
          {t("bots.activity.refresh")}
        </button>
      </div>
      {error && <p className="dcx-notice dcx-notice-error">{error}</p>}
      {runs && runs.length === 0 && (
        <p className="bb-empty">{errorsOnly ? t("bots.activity.noErrors") : t("bots.activity.empty")}</p>
      )}
      {runs && runs.length > 0 && (
        <ul className="bb-runs" aria-label={t("bots.activity.runs")}>
          {runs.map((run) => (
            <li key={run.id} className={`bb-run ${run.status}`}>
              <span className={`bb-run-status ${run.status}`}>
                {STATUSES.includes(run.status) ? t(`bots.activity.status.${run.status}`) : run.status}
              </span>
              <span className="bb-run-copy">
                <strong>
                  {(run.rule_id && ruleLabels[run.rule_id]) || t("bots.activity.deletedRule")} ·{" "}
                  {triggerName(run.trigger)}
                </strong>
                <small>{runNoticeText(run.notice, run.detail)}</small>
              </span>
              <small className="bb-run-time">{when(run.created_at)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
