import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  decisionCardIsClosed,
  decisionCardTotalVotes,
  type DecisionCardTransport,
  type SharedDecisionCard,
} from "../../session/decision-cards.ts";
import "./session.css";
import { i18next } from "../../i18n/index.ts";
import { formatDate } from "../../i18n/format.ts";

export type DecisionCardProps = {
  card: SharedDecisionCard;
  transport: DecisionCardTransport;
  now?: number;
};

function deadlineLabel(deadlineAt: string | null): string {
  if (!deadlineAt) return i18next.t("chat.session.decision.noDeadline");
  const date = new Date(deadlineAt);
  return Number.isNaN(date.getTime())
    ? i18next.t("chat.session.decision.deadlineUnavailable")
    : i18next.t("chat.session.decision.closes", { date: formatDate(date, "dateTime") });
}

/** First-class result view backed by the existing poll reactions and event actions. */
export function DecisionCard({ card, transport, now = Date.now() }: DecisionCardProps) {
  const { t } = useTranslation(["chat"]);
  const closed = decisionCardIsClosed(card, now);
  const total = decisionCardTotalVotes(card);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const vote = async (optionIndex: number) => {
    if (closed || busyIndex !== null) return;
    setBusyIndex(optionIndex);
    setError("");
    try {
      await transport.vote(card.sourceMessageId, optionIndex);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.session.decision.voteFailed"));
    } finally {
      setBusyIndex(null);
    }
  };
  const setPinned = async (pinned: boolean) => {
    if (!transport.setPinned) return;
    setError("");
    try {
      await transport.setPinned(card, pinned);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.session.decision.pinFailed"));
    }
  };
  return (
    <article className="dc-session-decision" aria-labelledby={`decision-card-${card.id}`}>
      <div className="dc-session-row">
        <div>
          <span className="dc-session-kicker">
            {card.kind === "availability"
              ? t("chat.session.decision.kickerAvailability")
              : card.kind === "choose-game"
                ? t("chat.session.decision.kickerChooseGame")
                : t("chat.session.decision.kickerPoll")}
          </span>
          <h3 id={`decision-card-${card.id}`}>{card.question}</h3>
        </div>
        <span className="dc-session-note">
          {closed ? t("chat.session.decision.closed") : t("chat.session.decision.open")}
        </span>
      </div>
      <div className="dc-session-decision-options">
        {card.options.map((option, index) => {
          const count = card.counts[index] ?? 0;
          const percent = total ? Math.round((count / total) * 100) : 0;
          return (
            <button
              key={option}
              type="button"
              className={`dc-session-decision-option${card.selectedOptionIndex === index ? " is-selected" : ""}`}
              disabled={closed || busyIndex !== null}
              aria-pressed={card.selectedOptionIndex === index}
              onClick={() => void vote(index)}
            >
              <span style={{ width: `${percent}%` }} aria-hidden="true" />
              <b>{option}</b>
              <em>
                {count} · {percent}%
              </em>
            </button>
          );
        })}
      </div>
      <div className="dc-session-decision-meta">
        <span>{t("chat.session.decision.votes", { count: total })}</span>
        <span>{deadlineLabel(card.deadlineAt)}</span>
        {card.eventId && (
          <button type="button" onClick={() => transport.openEvent?.(card.eventId!)}>
            {t("chat.session.decision.openEvent")}
          </button>
        )}
      </div>
      {error && (
        <p className="dc-session-note" role="alert">
          {error}
        </p>
      )}
      <div className="dc-session-actions">
        {transport.setPinned && (
          <button type="button" aria-pressed={card.pinned} onClick={() => void setPinned(!card.pinned)}>
            {card.pinned ? t("chat.session.decision.unpin") : t("chat.session.decision.pin")}
          </button>
        )}
      </div>
    </article>
  );
}
