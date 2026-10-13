// Voice controls under a connected voice room: mute, deafen, camera, screen share, soundboard, leave.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type {
  Channel,
  Server,
  VoiceParticipant,
  NoiseSuppressionMode,
  ScreenQuality,
  CameraEffect,
  AudioSettings,
  SettingsTab,
} from "../types";
import { noiseSuppressionLabel, noiseSuppressionShortLabel } from "../voice";
import {
  voiceControlBarStyle,
  voiceButtonRowStyle,
  voiceActionButtonStyle,
  voiceShareButtonStyle,
  voiceStopShareButtonStyle,
  voiceDisconnectButtonStyle,
} from "../inline-styles";
import type { SoundboardState } from "../state/soundboard";
import type { CameraShareOptionsState } from "../state/camera-share-options";
import type { VoiceCallState } from "../state/voice-call";
import type { CallMediaState } from "../state/call-media";
import type { VoiceControlActions } from "../actions/voice-controls";

type Props = {
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  connectionStatus: string;
  voiceParticipants: VoiceParticipant[];
  voiceChannelId: number;
  audioSettings: AudioSettings;
  audioOutputError: string;
  activeNoiseSuppressionMode: NoiseSuppressionMode;
  currentServer: Server;
  currentChannel: Channel;
  cycleNoiseSuppression: () => void;
  leaveVoice: () => void;
  stopCamera: () => void;
  openSettings: () => void;
  joinVoice: () => Promise<void>;
  ownVoiceRttMs: number | null;
  voiceQuality: "good" | "fair" | "poor" | null;
  soundboard: SoundboardState;
  cameraShareOptions: CameraShareOptionsState;
  voiceCall: VoiceCallState;
  callMedia: CallMediaState;
  voiceControls: VoiceControlActions;
};

