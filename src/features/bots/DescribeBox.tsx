// "Describe it": a text box that asks the AI helper for rule drafts, with the daily counter.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { BOT_LIMITS } from "../../../shared/bots/types.ts";

type Props = {
  remaining: number;
  placeholder: string;
  compact?: boolean;
  submitLabel?: string;
  onSubmit: (description: string) => Promise<void>;
};

export function DescribeBox({ remaining, placeholder, compact, submitLabel, onSubmit }: Props) {
  const { t } = useTranslation(["bots"]);
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const out = remaining <= 0;
  return (
    <form
      className={`bb-describe${compact ? " compact" : ""}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy || out) return;
        setBusy(true);
        try {
          await onSubmit(text.trim());
          setText("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id} className="dcx-sr-only">
        {t("bots.describe.label")}
      </label>
      <textarea
        id={id}
        className="dcx-input"
        rows={compact ? 2 : 4}
        maxLength={1000}
        placeholder={placeholder}
        value={text}
        disabled={out}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="bb-describe-foot">
        <small className="bb-hint" aria-live="polite">
          {t("bots.describe.remaining", { remaining, total: BOT_LIMITS.aiPerDay })}
        </small>
        <button type="submit" className="dcx-btn dcx-btn-sm dcx-btn-primary" disabled={!text.trim() || busy || out}>
          {busy ? t("bots.describe.building") : (submitLabel ?? t("bots.describe.submit"))}
        </button>
      </span>
    </form>
  );
}
