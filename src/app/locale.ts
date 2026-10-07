// Language and time-format preferences used when formatting dates and times.

import type { TimeFormatPreference, LanguagePreference, AccountPreferences } from "./types";

export const LANGUAGE_TIME_KEY = "decave_language_time_v1";

export function loadLanguageTimePreferences(): Pick<AccountPreferences, "language" | "timeFormat"> {
  try {
    const stored = JSON.parse(localStorage.getItem(LANGUAGE_TIME_KEY) || "{}") as Partial<AccountPreferences>;
    const language: LanguagePreference =
      stored.language === "pl" ||
      stored.language === "el" ||
      stored.language === "de" ||
      stored.language === "fr" ||
      stored.language === "es" ||
      stored.language === "it" ||
      stored.language === "pt"
        ? stored.language
        : "en";
    const timeFormat: TimeFormatPreference =
      stored.timeFormat === "12h" || stored.timeFormat === "24h" ? stored.timeFormat : "system";
    return { language, timeFormat };
  } catch {
    return { language: "en", timeFormat: "system" };
  }
}

let activeLanguagePreference: LanguagePreference = loadLanguageTimePreferences().language;
export let activeTimeFormatPreference: TimeFormatPreference = loadLanguageTimePreferences().timeFormat;

export function setActiveLanguagePreference(language: LanguagePreference): void {
  activeLanguagePreference = language;
}

export function setActiveTimeFormatPreference(timeFormat: TimeFormatPreference): void {
  activeTimeFormatPreference = timeFormat;
}

export function localeForLanguage(language = activeLanguagePreference): string | undefined {
  return {
    en: "en",
    pl: "pl",
    el: "el",
    de: "de",
    fr: "fr",
    es: "es",
    it: "it",
    pt: "pt",
  }[language];
}

export function preferredTimeOptions(): Intl.DateTimeFormatOptions {
  if (activeTimeFormatPreference === "12h") return { hour12: true };
  if (activeTimeFormatPreference === "24h") return { hour12: false };
  return {};
}

export function formatProfileDate(timestamp: string | null | undefined): string {
  if (!timestamp) return "Not available";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(localeForLanguage(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(localeForLanguage(), {
    hour: "2-digit",
    minute: "2-digit",
    ...preferredTimeOptions(),
  });
}
