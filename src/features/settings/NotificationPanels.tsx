import type { QuietHours } from "./extraSettings";
import { isWithinQuietHours } from "./extraSettings";
import { FieldError } from "./SettingsControls";
import type { SettingField } from "./useSettingField";
import { useSettingsT } from "./useSettingsT";

/** Settings → Notifications & sounds: a daily window with no pop-ups or sounds. */
export function QuietHoursPanel({ field }: { field: SettingField<QuietHours> }) {
  const { t } = useSettingsT();
  const value = field.value;
  const active = isWithinQuietHours(value);
  const set = (patch: Partial<QuietHours>) => field.set({ ...value, ...patch });
  return (
    <div className="dcs-card" data-settings-anchor="quiet-hours">
      <label className={`settings-toggle-row${value.enabled ? " enabled" : " disabled"}`}>
        <span>
          <strong>{t("settings.notifications.quiet.title")}</strong>
          <small>
            {value.enabled
              ? active
                ? t("settings.notifications.quiet.now")
                : t("settings.notifications.quiet.daily", { start: value.start, end: value.end })
              : t("settings.notifications.quiet.help")}
          </small>
          <FieldError field={field} />
        </span>
        <span className="settings-toggle-control">
          <em>{value.enabled ? t("settings.field.on") : t("settings.field.off")}</em>
          <input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        </span>
      </label>
      {value.enabled && (
        <div className="dcs-inline-fields">
          <label className="dcs-field">
            <span>{t("settings.notifications.quiet.from")}</span>
            <input
              className="dcx-input"
              type="time"
              value={value.start}
              onChange={(event) => event.target.value && set({ start: event.target.value })}
            />
          </label>
          <label className="dcs-field">
            <span>{t("settings.notifications.quiet.until")}</span>
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
            <span>{t("settings.notifications.quiet.allowMentions")}</span>
          </label>
        </div>
      )}
    </div>
  );
}
