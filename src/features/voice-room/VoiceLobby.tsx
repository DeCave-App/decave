import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["common", "voice"]);
  const count = props.participants.length;
  const label = props.connecting
    ? t("voice.lobby.connecting")
    : props.inOtherRoom
      ? t("voice.lobby.switchHere")
      : t("voice.lobby.join");

  const joinControl = (
    <div className="vr-join-wrap">
      <button
        type="button"
        className={`vr-join-orb${props.connecting ? " connecting" : ""}`}
        onClick={props.onJoin}
        disabled={!props.canJoin || props.connecting}
        aria-label={
          props.connecting
            ? t("voice.lobby.connectingAria")
            : props.inOtherRoom
              ? t("voice.lobby.switchToRoom", { room: props.roomName })
              : t("voice.lobby.joinRoom", { room: props.roomName })
        }
      >
        <Icon name="mic" size="xl" />
        <span>{label}</span>
      </button>
      <label className="vr-join-muted" title={t("voice.lobby.joinMutedTitle")}>
        <input
          type="checkbox"
          checked={props.joinMuted}
          onChange={(event) => props.onJoinMutedChange(event.target.checked)}
        />
        <span>{t("voice.lobby.joinMuted")}</span>
      </label>
      {!props.canJoin && !props.connecting && (
        <small className="vr-lobby-hint">{t("voice.lobby.waitingForRealtime")}</small>
      )}
      {props.error && (
        <div className="vr-lobby-error" role="alert">
          {props.error}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`vr-lobby${count === 0 ? " empty" : ""}`}
      aria-label={t("voice.lobby.roomAria", { room: props.roomName })}
    >
      {count === 0 ? (
        <div className="vr-lobby-empty">
          {joinControl}
          <p>{t("voice.lobby.empty")}</p>
        </div>
      ) : (
        <>
          <ul className="vr-tile-grid" aria-label={t("voice.lobby.alreadyInRoom")}>
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
                    {t("voice.lobby.live")}
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
