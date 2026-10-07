import { useEffect, useMemo, useState } from "react";
import { localeForLanguage, preferredTimeOptions } from "../app/locale";

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

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function actionLabel(value: string): string {
  return value === "no_action_taken" ? "No action taken" : label(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(localeForLanguage(), {
    dateStyle: "medium",
    timeStyle: "short",
    ...preferredTimeOptions(),
  }).format(date);
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
  return value || "Not captured";
}

export function TrustSafetyDashboard({
  request,
  ownerReauthToken,
  ownerReauthExpiresAt,
  onOpenPrivilegedUnlock,
}: TrustSafetyDashboardProps) {
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
      };
      if (!overviewResponse.ok || !reportsResponse.ok) {
        setNotice(reportData.error || "Could not load the Trust & Safety queue.");
        return;
      }
      setOverview(overviewData);
      setReports(Array.isArray(reportData.reports) ? reportData.reports : []);
    } catch {
      setNotice("Could not connect to DeCave.");
    } finally {
      setBusy(false);
    }
  };

  const loadCaseDetail = async (report: SafetyReport) => {
    setDetailBusy(true);
    setDetailError("");
    try {
      const response = await request(`/api/admin/trust-safety/cases/${encodeURIComponent(report.caseId)}`);
      const data = (await response.json().catch(() => ({}))) as Partial<SafetyCaseDetail> & { error?: string };
      if (!response.ok) {
        setDetailError(data.error || "Could not load the case details.");
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
      setDetailError("Could not connect to the case detail service.");
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setNotice(data.error || "Could not update status.");
        return;
      }
      setNotice("Report status updated.");
      await refreshSelected(report);
    } catch {
      setNotice("Could not update status.");
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setNotice(data.error || "Could not update urgency.");
        return;
      }
      setNotice("Urgency updated and recorded.");
      await refreshSelected(report);
    } catch {
      setNotice("Could not update urgency.");
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setNotice(data.error || "Could not add note.");
        return;
      }
      setNote("");
      setNotice("Private case note added.");
      await refreshSelected(report);
    } catch {
      setNotice("Could not add note.");
    } finally {
      setBusy(false);
    }
  };

  const takeAction = async () => {
    if (!selected) return;
    if (!actionReason.trim()) {
      setNotice("Enter a reason for the action before recording it.");
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setNotice(data.error || "Could not record action.");
        return;
      }
      setActionReason("");
      setNotice("Action recorded in the case timeline.");
      await refreshSelected(report);
    } catch {
      setNotice("Could not record action.");
    } finally {
      setBusy(false);
    }
  };

  const activeReport = caseDetail?.reports.find((report) => report.id === selected?.id) || selected;
  const evidence = activeReport
    ? (caseDetail?.evidence || []).filter((item) => !item.reportId || item.reportId === activeReport.id)
    : [];
  const reportedUserName = activeReport?.subjectUsername || activeReport?.targetUsername || "Unknown user";

  return (
    <section className="dc-safety-dashboard">
      <div className="dc-safety-dashboard-head">
        <div>
          <div className="ds-kicker">OWNER ONLY</div>
          <h2>Trust &amp; Safety</h2>
          <p>Review reports, preserve privacy, and record every decision.</p>
        </div>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => void load()} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {overview && (
        <div className="dc-safety-metrics">
          <div>
            <b>{overview.openCases}</b>
            <span>Open cases</span>
          </div>
          <div className="critical">
            <b>{overview.criticalCases}</b>
            <span>Critical</span>
          </div>
          <div>
            <b>{overview.submittedReports}</b>
            <span>New reports</span>
          </div>
          <div>
            <b>{overview.evidenceObjects}</b>
            <span>Encrypted evidence</span>
          </div>
        </div>
      )}

      <div className="dc-safety-dashboard-filter">
        <select className="ds-input" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="open">New reports</option>
          <option value="critical">Critical queue</option>
          <option value="all">All reports</option>
        </select>
      </div>

      {notice && (
        <div className="ds-notice danger" role="alert">
          {notice}
        </div>
      )}

      <div className={`dc-safety-privilege-status${privilegedAccessActive ? " active" : " locked"}`}>
        <div>
          <strong>{privilegedAccessActive ? "Privileged actions unlocked" : "Privileged actions locked"}</strong>
          <span>
            {privilegedAccessActive
              ? `Available until ${formatDate(new Date(ownerReauthExpiresAt).toISOString())}.`
              : "Verify with your current password and MFA to change status, add notes, or record an action."}
          </span>
        </div>
        {!privilegedAccessActive && (
          <button type="button" className="ds-btn ds-btn-sm" onClick={onOpenPrivilegedUnlock}>
            Open owner unlock
          </button>
        )}
      </div>

      <div className="dc-safety-dashboard-grid">
        <div className="dc-safety-report-list">
          {reports.length === 0 ? (
            <div className="dc-safety-empty ds-empty">No reports match this queue.</div>
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
                    {report.subjectUsername || report.targetUsername || label(report.targetType)} ·{" "}
                    {label(report.category)}
                  </small>
                  {report.contextLabel && <small>{report.contextLabel}</small>}
                </span>
                <span className={`dc-safety-status ${report.urgency}`}>
                  <b>{label(report.urgency)}</b>
                  <small>{label(report.status)}</small>
                </span>
              </button>
            ))
          )}
        </div>

        {activeReport && (
          <div className="dc-safety-case-card">
            <div className="dc-safety-case-head">
              <div>
                <div className="ds-kicker">CASE {activeReport.caseNumber || activeReport.caseId.slice(0, 8)}</div>
                <h3>{reportedUserName}</h3>
                <span className="dc-safety-case-subtitle">Reported {label(activeReport.targetType)}</span>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn-sm"
                onClick={() => {
                  setSelected(null);
                  setCaseDetail(null);
                }}
              >
                Close
              </button>
            </div>

            {detailError && <div className="dc-safety-detail-error ds-notice danger">{detailError}</div>}

            <div className="dc-safety-detail-grid">
              <div className="dc-safety-detail-field">
                <span>Reported user</span>
                <strong>{reportedUserName}</strong>
                <code>{publicId(activeReport.subjectUserId || activeReport.targetIdSnapshot)}</code>
              </div>
              <div className="dc-safety-detail-field">
                <span>Reported target</span>
                <strong>{label(activeReport.targetType)}</strong>
                <code>{activeReport.targetIdSnapshot || activeReport.targetId}</code>
              </div>
              <div className="dc-safety-detail-field">
                <span>Context</span>
                <strong>{activeReport.contextLabel || label(activeReport.contextType || "unknown")}</strong>
                <code>{activeReport.contextId || "Not captured"}</code>
              </div>
              <div className="dc-safety-detail-field">
                <span>Submitted</span>
                <strong>{formatDate(activeReport.submittedAt || activeReport.createdAt)}</strong>
                <small>
                  {activeReport.hubId != null ? `Hub ${activeReport.hubId}` : "No Hub reference"}
                  {activeReport.roomId != null ? ` · Room ${activeReport.roomId}` : ""}
                </small>
              </div>
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>Reporter description</strong>
                <span>{label(activeReport.category)}</span>
              </header>
              <p>{activeReport.description || "No description was provided by the reporter."}</p>
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>Reported message</strong>
                <span>{detailBusy ? "Loading…" : activeReport.reportedContent ? "Available" : "Not available"}</span>
              </header>
              {detailBusy ? (
                <p className="dc-safety-detail-muted">Loading the captured target and case history…</p>
              ) : activeReport.reportedContent ? (
                <div className="dc-safety-message-preview">
                  <div className="dc-safety-message-meta">
                    <strong>{activeReport.reportedContent.authorUsername}</strong>
                    <span>
                      {formatDate(activeReport.reportedContent.createdAt)}
                      {activeReport.reportedContent.editedAt ? " · edited" : ""}
                    </span>
                  </div>
                  <blockquote>{activeReport.reportedContent.text || "No text was captured."}</blockquote>
                  {activeReport.reportedContent.attachment && (
                    <div className="dc-safety-attachment">
                      <strong>{activeReport.reportedContent.attachment.name}</strong>
                      <span>
                        {activeReport.reportedContent.attachment.mimeType || "Attachment"} ·{" "}
                        {formatBytes(activeReport.reportedContent.attachment.size)}
                      </span>
                    </div>
                  )}
                  <small>
                    Message ID: <code>{activeReport.reportedContent.id}</code>
                  </small>
                </div>
              ) : evidence.length > 0 ? (
                <p className="dc-safety-detail-muted">
                  Encrypted evidence is attached. Plaintext is available only through approved Trust &amp; Safety key
                  custody.
                </p>
              ) : (
                <p className="dc-safety-detail-muted">
                  No message copy is stored for this report. Message content is available only when the reporter submits
                  evidence.
                </p>
              )}
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>Evidence</strong>
                <span>
                  {evidence.length} object{evidence.length === 1 ? "" : "s"}
                </span>
              </header>
              {evidence.length === 0 ? (
                <p className="dc-safety-detail-muted">No encrypted evidence was submitted with this report.</p>
              ) : (
                <div className="dc-safety-evidence-list">
                  {evidence.map((item) => (
                    <div className="dc-safety-evidence-item" key={item.id}>
                      <div>
                        <strong>{label(item.evidenceType)}</strong>
                        <span>
                          {formatBytes(item.ciphertextSize)} · {formatDate(item.createdAt)}
                        </span>
                      </div>
                      <small>
                        Key {item.keyId} · package {item.packageVersion} · encryption {item.encryptionVersion}
                      </small>
                      <code>SHA-256 {item.ciphertextSha256}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>Action history</strong>
                <span>
                  {caseDetail?.actions.length || 0} action{caseDetail?.actions.length === 1 ? "" : "s"}
                </span>
              </header>
              {!caseDetail || caseDetail.actions.length === 0 ? (
                <p className="dc-safety-detail-muted">No enforcement action recorded.</p>
              ) : (
                <div className="dc-safety-timeline">
                  {caseDetail.actions.map((item) => (
                    <div className="dc-safety-timeline-item" key={item.id}>
                      <div>
                        <strong>{actionLabel(item.actionType)}</strong>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      <p>{item.reason || "No reason recorded."}</p>
                      <small>
                        Target: {publicId(item.targetUserId)} · By{" "}
                        {item.createdByUsername || publicId(item.createdByUserId)}
                      </small>
                      {item.expiresAt && <small>Expires: {formatDate(item.expiresAt)}</small>}
                      {item.reversedAt && <small>Reversed: {formatDate(item.reversedAt)}</small>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dc-safety-detail-block">
              <header>
                <strong>Private case notes</strong>
                <span>
                  {caseDetail?.notes.length || 0} note{caseDetail?.notes.length === 1 ? "" : "s"}
                </span>
              </header>
              {!caseDetail || caseDetail.notes.length === 0 ? (
                <p className="dc-safety-detail-muted">No private notes recorded.</p>
              ) : (
                <div className="dc-safety-timeline">
                  {caseDetail.notes.map((item) => (
                    <div className="dc-safety-timeline-item" key={item.id}>
                      <div>
                        <strong>{item.authorUsername || "Owner"}</strong>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      <p>{item.note}</p>
                      {item.authorUserId && <small>Owner ID: {item.authorUserId}</small>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dc-safety-admin-controls">
              <label>
                Status
                <select className="ds-input" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {statusOptions.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
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
                Save status
              </button>

              <label>
                Urgency
                <select className="ds-input" value={urgency} onChange={(event) => setUrgency(event.target.value)}>
                  {urgencyOptions.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
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
                Save urgency
              </button>

              <label>
                Private note
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
                Add note
              </button>

              <label>
                Action
                <select className="ds-input" value={actionType} onChange={(event) => setActionType(event.target.value)}>
                  <option value="no_action_taken">No action taken</option>
                  <option value="warning">Warning</option>
                  <option value="restrict">Restrict</option>
                  <option value="suspend">Suspend</option>
                  <option value="unsuspend">Unsuspend</option>
                </select>
              </label>
              <textarea
                className="ds-input"
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value.slice(0, 1000))}
                placeholder="Reason for action"
                rows={3}
              />
              <button
                type="button"
                className="ds-btn ds-btn-primary"
                onClick={() => void takeAction()}
                disabled={busy || !privilegedAccessActive}
              >
                Record action
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default TrustSafetyDashboard;
