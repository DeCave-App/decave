import { useEffect, useState } from "react";
import type { SafetyReport } from "../safety/types";
import { localeForLanguage, preferredTimeOptions } from "../app/locale";

type MyReportsPanelProps = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

function statusLabel(status: SafetyReport["status"]): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

export function MyReportsPanel({ request }: MyReportsPanelProps) {
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [selected, setSelected] = useState<SafetyReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");

  const load = async () => {
    setBusy(true);
    try {
      const response = await request("/api/safety/reports");
      const data = (await response.json().catch(() => ({}))) as { reports?: SafetyReport[]; error?: string };
      if (!response.ok) {
        setNotice(data.error || "Could not load your reports.");
        return;
      }
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch {
      setNotice("Could not connect to DeCave.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="dc-safety-panel">
      <div className="dc-safety-panel-head">
        <div>
          <div className="ds-kicker">PRIVATE TO YOU</div>
          <h2>My Reports</h2>
          <p>Track reports you have submitted. Review details remain private.</p>
        </div>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => void load()} disabled={busy}>
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {notice && (
        <div className="ds-notice danger" role="alert">
          {notice}
        </div>
      )}
      {!busy && reports.length === 0 ? (
        <div className="dc-safety-empty ds-empty">You have not submitted any reports.</div>
      ) : (
        <div className="dc-safety-report-list">
          {reports.map((report) => (
            <button
              type="button"
              key={report.id}
              className={`dc-safety-report-row${selected?.id === report.id ? " selected" : ""}`}
              onClick={() => setSelected(report)}
            >
              <span>
                <strong>{report.caseNumber || report.id.slice(0, 8)}</strong>
                <small>
                  {report.targetUsername || report.targetType} ·{" "}
                  {new Date(report.createdAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}
                </small>
              </span>
              <span className={`dc-safety-status ${report.status}`}>
                <b>{statusLabel(report.status)}</b>
                <small>{report.urgency}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="dc-safety-report-detail">
          <div>
            <strong>{selected.caseNumber || "Report"}</strong>
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p>{selected.description || "No additional details were provided."}</p>
          <small>
            Status: {statusLabel(selected.status)} · submitted{" "}
            {new Date(selected.submittedAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}
          </small>
        </div>
      )}
    </section>
  );
}

export default MyReportsPanel;
