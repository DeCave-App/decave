// Settings → Appearance & accessibility: skin, light and dark, text and
// interface size, motion, message density, contrast, links and image descriptions.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import type { AppSkin } from "../../../app/types";
import { APP_SKIN_OPTIONS } from "../../../app/settings-storage";
import { ReadabilityPanel, ThemeModePanel } from "../AppearancePanels";
import { FieldError, SettingsSection } from "../SettingsControls";
import { SLIDER_DEBOUNCE_MS, useStateField } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";

const SIZE_PRESETS: [number, string][] = [
  [85, "settings.appearance.size.smaller"],
  [100, "settings.appearance.size.default"],
  [120, "settings.appearance.size.larger"],
  [140, "settings.appearance.size.extraLarge"],
];

export function AppearanceTab(props: SettingsWindowProps) {
  const { t, tk } = useSettingsT();
  const { preferences, prefersDark, systemReducedMotion, chooseAppSkin } = props;
  const { appSkin, extraSettings, setExtraSettings, accessibilityTextScale, setAccessibilityTextScale } = preferences;
  const synced = ["account", "device"] as const;
  const skin = useStateField("appearance.skin", appSkin, (next: AppSkin) => chooseAppSkin(next), synced);
  const extra = useStateField("appearance.extra", extraSettings, setExtraSettings, synced);
  const textScale = useStateField("appearance.textScale", accessibilityTextScale, setAccessibilityTextScale, synced, {
    debounceMs: SLIDER_DEBOUNCE_MS,
  });
  const skinName = (id: string) => tk(`settings.appearance.skins.${id}.name`);
  const skins = APP_SKIN_OPTIONS.map((option) => ({ id: option.id, label: skinName(option.id) }));

  return (
    <>
      <SettingsSection anchor="skin" title={t("settings.appearance.skinTitle")}>
        {extraSettings.themeMode === "system" && (
          <p className="dcs-section-note">{t("settings.appearance.skinSystemNote")}</p>
        )}
        <div className="vadrion-appearance-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          {APP_SKIN_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={skin.value === option.id}
              className={`appearance-card ${option.id}${skin.value === option.id ? " active" : ""}`}
              onClick={() => skin.set(option.id)}
            >
              <span className="appearance-preview" />
              <strong>{skinName(option.id)}</strong>
              <small>{tk(`settings.appearance.skins.${option.id}.detail`)}</small>
            </button>
          ))}
        </div>
        <FieldError field={skin} />
      </SettingsSection>

      <SettingsSection anchor="theme-mode" title={t("settings.appearance.themeTitle")}>
        <ThemeModePanel field={extra} skins={skins} prefersDark={prefersDark} />
      </SettingsSection>

      <SettingsSection anchor="text-size" title={t("settings.appearance.accessibilityTitle")}>
        <div
          style={{
            display: "grid",
            gap: "12px",
            padding: "14px",
            border: "1px solid color-mix(in srgb, var(--ds-border) 22%, transparent)",
            borderRadius: "12px",
            background: "var(--ds-surface-2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
            <div>
              <strong style={{ color: "var(--ds-text)" }}>{t("settings.appearance.size.title")}</strong>
              <div style={{ color: "var(--ds-muted)", fontSize: "12px", marginTop: "3px" }}>
                {t("settings.appearance.size.help")}
              </div>
            </div>
            <strong style={{ color: "var(--ds-accent-2)", minWidth: "52px", textAlign: "right" }}>
              {textScale.value}%
            </strong>
          </div>
          <input
            type="range"
            min="80"
            max="140"
            step="5"
            value={textScale.value}
            onChange={(event) => textScale.set(Number(event.target.value))}
            aria-label={t("settings.appearance.size.label")}
          />
          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
            {SIZE_PRESETS.map(([value, key]) => (
              <button key={value} type="button" className="modal-secondary" onClick={() => textScale.set(value)}>
                {tk(key)}
              </button>
            ))}
          </div>
          <FieldError field={textScale} />
          <div
            style={{
              borderRadius: "10px",
              padding: "10px 12px",
              background: "color-mix(in srgb, var(--ds-accent-2) 6%, transparent)",
              border: "1px solid color-mix(in srgb, var(--ds-accent-2) 14%, transparent)",
              color: "var(--ds-text)",
            }}
          >
            {t("settings.appearance.size.preview")}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection anchor="readability" title={t("settings.appearance.readabilityTitle")}>
        <ReadabilityPanel field={extra} systemReducedMotion={systemReducedMotion} />
      </SettingsSection>
    </>
  );
}
