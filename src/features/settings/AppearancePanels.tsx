import type { ExtraSettings, MessageDensity, MotionPreference } from "./extraSettings";

type SkinOption = { id: string; label: string };

type ThemeProps = {
  value: ExtraSettings;
  skins: readonly SkinOption[];
  prefersDark: boolean;
  onChange: (next: ExtraSettings) => void;
};

/** Settings → Appearance: keep one skin, or follow the computer's light/dark mode. */
export function ThemeModePanel({ value, skins, prefersDark, onChange }: ThemeProps) {
  const system = value.themeMode === "system";
  return (
    <div className="dcs-card">
      <div className="dcs-segmented" role="radiogroup" aria-label="Theme">
        <button
          type="button"
          role="radio"
          aria-checked={!system}
          className={!system ? "is-active" : ""}
          onClick={() => onChange({ ...value, themeMode: "manual" })}
        >
          <strong>Pick a skin</strong>
          <small>Always use the skin you choose above</small>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={system}
          className={system ? "is-active" : ""}
          onClick={() => onChange({ ...value, themeMode: "system" })}
        >
          <strong>Match my computer</strong>
          <small>Switch between a light and a dark skin automatically</small>
        </button>
      </div>
      {system && (
        <div className="dcs-inline-fields">
          <label className="dcs-field">
            <span>Light mode skin</span>
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
            <span>Dark mode skin</span>
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
          <p className="dcs-muted">Your computer is in {prefersDark ? "dark" : "light"} mode right now.</p>
        </div>
      )}
    </div>
  );
}

type A11yProps = {
  value: ExtraSettings;
  systemReducedMotion: boolean;
  onChange: (next: ExtraSettings) => void;
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
  return (
    <label className={`settings-toggle-row${checked ? " enabled" : " disabled"}`}>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span className="settings-toggle-control">
        <em>{checked ? "ON" : "OFF"}</em>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      </span>
    </label>
  );
}

/** Settings → Appearance: motion, density and readability options. */
export function ReadabilityPanel({ value, systemReducedMotion, onChange }: A11yProps) {
  const motion: Array<[MotionPreference, string, string]> = [
    [
      "system",
      "Match my computer",
      systemReducedMotion ? "Your computer asks for less motion" : "Your computer allows animations",
    ],
    ["reduce", "Reduce motion", "Turn off animations and smooth scrolling"],
    ["full", "Full motion", "Keep every animation"],
  ];
  const density: Array<[MessageDensity, string, string]> = [
    ["cozy", "Cozy", "Roomy messages with large avatars"],
    ["compact", "Compact", "Fit more messages on screen"],
  ];
  return (
    <div className="dcs-card">
      <div className="dcs-field">
        <span>Motion</span>
        <div className="dcs-segmented dcs-segmented-3" role="radiogroup" aria-label="Motion">
          {motion.map(([id, label, detail]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={value.motion === id}
              className={value.motion === id ? "is-active" : ""}
              onClick={() => onChange({ ...value, motion: id })}
            >
              <strong>{label}</strong>
              <small>{detail}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="dcs-field">
        <span>Message density</span>
        <div className="dcs-segmented" role="radiogroup" aria-label="Message density">
          {density.map(([id, label, detail]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={value.density === id}
              className={value.density === id ? "is-active" : ""}
              onClick={() => onChange({ ...value, density: id })}
            >
              <strong>{label}</strong>
              <small>{detail}</small>
            </button>
          ))}
        </div>
      </div>
      <Toggle
        label="High contrast"
        detail="Stronger borders, brighter secondary text and clearer focus rings."
        checked={value.highContrast}
        onChange={(highContrast) => onChange({ ...value, highContrast })}
      />
      <Toggle
        label="Always underline links"
        detail="Make links in messages easy to spot without relying on colour."
        checked={value.underlineLinks}
        onChange={(underlineLinks) => onChange({ ...value, underlineLinks })}
      />
      <Toggle
        label="Show image descriptions"
        detail="Show the title of GIFs and stickers under them."
        checked={value.showAltText}
        onChange={(showAltText) => onChange({ ...value, showAltText })}
      />
    </div>
  );
}
