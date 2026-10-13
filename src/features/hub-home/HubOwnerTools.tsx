import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon } from "../../components/Icon";
import { hoursToLocal, weekChange, type SetupAction, type SetupStep } from "./hubSetup";
import "./hubOwnerTools.css";
import { preferredTimeOptions } from "../../app/locale";
import { apiErrorMessage, type ApiErrorBody } from "../../i18n/apiError";
import { intlLocale } from "./intlLocale";

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
  const { t } = useTranslation(["hub"]);
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
          <h2 id={`hot-check-${hubId}`}>{t("hub.hubHome.setup.title")}</h2>
          <p>{t("hub.hubHome.setup.progress", { done, total: steps.length })}</p>
        </div>
        <div
          className="hot-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          aria-label={t("hub.hubHome.setup.progressLabel")}
        >
          <i style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <button type="button" className="hh-btn ghost hot-hide" onClick={hide}>
          {t("hub.hubHome.setup.hide")}
        </button>
      </header>
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={step.done ? "is-done" : ""}>
            <span className="hot-tick" aria-hidden="true">
              {step.done ? <Icon name="check" size="sm" /> : null}
            </span>
            <span className="hot-step">
              <strong>{t(`hub.hubHome.setup.steps.${step.id}.title`)}</strong>
              <small>{t(`hub.hubHome.setup.steps.${step.id}.detail`)}</small>
            </span>
            {step.done ? (
              <span className="hot-done-label">{t("hub.hubHome.setup.done")}</span>
            ) : (
              <button type="button" className="hh-btn" onClick={() => onAction(step.action)}>
                {t(`hub.hubHome.setup.steps.${step.id}.action`)}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Bars({
  values,
  labels,
  label,
  unitLabel,
  tip,
}: {
  values: number[];
  labels: string[];
  label: string;
  /** Screen-reader label of one bar, e.g. "Mon 3: 12 messages". */
  unitLabel: (label: string, value: number) => string;
  /** Hover tip after the bold value, e.g. "messages · Mon 3". */
  tip: (label: string, value: number) => string;
}) {
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
            aria-label={unitLabel(labels[index], value)}
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            onBlur={() => setHover(null)}
          >
            <i style={{ height: `${value === 0 ? 0 : Math.max(4, (value / max) * 100)}%` }} />
          </button>
        ))}
        {hover !== null && (
          <span className="hot-tip" style={{ left: `${((hover + 0.5) / values.length) * 100}%` }} role="status">
            <strong>{values[hover]}</strong> {tip(labels[hover], values[hover])}
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

/** weekChange() gives "New" and "Same" in English; the rest are numbers. */
function weekChangeLabel(change: string, t: TFunction<["hub"]>): string {
  if (change === "New") return t("hub.hubHome.insights.changeNew");
  if (change === "Same") return t("hub.hubHome.insights.changeSame");
  return change;
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
  const { t } = useTranslation(["hub"]);
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
        const body = (await response.json().catch(() => ({}))) as HubInsights & ApiErrorBody;
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(
            body.code || body.error ? apiErrorMessage(body, "common.unknown") : t("hub.hubHome.insights.loadFailed"),
          );
        }
        setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("hub.hubHome.insights.loadFailed"));
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
    new Date(`${day}T12:00:00Z`).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });
  const hours = data ? hoursToLocal(data.hoursUtc) : [];
  const busiest = hours.length ? hours.indexOf(Math.max(...hours)) : -1;
  const hourLabel = (hour: number) =>
    new Date(2030, 0, 1, hour).toLocaleTimeString(intlLocale(), { hour: "numeric", ...preferredTimeOptions() });
  const change = (current: number, previous: number) => weekChangeLabel(weekChange(current, previous), t);
  const messagesLabel = (label: string, value: number) => t("hub.hubHome.insights.barLabel", { label, count: value });
  const messagesTip = (label: string, value: number) => t("hub.hubHome.insights.barTip", { label, count: value });
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
            <span className="ds-kicker">{t("hub.hubHome.insights.kicker")}</span>
            <h2 id="hot-insights-title">{hubName}</h2>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              aria-label={t("hub.hubHome.close")}
              title={t("hub.hubHome.close")}
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        {!data && !error && <p className="hot-status">{t("hub.hubHome.insights.loading")}</p>}
        {error && (
          <p className="hot-status hot-error" role="alert">
            {error}
          </p>
        )}
        {data && (
          <div className="hot-body">
            <div className="hot-tiles">
              <div className="hot-tile">
                <span>{t("hub.hubHome.insights.members")}</span>
                <strong>{data.members.total}</strong>
                <small>
                  {data.members.joinedThisWeek
                    ? t("hub.hubHome.insights.joinedThisWeek", { count: data.members.joinedThisWeek })
                    : t("hub.hubHome.insights.noNewMembers")}
                </small>
              </div>
              <div className="hot-tile">
                <span>{t("hub.hubHome.insights.messagesThisWeek")}</span>
                <strong>{data.thisWeek.messages}</strong>
                <small>
                  {t("hub.hubHome.insights.vsLastWeek", {
                    change: change(data.thisWeek.messages, data.lastWeek.messages),
                  })}
                </small>
              </div>
              <div className="hot-tile">
                <span>{t("hub.hubHome.insights.peopleWhoTalked")}</span>
                <strong>{data.thisWeek.activePeople}</strong>
                <small>
                  {t("hub.hubHome.insights.vsLastWeek", {
                    change: change(data.thisWeek.activePeople, data.lastWeek.activePeople),
                  })}
                </small>
              </div>
              <div className="hot-tile">
                <span>{t("hub.hubHome.insights.busiestTime")}</span>
                <strong>{busiest >= 0 && hours[busiest] > 0 ? hourLabel(busiest) : "—"}</strong>
                <small>{t("hub.hubHome.insights.busiestHint")}</small>
              </div>
            </div>
            <Bars
              values={data.days.map((day) => day.messages)}
              labels={data.days.map((day) => dayLabel(day.day))}
              label={t("hub.hubHome.insights.perDay")}
              unitLabel={messagesLabel}
              tip={messagesTip}
            />
            <Bars
              values={hours}
              labels={hours.map((_, hour) => hourLabel(hour))}
              label={t("hub.hubHome.insights.byHour")}
              unitLabel={messagesLabel}
              tip={messagesTip}
            />
            <div className="hot-columns">
              <section>
                <h3>{t("hub.hubHome.insights.rooms")}</h3>
                <ul className="hot-rooms">
                  {data.rooms
                    .filter((room) => room.type !== "voice")
                    .map((room) => (
                      <li key={room.id}>
                        <button type="button" onClick={() => onOpenRoom(room.id)}>
                          #{room.name}
                        </button>
                        <span>{t("hub.hubHome.insights.roomMessages", { count: room.messages30d })}</span>
                      </li>
                    ))}
                </ul>
                {quietRooms.length > 0 && (
                  <p className="hot-hint">
                    {quietRooms.length === 1
                      ? t("hub.hubHome.insights.quietRoom", { name: quietRooms[0].name })
                      : t("hub.hubHome.insights.quietRooms", { count: quietRooms.length })}
                  </p>
                )}
              </section>
              <section>
                <h3>{t("hub.hubHome.insights.mostActive")}</h3>
                {data.topPosters.length === 0 ? (
                  <p className="hot-hint">{t("hub.hubHome.insights.nobody")}</p>
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
