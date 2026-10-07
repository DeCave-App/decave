import type { QuietHours } from "./extraSettings";
import { isWithinQuietHours } from "./extraSettings";

type QuietProps = {
  value: QuietHours;
  onChange: (next: QuietHours) => void;
};

/** Settings → Notifications: a daily window with no pop-ups or sounds. */
export function QuietHoursPanel({ value, onChange }: QuietProps) {
  const active = isWithinQuietHours(value);
  const set = (patch: Partial<QuietHours>) => onChange({ ...value, ...patch });
  return (
    <div className="dcs-card">
      <label className={`settings-toggle-row${value.enabled ? " enabled" : " disabled"}`}>
        <span>
          <strong>Quiet hours</strong>
          <small>
            {value.enabled
              ? active
                ? "Quiet now. Notifications and alert sounds are paused."
                : `Every day from ${value.start} to ${value.end}.`
              : "Pause notifications and alert sounds at the same time every day."}
          </small>
        </span>
        <span className="settings-toggle-control">
          <em>{value.enabled ? "ON" : "OFF"}</em>
          <input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        </span>
      </label>
      {value.enabled && (
        <div className="dcs-inline-fields">
          <label className="dcs-field">
            <span>From</span>
            <input
              className="dcx-input"
              type="time"
              value={value.start}
              onChange={(event) => event.target.value && set({ start: event.target.value })}
            />
          </label>
          <label className="dcs-field">
            <span>Until</span>
            <input
              className="dcx-input"
              type="time"
              value={value.end}
              onChange={(event) => event.target.value && set({ end: event.target.value })}
            />
          </label>
          <label className="dcs-check">
            <input
              type="checkbox"
              checked={value.allowMentions}
              onChange={(event) => set({ allowMentions: event.target.checked })}
            />
            <span>Still notify me about direct messages and mentions</span>
          </label>
        </div>
      )}
    </div>
  );
}

export type MutedHub = { id: number; name: string; icon?: string; until: number | null };

type MutedProps = {
  hubs: readonly MutedHub[];
  onUnmute: (hubId: number) => void;
  formatDateTime: (ms: number) => string;
};

/** Settings → Notifications: every muted Hub in one place. */
export function MutedHubsPanel({ hubs, onUnmute, formatDateTime }: MutedProps) {
  return (
    <div className="dcs-card">
      <div className="dcs-card-copy">
        <strong>Muted Hubs{hubs.length ? ` · ${hubs.length}` : ""}</strong>
        <small>Muted Hubs don't send notifications or sounds. You can still open them and read.</small>
      </div>
      {hubs.length === 0 ? (
        <p className="dcs-muted">
          No Hubs are muted. Right-click a Hub in the top bar, or use the bell on Hub Home, to mute one.
        </p>
      ) : (
        <ul className="dcs-list">
          {hubs.map((hub) => (
            <li key={hub.id} className="dcs-list-row">
              <span className="dcs-initial" aria-hidden="true">
                {hub.icon && hub.icon.length <= 3 ? hub.icon : hub.name.charAt(0).toUpperCase()}
              </span>
              <span className="dcs-list-copy">
                <strong>{hub.name}</strong>
                <small>
                  {hub.until ? `Muted until ${formatDateTime(hub.until)}` : "Muted until you turn it back on"}
                </small>
              </span>
              <button type="button" className="modal-secondary" onClick={() => onUnmute(hub.id)}>
                Unmute
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
