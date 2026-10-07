import { useMemo, useState } from "react";
import {
  REPORT_CATEGORIES,
  REPORT_URGENCIES,
  type ReportCategory,
  type ReportUrgency,
  type SafetyReportTarget,
} from "../safety/types";
import { uploadReportEvidence } from "../safety/report-evidence";
import { Icon } from "./Icon";

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  HARASSMENT_BULLYING: "Harassment or bullying",
  HATE_SPEECH: "Hate speech",
  SEXUAL_INAPPROPRIATE: "Sexual or inappropriate content",
  SUSPECTED_GROOMING: "Suspected grooming",
  CHILD_SAFETY: "Child safety concern",
  THREATS_VIOLENCE: "Threats or violence",
  SPAM_SCAM: "Spam or scam",
  IMPERSONATION: "Impersonation",
  UNDERAGE_USER: "Underage user",
  INAPPROPRIATE_MEDIA: "Inappropriate media",
  SELF_HARM: "Self-harm concern",
  OTHER: "Other",
};

type ReportDialogProps = {
  target: SafetyReportTarget | null;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSubmitted?: () => void;
};

export function ReportDialog({ target, request, onClose, onSubmitted }: ReportDialogProps) {
  const [category, setCategory] = useState<ReportCategory>("HARASSMENT_BULLYING");
  const [urgency, setUrgency] = useState<ReportUrgency>("medium");
  const [description, setDescription] = useState("");
  const [blockAfter, setBlockAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const targetLabel = useMemo(() => {
    if (!target) return "content";
    if (target.targetType === "user" || target.targetType === "profile" || target.targetType === "voice_participant") {
      return target.subjectUsername || "this user";
    }
    return target.evidenceLabel || "this content";
  }, [target]);

  if (!target) return null;

  const submit = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await request("/api/safety/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: target.targetType,
          targetId: target.targetId,
          subjectUserId: target.subjectUserId,
          contextType: target.contextType,
          contextId: target.contextId,
          contextLabel: target.contextLabel,
          hubId: target.hubId,
          roomId: target.roomId,
          category,
          urgency,
          description: description.trim(),
          clientVersion: "web-trust-safety-v1",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        report?: { id?: string };
        error?: string;
      };
      if (!response.ok || !data.report?.id) {
        setNotice(data.error || "The report could not be submitted.");
        return;
      }

      let evidenceAttached = true;
      if (target.evidenceText?.trim()) {
        try {
          evidenceAttached = await uploadReportEvidence(request, data.report.id, target);
        } catch {
          evidenceAttached = false;
        }
      }
      const subjectId =
        target.subjectUserId ||
        (target.targetType === "user" || target.targetType === "profile" || target.targetType === "voice_participant"
          ? target.targetId
          : "");
      if (blockAfter && subjectId) {
        await request(`/api/safety/blocks/${encodeURIComponent(subjectId)}`, { method: "PUT" });
      }
      setNotice(
        evidenceAttached
          ? "Report submitted. Thank you for helping keep DeCave safe."
          : "Report submitted, but encrypted evidence could not be attached. Your report was still received.",
      );
      onSubmitted?.();
    } catch {
      setNotice("Could not connect to DeCave.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay dc-safety-overlay" onClick={onClose}>
      <div
        className="modal dc-report-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dc-report-title"
      >
        <div className="dc-safety-kicker">Trust &amp; safety</div>
        <h2 id="dc-report-title">Report {targetLabel}</h2>
        <p className="dc-report-copy">
          Your report is private. The person being reported will not be shown your identity.
        </p>

        <label>
          What happened?
          <select value={category} onChange={(event) => setCategory(event.target.value as ReportCategory)}>
            {REPORT_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {CATEGORY_LABELS[item]}
              </option>
            ))}
          </select>
        </label>

        <label>
          Urgency
          <select value={urgency} onChange={(event) => setUrgency(event.target.value as ReportUrgency)}>
            {REPORT_URGENCIES.map((item) => (
              <option key={item} value={item}>
                {item === "spam_invalid" ? "Spam or invalid" : item.charAt(0).toUpperCase() + item.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Details <span className="dc-report-optional">(optional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, 4000))}
            placeholder="Tell us what we should know"
            rows={5}
            maxLength={4000}
          />
        </label>

        {target.evidenceText?.trim() && (
          <div className="dc-report-evidence-preview">
            <strong>Selected evidence</strong>
            <p>{target.evidenceText}</p>
            <small>It will be encrypted on this device before upload.</small>
          </div>
        )}

        {target.subjectUserId && (
          <label className="dc-report-check">
            <input type="checkbox" checked={blockAfter} onChange={(event) => setBlockAfter(event.target.checked)} />
            <span>Block this user after submitting</span>
          </label>
        )}

        {notice && (
          <div className="dc-report-notice" role="status">
            {notice}
          </div>
        )}
        <div className="dc-report-actions ds-modal-actions">
          <button type="button" className="ds-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="ds-btn ds-btn-primary" onClick={() => void submit()} disabled={busy}>
            <Icon name="flag" />
            {busy ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReportDialog;
