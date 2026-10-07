// Asks whether to keep or discard Settings changes when closing Settings with unsaved edits.

import type { Dispatch, SetStateAction } from "react";

type Props = {
  settingsSaving: boolean;
  setSettingsCloseConfirm: Dispatch<SetStateAction<boolean>>;
  discardSettingsChanges: () => Promise<void>;
  keepSettingsChangesAndClose: () => Promise<void>;
};

export function SettingsCloseConfirmDialog({
  settingsSaving,
  setSettingsCloseConfirm,
  discardSettingsChanges,
  keepSettingsChangesAndClose,
}: Props) {
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setSettingsCloseConfirm(false);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 13000,
        display: "grid",
        placeItems: "center",
        padding: "20px",
        background: "var(--ds-surface-2)",
        backdropFilter: "blur(12px)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="decave-unsaved-settings-title"
        style={{
          width: "min(470px, calc(100vw - 32px))",
          overflow: "hidden",
          border: "1px solid color-mix(in srgb, var(--ds-warn) 28%, transparent)",
          borderRadius: "18px",
          background: "linear-gradient(180deg, rgba(17, 23, 40, .995), rgba(8, 13, 26, .995))",
          boxShadow: "0 28px 90px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.025) inset",
        }}
      >
        <div
          style={{ padding: "22px", borderBottom: "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)" }}
        >
          <div
            style={{
              color: "var(--ds-warn)",
              fontSize: "10px",
              fontWeight: 900,
              letterSpacing: ".14em",
              marginBottom: "9px",
            }}
          >
            UNSAVED CHANGES
          </div>
          <h2 id="decave-unsaved-settings-title" style={{ margin: 0, fontSize: "20px" }}>
            Keep your Settings changes?
          </h2>
          <p style={{ margin: "9px 0 0", color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.55 }}>
            You changed one or more settings. Save them before closing, or discard them and restore the values you had
            when Settings opened.
          </p>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "16px 18px 18px" }}>
          <button
            type="button"
            className="modal-secondary"
            disabled={settingsSaving}
            onClick={() => setSettingsCloseConfirm(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            disabled={settingsSaving}
            onClick={() => void discardSettingsChanges()}
            style={{ borderColor: "color-mix(in srgb, var(--ds-danger) 28%, transparent)", color: "var(--ds-danger)" }}
          >
            Discard Changes
          </button>
          <button
            type="button"
            className="modal-primary"
            disabled={settingsSaving}
            onClick={() => void keepSettingsChangesAndClose()}
          >
            {settingsSaving ? "Saving..." : "Keep Changes"}
          </button>
        </div>
      </section>
    </div>
  );
}
