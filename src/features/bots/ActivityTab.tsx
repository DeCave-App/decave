// The Activity tab: the bot's run log (kept 30 days), filterable to errors.
import { useCallback, useEffect, useRef, useState } from "react";
import { localeForLanguage, preferredTimeOptions } from "../../app/locale";
import { CATALOGUE } from "../../../shared/bots/catalogue.ts";
import type { BotRun, BotsApi } from "./api";

type Props = { api: BotsApi; botId: string; ruleLabels: Record<string, string> };

const STATUS_LABEL: Record<BotRun["status"], string> = {
  ok: "Ran",
  error: "Error",
  limited: "Rate limited",
  skipped: "Skipped",
};

function when(value: string): string {
  const date = new Date(value.includes("T") || value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(localeForLanguage(), preferredTimeOptions());
}

export function ActivityTab({ api, botId, ruleLabels }: Props) {
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
      if (request === latest.current) setError(caught instanceof Error ? caught.message : "Could not load activity.");
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
          Errors only
        </label>
        <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p className="dcx-notice dcx-notice-error">{error}</p>}
      {runs && runs.length === 0 && (
        <p className="bb-empty">{errorsOnly ? "No errors in the last 30 days." : "Nothing has run yet."}</p>
      )}
      {runs && runs.length > 0 && (
        <ul className="bb-runs" aria-label="Runs">
          {runs.map((run) => (
            <li key={run.id} className={`bb-run ${run.status}`}>
              <span className={`bb-run-status ${run.status}`}>{STATUS_LABEL[run.status] ?? run.status}</span>
              <span className="bb-run-copy">
                <strong>
                  {(run.rule_id && ruleLabels[run.rule_id]) || "Deleted rule"} ·{" "}
                  {(CATALOGUE.triggers as Record<string, { label: string }>)[run.trigger]?.label ?? run.trigger}
                </strong>
                <small>{run.detail}</small>
              </span>
              <small className="bb-run-time">{when(run.created_at)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
