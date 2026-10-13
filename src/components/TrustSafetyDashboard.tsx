import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { i18next } from "../i18n";
import { formatDate as formatDateStyle } from "../i18n/format";
import { serverErrorOr } from "../safety/server-error";

// t() for the helpers below that run outside the component.
const adminT = i18next.getFixedT(null, ["admin"]);

type TrustSafetyDashboardProps = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  ownerReauthToken: string;
  ownerReauthExpiresAt: number;
  onOpenPrivilegedUnlock: () => void;
};

type SafetyReportedContent = {
  kind: "channel_message";
  id: string;
  text: string;
  authorUserId: string | null;
  authorUsername: string;
  createdAt: string;
  editedAt: string | null;
  attachment: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
  } | null;
};

type SafetyReport = {
  id: string;
  caseId: string;
  caseNumber: string | null;
  targetType: string;
  targetId: string;
  targetIdSnapshot: string | null;
  targetUsername: string | null;
  subjectUserId: string | null;
  subjectUsername: string | null;
  contextType: string | null;
  contextId: string | null;
  contextLabel: string | null;
  hubId: number | null;
  roomId: number | null;
  category: string;
  description: string;
  urgencyRecommended: string;
  urgency: string;
  urgencySource: string;
  status: string;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  reportedContent?: SafetyReportedContent | null;
};

type SafetyEvidence = {
  id: string;
  reportId: string | null;
  evidenceType: string;
  sourceMessageId: string | null;
  sourceContextType: string | null;
  sourceContextId: string | null;
  ciphertextSha256: string;
  ciphertextSize: number;
  packageVersion: string;
  encryptionVersion: string;
  keyId: string;
  createdAt: string;
};

type SafetyNote = {
  id: string;
  note: string;
  createdAt: string;
  authorUserId: string | null;
  authorUsername: string | null;
};

type SafetyAction = {
  id: string;
  caseId: string;
  reportId: string | null;
  targetUserId: string | null;
  actionType: string;
  reasonCode: string;
  reason: string;
  durationHours: number | null;
  startsAt: string;
  expiresAt: string | null;
  reversedAt: string | null;
  createdByUserId: string | null;
  createdByUsername: string | null;
  createdAt: string;
};

type SafetyLink = {
  caseId: string;
  linkedCaseId: string;
  relation: string;
  createdAt: string;
  createdByUserId: string | null;
};

type SafetyCaseDetail = {
  reports: SafetyReport[];
  notes: SafetyNote[];
  actions: SafetyAction[];
  links: SafetyLink[];
  evidence: SafetyEvidence[];
};

type SafetyOverview = {
  openCases: number;
  criticalCases: number;
  submittedReports: number;
  evidenceObjects: number;
};

const statusOptions = [
  "submitted",
  "under_review",
  "awaiting_information",
  "action_taken",
  "no_violation",
  "escalated",
  "appealed",
  "closed",
];
const urgencyOptions = ["critical", "high", "medium", "low", "spam_invalid"];
const actionOptions = ["no_action_taken", "warning", "restrict", "suspend", "unsuspend"] as const;

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

type EnumGroup = "status" | "urgency" | "target" | "category" | "context" | "action";

