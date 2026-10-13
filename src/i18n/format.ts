// Dates, times, numbers, lists and relative times in the UI language, through Intl.
// The Dates & times settings still apply: a chosen date style other than English
// picks the date locale, and the 12/24-hour choice applies to every time.

import { localeForLanguage, preferredTimeOptions } from "../app/locale.ts";
import { activeLocale, i18next } from "./index.ts";

export type DateStyle = "short" | "medium" | "long" | "time" | "dateTime";

type DateInput = Date | string | number;

function toTime(value: DateInput): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
}

/** The date style setting wins when it is set to a language; its English default follows the UI language. */
function dateLocale(): string {
  const preferred = localeForLanguage();
  return preferred && preferred !== "en" ? preferred : activeLocale();
}

const DATE_OPTIONS: Record<DateStyle, () => Intl.DateTimeFormatOptions> = {
  short: () => ({ dateStyle: "short" }),
  medium: () => ({ dateStyle: "medium" }),
  long: () => ({ dateStyle: "long" }),
  time: () => ({ hour: "2-digit", minute: "2-digit", ...preferredTimeOptions() }),
  dateTime: () => ({ dateStyle: "medium", timeStyle: "short", ...preferredTimeOptions() }),
};

export function formatDate(value: DateInput, style: DateStyle): string {
  const time = toTime(value);
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat(dateLocale(), DATE_OPTIONS[style]()).format(time);
}

/** A profile date (member since, last online) in the medium date style; "Not available" when unknown. */
export function formatProfileDate(timestamp: string | null | undefined): string {
  if (!timestamp) return i18next.t("chat.actions.profile.dateUnavailable");
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return i18next.t("chat.actions.profile.dateUnavailable");
  return formatDate(date, "medium");
}

/** A message's time of day. */
export function formatTimestamp(timestamp: string): string {
  return formatDate(timestamp, "time");
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(activeLocale()).format(value);
}

// Intl.ListFormat is ES2021; the web tsconfig targets ES2020 typings.
type ListFormatConstructor = new (
  locale: string,
  options: { style: "long"; type: "conjunction" },
) => { format(items: string[]): string };
const ListFormat = (Intl as unknown as { ListFormat: ListFormatConstructor }).ListFormat;

export function formatList(items: string[]): string {
  return new ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(items);
}

type RelativeUnit = "minute" | "hour" | "day" | "week";

/** How long ago, rounded the way the sidebar's short labels always have been. */
function elapsed(time: number, now: number): { unit: RelativeUnit; amount: number } | null {
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 1) return null;
  if (minutes < 60) return { unit: "minute", amount: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { unit: "hour", amount: hours };
  const days = Math.round(hours / 24);
  if (days < 7) return { unit: "day", amount: days };
  return { unit: "week", amount: Math.round(days / 7) };
}

const ENGLISH_SUFFIX: Record<RelativeUnit, string> = { minute: "m", hour: "h", day: "d", week: "w" };

/** Compact "time ago" label: "now", "5m", "3h", "2d", "1w" in English; Intl's short form elsewhere. */
export function formatRelative(value: DateInput, now = Date.now()): string {
  const time = toTime(value);
  if (!Number.isFinite(time)) return "";
  const locale = activeLocale();
  const span = elapsed(time, now);
  if (locale === "en") return span ? `${span.amount}${ENGLISH_SUFFIX[span.unit]}` : "now";
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  return span ? relative.format(-span.amount, span.unit) : relative.format(0, "second");
}
