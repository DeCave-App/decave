import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  prepareSessionKitLaunch,
  type SessionKit,
  type SessionKitIntent,
  type SessionKitLaunchPlan,
  type SessionKitReferenceCatalog,
} from "../../../shared/session-kit.ts";
import { i18next } from "../../i18n/index.ts";
import "./session.css";

/** A kit-launch line (chat.session.kitLaunch.*) in the UI language, else its English. */
function kitText(key: string, params: Record<string, string | number> | undefined, english: string): string {
  if (!i18next.exists(key, params)) return english;
  return (i18next.t as unknown as (key: string, params?: Record<string, unknown>) => string)(key, params);
}

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
  const { t } = useTranslation(["chat"]);
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
        setError(result.error ?? t("chat.session.kitPanel.saveFailed"));
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.session.kitPanel.saveFailed"));
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
          <span className="dc-session-kicker">{t("chat.session.kitPanel.kicker")}</span>
          <h2 id="session-kits-title">{t("chat.session.kitPanel.title")}</h2>
        </div>
        <div className="dc-session-actions">
          <span className="dc-session-note">{t("chat.session.kitPanel.savedCount", { count: kits.length })}</span>
          {onSaveCurrent && (
            <button type="button" onClick={() => setSaveOpen((value) => !value)}>
              {saveOpen ? t("chat.session.cancel") : t("chat.session.kitPanel.saveCurrent")}
            </button>
          )}
        </div>
      </div>
      {saveOpen && onSaveCurrent && (
        <div className="dc-session-form" style={{ marginTop: 14 }}>
          <div className="dc-session-form-grid">
            <label>
              {t("chat.session.kitPanel.kitName")}
              <input
                value={draftName}
                maxLength={64}
                autoFocus
                placeholder={t("chat.session.kitPanel.kitNamePlaceholder")}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </label>
            <label>
              {t("chat.session.kitPanel.intent")}
              <select value={draftIntent} onChange={(event) => setDraftIntent(event.target.value as SessionKitIntent)}>
                <option value="play">{t("chat.session.kitPanel.intentPlay")}</option>
                <option value="watch">{t("chat.session.kitPanel.intentWatch")}</option>
                <option value="chat">{t("chat.session.kitPanel.intentChat")}</option>
                <option value="plan">{t("chat.session.kitPanel.intentPlan")}</option>
              </select>
            </label>
          </div>
          <p className="dc-session-note">{t("chat.session.kitPanel.saveNote")}</p>
          <div className="dc-session-actions">
            <button type="button" className="dc-session-primary" disabled={!draftName.trim()} onClick={saveCurrent}>
              {t("chat.session.kitPanel.saveKit")}
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
        <p>{t("chat.session.kitPanel.empty")}</p>
      ) : (
        <div className="dc-session-panel-list">
          {kits.map((kit) => (
            <article className="dc-session-card" key={kit.id}>
              <div className="dc-session-card-head">
                <div>
                  <span className="dc-session-kicker">
                    {kit.intent === "watch"
                      ? t("chat.session.kitPanel.kickerWatch")
                      : kit.intent === "chat"
                        ? t("chat.session.kitPanel.kickerChat")
                        : kit.intent === "plan"
                          ? t("chat.session.kitPanel.kickerPlan")
                          : t("chat.session.kitPanel.kickerPlay")}
                  </span>
                  <h3>{kit.name}</h3>
                </div>
                <span className="dc-session-note">{kit.game.name || t("chat.session.kitPanel.noGame")}</span>
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
                  {t("chat.session.kitPanel.reviewLaunch")}
                </button>
                {onDelete && (
                  <button
                    type="button"
                    className="dc-session-danger"
                    onClick={() => {
                      try {
                        const result = onDelete(kit);
                        if (result && !result.ok) setError(result.error ?? t("chat.session.kitPanel.removeFailed"));
                        else setError("");
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : t("chat.session.kitPanel.removeFailed"));
                      }
                    }}
                  >
                    {t("chat.session.kitPanel.remove")}
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
            <span className="dc-session-kicker">{t("chat.session.kitPanel.reviewKicker")}</span>
            <h2 id="session-kit-launch-title">{pending.kitName}</h2>
            <p>{pending.canLaunch ? t("chat.session.kitPanel.canLaunch") : t("chat.session.kitPanel.cannotLaunch")}</p>
            <ul className="dc-session-summary">
              {pending.summaryText.map((line, index) => (
                <li key={line.key}>{kitText(line.key, line.params, pending.summary[index])}</li>
              ))}
            </ul>
            {pending.inviteActionRequired && <p className="dc-session-note">{t("chat.session.kitPanel.inviteNote")}</p>}
            {pending.issues.length > 0 && (
              <ul className="dc-session-issues" aria-label={t("chat.session.kitPanel.skippedLabel")}>
                {pending.issues.map((item) => (
                  <li key={`${item.code}:${item.reference}`}>{kitText(item.key, undefined, item.message)}</li>
                ))}
              </ul>
            )}
            <div className="dc-session-actions">
              <button type="button" onClick={() => setPending(null)}>
                {t("chat.session.cancel")}
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
                {t("chat.session.kitPanel.start")}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
