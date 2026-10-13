// The schedule trigger's fields: one of every / daily / weekly / cron, plus a time zone.
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { BotRuleError } from "../../../shared/bots/schema.ts";
import type { BotTrigger } from "../../../shared/bots/types.ts";
import { fieldError } from "./model.ts";
import { weekdayName } from "../shared/dateParts";

type Schedule = Extract<BotTrigger, { type: "schedule" }>;
type Mode = "every" | "daily" | "weekly" | "cron";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

function modeOf(t: Schedule): Mode {
  if (t.daily !== undefined) return "daily";
  if (t.weekly !== undefined) return "weekly";
  if (t.cron !== undefined) return "cron";
  return "every";
}

const FRESH: Record<Mode, Partial<Schedule>> = {
  every: { every: 60 },
  daily: { daily: "09:00" },
  weekly: { weekly: { day: 1, time: "09:00" } },
  cron: { cron: "0 9 * * 1-5" },
};

export function ScheduleInput({
  value,
  onChange,
  errors,
}: {
  value: Schedule;
  onChange: (next: Schedule) => void;
  errors: BotRuleError[];
}) {
  const { t } = useTranslation(["bots"]);
  const id = useId();
  const mode = modeOf(value);
  const error =
    fieldError(errors, "trigger", mode) ??
    fieldError(errors, "trigger", "timezone") ??
    errors.find((e) => e.path === "trigger")?.message;
  return (
    <div className={`bb-field wide${error ? " invalid" : ""}`}>
      <label className="bb-field-label" htmlFor={id}>
        {t("bots.schedule.label")}
      </label>
      <span className="bb-inline bb-wrap">
        <select
          id={id}
          className="dcx-input"
          value={mode}
          onChange={(e) => onChange({ type: "schedule", timezone: value.timezone, ...FRESH[e.target.value as Mode] })}
        >
          <option value="every">{t("bots.schedule.every")}</option>
          <option value="daily">{t("bots.schedule.daily")}</option>
          <option value="weekly">{t("bots.schedule.weekly")}</option>
          <option value="cron">{t("bots.schedule.cron")}</option>
        </select>
        {mode === "every" && (
          <>
            <input
              className="dcx-input bb-num"
              type="number"
              min={5}
              aria-label={t("bots.schedule.minutesLabel")}
              value={value.every ?? ""}
              onChange={(e) => onChange({ ...value, every: Number(e.target.value) })}
            />
            <span>{t("bots.schedule.minutes")}</span>
          </>
        )}
        {mode === "daily" && (
          <input
            className="dcx-input"
            type="time"
            aria-label={t("bots.schedule.time")}
            value={value.daily ?? ""}
            onChange={(e) => onChange({ ...value, daily: e.target.value })}
          />
        )}
        {mode === "weekly" && value.weekly && (
          <>
            <select
              className="dcx-input"
              aria-label={t("bots.schedule.day")}
              value={value.weekly.day}
              onChange={(e) => onChange({ ...value, weekly: { ...value.weekly!, day: Number(e.target.value) } })}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {weekdayName(d, "long")}
                </option>
              ))}
            </select>
            <input
              className="dcx-input"
              type="time"
              aria-label={t("bots.schedule.time")}
              value={value.weekly.time}
              onChange={(e) => onChange({ ...value, weekly: { ...value.weekly!, time: e.target.value } })}
            />
          </>
        )}
        {mode === "cron" && (
          <input
            className="dcx-input"
            aria-label={t("bots.schedule.cronExpression")}
            value={value.cron ?? ""}
            onChange={(e) => onChange({ ...value, cron: e.target.value })}
          />
        )}
        <input
          className="dcx-input bb-tz"
          aria-label={t("bots.schedule.timezone")}
          title={t("bots.schedule.timezone")}
          value={value.timezone}
          onChange={(e) => onChange({ ...value, timezone: e.target.value })}
        />
      </span>
      {error ? (
        <small className="bb-error" role="alert">
          {error}
        </small>
      ) : (
        <small className="bb-hint">{t("bots.schedule.hint")}</small>
      )}
    </div>
  );
}
