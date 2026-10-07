// Settings > Voice & video.

import type { MutableRefObject } from "react";
import { Icon } from "../../../components/Icon";
import { OutputPanel, CameraPanel, UserVolumesPanel, type UserVolumeRow } from "../../../features/settings";
import type { ServerMemberView, VoiceParticipant, SocialUser, NoiseSuppressionMode, AudioSettings } from "../../types";
import { clamp } from "../../format";
import type { PreferencesState } from "../../state/preferences";
import type { AudioSetupState } from "../../state/audio-setup";

type Props = {
  hubMembers: ServerMemberView[];
  friends: SocialUser[];
  voiceParticipants: VoiceParticipant[];
  audioSettings: AudioSettings;
  voiceUserVolumes: Record<string, number>;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  resetVoiceUserVolumes: (userId?: string | undefined) => void;
  saveAudioSettings: (next: AudioSettings) => void;
  applyOutputDevice: (outputDeviceId: string) => Promise<void>;
  rebuildMicrophoneIfActive: (next: AudioSettings) => Promise<void>;
  changeInputVolume: (value: number) => void;
  startMicTest: () => Promise<void>;
  stopMicTest: () => void;
  preferences: PreferencesState;
  audioSetup: AudioSetupState;
};

export function VoiceSettingsSection({
  hubMembers,
  friends,
  voiceParticipants,
  audioSettings,
  voiceUserVolumes,
  audioSettingsRef,
  resetVoiceUserVolumes,
  saveAudioSettings,
  applyOutputDevice,
  rebuildMicrophoneIfActive,
  changeInputVolume,
  startMicTest,
  stopMicTest,
  preferences,
  audioSetup,
}: Props) {
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
  return (
    <>
      <section className="settings-audio-card">
        <div className="settings-audio-header">
          <div>
            <div className="settings-audio-kicker">VOICE & AUDIO</div>
            <h3>Sound that feels right</h3>
            <p>Choose your devices, tune the microphone and control how DeCave processes your voice.</p>
          </div>
          <div
            className={microphoneCaptureState === "ready" ? "settings-audio-live active" : "settings-audio-live"}
            title={microphoneCaptureLabel || undefined}
          >
            <span />
            {microphoneCaptureState === "starting"
              ? "Starting microphone…"
              : microphoneCaptureState === "error"
                ? "Microphone unavailable"
                : microphoneCaptureState === "ready"
                  ? micTestActive
                    ? "Mic test live"
                    : microphoneCaptureLabel || "Microphone live"
                  : "Microphone off"}
          </div>
        </div>

        <div className="settings-audio-grid">
          <div className="settings-audio-panel settings-audio-panel-wide settings-audio-devices-panel">
            <div className="settings-audio-panel-title">
              <span>Devices</span>
              <small>Where your voice comes from and where sound goes</small>
            </div>

            <div className="settings-device-grid">
              <label className="settings-field">
                <span>Input device</span>
                <select
                  value={audioSettings.inputDeviceId}
                  onChange={(event) => {
                    const next = {
                      ...audioSettingsRef.current,
                      inputDeviceId: event.target.value,
                    };
                    void rebuildMicrophoneIfActive(next);
                  }}
                >
                  <option value="">Default microphone</option>
                  {audioInputs.map((device, index) => (
                    <option key={device.deviceId || `input-${index}`} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>

              {audioOutputs.length > 0 && (
                <label className="settings-field">
                  <span>Output device</span>
                  <select
                    value={audioSettings.outputDeviceId}
                    onChange={(event) => {
                      const next = {
                        ...audioSettingsRef.current,
                        outputDeviceId: event.target.value,
                      };
                      setAudioOutputError("");
                      saveAudioSettings(next);
                      void applyOutputDevice(next.outputDeviceId);
                    }}
                  >
                    <option value="">Default output</option>
                    {audioOutputs.map((device, index) => (
                      <option key={device.deviceId || `output-${index}`} value={device.deviceId}>
                        {device.label || `Output ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          <div className="settings-audio-panel settings-audio-panel-wide">
            <div className="settings-audio-panel-title">
              <span>Input level</span>
              <small>
                {audioSettings.pushToTalk
                  ? "Live microphone level"
                  : audioSettings.sensitivityMode === "auto" && audioSettings.noiseSuppression !== "off"
                    ? "Your microphone after noise suppression, and the activation threshold"
                    : "Live microphone level and activation threshold"}
              </small>
            </div>

            <div className="settings-audio-meter-head">
              <strong>{Math.round(micLevelDb)} dB</strong>
              {!audioSettings.pushToTalk && (
                <span>
                  Threshold{" "}
                  {Math.round(
                    audioSettings.sensitivityMode === "auto" ? autoSensitivityDb : audioSettings.sensitivityDb,
                  )}{" "}
                  dB
                </span>
              )}
            </div>

            <div className="settings-audio-meter">
              <div
                className="settings-audio-meter-fill"
                style={{
                  width: `${clamp(((micLevelDb + 80) / 80) * 100, 0, 100)}%`,
                }}
              />
              {!audioSettings.pushToTalk && (
                <div
                  className="settings-audio-threshold"
                  title="Activation threshold"
                  style={{
                    left: `${clamp(
                      (((audioSettings.sensitivityMode === "auto" ? autoSensitivityDb : audioSettings.sensitivityDb) +
                        80) /
                        80) *
                        100,
                      0,
                      100,
                    )}%`,
                  }}
                />
              )}
            </div>

            <div className="settings-audio-scale">
              <span>-80 dB</span>
              <span>-40 dB</span>
              <span>0 dB</span>
            </div>

            <label className="dcs-check dcs-diagnostics-toggle">
              <input
                type="checkbox"
                checked={extraSettings.showAudioDiagnostics}
                onChange={(event) =>
                  setExtraSettings((current) => ({ ...current, showAudioDiagnostics: event.target.checked }))
                }
              />
              <span>Show technical audio readings</span>
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
                <span>Transmit {Math.round(voiceActivationMetrics.outputDb ?? -80)} dB</span>
                <span>RMS {(voiceActivationMetrics.outputRms ?? 0).toFixed(4)}</span>
                <span>Activity {Math.round((voiceActivationMetrics.activity ?? 0) * 100)}%</span>
                <span>Post {Math.round(voiceActivationMetrics.postDb ?? -80)} dB</span>
                <span>Raw {Math.round(voiceActivationMetrics.rawDb ?? -80)} dB</span>
                <span>Floor {Math.round(voiceActivationMetrics.noiseFloorDb ?? -80)} dB</span>
                <span>VAD {Math.round((voiceActivationMetrics.vadProbability ?? 0) * 100)}%</span>
              </div>
            )}

            {!audioSettings.pushToTalk && (
              <div className="settings-audio-inline-activation">
                <div className="settings-audio-panel-title">
                  <span>Voice activation</span>
                  <small>Adjust the gate while watching your live input level</small>
                </div>

                <div className="settings-choice-row">
                  <button
                    type="button"
                    className={audioSettings.sensitivityMode === "auto" ? "settings-choice active" : "settings-choice"}
                    onClick={() =>
                      saveAudioSettings({
                        ...audioSettingsRef.current,
                        sensitivityMode: "auto",
                      })
                    }
                  >
                    <span className="settings-choice-icon">A</span>
                    <span>
                      <strong>Automatic</strong>
                      <small>DeCave follows your environment</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={
                      audioSettings.sensitivityMode === "manual" ? "settings-choice active" : "settings-choice"
                    }
                    onClick={() =>
                      saveAudioSettings({
                        ...audioSettingsRef.current,
                        sensitivityMode: "manual",
                      })
                    }
                  >
                    <span className="settings-choice-icon">M</span>
                    <span>
                      <strong>Manual</strong>
                      <small>You set the activation threshold</small>
                    </span>
                  </button>
                </div>

                {audioSettings.sensitivityMode === "manual" && (
                  <div className="settings-audio-slider-block">
                    <div className="settings-audio-row">
                      <div>
                        <strong>Activation threshold</strong>
                        <small>Move the marker above until background noise stays gated</small>
                      </div>
                      <b>{Math.round(audioSettings.sensitivityDb)} dB</b>
                    </div>
                    <input
                      className="settings-range"
                      type="range"
                      min="-80"
                      max="-10"
                      step="1"
                      value={audioSettings.sensitivityDb}
                      onChange={(event) =>
                        saveAudioSettings({
                          ...audioSettingsRef.current,
                          sensitivityDb: Number(event.target.value),
                        })
                      }
                    />
                  </div>
                )}
              </div>
            )}

            <div className="settings-audio-slider-block">
              <div className="settings-audio-row">
                <div>
                  <strong>Input volume</strong>
                  <small>Boost or reduce your microphone level</small>
                </div>
                <b>{Math.round(audioSettings.inputVolume)}%</b>
              </div>
              <input
                className="settings-range"
                type="range"
                min="0"
                max="200"
                step="1"
                value={audioSettings.inputVolume}
                onChange={(event) => changeInputVolume(Number(event.target.value))}
              />
              <div className="settings-range-scale">
                <span>0%</span>
                <span>100%</span>
                <span>200%</span>
              </div>
            </div>
          </div>

          <div className="settings-audio-panel settings-audio-panel-wide">
            <div className="settings-audio-panel-title">
              <span>Input mode</span>
              <small>Choose voice activation or hold a key to talk</small>
            </div>

            <div className="settings-choice-row settings-input-mode-row">
              <button
                type="button"
                className={!audioSettings.pushToTalk ? "settings-choice active" : "settings-choice"}
                onClick={() =>
                  saveAudioSettings({
                    ...audioSettingsRef.current,
                    pushToTalk: false,
                  })
                }
              >
                <span className="settings-choice-icon">
                  <Icon name="volume" size="sm" />
                </span>
                <span>
                  <strong>Voice Activation</strong>
                  <small>Your microphone opens when you speak</small>
                </span>
              </button>
              <button
                type="button"
                className={audioSettings.pushToTalk ? "settings-choice active" : "settings-choice"}
                onClick={() =>
                  saveAudioSettings({
                    ...audioSettingsRef.current,
                    pushToTalk: true,
                  })
                }
              >
                <span className="settings-choice-icon">⌨</span>
                <span>
                  <strong>Push to Talk</strong>
                  <small>Transmit only while your selected key is held</small>
                </span>
              </button>
            </div>
          </div>

          {audioSettings.pushToTalk && (
            <div className="settings-audio-panel">
              <div className="settings-audio-panel-title">
                <span>Push-to-talk key</span>
                <small>Choose the key you hold while transmitting</small>
              </div>
              <label className="settings-field settings-key-field">
                <span>Key code</span>
                <input
                  value={audioSettings.pushToTalkKey}
                  onChange={(event) =>
                    saveAudioSettings({
                      ...audioSettingsRef.current,
                      pushToTalkKey: event.target.value.trim() || "KeyV",
                    })
                  }
                  placeholder="KeyV"
                />
                <small>Examples: KeyV, Space or CapsLock</small>
              </label>
            </div>
          )}

          <div className="settings-audio-panel settings-audio-panel-wide">
            <div className="settings-audio-panel-title">
              <span>Noise suppression</span>
              <small>Clean up keyboard, fan and background noise before your voice is sent</small>
            </div>

            <div className="settings-noise-grid">
              {(
                [
                  ["off", "Off", "Raw microphone", "No processing"],
                  ["strong", "Standard", "ClearVoice", "Gaming-focused noise suppression"],
                  [
                    "ai",
                    "DeCave ClearVoice",
                    "Noise Suppression by DeCave",
                    "Local AI processing for clearer voice in noisy environments",
                  ],
                ] as const
              ).map(([value, label, subtitle, description]) => {
                const unavailable = value === "ai" && !aiNoiseAvailable;
                const selected = audioSettings.noiseSuppression === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={unavailable}
                    className={`settings-noise-card${selected ? " active" : ""}${unavailable ? " unavailable" : ""}`}
                    onClick={() => {
                      const next = {
                        ...audioSettingsRef.current,
                        noiseSuppression: value as NoiseSuppressionMode,
                      };
                      void rebuildMicrophoneIfActive(next);
                    }}
                  >
                    <span className="settings-noise-radio">{selected ? <Icon name="check" size="sm" /> : null}</span>
                    <strong>{label}</strong>
                    <span>{unavailable ? "Unavailable" : subtitle}</span>
                    <small>{unavailable ? "Not supported by this browser" : description}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="settings-audio-panel settings-audio-panel-wide">
            <div className="settings-audio-panel-title">
              <span>Voice processing</span>
              <small>Additional processing applied by your browser</small>
            </div>

            <div className="settings-processing-grid">
              <label className={`settings-toggle-row${audioSettings.echoCancellation ? " enabled" : " disabled"}`}>
                <span>
                  <strong>Echo cancellation</strong>
                  <small>Reduce speaker audio feeding back into your microphone</small>
                </span>
                <span className="settings-toggle-control">
                  <em>{audioSettings.echoCancellation ? "ON" : "OFF"}</em>
                  <input
                    type="checkbox"
                    checked={audioSettings.echoCancellation}
                    onChange={(event) => {
                      const next = {
                        ...audioSettingsRef.current,
                        echoCancellation: event.target.checked,
                      };
                      void rebuildMicrophoneIfActive(next);
                    }}
                  />
                </span>
              </label>

              <label className={`settings-toggle-row${audioSettings.autoGainControl ? " enabled" : " disabled"}`}>
                <span>
                  <strong>Automatic gain control</strong>
                  <small>Keep your voice at a more consistent loudness</small>
                </span>
                <span className="settings-toggle-control">
                  <em>{audioSettings.autoGainControl ? "ON" : "OFF"}</em>
                  <input
                    type="checkbox"
                    checked={audioSettings.autoGainControl}
                    onChange={(event) => {
                      const next = {
                        ...audioSettingsRef.current,
                        autoGainControl: event.target.checked,
                      };
                      void rebuildMicrophoneIfActive(next);
                    }}
                  />
                </span>
              </label>
            </div>
          </div>

          <OutputPanel
            outputDeviceId={audioSettings.outputDeviceId}
            volume={extraSettings.outputVolume}
            onVolume={(outputVolume) => setExtraSettings((current) => ({ ...current, outputVolume }))}
          />
          <CameraPanel
            cameraDeviceId={extraSettings.cameraDeviceId}
            onCameraDevice={(cameraDeviceId) => setExtraSettings((current) => ({ ...current, cameraDeviceId }))}
          />
          <UserVolumesPanel
            rows={Object.entries(voiceUserVolumes)
              .filter(([, volume]) => Math.round(volume) !== 100)
              .map(([userId, volume]): UserVolumeRow => ({
                userId,
                volume: Math.round(volume),
                name:
                  voiceParticipants.find((person) => person.userId === userId)?.username ??
                  hubMembers.find((member) => member.userId === userId)?.username ??
                  friends.find((friend) => friend.id === userId)?.username ??
                  "Someone you heard in voice",
              }))
              .sort((a, b) => a.name.localeCompare(b.name))}
            onReset={(userId) => resetVoiceUserVolumes(userId)}
            onResetAll={() => resetVoiceUserVolumes()}
          />
        </div>

        <p className="dcs-section-note">
          Voice changes apply right away so you can test them. Save keeps them; Cancel puts back what you had.
        </p>

        {audioSettingsNotice && <div className="settings-audio-notice">{audioSettingsNotice}</div>}
        {audioSettingsError && <div className="settings-audio-error">{audioSettingsError}</div>}
        {audioOutputError && <div className="settings-audio-error">{audioOutputError}</div>}

        <div className="settings-mic-test">
          <div>
            <strong>Mic test</strong>
            <span>Hear how your microphone sounds with your current processing.</span>
          </div>
          <button
            type="button"
            className={micTestActive ? "settings-test-button active" : "settings-test-button"}
            onClick={() => (micTestActive ? stopMicTest() : void startMicTest())}
          >
            {micTestActive ? "Stop Test" : "Test Microphone"}
          </button>
        </div>
      </section>
    </>
  );
}
