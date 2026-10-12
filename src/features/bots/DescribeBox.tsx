// "Describe it": a text box that asks the AI helper for rule drafts, with the daily counter.
import { useId, useState } from "react";
import { BOT_LIMITS } from "../../../shared/bots/types.ts";

type Props = {
  remaining: number;
  placeholder: string;
  compact?: boolean;
  submitLabel?: string;
  onSubmit: (description: string) => Promise<void>;
};

export function DescribeBox({ remaining, placeholder, compact, submitLabel = "Build it", onSubmit }: Props) {
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
        Describe what the bot should do
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
          {remaining} of {BOT_LIMITS.aiPerDay} left today
        </small>
        <button type="submit" className="dcx-btn dcx-btn-sm dcx-btn-primary" disabled={!text.trim() || busy || out}>
          {busy ? "Building…" : submitLabel}
        </button>
      </span>
    </form>
  );
}
