// Custom date shapes (day number, short month, weekday…) in the same locale as
// src/i18n/format.ts: the Dates & times language when it is set to something
// other than English, otherwise the UI language.

import { localeForLanguage } from "../../app/locale";
import { activeLocale } from "../../i18n/index.ts";

export function dateLocale(): string {
  const preferred = localeForLanguage();
  return preferred && preferred !== "en" ? preferred : activeLocale();
}

/** Weekday name for 0 = Sunday … 6 = Saturday; "?" for anything else. */
export function weekdayName(day: number, width: "short" | "long"): string {
  if (!Number.isInteger(day) || day < 0 || day > 6) return "?";
  // 1 January 2023 was a Sunday.
  return new Intl.DateTimeFormat(dateLocale(), { weekday: width, timeZone: "UTC" }).format(Date.UTC(2023, 0, 1 + day));
}

export function formatDateParts(value: Date | number | string, options: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(dateLocale(), options).format(date);
}
