import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  REPORT_CATEGORIES,
  REPORT_URGENCIES,
  type ReportCategory,
  type ReportUrgency,
  type SafetyReportTarget,
} from "../safety/types";
import { uploadReportEvidence } from "../safety/report-evidence";
import { serverErrorOr } from "../safety/server-error";
import { Icon } from "./Icon";

type ReportDialogProps = {
  target: SafetyReportTarget | null;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSubmitted?: () => void;
};

export function ReportDialog({ target, request, onClose, onSubmitted }: ReportDialogProps) {
  const { t } = useTranslation(["safety"]);
  const [category, setCategory] = useState<ReportCategory>("HARASSMENT_BULLYING");
  const [urgency, setUrgency] = useState<ReportUrgency>("medium");
  const [description, setDescription] = useState("");
  const [blockAfter, setBlockAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const title = useMemo(() => {
    if (!target) return t("safety.report.title.content");
    if (target.targetType === "user" || target.targetType === "profile" || target.targetType === "voice_participant") {
      return target.subjectUsername
        ? t("safety.report.title.user", { name: target.subjectUsername })
        : t("safety.report.title.thisUser");
    }
    return target.evidenceLabel
      ? t("safety.report.title.item", { label: target.evidenceLabel })
      : t("safety.report.title.thisContent");
  }, [target, t]);

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
        code?: string;
      };
      if (!response.ok || !data.report?.id) {
        setNotice(serverErrorOr(data, t("safety.report.failed")));
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
      if (evidenceAttached) {
        setNotice(t("safety.report.submitted"));
        onSubmitted?.();
      } else {
        // Leave the dialog open: closing it would hide this before anyone reads it.
        setNotice(t("safety.report.submittedNoEvidence"));
      }
    } catch {
      setNotice(t("safety.report.connectFailed"));
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
        <div className="dc-safety-kicker">{t("safety.report.kicker")}</div>
        <h2 id="dc-report-title">{title}</h2>
        <p className="dc-report-copy">{t("safety.report.private")}</p>

        <label>
          {t("safety.report.category")}
          <select value={category} onChange={(event) => setCategory(event.target.value as ReportCategory)}>
            {REPORT_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {t(`safety.category.${item}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("safety.report.urgency")}
          <select value={urgency} onChange={(event) => setUrgency(event.target.value as ReportUrgency)}>
            {REPORT_URGENCIES.map((item) => (
              <option key={item} value={item}>
                {t(`safety.urgency.${item}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <Trans
            t={t}
            i18nKey="safety.report.details"
            components={{ optional: <span className="dc-report-optional" /> }}
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, 4000))}
            placeholder={t("safety.report.detailsPlaceholder")}
            rows={5}
            maxLength={4000}
          />
        </label>

        {target.evidenceText?.trim() && (
          <div className="dc-report-evidence-preview">
            <strong>{t("safety.report.evidence")}</strong>
            <p>{target.evidenceText}</p>
            <small>{t("safety.report.evidenceEncrypted")}</small>
          </div>
        )}

        {target.subjectUserId && (
          <label className="dc-report-check">
            <input type="checkbox" checked={blockAfter} onChange={(event) => setBlockAfter(event.target.checked)} />
            <span>{t("safety.report.blockAfter")}</span>
          </label>
        )}

        {notice && (
          <div className="dc-report-notice" role="status">
            {notice}
          </div>
        )}
        <div className="dc-report-actions ds-modal-actions">
          <button type="button" className="ds-btn" onClick={onClose} disabled={busy}>
            {t("safety.report.cancel")}
          </button>
          <button type="button" className="ds-btn ds-btn-primary" onClick={() => void submit()} disabled={busy}>
            <Icon name="flag" />
            {busy ? t("safety.report.submitting") : t("safety.report.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReportDialog;
