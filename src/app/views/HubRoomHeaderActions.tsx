// Hub room header buttons: room chat toggle in voice rooms, message search, manage room, leave a temporary squad room.

import type { Dispatch, SetStateAction } from "react";
import type { Channel, Server, ChatMessage } from "../types";

type Props = {
  setShowMessageSearch: Dispatch<SetStateAction<boolean>>;
  setShowPinnedMessages: Dispatch<SetStateAction<boolean>>;
  roomUnread: Record<number, number>;
  setRoomUnread: Dispatch<SetStateAction<Record<number, number>>>;
  setRoomMentions: Dispatch<SetStateAction<Record<number, number>>>;
  messages: ChatMessage[];
  voiceChatOpen: boolean;
  setVoiceChatOpen: Dispatch<SetStateAction<boolean>>;
  currentServer: Server;
  currentChannel: Channel;
  canManageCurrentRooms: boolean;
  leaveCurrentSquadRoom: () => Promise<void>;
  openManageChannel: () => void;
};

export function HubRoomHeaderActions({
  setShowMessageSearch,
  setShowPinnedMessages,
  roomUnread,
  setRoomUnread,
  setRoomMentions,
  messages,
  voiceChatOpen,
  setVoiceChatOpen,
  currentServer,
  currentChannel,
  canManageCurrentRooms,
  leaveCurrentSquadRoom,
  openManageChannel,
}: Props) {
  return (
    <>
      {currentChannel.type === "voice" && (
        <button
          type="button"
          className="voice-chat-switch"
          title={voiceChatOpen ? "Show voice controls" : "Open room chat"}
          aria-label={voiceChatOpen ? "Show voice controls" : "Open room chat"}
          onClick={() =>
            setVoiceChatOpen((open) => {
              const next = !open;
              if (next) {
                setRoomUnread((current) => ({ ...current, [currentChannel.id]: 0 }));
                setRoomMentions((current) => ({ ...current, [currentChannel.id]: 0 }));
              }
              return next;
            })
          }
        >
          {voiceChatOpen ? "◉ Voice" : "💬 Chat"}
          {!voiceChatOpen && (roomUnread[currentChannel.id] ?? 0) > 0 && (
            <b className="voice-chat-unread-badge">
              {(roomUnread[currentChannel.id] ?? 0) > 99 ? "99+" : roomUnread[currentChannel.id]}
            </b>
          )}
        </button>
      )}

      {currentChannel.type === "voice" && currentServer.isSquad && (
        <button
          type="button"
          title="Leave temporary squad room"
          aria-label="Leave temporary squad room"
          onClick={() => void leaveCurrentSquadRoom()}
        >
          ↪ Leave
        </button>
      )}

      {(currentChannel.type === "text" || voiceChatOpen) && (
        <button
          type="button"
          title="Search messages"
          aria-label="Search messages"
          onClick={() => setShowMessageSearch(true)}
        >
          ⌕
        </button>
      )}

      {(currentChannel.type === "text" || voiceChatOpen) && (
        <button
          type="button"
          title={`Pinned messages${messages.filter((message) => message.pinned).length ? ` (${messages.filter((message) => message.pinned).length})` : ""}`}
          aria-label={`Pinned messages${messages.filter((message) => message.pinned).length ? `, ${messages.filter((message) => message.pinned).length}` : ""}`}
          onClick={() => setShowPinnedMessages(true)}
        >
          ⌖
          {messages.filter((message) => message.pinned).length > 0
            ? ` ${messages.filter((message) => message.pinned).length}`
            : ""}
        </button>
      )}

      {canManageCurrentRooms && (
        <button type="button" title="Manage room" aria-label="Manage room" onClick={openManageChannel}>
          ...
        </button>
      )}
    </>
  );
}
