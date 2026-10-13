// Settings → Voice & video: devices, input level and sensitivity, input
// volume, voice activation / push to talk (the key itself lives in Gaming &
// overlay), noise suppression, voice processing, output, camera, mic test and
// people you've adjusted. Voice changes apply live and save on this device.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import type { AudioSettings, NoiseSuppressionMode } from "../../../app/types";
import { clamp } from "../../../app/format";
import { Icon } from "../../../components/Icon";
import { CameraPanel, OutputPanel } from "../VoicePanels";
import { PeopleVolumeList } from "../PeopleVolumeList";
import { FieldError, ToggleRow } from "../SettingsControls";
import { SLIDER_DEBOUNCE_MS, useSettingField, useStateField, type SettingFieldOptions } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";
import { pushToTalkLabel } from "./GamingOverlayTab";
import { MIC_TESTED_KEY } from "../checkup/checks";

const NOISE_MODES: NoiseSuppressionMode[] = ["off", "strong", "ai", "deepfilter"];

type Props = SettingsWindowProps & { onJump?: (tab: "gaming", anchor: string) => void };

export function VoiceVideoTab(props: Props) {
  const { t, tk } = useSettingsT();
  const {
    audioSettings,
    audioSettingsRef,
    saveAudioSettings,
    rebuildMicrophoneIfActive,
    applyOutputDevice,
    changeInputVolume,
    startMicTest,
    stopMicTest,
    preferences,
    audioSetup,
    onJump,
  } = props;
  const {
    audioInputs,
    audioOutputs,
    micLevelDb,
    autoSensitivityDb,
    micTestActive,
    microphoneCaptureState,
    microphoneCaptureLabel,
    audioSettingsError,
    audioSettingsNotice,
    audioOutputError,
    setAudioOutputError,
    voiceActivationMetrics,
    aiNoiseAvailable,
  } = audioSetup;
  const { extraSettings, setExtraSettings } = preferences;

  /** An audio setting: applied live by the voice engine, which also keeps it on this device. */
  const useAudioField = <K extends keyof AudioSettings>(
    key: K,
    apply: (next: AudioSettings) => void = saveAudioSettings,
    opts: Omit<SettingFieldOptions<AudioSettings[K]>, "apply"> = {},
  ) =>
    useSettingField(
      `voice.${key}`,
      () => audioSettings[key],
      async () => undefined,
      {
        ...opts,
        apply: (value: AudioSettings[K]) => apply({ ...audioSettingsRef.current, [key]: value }),
      },
    );
  const rebuild = (next: AudioSettings) => void rebuildMicrophoneIfActive(next);

  const inputDevice = useAudioField("inputDeviceId", rebuild);
  const outputDevice = useAudioField("outputDeviceId", (next) => {
    setAudioOutputError("");
    saveAudioSettings(next);
    void applyOutputDevice(next.outputDeviceId);
  });
  const sensitivityMode = useAudioField("sensitivityMode");
  const sensitivityDb = useAudioField("sensitivityDb", saveAudioSettings, { debounceMs: SLIDER_DEBOUNCE_MS });
  const inputVolume = useAudioField("inputVolume", (next) => changeInputVolume(next.inputVolume), {
    debounceMs: SLIDER_DEBOUNCE_MS,
  });
  const inputMode = useAudioField("pushToTalk");
  const noise = useAudioField("noiseSuppression", rebuild);
  const echo = useAudioField("echoCancellation", rebuild);
  const autoGain = useAudioField("autoGainControl", rebuild);

  const useExtraField = <K extends "showAudioDiagnostics" | "outputVolume" | "cameraDeviceId">(
    key: K,
    debounce = false,
  ) =>
    useStateField(
      `voice.${key}`,
      extraSettings[key],
      (next: (typeof extraSettings)[K]) => setExtraSettings((current) => ({ ...current, [key]: next })),
      ["device"],
      debounce ? { debounceMs: SLIDER_DEBOUNCE_MS } : {},
    );
  const diagnostics = useExtraField("showAudioDiagnostics");
  const outputVolume = useExtraField("outputVolume", true);
  const camera = useExtraField("cameraDeviceId");

  const threshold = audioSettings.sensitivityMode === "auto" ? autoSensitivityDb : sensitivityDb.value;
  const testMicrophone = () => {
    try {
      localStorage.setItem(MIC_TESTED_KEY, new Date().toISOString());
    } catch {}
    void startMicTest();
  };

  return (
    <section className="settings-audio-card">
      <div className="settings-audio-header">
        <div>
          <div className="settings-audio-kicker">{t("settings.voice.kicker")}</div>
          <h3>{t("settings.voice.headline")}</h3>
          <p>{t("settings.voice.intro")}</p>
        </div>
        <div
          className={microphoneCaptureState === "ready" ? "settings-audio-live active" : "settings-audio-live"}
          title={microphoneCaptureLabel || undefined}
        >
          <span />
          {microphoneCaptureState === "starting"
            ? t("settings.voice.mic.starting")
            : microphoneCaptureState === "error"
              ? t("settings.voice.mic.unavailable")
              : microphoneCaptureState === "ready"
                ? micTestActive
                  ? t("settings.voice.mic.testLive")
                  : microphoneCaptureLabel || t("settings.voice.mic.live")
                : t("settings.voice.mic.off")}
        </div>
      </div>

      <div className="settings-audio-grid">
        <div
          className="settings-audio-panel settings-audio-panel-wide settings-audio-devices-panel"
          data-settings-anchor="devices"
        >
          <div className="settings-audio-panel-title">
            <span>{t("settings.voice.devices.title")}</span>
            <small>{t("settings.voice.devices.help")}</small>
          </div>
          <div className="settings-device-grid">
            <label className="settings-field">
              <span>{t("settings.voice.devices.input")}</span>
              <select value={inputDevice.value} onChange={(event) => inputDevice.set(event.target.value)}>
                <option value="">{t("settings.voice.devices.defaultInput")}</option>
                {audioInputs.map((device, index) => (
                  <option key={device.deviceId || `input-${index}`} value={device.deviceId}>
                    {device.label || t("settings.voice.devices.microphoneNumbered", { number: index + 1 })}
                  </option>
                ))}
              </select>
            </label>
            {audioOutputs.length > 0 && (
              <label className="settings-field">
                <span>{t("settings.voice.devices.output")}</span>
                <select value={outputDevice.value} onChange={(event) => outputDevice.set(event.target.value)}>
                  <option value="">{t("settings.voice.devices.defaultOutput")}</option>
                  {audioOutputs.map((device, index) => (
                    <option key={device.deviceId || `output-${index}`} value={device.deviceId}>
                      {device.label || t("settings.voice.devices.outputNumbered", { number: index + 1 })}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="settings-audio-panel settings-audio-panel-wide">
          <div className="settings-audio-panel-title">
            <span>{t("settings.voice.level.title")}</span>
            <small>
              {audioSettings.pushToTalk
                ? t("settings.voice.level.live")
                : audioSettings.sensitivityMode === "auto" && audioSettings.noiseSuppression !== "off"
                  ? t("settings.voice.level.afterSuppression")
                  : t("settings.voice.level.withThreshold")}
            </small>
          </div>

          <div className="settings-audio-meter-head">
            <strong>{t("settings.voice.db", { value: Math.round(micLevelDb) })}</strong>
            {!audioSettings.pushToTalk && (
              <span>{t("settings.voice.level.threshold", { value: Math.round(threshold) })}</span>
            )}
          </div>

          <div className="settings-audio-meter">
            <div
              className="settings-audio-meter-fill"
              style={{ width: `${clamp(((micLevelDb + 80) / 80) * 100, 0, 100)}%` }}
            />
            {!audioSettings.pushToTalk && (
              <div
                className="settings-audio-threshold"
                title={t("settings.voice.level.thresholdTitle")}
                style={{ left: `${clamp(((threshold + 80) / 80) * 100, 0, 100)}%` }}
              />
            )}
          </div>

          <div className="settings-audio-scale">
            <span>{t("settings.voice.db", { value: -80 })}</span>
            <span>{t("settings.voice.db", { value: -40 })}</span>
            <span>{t("settings.voice.db", { value: 0 })}</span>
          </div>

          <label className="dcs-check dcs-diagnostics-toggle">
            <input
              type="checkbox"
              checked={diagnostics.value}
              onChange={(event) => diagnostics.set(event.target.checked)}
            />
            <span>{t("settings.voice.diagnostics")}</span>
          </label>
          {extraSettings.showAudioDiagnostics && voiceActivationMetrics && (
            <div
              className="settings-audio-inline-status"
              aria-live="polite"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px 12px",
                marginTop: "8px",
                color: "var(--ds-text-soft)",
                fontSize: "12px",
              }}
            >
              <span>
                {t("settings.voice.metrics.transmit", { value: Math.round(voiceActivationMetrics.outputDb ?? -80) })}
              </span>
              <span>
                {t("settings.voice.metrics.rms", { value: (voiceActivationMetrics.outputRms ?? 0).toFixed(4) })}
              </span>
              <span>
                {t("settings.voice.metrics.activity", {
                  value: Math.round((voiceActivationMetrics.activity ?? 0) * 100),
                })}
              </span>
              <span>
                {t("settings.voice.metrics.post", { value: Math.round(voiceActivationMetrics.postDb ?? -80) })}
              </span>
              <span>{t("settings.voice.metrics.raw", { value: Math.round(voiceActivationMetrics.rawDb ?? -80) })}</span>
              <span>
                {t("settings.voice.metrics.floor", { value: Math.round(voiceActivationMetrics.noiseFloorDb ?? -80) })}
              </span>
              <span>
                {t("settings.voice.metrics.vad", {
                  value: Math.round((voiceActivationMetrics.vadProbability ?? 0) * 100),
                })}
              </span>
            </div>
          )}

          {!audioSettings.pushToTalk && (
            <div className="settings-audio-inline-activation">
              <div className="settings-audio-panel-title">
                <span>{t("settings.voice.activation.title")}</span>
                <small>{t("settings.voice.activation.help")}</small>
              </div>
              <div className="settings-choice-row">
                {(["auto", "manual"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={sensitivityMode.value === mode ? "settings-choice active" : "settings-choice"}
                    onClick={() => sensitivityMode.set(mode)}
                  >
                    <span className="settings-choice-icon">{mode === "auto" ? "A" : "M"}</span>
                    <span>
                      <strong>{tk(`settings.voice.activation.${mode}.label`)}</strong>
                      <small>{tk(`settings.voice.activation.${mode}.detail`)}</small>
                    </span>
                  </button>
                ))}
              </div>
              <FieldError field={sensitivityMode} />
              {audioSettings.sensitivityMode === "manual" && (
                <div className="settings-audio-slider-block">
                  <div className="settings-audio-row">
                    <div>
                      <strong>{t("settings.voice.activation.threshold")}</strong>
                      <small>{t("settings.voice.activation.thresholdHelp")}</small>
                    </div>
                    <b>{t("settings.voice.db", { value: Math.round(sensitivityDb.value) })}</b>
                  </div>
                  <input
                    className="settings-range"
                    type="range"
                    min="-80"
                    max="-10"
                    step="1"
                    value={sensitivityDb.value}
                    aria-label={t("settings.voice.activation.threshold")}
                    onChange={(event) => sensitivityDb.set(Number(event.target.value))}
                  />
                </div>
              )}
            </div>
          )}

          <div className="settings-audio-slider-block" data-settings-anchor="input-volume">
            <div className="settings-audio-row">
              <div>
                <strong>{t("settings.voice.inputVolume.title")}</strong>
                <small>{t("settings.voice.inputVolume.help")}</small>
              </div>
              <b>{Math.round(inputVolume.value)}%</b>
            </div>
            <input
              className="settings-range"
              type="range"
              min="0"
              max="200"
              step="1"
              value={inputVolume.value}
              aria-label={t("settings.voice.inputVolume.title")}
              onChange={(event) => inputVolume.set(Number(event.target.value))}
            />
            <div className="settings-range-scale">
              <span>0%</span>
              <span>100%</span>
              <span>200%</span>
            </div>
          </div>
        </div>

        <div className="settings-audio-panel settings-audio-panel-wide" data-settings-anchor="input-mode">
          <div className="settings-audio-panel-title">
            <span>{t("settings.voice.mode.title")}</span>
            <small>{t("settings.voice.mode.help")}</small>
          </div>
          <div className="settings-choice-row settings-input-mode-row">
            <button
              type="button"
              className={!inputMode.value ? "settings-choice active" : "settings-choice"}
              onClick={() => inputMode.set(false)}
            >
              <span className="settings-choice-icon">
                <Icon name="volume" size="sm" />
              </span>
              <span>
                <strong>{t("settings.voice.mode.activation")}</strong>
                <small>{t("settings.voice.mode.activationHelp")}</small>
              </span>
            </button>
            <button
              type="button"
              className={inputMode.value ? "settings-choice active" : "settings-choice"}
              onClick={() => inputMode.set(true)}
            >
              <span className="settings-choice-icon">
                <Icon name="keyboard" size="sm" />
              </span>
              <span>
                <strong>{t("settings.voice.mode.pushToTalk")}</strong>
                <small>{t("settings.voice.mode.pushToTalkHelp")}</small>
              </span>
            </button>
          </div>
          <FieldError field={inputMode} />
          {audioSettings.pushToTalk && (
            <p className="dcs-muted">
              {audioSettings.pushToTalkKey
                ? t("settings.voice.mode.key", { key: pushToTalkLabel(audioSettings.pushToTalkKey) })
                : t("settings.voice.mode.noKey")}{" "}
              <button type="button" className="dcs-link-button" onClick={() => onJump?.("gaming", "push-to-talk")}>
                {t("settings.voice.mode.changeKey")}
              </button>
            </p>
          )}
        </div>

        <div className="settings-audio-panel settings-audio-panel-wide" data-settings-anchor="noise-suppression">
          <div className="settings-audio-panel-title">
            <span>{t("settings.voice.noise.title")}</span>
            <small>{t("settings.voice.noise.help")}</small>
          </div>
          <div className="settings-noise-grid">
            {NOISE_MODES.map((value) => {
              const unavailable = (value === "ai" || value === "deepfilter") && !aiNoiseAvailable;
              const selected = noise.value === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={unavailable}
                  className={`settings-noise-card${selected ? " active" : ""}${unavailable ? " unavailable" : ""}`}
                  onClick={() => noise.set(value)}
                >
                  <span className="settings-noise-radio">{selected ? <Icon name="check" size="sm" /> : null}</span>
                  <strong>{tk(`settings.voice.noise.modes.${value}.label`)}</strong>
                  <span>
                    {unavailable
                      ? t("settings.voice.noise.unavailable")
                      : tk(`settings.voice.noise.modes.${value}.subtitle`)}
                  </span>
                  <small>
                    {unavailable
                      ? t("settings.voice.noise.unsupported")
                      : tk(`settings.voice.noise.modes.${value}.description`)}
                  </small>
                </button>
              );
            })}
          </div>
          <FieldError field={noise} />
        </div>

        <div className="settings-audio-panel settings-audio-panel-wide" data-settings-anchor="voice-processing">
          <div className="settings-audio-panel-title">
            <span>{t("settings.voice.processing.title")}</span>
            <small>{t("settings.voice.processing.help")}</small>
          </div>
          <div className="settings-processing-grid">
            <ToggleRow
              field={echo}
              label={t("settings.voice.processing.echo")}
              description={t("settings.voice.processing.echoHelp")}
            />
            <ToggleRow
              field={autoGain}
              label={t("settings.voice.processing.gain")}
              description={t("settings.voice.processing.gainHelp")}
            />
          </div>
        </div>

        <div className="settings-audio-panel-wide" data-settings-anchor="output">
          <OutputPanel
            outputDeviceId={audioSettings.outputDeviceId}
            volume={outputVolume.value}
            onVolume={outputVolume.set}
          />
          <FieldError field={outputVolume} />
        </div>
        <div className="settings-audio-panel-wide" data-settings-anchor="camera">
          <CameraPanel cameraDeviceId={camera.value} onCameraDevice={camera.set} />
          <FieldError field={camera} />
        </div>
        <PeopleVolumeList
          voiceUserVolumes={props.voiceUserVolumes}
          voiceParticipants={props.voiceParticipants}
          hubMembers={props.hubMembers}
          friends={props.friends}
          changeVoiceUserVolume={props.changeVoiceUserVolume}
          resetVoiceUserVolumes={props.resetVoiceUserVolumes}
        />
      </div>

      <p className="dcs-section-note">{t("settings.voice.liveNote")}</p>

      {audioSettingsNotice && <div className="settings-audio-notice">{audioSettingsNotice}</div>}
      {audioSettingsError && <div className="settings-audio-error">{audioSettingsError}</div>}
      {audioOutputError && <div className="settings-audio-error">{audioOutputError}</div>}

      <div className="settings-mic-test" data-settings-anchor="mic-test">
        <div>
          <strong>{t("settings.voice.micTest.title")}</strong>
          <span>{t("settings.voice.micTest.help")}</span>
        </div>
        <button
          type="button"
          className={micTestActive ? "settings-test-button active" : "settings-test-button"}
          onClick={() => (micTestActive ? stopMicTest() : testMicrophone())}
        >
          {micTestActive ? t("settings.voice.micTest.stop") : t("settings.voice.micTest.start")}
        </button>
      </div>
    </section>
  );
}
