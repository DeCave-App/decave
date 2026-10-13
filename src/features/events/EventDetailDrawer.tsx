import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { hubEventToIcs, type HubEvent } from "../../../shared/hub-events";
import { useDialogA11y } from "../shared/useDialogA11y";
import { cancelHubEvent, downloadHubEventIcs, downloadIcsText, type EventsApiContext } from "./api";
import {
  formatCountdown,
  formatTimeRange,
  isLive,
  itemColor,
  itemEnd,
  itemKindLabel,
  timeZoneLabel,
  viewerTimeZone,
  type CalendarItem,
  type EventRoom,
} from "./model";
import { AttendeeStack, RsvpControl } from "./RsvpControl";
import "../shared/shared.css";
import "./events.css";
import { Icon } from "../../components/Icon";

export type EventDetailDrawerProps = {
  item: CalendarItem;
  rooms: EventRoom[];
  api: EventsApiContext;
  resolveMediaUrl: (url: string) => string;
  renderAvatar: (userId: string) => ReactNode;
  memberName: (userId: string) => string;
  onClose: () => void;
  onEventChanged: (event: HubEvent) => void;
  onEventCancelled: (hubId: number, eventId: string) => void;
  onEdit: (event: HubEvent) => void;
  onJoinVoice: (hubId: number, roomId: number) => void;
  onOpenRoom: (hubId: number, roomId: number) => void;
};

