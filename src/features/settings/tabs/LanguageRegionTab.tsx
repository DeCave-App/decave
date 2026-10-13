// Settings → Language & region: the language DeCave is shown in (once the
// translations ship), how dates are written and the time format.

import { useState } from "react";
import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import type { LanguagePreference, TimeFormatPreference } from "../../../app/types";
import { localeForLanguage, setActiveLanguagePreference, setActiveTimeFormatPreference } from "../../../app/locale";
import { selectStyle, settingsLabelStyle } from "../../../app/inline-styles";
import { I18N_PICKER_ENABLED } from "../../../../shared/i18n/flags";
import { LANGUAGES, isLocale, type Locale } from "../../../../shared/i18n/languages";
import { LOCALE_STORAGE_KEY, setDateStyleHtmlLang } from "../../../i18n";
import { useLocale } from "../../../i18n/I18nProvider";
import { FieldError, SettingsSection } from "../SettingsControls";
import { useSettingField, useStateField } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";

/** Date styles, each named in its own language (the names are not translated). */
const DATE_STYLES: [LanguagePreference, string][] = [
  ["en", "English"],
  ["pl", "Polski"],
  ["el", "Ελληνικά"],
  ["de", "Deutsch"],
  ["fr", "Français"],
  ["es", "Español"],
  ["it", "Italiano"],
  ["pt", "Português"],
  ["nl", "Nederlands"],
  ["uk", "Українська"],
];
const TIME_FORMATS: TimeFormatPreference[] = ["system", "12h", "24h"];

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function LanguagePicker() {
  const { t } = useSettingsT();
  const { setLocale } = useLocale();
  const [chosen, setChosen] = useState<Locale | null>(storedLocale);
  // setLocale saves on this device and the account; nothing else to persist.
  const field = useSettingField<Locale | null>(
    "language.locale",
    () => chosen,
    async () => undefined,
    {
      apply: (next) => {
        setChosen(next);
        void setLocale(next);
      },
    },
  );
  return (
    <label style={settingsLabelStyle} data-settings-anchor="app-language">
      {t("settings.language.language")}
      <select
        value={field.value ?? "system"}
        onChange={(event) => field.set(event.target.value === "system" ? null : (event.target.value as Locale))}
        style={selectStyle}
      >
        <option value="system">{t("settings.language.matchSystem")}</option>
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.reviewed ? language.nativeName : t("settings.language.beta", { name: language.nativeName })}
          </option>
        ))}
      </select>
      <small>{t("settings.language.languageHelp")}</small>
      <FieldError field={field} />
    </label>
  );
}

export function LanguageRegionTab(props: SettingsWindowProps) {
  const { t, tk } = useSettingsT();
  const { accountPreferences, setAccountPreferences } = props.preferences;
  const synced = ["account", "device"] as const;
  const dateStyle = useStateField(
    "language.dateStyle",
    accountPreferences.language,
    (language: LanguagePreference) => {
      setActiveLanguagePreference(language);
      setDateStyleHtmlLang(language);
      setAccountPreferences((current) => ({ ...current, language }));
    },
    synced,
  );
  const timeFormat = useStateField(
    "language.timeFormat",
    accountPreferences.timeFormat,
    (format: TimeFormatPreference) => {
      setActiveTimeFormatPreference(format);
      setAccountPreferences((current) => ({ ...current, timeFormat: format }));
    },
    synced,
  );
  const today = new Date();

  return (
    <SettingsSection title={t("settings.language.title")}>
      {!I18N_PICKER_ENABLED && <p className="dcs-section-note">{t("settings.language.englishForNow")}</p>}
      <div className="dc-language-time-grid">
        {I18N_PICKER_ENABLED && <LanguagePicker />}
        <label style={settingsLabelStyle} data-settings-anchor="date-style">
          {t("settings.language.dateStyle")}
          <select
            value={dateStyle.value}
            onChange={(event) => dateStyle.set(event.target.value as LanguagePreference)}
            style={selectStyle}
          >
            {DATE_STYLES.map(([value, name]) => (
              <option key={value} value={value}>
                {`${name} (${new Intl.DateTimeFormat(localeForLanguage(value), { dateStyle: "medium" }).format(today)})`}
              </option>
            ))}
          </select>
          <small>{t("settings.language.dateStyleHelp")}</small>
          <FieldError field={dateStyle} />
        </label>
        <label style={settingsLabelStyle} data-settings-anchor="time-format">
          {t("settings.language.timeFormat")}
          <select
            value={timeFormat.value}
            onChange={(event) => timeFormat.set(event.target.value as TimeFormatPreference)}
            style={selectStyle}
          >
            {TIME_FORMATS.map((value) => (
              <option key={value} value={value}>
                {tk(`settings.language.timeFormats.${value}`)}
              </option>
            ))}
          </select>
          <small>{t("settings.language.timeFormatHelp")}</small>
          <FieldError field={timeFormat} />
        </label>
      </div>
      <div className="dc-time-preview">
        {t("settings.language.preview", {
          time: new Intl.DateTimeFormat(localeForLanguage(dateStyle.value), {
            hour: "2-digit",
            minute: "2-digit",
            ...(timeFormat.value === "12h" ? { hour12: true } : timeFormat.value === "24h" ? { hour12: false } : {}),
          }).format(today),
        })}
      </div>
    </SettingsSection>
  );
}
