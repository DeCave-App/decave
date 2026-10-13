// Modal for a bot form opened by a card button or select (POST bot-forms/:formId).

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { formPayload, missingRequired, type BotForm } from "../../../shared/bots/card-view";
import { apiErrorText } from "../shared/apiErrorText";

type Props = {
  form: BotForm;
  roomId: number;
  baseUrl: string;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  /** Gets focus back on close (the card control; it was disabled while the bot answered). */
  returnFocus?: HTMLElement | null;
};

export function BotFormModal({ form, roomId, baseUrl, authorizedFetch, onClose, returnFocus }: Props) {
  const { t } = useTranslation(["bots"]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);

  // Focus the first field on open; give focus back to the trigger on close.
  useEffect(() => {
    const trigger = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialogRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
    return () => trigger?.focus();
  }, []);

  /** Escape closes; Tab stays inside the dialog. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("input, textarea, button:not(:disabled)"),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const setValue = (id: string, value: string) => setValues((current) => ({ ...current, [id]: value }));

  const submit = async () => {
    const missing = missingRequired(form.fields, values);
    if (missing.length) {
      setError(t("bots.card.form.required", { field: missing[0] }));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await authorizedFetch(
        `${baseUrl}/api/rooms/${roomId}/bot-forms/${encodeURIComponent(form.formId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formPayload(form.fields, values)),
        },
      );
      if (!response.ok) {
        const data: unknown = await response.json().catch(() => ({}));
        setError(apiErrorText(data, t("bots.card.form.sendFailedStatus", { status: response.status })));
        return;
      }
      onClose();
    } catch {
      setError(t("bots.card.form.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay bot-form-overlay" onClick={onClose}>
      <form
        ref={dialogRef}
        className="bot-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-form-title"
        data-dc-dialog="open"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id="bot-form-title">{form.title}</h2>
        {form.fields.map((field) => (
          <label key={field.id} className="bot-form-field">
            <span>
              {field.label}
              {field.required ? <b aria-hidden="true"> *</b> : null}
            </span>
            {field.style === "long" ? (
              <textarea
                rows={4}
                maxLength={1000}
                value={values[field.id] ?? ""}
                onChange={(event) => setValue(field.id, event.target.value)}
              />
            ) : (
              <input
                maxLength={1000}
                value={values[field.id] ?? ""}
                onChange={(event) => setValue(field.id, event.target.value)}
              />
            )}
          </label>
        ))}
        {error ? (
          <p className="bot-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="bot-form-actions">
          <button type="button" className="bot-card-button secondary" onClick={onClose}>
            {t("bots.card.form.cancel")}
          </button>
          <button type="submit" className="bot-card-button primary" disabled={busy}>
            {busy ? t("bots.card.form.sending") : t("bots.card.form.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
