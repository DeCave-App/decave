// The current voice call as shown in the UI: connection status and errors,
// mute and deafen (yours and server-applied), the room chat panel, lobby mute,
// soundboard notices and connection stats.

import { useState } from "react";

export function useVoiceCallState() {
  const [soundboardNotice, setSoundboardNotice] = useState("");
  const [rtcStats, setRtcStats] = useState<
    Record<string, { rttMs: number; lossPct: number; bitrateKbps: number | null }>
  >({});
  const [lobbyJoinMuted, setLobbyJoinMuted] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Disconnected");
  const [voiceError, setVoiceError] = useState("");
  const [voiceChatOpen, setVoiceChatOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isServerMuted, setIsServerMuted] = useState(false);
  const [isServerDeafened, setIsServerDeafened] = useState(false);

  return {
    soundboardNotice,
    setSoundboardNotice,
    rtcStats,
    setRtcStats,
    lobbyJoinMuted,
    setLobbyJoinMuted,
    voiceStatus,
    setVoiceStatus,
    voiceError,
    setVoiceError,
    voiceChatOpen,
    setVoiceChatOpen,
    isMuted,
    setIsMuted,
    isDeafened,
    setIsDeafened,
    isServerMuted,
    setIsServerMuted,
    isServerDeafened,
    setIsServerDeafened,
  };
}

export type VoiceCallState = ReturnType<typeof useVoiceCallState>;
