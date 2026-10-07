import { platformName } from "../../../features/settings";
import { CLIENT_PLATFORM } from "../../env";
import { formatUpdateBytes } from "../../format";
import { hasDesktopActivityBridge } from "../../desktop";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../inline-styles";
import type { PreferencesState } from "../../state/preferences";
import type { DesktopUpdates } from "../../hooks/useDesktopUpdates";

type Props = {
  desktopUpdates: DesktopUpdates;
  preferences: PreferencesState;
};

export function SystemSettingsSection({ desktopUpdates, preferences }: Props) {
  const {
    desktopUpdateState,
    desktopUpdateAction,
    desktopUpdateNotice,
    handleCheckDesktopForUpdates,
    handleRestartDesktopToUpdate,
    desktopInstalledVersion,
    desktopUpdateStatusCopy,
  } = desktopUpdates;
  const { desktopSystemSettings, setDesktopSystemSettingsState } = preferences;
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>SYSTEM</div>
        <div className="dc-settings-stack">
          {!hasDesktopActivityBridge() && (
            <div className="settings-audio-notice">
              These options are available in the DeCave desktop app for Windows and macOS.
            </div>
          )}
          <label className={`settings-toggle-row${desktopSystemSettings.openAtLogin ? " enabled" : " disabled"}`}>
            <span>
              <strong>Start DeCave when {platformName(CLIENT_PLATFORM)} starts</strong>
              <small>Open DeCave automatically after you sign in to {platformName(CLIENT_PLATFORM)}.</small>
            </span>
            <span className="settings-toggle-control">
              <em>{desktopSystemSettings.openAtLogin ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                disabled={!hasDesktopActivityBridge()}
                checked={desktopSystemSettings.openAtLogin}
                onChange={(event) =>
                  setDesktopSystemSettingsState((current) => ({ ...current, openAtLogin: event.target.checked }))
                }
              />
            </span>
          </label>
          <label className={`settings-toggle-row${desktopSystemSettings.closeToTray ? " enabled" : " disabled"}`}>
            <span>
              <strong>
                {CLIENT_PLATFORM === "mac"
                  ? "Keep running in the menu bar when closed"
                  : "Minimize to system tray when closing"}
              </strong>
              <small>
                {CLIENT_PLATFORM === "mac"
                  ? "Closing the window hides DeCave. Use the menu bar icon to reopen or quit."
                  : "Clicking X hides DeCave. Use the tray menu to reopen or fully quit."}
              </small>
            </span>
            <span className="settings-toggle-control">
              <em>{desktopSystemSettings.closeToTray ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                disabled={!hasDesktopActivityBridge()}
                checked={desktopSystemSettings.closeToTray}
                onChange={(event) =>
                  setDesktopSystemSettingsState((current) => ({ ...current, closeToTray: event.target.checked }))
                }
              />
            </span>
          </label>
          <label
            className={`settings-toggle-row${desktopSystemSettings.voiceOverlayEnabled ? " enabled" : " disabled"}`}
          >
            <span>
              <strong>In-game voice overlay</strong>
              <small>Show compact voice avatars over games and highlight the active speaker.</small>
            </span>
            <span className="settings-toggle-control">
              <em>{desktopSystemSettings.voiceOverlayEnabled ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                disabled={!hasDesktopActivityBridge()}
                checked={desktopSystemSettings.voiceOverlayEnabled}
                onChange={(event) =>
                  setDesktopSystemSettingsState((current) => ({
                    ...current,
                    voiceOverlayEnabled: event.target.checked,
                  }))
                }
              />
            </span>
          </label>
          {desktopSystemSettings.voiceOverlayEnabled && (
            <div className="dcs-card dcs-overlay-size">
              <div className="dcs-card-row">
                <div className="dcs-card-copy">
                  <strong>Overlay size</strong>
                  <small>
                    {desktopSystemSettings.voiceOverlayScale === undefined
                      ? hasDesktopActivityBridge()
                        ? "Update the DeCave desktop app to change the size and get the new compact overlay."
                        : "Available in the DeCave desktop app."
                      : "How big the voice tags are over your game. The preview shows roughly how they look."}
                  </small>
                </div>
                <b className="dcs-overlay-size-value">{desktopSystemSettings.voiceOverlayScale ?? 100}%</b>
              </div>
              <input
                type="range"
                className="settings-range"
                min="60"
                max="150"
                step="5"
                disabled={desktopSystemSettings.voiceOverlayScale === undefined}
                value={desktopSystemSettings.voiceOverlayScale ?? 100}
                aria-label="Overlay size"
                onChange={(event) =>
                  setDesktopSystemSettingsState((current) => ({
                    ...current,
                    voiceOverlayScale: Number(event.target.value),
                  }))
                }
              />
              <div
                className="dcs-overlay-preview"
                aria-hidden="true"
                style={{ ["--s" as string]: String((desktopSystemSettings.voiceOverlayScale ?? 100) / 100) }}
              >
                <span className="dcs-ov-head">
                  <i />
                  Squad voice · 3
                </span>
                <span className="dcs-ov-pill is-speaking">
                  <b style={{ background: "#7c6cff" }}>D</b>DeCaveDev
                </span>
                <span className="dcs-ov-pill">
                  <b style={{ background: "#2f9e8f" }}>E</b>Epilepsy66
                </span>
                <span className="dcs-ov-pill">
                  <b style={{ background: "#e85d75" }}>T</b>TheBlindBard
                  <svg viewBox="0 0 24 24">
                    <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11 5.7M12 18v3M4 4l16 16" />
                  </svg>
                </span>
              </div>
            </div>
          )}
          <div className="dc-desktop-update-card" data-update-surface="settings">
            <div className="dc-desktop-update-copy">
              <strong>Desktop app updates</strong>
              <span className="dc-desktop-installed-version" data-installed-version={desktopInstalledVersion}>
                <span>Installed version</span>
                <strong>{desktopInstalledVersion}</strong>
              </span>
              <small className="dc-desktop-update-status" aria-live="polite">
                {desktopUpdateStatusCopy}
              </small>
              {desktopUpdateState?.status === "downloading" && desktopUpdateState.percent !== null && (
                <span
                  className="dc-update-progress"
                  aria-label={`Update download ${Math.round(desktopUpdateState.percent)} percent`}
                >
                  <i style={{ width: `${desktopUpdateState.percent}%` }} />
                </span>
              )}
              {desktopUpdateState?.status === "downloading" &&
                desktopUpdateState.transferred !== null &&
                desktopUpdateState.total !== null && (
                  <small>
                    {formatUpdateBytes(desktopUpdateState.transferred)} of {formatUpdateBytes(desktopUpdateState.total)}
                    {desktopUpdateState.bytesPerSecond
                      ? ` · ${formatUpdateBytes(desktopUpdateState.bytesPerSecond)}/s`
                      : ""}
                  </small>
                )}
            </div>
            <div className="dc-desktop-update-actions">
              <button
                type="button"
                className="modal-secondary"
                disabled={
                  !hasDesktopActivityBridge() ||
                  Boolean(desktopUpdateAction) ||
                  ["checking", "downloading"].includes(desktopUpdateState?.status ?? "")
                }
                onClick={handleCheckDesktopForUpdates}
              >
                {desktopUpdateAction === "checking" ? "Checking…" : "Check now"}
              </button>
              {desktopUpdateState?.status === "downloaded" && (
                <button
                  type="button"
                  className="modal-primary"
                  disabled={desktopUpdateAction === "restarting"}
                  onClick={handleRestartDesktopToUpdate}
                >
                  {desktopUpdateAction === "restarting" ? "Restarting…" : "Restart to update"}
                </button>
              )}
            </div>
            {desktopUpdateNotice && (
              <div className="dc-desktop-update-notice" role="alert">
                {desktopUpdateNotice}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