export function VoiceControlsPanel({
  setSettingsTab,
  connectionStatus,
  voiceParticipants,
  voiceChannelId,
  audioSettings,
  audioOutputError,
  activeNoiseSuppressionMode,
  currentServer,
  currentChannel,
  cycleNoiseSuppression,
  leaveVoice,
  stopCamera,
  openSettings,
  joinVoice,
  ownVoiceRttMs,
  voiceQuality,
  soundboard,
  cameraShareOptions,
  voiceCall,
  callMedia,
  voiceControls,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const { loadSoundboardSounds, toggleMute, toggleDeafen, startCamera, stopScreenShare, startScreenShare } =
    voiceControls;
  const {
    isScreenSharing,
    screenQuality,
    setScreenQuality,
    isCameraOn,
    cameraSettingsOpen,
    setCameraSettingsOpen,
    screenShareSettingsOpen,
    setScreenShareSettingsOpen,
  } = callMedia;
  const { voiceStatus, voiceError, voiceChatOpen, isMuted, isDeafened, isServerMuted, isServerDeafened } = voiceCall;
  const { shareSystemAudio, setShareSystemAudio, cameraEffect, setCameraEffect, cameraEffectNotice } =
    cameraShareOptions;
  const { soundboardSounds, soundboardOpen, setSoundboardOpen } = soundboard;
  return (
    <div
      className={`voice-panel dc-persistent-voice-surface${voiceChatOpen ? "" : " vr-floating-bar"}`}
      data-voice-surface="room-controls"
      data-voice-channel-id={currentChannel.id}
      data-muted={isMuted || isServerMuted ? "true" : "false"}
      data-deafened={isDeafened || isServerDeafened ? "true" : "false"}
      aria-label={t("hub.voiceControls.label", { hub: currentServer.name, room: currentChannel.name })}
      style={voiceControlBarStyle}
    >
      <div style={{ minWidth: "160px" }}>
        <div className="voice-status-row">
          <div className="voice-status">
            {voiceChannelId === currentChannel.id ? t("hub.voiceControls.connected") : t("hub.voiceControls.room")}
          </div>
          {voiceChannelId === currentChannel.id && (
            <span
              className={`dc-voice-quality ${voiceQuality ?? "waiting"}`}
              title={t("hub.voiceControls.latencyTitle")}
            >
              {ownVoiceRttMs === null
                ? voiceStatus === "Connecting..."
                  ? t("hub.voiceControls.connectingEllipsis")
                  : t("hub.voiceControls.live")
                : t("common.userMenu.rttMs", { ms: ownVoiceRttMs })}
            </span>
          )}
        </div>
        <div style={{ color: voiceError ? "var(--ds-danger)" : "var(--ds-muted)", fontSize: "var(--ds-text-xs)" }}>
          {voiceError ||
            audioOutputError ||
            cameraEffectNotice ||
            (isServerMuted || isServerDeafened
              ? isServerMuted && isServerDeafened
                ? t("hub.voiceControls.serverMutedDeafened")
                : isServerMuted
                  ? t("hub.voiceControls.serverMuted")
                  : t("hub.voiceControls.serverDeafened")
              : voiceChannelId === currentChannel.id
                ? audioSettings.inputVolume === 0
                  ? t("hub.voiceControls.inputZero")
                  : audioSettings.pushToTalk
                    ? t("hub.voiceControls.holdToTalk", { key: audioSettings.pushToTalkKey.replace(/^Key/, "") })
                    : t("hub.voiceControls.connectedCount", {
                        count: voiceParticipants.filter((p) => p.channelId === currentChannel.id).length,
                      })
                : "")}
        </div>
      </div>

      {voiceChannelId === currentChannel.id ? (
        <div className="dc-voice-actions" style={voiceButtonRowStyle}>
          <button
            type="button"
            className={`voice-channel-icon-button${isMuted || isServerMuted ? " active" : ""}`}
            onClick={toggleMute}
            disabled={isServerMuted}
            aria-label={
              isServerMuted
                ? t("hub.voiceControls.serverMuted")
                : isMuted
                  ? t("hub.voiceControls.unmute")
                  : t("hub.voiceControls.mute")
            }
            aria-pressed={isMuted || isServerMuted}
            data-tooltip={
              isServerMuted
                ? t("hub.voiceControls.serverMuted")
                : isMuted
                  ? t("hub.voiceControls.unmute")
                  : t("hub.voiceControls.mute")
            }
            title={
              isServerMuted
                ? t("hub.voiceControls.serverMutedTitle")
                : isMuted
                  ? t("hub.voiceControls.unmute")
                  : t("hub.voiceControls.mute")
            }
          >
            <Icon name={isMuted || isServerMuted ? "mic-off" : "mic"} size="lg" />
          </button>
          <button
            type="button"
            className={`voice-channel-icon-button${isDeafened || isServerDeafened ? " active" : ""}`}
            onClick={toggleDeafen}
            disabled={isServerDeafened}
            aria-label={
              isServerDeafened
                ? t("hub.voiceControls.serverDeafened")
                : isDeafened
                  ? t("common.profileMenu.undeafen")
                  : t("common.profileMenu.deafen")
            }
            aria-pressed={isDeafened || isServerDeafened}
            data-tooltip={
              isServerDeafened
                ? t("hub.voiceControls.serverDeafened")
                : isDeafened
                  ? t("common.profileMenu.undeafen")
                  : t("common.profileMenu.deafen")
            }
            title={
              isServerDeafened
                ? t("hub.voiceControls.serverDeafenedTitle")
                : isDeafened
                  ? t("common.profileMenu.undeafen")
                  : t("common.profileMenu.deafen")
            }
          >
            <Icon name={isDeafened || isServerDeafened ? "headphones-off" : "headphones"} size="lg" />
          </button>
          <button
            type="button"
            className={`voice-channel-icon-button voice-noise-button${activeNoiseSuppressionMode !== "off" ? " noise-active" : ""}`}
            onClick={cycleNoiseSuppression}
            aria-label={t("hub.voiceControls.noiseLabel", { mode: noiseSuppressionLabel(activeNoiseSuppressionMode) })}
            data-tooltip={t("hub.voiceControls.noiseTooltip", {
              mode: noiseSuppressionLabel(activeNoiseSuppressionMode),
            })}
            title={t("hub.voiceControls.noiseLabel", { mode: noiseSuppressionLabel(activeNoiseSuppressionMode) })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                d="M4 12h3l2.1-6 4.2 12 2.1-6H20"
              />
            </svg>
            <span className="voice-noise-mode-badge">{noiseSuppressionShortLabel(activeNoiseSuppressionMode)}</span>
          </button>
          <button
            type="button"
            className={`dc-bottom-soundboard-toggle${soundboardOpen ? " active" : ""}`}
            title={t("hub.voiceControls.soundboard")}
            data-tooltip={t("hub.voiceControls.soundboard")}
            aria-label={t("hub.voiceControls.toggleSoundboard")}
            aria-expanded={soundboardOpen}
            onClick={() => {
              const next = !soundboardOpen;
              setSoundboardOpen(next);
              if (next) void loadSoundboardSounds();
            }}
          >
            <Icon name="volume" size="lg" />
            {soundboardSounds.length > 0 && <b>{soundboardSounds.length > 99 ? "99+" : soundboardSounds.length}</b>}
          </button>
          <div className="camera-control-wrap">
            <button
              type="button"
              className="dc-media-action"
              style={voiceActionButtonStyle}
              aria-label={isCameraOn ? t("hub.voiceControls.cameraOff") : t("hub.voiceControls.cameraOn")}
              data-tooltip={isCameraOn ? t("hub.voiceControls.cameraOff") : t("hub.voiceControls.cameraOn")}
              onClick={() => {
                if (isCameraOn) {
                  stopCamera();
                  setCameraSettingsOpen(false);
                } else {
                  setScreenShareSettingsOpen(false);
                  setCameraSettingsOpen((value) => !value);
                }
              }}
            >
              <Icon name={isCameraOn ? "camera-off" : "video"} size="lg" />
              <span className="dc-voice-label">
                {isCameraOn ? t("hub.voiceControls.cameraOffShort") : t("hub.voiceControls.camera")}
              </span>
            </button>
            {cameraSettingsOpen && !isCameraOn && (
              <div className="camera-settings-menu">
                <label>
                  {t("hub.voiceControls.cameraBackground")}
                  <select
                    value={cameraEffect}
                    onChange={(event) => setCameraEffect(event.target.value as CameraEffect)}
                  >
                    <option value="none">{t("hub.voiceControls.effectOff")}</option>
                    <option value="blur">{t("hub.voiceControls.effectBlur")}</option>
                    <option value="replace">{t("hub.voiceControls.effectReplace")}</option>
                  </select>
                </label>
                {cameraEffectNotice && <div className="camera-menu-notice">{cameraEffectNotice}</div>}
                <button
                  type="button"
                  className="dc-media-start-button"
                  onClick={() => {
                    setCameraSettingsOpen(false);
                    void startCamera();
                  }}
                >
                  {t("hub.voiceControls.startCamera")}
                </button>
              </div>
            )}
          </div>
          <div className="camera-control-wrap dc-screen-share-control">
            <button
              type="button"
              className="dc-media-action"
              style={isScreenSharing ? voiceStopShareButtonStyle : voiceShareButtonStyle}
              aria-label={isScreenSharing ? t("hub.voiceControls.stopScreenShare") : t("hub.voiceControls.shareScreen")}
              data-tooltip={isScreenSharing ? t("hub.voiceControls.stopSharing") : t("hub.voiceControls.shareScreen")}
              onClick={() => {
                if (isScreenSharing) {
                  stopScreenShare();
                  setScreenShareSettingsOpen(false);
                } else {
                  setCameraSettingsOpen(false);
                  setScreenShareSettingsOpen((value) => !value);
                }
              }}
            >
              <Icon name="screen" size="lg" />
              <span className="dc-voice-label">
                {isScreenSharing ? t("hub.voiceControls.stopShareShort") : t("hub.voiceControls.shareScreenShort")}
              </span>
            </button>
            {screenShareSettingsOpen && !isScreenSharing && (
              <div className="camera-settings-menu dc-screen-share-settings">
                <label>
                  {t("hub.voiceControls.resolution")}
                  <select
                    value={screenQuality}
                    onChange={(event) => setScreenQuality(event.target.value as ScreenQuality)}
                  >
                    <option value="auto">{t("hub.voiceControls.qualityAuto")}</option>
                    <option value="720p30">{t("hub.voiceControls.quality", { resolution: "720p", fps: 30 })}</option>
                    <option value="1080p30">{t("hub.voiceControls.quality", { resolution: "1080p", fps: 30 })}</option>
                    <option value="1080p60">{t("hub.voiceControls.quality", { resolution: "1080p", fps: 60 })}</option>
                    <option value="1440p30">
                      {t("hub.voiceControls.quality", { resolution: "2K / 1440p", fps: 30 })}
                    </option>
                    <option value="1440p60">
                      {t("hub.voiceControls.quality", { resolution: "2K / 1440p", fps: 60 })}
                    </option>
                  </select>
                </label>
                <label className="camera-toggle-row">
                  <span>
                    <b>{t("hub.voiceControls.systemAudio")}</b>
                    <small>{t("hub.voiceControls.systemAudioHint")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={shareSystemAudio}
                    onChange={(event) => setShareSystemAudio(event.target.checked)}
                  />
                </label>
                <button
                  type="button"
                  className="dc-media-start-button"
                  onClick={() => {
                    setScreenShareSettingsOpen(false);
                    void startScreenShare();
                  }}
                >
                  {t("hub.voiceControls.startSharing")}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="voice-channel-icon-button vr-settings-button"
            onClick={() => {
              setSettingsTab("voice");
              openSettings();
            }}
            aria-label={t("hub.voiceControls.settings")}
            data-tooltip={t("hub.voiceControls.settingsShort")}
            title={t("hub.voiceControls.settings")}
          >
            <Icon name="settings" size="lg" />
          </button>
          <button
            type="button"
            className="dc-voice-disconnect"
            style={voiceDisconnectButtonStyle}
            onClick={leaveVoice}
            aria-label={t("hub.voiceControls.disconnectLabel")}
            data-tooltip={t("hub.voiceControls.leave")}
          >
            <Icon name="phone-off" size="lg" />
            <span className="dc-voice-label">{t("hub.voiceControls.disconnect")}</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="join-button"
          onClick={() => void joinVoice()}
          disabled={connectionStatus !== "Connected" || voiceStatus === "Connecting..."}
        >
          {voiceStatus === "Connecting..."
            ? t("hub.voiceControls.connecting")
            : voiceChannelId !== null
              ? t("hub.voiceControls.switch")
              : t("hub.voiceControls.join")}
        </button>
      )}
    </div>
  );
}
