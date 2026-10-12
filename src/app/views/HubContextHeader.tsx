// Header of the open Hub room: the room's action buttons (search, pins, chat, menu)
// and, on narrow windows, the Hub/room switcher. No breadcrumb or status line.

import type { Dispatch, SetStateAction } from "react";
import type { Channel, Server, ChatMessage } from "../types";
import { HubRoomHeaderActions } from "./HubRoomHeaderActions";
import type { HubPanelsState } from "../state/hub-panels";
import type { VoiceCallState } from "../state/voice-call";

type Props = {
  roomUnread: Record<number, number>;
  setRoomUnread: Dispatch<SetStateAction<Record<number, number>>>;
  setRoomMentions: Dispatch<SetStateAction<Record<number, number>>>;
  servers: Server[];
  selectedServer: number;
  selectedChannel: number;
  messages: ChatMessage[];
  currentServer: Server;
  currentChannel: Channel;
  streamerOverviewActive: boolean;
  canManageCurrentRooms: boolean;
  leaveCurrentSquadRoom: () => Promise<void>;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  openManageChannel: () => void;
  hubHomeActive: boolean;
  hubPanels: HubPanelsState;
  voiceCall: VoiceCallState;
  roomMuted: boolean;
  toggleRoomMute: () => void;
};

export function HubContextHeader({
  roomUnread,
  setRoomUnread,
  setRoomMentions,
  servers,
  selectedServer,
  selectedChannel,
  messages,
  currentServer,
  currentChannel,
  streamerOverviewActive,
  canManageCurrentRooms,
  leaveCurrentSquadRoom,
  changeServer,
  changeChannel,
  openManageChannel,
  hubHomeActive,
  hubPanels,
  voiceCall,
  roomMuted,
  toggleRoomMute,
}: Props) {
  const { voiceChatOpen, setVoiceChatOpen } = voiceCall;
  const { setShowMessageSearch, setShowPinnedMessages } = hubPanels;
  const hasRoomActions = !streamerOverviewActive && !hubHomeActive;
  return (
    <header
      className="channel-header dc-hub-context-header"
      data-hub-id={currentServer.id}
      data-channel-id={currentChannel.id}
      data-room-actions={hasRoomActions ? "true" : "false"}
      aria-label={
        streamerOverviewActive
          ? `Hubs · ${currentServer.name} · Overview`
          : hubHomeActive
            ? `Hubs · ${currentServer.name} · Hub Home`
            : `Hubs · ${currentServer.name} · ${currentChannel.name}`
      }
    >
      <div className="dc-compact-workspace-picker" data-compact-workspace-picker="true">
        <label className="dc-compact-picker-field">
          <span>Hub</span>
          <select
            className="dc-compact-hub-picker"
            aria-label="Switch Hub"
            value={selectedServer}
            onChange={(event) => changeServer(Number(event.target.value))}
          >
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </label>
        <label className="dc-compact-picker-field">
          <span>Room</span>
          <select
            className="dc-compact-channel-picker"
            data-compact-channel-picker="true"
            aria-label={`Switch room in${currentServer.name}`}
            value={selectedChannel}
            onChange={(event) => changeChannel(Number(event.target.value))}
          >
            {currentServer.channels.length > 0 ? (
              currentServer.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.type === "voice" ? "V" : channel.type === "forum" ? "▤" : "#"} {channel.name}
                </option>
              ))
            ) : (
              <option value={currentChannel.id}>{currentChannel.name}</option>
            )}
          </select>
        </label>
      </div>

      <div className="header-actions">
        {hasRoomActions && (
          <HubRoomHeaderActions
            setShowMessageSearch={setShowMessageSearch}
            setShowPinnedMessages={setShowPinnedMessages}
            roomUnread={roomUnread}
            setRoomUnread={setRoomUnread}
            setRoomMentions={setRoomMentions}
            messages={messages}
            voiceChatOpen={voiceChatOpen}
            setVoiceChatOpen={setVoiceChatOpen}
            currentServer={currentServer}
            currentChannel={currentChannel}
            canManageCurrentRooms={canManageCurrentRooms}
            leaveCurrentSquadRoom={leaveCurrentSquadRoom}
            openManageChannel={openManageChannel}
            roomMuted={roomMuted}
            toggleRoomMute={toggleRoomMute}
          />
        )}
      </div>
    </header>
  );
}
