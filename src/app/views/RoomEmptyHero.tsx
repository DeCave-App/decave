// Shown in place of the message list when a room has no messages yet.

import type { MutableRefObject } from "react";
import { Icon } from "../../components/Icon";
import type { Channel, Server } from "../types";
import type { HubChatActions } from "../actions/hub-chat";

type Props = {
  messageInputRef: MutableRefObject<HTMLTextAreaElement | null>;
  attachmentInputRef: MutableRefObject<HTMLInputElement | null>;
  currentServer: Server;
  currentChannel: Channel;
  canManageCurrentServer: boolean;
  canPostInCurrentHub: boolean;
  openManageChannel: () => void;
  hubChat: HubChatActions;
  canCreateEventsIn: (hubId: number) => boolean;
};

export function RoomEmptyHero({
  messageInputRef,
  attachmentInputRef,
  currentServer,
  currentChannel,
  canManageCurrentServer,
  canPostInCurrentHub,
  openManageChannel,
  hubChat,
  canCreateEventsIn,
}: Props) {
  return (
    <section className="gc-room-hero" aria-labelledby="gc-room-hero-title">
      <div className="gc-room-hero-icon" aria-hidden="true">
        {currentChannel.icon ? <span>{currentChannel.icon}</span> : <Icon name="hash" size="xl" />}
      </div>
      <p className="gc-room-hero-kicker">
        {currentServer.name}
        {currentChannel.category ? ` · ${currentChannel.category}` : ""}
      </p>
      <h1 id="gc-room-hero-title">Welcome to #{currentChannel.name}</h1>
      <p className="gc-room-hero-copy">
        {currentServer.ownerOnlyPosting
          ? "Announcements from the Hub owner land here. Turn on notifications so you don't miss anything."
          : `This is the very beginning of #${currentChannel.name}. Say hi, share a clip or kick things off with a poll.`}
      </p>
      <div className="gc-room-hero-meta">
        <span>
          {currentChannel.private ? (
            <>
              <Icon name="lock" size="sm" />
              Private room
            </>
          ) : (
            <>
              <Icon name="globe" size="sm" />
              Visible to all members
            </>
          )}
        </span>
        {currentServer.ownerOnlyPosting && (
          <span>
            <Icon name="shield" size="sm" />
            Only the owner can post
          </span>
        )}
      </div>
      {canPostInCurrentHub && (
        <div className="gc-room-hero-actions">
          <button type="button" className="gc-room-hero-action" onClick={() => messageInputRef.current?.focus()}>
            <Icon name="message" />
            <span>Send a message</span>
          </button>
          <button type="button" className="gc-room-hero-action" onClick={() => attachmentInputRef.current?.click()}>
            <Icon name="paperclip" />
            <span>Upload a file</span>
          </button>
          <button type="button" className="gc-room-hero-action" onClick={() => hubChat.openPollComposer("hub")}>
            <Icon name="poll" />
            <span>Create poll</span>
          </button>
          {canCreateEventsIn(currentServer.id) && (
            <button type="button" className="gc-room-hero-action" onClick={hubChat.openEventComposer}>
              <Icon name="calendar" />
              <span>Schedule event</span>
            </button>
          )}
          {canManageCurrentServer && (
            <button type="button" className="gc-room-hero-action" onClick={openManageChannel}>
              <Icon name="settings" />
              <span>Room settings</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
