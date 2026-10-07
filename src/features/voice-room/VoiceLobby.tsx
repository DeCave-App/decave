import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import "./voiceRoom.css";

export type LobbyParticipant = {
  connectionId: string;
  username: string;
  screenSharing: boolean;
};

export type VoiceLobbyProps<P extends LobbyParticipant> = {
  roomName: string;
  participants: P[];
  renderAvatar: (participant: P) => ReactNode;
  isSpeaking: (participant: P) => boolean;
  /** True while another voice room is connected (button reads "Switch"). */
  inOtherRoom: boolean;
  connecting: boolean;
  canJoin: boolean;
  error: string;
  joinMuted: boolean;
  onJoinMutedChange: (value: boolean) => void;
  onJoin: () => void;
};

/** Pre-join voice stage: shows who is inside and a large circular Join button. */
export function VoiceLobby<P extends LobbyParticipant>(props: VoiceLobbyProps<P>) {
  const count = props.participants.length;
  const label = props.connecting ? "Connecting…" : props.inOtherRoom ? "Switch here" : "Join";

  const joinControl = (
    <div className="vr-join-wrap">
      <button
        type="button"
        className={`vr-join-orb${props.connecting ? " connecting" : ""}`}
        onClick={props.onJoin}
        disabled={!props.canJoin || props.connecting}
        aria-label={
          props.connecting
            ? "Connecting to voice"
            : props.inOtherRoom
              ? `Switch to ${props.roomName}`
              : `Join ${props.roomName}`
        }
      >
        <Icon name="mic" size="xl" />
        <span>{label}</span>
      </button>
      <label className="vr-join-muted" title="Join with your microphone muted">
        <input
          type="checkbox"
          checked={props.joinMuted}
          onChange={(event) => props.onJoinMutedChange(event.target.checked)}
        />
        <span>Join muted</span>
      </label>
      {!props.canJoin && !props.connecting && (
        <small className="vr-lobby-hint">Waiting for the realtime connection…</small>
      )}
      {props.error && (
        <div className="vr-lobby-error" role="alert">
          {props.error}
        </div>
      )}
    </div>
  );

  return (
    <div className={`vr-lobby${count === 0 ? " empty" : ""}`} aria-label={`${props.roomName} voice room`}>
      {count === 0 ? (
        <div className="vr-lobby-empty">
          {joinControl}
          <p>It's quiet in here. Join and others will see you in the sidebar.</p>
        </div>
      ) : (
        <>
          <ul className="vr-tile-grid" aria-label="Already in this room">
            {props.participants.map((participant) => (
              <li
                key={participant.connectionId}
                className={`vr-tile${props.isSpeaking(participant) ? " speaking" : ""}`}
                title={participant.username}
              >
                <span className="vr-tile-avatar">{props.renderAvatar(participant)}</span>
                <span className="vr-tile-name">{participant.username}</span>
                {participant.screenSharing && (
                  <b className="vr-tile-live">
                    <Icon name="screen" size="sm" />
                    LIVE
                  </b>
                )}
              </li>
            ))}
          </ul>
          <div className="vr-lobby-join">{joinControl}</div>
        </>
      )}
    </div>
  );
}
