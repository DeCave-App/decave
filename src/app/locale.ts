// Language and time-format preferences used when formatting dates and times.

import type { TimeFormatPreference, LanguagePreference, AccountPreferences } from "./types";
import { isDateStyleLanguage } from "../../shared/date-style";

export const LANGUAGE_TIME_KEY = "decave_language_time_v1";

export function loadLanguageTimePreferences(): Pick<AccountPreferences, "language" | "timeFormat"> {
  try {
    const stored = JSON.parse(localStorage.getItem(LANGUAGE_TIME_KEY) || "{}") as Partial<AccountPreferences>;
    const language: LanguagePreference = isDateStyleLanguage(stored.language) ? stored.language : "en";
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
    nl: "nl",
    uk: "uk",
  }[language];
}

export function preferredTimeOptions(): Intl.DateTimeFormatOptions {
  if (activeTimeFormatPreference === "12h") return { hour12: true };
  if (activeTimeFormatPreference === "24h") return { hour12: false };
  return {};
}
