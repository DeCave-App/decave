// Header of the open Hub room: room name, topic and the room's action buttons.

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
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
  connectionStatus: string;
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
};

export function HubContextHeader({
  roomUnread,
  setRoomUnread,
  setRoomMentions,
  servers,
  selectedServer,
  selectedChannel,
  messages,
  connectionStatus,
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
}: Props) {
  const { voiceChatOpen, setVoiceChatOpen } = voiceCall;
  const { setShowMessageSearch, setShowPinnedMessages } = hubPanels;
  return (
    <header
      className="channel-header dc-hub-context-header"
      data-hub-id={currentServer.id}
      data-channel-id={currentChannel.id}
      aria-label={
        streamerOverviewActive
          ? `Hubs · ${currentServer.name} · Overview`
          : hubHomeActive
            ? `Hubs · ${currentServer.name} · Hub Home`
            : `Hubs · ${currentServer.name} · ${currentChannel.name}`
      }
    >
      <div>
        <div
          className="dc-context-breadcrumb"
          aria-label={
            streamerOverviewActive
              ? `Hubs / ${currentServer.name} / Overview`
              : hubHomeActive
                ? `Hubs / ${currentServer.name} / Hub Home`
                : `Hubs / ${currentServer.name} / ${currentChannel.name}`
          }
        >
          <span className="dc-context-section">Hubs</span>
          <span className="dc-context-separator" aria-hidden="true">
            <Icon name="chevron-right" size="sm" />
          </span>
          <span className="dc-context-hub">
            {currentServer.icon} {currentServer.name}
          </span>
          <span className="dc-context-separator" aria-hidden="true">
            <Icon name="chevron-right" size="sm" />
          </span>
          {streamerOverviewActive || hubHomeActive ? (
            <strong className="dc-context-channel">{hubHomeActive ? "Hub Home" : "Overview"}</strong>
          ) : (
            <strong className="dc-context-channel">
              {currentChannel.type === "voice" ? "V" : currentChannel.type === "forum" ? "▤" : "#"}{" "}
              {currentChannel.name}
            </strong>
          )}
        </div>
        <div className="channel-subtitle">
          {connectionStatus}
          {currentServer.myRole ? ` · ${currentServer.myRole.toUpperCase()}` : ""}
          {streamerOverviewActive && <span> · OVERVIEW</span>}
        </div>
      </div>

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
        {!streamerOverviewActive && !hubHomeActive && (
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
          />
        )}
      </div>
    </header>
  );
}
