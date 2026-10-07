import type { VoiceParticipant } from "../types";

export function VoiceStatusIcons({
  participant,
  standalone = false,
}: {
  participant: VoiceParticipant;
  standalone?: boolean;
}) {
  const deafened =
    participant.deafened === true || participant.selfDeafened === true || participant.serverDeafened === true;
  const muted =
    deafened || participant.muted === true || participant.selfMuted === true || participant.serverMuted === true;

  if (!muted && !deafened) return null;

  return (
    <span className={`voice-status-icons${standalone ? " standalone" : ""}`}>
      {muted && (
        <span
          className="voice-status-icon"
          title={participant.serverMuted ? "Server muted" : "Muted"}
          aria-label={participant.serverMuted ? "Server muted" : "Muted"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
            <path
              d="M6.5 11.5A5.5 5.5 0 0 0 16 15.28M12 17v4M8.5 21h7M4 4l16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}

      {deafened && (
        <span
          className="voice-status-icon"
          title={participant.serverDeafened ? "Server deafened" : "Deafened"}
          aria-label={participant.serverDeafened ? "Server deafened" : "Deafened"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 13v-2a8 8 0 0 1 13.7-5.64M4 13h3v6H5a1 1 0 0 1-1-1v-5ZM17 13h3v5a1 1 0 0 1-1 1h-2v-6ZM4 4l16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </span>
  );
}
