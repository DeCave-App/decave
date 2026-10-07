// Sends the Feedback dialog's message (with optional diagnostics) to the server.

import type { Dispatch, SetStateAction } from "react";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";

export type FeedbackActionsDeps = {
  feedbackType: "bug" | "feature";
  feedbackMessage: string;
  setFeedbackMessage: Dispatch<SetStateAction<string>>;
  feedbackContact: string;
  feedbackShareContact: boolean;
  feedbackDiagnosticsConsent: boolean;
  setFeedbackDiagnosticsConsent: Dispatch<SetStateAction<boolean>>;
  feedbackDiagnosticName: string;
  setFeedbackDiagnosticName: Dispatch<SetStateAction<string>>;
  feedbackDiagnosticText: string;
  setFeedbackDiagnosticText: Dispatch<SetStateAction<string>>;
  setFeedbackNotice: Dispatch<SetStateAction<string>>;
  setFeedbackBusy: Dispatch<SetStateAction<boolean>>;
};

/** Called once per render with that render's values. */
export function createFeedbackActions(deps: FeedbackActionsDeps) {
  const {
    feedbackType,
    feedbackMessage,
    setFeedbackMessage,
    feedbackContact,
    feedbackShareContact,
    feedbackDiagnosticsConsent,
    setFeedbackDiagnosticsConsent,
    feedbackDiagnosticName,
    setFeedbackDiagnosticName,
    feedbackDiagnosticText,
    setFeedbackDiagnosticText,
    setFeedbackNotice,
    setFeedbackBusy,
  } = deps;

  const submitFeedback = async () => {
    const message = feedbackMessage.trim();
    if (!message) {
      setFeedbackNotice("Describe the bug or feature idea first.");
      return;
    }
    setFeedbackBusy(true);
    setFeedbackNotice("");
    try {
      const diagnosticAppendix =
        feedbackDiagnosticsConsent && feedbackDiagnosticText
          ? `\n\n--- Optional diagnostic attachment: ${feedbackDiagnosticName || "diagnostics.txt"} ---\n${feedbackDiagnosticText}`
          : "";
      const response = await authorizedFetch(`${HTTP_URL}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: feedbackType,
          message: `${message}${diagnosticAppendix}`.slice(0, 4000),
          contact: feedbackShareContact ? feedbackContact.trim() : "",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setFeedbackNotice(data.error || "Could not send feedback.");
        return;
      }
      setFeedbackMessage("");
      setFeedbackDiagnosticName("");
      setFeedbackDiagnosticText("");
      setFeedbackDiagnosticsConsent(false);
      setFeedbackNotice("Sent. Thank you for helping improve DeCave.");
    } catch {
      setFeedbackNotice("Could not send feedback.");
    } finally {
      setFeedbackBusy(false);
    }
  };

  return {
    submitFeedback,
  };
}