export function EventDetailDrawer(props: EventDetailDrawerProps) {
  const { t } = useTranslation(["events"]);
  const { item, rooms, api } = props;
  const titleId = useId();
  const [now, setNow] = useState(() => Date.now());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogA11y<HTMLElement>(confirmCancel ? () => setConfirmCancel(false) : props.onClose);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setConfirmCancel(false);
    setError("");
  }, [item.key]);

  const event = item.event;
  const viewerTz = viewerTimeZone();
  const room = (id: number | null) => (id ? (rooms.find((candidate) => candidate.id === id) ?? null) : null);
  const voiceRoom = room(item.voiceChannelId);
  const textRoom = room(item.channelId);
  const live = isLive(item, now);
  const ended = itemEnd(item) <= now;

  const addToCalendar = async () => {
    setError("");
    try {
      if (event) await downloadHubEventIcs(api, item.hubId, event.id, item.title);
      else
        downloadIcsText(
          hubEventToIcs(
            {
              id: item.id,
              title: item.title,
              description: item.description,
              startsAt: item.start,
              endsAt: item.end,
              recurrence: "none",
              cancelledAt: null,
              createdAt: item.start,
              updatedAt: item.start,
            },
            { hubName: item.hubName },
          ),
          item.title,
        );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("events.api.icsFailed"));
    }
  };

  const cancelEvent = async () => {
    if (!event || busy) return;
    setBusy(true);
    setError("");
    try {
      await cancelHubEvent(api, item.hubId, event.id);
      props.onEventCancelled(item.hubId, event.id);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("events.drawer.cancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  const audienceLabel = event
    ? event.audience === "all"
      ? t("events.drawer.audienceAll")
      : event.audience === "roles"
        ? t("events.drawer.audienceRoles", { count: event.audienceIds.length })
        : t("events.drawer.audienceMembers", { count: event.audienceIds.length })
    : item.legacy?.authorName
      ? t("events.drawer.postedBy", { name: item.legacy.authorName })
      : t("events.drawer.hubEvent");

  const body = (
    <div
      className="evx-overlay"
      data-hub-calendar-page="true"
      data-hub-events-dialog="open"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <aside
        ref={dialogRef}
        className="evx-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-dc-dialog="open"
        tabIndex={-1}
        style={{ ["--evx-accent" as string]: itemColor(item) }}
      >
        <div className={`evx-cover${item.coverUrl ? " has-image" : ""}`}>
          {item.coverUrl && <img src={props.resolveMediaUrl(item.coverUrl)} alt="" />}
          <button
            type="button"
            className="evx-icon-btn evx-close"
            onClick={props.onClose}
            aria-label={t("events.drawer.close")}
          >
            <Icon name="close" size="sm" />
          </button>
          <div className="evx-cover-badges">
            {live && <span className="evx-badge live">{t("events.status.live")}</span>}
            {item.cancelled && <span className="evx-badge cancelled">{t("events.kind.cancelled")}</span>}
            <span className="evx-badge">{itemKindLabel(item)}</span>
            {event && event.recurrence !== "none" && (
              <span className="evx-badge">{t(`events.composer.repeatsChip.${event.recurrence}`)}</span>
            )}
          </div>
        </div>
        <div className="evx-drawer-body">
          <p className="evx-kicker">{item.hubName}</p>
          <h2 id={titleId}>{item.title}</h2>

          <dl className="evx-facts">
            <div>
              <dt>{t("events.drawer.when")}</dt>
              <dd>
                <strong>{formatTimeRange(item.start, item.end)}</strong>
                <small>
                  {timeZoneLabel(viewerTz, item.start)}
                  {!ended && !live && !item.cancelled
                    ? t("events.drawer.startsIn", { countdown: formatCountdown(item.start, now) })
                    : ""}
                  {ended ? t("events.drawer.ended") : ""}
                </small>
                {item.timezone && item.timezone !== viewerTz && (
                  <small className="evx-alt-tz">
                    {formatTimeRange(item.start, item.end, item.timezone)} · {timeZoneLabel(item.timezone, item.start)}
                  </small>
                )}
              </dd>
            </div>
            {(voiceRoom || textRoom) && (
              <div>
                <dt>{t("events.drawer.where")}</dt>
                <dd className="evx-where">
                  {voiceRoom && (
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-primary"
                      onClick={() => props.onJoinVoice(item.hubId, voiceRoom.id)}
                    >
                      {t("events.drawer.joinVoice", { name: voiceRoom.name })}
                    </button>
                  )}
                  {textRoom && (
                    <button type="button" className="dcx-btn" onClick={() => props.onOpenRoom(item.hubId, textRoom.id)}>
                      {t("events.drawer.openRoom", { name: textRoom.name })}
                    </button>
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt>{t("events.composer.audienceLabel")}</dt>
              <dd>
                {audienceLabel}
                {event?.gameTag ? <span className="evx-chip">{event.gameTag}</span> : null}
              </dd>
            </div>
          </dl>

          {item.description && <p className="evx-description">{item.description}</p>}

          {event && !item.cancelled && (
            <section className="evx-section" aria-label={t("events.rsvp.label")}>
              <h3>{t("events.drawer.going")}</h3>
              <RsvpControl
                event={event}
                api={api}
                onChanged={props.onEventChanged}
                disabledReason={ended && event.recurrence === "none" ? t("events.rsvp.ended") : undefined}
              />
              <AttendeeStack event={event} renderAvatar={props.renderAvatar} memberName={props.memberName} />
            </section>
          )}
          {!event && <p className="evx-note">{t("events.drawer.legacy")}</p>}

          {error && (
            <p className="evx-error" role="alert">
              {error}
            </p>
          )}

          <div className="evx-actions">
            <button type="button" className="dcx-btn" onClick={() => void addToCalendar()}>
              {t("events.drawer.addToCalendar")}
            </button>
            {!event && item.legacy && (
              <button
                type="button"
                className="dcx-btn"
                onClick={() => props.onOpenRoom(item.hubId, item.legacy!.channelId)}
              >
                {t("events.drawer.openInChat")}
              </button>
            )}
            {event?.canManage && !item.cancelled && (
              <>
                <button type="button" className="dcx-btn" onClick={() => props.onEdit(event)}>
                  {t("events.drawer.edit")}
                </button>
                {confirmCancel ? (
                  <span className="evx-confirm" role="group" aria-label={t("events.drawer.confirmCancel")}>
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-danger"
                      disabled={busy}
                      onClick={() => void cancelEvent()}
                    >
                      {busy ? t("events.drawer.cancelling") : t("events.drawer.confirmCancelYes")}
                    </button>
                    <button type="button" className="dcx-btn" disabled={busy} onClick={() => setConfirmCancel(false)}>
                      {t("events.drawer.keep")}
                    </button>
                  </span>
                ) : (
                  <button type="button" className="dcx-btn dcx-btn-danger" onClick={() => setConfirmCancel(true)}>
                    {t("events.drawer.cancelEvent")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
  return createPortal(body, document.body);
}
