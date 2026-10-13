// Settings → Gaming & overlay: who can see your game, automatic activity and
// excluded games, the in-game overlay, keybinds (including push to talk) and
// every shortcut. Desktop-only parts are hidden on web.

import { useState, type KeyboardEvent } from "react";
import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import type { AccountPreferences, ActivitySettings, DesktopKeybindSettings } from "../../../app/types";
import { CLIENT_PLATFORM } from "../../../app/env";
import { acceleratorFromKeyEvent, formatActivityElapsed, friendlyAccelerator } from "../../../app/format";
import { hasDesktopActivityBridge } from "../../../app/desktop";
import { settingsLabelStyle } from "../../../app/inline-styles";
import { ShortcutsPanel } from "../ShortcutsPanel";
import { DesktopOnlyNote } from "../SettingsChrome";
import { FieldError, SettingsSection, ToggleRow } from "../SettingsControls";
import { SLIDER_DEBOUNCE_MS, useSettingField, useStateField, useTextDraft } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";

export const DEFAULT_DESKTOP_KEYBINDS: DesktopKeybindSettings = {
  toggleMute: "CommandOrControl+Shift+M",
  toggleDeafen: "CommandOrControl+Shift+D",
};

const VISIBILITY: AccountPreferences["activityVisibility"][] = ["everyone", "friends", "nobody"];
const OVERLAY_SAMPLE = [
  { name: "DeCaveDev", color: "#7c6cff", speaking: true },
  { name: "Epilepsy66", color: "#2f9e8f" },
  { name: "TheBlindBard", color: "#e85d75", muted: true },
];

/** "KeyV" → "V", "Digit4" → "4", "Space" stays. */
export function pushToTalkLabel(code: string): string {
  return code.replace(/^(Key|Digit)/, "");
}

