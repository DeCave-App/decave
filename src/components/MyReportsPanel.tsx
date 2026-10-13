import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SafetyReport } from "../safety/types";
import { serverErrorOr } from "../safety/server-error";
import { formatDate } from "../i18n/format";

type MyReportsPanelProps = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

export function MyReportsPanel({ request }: MyReportsPanelProps) {
  const { t } = useTranslation(["safety"]);
  const statusLabel = (status: SafetyReport["status"]) => t(`safety.myReports.status.${status}`);
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [selected, setSelected] = useState<SafetyReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");

  const load = async () => {
    setBusy(true);
    try {
      const response = await request("/api/safety/reports");
      const data = (await response.json().catch(() => ({}))) as {
        reports?: SafetyReport[];
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setNotice(serverErrorOr(data, t("safety.myReports.loadFailed")));
        return;
      }
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch {
      setNotice(t("safety.myReports.connectFailed"));
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
          <div className="ds-kicker">{t("safety.myReports.kicker")}</div>
          <h2>{t("safety.myReports.title")}</h2>
          <p>{t("safety.myReports.intro")}</p>
        </div>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => void load()} disabled={busy}>
          {busy ? t("safety.myReports.loading") : t("safety.myReports.refresh")}
        </button>
      </div>
      {notice && (
        <div className="ds-notice danger" role="alert">
          {notice}
        </div>
      )}
      {!busy && reports.length === 0 ? (
        <div className="dc-safety-empty ds-empty">{t("safety.myReports.empty")}</div>
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
                  {t("safety.myReports.rowMeta", {
                    target: report.targetUsername || t(`safety.myReports.target.${report.targetType}`),
                    date: formatDate(report.createdAt, "dateTime"),
                  })}
                </small>
              </span>
              <span className={`dc-safety-status ${report.status}`}>
                <b>{statusLabel(report.status)}</b>
                <small>{t(`safety.myReports.urgency.${report.urgency}`)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="dc-safety-report-detail">
          <div>
            <strong>{selected.caseNumber || t("safety.myReports.report")}</strong>
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => setSelected(null)}>
              {t("safety.myReports.close")}
            </button>
          </div>
          <p>{selected.description || t("safety.myReports.noDetails")}</p>
          <small>
            {t("safety.myReports.statusLine", {
              status: statusLabel(selected.status),
              date: formatDate(selected.submittedAt, "dateTime"),
            })}
          </small>
        </div>
      )}
    </section>
  );
}

export default MyReportsPanel;
