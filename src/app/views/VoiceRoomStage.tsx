// Voice room stage: participants, screen shares and voice controls.

import { connectionStatusLabel } from "./statusLabels";
import { useTranslation } from "react-i18next";
import type { MouseEvent as ReactMouseEvent, Dispatch, SetStateAction, MutableRefObject } from "react";
import { Icon } from "../../components/Icon";
import { VoiceLobby } from "../../features/voice-room/VoiceLobby";
import type { Channel, Server, AccountUser, VoiceParticipant, UserContextTarget, SoundboardSound } from "../types";
import { CallVerificationMark } from "../../e2ee/DmEncryptionUi";
import { formatRtcBitrate } from "../format";
import { UserAvatar } from "../components/UserAvatar";
import { VoiceStatusIcons } from "../components/VoiceStatusIcons";
import { ScreenVideo } from "../components/ScreenVideo";
import {
  voiceStageStyle,
  screenGridStyle,
  screenCardStyle,
  screenLabelStyle,
  voiceParticipantGridStyle,
  voiceParticipantCardStyle,
  voiceParticipantAvatarStyle,
} from "../inline-styles";
import type { SoundboardState } from "../state/soundboard";
import type { VoiceCallState } from "../state/voice-call";
import type { CallMediaState } from "../state/call-media";
import type { VoiceControlActions } from "../actions/voice-controls";

type Props = {
  currentUser: AccountUser;
  connectionStatus: string;
  lobbyPendingJoinRef: MutableRefObject<{ channelId: number; muted: boolean; camera: boolean } | null>;
  voiceChannelId: number | null;
  setFocusedVideo: Dispatch<SetStateAction<{ title: string; stream: MediaStream; connectionId?: string } | null>>;
  audioOutputError: string;
  selfConnectionIdRef: MutableRefObject<string>;
  currentServer: Server;
  currentChannel: Channel;
  canManageCurrentServer: boolean;
  openUserContextMenu: (event: ReactMouseEvent, target: UserContextTarget) => void;
  setScreenPlaybackMuted: (connectionId: string, muted: boolean) => void;
  isParticipantSpeaking: (participant: VoiceParticipant) => boolean;
  joinVoice: () => Promise<void>;
  playSoundboardSound: (sound: SoundboardSound) => void;
  popOutStream: (title: string, stream: MediaStream) => void;
  currentVoiceParticipants: VoiceParticipant[];
  hasActiveScreenShare: boolean;
  activeScreenShareCount: number;
  hasActiveCamera: boolean;
  soundboard: SoundboardState;
  voiceCall: VoiceCallState;
  callMedia: CallMediaState;
  voiceControls: VoiceControlActions;
};

