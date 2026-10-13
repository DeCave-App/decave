import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createDecisionCardId,
  toExistingEventPayload,
  type DecisionCardKind,
  type DecisionCardMetadata,
  type ExistingEventPayload,
  type ExistingPollPayload,
  type SharedDecisionCard,
} from "../../session/decision-cards.ts";
import "./session.css";

export type DecisionCardComposerProps = {
  onCreatePoll: (
    payload: ExistingPollPayload,
    metadata: DecisionCardMetadata,
  ) => Promise<{ sourceMessageId: string }> | { sourceMessageId: string };
  onCreateEvent?: (
    payload: ExistingEventPayload,
    metadata: DecisionCardMetadata,
  ) => Promise<{ eventId: string }> | { eventId: string };
  onCreated?: (card: SharedDecisionCard) => void;
  onCancel?: () => void;
};

/** Creates a decision card by calling existing poll/event actions through typed payloads. */
export function DecisionCardComposer({ onCreatePoll, onCreateEvent, onCreated, onCancel }: DecisionCardComposerProps) {
  const { t } = useTranslation(["chat"]);
  const [kind, setKind] = useState<DecisionCardKind>("poll");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [deadlineAt, setDeadlineAt] = useState("");
  const [linkEvent, setLinkEvent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const cleanQuestion = question.trim().slice(0, 180);
    const cleanOptions = options
      .map((option) => option.trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 8);
    if (!cleanQuestion || cleanOptions.length < 2 || busy) return;
    const normalizedDeadline =
      deadlineAt && !Number.isNaN(Date.parse(deadlineAt)) ? new Date(deadlineAt).toISOString() : null;
    const cardId = createDecisionCardId();
    let eventId: string | null = null;
    const metadataBase = { cardId, kind, deadlineAt: normalizedDeadline, eventId: null } satisfies DecisionCardMetadata;
    setBusy(true);
    setError("");
    try {
      if (linkEvent && onCreateEvent) {
        const eventPayload = toExistingEventPayload({ question: cleanQuestion, deadlineAt: normalizedDeadline });
        if (eventPayload) {
          const eventResult = await onCreateEvent(eventPayload, metadataBase);
          if (!eventResult || typeof eventResult.eventId !== "string" || !eventResult.eventId.trim())
            throw new Error(t("chat.session.composer.eventFailed"));
          eventId = eventResult.eventId.trim().slice(0, 160);
        }
      }
      const metadata: DecisionCardMetadata = { ...metadataBase, eventId };
      const result = await onCreatePoll({ question: cleanQuestion, options: cleanOptions }, metadata);
      if (!result || typeof result.sourceMessageId !== "string" || !result.sourceMessageId.trim())
        throw new Error(t("chat.session.composer.pollFailed"));
      onCreated?.({
        id: cardId,
        kind,
        question: cleanQuestion,
        options: cleanOptions,
        deadlineAt: normalizedDeadline,
        sourceMessageId: result.sourceMessageId,
        eventId,
        counts: cleanOptions.map(() => 0),
        selectedOptionIndex: null,
        pinned: false,
      });
      setQuestion("");
      setOptions(["", ""]);
      setDeadlineAt("");
      setLinkEvent(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.session.composer.createFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="dc-session-form" aria-labelledby="decision-card-composer-title">
      <div>
        <span className="dc-session-kicker">{t("chat.session.composer.kicker")}</span>
        <h2 id="decision-card-composer-title">{t("chat.session.composer.title")}</h2>
      </div>
      <div className="dc-session-form-grid">
        <label>
          {t("chat.session.composer.cardType")}
          <select value={kind} onChange={(event) => setKind(event.target.value as DecisionCardKind)}>
            <option value="poll">{t("chat.session.composer.kindPoll")}</option>
            <option value="availability">{t("chat.session.composer.kindAvailability")}</option>
            <option value="choose-game">{t("chat.session.composer.kindChooseGame")}</option>
          </select>
        </label>
        <label>
          {t("chat.session.composer.deadline")}{" "}
          <span className="dc-session-note">{t("chat.session.composer.optional")}</span>
          <input type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} />
        </label>
      </div>
      <label>
        {t("chat.session.composer.question")}
        <input
          value={question}
          maxLength={180}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("chat.session.composer.questionPlaceholder")}
        />
      </label>
      <div className="dc-session-form-grid">
        {options.map((option, index) => (
          <label key={index}>
            {t("chat.session.composer.option", { number: index + 1 })}
            <input
              value={option}
              maxLength={100}
              onChange={(event) =>
                setOptions((current) =>
                  current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                )
              }
            />
          </label>
        ))}
      </div>
      {options.length < 8 && (
        <button type="button" onClick={() => setOptions((current) => [...current, ""])}>
          {t("chat.session.composer.addOption")}
        </button>
      )}
      {onCreateEvent && (
        <label className="dc-session-checkbox">
          <input
            type="checkbox"
            checked={linkEvent}
            disabled={!deadlineAt}
            onChange={(event) => setLinkEvent(event.target.checked)}
          />
          {t("chat.session.composer.linkEvent")}
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="dc-session-actions">
        <button
          type="button"
          className="dc-session-primary"
          disabled={busy || !question.trim() || options.filter((option) => option.trim()).length < 2}
          onClick={() => void submit()}
        >
          {busy ? t("chat.session.composer.posting") : t("chat.session.composer.post")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {t("chat.session.cancel")}
          </button>
        )}
      </div>
    </section>
  );
}
