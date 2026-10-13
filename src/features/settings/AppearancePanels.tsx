import type { ExtraSettings, MessageDensity, MotionPreference } from "./extraSettings";
import { FieldError } from "./SettingsControls";
import type { SettingField } from "./useSettingField";
import { useSettingsT } from "./useSettingsT";

type SkinOption = { id: string; label: string };

type ThemeProps = {
  field: SettingField<ExtraSettings>;
  skins: readonly SkinOption[];
  prefersDark: boolean;
};

/** Settings → Appearance & accessibility: keep one skin, or follow the computer's light/dark mode. */
export function ThemeModePanel({ field, skins, prefersDark }: ThemeProps) {
  const { t } = useSettingsT();
  const value = field.value;
  const onChange = field.set;
  const system = value.themeMode === "system";
  return (
    <div className="dcs-card">
      <div className="dcs-segmented" role="radiogroup" aria-label={t("settings.appearance.theme.label")}>
        <button
          type="button"
          role="radio"
          aria-checked={!system}
          className={!system ? "is-active" : ""}
          onClick={() => onChange({ ...value, themeMode: "manual" })}
        >
          <strong>{t("settings.appearance.theme.manual")}</strong>
          <small>{t("settings.appearance.theme.manualHelp")}</small>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={system}
          className={system ? "is-active" : ""}
          onClick={() => onChange({ ...value, themeMode: "system" })}
        >
          <strong>{t("settings.appearance.theme.system")}</strong>
          <small>{t("settings.appearance.theme.systemHelp")}</small>
        </button>
      </div>
      {system && (
        <div className="dcs-inline-fields">
          <label className="dcs-field">
            <span>{t("settings.appearance.theme.lightSkin")}</span>
            <select
              className="dcx-input"
              value={value.lightSkin}
              onChange={(event) => onChange({ ...value, lightSkin: event.target.value })}
            >
              {skins.map((skin) => (
                <option key={skin.id} value={skin.id}>
                  {skin.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dcs-field">
            <span>{t("settings.appearance.theme.darkSkin")}</span>
            <select
              className="dcx-input"
              value={value.darkSkin}
              onChange={(event) => onChange({ ...value, darkSkin: event.target.value })}
            >
              {skins.map((skin) => (
                <option key={skin.id} value={skin.id}>
                  {skin.label}
                </option>
              ))}
            </select>
          </label>
          <p className="dcs-muted">
            {prefersDark ? t("settings.appearance.theme.nowDark") : t("settings.appearance.theme.nowLight")}
          </p>
        </div>
      )}
      <FieldError field={field} />
    </div>
  );
}

type A11yProps = {
  field: SettingField<ExtraSettings>;
  systemReducedMotion: boolean;
};

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useSettingsT();
  return (
    <label className={`settings-toggle-row${checked ? " enabled" : " disabled"}`}>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span className="settings-toggle-control">
        <em>{checked ? t("settings.field.on") : t("settings.field.off")}</em>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      </span>
    </label>
  );
}

const MOTIONS: MotionPreference[] = ["system", "reduce", "full"];
const DENSITIES: MessageDensity[] = ["cozy", "compact"];

/** Settings → Appearance & accessibility: motion, density and readability options. */
export function ReadabilityPanel({ field, systemReducedMotion }: A11yProps) {
  const { t, tk } = useSettingsT();
  const value = field.value;
  const onChange = field.set;
  const motionDetail = (id: MotionPreference) =>
    id === "system"
      ? systemReducedMotion
        ? t("settings.appearance.motion.systemReduced")
        : t("settings.appearance.motion.systemFull")
      : tk(`settings.appearance.motion.${id}.detail`);
  return (
    <div className="dcs-card">
      <div className="dcs-field">
        <span>{t("settings.appearance.motion.label")}</span>
        <div
          className="dcs-segmented dcs-segmented-3"
          role="radiogroup"
          aria-label={t("settings.appearance.motion.label")}
        >
          {MOTIONS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={value.motion === id}
              className={value.motion === id ? "is-active" : ""}
              onClick={() => onChange({ ...value, motion: id })}
            >
              <strong>{tk(`settings.appearance.motion.${id}.label`)}</strong>
              <small>{motionDetail(id)}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="dcs-field">
        <span>{t("settings.appearance.density.label")}</span>
        <div className="dcs-segmented" role="radiogroup" aria-label={t("settings.appearance.density.label")}>
          {DENSITIES.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={value.density === id}
              className={value.density === id ? "is-active" : ""}
              onClick={() => onChange({ ...value, density: id })}
            >
              <strong>{tk(`settings.appearance.density.${id}.label`)}</strong>
              <small>{tk(`settings.appearance.density.${id}.detail`)}</small>
            </button>
          ))}
        </div>
      </div>
      <Toggle
        label={t("settings.appearance.contrast")}
        detail={t("settings.appearance.contrastHelp")}
        checked={value.highContrast}
        onChange={(highContrast) => onChange({ ...value, highContrast })}
      />
      <Toggle
        label={t("settings.appearance.underline")}
        detail={t("settings.appearance.underlineHelp")}
        checked={value.underlineLinks}
        onChange={(underlineLinks) => onChange({ ...value, underlineLinks })}
      />
      <Toggle
        label={t("settings.appearance.altText")}
        detail={t("settings.appearance.altTextHelp")}
        checked={value.showAltText}
        onChange={(showAltText) => onChange({ ...value, showAltText })}
      />
      <FieldError field={field} />
    </div>
  );
}
