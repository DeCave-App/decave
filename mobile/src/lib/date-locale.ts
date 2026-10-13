// The locale dates, times and numbers are formatted in (toLocale*String, Intl):
// the chosen UI language, or undefined (the device's own format) in English so
// English output stays exactly as it was before translations.

import i18next from "i18next";
import { DEFAULT_LOCALE, isLocale } from "../../../shared/i18n/languages.ts";

export function dateLocale(): string | undefined {
  const language = i18next.language;
  return isLocale(language) && language !== DEFAULT_LOCALE ? language : undefined;
}
