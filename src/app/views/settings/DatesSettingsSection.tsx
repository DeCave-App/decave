import type { TimeFormatPreference, LanguagePreference } from "../../types";
import { setActiveLanguagePreference, setActiveTimeFormatPreference, localeForLanguage } from "../../locale";
import { selectStyle, settingsSectionStyle, settingsSectionTitleStyle, settingsLabelStyle } from "../../inline-styles";
import type { PreferencesState } from "../../state/preferences";

type Props = {
  preferences: PreferencesState;
};

export function DatesSettingsSection({ preferences }: Props) {
  const { accountPreferences, setAccountPreferences } = preferences;
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>DATES & TIMES</div>
        <p className="dcs-section-note">
          DeCave's menus and buttons are in English for now. These choices change how dates and times are written
          everywhere in the app.
        </p>
        <div className="dc-language-time-grid">
          <label style={settingsLabelStyle}>
            Date style
            <select
              value={accountPreferences.language}
              onChange={(event) => {
                const language = event.target.value as LanguagePreference;
                setActiveLanguagePreference(language);
                document.documentElement.lang = language;
                setAccountPreferences((current) => ({ ...current, language }));
              }}
              style={selectStyle}
            >
              <option value="en">
                English ({new Intl.DateTimeFormat(localeForLanguage("en"), { dateStyle: "medium" }).format(new Date())})
              </option>
              <option value="pl">
                Polski ({new Intl.DateTimeFormat(localeForLanguage("pl"), { dateStyle: "medium" }).format(new Date())})
              </option>
              <option value="el">
                Ελληνικά ({new Intl.DateTimeFormat(localeForLanguage("el"), { dateStyle: "medium" }).format(new Date())}
                )
              </option>
              <option value="de">
                Deutsch ({new Intl.DateTimeFormat(localeForLanguage("de"), { dateStyle: "medium" }).format(new Date())})
              </option>
              <option value="fr">
                Français ({new Intl.DateTimeFormat(localeForLanguage("fr"), { dateStyle: "medium" }).format(new Date())}
                )
              </option>
              <option value="es">
                Español ({new Intl.DateTimeFormat(localeForLanguage("es"), { dateStyle: "medium" }).format(new Date())})
              </option>
              <option value="it">
                Italiano ({new Intl.DateTimeFormat(localeForLanguage("it"), { dateStyle: "medium" }).format(new Date())}
                )
              </option>
              <option value="pt">
                Português (
                {new Intl.DateTimeFormat(localeForLanguage("pt"), { dateStyle: "medium" }).format(new Date())})
              </option>
            </select>
            <small>Month names and the order of day, month and year.</small>
          </label>
          <label style={settingsLabelStyle}>
            Time format
            <select
              value={accountPreferences.timeFormat}
              onChange={(event) => {
                const timeFormat = event.target.value as TimeFormatPreference;
                setActiveTimeFormatPreference(timeFormat);
                setAccountPreferences((current) => ({ ...current, timeFormat }));
              }}
              style={selectStyle}
            >
              <option value="system">System default</option>
              <option value="12h">12-hour</option>
              <option value="24h">24-hour</option>
            </select>
            <small>Message times update immediately and follow this preference.</small>
          </label>
        </div>
        <div className="dc-time-preview">
          Preview ·{" "}
          {new Intl.DateTimeFormat(localeForLanguage(accountPreferences.language), {
            hour: "2-digit",
            minute: "2-digit",
            ...(accountPreferences.timeFormat === "12h"
              ? { hour12: true }
              : accountPreferences.timeFormat === "24h"
                ? { hour12: false }
                : {}),
          }).format(new Date())}
        </div>
      </div>
    </>
  );
}
