// Settings → Notifications & sounds: one preset, desktop notifications and the
// per-type switches, message previews, quiet hours, the sound theme with
// per-event sounds, and every muted Hub and room in one list.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import type { NotificationSettings, SoundSettings, SoundTheme, SoundVariant, UiSoundEvent } from "../../../app/types";
import type { NotificationPreview } from "../../../privacy/notification-preview";
import { CLIENT_PLATFORM } from "../../../app/env";
import { localeForLanguage } from "../../../app/locale";
import { hasDesktopActivityBridge, requestDesktopNotifications } from "../../../app/desktop";
import { platformLabel } from "../useSettingsT";
import { MutedPlacesList } from "../MutedPlacesList";
import { QuietHoursPanel } from "../NotificationPanels";
import { FieldError, SettingsSection, ToggleRow } from "../SettingsControls";
import { SLIDER_DEBOUNCE_MS, useStateField } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";

type Preset = "all" | "mentions" | "quiet";
type Alerts = { preset: Preset; notifications: NotificationSettings; sounds: SoundSettings };

const PRESETS: Preset[] = ["all", "mentions", "quiet"];
const NOTIFICATION_KINDS = ["friendRequests", "dms", "groups", "mentions"] as const;
const PREVIEWS: NotificationPreview[] = ["full", "sender", "hidden"];
const THEMES: [SoundTheme, string][] = [
  ["off", "∅"],
  ["soft", "◔"],
  ["pulse", "◉"],
  ["arcade", "▦"],
];
const SOUND_EVENTS: UiSoundEvent[] = [
  "send",
  "receive",
  "voiceJoin",
  "voiceLeave",
  "friendRequest",
  "mention",
  "mute",
  "unmute",
  "deafen",
  "undeafen",
  "screenShare",
];
const VARIANTS: SoundVariant[] = ["default", "bright", "deep", "digital", "glass", "warm", "chime", "minimal"];

/** What each preset turns on. The sound theme stays; only alert sounds follow the preset. */
export function applyPreset(preset: Preset, current: Alerts): Alerts {
  const on = preset === "all";
  const mentions = preset === "mentions";
  return {
    preset,
    notifications: {
      ...current.notifications,
      desktop: preset !== "quiet",
      sounds: true,
      voiceEvents: true,
      friendRequests: on,
      dms: on || mentions,
      groups: on,
      mentions: on || mentions,
    },
    sounds: {
      ...current.sounds,
      receive: on || mentions,
      mention: on || mentions,
      friendRequest: on,
      voiceJoin: on,
      voiceLeave: on,
    },
  };
}

