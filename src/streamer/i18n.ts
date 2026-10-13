// Translation for the DOM-built Streamer Overview: t() in the UI language at call
// time (the Overview rebuilds its DOM on every render) and the date locale.

import type { TFunction } from "i18next";
import { localeForLanguage } from "../app/locale";
import { activeLocale, i18next } from "../i18n";

export const t = ((...args: unknown[]) =>
  (i18next.t as unknown as (...params: unknown[]) => string)(...args)) as unknown as TFunction<["common", "streamer"]>;

/** The Dates & times setting when it names a language, else the UI language (as src/i18n/format.ts does). */
export function dateLocale(): string {
  const preferred = localeForLanguage();
  return preferred && preferred !== "en" ? preferred : activeLocale();
}
