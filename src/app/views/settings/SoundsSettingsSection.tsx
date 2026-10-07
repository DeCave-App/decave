import type { SoundVariant, UiSoundEvent } from "../../types";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../inline-styles";
import type { PreferencesState } from "../../state/preferences";

type Props = {
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  preferences: PreferencesState;
};

export function SoundsSettingsSection({ playUiSound, preferences }: Props) {
  const { soundSettings, setSoundSettings } = preferences;
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>SOUNDS</div>
        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <strong style={{ color: "var(--ds-text)", fontSize: "13px" }}>Sound theme</strong>
            <div style={{ color: "var(--ds-muted)", fontSize: "12px", marginTop: "3px" }}>
              Choose how DeCave interface sounds feel. Off disables interface sounds without changing desktop
              notifications.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "9px" }}>
            {(
              [
                ["off", "Off", "Silent interface"],
                ["soft", "Soft", "Subtle & clean"],
                ["pulse", "Pulse", "Modern & energetic"],
                ["arcade", "Arcade", "Retro gaming"],
              ] as const
            ).map(([theme, label, copy]) => (
              <button
                key={theme}
                type="button"
                onClick={() => setSoundSettings((current) => ({ ...current, theme }))}
                style={{
                  minHeight: "82px",
                  padding: "12px",
                  borderRadius: "12px",
                  border:
                    soundSettings.theme === theme
                      ? "1px solid color-mix(in srgb, var(--ds-accent) 72%, transparent)"
                      : "1px solid color-mix(in srgb, var(--ds-border) 18%, transparent)",
                  background:
                    soundSettings.theme === theme
                      ? "linear-gradient(145deg,rgba(87,65,233,.22),rgba(17,28,49,.82))"
                      : "rgba(8,15,28,.58)",
                  color: "var(--ds-text)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "block", fontSize: "18px", marginBottom: "8px" }}>
                  {theme === "off" ? "∅" : theme === "soft" ? "◔" : theme === "pulse" ? "◉" : "▦"}
                </span>
                <strong style={{ display: "block", fontSize: "12px" }}>{label}</strong>
                <small style={{ color: "var(--ds-muted)", fontSize: "12px" }}>{copy}</small>
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gap: "7px" }}>
            {(
              [
                ["send", "Message sent", "When you send a message"],
                ["receive", "Message received", "Incoming DMs and room messages"],
                ["voiceJoin", "Voice joined", "Someone joins voice"],
                ["voiceLeave", "Voice left", "Someone leaves voice"],
                ["friendRequest", "Friend request", "New friend request"],
                ["mention", "Mention", "When someone mentions you"],
                ["mute", "Mute", "Microphone muted"],
                ["unmute", "Unmute", "Microphone unmuted"],
                ["deafen", "Deafen", "Incoming voice audio disabled"],
                ["undeafen", "Undeafen", "Incoming voice audio restored"],
                ["screenShare", "Screen sharing", "Start or stop screen sharing"],
              ] as const
            ).map(([event, label, copy]) => (
              <div key={event} className={`settings-toggle-row${soundSettings[event] ? " enabled" : " disabled"}`}>
                <span>
                  <strong>{label}</strong>
                  <small>{copy}</small>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" }}>
                  <select
                    aria-label={`${label} sound`}
                    value={soundSettings.variants?.[event] ?? "default"}
                    disabled={soundSettings.theme === "off"}
                    onChange={(changeEvent) =>
                      setSoundSettings((current) => ({
                        ...current,
                        variants: { ...current.variants, [event]: changeEvent.target.value as SoundVariant },
                      }))
                    }
                    style={{
                      height: "30px",
                      minWidth: "82px",
                      padding: "0 7px",
                      borderRadius: "7px",
                      border: "1px solid color-mix(in srgb, var(--ds-border) 22%, transparent)",
                      background: "var(--ds-surface-2)",
                      color: "var(--ds-text)",
                      fontSize: "12px",
                      outline: "none",
                    }}
                  >
                    <option value="default">Default</option>
                    <option value="bright">Bright</option>
                    <option value="deep">Deep</option>
                    <option value="digital">Digital</option>
                    <option value="glass">Glass</option>
                    <option value="warm">Warm</option>
                    <option value="chime">Chime</option>
                    <option value="minimal">Minimal</option>
                  </select>
                  <button
                    type="button"
                    className="modal-secondary"
                    style={{ minHeight: "30px", padding: "0 9px", fontSize: "12px" }}
                    disabled={soundSettings.theme === "off"}
                    onClick={() => playUiSound(event, true)}
                  >
                    Preview
                  </button>
                  <span className="settings-toggle-control">
                    <em>{soundSettings[event] ? "ON" : "OFF"}</em>
                    <input
                      type="checkbox"
                      aria-label={`Enable ${label} sound`}
                      checked={soundSettings[event]}
                      onChange={(changeEvent) =>
                        setSoundSettings((current) => ({ ...current, [event]: changeEvent.target.checked }))
                      }
                    />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
