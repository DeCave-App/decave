import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { hubEventToIcs, type HubEvent } from "../../../shared/hub-events";
import { downloadHubEventIcs, downloadIcsText, type EventsApiContext } from "./api";
import { formatCountdown, formatTimeRange, DEFAULT_EVENT_DURATION_MS } from "./model";
import { RsvpControl } from "./RsvpControl";
import "../shared/shared.css";
import "./events.css";
import { formatDateParts } from "../shared/dateParts";

export type EventChatCardProps = {
  messageId: string;
  hubId: number;
  hubName: string;
  title: string;
  startAt: string;
  description: string;
  inviteLabel: string;
  /** API event announced by this message, when known and visible. */
  event: HubEvent | null;
  api: EventsApiContext;
  onChanged: (event: HubEvent) => void;
  onOpen: () => void;
};

/** Chat card for `__DECAVE_EVENT__` messages: countdown, RSVP (API events) and .ics. */
export function EventChatCard(props: EventChatCardProps) {
  const { t } = useTranslation(["events"]);
  const { event } = props;
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const start = event ? event.occurrenceStart : Date.parse(props.startAt);
  const end = event ? (event.occurrenceEnd ?? start + DEFAULT_EVENT_DURATION_MS) : start + DEFAULT_EVENT_DURATION_MS;
  const valid = Number.isFinite(start);
  const title = event?.title ?? props.title;
  const description = event?.description ?? props.description;
  const cancelled = Boolean(event?.cancelledAt);
  const live = valid && !cancelled && start <= now && end > now;
  const ended = valid && end <= now;
  const date = new Date(valid ? start : 0);

  const addToCalendar = async () => {
    setError("");
    try {
      if (event) await downloadHubEventIcs(props.api, props.hubId, event.id, title);
      else if (valid)
        downloadIcsText(
          hubEventToIcs(
            {
              id: props.messageId,
              title,
              description,
              startsAt: start,
              endsAt: null,
              recurrence: "none",
              cancelledAt: null,
              createdAt: start,
              updatedAt: start,
            },
            { hubName: props.hubName },
          ),
          title,
        );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("events.api.icsFailed"));
    }
  };

  return (
    <div className={`dc-event-card evx-chat-card${cancelled ? " cancelled" : ""}`}>
      <div className="dc-event-date">
        <strong>{valid ? formatDateParts(date, { day: "2-digit" }) : "?"}</strong>
        <span>{valid ? formatDateParts(date, { month: "short" }).toUpperCase() : t("events.card.dateFallback")}</span>
      </div>
      <div className="dc-event-copy">
        <div className="dc-poll-kicker">
          {t("events.card.kicker")}
          {live && <span className="evx-badge live">{t("events.status.live")}</span>}
          {cancelled && <span className="evx-badge cancelled">{t("events.kind.cancelled")}</span>}
          {!live && !ended && !cancelled && valid && <span className="evx-badge">{formatCountdown(start, now)}</span>}
          {ended && !cancelled && <span className="evx-badge">{t("events.status.ended")}</span>}
        </div>
        <button type="button" className="evx-chat-title" onClick={props.onOpen}>
          {title}
        </button>
        <small>{valid ? formatTimeRange(start, event ? event.occurrenceEnd : null) : props.startAt}</small>
        {description && <p>{description}</p>}
        <em>{props.inviteLabel}</em>
        {event && !cancelled && (
          <RsvpControl
            compact
            event={event}
            api={props.api}
            onChanged={props.onChanged}
            disabledReason={ended && event.recurrence === "none" ? t("events.rsvp.ended") : undefined}
          />
        )}
        <div className="evx-chat-actions">
          {valid && !cancelled && (
            <button type="button" className="dcx-btn" onClick={() => void addToCalendar()}>
              {t("events.card.addToCalendar")}
            </button>
          )}
          <button type="button" className="dcx-btn" onClick={props.onOpen}>
            {t("events.card.details")}
          </button>
        </div>
        {error && (
          <small className="evx-error" role="alert">
            {error}
          </small>
        )}
      </div>
    </div>
  );
}
