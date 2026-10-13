// Mounts the translation runtime around the app. Components use useTranslation()
// from react-i18next, or useLocale() below to read and change the language.

import type { PropsWithChildren } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import "./catalogs.ts";
import { activeLocale, i18next, setLocale, startI18n } from "./index.ts";
import type { Locale } from "../../shared/i18n/languages.ts";

void startI18n();

export function I18nProvider({ children }: PropsWithChildren) {
  return <I18nextProvider i18n={i18next}>{children}</I18nextProvider>;
}

/** The UI language and a setter; re-renders when the language changes. */
export function useLocale(): { locale: Locale; setLocale: (next: Locale | null) => Promise<void> } {
  useTranslation();
  return { locale: activeLocale(), setLocale };
}
