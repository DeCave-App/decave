import { useState } from "react";
import {
  hubNotifyLevel,
  roomNotifyOverride,
  withHubLevel,
  withRoomLevel,
  type NotifyLevel,
  type NotifyLevels,
  type RoomNotifyLevel,
} from "./notifyLevels";

export type NotifyHub = {
  id: number;
  name: string;
  icon?: string;
  muted: boolean;
  rooms: Array<{ id: number; name: string; type: string }>;
};

type Props = {
  hubs: readonly NotifyHub[];
  levels: NotifyLevels;
  onChange: (next: NotifyLevels) => void;
};

const HUB_LEVELS: Array<[NotifyLevel, string]> = [
  ["all", "All messages"],
  ["mentions", "Mentions only"],
  ["nothing", "Nothing"],
];
const LEVEL_LABEL: Record<NotifyLevel, string> = { all: "All messages", mentions: "Mentions only", nothing: "Nothing" };

/** Settings → Notifications: choose how loud each Hub, and each room in it, is. */
export function HubNotificationsPanel({ hubs, levels, onChange }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="dcs-card">
      <div className="dcs-card-copy">
        <strong>Hubs and rooms</strong>
        <small>
          All messages: a notification for every new message. Mentions only: when someone writes @you or @everyone.
          Nothing: no sounds or pop-ups. Unread badges always show.
        </small>
      </div>
      {hubs.length === 0 ? (
        <p className="dcs-muted">Join a Hub to choose its notifications.</p>
      ) : (
        <ul className="dcs-list">
          {hubs.map((hub) => {
            const level = hubNotifyLevel(levels, hub.id);
            const exceptions = hub.rooms.filter((room) => roomNotifyOverride(levels, room.id) !== "default").length;
            const expanded = open === hub.id;
            const textRooms = hub.rooms.filter((room) => room.type !== "voice");
            return (
              <li key={hub.id} className="dcs-notify-hub">
                <div className="dcs-list-row">
                  <span className="dcs-initial" aria-hidden="true">
                    {hub.icon && hub.icon.length <= 3 ? hub.icon : hub.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="dcs-list-copy">
                    <strong>{hub.name}</strong>
                    <small>
                      {hub.muted
                        ? "Muted right now, so nothing until you unmute it"
                        : exceptions
                          ? `${exceptions} room${exceptions === 1 ? "" : "s"} set differently`
                          : LEVEL_LABEL[level]}
                    </small>
                  </span>
                  <label className="dcs-inline-select">
                    <span className="dcx-sr-only">Notifications for {hub.name}</span>
                    <select
                      className="dcx-input"
                      value={level}
                      onChange={(event) => onChange(withHubLevel(levels, hub.id, event.target.value as NotifyLevel))}
                    >
                      {HUB_LEVELS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {textRooms.length > 0 && (
                  <button
                    type="button"
                    className="dcs-disclosure"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : hub.id)}
                  >
                    {expanded ? "Hide rooms" : `Set rooms differently (${textRooms.length})`}
                  </button>
                )}
                {expanded && (
                  <ul className="dcs-room-levels">
                    {textRooms.map((room) => (
                      <li key={room.id}>
                        <span>#{room.name}</span>
                        <select
                          className="dcx-input"
                          aria-label={`Notifications for #${room.name}`}
                          value={roomNotifyOverride(levels, room.id)}
                          onChange={(event) =>
                            onChange(withRoomLevel(levels, room.id, event.target.value as RoomNotifyLevel))
                          }
                        >
                          <option value="default">Same as Hub ({LEVEL_LABEL[level]})</option>
                          {HUB_LEVELS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