export function NotificationsSoundsTab(props: SettingsWindowProps) {
  const { t, tk } = useSettingsT();
  const { preferences, servers, playUiSound } = props;
  const {
    notificationPreset,
    setNotificationPreset,
    notificationSettings,
    setNotificationSettings,
    soundSettings,
    setSoundSettings,
    privacySettings,
    setPrivacySettings,
    extraSettings,
    setExtraSettings,
  } = preferences;
  const synced = ["account", "device"] as const;

  const alerts = useStateField<Alerts>(
    "notifications.preset",
    { preset: notificationPreset, notifications: notificationSettings, sounds: soundSettings },
    (next) => {
      setNotificationPreset(next.preset);
      setNotificationSettings(next.notifications);
      setSoundSettings(next.sounds);
    },
    synced,
  );
  const notifications = useStateField("notifications.kinds", notificationSettings, setNotificationSettings, synced);
  const toggle = (key: keyof NotificationSettings) => ({
    ...notifications,
    value: notifications.value[key],
    set: (next: boolean) => notifications.set({ ...notifications.value, [key]: next }),
  });
  const sounds = useStateField("notifications.sounds", soundSettings, setSoundSettings, synced);
  const previews = useStateField(
    "notifications.previews",
    privacySettings.notificationPreview,
    (next: NotificationPreview) => setPrivacySettings((current) => ({ ...current, notificationPreview: next })),
    synced,
  );
  const quietHours = useStateField(
    "notifications.quietHours",
    extraSettings.quietHours,
    (next: typeof extraSettings.quietHours) => setExtraSettings((current) => ({ ...current, quietHours: next })),
    synced,
    { debounceMs: SLIDER_DEBOUNCE_MS },
  );
  const permissionNeeded = typeof Notification !== "undefined" && Notification.permission !== "granted";

  return (
    <>
      <SettingsSection anchor="notification-preset" title={t("settings.notifications.title")}>
        <div className="dc-notification-presets">
          <div>
            <strong>{t("settings.notifications.preset")}</strong>
            <small>{t("settings.notifications.presetHelp")}</small>
          </div>
          {PRESETS.map((value) => (
            <button
              type="button"
              key={value}
              className={alerts.value.preset === value ? "active" : ""}
              onClick={() => alerts.set(applyPreset(value, alerts.value))}
            >
              {tk(`settings.notifications.presets.${value}`)}
            </button>
          ))}
        </div>
        <FieldError field={alerts} />
        <div className="dcs-section-gap" />
        <ToggleRow
          anchor="desktop-notifications"
          field={toggle("desktop")}
          label={t("settings.notifications.desktop")}
          description={t("settings.notifications.desktopHelp")}
        />
        {NOTIFICATION_KINDS.map((key) => (
          <ToggleRow key={key} field={toggle(key)} label={tk(`settings.notifications.kinds.${key}`)} />
        ))}
        {permissionNeeded && notificationSettings.desktop && (
          <div className="dc-notification-permission">
            <span>
              <strong>
                {hasDesktopActivityBridge()
                  ? t("settings.notifications.permissionDesktop", { platform: platformLabel(CLIENT_PLATFORM, tk) })
                  : t("settings.notifications.permissionBrowser")}
              </strong>
              <small>
                {hasDesktopActivityBridge()
                  ? t("settings.notifications.permissionDesktopHelp", { platform: platformLabel(CLIENT_PLATFORM, tk) })
                  : t("settings.notifications.permissionBrowserHelp")}
              </small>
            </span>
            <button type="button" className="modal-secondary" onClick={() => void requestDesktopNotifications()}>
              {t("settings.notifications.requestPermission")}
            </button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection anchor="message-previews" title={t("settings.notifications.previewsTitle")}>
        <div style={{ color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.55, marginBottom: "12px" }}>
          {t("settings.notifications.previewsHelp")}
        </div>
        <div
          className="dcs-segmented dcs-segmented-3"
          role="radiogroup"
          aria-label={t("settings.notifications.previewsTitle")}
        >
          {PREVIEWS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={previews.value === value}
              className={previews.value === value ? "is-active" : ""}
              onClick={() => previews.set(value)}
            >
              <strong>{tk(`settings.notifications.previews.${value}.label`)}</strong>
              <small>{tk(`settings.notifications.previews.${value}.detail`)}</small>
            </button>
          ))}
        </div>
        <FieldError field={previews} />
      </SettingsSection>

      <SettingsSection title={t("settings.notifications.quiet.sectionTitle")}>
        <QuietHoursPanel field={quietHours} />
      </SettingsSection>

      <SettingsSection anchor="sound-theme" title={t("settings.notifications.soundsTitle")}>
        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <strong style={{ color: "var(--ds-text)", fontSize: "13px" }}>{t("settings.notifications.theme")}</strong>
            <div style={{ color: "var(--ds-muted)", fontSize: "12px", marginTop: "3px" }}>
              {t("settings.notifications.themeHelp")}
            </div>
          </div>
          <div
            className="dcs-sound-themes"
            style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "9px" }}
          >
            {THEMES.map(([theme, glyph]) => (
              <button
                key={theme}
                type="button"
                aria-pressed={sounds.value.theme === theme}
                onClick={() => sounds.set({ ...sounds.value, theme })}
                style={{
                  minHeight: "82px",
                  padding: "12px",
                  borderRadius: "12px",
                  border:
                    sounds.value.theme === theme
                      ? "1px solid color-mix(in srgb, var(--ds-accent) 72%, transparent)"
                      : "1px solid color-mix(in srgb, var(--ds-border) 18%, transparent)",
                  background:
                    sounds.value.theme === theme
                      ? "linear-gradient(145deg,rgba(87,65,233,.22),rgba(17,28,49,.82))"
                      : "rgba(8,15,28,.58)",
                  color: "var(--ds-text)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "block", fontSize: "18px", marginBottom: "8px" }} aria-hidden="true">
                  {glyph}
                </span>
                <strong style={{ display: "block", fontSize: "12px" }}>
                  {tk(`settings.notifications.themes.${theme}.label`)}
                </strong>
                <small style={{ color: "var(--ds-muted)", fontSize: "12px" }}>
                  {tk(`settings.notifications.themes.${theme}.detail`)}
                </small>
              </button>
            ))}
          </div>
          <FieldError field={sounds} />
          <div style={{ display: "grid", gap: "7px" }}>
            {SOUND_EVENTS.map((event) => {
              const label = tk(`settings.notifications.events.${event}.label`);
              return (
                <div key={event} className={`settings-toggle-row${sounds.value[event] ? " enabled" : " disabled"}`}>
                  <span>
                    <strong>{label}</strong>
                    <small>{tk(`settings.notifications.events.${event}.detail`)}</small>
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" }}>
                    <select
                      aria-label={t("settings.notifications.soundFor", { event: label })}
                      value={sounds.value.variants?.[event] ?? "default"}
                      disabled={sounds.value.theme === "off"}
                      onChange={(change) =>
                        sounds.set({
                          ...sounds.value,
                          variants: { ...sounds.value.variants, [event]: change.target.value as SoundVariant },
                        })
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
                      {VARIANTS.map((variant) => (
                        <option key={variant} value={variant}>
                          {tk(`settings.notifications.variants.${variant}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="modal-secondary"
                      style={{ minHeight: "30px", padding: "0 9px", fontSize: "12px" }}
                      disabled={sounds.value.theme === "off"}
                      onClick={() => playUiSound(event, true)}
                    >
                      {t("settings.notifications.preview")}
                    </button>
                    <span className="settings-toggle-control">
                      <em>{sounds.value[event] ? t("settings.field.on") : t("settings.field.off")}</em>
                      <input
                        type="checkbox"
                        aria-label={t("settings.notifications.enableSound", { event: label })}
                        checked={sounds.value[event]}
                        onChange={(change) => sounds.set({ ...sounds.value, [event]: change.target.checked })}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.notifications.placesTitle")}>
        <MutedPlacesList
          servers={servers}
          preferences={preferences}
          formatDateTime={(ms) =>
            new Date(ms).toLocaleString(localeForLanguage(), { dateStyle: "medium", timeStyle: "short" })
          }
        />
      </SettingsSection>
    </>
  );
}
