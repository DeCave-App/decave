import { UserAvatar } from "../../app/components/UserAvatar";
import "./hubSidebar.css";

export type VoicePanelParticipant = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  speaking: boolean;
};

const MAX_VOICE_AVATARS = 4;

export type VoicePanelProps = {
  roomName: string;
  hubName?: string;
  status: string;
  quality: "good" | "fair" | "poor" | null;
  rttMs: number | null;
  participants: readonly VoicePanelParticipant[];
  muted: boolean;
  serverMuted: boolean;
  deafened: boolean;
  serverDeafened: boolean;
  screenSharing: boolean;
  onOpenRoom: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onDisconnect: () => void;
};

/** Compact voice controls shown at the bottom of the Hub sidebar. */
export function VoicePanel(props: VoicePanelProps) {
  const connecting = props.status === "Connecting...";
  const qualityLabel = connecting
    ? "Connecting…"
    : props.rttMs === null
      ? "Voice connected"
      : `Voice connected · ${props.rttMs} ms`;
  return (
    <div className="hsb-voice-panel" role="region" aria-label="Voice connection">
      <button type="button" className="hsb-voice-panel-info" onClick={props.onOpenRoom} title="Open voice room">
        <span
          className={`hsb-voice-panel-signal ${connecting ? "waiting" : (props.quality ?? "waiting")}`}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </span>
        <span className="hsb-voice-panel-copy">
          <strong>{qualityLabel}</strong>
          <small>
            {props.roomName}
            {props.hubName ? ` / ${props.hubName}` : ""}
          </small>
        </span>
        {props.participants.length > 0 && (
          <span
            className="hsb-voice-panel-people"
            aria-label={`${props.participants.length} ${props.participants.length === 1 ? "person" : "people"} in voice`}
          >
            {props.participants.slice(0, MAX_VOICE_AVATARS).map((participant) => (
              <span
                key={participant.id}
                className={`hsb-voice-panel-person${participant.speaking ? " speaking" : ""}`}
                title={participant.name}
              >
                <UserAvatar username={participant.name} avatarUrl={participant.avatarUrl} />
              </span>
            ))}
            {props.participants.length > MAX_VOICE_AVATARS && (
              <span className="hsb-voice-panel-person more" aria-hidden="true">
                +{props.participants.length - MAX_VOICE_AVATARS}
              </span>
            )}
          </span>
        )}
      </button>
      <div className="hsb-voice-panel-actions">
        <button
          type="button"
          className={props.muted || props.serverMuted ? "active" : ""}
          aria-pressed={props.muted || props.serverMuted}
          aria-label={props.serverMuted ? "Server muted" : props.muted ? "Unmute" : "Mute"}
          data-tooltip={props.serverMuted ? "Server muted" : props.muted ? "Unmute" : "Mute"}
          disabled={props.serverMuted}
          onClick={props.onToggleMute}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z" />
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              d="M5.8 10.8a6.2 6.2 0 0 0 12.4 0M12 17v4"
            />
            {(props.muted || props.serverMuted) && (
              <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 4l16 16" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className={props.deafened || props.serverDeafened ? "active" : ""}
          aria-pressed={props.deafened || props.serverDeafened}
          aria-label={props.serverDeafened ? "Server deafened" : props.deafened ? "Undeafen" : "Deafen"}
          data-tooltip={props.serverDeafened ? "Server deafened" : props.deafened ? "Undeafen" : "Deafen"}
          disabled={props.serverDeafened}
          onClick={props.onToggleDeafen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3Zm16 0a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3Z"
            />
            {(props.deafened || props.serverDeafened) && (
              <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M4 4l16 16" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className={props.screenSharing ? "active live" : ""}
          aria-pressed={props.screenSharing}
          aria-label={props.screenSharing ? "Stop screen sharing" : "Share screen"}
          data-tooltip={props.screenSharing ? "Stop sharing" : "Share screen"}
          disabled={connecting}
          onClick={props.onToggleScreenShare}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
            <path d="M8 20h8M12 16v4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="hsb-voice-panel-leave"
          aria-label="Disconnect from voice"
          data-tooltip="Disconnect"
          onClick={props.onDisconnect}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5.3 4.8 8.8 3.5l2.1 4.1-2.2 1.7a13.4 13.4 0 0 0 6 6l1.7-2.2 4.1 2.1-1.3 3.5a2 2 0 0 1-2.2 1.2C10.4 18.8 5.2 13.6 4.1 7a2 2 0 0 1 1.2-2.2Z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
