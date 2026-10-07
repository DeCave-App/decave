// Joining a Squad Finder match's room, and leaving the current squad room.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { Channel, Server, SquadSearch, GroupChat } from "../types";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";

export type SquadRoomActionsDeps = {
  voiceCall: {
    soundboardNotice: string;
    setSoundboardNotice: Dispatch<SetStateAction<string>>;
    rtcStats: Record<string, { rttMs: number; lossPct: number; bitrateKbps: number | null }>;
    setRtcStats: Dispatch<
      SetStateAction<Record<string, { rttMs: number; lossPct: number; bitrateKbps: number | null }>>
    >;
    lobbyJoinMuted: boolean;
    setLobbyJoinMuted: Dispatch<SetStateAction<boolean>>;
    voiceStatus: string;
    setVoiceStatus: Dispatch<SetStateAction<string>>;
    voiceError: string;
    setVoiceError: Dispatch<SetStateAction<string>>;
    voiceChatOpen: boolean;
    setVoiceChatOpen: Dispatch<SetStateAction<boolean>>;
    isMuted: boolean;
    setIsMuted: Dispatch<SetStateAction<boolean>>;
    isDeafened: boolean;
    setIsDeafened: Dispatch<SetStateAction<boolean>>;
    isServerMuted: boolean;
    setIsServerMuted: Dispatch<SetStateAction<boolean>>;
    isServerDeafened: boolean;
    setIsServerDeafened: Dispatch<SetStateAction<boolean>>;
  };
  setShowHome: Dispatch<SetStateAction<boolean>>;
  setShowSquadFinder: Dispatch<SetStateAction<boolean>>;
  setSquadCurrent: Dispatch<SetStateAction<SquadSearch | null>>;
  setSquadMatches: Dispatch<SetStateAction<SquadSearch[]>>;
  setSquadMatchPopup: Dispatch<SetStateAction<SquadSearch | null>>;
  squadNotifiedMatchRef: MutableRefObject<string>;
  setSquadBusy: Dispatch<SetStateAction<boolean>>;
  setSquadNotice: Dispatch<SetStateAction<string>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  voiceChannelId: number | null;
  currentServer: Server;
  currentChannel: Channel;
  loadServers: () => Promise<Server[] | null>;
  joinVoiceChannel: (channelId: number, recoveryRetry?: boolean) => Promise<void>;
  leaveVoice: () => void;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
};

/** Called once per render with that render's values. */
export function createSquadRoomActions(deps: SquadRoomActionsDeps) {
  const {
    voiceCall,
    setShowHome,
    setShowSquadFinder,
    setSquadCurrent,
    setSquadMatches,
    setSquadMatchPopup,
    squadNotifiedMatchRef,
    setSquadBusy,
    setSquadNotice,
    setShowSocial,
    voiceChannelId,
    currentServer,
    currentChannel,
    loadServers,
    joinVoiceChannel,
    leaveVoice,
    changeServer,
    changeChannel,
  } = deps;

  const joinSquadMatch = async (match: SquadSearch) => {
    setSquadBusy(true);
    setSquadNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/squad-finder/${encodeURIComponent(match.id)}/join`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        group?: GroupChat;
        hubId?: number;
        channelId?: number;
        error?: string;
      };
      if (!response.ok || !data.group || !data.hubId || !data.channelId) {
        setSquadNotice(data.error || "Could not join that squad.");
        return;
      }
      setSquadCurrent(null);
      setSquadMatches([]);
      setSquadMatchPopup(null);
      squadNotifiedMatchRef.current = "";
      const loaded = await loadServers();
      setShowSquadFinder(false);
      setShowHome(false);
      setShowSocial(false);
      voiceCall.setVoiceChatOpen(false);
      if (loaded?.some((server) => server.id === data.hubId)) {
        changeServer(data.hubId, loaded);
        window.setTimeout(() => {
          changeChannel(data.channelId!);
          void joinVoiceChannel(data.channelId!);
        }, 0);
      }
    } catch {
      setSquadNotice("Could not join that squad.");
    } finally {
      setSquadBusy(false);
    }
  };

  const leaveCurrentSquadRoom = async () => {
    if (!currentServer.isSquad) return;
    if (!window.confirm(`Leave ${currentServer.name}? The temporary room is deleted after the last member leaves.`))
      return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/squad-finder/rooms/${currentServer.id}/leave`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        window.alert(data.error || "Could not leave the squad room.");
        return;
      }
      if (voiceChannelId === currentChannel.id) leaveVoice();
      await loadServers();
      voiceCall.setVoiceChatOpen(false);
    } catch {
      window.alert("Could not connect to DeCave.");
    }
  };

  return {
    joinSquadMatch,
    leaveCurrentSquadRoom,
  };
}
