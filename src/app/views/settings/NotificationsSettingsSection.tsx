import { QuietHoursPanel, MutedHubsPanel, platformName, HubNotificationsPanel } from "../../../features/settings";
import type { Server } from "../../types";
import { CLIENT_PLATFORM } from "../../env";
import { localeForLanguage, preferredTimeOptions } from "../../locale";
import { hasDesktopActivityBridge } from "../../desktop";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../inline-styles";
import type { PreferencesState } from "../../state/preferences";

type Props = {
  servers: Server[];
  requestDesktopNotifications: () => Promise<void>;
  currentServer: Server;
  preferences: PreferencesState;
};

export function NotificationsSettingsSection({
  servers,
  requestDesktopNotifications,
  currentServer,
  preferences,
}: Props) {
  const {
    extraSettings,
    setExtraSettings,
    notificationSettings,
    setNotificationSettings,
    notifyLevels,
    setNotifyLevels,
    mutedHubIds,
    setMutedHubIds,
    notificationPreset,
    setNotificationPreset,
    hubMuteSchedule,
    setHubMuteSchedule,
  } = preferences;
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>NOTIFICATIONS</div>
        {(
          [
            ["desktop", "Desktop notifications"],
            ["sounds", "Notification sounds"],
            ["friendRequests", "Friend requests"],
            ["dms", "Private messages"],
            ["groups", "Group messages"],
            ["mentions", "Mentions"],
            ["voiceEvents", "Voice join / leave sounds"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className={`settings-toggle-row${notificationSettings[key] ? " enabled" : " disabled"}`}>
            <span>
              <strong>{label}</strong>
            </span>
            <span className="settings-toggle-control">
              <em>{notificationSettings[key] ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                checked={notificationSettings[key]}
                onChange={(event) =>
                  setNotificationSettings((current) => ({ ...current, [key]: event.target.checked }))
                }
              />
            </span>
          </label>
        ))}
        <div className="dc-notification-presets">
          <div>
            <strong>Notification preset</strong>
            <small>Apply a sensible baseline, then customize individual switches above.</small>
          </div>
          {(
            [
              ["all", "All activity"],
              ["mentions", "Mentions only"],
              ["quiet", "Quiet"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={notificationPreset === value ? "active" : ""}
              onClick={() => {
                setNotificationPreset(value);
                setNotificationSettings((current) =>
                  value === "all"
                    ? {
                        ...current,
                        desktop: true,
                        sounds: true,
                        friendRequests: true,
                        dms: true,
                        groups: true,
                        mentions: true,
                        voiceEvents: true,
                      }
                    : value === "mentions"
                      ? {
                          ...current,
                          desktop: true,
                          sounds: true,
                          friendRequests: false,
                          dms: true,
                          groups: false,
                          mentions: true,
                          voiceEvents: false,
                        }
                      : {
                          ...current,
                          desktop: false,
                          sounds: false,
                          friendRequests: false,
                          dms: false,
                          groups: false,
                          mentions: false,
                          voiceEvents: false,
                        },
                );
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="dc-hub-mute-schedule">
          <span>
            <strong>Mute {currentServer.name}</strong>
            <small>Pause notifications for this Hub without changing other Hubs.</small>
          </span>
          <select
            value={
              hubMuteSchedule[currentServer.id] === -1
                ? "always"
                : (hubMuteSchedule[currentServer.id] ?? 0) > Date.now()
                  ? "scheduled"
                  : "off"
            }
            onChange={(event) => {
              const mode = event.target.value;
              const now = Date.now();
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(9, 0, 0, 0);
              const until =
                mode === "1h"
                  ? now + 3600000
                  : mode === "8h"
                    ? now + 28800000
                    : mode === "tomorrow"
                      ? tomorrow.getTime()
                      : mode === "always"
                        ? -1
                        : 0;
              setHubMuteSchedule((current) => {
                const next = { ...current };
                if (until) next[currentServer.id] = until;
                else delete next[currentServer.id];
                return next;
              });
              setMutedHubIds((current) =>
                until
                  ? Array.from(new Set([...current, currentServer.id]))
                  : current.filter((id) => id !== currentServer.id),
              );
            }}
          >
            <option value="off">Not muted</option>
            {(hubMuteSchedule[currentServer.id] ?? 0) > Date.now() && hubMuteSchedule[currentServer.id] !== -1 && (
              <option value="scheduled">
                Muted until{" "}
                {new Date(hubMuteSchedule[currentServer.id]).toLocaleString(
                  localeForLanguage(),
                  preferredTimeOptions(),
                )}
              </option>
            )}
            <option value="1h">For 1 hour</option>
            <option value="8h">For 8 hours</option>
            <option value="tomorrow">Until tomorrow</option>
            <option value="always">Until I turn it back on</option>
          </select>
        </label>
        <div className="dcs-section-gap" />
        <QuietHoursPanel
          value={extraSettings.quietHours}
          onChange={(quietHours) => setExtraSettings((current) => ({ ...current, quietHours }))}
        />
        <MutedHubsPanel
          hubs={servers
            .filter((server) => mutedHubIds.includes(server.id))
            .map((server) => ({
              id: server.id,
              name: server.name,
              icon: server.icon,
              until: (hubMuteSchedule[server.id] ?? 0) > Date.now() ? hubMuteSchedule[server.id] : null,
            }))}
          onUnmute={(hubId) => {
            setMutedHubIds((current) => current.filter((id) => id !== hubId));
            setHubMuteSchedule((current) => {
              const next = { ...current };
              delete next[hubId];
              return next;
            });
          }}
          formatDateTime={(ms) =>
            new Date(ms).toLocaleString(localeForLanguage(), { dateStyle: "medium", timeStyle: "short" })
          }
        />
        <HubNotificationsPanel
          hubs={servers.map((server) => ({
            id: server.id,
            name: server.name,
            icon: server.icon,
            muted: mutedHubIds.includes(server.id),
            rooms: server.channels.map((channel) => ({ id: channel.id, name: channel.name, type: channel.type })),
          }))}
          levels={notifyLevels}
          onChange={setNotifyLevels}
        />
        {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
          <div className="dc-notification-permission">
            <span>
              <strong>
                {hasDesktopActivityBridge()
                  ? `${platformName(CLIENT_PLATFORM)} permission required`
                  : "Browser permission required"}
              </strong>
              <small>
                {hasDesktopActivityBridge()
                  ? `Allow DeCave notifications in ${platformName(CLIENT_PLATFORM)} settings to get alerts while DeCave is in the background.`
                  : "Allow notifications for app.de-cave.com in your browser to get alerts while this tab is in the background."}
              </small>
            </span>
            <button type="button" className="modal-secondary" onClick={() => void requestDesktopNotifications()}>
              Open permission request
            </button>
          </div>
        )}
      </div>
    </>
  );
}
