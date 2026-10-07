import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  addDays,
  formatCountdown,
  isLive,
  itemColor,
  itemEnd,
  itemKindLabel,
  sameDay,
  startOfDay,
  startOfWeek,
  type CalendarItem,
} from "../events/model";
import "../shared/shared.css";
import "./calendar.css";
import { Icon } from "../../components/Icon";
import { localeForLanguage, preferredTimeOptions } from "../../app/locale";

export type CalendarView = "month" | "week" | "agenda";

export type HubCalendarPageProps = {
  hubName: string;
  items: CalendarItem[];
  canCreate: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onCreate: (start: number, end: number) => void;
  onOpenItem: (item: CalendarItem) => void;
  onRangeChange: (from: number, to: number) => void;
  onRefresh: () => void;
};

const HOUR_PX = 44;
const SLOT_MIN = 30;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEW_KEY = "decave_hub_calendar_view";

function readView(): CalendarView {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    if (value === "month" || value === "week" || value === "agenda") return value;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.("(max-width: 640px)").matches ? "agenda" : "month";
}

function rangeFor(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  if (view === "agenda") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 42) };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const from = startOfWeek(first);
  return { from, to: addDays(from, 42) };
}

function defaultStartFor(day: Date): number {
  const now = new Date();
  if (sameDay(day, now)) {
    const next = new Date(now.getTime() + 60 * 60_000);
    next.setMinutes(0, 0, 0);
    return next.getTime();
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 19, 0).getTime();
}

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString(localeForLanguage(), {
    hour: "numeric",
    minute: "2-digit",
    ...preferredTimeOptions(),
  });

