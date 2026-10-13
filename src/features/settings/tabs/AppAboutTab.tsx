// Settings → App & about: start with the computer, minimize to tray, desktop
// updates, help (report a bug, contact support), what's new, version and
// platform. Desktop-only options are hidden on web.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import { CLIENT_PLATFORM } from "../../../app/env";
import { formatUpdateBytes } from "../../../app/format";
import { hasDesktopActivityBridge, openDesktopExternalUrl } from "../../../app/desktop";
import { DesktopOnlyNote } from "../SettingsChrome";
import { SettingsSection, ToggleRow } from "../SettingsControls";
import { SupportPanel } from "../SupportPanel";
import { useStateField } from "../useSettingField";
import { platformLabel, useSettingsT } from "../useSettingsT";

export function AppAboutTab(props: SettingsWindowProps) {
  const { t, tk } = useSettingsT();
  const desktop = hasDesktopActivityBridge();
  const { preferences, desktopUpdates, currentUser, servers, desktopInstalledVersion } = props;
  const { desktopSystemSettings, setDesktopSystemSettingsState } = preferences;
  const {
    desktopUpdateState,
    desktopUpdateAction,
    desktopUpdateNotice,
    handleCheckDesktopForUpdates,
    handleRestartDesktopToUpdate,
    desktopUpdateStatusCopy,
  } = desktopUpdates;
  const platform = platformLabel(CLIENT_PLATFORM, tk);
  const mac = CLIENT_PLATFORM === "mac";

  const startup = useStateField(
    "app.openAtLogin",
    desktopSystemSettings.openAtLogin,
    (next: boolean) => setDesktopSystemSettingsState((current) => ({ ...current, openAtLogin: next })),
    ["desktop"],
  );
  const tray = useStateField(
    "app.closeToTray",
    desktopSystemSettings.closeToTray,
    (next: boolean) => setDesktopSystemSettingsState((current) => ({ ...current, closeToTray: next })),
    ["desktop"],
  );

  const patchNotes = (() => {
    const hub = servers.find((server) => server.channels.some((channel) => channel.name === "patch-notes"));
    const room = hub?.channels.find((channel) => channel.name === "patch-notes");
    if (!hub || !room) return null;
    return () => {
      props.settingsActions.finishCloseSettings();
      props.changeServer(hub.id);
      props.changeChannel(room.id);
      props.setShowHubHome(false);
    };
  })();

  return (
    <>
      {desktop && (
        <SettingsSection title={t("settings.app.systemTitle")}>
          <div className="dc-settings-stack">
            <ToggleRow
              anchor="startup"
              field={startup}
              label={t("settings.app.startup", { platform })}
              description={t("settings.app.startupHelp", { platform })}
            />
            <ToggleRow
              anchor="tray"
              field={tray}
              label={mac ? t("settings.app.trayMac") : t("settings.app.tray")}
              description={mac ? t("settings.app.trayMacHelp") : t("settings.app.trayHelp")}
            />
          </div>
        </SettingsSection>
      )}

      {desktop && (
        <SettingsSection anchor="updates" title={t("settings.app.updatesTitle")}>
          <div className="dc-desktop-update-card" data-update-surface="settings">
            <div className="dc-desktop-update-copy">
              <strong>{t("settings.app.updates")}</strong>
              <span className="dc-desktop-installed-version" data-installed-version={desktopInstalledVersion}>
                <span>{t("settings.app.installedVersion")}</span>
                <strong>{desktopInstalledVersion}</strong>
              </span>
              <small className="dc-desktop-update-status" aria-live="polite">
                {desktopUpdateStatusCopy}
              </small>
              {desktopUpdateState?.status === "downloading" && desktopUpdateState.percent !== null && (
                <span
                  className="dc-update-progress"
                  aria-label={t("settings.app.downloadPercent", { percent: Math.round(desktopUpdateState.percent) })}
                >
                  <i style={{ width: `${desktopUpdateState.percent}%` }} />
                </span>
              )}
              {desktopUpdateState?.status === "downloading" &&
                desktopUpdateState.transferred !== null &&
                desktopUpdateState.total !== null && (
                  <small>
                    {desktopUpdateState.bytesPerSecond
                      ? t("settings.app.progressSpeed", {
                          done: formatUpdateBytes(desktopUpdateState.transferred),
                          total: formatUpdateBytes(desktopUpdateState.total),
                          speed: formatUpdateBytes(desktopUpdateState.bytesPerSecond),
                        })
                      : t("settings.app.progress", {
                          done: formatUpdateBytes(desktopUpdateState.transferred),
                          total: formatUpdateBytes(desktopUpdateState.total),
                        })}
                  </small>
                )}
            </div>
            <div className="dc-desktop-update-actions">
              <button
                type="button"
                className="modal-secondary"
                disabled={
                  Boolean(desktopUpdateAction) || ["checking", "downloading"].includes(desktopUpdateState?.status ?? "")
                }
                onClick={handleCheckDesktopForUpdates}
              >
                {desktopUpdateAction === "checking" ? t("settings.app.checking") : t("settings.app.checkNow")}
              </button>
              {desktopUpdateState?.status === "downloaded" && (
                <button
                  type="button"
                  className="modal-primary"
                  disabled={desktopUpdateAction === "restarting"}
                  onClick={handleRestartDesktopToUpdate}
                >
                  {desktopUpdateAction === "restarting" ? t("settings.app.restarting") : t("settings.app.restart")}
                </button>
              )}
            </div>
            {desktopUpdateNotice && (
              <div className="dc-desktop-update-notice" role="alert">
                {desktopUpdateNotice}
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      <SettingsSection title={t("settings.app.helpTitle")}>
        <SupportPanel
          appName={desktop ? "DeCave Desktop" : "DeCave Web"}
          version={desktopInstalledVersion}
          platform={platform}
          username={currentUser.username}
          canOpenMail={!desktop}
          openExternal={desktop ? (url) => void openDesktopExternalUrl(url).catch(() => undefined) : null}
          onOpenPatchNotes={patchNotes}
        />
      </SettingsSection>

      {!desktop && <DesktopOnlyNote />}
    </>
  );
}
