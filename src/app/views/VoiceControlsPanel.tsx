// Voice controls under a connected voice room: mute, deafen, camera, screen share, soundboard, leave.

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
      aria-label={`Voice controls for ${currentServer.name} · ${currentChannel.name}`}
      style={voiceControlBarStyle}
    >
      <div style={{ minWidth: "160px" }}>
        <div className="voice-status-row">
          <div className="voice-status">{voiceChannelId === currentChannel.id ? "Voice Connected" : "Voice Room"}</div>
          {voiceChannelId === currentChannel.id && (
            <span className={`dc-voice-quality ${voiceQuality ?? "waiting"}`} title="Measured round-trip voice latency">
              {ownVoiceRttMs === null
                ? voiceStatus === "Connecting..."
                  ? "Connecting…"
                  : "Live"
                : `${ownVoiceRttMs} ms`}
            </span>
          )}
        </div>
        <div style={{ color: voiceError ? "var(--ds-danger)" : "var(--ds-muted)", fontSize: "var(--ds-text-xs)" }}>
          {voiceError ||
            audioOutputError ||
            cameraEffectNotice ||
            (isServerMuted || isServerDeafened
              ? `${isServerMuted ? "Server muted" : ""}${isServerMuted && isServerDeafened ? " · " : ""}${isServerDeafened ? "Server deafened" : ""}`
              : voiceChannelId === currentChannel.id
                ? audioSettings.inputVolume === 0
                  ? "Microphone input volume is 0%"
                  : audioSettings.pushToTalk
                    ? `Hold ${audioSettings.pushToTalkKey.replace(/^Key/, "")} to talk`
                    : `${voiceParticipants.filter((p) => p.channelId === currentChannel.id).length} connected`
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
            aria-label={isServerMuted ? "Server muted" : isMuted ? "Unmute" : "Mute"}
            aria-pressed={isMuted || isServerMuted}
            data-tooltip={isServerMuted ? "Server muted" : isMuted ? "Unmute" : "Mute"}
            title={isServerMuted ? "A hub moderator has server-muted you." : isMuted ? "Unmute" : "Mute"}
          >
            <Icon name={isMuted || isServerMuted ? "mic-off" : "mic"} size="lg" />
          </button>
          <button
            type="button"
            className={`voice-channel-icon-button${isDeafened || isServerDeafened ? " active" : ""}`}
            onClick={toggleDeafen}
            disabled={isServerDeafened}
            aria-label={isServerDeafened ? "Server deafened" : isDeafened ? "Undeafen" : "Deafen"}
            aria-pressed={isDeafened || isServerDeafened}
            data-tooltip={isServerDeafened ? "Server deafened" : isDeafened ? "Undeafen" : "Deafen"}
            title={isServerDeafened ? "A hub moderator has server-deafened you." : isDeafened ? "Undeafen" : "Deafen"}
          >
            <Icon name={isDeafened || isServerDeafened ? "headphones-off" : "headphones"} size="lg" />
          </button>
          <button
            type="button"
            className={`voice-channel-icon-button voice-noise-button${activeNoiseSuppressionMode !== "off" ? " noise-active" : ""}`}
            onClick={cycleNoiseSuppression}
            aria-label={`Noise suppression: ${noiseSuppressionLabel(activeNoiseSuppressionMode)}. Click to switch mode.`}
            data-tooltip={`Noise suppression: ${noiseSuppressionLabel(activeNoiseSuppressionMode)} · Click to switch`}
            title={`Noise suppression: ${noiseSuppressionLabel(activeNoiseSuppressionMode)}. Click to switch mode.`}
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
            title="Soundboard"
            data-tooltip="Soundboard"
            aria-label="Toggle soundboard"
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
              aria-label={isCameraOn ? "Turn camera off" : "Turn camera on"}
              data-tooltip={isCameraOn ? "Turn camera off" : "Turn camera on"}
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
              <span className="dc-voice-label">{isCameraOn ? "Camera Off" : "Camera"}</span>
            </button>
            {cameraSettingsOpen && !isCameraOn && (
              <div className="camera-settings-menu">
                <label>
                  Camera background
                  <select
                    value={cameraEffect}
                    onChange={(event) => setCameraEffect(event.target.value as CameraEffect)}
                  >
                    <option value="none">Off</option>
                    <option value="blur">Blur</option>
                    <option value="replace">Replace background</option>
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
                  Start Camera
                </button>
              </div>
            )}
          </div>
          <div className="camera-control-wrap dc-screen-share-control">
            <button
              type="button"
              className="dc-media-action"
              style={isScreenSharing ? voiceStopShareButtonStyle : voiceShareButtonStyle}
              aria-label={isScreenSharing ? "Stop screen sharing" : "Share screen"}
              data-tooltip={isScreenSharing ? "Stop sharing" : "Share screen"}
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
              <span className="dc-voice-label">{isScreenSharing ? "Stop Share" : "Share Screen"}</span>
            </button>
            {screenShareSettingsOpen && !isScreenSharing && (
              <div className="camera-settings-menu dc-screen-share-settings">
                <label>
                  Resolution &amp; frame rate
                  <select
                    value={screenQuality}
                    onChange={(event) => setScreenQuality(event.target.value as ScreenQuality)}
                  >
                    <option value="auto">Auto</option>
                    <option value="720p30">720p · 30 FPS</option>
                    <option value="1080p30">1080p · 30 FPS</option>
                    <option value="1080p60">1080p · 60 FPS</option>
                    <option value="1440p30">2K / 1440p · 30 FPS</option>
                    <option value="1440p60">2K / 1440p · 60 FPS</option>
                  </select>
                </label>
                <label className="camera-toggle-row">
                  <span>
                    <b>System audio</b>
                    <small>{"Share computer sound with viewers"}</small>
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
                  Start Sharing
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
            aria-label="Voice & audio settings"
            data-tooltip="Voice settings"
            title="Voice & audio settings"
          >
            <Icon name="settings" size="lg" />
          </button>
          <button
            type="button"
            className="dc-voice-disconnect"
            style={voiceDisconnectButtonStyle}
            onClick={leaveVoice}
            aria-label="Disconnect from voice"
            data-tooltip="Leave voice"
          >
            <Icon name="phone-off" size="lg" />
            <span className="dc-voice-label">Disconnect</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="join-button"
          onClick={() => void joinVoice()}
          disabled={connectionStatus !== "Connected" || voiceStatus === "Connecting..."}
        >
          {voiceStatus === "Connecting..." ? "Connecting..." : voiceChannelId !== null ? "Switch Voice" : "Join Voice"}
        </button>
      )}
    </div>
  );
}
