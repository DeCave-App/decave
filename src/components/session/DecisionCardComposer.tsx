import { useState } from "react";
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
            throw new Error("The linked event could not be created.");
          eventId = eventResult.eventId.trim().slice(0, 160);
        }
      }
      const metadata: DecisionCardMetadata = { ...metadataBase, eventId };
      const result = await onCreatePoll({ question: cleanQuestion, options: cleanOptions }, metadata);
      if (!result || typeof result.sourceMessageId !== "string" || !result.sourceMessageId.trim())
        throw new Error("The decision poll could not be created.");
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
      setError(cause instanceof Error ? cause.message : "Could not create this decision card.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="dc-session-form" aria-labelledby="decision-card-composer-title">
      <div>
        <span className="dc-session-kicker">SHARED DECISION</span>
        <h2 id="decision-card-composer-title">Ask the room</h2>
      </div>
      <div className="dc-session-form-grid">
        <label>
          Card type
          <select value={kind} onChange={(event) => setKind(event.target.value as DecisionCardKind)}>
            <option value="poll">Poll</option>
            <option value="availability">Availability</option>
            <option value="choose-game">Choose a game</option>
          </select>
        </label>
        <label>
          Deadline <span className="dc-session-note">optional</span>
          <input type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} />
        </label>
      </div>
      <label>
        Question
        <input
          value={question}
          maxLength={180}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What should we play?"
        />
      </label>
      <div className="dc-session-form-grid">
        {options.map((option, index) => (
          <label key={index}>
            Option {index + 1}
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
          Add option
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
          Link an event at the deadline
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
          {busy ? "Posting…" : "Post decision"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
