// Report a bug or suggest a feature.

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
  return (
    <div className="modal-overlay" onClick={() => setShowFeedback(false)}>
      <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(560px, 92vw)" }}>
        <span className="ds-kicker">Feedback</span>
        <h2>Help improve DeCave</h2>
        <p>Report a bug/issue or suggest a feature.</p>

        <label style={settingsLabelStyle}>
          Type
          <select
            value={feedbackType}
            onChange={(event) => setFeedbackType(event.target.value as "bug" | "feature")}
            style={selectStyle}
          >
            <option value="bug">Bug / Issue</option>
            <option value="feature">Feature Suggestion</option>
          </select>
        </label>

        <label style={settingsLabelStyle}>
          Details
          <textarea
            value={feedbackMessage}
            onChange={(event) => setFeedbackMessage(event.target.value)}
            rows={6}
            maxLength={4000}
            placeholder={
              feedbackType === "bug"
                ? "What happened? What were you doing when it happened?"
                : "Describe the feature and how you would use it."
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
            <strong>Let the DeCave team contact me</strong>
            <small>Your account email is never shared unless you enable this option and enter it below.</small>
          </span>
        </label>
        {feedbackShareContact && (
          <label style={settingsLabelStyle}>
            Contact email
            <input
              type="email"
              value={feedbackContact}
              onChange={(event) => setFeedbackContact(event.target.value)}
              maxLength={254}
              placeholder="Email for a reply"
            />
          </label>
        )}

        <div className="dc-feedback-attachment">
          <div>
            <strong>Optional diagnostic log</strong>
            <small>
              Attach a small .txt or .log file (up to 50 KB). Its text is included with this report only after you
              consent.
            </small>
          </div>
          <label className="modal-secondary">
            {feedbackDiagnosticName || "Choose log"}
            <input
              type="file"
              hidden
              accept=".txt,.log,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                if (file.size > 50 * 1024) {
                  setFeedbackNotice("Diagnostic logs must be 50 KB or smaller.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setFeedbackDiagnosticName(file.name);
                  setFeedbackDiagnosticText(typeof reader.result === "string" ? reader.result.slice(0, 2400) : "");
                };
                reader.onerror = () => setFeedbackNotice("Could not read that diagnostic file.");
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
              Remove
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
              <strong>Include this diagnostic text</strong>
              <small>Review the selected file yourself first; it may contain device or account details.</small>
            </span>
          </label>
        )}

        {feedbackNotice && (
          <div style={{ color: "var(--ds-text-soft)", fontSize: "11px", lineHeight: 1.5 }}>{feedbackNotice}</div>
        )}

        <div className="modal-buttons">
          <button type="button" className="modal-secondary" onClick={() => setShowFeedback(false)}>
            Close
          </button>
          <button
            type="button"
            className="modal-primary"
            disabled={feedbackBusy || !feedbackMessage.trim()}
            onClick={() => void submitFeedback()}
          >
            {feedbackBusy ? "Sending..." : "Send Feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}
