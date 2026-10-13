// Locale for the few Intl date formats src/i18n/format.ts has no style for
// (weekday + time, short month, hour only). Same rule as format.ts: the Dates &
// times language when it is set to one, otherwise the UI language.

import { localeForLanguage } from "../../app/locale";
import { activeLocale } from "../../i18n";

export function intlLocale(): string {
  const preferred = localeForLanguage();
  return preferred && preferred !== "en" ? preferred : activeLocale();
}