/** A server value (status, urgency, target type...) by name; values the catalog doesn't list keep their spelled-out name. */
function enumLabel(group: EnumGroup, value: string): string {
  const key = `admin.trustSafety.enum.${group}.${value}`;
  return i18next.exists(key) ? (i18next.t as unknown as (key: string) => string)(key) : label(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return adminT("admin.trustSafety.notRecorded");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDateStyle(date, "dateTime");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, Math.round(value || 0))} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${unit}`;
}

function publicId(value: string | null | undefined): string {
  return value || adminT("admin.trustSafety.notCaptured");
}

export function TrustSafetyDashboard({
  request,
  ownerReauthToken,
  ownerReauthExpiresAt,
  onOpenPrivilegedUnlock,
}: TrustSafetyDashboardProps) {
  const { t } = useTranslation(["admin"]);
  const [overview, setOverview] = useState<SafetyOverview | null>(null);
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [selected, setSelected] = useState<SafetyReport | null>(null);
  const [caseDetail, setCaseDetail] = useState<SafetyCaseDetail | null>(null);
  const [filter, setFilter] = useState("open");
  const [status, setStatus] = useState("under_review");
  const [urgency, setUrgency] = useState("medium");
  const [actionType, setActionType] = useState("warning");
  const [actionReason, setActionReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [detailError, setDetailError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const privilegedAccessActive = Boolean(ownerReauthToken && ownerReauthExpiresAt > now);

  const headers = useMemo<Record<string, string>>(() => {
    const value: Record<string, string> = {};
    if (ownerReauthToken) value["X-DeCave-Owner-Reauth"] = ownerReauthToken;
    return value;
  }, [ownerReauthToken]);

  const load = async () => {
    setBusy(true);
    setNotice("");
    try {
      const query =
        filter === "critical"
          ? "/api/admin/trust-safety/critical"
          : filter === "open"
            ? "/api/admin/trust-safety/reports?status=submitted"
            : "/api/admin/trust-safety/reports";
      const [overviewResponse, reportsResponse] = await Promise.all([
        request("/api/admin/trust-safety/overview"),
        request(query),
      ]);
      const overviewData = (await overviewResponse.json().catch(() => ({}))) as SafetyOverview;
      const reportData = (await reportsResponse.json().catch(() => ({}))) as {
        reports?: SafetyReport[];
        error?: string;
        code?: string;
      };
      if (!overviewResponse.ok || !reportsResponse.ok) {
        setNotice(serverErrorOr(reportData, t("admin.trustSafety.loadFailed")));
        return;
      }
      setOverview(overviewData);
      setReports(Array.isArray(reportData.reports) ? reportData.reports : []);
    } catch {
      setNotice(t("admin.trustSafety.connectFailed"));
    } finally {
      setBusy(false);
    }
  };

  const loadCaseDetail = async (report: SafetyReport) => {
    setDetailBusy(true);
    setDetailError("");
    try {
      const response = await request(`/api/admin/trust-safety/cases/${encodeURIComponent(report.caseId)}`);
      const data = (await response.json().catch(() => ({}))) as Partial<SafetyCaseDetail> & {
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setDetailError(serverErrorOr(data, t("admin.trustSafety.detailFailed")));
        return;
      }
      const detail: SafetyCaseDetail = {
        reports: Array.isArray(data.reports) ? data.reports : [],
        notes: Array.isArray(data.notes) ? data.notes : [],
        actions: Array.isArray(data.actions) ? data.actions : [],
        links: Array.isArray(data.links) ? data.links : [],
        evidence: Array.isArray(data.evidence) ? data.evidence : [],
      };
      setCaseDetail(detail);
      const detailedReport = detail.reports.find((item) => item.id === report.id) || detail.reports[0];
      if (detailedReport) {
        setSelected(detailedReport);
        setStatus(detailedReport.status);
        setUrgency(detailedReport.urgency);
      }
    } catch {
      setDetailError(t("admin.trustSafety.detailConnectFailed"));
    } finally {
      setDetailBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filter]);

  const selectReport = (report: SafetyReport) => {
    setSelected(report);
    setCaseDetail(null);
    setStatus(report.status);
    setUrgency(report.urgency);
    void loadCaseDetail(report);
  };

  const refreshSelected = async (report: SafetyReport) => {
    await load();
    await loadCaseDetail(report);
  };

  const updateStatus = async () => {
    if (!selected) return;
    const report = selected;
    setBusy(true);
    try {
      const response = await request(`/api/admin/trust-safety/reports/${encodeURIComponent(report.id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ status }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!response.ok) {
        setNotice(serverErrorOr(data, t("admin.trustSafety.statusFailed")));
        return;
      }
      setNotice(t("admin.trustSafety.statusSaved"));
      await refreshSelected(report);
    } catch {
      setNotice(t("admin.trustSafety.statusFailed"));
    } finally {
      setBusy(false);
    }
  };

  const updateUrgency = async () => {
    if (!selected) return;
    const report = selected;
    setBusy(true);
    try {
      const response = await request(`/api/admin/trust-safety/reports/${encodeURIComponent(report.id)}/urgency`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ urgency }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!response.ok) {
        setNotice(serverErrorOr(data, t("admin.trustSafety.urgencyFailed")));
        return;
      }
      setNotice(t("admin.trustSafety.urgencySaved"));
      await refreshSelected(report);
    } catch {
      setNotice(t("admin.trustSafety.urgencyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!selected || !note.trim()) return;
    const report = selected;
    setBusy(true);
    try {
      const response = await request(`/api/admin/trust-safety/cases/${encodeURIComponent(report.caseId)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ note }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!response.ok) {
        setNotice(serverErrorOr(data, t("admin.trustSafety.noteFailed")));
        return;
      }
      setNote("");
      setNotice(t("admin.trustSafety.noteSaved"));
      await refreshSelected(report);
    } catch {
      setNotice(t("admin.trustSafety.noteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const takeAction = async () => {
    if (!selected) return;
    if (!actionReason.trim()) {
      setNotice(t("admin.trustSafety.reasonRequired"));
      return;
    }
    const report = selected;
    setBusy(true);
    try {
      const response = await request(`/api/admin/trust-safety/cases/${encodeURIComponent(report.caseId)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          actionType,
          reason: actionReason,
          targetUserId: report.subjectUserId || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!response.ok) {
        setNotice(serverErrorOr(data, t("admin.trustSafety.actionFailed")));
        return;
      }
      setActionReason("");
      setNotice(t("admin.trustSafety.actionSaved"));
      await refreshSelected(report);
    } catch {
      setNotice(t("admin.trustSafety.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const activeReport = caseDetail?.reports.find((report) => report.id === selected?.id) || selected;
  const evidence = activeReport
    ? (caseDetail?.evidence || []).filter((item) => !item.reportId || item.reportId === activeReport.id)
    : [];
  const reportedUserName =
    activeReport?.subjectUsername || activeReport?.targetUsername || t("admin.trustSafety.unknownUser");

  return (
    <section className="dc-safety-dashboard">
      <div className="dc-safety-dashboard-head">
        <div>
          <div className="ds-kicker">{t("admin.trustSafety.kicker")}</div>
          <h2>{t("admin.trustSafety.title")}</h2>
          <p>{t("admin.trustSafety.intro")}</p>
        </div>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => void load()} disabled={busy}>
          {busy ? t("admin.trustSafety.refreshing") : t("admin.trustSafety.refresh")}
        </button>
      </div>

      {overview && (
        <div className="dc-safety-metrics">
          <div>
            <b>{overview.openCases}</b>
            <span>{t("admin.trustSafety.metrics.openCases")}</span>
          </div>
          <div className="critical">
            <b>{overview.criticalCases}</b>
            <span>{t("admin.trustSafety.metrics.critical")}</span>
          </div>
          <div>
            <b>{overview.submittedReports}</b>
            <span>{t("admin.trustSafety.metrics.newReports")}</span>
          </div>
          <div>
            <b>{overview.evidenceObjects}</b>
            <span>{t("admin.trustSafety.metrics.evidence")}</span>
          </div>
        </div>
      )}

      <div className="dc-safety-dashboard-filter">
        <select className="ds-input" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="open">{t("admin.trustSafety.filter.open")}</option>
          <option value="critical">{t("admin.trustSafety.filter.critical")}</option>
          <option value="all">{t("admin.trustSafety.filter.all")}</option>
        </select>
      </div>

      {notice && (
        <div className="ds-notice danger" role="alert">
          {notice}
        </div>
      )}

      <div className={`dc-safety-privilege-status${privilegedAccessActive ? " active" : " locked"}`}>
        <div>
          <strong>
            {privilegedAccessActive
              ? t("admin.trustSafety.privilege.unlocked")
              : t("admin.trustSafety.privilege.locked")}
          </strong>
          <span>
            {privilegedAccessActive
              ? t("admin.trustSafety.privilege.until", {
                  date: formatDate(new Date(ownerReauthExpiresAt).toISOString()),
                })
              : t("admin.trustSafety.privilege.howToUnlock")}
          </span>
        </div>
        {!privilegedAccessActive && (
          <button type="button" className="ds-btn ds-btn-sm" onClick={onOpenPrivilegedUnlock}>
            {t("admin.trustSafety.privilege.open")}
          </button>
        )}
      </div>

      <div className="dc-safety-dashboard-grid">
        <div className="dc-safety-report-list">
          {reports.length === 0 ? (
            <div className="dc-safety-empty ds-empty">{t("admin.trustSafety.queueEmpty")}</div>
          ) : (
            reports.map((report) => (
              <button
                type="button"
                key={report.id}
                className={`dc-safety-report-row${selected?.id === report.id ? " selected" : ""}`}
                onClick={() => selectReport(report)}
              >
                <span>
                  <strong>{report.caseNumber || report.id.slice(0, 8)}</strong>
                  <small>
                    {t("admin.trustSafety.rowMeta", {
                      subject:
                        report.subjectUsername || report.targetUsername || enumLabel("target", report.targetType),
                      category: enumLabel("category", report.category),
                    })}
                  </small>
                  {report.contextLabel && <small>{report.contextLabel}</small>}
                </span>
                <span className={`dc-safety-status ${report.urgency}`}>
                  <b>{enumLabel("urgency", report.urgency)}</b>
                  <small>{enumLabel("status", report.status)}</small>
                </span>
              </button>
            ))
          )}
        </div>

        {activeReport && (
          <div className="dc-safety-case-card">
            <div className="dc-safety-case-head">
              <div>
                <div className="ds-kicker">
                  {t("admin.trustSafety.caseKicker", {
                    id: activeReport.caseNumber || activeReport.caseId.slice(0, 8),
                  })}
                </div>
                <h3>{reportedUserName}</h3>
                <span className="dc-safety-case-subtitle">
                  {t("admin.trustSafety.reportedTarget", { target: enumLabel("target", activeReport.targetType) })}
                </span>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn-sm"
                onClick={() => {
                  setSelected(null);
                  setCaseDetail(null);
                }}
              >
                {t("admin.trustSafety.close")}
              </button>
            </div>

            {detailError && <div className="dc-safety-detail-error ds-notice danger">{detailError}</div>}

            <div className="dc-safety-detail-grid">
              <div className="dc-safety-detail-field">
                <span>{t("admin.trustSafety.field.reportedUser")}</span>
                <strong>{reportedUserName}</strong>
                <code>{publicId(activeReport.subjectUserId || activeReport.targetIdSnapshot)}</code>
              </div>
              <div className="dc-safety-detail-field">
                <span>{t("admin.trustSafety.field.reportedTarget")}</span>
                <strong>{enumLabel("target", activeReport.targetType)}</strong>
                <code>{activeReport.targetIdSnapshot || activeReport.targetId}</code>
              </div>
              <div className="dc-safety-detail-field">
                <span>{t("admin.trustSafety.field.context")}</span>
                <strong>
                  {activeReport.contextLabel || enumLabel("context", activeReport.contextType || "unknown")}
                </strong>
                <code>{activeReport.contextId || t("admin.trustSafety.notCaptured")}</code>
              </div>
              <div className="dc-safety-detail-field">
                <span>{t("admin.trustSafety.field.submitted")}</span>
                <strong>{formatDate(activeReport.submittedAt || activeReport.createdAt)}</strong>
                <small>
                  {activeReport.hubId != null
                    ? activeReport.roomId != null
                      ? t("admin.trustSafety.field.hubRoom", { hub: activeReport.hubId, room: activeReport.roomId })
                      : t("admin.trustSafety.field.hub", { hub: activeReport.hubId })
                    : activeReport.roomId != null
                      ? t("admin.trustSafety.field.noHubRoom", { room: activeReport.roomId })
                      : t("admin.trustSafety.field.noHub")}
                </small>
              </div>
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>{t("admin.trustSafety.description.title")}</strong>
                <span>{enumLabel("category", activeReport.category)}</span>
              </header>
              <p>{activeReport.description || t("admin.trustSafety.description.empty")}</p>
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>{t("admin.trustSafety.message.title")}</strong>
                <span>
                  {detailBusy
                    ? t("admin.trustSafety.message.loading")
                    : activeReport.reportedContent
                      ? t("admin.trustSafety.message.available")
                      : t("admin.trustSafety.message.notAvailable")}
                </span>
              </header>
              {detailBusy ? (
                <p className="dc-safety-detail-muted">{t("admin.trustSafety.message.loadingHistory")}</p>
              ) : activeReport.reportedContent ? (
                <div className="dc-safety-message-preview">
                  <div className="dc-safety-message-meta">
                    <strong>{activeReport.reportedContent.authorUsername}</strong>
                    <span>
                      {activeReport.reportedContent.editedAt
                        ? t("admin.trustSafety.message.editedAt", {
                            date: formatDate(activeReport.reportedContent.createdAt),
                          })
                        : formatDate(activeReport.reportedContent.createdAt)}
                    </span>
                  </div>
                  <blockquote>{activeReport.reportedContent.text || t("admin.trustSafety.message.noText")}</blockquote>
                  {activeReport.reportedContent.attachment && (
                    <div className="dc-safety-attachment">
                      <strong>{activeReport.reportedContent.attachment.name}</strong>
                      <span>
                        {t("admin.trustSafety.message.attachmentMeta", {
                          type:
                            activeReport.reportedContent.attachment.mimeType ||
                            t("admin.trustSafety.message.attachment"),
                          size: formatBytes(activeReport.reportedContent.attachment.size),
                        })}
                      </span>
                    </div>
                  )}
                  <small>
                    <Trans
                      t={t}
                      i18nKey="admin.trustSafety.message.id"
                      values={{ id: activeReport.reportedContent.id }}
                      components={{ code: <code /> }}
                    />
                  </small>
                </div>
              ) : evidence.length > 0 ? (
                <p className="dc-safety-detail-muted">{t("admin.trustSafety.message.encryptedOnly")}</p>
              ) : (
                <p className="dc-safety-detail-muted">{t("admin.trustSafety.message.noCopy")}</p>
              )}
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>{t("admin.trustSafety.evidence.title")}</strong>
                <span>{t("admin.trustSafety.evidence.count", { count: evidence.length })}</span>
              </header>
              {evidence.length === 0 ? (
                <p className="dc-safety-detail-muted">{t("admin.trustSafety.evidence.empty")}</p>
              ) : (
                <div className="dc-safety-evidence-list">
                  {evidence.map((item) => (
                    <div className="dc-safety-evidence-item" key={item.id}>
                      <div>
                        <strong>{enumLabel("target", item.evidenceType)}</strong>
                        <span>
                          {t("admin.trustSafety.evidence.meta", {
                            size: formatBytes(item.ciphertextSize),
                            date: formatDate(item.createdAt),
                          })}
                        </span>
                      </div>
                      <small>
                        {t("admin.trustSafety.evidence.versions", {
                          keyId: item.keyId,
                          packageVersion: item.packageVersion,
                          encryptionVersion: item.encryptionVersion,
                        })}
                      </small>
                      <code>{t("admin.trustSafety.evidence.hash", { hash: item.ciphertextSha256 })}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>{t("admin.trustSafety.actions.title")}</strong>
                <span>{t("admin.trustSafety.actions.count", { count: caseDetail?.actions.length || 0 })}</span>
              </header>
              {!caseDetail || caseDetail.actions.length === 0 ? (
                <p className="dc-safety-detail-muted">{t("admin.trustSafety.actions.empty")}</p>
              ) : (
                <div className="dc-safety-timeline">
                  {caseDetail.actions.map((item) => (
                    <div className="dc-safety-timeline-item" key={item.id}>
                      <div>
                        <strong>{enumLabel("action", item.actionType)}</strong>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      <p>{item.reason || t("admin.trustSafety.actions.noReason")}</p>
                      <small>
                        {t("admin.trustSafety.actions.byline", {
                          target: publicId(item.targetUserId),
                          by: item.createdByUsername || publicId(item.createdByUserId),
                        })}
                      </small>
                      {item.expiresAt && (
                        <small>{t("admin.trustSafety.actions.expires", { date: formatDate(item.expiresAt) })}</small>
                      )}
                      {item.reversedAt && (
                        <small>{t("admin.trustSafety.actions.reversed", { date: formatDate(item.reversedAt) })}</small>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>{t("admin.trustSafety.notes.title")}</strong>
                <span>{t("admin.trustSafety.notes.count", { count: caseDetail?.notes.length || 0 })}</span>
              </header>
              {!caseDetail || caseDetail.notes.length === 0 ? (
                <p className="dc-safety-detail-muted">{t("admin.trustSafety.notes.empty")}</p>
              ) : (
                <div className="dc-safety-timeline">
                  {caseDetail.notes.map((item) => (
                    <div className="dc-safety-timeline-item" key={item.id}>
                      <div>
                        <strong>{item.authorUsername || t("admin.trustSafety.notes.owner")}</strong>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      <p>{item.note}</p>
                      {item.authorUserId && (
                        <small>{t("admin.trustSafety.notes.ownerId", { id: item.authorUserId })}</small>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dc-safety-admin-controls">
              <label>
                {t("admin.trustSafety.controls.status")}
                <select className="ds-input" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {statusOptions.map((value) => (
                    <option key={value} value={value}>
                      {enumLabel("status", value)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ds-btn ds-btn-sm"
                onClick={() => void updateStatus()}
                disabled={busy || !privilegedAccessActive}
              >
                {t("admin.trustSafety.controls.saveStatus")}
              </button>

              <label>
                {t("admin.trustSafety.controls.urgency")}
                <select className="ds-input" value={urgency} onChange={(event) => setUrgency(event.target.value)}>
                  {urgencyOptions.map((value) => (
                    <option key={value} value={value}>
                      {enumLabel("urgency", value)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ds-btn ds-btn-sm"
                onClick={() => void updateUrgency()}
                disabled={busy || !privilegedAccessActive}
              >
                {t("admin.trustSafety.controls.saveUrgency")}
              </button>

              <label>
                {t("admin.trustSafety.controls.note")}
                <textarea
                  className="ds-input"
                  value={note}
                  onChange={(event) => setNote(event.target.value.slice(0, 4000))}
                  rows={3}
                />
              </label>
              <button
                type="button"
                className="ds-btn ds-btn-sm"
                onClick={() => void addNote()}
                disabled={busy || !privilegedAccessActive || !note.trim()}
              >
                {t("admin.trustSafety.controls.addNote")}
              </button>

              <label>
                {t("admin.trustSafety.controls.action")}
                <select className="ds-input" value={actionType} onChange={(event) => setActionType(event.target.value)}>
                  {actionOptions.map((value) => (
                    <option key={value} value={value}>
                      {t(`admin.trustSafety.enum.action.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                className="ds-input"
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value.slice(0, 1000))}
                placeholder={t("admin.trustSafety.controls.reasonPlaceholder")}
                rows={3}
              />
              <button
                type="button"
                className="ds-btn ds-btn-primary"
                onClick={() => void takeAction()}
                disabled={busy || !privilegedAccessActive}
              >
                {t("admin.trustSafety.controls.recordAction")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default TrustSafetyDashboard;
