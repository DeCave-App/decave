// Hub room header buttons: room chat toggle in voice rooms, message search, manage room, leave a temporary squad room.

import { useTranslation } from "react-i18next";
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
  /** This room is muted (notifications "Nothing"). */
  roomMuted: boolean;
  toggleRoomMute: () => void;
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
  roomMuted,
  toggleRoomMute,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <>
      {currentChannel.type === "voice" && (
        <button
          type="button"
          className="voice-chat-switch"
          title={voiceChatOpen ? t("hub.roomActions.showVoiceControls") : t("hub.roomActions.openRoomChat")}
          aria-label={voiceChatOpen ? t("hub.roomActions.showVoiceControls") : t("hub.roomActions.openRoomChat")}
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
          {voiceChatOpen ? t("hub.roomActions.voiceToggle") : t("hub.roomActions.chatToggle")}
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
          title={t("hub.roomActions.leaveSquad")}
          aria-label={t("hub.roomActions.leaveSquad")}
          onClick={() => void leaveCurrentSquadRoom()}
        >
          {t("hub.roomActions.leave")}
        </button>
      )}

      {(currentChannel.type === "text" || voiceChatOpen) && (
        <button
          type="button"
          title={t("hub.roomActions.searchMessages")}
          aria-label={t("hub.roomActions.searchMessages")}
          onClick={() => setShowMessageSearch(true)}
        >
          ⌕
        </button>
      )}

      {(currentChannel.type === "text" || voiceChatOpen) && (
        <button
          type="button"
          title={
            messages.filter((message) => message.pinned).length
              ? t("hub.roomActions.pinnedCountTitle", { pinned: messages.filter((message) => message.pinned).length })
              : t("hub.roomActions.pinned")
          }
          aria-label={
            messages.filter((message) => message.pinned).length
              ? t("hub.roomActions.pinnedCountLabel", { pinned: messages.filter((message) => message.pinned).length })
              : t("hub.roomActions.pinned")
          }
          onClick={() => setShowPinnedMessages(true)}
        >
          ⌖
          {messages.filter((message) => message.pinned).length > 0
            ? ` ${messages.filter((message) => message.pinned).length}`
            : ""}
        </button>
      )}

      <button
        type="button"
        className={roomMuted ? "is-muted" : undefined}
        title={
          roomMuted
            ? t("hub.roomActions.unmuteRoom", { room: currentChannel.name })
            : t("hub.roomActions.muteRoom", { room: currentChannel.name })
        }
        aria-label={
          roomMuted
            ? t("hub.roomActions.unmuteRoom", { room: currentChannel.name })
            : t("hub.roomActions.muteRoom", { room: currentChannel.name })
        }
        aria-pressed={roomMuted}
        onClick={toggleRoomMute}
      >
        {roomMuted ? "🔕" : "🔔"}
      </button>

      {canManageCurrentRooms && (
        <button
          type="button"
          title={t("hub.roomActions.manageRoom")}
          aria-label={t("hub.roomActions.manageRoom")}
          onClick={openManageChannel}
        >
          ...
        </button>
      )}
    </>
  );
}
