import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalSessionRecap } from "../../session/local-recap.ts";
import "./session.css";

export type LocalRecapCardProps = {
  recap: LocalSessionRecap;
  onClear?: () => boolean | void;
  storageError?: string | null;
};

/** Displays the explicit local action log; it never accepts or renders audio/transcript data. */
export function LocalRecapCard({ recap, onClear, storageError }: LocalRecapCardProps) {
  const { t } = useTranslation(["chat"]);
  const [error, setError] = useState("");
  const clear = () => {
    if (!onClear) return;
    try {
      const result = onClear();
      if (result === false) {
        setError(t("chat.session.recapCard.clearFailed"));
        return;
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.session.recapCard.clearFailed"));
    }
  };
  return (
    <section className="dc-session-recap" aria-labelledby="local-recap-title">
      <div className="dc-session-row">
        <div>
          <span className="dc-session-kicker">{t("chat.session.recapCard.kicker")}</span>
          <h2 id="local-recap-title">{t("chat.session.recapCard.title")}</h2>
        </div>
        {onClear && (
          <button type="button" onClick={clear}>
            {t("chat.session.recapCard.clear")}
          </button>
        )}
      </div>
      {(error || storageError) && (
        <p className="dc-session-note" role="alert">
          {error || storageError}
        </p>
      )}
      <p>{recap.note}</p>
      <div className="dc-session-recap-list" aria-label={t("chat.session.recapCard.totals")}>
        <div>
          <strong>{recap.participants.length}</strong>
          <span>{t("chat.session.recapCard.participants")}</span>
        </div>
        <div>
          <strong>{recap.channels.length}</strong>
          <span>{t("chat.session.recapCard.rooms")}</span>
        </div>
        <div>
          <strong>{recap.sharedLinks.length}</strong>
          <span>{t("chat.session.recapCard.links")}</span>
        </div>
        <div>
          <strong>{recap.polls.length + recap.events.length + recap.followUps.length}</strong>
          <span>{t("chat.session.recapCard.planning")}</span>
        </div>
      </div>
      {recap.sharedLinks.length > 0 && (
        <div className="dc-session-recap-list" aria-label={t("chat.session.recapCard.links")}>
          {recap.sharedLinks.map((link) => (
            <div key={link.url}>
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </div>
          ))}
        </div>
      )}
      {recap.followUps.length > 0 && (
        <p className="dc-session-note">
          {t("chat.session.recapCard.followUps", { items: recap.followUps.map((item) => item.title).join(" · ") })}
        </p>
      )}
      <p className="dc-session-note">{t("chat.session.recapCard.privacyNote")}</p>
    </section>
  );
}
