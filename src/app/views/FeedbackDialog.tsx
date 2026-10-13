// Report a bug or suggest a feature.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { selectStyle, settingsLabelStyle } from "../inline-styles";

type Props = {
  setShowFeedback: Dispatch<SetStateAction<boolean>>;
  feedbackType: "bug" | "feature";
  setFeedbackType: Dispatch<SetStateAction<"bug" | "feature">>;
  feedbackMessage: string;
  setFeedbackMessage: Dispatch<SetStateAction<string>>;
  feedbackContact: string;
  setFeedbackContact: Dispatch<SetStateAction<string>>;
  feedbackShareContact: boolean;
  setFeedbackShareContact: Dispatch<SetStateAction<boolean>>;
  feedbackDiagnosticsConsent: boolean;
  setFeedbackDiagnosticsConsent: Dispatch<SetStateAction<boolean>>;
  feedbackDiagnosticName: string;
  setFeedbackDiagnosticName: Dispatch<SetStateAction<string>>;
  setFeedbackDiagnosticText: Dispatch<SetStateAction<string>>;
  feedbackNotice: string;
  setFeedbackNotice: Dispatch<SetStateAction<string>>;
  feedbackBusy: boolean;
  submitFeedback: () => Promise<void>;
};

export function FeedbackDialog({
  setShowFeedback,
  feedbackType,
  setFeedbackType,
  feedbackMessage,
  setFeedbackMessage,
  feedbackContact,
  setFeedbackContact,
  feedbackShareContact,
  setFeedbackShareContact,
  feedbackDiagnosticsConsent,
  setFeedbackDiagnosticsConsent,
  feedbackDiagnosticName,
  setFeedbackDiagnosticName,
  setFeedbackDiagnosticText,
  feedbackNotice,
  setFeedbackNotice,
  feedbackBusy,
  submitFeedback,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="modal-overlay" onClick={() => setShowFeedback(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(560px, 92vw)" }}>
        <span className="ds-kicker">{t("common.feedback.kicker")}</span>
        <h2>{t("common.feedback.title")}</h2>
        <p>{t("common.feedback.lead")}</p>

        <label style={settingsLabelStyle}>
          {t("common.feedback.type")}
          <select
            value={feedbackType}
            onChange={(event) => setFeedbackType(event.target.value as "bug" | "feature")}
            style={selectStyle}
          >
            <option value="bug">{t("common.feedback.typeBug")}</option>
            <option value="feature">{t("common.feedback.typeFeature")}</option>
          </select>
        </label>

        <label style={settingsLabelStyle}>
          {t("common.feedback.details")}
          <textarea
            value={feedbackMessage}
            onChange={(event) => setFeedbackMessage(event.target.value)}
            rows={6}
            maxLength={4000}
            placeholder={
              feedbackType === "bug" ? t("common.feedback.bugPlaceholder") : t("common.feedback.featurePlaceholder")
            }
          />
        </label>

        <label className="dc-feedback-consent">
          <input
            type="checkbox"
            checked={feedbackShareContact}
            onChange={(event) => setFeedbackShareContact(event.target.checked)}
          />
          <span>
            <strong>{t("common.feedback.contactConsent")}</strong>
            <small>{t("common.feedback.contactConsentHint")}</small>
          </span>
        </label>
        {feedbackShareContact && (
          <label style={settingsLabelStyle}>
            {t("common.feedback.contactEmail")}
            <input
              type="email"
              value={feedbackContact}
              onChange={(event) => setFeedbackContact(event.target.value)}
              maxLength={254}
              placeholder={t("common.feedback.contactPlaceholder")}
            />
          </label>
        )}

        <div className="dc-feedback-attachment">
          <div>
            <strong>{t("common.feedback.logTitle")}</strong>
            <small>{t("common.feedback.logHint")}</small>
          </div>
          <label className="modal-secondary">
            {feedbackDiagnosticName || t("common.feedback.chooseLog")}
            <input
              type="file"
              hidden
              accept=".txt,.log,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                if (file.size > 50 * 1024) {
                  setFeedbackNotice(t("common.feedback.logTooLarge"));
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setFeedbackDiagnosticName(file.name);
                  setFeedbackDiagnosticText(typeof reader.result === "string" ? reader.result.slice(0, 2400) : "");
                };
                reader.onerror = () => setFeedbackNotice(t("common.feedback.logUnreadable"));
                reader.readAsText(file);
              }}
            />
          </label>
          {feedbackDiagnosticName && (
            <button
              type="button"
              className="modal-secondary"
              onClick={() => {
                setFeedbackDiagnosticName("");
                setFeedbackDiagnosticText("");
                setFeedbackDiagnosticsConsent(false);
              }}
            >
              {t("common.actions.remove")}
            </button>
          )}
        </div>
        {feedbackDiagnosticName && (
          <label className="dc-feedback-consent">
            <input
              type="checkbox"
              checked={feedbackDiagnosticsConsent}
              onChange={(event) => setFeedbackDiagnosticsConsent(event.target.checked)}
            />
            <span>
              <strong>{t("common.feedback.includeLog")}</strong>
              <small>{t("common.feedback.includeLogHint")}</small>
            </span>
          </label>
        )}

        {feedbackNotice && (
          <div style={{ color: "var(--ds-text-soft)", fontSize: "11px", lineHeight: 1.5 }}>{feedbackNotice}</div>
        )}

        <div className="modal-buttons">
          <button type="button" className="modal-secondary" onClick={() => setShowFeedback(false)}>
            {t("common.actions.close")}
          </button>
          <button
            type="button"
            className="modal-primary"
            disabled={feedbackBusy || !feedbackMessage.trim()}
            onClick={() => void submitFeedback()}
          >
            {feedbackBusy ? t("common.status.sendingDots") : t("common.feedback.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