export function VoiceRoomStage({
  currentUser,
  connectionStatus,
  lobbyPendingJoinRef,
  voiceChannelId,
  setFocusedVideo,
  audioOutputError,
  selfConnectionIdRef,
  currentServer,
  currentChannel,
  canManageCurrentServer,
  openUserContextMenu,
  setScreenPlaybackMuted,
  isParticipantSpeaking,
  joinVoice,
  playSoundboardSound,
  popOutStream,
  currentVoiceParticipants,
  hasActiveScreenShare,
  activeScreenShareCount,
  hasActiveCamera,
  soundboard,
  voiceCall,
  callMedia,
  voiceControls,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const { loadSoundboardSounds, uploadSoundboardSound, deleteSoundboardSound } = voiceControls;
  const {
    watchedScreenConnections,
    setWatchedScreenConnections,
    localScreenStream,
    localCameraStream,
    remoteScreens,
    screenAudioMuted,
    remoteCameras,
    screenGalleryLayout,
    setScreenGalleryLayout,
  } = callMedia;
  const { soundboardNotice, rtcStats, lobbyJoinMuted, setLobbyJoinMuted, voiceStatus, voiceError } = voiceCall;
  const { soundboardSounds, soundboardBusy, soundboardOpen, setSoundboardOpen } = soundboard;
  return (
    <div
      className={`voice-stage-shell vr-stage-shell${voiceChannelId === currentChannel.id ? " vr-connected" : ""}`}
      style={voiceStageStyle}
    >
      <header className="vr-stage-head">
        <span className="vr-stage-head-icon" aria-hidden="true">
          {currentChannel.icon || "◉"}
        </span>
        <div className="vr-stage-head-copy">
          <h2>{currentChannel.name}</h2>
          <span className={`vr-stage-status${voiceChannelId === currentChannel.id ? " live" : ""}`}>
            {voiceChannelId === currentChannel.id
              ? connectionStatusLabel(voiceStatus)
              : currentVoiceParticipants.length > 0
                ? t("hub.voiceStage.inVoice", { count: currentVoiceParticipants.length })
                : t("hub.voiceStage.empty")}
          </span>
        </div>
      </header>

      <div className={`dc-soundboard-panel${soundboardOpen ? " open" : ""}`}>
        <div className="dc-soundboard-head">
          <button
            type="button"
            className={`dc-soundboard-toggle${soundboardOpen ? " active" : ""}`}
            title={t("hub.voiceStage.soundboardTitle", { count: soundboardSounds.length })}
            aria-label={t("hub.voiceControls.toggleSoundboard")}
            onClick={() => {
              const next = !soundboardOpen;
              setSoundboardOpen(next);
              if (next) void loadSoundboardSounds();
            }}
            aria-expanded={soundboardOpen}
          >
            <span className="dc-soundboard-toggle-icon">
              <Icon name="volume" />
            </span>
            {soundboardSounds.length > 0 && <b>{soundboardSounds.length > 99 ? "99+" : soundboardSounds.length}</b>}
            <i aria-hidden="true">
              <Icon name={soundboardOpen ? "chevron-up" : "chevron-down"} size="sm" />
            </i>
          </button>
        </div>
        {soundboardOpen && (
          <div className="dc-soundboard-expanded">
            <div className="dc-soundboard-tools">
              <span>{t("hub.voiceStage.soundboardScope", { hub: currentServer.name })}</span>
              <label
                className={
                  soundboardBusy ? "ds-btn ds-btn-sm dc-sound-upload disabled" : "ds-btn ds-btn-sm dc-sound-upload"
                }
              >
                <Icon name="upload" />
                {t("hub.voiceStage.uploadSound")}
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm"
                  disabled={soundboardBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void uploadSoundboardSound(file);
                  }}
                />
              </label>
            </div>
            <div className="dc-soundboard-grid">
              {soundboardSounds.map((sound) => (
                <div className="dc-soundboard-item" key={sound.id}>
                  <button
                    type="button"
                    disabled={voiceChannelId !== currentChannel.id}
                    onClick={() => playSoundboardSound(sound)}
                    title={
                      voiceChannelId === currentChannel.id
                        ? t("hub.voiceStage.playSound", { name: sound.name })
                        : t("hub.voiceStage.joinToPlay")
                    }
                  >
                    <span>
                      <Icon name="volume" size="sm" />
                    </span>
                    <strong>{sound.name}</strong>
                  </button>
                  {(sound.uploaderUserId === currentUser?.id || canManageCurrentServer) && (
                    <button
                      type="button"
                      className="delete"
                      disabled={soundboardBusy}
                      onClick={() => void deleteSoundboardSound(sound)}
                      title={t("hub.voiceStage.deleteSound")}
                      aria-label={t("hub.voiceStage.deleteSoundNamed", { name: sound.name })}
                    >
                      <Icon name="close" size="sm" />
                    </button>
                  )}
                </div>
              ))}
              {soundboardSounds.length === 0 && (
                <div className="ds-empty dc-soundboard-empty">{t("hub.voiceStage.soundboardEmpty")}</div>
              )}
            </div>
            {soundboardNotice && <small className="dc-soundboard-notice">{soundboardNotice}</small>}
          </div>
        )}
      </div>

      {hasActiveScreenShare ? (
        <>
          {activeScreenShareCount > 1 && (
            <div className="dc-screen-layout-toolbar" role="group" aria-label={t("hub.voiceStage.layoutLabel")}>
              <span>{t("hub.voiceStage.peopleSharing", { count: activeScreenShareCount })}</span>
              <button
                type="button"
                className={screenGalleryLayout === "focus" ? "active" : ""}
                onClick={() => setScreenGalleryLayout("focus")}
              >
                {t("hub.voiceStage.layoutFocus")}
              </button>
              <button
                type="button"
                className={screenGalleryLayout === "grid" ? "active" : ""}
                onClick={() => setScreenGalleryLayout("grid")}
              >
                {t("hub.voiceStage.layoutGrid")}
              </button>
            </div>
          )}
          <div className={`dc-screen-gallery ${screenGalleryLayout}`} style={screenGridStyle}>
            {localScreenStream && (
              <div style={screenCardStyle} className="stream-view-card">
                <div style={screenLabelStyle}>{t("hub.voiceStage.youScreenShare")}</div>
                <ScreenVideo stream={localScreenStream} muted />
                <div className="stream-card-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setFocusedVideo({ title: t("hub.voiceStage.youScreenShareTitle"), stream: localScreenStream })
                    }
                  >
                    {t("hub.voiceStage.fullscreen")}
                  </button>
                  <button
                    type="button"
                    onClick={() => popOutStream(t("hub.voiceStage.youScreenShareTitle"), localScreenStream)}
                  >
                    {t("hub.streamFocus.popOut")}
                  </button>
                </div>
              </div>
            )}
            {Object.values(remoteScreens).map((screen) => {
              const participant = currentVoiceParticipants.find((item) => item.connectionId === screen.connectionId);
              const watching = watchedScreenConnections[screen.connectionId] === true;
              const previewAllowed = participant?.allowStreamPreview !== false;
              return (
                <div
                  key={screen.connectionId}
                  style={screenCardStyle}
                  className={`stream-view-card${watching ? " watching" : " awaiting-watch"}`}
                >
                  <div style={screenLabelStyle}>{t("hub.voiceStage.userScreenShare", { name: screen.username })}</div>
                  {watching ? (
                    <ScreenVideo
                      stream={screen.stream}
                      muted={screenAudioMuted[screen.connectionId] === true}
                      onMutedChange={(muted) => setScreenPlaybackMuted(screen.connectionId, muted)}
                    />
                  ) : (
                    <div className="dc-stream-gate">
                      {previewAllowed ? (
                        <div className="dc-stream-preview">
                          <ScreenVideo stream={screen.stream} muted />
                        </div>
                      ) : (
                        <div className="dc-stream-preview-hidden">
                          <span>
                            <Icon name="screen" size="lg" />
                          </span>
                          <strong>{t("hub.voiceStage.previewDisabled")}</strong>
                        </div>
                      )}
                      <div className="dc-stream-gate-overlay">
                        <strong>{t("hub.voiceStage.isSharing", { name: screen.username })}</strong>
                        <button
                          type="button"
                          onClick={() =>
                            setWatchedScreenConnections((current) => ({ ...current, [screen.connectionId]: true }))
                          }
                        >
                          {t("hub.voiceStage.startWatching")}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="stream-card-actions">
                    <span>{formatRtcBitrate(rtcStats[screen.connectionId]?.bitrateKbps)}</span>
                    {watching && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setFocusedVideo({
                              title: t("hub.voiceStage.userScreenShareTitle", { name: screen.username }),
                              stream: screen.stream,
                              connectionId: screen.connectionId,
                            })
                          }
                        >
                          {t("hub.voiceStage.fullscreen")}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            popOutStream(
                              t("hub.voiceStage.userScreenShareTitle", { name: screen.username }),
                              screen.stream,
                            )
                          }
                        >
                          {t("hub.streamFocus.popOut")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setWatchedScreenConnections((current) => ({ ...current, [screen.connectionId]: false }));
                            setFocusedVideo((current) =>
                              current?.connectionId === screen.connectionId ? null : current,
                            );
                          }}
                        >
                          {t("hub.voiceStage.stopWatching")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="voice-participant-grid" style={voiceParticipantGridStyle}>
            {currentVoiceParticipants.map((participant) => (
              <div
                key={participant.connectionId}
                style={voiceParticipantCardStyle}
                className={
                  isParticipantSpeaking(participant)
                    ? "user-context-target voice-participant-card speaking"
                    : "user-context-target voice-participant-card"
                }
                onClick={(event) => {
                  if (participant.connectionId === selfConnectionIdRef.current) {
                    openUserContextMenu(event, {
                      userId: participant.userId,
                      username: participant.username,
                      avatarUrl: participant.avatarUrl,
                      role: participant.role,
                      connectionId: participant.connectionId,
                      voiceParticipant: participant,
                    });
                  }
                }}
                onContextMenu={(event) =>
                  openUserContextMenu(event, {
                    userId: participant.userId,
                    username: participant.username,
                    avatarUrl: participant.avatarUrl,
                    role: participant.role,
                    connectionId: participant.connectionId,
                    voiceParticipant: participant,
                  })
                }
              >
                <div className="voice-participant-avatar-shell">
                  <UserAvatar
                    username={participant.username}
                    avatarUrl={participant.avatarUrl}
                    style={voiceParticipantAvatarStyle}
                  />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className={
                      isParticipantSpeaking(participant) ? "voice-speaker-name speaking" : "voice-speaker-name"
                    }
                  >
                    <span>{participant.username}</span>
                    <CallVerificationMark connectionId={participant.connectionId} />
                    <VoiceStatusIcons participant={participant} />
                  </div>
                  <div style={{ color: "var(--ds-muted)", fontSize: "12px" }}>
                    {t(participant.screenSharing ? "hub.voiceStage.stateSharing" : "hub.voiceStage.state", {
                      state: participant.serverDeafened
                        ? t("hub.voiceControls.serverDeafened")
                        : participant.selfDeafened
                          ? t("hub.voiceStage.deafened")
                          : participant.muted
                            ? t("hub.voiceStage.muted")
                            : isParticipantSpeaking(participant)
                              ? t("hub.voiceStage.speaking")
                              : t("hub.voiceStage.micActive"),
                    })}
                  </div>
                  {participant.serverMuted && (
                    <div className="voice-moderation-badge">{t("hub.voiceControls.serverMuted")}</div>
                  )}
                  {participant.serverDeafened && (
                    <div className="voice-moderation-badge">{t("hub.voiceControls.serverDeafened")}</div>
                  )}
                  {participant.screenSharing &&
                    participant.connectionId !== selfConnectionIdRef.current &&
                    watchedScreenConnections[participant.connectionId] !== true && (
                      <button
                        type="button"
                        className="dc-participant-watch"
                        onClick={(event) => {
                          event.stopPropagation();
                          setWatchedScreenConnections((current) => ({ ...current, [participant.connectionId]: true }));
                        }}
                      >
                        {t("hub.voiceStage.startWatching")}
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : hasActiveCamera ? (
        <div className="camera-stage-grid">
          {localCameraStream && (
            <div className="camera-stage-card">
              <div>{t("hub.voiceStage.youCamera")}</div>
              <ScreenVideo stream={localCameraStream} muted />
              <div className="stream-card-actions">
                <button
                  type="button"
                  onClick={() => setFocusedVideo({ title: t("hub.voiceStage.youCamera"), stream: localCameraStream })}
                >
                  {t("hub.voiceStage.fullscreen")}
                </button>
                <button type="button" onClick={() => popOutStream(t("hub.voiceStage.youCamera"), localCameraStream)}>
                  {t("hub.streamFocus.popOut")}
                </button>
              </div>
            </div>
          )}
          {Object.values(remoteCameras).map((camera) => (
            <div className="camera-stage-card" key={camera.connectionId}>
              <div>{camera.username}</div>
              <ScreenVideo stream={camera.stream} />
              <div className="stream-card-actions">
                <span>
                  {rtcStats[camera.connectionId] ? formatRtcBitrate(rtcStats[camera.connectionId].bitrateKbps) : ""}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFocusedVideo({
                      title: t("hub.voiceStage.userCamera", { name: camera.username }),
                      stream: camera.stream,
                    })
                  }
                >
                  {t("hub.voiceStage.fullscreen")}
                </button>
                <button
                  type="button"
                  onClick={() => popOutStream(t("hub.voiceStage.userCamera", { name: camera.username }), camera.stream)}
                >
                  {t("hub.streamFocus.popOut")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : voiceChannelId !== currentChannel.id ? (
        <VoiceLobby
          roomName={currentChannel.name}
          participants={currentVoiceParticipants}
          renderAvatar={(participant) => (
            <UserAvatar username={participant.username} avatarUrl={participant.avatarUrl} />
          )}
          isSpeaking={isParticipantSpeaking}
          inOtherRoom={voiceChannelId !== null}
          connecting={voiceStatus === "Connecting..."}
          canJoin={connectionStatus === "Connected"}
          error={voiceError || audioOutputError}
          joinMuted={lobbyJoinMuted}
          onJoinMutedChange={setLobbyJoinMuted}
          onJoin={() => {
            lobbyPendingJoinRef.current = { channelId: currentChannel.id, muted: lobbyJoinMuted, camera: false };
            void joinVoice();
          }}
        />
      ) : (
        <div className="voice-presence-stage">
          {currentVoiceParticipants.length === 0 ? (
            <div className="voice-presence-empty">
              <div className="voice-presence-empty-icon">
                <Icon name="mic" size="xl" />
              </div>
              <strong>{t("hub.voiceStage.connectingTo", { room: currentChannel.name })}</strong>
              <span>{t("hub.voiceStage.participantsHint")}</span>
            </div>
          ) : (
            <>
              <div className="voice-presence-grid">
                {currentVoiceParticipants.map((participant) => (
                  <div
                    key={participant.connectionId}
                    className={
                      isParticipantSpeaking(participant)
                        ? "voice-presence-person user-context-target speaking"
                        : "voice-presence-person user-context-target"
                    }
                    onClick={(event) => {
                      if (participant.connectionId === selfConnectionIdRef.current) {
                        openUserContextMenu(event, {
                          userId: participant.userId,
                          username: participant.username,
                          avatarUrl: participant.avatarUrl,
                          role: participant.role,
                          connectionId: participant.connectionId,
                          voiceParticipant: participant,
                        });
                      }
                    }}
                    onContextMenu={(event) =>
                      openUserContextMenu(event, {
                        userId: participant.userId,
                        username: participant.username,
                        avatarUrl: participant.avatarUrl,
                        role: participant.role,
                        connectionId: participant.connectionId,
                        voiceParticipant: participant,
                      })
                    }
                  >
                    <div className="voice-presence-avatar-shell">
                      <UserAvatar username={participant.username} avatarUrl={participant.avatarUrl} />
                    </div>
                    <strong
                      className={
                        isParticipantSpeaking(participant) ? "voice-speaker-name speaking" : "voice-speaker-name"
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        minWidth: 0,
                      }}
                    >
                      <span>{participant.username}</span>
                      <CallVerificationMark connectionId={participant.connectionId} />
                    </strong>
                    <VoiceStatusIcons participant={participant} standalone />
                    <small>
                      {participant.serverDeafened
                        ? t("hub.voiceControls.serverDeafened")
                        : participant.selfDeafened
                          ? t("hub.voiceStage.deafened")
                          : participant.serverMuted
                            ? t("hub.voiceControls.serverMuted")
                            : isParticipantSpeaking(participant)
                              ? t("hub.voiceStage.speaking")
                              : participant.muted
                                ? t("hub.voiceStage.muted")
                                : t("common.connection.connected")}
                    </small>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
