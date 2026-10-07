// Records voice sessions in the local recap: when one starts, who was seen, when it ends.

import { type MutableRefObject, useEffect } from "react";
import type { AppLocalRecapActionInput, Server, AccountUser, VoiceParticipant } from "../types";

export type VoiceSessionRecapDeps = {
  currentUser: AccountUser | null;
  sessionIdRef: MutableRefObject<string>;
  activeVoiceRecapSessionRef: MutableRefObject<string | null>;
  servers: Server[];
  voiceParticipants: VoiceParticipant[];
  voiceChannelId: number | null;
  activeServerRef: MutableRefObject<number>;
  appendSessionRecap: (action: AppLocalRecapActionInput) => void;
};

export function useVoiceSessionRecap(deps: VoiceSessionRecapDeps): void {
  const {
    currentUser,
    sessionIdRef,
    activeVoiceRecapSessionRef,
    servers,
    voiceParticipants,
    voiceChannelId,
    activeServerRef,
    appendSessionRecap,
  } = deps;

  useEffect(() => {
    const recapVoiceLocation =
      voiceChannelId === null
        ? null
        : (servers.flatMap((server) =>
            server.channels
              .filter((channel) => channel.id === voiceChannelId && channel.type === "voice")
              .map((channel) => ({ server, channel })),
          )[0] ?? null);
    if (!currentUser || !recapVoiceLocation) {
      if (activeVoiceRecapSessionRef.current && currentUser) {
        appendSessionRecap({
          kind: "session-ended",
          hubId: String(activeServerRef.current),
          hubName: servers.find((server) => server.id === activeServerRef.current)?.name,
        });
        activeVoiceRecapSessionRef.current = null;
      }
      return;
    }
    if (!activeVoiceRecapSessionRef.current) {
      activeVoiceRecapSessionRef.current = sessionIdRef.current;
      appendSessionRecap({
        kind: "session-started",
        hubId: String(recapVoiceLocation.server.id),
        hubName: recapVoiceLocation.server.name,
      });
    }
    for (const participant of voiceParticipants.filter((item) => item.channelId === recapVoiceLocation.channel.id)) {
      appendSessionRecap({
        id: `participant:${sessionIdRef.current}:${participant.userId}`,
        kind: "participant-seen",
        userId: participant.userId,
        displayName: participant.username,
      });
    }
  }, [currentUser?.id, voiceChannelId, servers, voiceParticipants]);
}
