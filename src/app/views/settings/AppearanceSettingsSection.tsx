import { ThemeModePanel, ReadabilityPanel } from "../../../features/settings";
import type { AppSkin } from "../../types";
import { APP_SKIN_OPTIONS } from "../../settings-storage";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../inline-styles";
import type { PreferencesState } from "../../state/preferences";

type Props = {
  prefersDark: boolean;
  systemReducedMotion: boolean;
  chooseAppSkin: (skin: AppSkin) => void;
  preferences: PreferencesState;
};

export function AppearanceSettingsSection({ prefersDark, systemReducedMotion, chooseAppSkin, preferences }: Props) {
  const { appSkin, extraSettings, setExtraSettings, accessibilityTextScale, setAccessibilityTextScale } = preferences;
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>SKIN</div>
        {extraSettings.themeMode === "system" && (
          <p className="dcs-section-note">
            You're matching your computer's light and dark mode. Choose the two skins under Light &amp; dark below; the
            skin you pick here is used if you switch back.
          </p>
        )}
        <div className="vadrion-appearance-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <button
            type="button"
            className={appSkin === "nebula" ? "appearance-card active nebula" : "appearance-card nebula"}
            onClick={() => chooseAppSkin("nebula")}
          >
            <span className="appearance-preview" />
            <strong>Nebula Pulse</strong>
            <small>Electric violet · cyan glow</small>
          </button>
          <button
            type="button"
            className={appSkin === "arctic" ? "appearance-card active arctic" : "appearance-card arctic"}
            onClick={() => chooseAppSkin("arctic")}
          >
            <span className="appearance-preview" />
            <strong>Arctic Flux</strong>
            <small>Frosted blue · graphite</small>
          </button>
          <button
            type="button"
            className={appSkin === "crimson" ? "appearance-card active crimson" : "appearance-card crimson"}
            onClick={() => chooseAppSkin("crimson")}
          >
            <span className="appearance-preview" />
            <strong>Crimson Glass</strong>
            <small>Deep red · polished smoked glass</small>
          </button>
          <button
            type="button"
            className={appSkin === "royal" ? "appearance-card active royal" : "appearance-card royal"}
            onClick={() => chooseAppSkin("royal")}
          >
            <span className="appearance-preview" />
            <strong>Royal Violet</strong>
            <small>Rich purple · luminous glass</small>
          </button>
          <button
            type="button"
            className={appSkin === "pearl" ? "appearance-card active pearl" : "appearance-card pearl"}
            onClick={() => chooseAppSkin("pearl")}
          >
            <span className="appearance-preview" />
            <strong>Pearl Glass</strong>
            <small>White silver · smoked crystal</small>
          </button>
          <button
            type="button"
            className={appSkin === "obsidian" ? "appearance-card active obsidian" : "appearance-card obsidian"}
            onClick={() => chooseAppSkin("obsidian")}
          >
            <span className="appearance-preview" />
            <strong>Obsidian Glass</strong>
            <small>Pure black · gunmetal glass</small>
          </button>
          <button
            type="button"
            className={appSkin === "verdant" ? "appearance-card active verdant" : "appearance-card verdant"}
            onClick={() => chooseAppSkin("verdant")}
          >
            <span className="appearance-preview" />
            <strong>Verdant Raid</strong>
            <small>Emerald green · tactical glass</small>
          </button>
          <button
            type="button"
            className={appSkin === "bright" ? "appearance-card active bright" : "appearance-card bright"}
            onClick={() => chooseAppSkin("bright")}
          >
            <span className="appearance-preview" />
            <strong>Bright Grey</strong>
            <small>Bright grey · clean high-contrast light</small>
          </button>
        </div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>LIGHT & DARK</div>
        <ThemeModePanel
          value={extraSettings}
          skins={APP_SKIN_OPTIONS}
          prefersDark={prefersDark}
          onChange={setExtraSettings}
        />
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>ACCESSIBILITY</div>
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
              <strong style={{ color: "var(--ds-text)" }}>Text & interface size</strong>
              <div style={{ color: "var(--ds-muted)", fontSize: "12px", marginTop: "3px" }}>
                Increase or reduce DeCave text, controls, panels, and interface spacing together.
              </div>
            </div>
            <strong style={{ color: "var(--ds-accent-2)", minWidth: "52px", textAlign: "right" }}>
              {accessibilityTextScale}%
            </strong>
          </div>

          <input
            type="range"
            min="80"
            max="140"
            step="5"
            value={accessibilityTextScale}
            onChange={(event) => setAccessibilityTextScale(Number(event.target.value))}
            aria-label="DeCave text and interface size"
          />

          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="modal-secondary" onClick={() => setAccessibilityTextScale(85)}>
              Smaller
            </button>
            <button type="button" className="modal-secondary" onClick={() => setAccessibilityTextScale(100)}>
              Default
            </button>
            <button type="button" className="modal-secondary" onClick={() => setAccessibilityTextScale(120)}>
              Larger
            </button>
            <button type="button" className="modal-secondary" onClick={() => setAccessibilityTextScale(140)}>
              Extra Large
            </button>
          </div>

          <div
            style={{
              borderRadius: "10px",
              padding: "10px 12px",
              background: "color-mix(in srgb, var(--ds-accent-2) 6%, transparent)",
              border: "1px solid color-mix(in srgb, var(--ds-accent-2) 14%, transparent)",
              color: "var(--ds-text)",
            }}
          >
            Preview: The quick brown fox jumps over the lazy dog.
          </div>
        </div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>MOTION & READABILITY</div>
        <ReadabilityPanel value={extraSettings} systemReducedMotion={systemReducedMotion} onChange={setExtraSettings} />
      </div>
    </>
  );
}
