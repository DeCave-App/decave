// Settings > Keybinds.

import type { Dispatch, SetStateAction } from "react";
import { ShortcutsPanel } from "../../../features/settings";
import type { DesktopKeybindSettings, AudioSettings } from "../../types";
import { CLIENT_PLATFORM } from "../../env";
import { acceleratorFromKeyEvent, friendlyAccelerator } from "../../format";
import { hasDesktopActivityBridge } from "../../desktop";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../inline-styles";
import type { PreferencesState } from "../../state/preferences";

type Props = {
  keybindCapture: keyof DesktopKeybindSettings | null;
  setKeybindCapture: Dispatch<SetStateAction<keyof DesktopKeybindSettings | null>>;
  audioSettings: AudioSettings;
  preferences: PreferencesState;
};

export function KeybindsSettingsSection({ keybindCapture, setKeybindCapture, audioSettings, preferences }: Props) {
  const { desktopKeybinds, setDesktopKeybindsState } = preferences;
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>GLOBAL KEYBINDS</div>
        <p className="dc-settings-copy">
          {hasDesktopActivityBridge()
            ? "These shortcuts work even while a game has focus. Use at least one modifier key such as Ctrl, Alt or Shift."
            : "Global shortcuts need the DeCave desktop app, because a browser tab can't hear keys while a game has focus."}
        </p>
        <div className="dc-keybind-list">
          {(
            [
              ["toggleMute", "Toggle mute / unmute", "Mute or restore your microphone."],
              ["toggleDeafen", "Toggle deafen / undeafen", "Mute incoming voice and your microphone together."],
            ] as const
          ).map(([key, label, detail]) => (
            <label className="dc-keybind-row" key={key}>
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
              <input
                readOnly
                disabled={!hasDesktopActivityBridge()}
                value={keybindCapture === key ? "Press shortcut…" : friendlyAccelerator(desktopKeybinds[key])}
                onFocus={() => setKeybindCapture(key)}
                onBlur={() => setKeybindCapture((current) => (current === key ? null : current))}
                onKeyDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    setKeybindCapture(null);
                    event.currentTarget.blur();
                    return;
                  }
                  const accelerator = acceleratorFromKeyEvent(event);
                  if (!accelerator) return;
                  setDesktopKeybindsState((current) => ({ ...current, [key]: accelerator }));
                  setKeybindCapture(null);
                  event.currentTarget.blur();
                }}
              />
            </label>
          ))}
          <div className="dc-keybind-actions">
            <span>Click a shortcut, then press the new key combination.</span>
            <button
              type="button"
              className="modal-secondary"
              onClick={() =>
                setDesktopKeybindsState({
                  toggleMute: "CommandOrControl+Shift+M",
                  toggleDeafen: "CommandOrControl+Shift+D",
                })
              }
            >
              Reset defaults
            </button>
          </div>
          {desktopKeybinds.toggleMute === desktopKeybinds.toggleDeafen && (
            <div className="settings-audio-error">These actions cannot use the same shortcut.</div>
          )}
        </div>
      </div>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>ALL SHORTCUTS</div>
        <ShortcutsPanel
          mod={CLIENT_PLATFORM === "mac" ? "Cmd" : "Ctrl"}
          pushToTalkKey={audioSettings.pushToTalk ? audioSettings.pushToTalkKey.replace(/^(Key|Digit)/, "") : null}
          muteShortcut={friendlyAccelerator(desktopKeybinds.toggleMute)}
          deafenShortcut={friendlyAccelerator(desktopKeybinds.toggleDeafen)}
        />
      </div>
    </>
  );
}
