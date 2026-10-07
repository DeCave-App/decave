import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { hoursToLocal, weekChange, type SetupAction, type SetupStep } from "./hubSetup";
import "./hubOwnerTools.css";
import { localeForLanguage, preferredTimeOptions } from "../../app/locale";

export type HubInsights = {
  generatedAt: string;
  members: { total: number; joinedThisWeek: number };
  thisWeek: { messages: number; activePeople: number };
  lastWeek: { messages: number; activePeople: number };
  days: Array<{ day: string; messages: number }>;
  hoursUtc: number[];
  rooms: Array<{ id: number; name: string; type: string; messages30d: number; lastMessageAt: string | null }>;
  topPosters: Array<{ username: string; messages30d: number }>;
};

type ChecklistProps = {
  hubId: number;
  steps: SetupStep[];
  onAction: (action: SetupAction) => void;
};

const hiddenKey = (hubId: number) => `decave_hub_setup_hidden_v1:${hubId}`;

/** Owners and admins: what's left to set up, until it's done or hidden. */
export function HubSetupChecklist({ hubId, steps, onAction }: ChecklistProps) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(hiddenKey(hubId)) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(hiddenKey(hubId)) === "1");
    } catch {
      setHidden(false);
    }
  }, [hubId]);
  const done = steps.filter((step) => step.done).length;
  if (hidden || done === steps.length) return null;
  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(hubId), "1");
    } catch {
      /* storage blocked */
    }
    setHidden(true);
  };
  return (
    <section className="hot-checklist" aria-labelledby={`hot-check-${hubId}`}>
      <header>
        <div>
          <h2 id={`hot-check-${hubId}`}>Set up your Hub</h2>
          <p>
            {done} of {steps.length} done. Only owners and admins see this.
          </p>
        </div>
        <div
          className="hot-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          aria-label="Setup progress"
        >
          <i style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <button type="button" className="hh-btn ghost hot-hide" onClick={hide}>
          Hide
        </button>
      </header>
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={step.done ? "is-done" : ""}>
            <span className="hot-tick" aria-hidden="true">
              {step.done ? <Icon name="check" size="sm" /> : null}
            </span>
            <span className="hot-step">
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </span>
            {step.done ? (
              <span className="hot-done-label">Done</span>
            ) : (
              <button type="button" className="hh-btn" onClick={() => onAction(step.action)}>
                {step.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Bars({ values, labels, label, unit }: { values: number[]; labels: string[]; label: string; unit: string }) {
  const max = Math.max(1, ...values);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <figure className="hot-chart">
      <figcaption>{label}</figcaption>
      <div className="hot-bars" onMouseLeave={() => setHover(null)}>
        {values.map((value, index) => (
          <button
            key={labels[index]}
            type="button"
            className={`hot-bar${hover === index ? " is-hover" : ""}`}
            aria-label={`${labels[index]}: ${value} ${unit}`}
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
          >
            <i style={{ height: `${value === 0 ? 0 : Math.max(4, (value / max) * 100)}%` }} />
          </button>
        ))}
        {hover !== null && (
          <span className="hot-tip" style={{ left: `${((hover + 0.5) / values.length) * 100}%` }} role="status">
            <strong>{values[hover]}</strong> {unit} · {labels[hover]}
          </span>
        )}
      </div>
      <div className="hot-axis" aria-hidden="true">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
      <table className="hot-sr-only">
        <caption>{label}</caption>
        <tbody>
          {values.map((value, index) => (
            <tr key={labels[index]}>
              <th scope="row">{labels[index]}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

type InsightsProps = {
  apiBase: string;
  hubId: number;
  hubName: string;
  onClose: () => void;
  onOpenRoom: (roomId: number) => void;
};

/** Owners and admins: how the Hub is doing over the last weeks. Counts only. */
export function HubInsightsDialog({ apiBase, hubId, hubName, onClose, onOpenRoom }: InsightsProps) {
  const [data, setData] = useState<HubInsights | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/api/servers/${hubId}/insights`, {
          credentials: "include",
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as HubInsights & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error || "Could not load insights.");
        setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load insights.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, hubId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const dayLabel = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(localeForLanguage(), { day: "numeric", month: "short" });
  const hours = data ? hoursToLocal(data.hoursUtc) : [];
  const busiest = hours.length ? hours.indexOf(Math.max(...hours)) : -1;
  const hourLabel = (hour: number) =>
    new Date(2030, 0, 1, hour).toLocaleTimeString(localeForLanguage(), { hour: "numeric", ...preferredTimeOptions() });
  const quietRooms = data?.rooms.filter((room) => room.type !== "voice" && room.messages30d === 0) ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal hot-insights"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hot-insights-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ds-page-header">
          <div className="ds-page-header-copy">
            <span className="ds-kicker">Hub insights · only owners and admins</span>
            <h2 id="hot-insights-title">{hubName}</h2>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              aria-label="Close"
              title="Close"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        {!data && !error && <p className="hot-status">Loading…</p>}
        {error && (
          <p className="hot-status hot-error" role="alert">
            {error}
          </p>
        )}
        {data && (
          <div className="hot-body">
            <div className="hot-tiles">
              <div className="hot-tile">
                <span>Members</span>
                <strong>{data.members.total}</strong>
                <small>
                  {data.members.joinedThisWeek
                    ? `+${data.members.joinedThisWeek} this week`
                    : "No new members this week"}
                </small>
              </div>
              <div className="hot-tile">
                <span>Messages this week</span>
                <strong>{data.thisWeek.messages}</strong>
                <small>{weekChange(data.thisWeek.messages, data.lastWeek.messages)} vs last week</small>
              </div>
              <div className="hot-tile">
                <span>People who talked</span>
                <strong>{data.thisWeek.activePeople}</strong>
                <small>{weekChange(data.thisWeek.activePeople, data.lastWeek.activePeople)} vs last week</small>
              </div>
              <div className="hot-tile">
                <span>Busiest time</span>
                <strong>{busiest >= 0 && hours[busiest] > 0 ? hourLabel(busiest) : "—"}</strong>
                <small>Last 30 days, your time</small>
              </div>
            </div>
            <Bars
              values={data.days.map((day) => day.messages)}
              labels={data.days.map((day) => dayLabel(day.day))}
              label="Messages per day, last 14 days"
              unit="messages"
            />
            <Bars
              values={hours}
              labels={hours.map((_, hour) => hourLabel(hour))}
              label="Messages by hour of day, last 30 days (your time)"
              unit="messages"
            />
            <div className="hot-columns">
              <section>
                <h3>Rooms, last 30 days</h3>
                <ul className="hot-rooms">
                  {data.rooms
                    .filter((room) => room.type !== "voice")
                    .map((room) => (
                      <li key={room.id}>
                        <button type="button" onClick={() => onOpenRoom(room.id)}>
                          #{room.name}
                        </button>
                        <span>
                          {room.messages30d} message{room.messages30d === 1 ? "" : "s"}
                        </span>
                      </li>
                    ))}
                </ul>
                {quietRooms.length > 0 && (
                  <p className="hot-hint">
                    {quietRooms.length === 1 ? `#${quietRooms[0].name} had` : `${quietRooms.length} rooms had`} no
                    messages this month. Consider merging or renaming {quietRooms.length === 1 ? "it" : "them"}.
                  </p>
                )}
              </section>
              <section>
                <h3>Most active, last 30 days</h3>
                {data.topPosters.length === 0 ? (
                  <p className="hot-hint">Nobody has written yet.</p>
                ) : (
                  <ol className="hot-top">
                    {data.topPosters.map((person) => (
                      <li key={person.username}>
                        <span>{person.username}</span>
                        <span>{person.messages30d}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
