import { useId, useState } from "react";
import { useDialogA11y } from "./useDialogA11y";
import "./shared.css";

type TypeToConfirmDialogProps = {
  title: string;
  description: string;
  /** The exact text the user must type to enable the destructive action. */
  confirmText: string;
  actionLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Destructive confirmation that requires typing the resource name. */
export function TypeToConfirmDialog({
  title,
  description,
  confirmText,
  actionLabel,
  busy = false,
  onConfirm,
  onCancel,
}: TypeToConfirmDialogProps) {
  const [value, setValue] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const ref = useDialogA11y<HTMLDivElement>(busy ? null : onCancel);
  const matches = value.trim() === confirmText.trim();
  return (
    <div
      className="dcx-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={ref}
        className="dcx-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-dc-dialog="open"
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <label htmlFor={inputId} className="dcx-confirm-label">
          Type <strong>{confirmText}</strong> to confirm
        </label>
        <input
          id={inputId}
          className="dcx-input"
          value={value}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches && !busy) onConfirm();
          }}
        />
        <div className="dcx-confirm-actions">
          <button type="button" className="dcx-btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="dcx-btn dcx-btn-danger" disabled={!matches || busy} onClick={onConfirm}>
            {busy ? "Working…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