export function GamingOverlayTab(props: SettingsWindowProps) {
  const { t, tk } = useSettingsT();
  const desktop = hasDesktopActivityBridge();
  const {
    currentUser,
    preferences,
    gameActivity,
    automaticActivityElapsed,
    currentGameIcon,
    keybindCapture,
    setKeybindCapture,
    audioSettings,
    audioSettingsRef,
    saveAudioSettings,
  } = props;
  const {
    accountPreferences,
    setAccountPreferences,
    activitySettings,
    setActivitySettings,
    desktopSystemSettings,
    setDesktopSystemSettingsState,
    desktopKeybinds,
    setDesktopKeybindsState,
  } = preferences;
  const { activityState, detectedDesktopGame, activityNow } = gameActivity;

  const visibility = useStateField(
    "gaming.activityVisibility",
    accountPreferences.activityVisibility,
    (next: AccountPreferences["activityVisibility"]) =>
      setAccountPreferences((current) => ({ ...current, activityVisibility: next })),
    ["account"],
  );
  const activityField = <K extends keyof ActivitySettings>(key: K) =>
    [
      `gaming.${key}`,
      activitySettings[key],
      (next: ActivitySettings[K]) => setActivitySettings((current) => ({ ...current, [key]: next })),
      ["device"],
    ] as const;
  const publishAutomatic = useStateField(...activityField("publishAutomatic"));
  const autoDetect = useStateField(...activityField("autoDetectLocal"));
  const excludedGames = useStateField(...activityField("excludedGames"));
  const excludedText = useTextDraft({
    ...excludedGames,
    value: excludedGames.value.join(", "),
    set: (text: string) =>
      excludedGames.set(
        text
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 50),
      ),
  });

  const overlay = useStateField(
    "gaming.overlay",
    desktopSystemSettings.voiceOverlayEnabled,
    (next: boolean) => setDesktopSystemSettingsState((current) => ({ ...current, voiceOverlayEnabled: next })),
    ["desktop"],
  );
  const overlayScale = useStateField(
    "gaming.overlayScale",
    desktopSystemSettings.voiceOverlayScale ?? 100,
    (next: number) => setDesktopSystemSettingsState((current) => ({ ...current, voiceOverlayScale: next })),
    ["desktop"],
    { debounceMs: SLIDER_DEBOUNCE_MS },
  );
  const keybinds = useStateField("gaming.keybinds", desktopKeybinds, setDesktopKeybindsState, ["desktop"]);
  const pushToTalk = useSettingField(
    "gaming.pushToTalkKey",
    () => audioSettings.pushToTalkKey,
    async () => undefined, // saveAudioSettings already stored it on this device
    { apply: (pushToTalkKey: string) => saveAudioSettings({ ...audioSettingsRef.current, pushToTalkKey }) },
  );
  const [capturingPtt, setCapturingPtt] = useState(false);

  const captureKeybind = (key: keyof DesktopKeybindSettings) => (event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setKeybindCapture(null);
      event.currentTarget.blur();
      return;
    }
    const accelerator = acceleratorFromKeyEvent(event);
    if (!accelerator) return;
    keybinds.set({ ...keybinds.value, [key]: accelerator });
    setKeybindCapture(null);
    event.currentTarget.blur();
  };

  const capturePtt = (event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturingPtt(false);
      event.currentTarget.blur();
      return;
    }
    if (!event.code || ["Tab"].includes(event.key)) return;
    pushToTalk.set(event.code);
    setCapturingPtt(false);
    event.currentTarget.blur();
  };

  const detectedText = (() => {
    if (!detectedDesktopGame) return t("settings.gaming.noneDetected");
    const elapsed = formatActivityElapsed(detectedDesktopGame.startedAt, activityNow);
    const store = detectedDesktopGame.source === "steam" ? "Steam" : "Epic";
    return elapsed
      ? t("settings.gaming.detectedFor", { store, game: detectedDesktopGame.gameName, elapsed })
      : t("settings.gaming.detected", { store, game: detectedDesktopGame.gameName });
  })();

  return (
    <>
      <SettingsSection anchor="activity-visibility" title={t("settings.gaming.visibilityTitle")}>
        <div className="dcs-card">
          <div
            className="dcs-segmented dcs-segmented-3"
            role="radiogroup"
            aria-label={t("settings.gaming.visibilityLabel")}
          >
            {VISIBILITY.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={visibility.value === value}
                className={visibility.value === value ? "is-active" : ""}
                onClick={() => visibility.set(value)}
              >
                <strong>{tk(`settings.gaming.visibility.${value}.label`)}</strong>
                <small>{tk(`settings.gaming.visibility.${value}.detail`)}</small>
              </button>
            ))}
          </div>
          <FieldError field={visibility} />
          <p className="dcs-muted">{t("settings.gaming.visibilityHelp")}</p>
        </div>
      </SettingsSection>

      <SettingsSection anchor="automatic-activity" title={t("settings.gaming.automaticTitle")}>
        <div
          style={{
            display: "grid",
            gap: "12px",
            padding: "15px",
            borderRadius: "14px",
            border: "1px solid color-mix(in srgb, var(--ds-accent-2) 16%, transparent)",
            background: "linear-gradient(145deg, rgba(12, 28, 46, .72), rgba(24, 15, 50, .52))",
          }}
        >
          <div className="dc-activity-hero">
            <div className="dc-activity-game-icon">
              {currentGameIcon ? <img src={currentGameIcon} alt="" /> : <span>▶</span>}
            </div>
            <div>
              <strong>
                {activityState?.effectiveText || currentUser.activityText || t("settings.gaming.noActivity")}
              </strong>
              <small>
                {activityState?.automaticText
                  ? automaticActivityElapsed
                    ? t("settings.gaming.automaticFor", {
                        source: activityState.source || t("settings.gaming.detectedSource"),
                        elapsed: automaticActivityElapsed,
                      })
                    : t("settings.gaming.automaticSource", {
                        source: activityState.source || t("settings.gaming.detectedSource"),
                      })
                  : t("settings.gaming.noAutomatic")}
              </small>
            </div>
            {activityState?.automaticText && <span className="dc-live-pill">{t("settings.gaming.live")}</span>}
          </div>

          <ToggleRow
            field={publishAutomatic}
            label={t("settings.gaming.publish")}
            description={t("settings.gaming.publishHelp")}
          />

          {desktop && (
            <ToggleRow
              field={autoDetect}
              label={t("settings.gaming.detect")}
              description={t("settings.gaming.detectHelp")}
            />
          )}

          {desktop && activitySettings.autoDetectLocal && (
            <div
              style={{
                padding: "11px 12px",
                borderRadius: "10px",
                background: "color-mix(in srgb, var(--ds-accent-2) 5%, transparent)",
                border: "1px solid color-mix(in srgb, var(--ds-accent-2) 12%, transparent)",
                color: "var(--ds-text-soft)",
                fontSize: "12px",
              }}
            >
              {detectedText}
            </div>
          )}

          <label style={settingsLabelStyle} data-settings-anchor="excluded-games">
            {t("settings.gaming.excluded")}
            <input placeholder={t("settings.gaming.excludedPlaceholder")} {...excludedText.inputProps} />
            <small style={{ color: "var(--ds-muted)", marginTop: "6px", display: "block", lineHeight: 1.45 }}>
              {t("settings.gaming.excludedHelp")}
            </small>
            <FieldError field={excludedGames} />
          </label>
        </div>
      </SettingsSection>

      {desktop && (
        <SettingsSection anchor="overlay" title={t("settings.gaming.overlayTitle")}>
          <div className="dc-settings-stack">
            <ToggleRow
              field={overlay}
              label={t("settings.gaming.overlay")}
              description={t("settings.gaming.overlayHelp")}
            />
            {overlay.value && (
              <div className="dcs-card dcs-overlay-size">
                <div className="dcs-card-row">
                  <div className="dcs-card-copy">
                    <strong>{t("settings.gaming.overlaySize")}</strong>
                    <small>
                      {desktopSystemSettings.voiceOverlayScale === undefined
                        ? t("settings.gaming.overlaySizeUpdate")
                        : t("settings.gaming.overlaySizeHelp")}
                    </small>
                  </div>
                  <b className="dcs-overlay-size-value">{overlayScale.value}%</b>
                </div>
                <input
                  type="range"
                  className="settings-range"
                  min="60"
                  max="150"
                  step="5"
                  disabled={desktopSystemSettings.voiceOverlayScale === undefined}
                  value={overlayScale.value}
                  aria-label={t("settings.gaming.overlaySize")}
                  onChange={(event) => overlayScale.set(Number(event.target.value))}
                />
                <FieldError field={overlayScale} />
                <div
                  className="dcs-overlay-preview"
                  aria-hidden="true"
                  style={{ ["--s" as string]: String(overlayScale.value / 100) }}
                >
                  <span className="dcs-ov-head">
                    <i />
                    {t("settings.gaming.overlaySample", { count: OVERLAY_SAMPLE.length })}
                  </span>
                  {OVERLAY_SAMPLE.map((person) => (
                    <span key={person.name} className={`dcs-ov-pill${person.speaking ? " is-speaking" : ""}`}>
                      <b style={{ background: person.color }}>{person.name.charAt(0)}</b>
                      {person.name}
                      {person.muted && (
                        <svg viewBox="0 0 24 24">
                          <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11 5.7M12 18v3M4 4l16 16" />
                        </svg>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      <SettingsSection anchor="keybinds" title={t("settings.gaming.keybindsTitle")}>
        <p className="dc-settings-copy">
          {desktop ? t("settings.gaming.keybindsHelp") : t("settings.gaming.keybindsWeb")}
        </p>
        <div className="dc-keybind-list">
          {desktop &&
            (["toggleMute", "toggleDeafen"] as const).map((key) => (
              <label className="dc-keybind-row" key={key}>
                <span>
                  <strong>{tk(`settings.gaming.keybind.${key}.label`)}</strong>
                  <small>{tk(`settings.gaming.keybind.${key}.detail`)}</small>
                </span>
                <input
                  readOnly
                  value={
                    keybindCapture === key
                      ? t("settings.gaming.pressShortcut")
                      : friendlyAccelerator(keybinds.value[key])
                  }
                  onFocus={() => setKeybindCapture(key)}
                  onBlur={() => setKeybindCapture((current) => (current === key ? null : current))}
                  onKeyDown={captureKeybind(key)}
                />
              </label>
            ))}
          <label className="dc-keybind-row" data-settings-anchor="push-to-talk">
            <span>
              <strong>{t("settings.gaming.pushToTalk")}</strong>
              <small>
                {audioSettings.pushToTalk ? t("settings.gaming.pushToTalkHelp") : t("settings.gaming.pushToTalkOff")}
              </small>
            </span>
            <input
              readOnly
              value={
                capturingPtt
                  ? t("settings.gaming.pressKey")
                  : pushToTalk.value
                    ? pushToTalkLabel(pushToTalk.value)
                    : t("settings.gaming.noKey")
              }
              onFocus={() => setCapturingPtt(true)}
              onBlur={() => setCapturingPtt(false)}
              onKeyDown={capturePtt}
            />
          </label>
          <FieldError field={pushToTalk} />
          <div className="dc-keybind-actions">
            <span>{t("settings.gaming.keybindHint")}</span>
            {desktop && (
              <button type="button" className="modal-secondary" onClick={() => keybinds.set(DEFAULT_DESKTOP_KEYBINDS)}>
                {t("settings.gaming.resetDefaults")}
              </button>
            )}
          </div>
          {desktop && keybinds.value.toggleMute === keybinds.value.toggleDeafen && (
            <div className="settings-audio-error">{t("settings.gaming.sameShortcut")}</div>
          )}
          <FieldError field={keybinds} />
        </div>
      </SettingsSection>

      <SettingsSection anchor="shortcuts" title={t("settings.gaming.shortcutsTitle")}>
        <ShortcutsPanel
          mod={CLIENT_PLATFORM === "mac" ? "Cmd" : "Ctrl"}
          pushToTalkKey={
            audioSettings.pushToTalk && audioSettings.pushToTalkKey
              ? pushToTalkLabel(audioSettings.pushToTalkKey)
              : null
          }
          muteShortcut={friendlyAccelerator(desktopKeybinds.toggleMute)}
          deafenShortcut={friendlyAccelerator(desktopKeybinds.toggleDeafen)}
        />
      </SettingsSection>

      {!desktop && <DesktopOnlyNote />}
    </>
  );
}
