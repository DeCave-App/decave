import { hour12Preference } from "@/src/lib/account-preferences-store";
import { dateLocale } from "@/src/lib/date-locale";

/** "Fri, Oct 17, 8:00 PM – 10:00 PM" (end date repeated only when it is another day), like web. */
export function formatTimeRange(start: number, end: number | null): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: hour12Preference(),
  };
  const startLabel = new Date(start).toLocaleString(dateLocale(), options);
  if (end === null) return startLabel;
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
  const endLabel = sameDay ? formatTime(end) : new Date(end).toLocaleString(dateLocale(), options);
  return `${startLabel} – ${endLabel}`;
}

export function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString(dateLocale(), { hour: "numeric", minute: "2-digit", hour12: hour12Preference() });
}

export function formatDayHeading(time: number): string {
  return new Date(time).toLocaleDateString(dateLocale(), { weekday: "long", month: "long", day: "numeric" });
}

export function formatMonth(time: number): string {
  return new Date(time).toLocaleDateString(dateLocale(), { month: "long", year: "numeric" });
}

/** Mon … Sun, short, in the UI language. */
export function weekdayInitials(): string[] {
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index).toLocaleDateString(dateLocale(), { weekday: "narrow" }),
  );
}
