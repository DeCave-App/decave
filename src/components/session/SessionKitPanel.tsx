import { useState } from "react";
import {
  prepareSessionKitLaunch,
  type SessionKit,
  type SessionKitIntent,
  type SessionKitLaunchPlan,
  type SessionKitReferenceCatalog,
} from "../../../shared/session-kit.ts";
import "./session.css";

export type SessionKitPanelProps = {
  kits: readonly SessionKit[];
  references: SessionKitReferenceCatalog;
  onLaunch: (plan: SessionKitLaunchPlan) => void;
  onDelete?: (kit: SessionKit) => { ok: boolean; error?: string } | void;
  onSaveCurrent?: (name: string, intent: SessionKitIntent) => { ok: boolean; error?: string } | void;
  storageError?: string | null;
};

/**
 * Local kit picker. The first action reviews the resolved references; only the
 * explicit confirmation calls onLaunch, and that callback receives no media
 * activation instruction beyond the required user actions.
 */
export function SessionKitPanel({
  kits,
  references,
  onLaunch,
  onDelete,
  onSaveCurrent,
  storageError,
}: SessionKitPanelProps) {
  const [pending, setPending] = useState<SessionKitLaunchPlan | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftIntent, setDraftIntent] = useState<SessionKitIntent>("play");
  const [error, setError] = useState("");
  const saveCurrent = () => {
    const name = draftName.trim().slice(0, 64);
    if (!name || !onSaveCurrent) return;
    try {
      const result = onSaveCurrent(name, draftIntent);
      if (result && !result.ok) {
        setError(result.error ?? "The Session Kit could not be saved on this device.");
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Session Kit could not be saved on this device.");
      return;
    }
    setError("");
    setDraftName("");
    setSaveOpen(false);
  };
  return (
    <section className="dc-session-panel" aria-labelledby="session-kits-title">
      <div className="dc-session-panel-head">
        <div>
          <span className="dc-session-kicker">LOCAL SESSION KITS</span>
          <h2 id="session-kits-title">Start with your context</h2>
        </div>
        <div className="dc-session-actions">
          <span className="dc-session-note">{kits.length} saved on this device</span>
          {onSaveCurrent && (
            <button type="button" onClick={() => setSaveOpen((value) => !value)}>
              {saveOpen ? "Cancel" : "Save current"}
            </button>
          )}
        </div>
      </div>
      {saveOpen && onSaveCurrent && (
        <div className="dc-session-form" style={{ marginTop: 14 }}>
          <div className="dc-session-form-grid">
            <label>
              Kit name
              <input
                value={draftName}
                maxLength={64}
                autoFocus
                placeholder="Friday night co-op"
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
            <label>
              Intent
              <select value={draftIntent} onChange={(event) => setDraftIntent(event.target.value as SessionKitIntent)}>
                <option value="play">Play</option>
                <option value="watch">Watch</option>
                <option value="chat">Chat</option>
                <option value="plan">Plan</option>
              </select>
            </label>
          </div>
          <p className="dc-session-note">
            Saves this Hub, room, voice device choices, notification preset, and game context on this device. Microphone
            and camera stay off until you choose them.
          </p>
          <div className="dc-session-actions">
            <button type="button" className="dc-session-primary" disabled={!draftName.trim()} onClick={saveCurrent}>
              Save kit
            </button>
          </div>
        </div>
      )}
      {(error || storageError) && (
        <p className="dc-session-note" role="alert">
          {error || storageError}
        </p>
      )}
      {kits.length === 0 ? (
        <p>No kits saved yet. Save your current Hub, room, and voice preferences to create one.</p>
      ) : (
        <div className="dc-session-panel-list">
          {kits.map((kit) => (
            <article className="dc-session-card" key={kit.id}>
              <div className="dc-session-card-head">
                <div>
                  <span className="dc-session-kicker">{kit.intent.toUpperCase()}</span>
                  <h3>{kit.name}</h3>
                </div>
                <span className="dc-session-note">{kit.game.name || "No game"}</span>
              </div>
              <p>
                {kit.scope.hubId}
                {kit.scope.channelId ? ` · ${kit.scope.channelId}` : ""}
              </p>
              <div className="dc-session-actions">
                <button
                  type="button"
                  className="dc-session-primary"
                  onClick={() => setPending(prepareSessionKitLaunch(kit, references))}
                >
                  Review launch
                </button>
                {onDelete && (
                  <button
                    type="button"
                    className="dc-session-danger"
                    onClick={() => {
                      try {
                        const result = onDelete(kit);
                        if (result && !result.ok)
                          setError(result.error ?? "The Session Kit could not be removed from this device.");
                        else setError("");
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "The Session Kit could not be removed from this device.",
                        );
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {pending && (
        <div
          className="dc-session-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPending(null);
          }}
        >
          <section
            className="dc-session-dialog dc-session-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-kit-launch-title"
          >
            <span className="dc-session-kicker">REVIEW BEFORE STARTING</span>
            <h2 id="session-kit-launch-title">{pending.kitName}</h2>
            <p>
              {pending.canLaunch
                ? "Available parts will be restored for this session."
                : "This Hub is unavailable, so the kit cannot open its context."}
            </p>
            <ul className="dc-session-summary">
              {pending.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {pending.inviteActionRequired && (
              <p className="dc-session-note">
                Invite candidates are ready for your review. Starting this session will not send invitations or
                messages.
              </p>
            )}
            {pending.issues.length > 0 && (
              <ul className="dc-session-issues" aria-label="Skipped unavailable kit references">
                {pending.issues.map((item) => (
                  <li key={`${item.code}:${item.reference}`}>{item.message}</li>
                ))}
              </ul>
            )}
            <div className="dc-session-actions">
              <button type="button" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="dc-session-primary"
                disabled={!pending.canLaunch}
                onClick={() => {
                  onLaunch(pending);
                  setPending(null);
                }}
              >
                Start session
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