export function HubCalendarPage(props: HubCalendarPageProps) {
  const { items, canCreate } = props;
  const titleId = useId();
  const [view, setView] = useState<CalendarView>(readView);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [now, setNow] = useState(() => Date.now());
  const [drag, setDrag] = useState<{ day: number; from: number; to: number } | null>(null);
  const dragRef = useRef<{ day: number; from: number; to: number; moved: boolean } | null>(null);
  const weekScrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // The overlay is portalled to <body> and fixed, but the app chrome (top hub
  // bar and left rail) sits above it with a much higher z-index. Measure that
  // chrome and inset the overlay so the page lives in the content area below it.
  const [chrome, setChrome] = useState({ top: 0, left: 0 });
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector<HTMLElement>(".app > .vadrion-topbar");
      const rect = bar?.getBoundingClientRect();
      const visible = !!rect && rect.height > 0 && getComputedStyle(bar!).display !== "none";
      const top = visible ? Math.max(0, Math.round(rect!.bottom)) : 0;
      const left = visible && rect!.top <= 1 ? Math.max(0, Math.round(rect!.left)) : 0;
      setChrome((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
    };
    measure();
    window.addEventListener("resize", measure);
    const bar = document.querySelector(".app > .vadrion-topbar");
    const observer = typeof ResizeObserver !== "undefined" && bar ? new ResizeObserver(measure) : null;
    if (observer && bar) observer.observe(bar);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const onRangeChange = props.onRangeChange;
  useEffect(() => {
    onRangeChange(range.from.getTime(), range.to.getTime());
  }, [range.from.getTime(), range.to.getTime()]);

  useEffect(() => {
    if (view === "week" && weekScrollRef.current) weekScrollRef.current.scrollTop = HOUR_PX * 8;
  }, [view]);

  const move = (direction: -1 | 1) => {
    setAnchor((current) => {
      if (view === "month") return new Date(current.getFullYear(), current.getMonth() + direction, 1);
      if (view === "week") return addDays(current, 7 * direction);
      return addDays(current, 28 * direction);
    });
  };

  const label =
    view === "month"
      ? anchor.toLocaleDateString(localeForLanguage(), { month: "long", year: "numeric" })
      : view === "week"
        ? `${range.from.toLocaleDateString(localeForLanguage(), { month: "short", day: "numeric" })} – ${addDays(range.to, -1).toLocaleDateString(localeForLanguage(), { month: "short", day: "numeric", year: "numeric" })}`
        : `From ${range.from.toLocaleDateString(localeForLanguage(), { month: "long", day: "numeric" })}`;

  const visible = items.filter((item) => item.start < range.to.getTime() && itemEnd(item) > range.from.getTime());
  const itemsOnDay = (day: Date) => {
    const from = startOfDay(day).getTime();
    const to = addDays(startOfDay(day), 1).getTime();
    return visible.filter((item) => item.start < to && itemEnd(item) > from);
  };

  const upcoming = items
    .filter((item) => !item.cancelled && itemEnd(item) > now)
    .sort((a, b) => a.start - b.start)
    .slice(0, 8);

  const chip = (item: CalendarItem, compact = false) => (
    <button
      key={item.key}
      type="button"
      className={`hcx-chip${item.cancelled ? " cancelled" : ""}${isLive(item, now) ? " live" : ""}`}
      style={{ ["--hcx-color" as string]: itemColor(item) }}
      onClick={(e) => {
        e.stopPropagation();
        props.onOpenItem(item);
      }}
      title={`${item.title} · ${timeLabel(item.start)}`}
    >
      {!compact && <span className="hcx-chip-time">{timeLabel(item.start)}</span>}
      <span className="hcx-chip-title">{item.title}</span>
    </button>
  );

  // ---------- Week drag-to-create ----------
  const slotFromPointer = (event: ReactPointerEvent<HTMLElement>, column: HTMLElement) => {
    const rect = column.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));
    return Math.floor(y / (HOUR_PX / (60 / SLOT_MIN)));
  };
  const onColumnPointerDown = (event: ReactPointerEvent<HTMLDivElement>, dayIndex: number) => {
    if (!canCreate || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".hcx-week-event")) return;
    const slot = slotFromPointer(event, event.currentTarget);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { day: dayIndex, from: slot, to: slot, moved: false };
    setDrag({ day: dayIndex, from: slot, to: slot });
    event.preventDefault();
  };
  const onColumnPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const slot = slotFromPointer(event, event.currentTarget);
    if (slot !== current.to) {
      current.to = slot;
      current.moved = true;
      setDrag({ day: current.day, from: current.from, to: slot });
    }
  };
  const onColumnPointerUp = () => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current) return;
    const day = addDays(range.from, current.day);
    const a = Math.min(current.from, current.to);
    const b = Math.max(current.from, current.to) + 1;
    const start = day.getTime() + a * SLOT_MIN * 60_000;
    const end = current.moved ? day.getTime() + b * SLOT_MIN * 60_000 : start + 60 * 60_000;
    props.onCreate(start, end);
  };

  const body = (
    <div className="hcx-overlay" data-hub-calendar-page="true" style={{ top: chrome.top, left: chrome.left }}>
      <div ref={rootRef} className="hcx-page" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="hcx-head">
          <div className="hcx-title">
            <p className="hcx-kicker">{props.hubName}</p>
            <h1 id={titleId}>Hub Calendar</h1>
          </div>
          <div className="hcx-toolbar">
            <div className="hcx-nav" role="group" aria-label="Navigate">
              <button type="button" className="dcx-btn" onClick={() => setAnchor(startOfDay(new Date()))}>
                Today
              </button>
              <button
                type="button"
                className="dcx-btn hcx-icon"
                onClick={() => move(-1)}
                aria-label={`Previous ${view === "agenda" ? "period" : view}`}
              >
                <Icon name="chevron-left" size="sm" />
              </button>
              <button
                type="button"
                className="dcx-btn hcx-icon"
                onClick={() => move(1)}
                aria-label={`Next ${view === "agenda" ? "period" : view}`}
              >
                <Icon name="chevron-right" size="sm" />
              </button>
              <strong className="hcx-label" aria-live="polite">
                {label}
              </strong>
            </div>
            <div className="hcx-views" role="tablist" aria-label="Calendar view">
              {(["month", "week", "agenda"] as CalendarView[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  className={view === value ? "active" : ""}
                  onClick={() => setView(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="dcx-btn hcx-icon"
              onClick={props.onRefresh}
              disabled={props.busy}
              aria-label="Refresh events"
              title="Refresh events"
            >
              {props.busy ? "…" : "↻"}
            </button>
            {canCreate && (
              <button
                type="button"
                className="dcx-btn dcx-btn-primary"
                onClick={() => props.onCreate(defaultStartFor(anchor), defaultStartFor(anchor) + 60 * 60_000)}
              >
                ＋ New event
              </button>
            )}
            <button type="button" className="dcx-btn hcx-icon" onClick={props.onClose} aria-label="Close Hub Calendar">
              <Icon name="close" size="sm" />
            </button>
          </div>
        </header>
        {props.error && (
          <p className="hcx-error" role="alert">
            {props.error}
          </p>
        )}

        <div className="hcx-body">
          <main className="hcx-main">
            {view === "month" && (
              <div className="hcx-month">
                <div className="hcx-weekdays" aria-hidden="true">
                  {WEEKDAYS.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className="hcx-month-grid" role="grid" aria-label={label}>
                  {Array.from({ length: 6 }, (_, week) => (
                    <div key={week} role="row" className="hcx-month-row">
                      {Array.from({ length: 7 }, (_, dow) => {
                        const day = addDays(range.from, week * 7 + dow);
                        const dayItems = itemsOnDay(day);
                        const outside = day.getMonth() !== anchor.getMonth();
                        const today = sameDay(day, new Date(now));
                        const past = addDays(day, 1).getTime() <= now;
                        const dayLabel = day.toLocaleDateString(localeForLanguage(), {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        });
                        return (
                          <div
                            key={dow}
                            role="gridcell"
                            className={`hcx-day${outside ? " outside" : ""}${today ? " today" : ""}${past ? " past" : ""}`}
                            aria-label={`${dayLabel}, ${dayItems.length} event${dayItems.length === 1 ? "" : "s"}`}
                          >
                            {canCreate && !past ? (
                              <button
                                type="button"
                                className="hcx-day-add"
                                onClick={() => props.onCreate(defaultStartFor(day), defaultStartFor(day) + 60 * 60_000)}
                                aria-label={`Create event on ${dayLabel}`}
                              >
                                <span className="hcx-day-num">{day.getDate()}</span>
                                <span className="hcx-plus" aria-hidden="true">
                                  <Icon name="plus" size="sm" />
                                </span>
                              </button>
                            ) : (
                              <span className="hcx-day-num">{day.getDate()}</span>
                            )}
                            <div className="hcx-day-items">
                              {dayItems.slice(0, 3).map((item) => chip(item))}
                              {dayItems.length > 3 && (
                                <button
                                  type="button"
                                  className="hcx-more"
                                  onClick={() => {
                                    setAnchor(day);
                                    setView("agenda");
                                  }}
                                >
                                  +{dayItems.length - 3} more
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {view === "week" && (
              <div className="hcx-week">
                <div className="hcx-week-head">
                  <span />
                  {Array.from({ length: 7 }, (_, i) => {
                    const day = addDays(range.from, i);
                    return (
                      <span key={i} className={sameDay(day, new Date(now)) ? "today" : ""}>
                        <small>{WEEKDAYS[i]}</small>
                        <strong>{day.getDate()}</strong>
                      </span>
                    );
                  })}
                </div>
                <div className="hcx-week-scroll" ref={weekScrollRef}>
                  <div className="hcx-week-grid" style={{ height: HOUR_PX * 24 }}>
                    <div className="hcx-hours" aria-hidden="true">
                      {Array.from({ length: 24 }, (_, h) => (
                        <span key={h} style={{ top: h * HOUR_PX }}>
                          {h === 0
                            ? ""
                            : new Date(2000, 0, 1, h).toLocaleTimeString(localeForLanguage(), {
                                hour: "numeric",
                                ...preferredTimeOptions(),
                              })}
                        </span>
                      ))}
                    </div>
                    {Array.from({ length: 7 }, (_, i) => {
                      const day = addDays(range.from, i);
                      const dayStart = day.getTime();
                      const dayEnd = addDays(day, 1).getTime();
                      const dayItems = itemsOnDay(day);
                      return (
                        <div
                          key={i}
                          className={`hcx-week-col${canCreate ? " can-create" : ""}`}
                          onPointerDown={(e) => onColumnPointerDown(e, i)}
                          onPointerMove={onColumnPointerMove}
                          onPointerUp={onColumnPointerUp}
                          onPointerCancel={() => {
                            dragRef.current = null;
                            setDrag(null);
                          }}
                        >
                          {canCreate &&
                            Array.from({ length: 24 }, (_, h) => {
                              const slotStart = dayStart + h * 60 * 60_000;
                              if (slotStart + 60 * 60_000 <= now) return null;
                              return (
                                <button
                                  key={h}
                                  type="button"
                                  className="hcx-slot"
                                  style={{ top: h * HOUR_PX, height: HOUR_PX }}
                                  tabIndex={0}
                                  aria-label={`Create event ${day.toLocaleDateString(localeForLanguage(), { weekday: "long" })} at ${timeLabel(slotStart)}`}
                                  onClick={(e) => {
                                    if (e.detail === 0) props.onCreate(slotStart, slotStart + 60 * 60_000);
                                  }}
                                />
                              );
                            })}
                          {dayItems.map((item) => {
                            const s = Math.max(item.start, dayStart);
                            const en = Math.min(itemEnd(item), dayEnd);
                            const top = ((s - dayStart) / 3_600_000) * HOUR_PX;
                            const height = Math.max(22, ((en - s) / 3_600_000) * HOUR_PX - 2);
                            return (
                              <button
                                key={item.key}
                                type="button"
                                className={`hcx-week-event${item.cancelled ? " cancelled" : ""}${isLive(item, now) ? " live" : ""}`}
                                style={{ top, height, ["--hcx-color" as string]: itemColor(item) }}
                                onClick={() => props.onOpenItem(item)}
                              >
                                <strong>{item.title}</strong>
                                <small>
                                  {timeLabel(item.start)} · {itemKindLabel(item)}
                                </small>
                              </button>
                            );
                          })}
                          {drag && drag.day === i && (
                            <div
                              className="hcx-drag"
                              style={{
                                top: Math.min(drag.from, drag.to) * (HOUR_PX / 2),
                                height: (Math.abs(drag.to - drag.from) + 1) * (HOUR_PX / 2),
                              }}
                              aria-hidden="true"
                            >
                              {timeLabel(dayStart + Math.min(drag.from, drag.to) * SLOT_MIN * 60_000)} –{" "}
                              {timeLabel(dayStart + (Math.max(drag.from, drag.to) + 1) * SLOT_MIN * 60_000)}
                            </div>
                          )}
                          {sameDay(day, new Date(now)) && (
                            <div
                              className="hcx-now-line"
                              style={{ top: ((now - dayStart) / 3_600_000) * HOUR_PX }}
                              aria-hidden="true"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {view === "agenda" && (
              <div className="hcx-agenda">
                {(() => {
                  const days = Array.from({ length: 42 }, (_, i) => addDays(range.from, i))
                    .map((day) => ({ day, items: itemsOnDay(day) }))
                    .filter((entry) => entry.items.length);
                  if (!days.length)
                    return (
                      <div className="hcx-empty">
                        <strong>No events in this period</strong>
                        <small>
                          {canCreate
                            ? "Create one to get your community together."
                            : "Check back later or ask a Hub admin to schedule something."}
                        </small>
                      </div>
                    );
                  return days.map(({ day, items: dayItems }) => (
                    <section key={day.toISOString()} className="hcx-agenda-day">
                      <h2 className={sameDay(day, new Date(now)) ? "today" : ""}>
                        {day.toLocaleDateString(localeForLanguage(), {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}
                      </h2>
                      {dayItems.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={`hcx-agenda-item${item.cancelled ? " cancelled" : ""}`}
                          style={{ ["--hcx-color" as string]: itemColor(item) }}
                          onClick={() => props.onOpenItem(item)}
                        >
                          <span className="hcx-agenda-time">
                            {timeLabel(item.start)}
                            {item.end ? <small>{timeLabel(item.end)}</small> : null}
                          </span>
                          <span className="hcx-agenda-copy">
                            <strong>{item.title}</strong>
                            <small>
                              {itemKindLabel(item)}
                              {item.event ? ` · ${item.event.rsvpCounts.going} going` : ""}
                            </small>
                          </span>
                          {isLive(item, now) && <span className="hcx-live">Live now</span>}
                        </button>
                      ))}
                    </section>
                  ));
                })()}
              </div>
            )}
          </main>

          <aside className="hcx-rail" aria-label="Upcoming events">
            <h2>Upcoming</h2>
            {upcoming.length === 0 && (
              <div className="hcx-rail-empty">
                <span className="hcx-rail-empty-icon" aria-hidden="true">
                  📅
                </span>
                <strong>Nothing on the horizon</strong>
                <small>
                  {canCreate
                    ? "Schedule a raid night, tournament or hangout and it will show up here."
                    : "When this Hub schedules events, they'll show up here."}
                </small>
                {canCreate && (
                  <button
                    type="button"
                    className="dcx-btn dcx-btn-primary"
                    onClick={() =>
                      props.onCreate(defaultStartFor(new Date()), defaultStartFor(new Date()) + 60 * 60_000)
                    }
                  >
                    ＋ Plan an event
                  </button>
                )}
              </div>
            )}
            <ul>
              {upcoming.map((item) => {
                const live = isLive(item, now);
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      className={`hcx-rail-item${live ? " live" : ""}`}
                      style={{ ["--hcx-color" as string]: itemColor(item) }}
                      onClick={() => props.onOpenItem(item)}
                    >
                      <span className="hcx-rail-date">
                        <strong>
                          {new Date(item.start).toLocaleDateString(localeForLanguage(), { day: "2-digit" })}
                        </strong>
                        <small>
                          {new Date(item.start)
                            .toLocaleDateString(localeForLanguage(), { month: "short" })
                            .toUpperCase()}
                        </small>
                      </span>
                      <span className="hcx-rail-copy">
                        <strong>{item.title}</strong>
                        <small>
                          {live ? <span className="hcx-live">Live now</span> : formatCountdown(item.start, now)} ·{" "}
                          {timeLabel(item.start)}
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
