// Draggable mini player for the voice room you are in while you look elsewhere.

import type { CSSProperties } from "react";
import { VoiceStrip } from "../../components/studio";
import type { Channel, Server, VoiceParticipant } from "../types";
import type { VoiceCallState } from "../state/voice-call";
import type { VoiceControlActions } from "../actions/voice-controls";
import type { VoiceMiniPlayerActions } from "../actions/voice-mini-player";

type Props = {
  voiceParticipants: VoiceParticipant[];
  isParticipantSpeaking: (participant: VoiceParticipant) => boolean;
  leaveVoice: () => void;
  activeVoiceLocation: { server: Server; channel: Channel };
  voiceMiniPositionStyle: CSSProperties | undefined;
  returnToVoiceChannel: () => void;
  studioVoiceConnectionState: "disconnected" | "connecting" | "connected";
  voiceCall: VoiceCallState;
  voiceControls: VoiceControlActions;
  voiceMiniPlayer: VoiceMiniPlayerActions;
};

export function VoiceMiniPlayer({
  voiceParticipants,
  isParticipantSpeaking,
  leaveVoice,
  activeVoiceLocation,
  voiceMiniPositionStyle,
  returnToVoiceChannel,
  studioVoiceConnectionState,
  voiceCall,
  voiceControls,
  voiceMiniPlayer,
}: Props) {
  const { handleVoiceMiniPointerDown, handleVoiceMiniPointerMove, handleVoiceMiniPointerUp } = voiceMiniPlayer;
  const { toggleMute, toggleDeafen } = voiceControls;
  const { isMuted, isDeafened, isServerMuted, isServerDeafened } = voiceCall;
  return (
    <aside
      className="dc-voice-mini-player dc-persistent-voice-surface"
      aria-label={`Active voice room:${activeVoiceLocation.server.name} · ${activeVoiceLocation.channel.name}`}
      data-voice-surface="persistent"
      data-voice-channel-id={activeVoiceLocation.channel.id}
      data-muted={isMuted || isServerMuted ? "true" : "false"}
      data-deafened={isDeafened || isServerDeafened ? "true" : "false"}
      style={voiceMiniPositionStyle}
      onPointerDown={handleVoiceMiniPointerDown}
      onPointerMove={handleVoiceMiniPointerMove}
      onPointerUp={handleVoiceMiniPointerUp}
      onPointerCancel={handleVoiceMiniPointerUp}
    >
      <button
        type="button"
        className="dc-voice-mini-return"
        aria-hidden="true"
        tabIndex={-1}
        onClick={returnToVoiceChannel}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        Return to voice room
      </button>
      <span className="dc-voice-mini-drag-handle" title="Drag voice window" aria-hidden="true">
        ⋮⋮
      </span>
      <VoiceStrip
        roomName={`${activeVoiceLocation.server.name} · ${activeVoiceLocation.channel.name}`}
        participantCount={
          voiceParticipants.filter((participant) => participant.channelId === activeVoiceLocation.channel.id).length
        }
        participants={voiceParticipants
          .filter((participant) => participant.channelId === activeVoiceLocation.channel.id)
          .map((participant) => ({
            id: participant.connectionId,
            name: participant.username,
            avatarUrl: participant.avatarUrl ?? undefined,
            speaking: isParticipantSpeaking(participant),
          }))}
        connectionState={studioVoiceConnectionState}
        muted={isMuted || isServerMuted}
        deafened={isDeafened || isServerDeafened}
        onToggleMute={toggleMute}
        onToggleDeafen={toggleDeafen}
        onLeave={leaveVoice}
        onOpenDetails={returnToVoiceChannel}
      />
    </aside>
  );
}
