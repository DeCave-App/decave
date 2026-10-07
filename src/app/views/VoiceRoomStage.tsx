// Voice room stage: participants, screen shares and voice controls.

import type { MouseEvent as ReactMouseEvent, Dispatch, SetStateAction, MutableRefObject } from "react";
import { Icon } from "../../components/Icon";
import { VoiceLobby } from "../../features/voice-room/VoiceLobby";
import type { Channel, Server, AccountUser, VoiceParticipant, UserContextTarget, SoundboardSound } from "../types";
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
              ? voiceStatus === "Connected"
                ? "Connected"
                : voiceStatus
              : currentVoiceParticipants.length > 0
                ? `${currentVoiceParticipants.length} in voice`
                : "Empty"}
          </span>
        </div>
      </header>

      <div className={`dc-soundboard-panel${soundboardOpen ? " open" : ""}`}>
        <div className="dc-soundboard-head">
          <button
            type="button"
            className={`dc-soundboard-toggle${soundboardOpen ? " active" : ""}`}
            title={`Soundboard · ${soundboardSounds.length} shared sound${soundboardSounds.length === 1 ? "" : "s"}`}
            aria-label="Toggle soundboard"
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
              <span>Available to every member in every voice room of {currentServer.name}.</span>
              <label
                className={
                  soundboardBusy ? "ds-btn ds-btn-sm dc-sound-upload disabled" : "ds-btn ds-btn-sm dc-sound-upload"
                }
              >
                <Icon name="upload" />
                Upload Sound
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
                        ? `Play ${sound.name}`
                        : "Join this voice room to play sounds"
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
                      title="Delete sound"
                      aria-label={`Delete ${sound.name}`}
                    >
                      <Icon name="close" size="sm" />
                    </button>
                  )}
                </div>
              ))}
              {soundboardSounds.length === 0 && (
                <div className="ds-empty dc-soundboard-empty">
                  Upload short MP3, WAV, OGG, M4A or WebM sounds for this Hub.
                </div>
              )}
            </div>
            {soundboardNotice && <small className="dc-soundboard-notice">{soundboardNotice}</small>}
          </div>
        )}
      </div>

      {hasActiveScreenShare ? (
        <>
          {activeScreenShareCount > 1 && (
            <div className="dc-screen-layout-toolbar" role="group" aria-label="Screen share layout">
              <span>{activeScreenShareCount} people sharing</span>
              <button
                type="button"
                className={screenGalleryLayout === "focus" ? "active" : ""}
                onClick={() => setScreenGalleryLayout("focus")}
              >
                Focus
              </button>
              <button
                type="button"
                className={screenGalleryLayout === "grid" ? "active" : ""}
                onClick={() => setScreenGalleryLayout("grid")}
              >
                Grid
              </button>
            </div>
          )}
          <div className={`dc-screen-gallery ${screenGalleryLayout}`} style={screenGridStyle}>
            {localScreenStream && (
              <div style={screenCardStyle} className="stream-view-card">
                <div style={screenLabelStyle}>You · screen share</div>
                <ScreenVideo stream={localScreenStream} muted />
                <div className="stream-card-actions">
                  <button
                    type="button"
                    onClick={() => setFocusedVideo({ title: "You · Screen Share", stream: localScreenStream })}
                  >
                    Fullscreen
                  </button>
                  <button type="button" onClick={() => popOutStream("You · Screen Share", localScreenStream)}>
                    Pop Out
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
                  <div style={screenLabelStyle}>{screen.username} · screen share</div>
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
                          <strong>Preview disabled</strong>
                        </div>
                      )}
                      <div className="dc-stream-gate-overlay">
                        <strong>{screen.username} is sharing their screen</strong>
                        <button
                          type="button"
                          onClick={() =>
                            setWatchedScreenConnections((current) => ({ ...current, [screen.connectionId]: true }))
                          }
                        >
                          Start Watching
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
                              title: `${screen.username} · Screen Share`,
                              stream: screen.stream,
                              connectionId: screen.connectionId,
                            })
                          }
                        >
                          Fullscreen
                        </button>
                        <button
                          type="button"
                          onClick={() => popOutStream(`${screen.username} · Screen Share`, screen.stream)}
                        >
                          Pop Out
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
                    <VoiceStatusIcons participant={participant} />
                  </div>
                  <div style={{ color: "var(--ds-muted)", fontSize: "12px" }}>
                    {participant.serverDeafened
                      ? "Server deafened"
                      : participant.selfDeafened
                        ? "Deafened"
                        : participant.muted
                          ? "Muted"
                          : isParticipantSpeaking(participant)
                            ? "Speaking"
                            : "Microphone active"}
                    {participant.screenSharing ? " · Sharing screen" : ""}
                  </div>
                  {participant.serverMuted && <div className="voice-moderation-badge">Server muted</div>}
                  {participant.serverDeafened && <div className="voice-moderation-badge">Server deafened</div>}
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
                        Start Watching
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
              <div>You · Camera</div>
              <ScreenVideo stream={localCameraStream} muted />
              <div className="stream-card-actions">
                <button
                  type="button"
                  onClick={() => setFocusedVideo({ title: "You · Camera", stream: localCameraStream })}
                >
                  Fullscreen
                </button>
                <button type="button" onClick={() => popOutStream("You · Camera", localCameraStream)}>
                  Pop Out
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
                  onClick={() => setFocusedVideo({ title: `${camera.username} · Camera`, stream: camera.stream })}
                >
                  Fullscreen
                </button>
                <button type="button" onClick={() => popOutStream(`${camera.username} · Camera`, camera.stream)}>
                  Pop Out
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
              <strong>Connecting to {currentChannel.name}…</strong>
              <span>Participants will appear here as they connect.</span>
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
                    </strong>
                    <VoiceStatusIcons participant={participant} standalone />
                    <small>
                      {participant.serverDeafened
                        ? "Server deafened"
                        : participant.selfDeafened
                          ? "Deafened"
                          : participant.serverMuted
                            ? "Server muted"
                            : isParticipantSpeaking(participant)
                              ? "Speaking"
                              : participant.muted
                                ? "Muted"
                                : "Connected"}
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
