// Settings → Notifications & sounds → Muted Hubs and rooms: every muted Hub
// and room in one list with Unmute and its notification level, then the other
// Hubs, where each Hub and room can be set to All messages, Mentions only or
// Nothing.

import { useState } from "react";
import type { Server } from "../../app/types";
import type { PreferencesState } from "../../app/state/preferences";
import {
  hubNotifyLevel,
  roomNotifyOverride,
  withHubLevel,
  withRoomLevel,
  type NotifyLevel,
  type NotifyLevels,
  type RoomNotifyLevel,
} from "./notifyLevels";
import { FieldError } from "./SettingsControls";
import { useSettingField, useStateField } from "./useSettingField";
import { useSettingsT } from "./useSettingsT";

const LEVELS: NotifyLevel[] = ["all", "mentions", "nothing"];

type HubMutes = { ids: number[]; schedule: Record<string, number> };

type Props = {
  servers: readonly Server[];
  preferences: PreferencesState;
  formatDateTime: (ms: number) => string;
};

function hubInitial(server: Pick<Server, "icon" | "name">): string {
  return server.icon && server.icon.length <= 3 ? server.icon : server.name.charAt(0).toUpperCase();
}

export function MutedPlacesList({ servers, preferences, formatDateTime }: Props) {
  const { t, tk } = useSettingsT();
  const [open, setOpen] = useState<number | null>(null);
  const { notifyLevels, setNotifyLevels, mutedHubIds, setMutedHubIds, hubMuteSchedule, setHubMuteSchedule } =
    preferences;
  const levels = useStateField("notifications.levels", notifyLevels, setNotifyLevels, ["account", "device"]);
  // Hub mutes are saved and synced by the app as soon as they change (useHubMutes).
  const mutes = useSettingField<HubMutes>(
    "notifications.hubMutes",
    () => ({ ids: mutedHubIds, schedule: hubMuteSchedule }),
    async () => undefined,
    {
      apply: (next) => {
        setMutedHubIds(next.ids);
        setHubMuteSchedule(next.schedule);
      },
    },
  );
  const setLevels = (next: NotifyLevels) => levels.set(next);
  const levelLabel = (level: NotifyLevel) => tk(`settings.notifications.levels.${level}`);

  const now = Date.now();
  const mutedHubs = servers.filter((server) => mutes.value.ids.includes(server.id));
  const mutedRooms = servers.flatMap((server) =>
    server.channels
      .filter((room) => room.type !== "voice" && levels.value.rooms[String(room.id)] === "nothing")
      .map((room) => ({ hub: server, room })),
  );
  const otherHubs = servers.filter((server) => !mutes.value.ids.includes(server.id));

  const unmuteHub = (hubId: number) => {
    const schedule = { ...mutes.value.schedule };
    delete schedule[String(hubId)];
    mutes.set({ ids: mutes.value.ids.filter((id) => id !== hubId), schedule });
  };

  const hubLevelSelect = (server: Server) => (
    <label className="dcs-inline-select">
      <span className="dcx-sr-only">{t("settings.notifications.levelFor", { name: server.name })}</span>
      <select
        className="dcx-input"
        value={hubNotifyLevel(levels.value, server.id)}
        onChange={(event) => setLevels(withHubLevel(levels.value, server.id, event.target.value as NotifyLevel))}
      >
        {LEVELS.map((value) => (
          <option key={value} value={value}>
            {levelLabel(value)}
          </option>
        ))}
      </select>
    </label>
  );

  const roomLevelSelect = (server: Server, room: { id: number; name: string }) => (
    <select
      className="dcx-input"
      aria-label={t("settings.notifications.levelForRoom", { name: room.name })}
      value={roomNotifyOverride(levels.value, room.id)}
      onChange={(event) => setLevels(withRoomLevel(levels.value, room.id, event.target.value as RoomNotifyLevel))}
    >
      <option value="default">
        {t("settings.notifications.sameAsHub", { level: levelLabel(hubNotifyLevel(levels.value, server.id)) })}
      </option>
      {LEVELS.map((value) => (
        <option key={value} value={value}>
          {levelLabel(value)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="dcs-card" data-settings-anchor="muted-places">
      <div className="dcs-card-copy">
        <strong>
          {mutedHubs.length + mutedRooms.length
            ? t("settings.notifications.mutedCount", { count: mutedHubs.length + mutedRooms.length })
            : t("settings.notifications.mutedTitle")}
        </strong>
        <small>{t("settings.notifications.mutedHelp")}</small>
      </div>
      <FieldError field={levels} />
      <FieldError field={mutes} />
      {mutedHubs.length + mutedRooms.length === 0 ? (
        <p className="dcs-muted">{t("settings.notifications.noneMuted")}</p>
      ) : (
        <ul className="dcs-list">
          {mutedHubs.map((server) => {
            const until = mutes.value.schedule[String(server.id)];
            return (
              <li key={`hub-${server.id}`} className="dcs-list-row">
                <span className="dcs-initial" aria-hidden="true">
                  {hubInitial(server)}
                </span>
                <span className="dcs-list-copy">
                  <strong>{server.name}</strong>
                  <small>
                    {until && until > now
                      ? t("settings.notifications.mutedUntil", { when: formatDateTime(until) })
                      : t("settings.notifications.mutedForever")}
                  </small>
                </span>
                {hubLevelSelect(server)}
                <button type="button" className="modal-secondary" onClick={() => unmuteHub(server.id)}>
                  {t("settings.notifications.unmute")}
                </button>
              </li>
            );
          })}
          {mutedRooms.map(({ hub, room }) => (
            <li key={`room-${room.id}`} className="dcs-list-row">
              <span className="dcs-initial" aria-hidden="true">
                #
              </span>
              <span className="dcs-list-copy">
                <strong>#{room.name}</strong>
                <small>{t("settings.notifications.roomIn", { hub: hub.name })}</small>
              </span>
              {roomLevelSelect(hub, room)}
              <button
                type="button"
                className="modal-secondary"
                onClick={() => setLevels(withRoomLevel(levels.value, room.id, "default"))}
              >
                {t("settings.notifications.unmute")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {otherHubs.length > 0 && (
        <details className="dcs-other-hubs">
          <summary>{t("settings.notifications.otherHubs", { count: otherHubs.length })}</summary>
          <p className="dcs-muted">{t("settings.notifications.levelsHelp")}</p>
          <ul className="dcs-list">
            {otherHubs.map((server) => {
              const textRooms = server.channels.filter((room) => room.type !== "voice");
              const exceptions = textRooms.filter((room) => roomNotifyOverride(levels.value, room.id) !== "default");
              const expanded = open === server.id;
              return (
                <li key={server.id} className="dcs-notify-hub">
                  <div className="dcs-list-row">
                    <span className="dcs-initial" aria-hidden="true">
                      {hubInitial(server)}
                    </span>
                    <span className="dcs-list-copy">
                      <strong>{server.name}</strong>
                      <small>
                        {exceptions.length
                          ? t("settings.notifications.roomsDifferent", { count: exceptions.length })
                          : levelLabel(hubNotifyLevel(levels.value, server.id))}
                      </small>
                    </span>
                    {hubLevelSelect(server)}
                  </div>
                  {textRooms.length > 0 && (
                    <button
                      type="button"
                      className="dcs-disclosure"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : server.id)}
                    >
                      {expanded
                        ? t("settings.notifications.hideRooms")
                        : t("settings.notifications.showRooms", { count: textRooms.length })}
                    </button>
                  )}
                  {expanded && (
                    <ul className="dcs-room-levels">
                      {textRooms.map((room) => (
                        <li key={room.id}>
                          <span>#{room.name}</span>
                          {roomLevelSelect(server, room)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
