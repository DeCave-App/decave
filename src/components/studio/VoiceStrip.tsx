import { useTranslation } from "react-i18next";

export type StudioVoiceParticipant = {
  id: string;
  name: string;
  avatarUrl?: string;
  speaking?: boolean;
};

type VoiceStripProps = {
  roomName: string;
  participantCount: number;
  participants?: readonly StudioVoiceParticipant[];
  connectionState: "connected" | "connecting" | "reconnecting" | "disconnected";
  muted: boolean;
  deafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
  onOpenDetails?: () => void;
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

/** Persistent voice context for the studio shell. State comes from VoiceSession. */
export function VoiceStrip({
  roomName,
  participantCount,
  participants = [],
  connectionState,
  muted,
  deafened,
  onToggleMute,
  onToggleDeafen,
  onLeave,
  onOpenDetails,
}: VoiceStripProps) {
  const { t } = useTranslation(["social"]);
  const stateLabel =
    connectionState === "connected"
      ? t("social.studio.voice.connected")
      : connectionState === "reconnecting"
        ? t("social.studio.voice.reconnecting")
        : connectionState === "connecting"
          ? t("social.studio.voice.joining")
          : t("social.studio.voice.disconnected");
  const contextContent = (
    <>
      <i aria-hidden="true" />
      <span>
        <strong>{stateLabel}</strong>
        <small>{t("social.studio.voice.people", { room: roomName, count: participantCount })}</small>
      </span>
    </>
  );
  return (
    <footer className="dc-studio-voice-strip" data-connection={connectionState}>
      {onOpenDetails ? (
        <button
          type="button"
          className="dc-studio-voice-context"
          onClick={onOpenDetails}
          aria-label={t("social.studio.voice.details", { room: roomName })}
        >
          {contextContent}
        </button>
      ) : (
        <div className="dc-studio-voice-context">{contextContent}</div>
      )}
      <div className="dc-studio-voice-participants" aria-label={t("social.studio.voice.participants")}>
        {participants.slice(0, 4).map((participant) =>
          participant.avatarUrl ? (
            <img
              key={participant.id}
              className={participant.speaking ? "is-speaking" : undefined}
              src={participant.avatarUrl}
              alt={participant.name}
            />
          ) : (
            <span
              key={participant.id}
              className={participant.speaking ? "is-speaking" : undefined}
              title={participant.name}
            >
              {initials(participant.name)}
            </span>
          ),
        )}
      </div>
      <div className="dc-studio-voice-actions">
        <button type="button" className={muted ? "is-active" : undefined} aria-pressed={muted} onClick={onToggleMute}>
          {muted ? t("social.studio.voice.unmute") : t("social.studio.voice.mute")}
        </button>
        <button
          type="button"
          className={deafened ? "is-active" : undefined}
          aria-pressed={deafened}
          onClick={onToggleDeafen}
        >
          {deafened ? t("social.studio.voice.undeafen") : t("social.studio.voice.deafen")}
        </button>
        <button type="button" className="is-leave" onClick={onLeave}>
          {t("social.studio.voice.leave")}
        </button>
      </div>
    </footer>
  );
}
