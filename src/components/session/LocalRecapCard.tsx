import { useState } from "react";
import type { LocalSessionRecap } from "../../session/local-recap.ts";
import "./session.css";

export type LocalRecapCardProps = {
  recap: LocalSessionRecap;
  onClear?: () => boolean | void;
  storageError?: string | null;
};

/** Displays the explicit local action log; it never accepts or renders audio/transcript data. */
export function LocalRecapCard({ recap, onClear, storageError }: LocalRecapCardProps) {
  const [error, setError] = useState("");
  const clear = () => {
    if (!onClear) return;
    try {
      const result = onClear();
      if (result === false) {
        setError("The local recap could not be cleared on this device.");
        return;
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local recap could not be cleared on this device.");
    }
  };
  return (
    <section className="dc-session-recap" aria-labelledby="local-recap-title">
      <div className="dc-session-row">
        <div>
          <span className="dc-session-kicker">LOCAL SESSION RECAP</span>
          <h2 id="local-recap-title">What you chose to keep</h2>
        </div>
        {onClear && (
          <button type="button" onClick={clear}>
            Clear recap
          </button>
        )}
      </div>
      {(error || storageError) && (
        <p className="dc-session-note" role="alert">
          {error || storageError}
        </p>
      )}
      <p>{recap.note}</p>
      <div className="dc-session-recap-list" aria-label="Recap totals">
        <div>
          <strong>{recap.participants.length}</strong>
          <span>Participants visible</span>
        </div>
        <div>
          <strong>{recap.channels.length}</strong>
          <span>Rooms visited</span>
        </div>
        <div>
          <strong>{recap.sharedLinks.length}</strong>
          <span>Shared links</span>
        </div>
        <div>
          <strong>{recap.polls.length + recap.events.length + recap.followUps.length}</strong>
          <span>Planning items</span>
        </div>
      </div>
      {recap.sharedLinks.length > 0 && (
        <div className="dc-session-recap-list" aria-label="Shared links">
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
        <p className="dc-session-note">Follow-ups: {recap.followUps.map((item) => item.title).join(" · ")}</p>
      )}
      <p className="dc-session-note">
        Only explicit local/session actions are included. Voice and private message content are not recorded.
      </p>
    </section>
  );
}
