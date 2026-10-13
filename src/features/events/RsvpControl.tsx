import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HubEvent, HubEventRsvpStatus } from "../../../shared/hub-events";
import { rsvpHubEvent, type EventsApiContext } from "./api";

const OPTIONS: Array<{ id: HubEventRsvpStatus; countKey: keyof HubEvent["rsvpCounts"] }> = [
  { id: "going", countKey: "going" },
  { id: "maybe", countKey: "maybe" },
  { id: "declined", countKey: "declined" },
];

export function RsvpControl({
  event,
  api,
  onChanged,
  compact = false,
  disabledReason,
}: {
  event: HubEvent;
  api: EventsApiContext;
  onChanged: (event: HubEvent) => void;
  compact?: boolean;
  disabledReason?: string;
}) {
  const { t } = useTranslation(["events"]);
  const [busy, setBusy] = useState<HubEventRsvpStatus | "clear" | null>(null);
  const [error, setError] = useState("");
  const full = event.capacity !== null && event.rsvpCounts.going >= event.capacity && event.myRsvp !== "going";

  const choose = async (status: HubEventRsvpStatus) => {
    if (busy) return;
    const next = event.myRsvp === status ? null : status;
    setBusy(next ?? "clear");
    setError("");
    try {
      onChanged(await rsvpHubEvent(api, event.hubId, event.id, next));
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(
        code === "EVENT_FULL"
          ? t("events.rsvp.fullError")
          : err instanceof Error
            ? err.message
            : t("events.rsvp.saveFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`evx-rsvp${compact ? " compact" : ""}`}>
      <div className="evx-rsvp-row" role="group" aria-label={t("events.rsvp.label")}>
        {OPTIONS.map((option) => {
          const active = event.myRsvp === option.id;
          const disabled = Boolean(disabledReason) || busy !== null || (option.id === "going" && full);
          return (
            <button
              key={option.id}
              type="button"
              className={`evx-rsvp-btn ${option.id}${active ? " active" : ""}`}
              aria-pressed={active}
              disabled={disabled}
              title={disabledReason || (option.id === "going" && full ? t("events.rsvp.full") : undefined)}
              onClick={() => void choose(option.id)}
            >
              <span>{t(`events.rsvp.${option.id}`)}</span>
              <b>{event.rsvpCounts[option.countKey]}</b>
            </button>
          );
        })}
      </div>
      {error && (
        <small className="evx-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function AttendeeStack({
  event,
  renderAvatar,
  memberName,
  max = 8,
}: {
  event: HubEvent;
  renderAvatar: (userId: string) => ReactNode;
  memberName: (userId: string) => string;
  max?: number;
}) {
  const { t } = useTranslation(["events"]);
  if (!event.goingUserIds.length) return null;
  const shown = event.goingUserIds.slice(0, max);
  const extra = event.rsvpCounts.going - shown.length;
  return (
    <div className="evx-attendees" aria-label={t("events.rsvp.goingCount", { count: event.rsvpCounts.going })}>
      <div className="evx-avatar-stack">
        {shown.map((id) => (
          <span key={id} className="evx-avatar" title={memberName(id)}>
            {renderAvatar(id)}
          </span>
        ))}
        {extra > 0 && <span className="evx-avatar more">+{extra}</span>}
      </div>
      <small>
        {event.capacity !== null
          ? t("events.rsvp.goingSpots", {
              count: event.rsvpCounts.going,
              left: Math.max(0, event.capacity - event.rsvpCounts.going),
              capacity: event.capacity,
            })
          : t("events.rsvp.goingCount", { count: event.rsvpCounts.going })}
      </small>
    </div>
  );
}
