// Shown in place of the message list when a room has no messages yet.

import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <section className="gc-room-hero" aria-labelledby="gc-room-hero-title">
      <div className="gc-room-hero-icon" aria-hidden="true">
        {currentChannel.icon ? <span>{currentChannel.icon}</span> : <Icon name="hash" size="xl" />}
      </div>
      <p className="gc-room-hero-kicker">
        {currentChannel.category
          ? t("chat.roomHero.kickerCategory", { hub: currentServer.name, category: currentChannel.category })
          : currentServer.name}
      </p>
      <h1 id="gc-room-hero-title">{t("chat.roomHero.title", { room: currentChannel.name })}</h1>
      <p className="gc-room-hero-copy">
        {currentServer.ownerOnlyPosting
          ? t("chat.roomHero.announcements")
          : t("chat.roomHero.beginning", { room: currentChannel.name })}
      </p>
      <div className="gc-room-hero-meta">
        <span>
          {currentChannel.private ? (
            <>
              <Icon name="lock" size="sm" />
              {t("chat.roomHero.private")}
            </>
          ) : (
            <>
              <Icon name="globe" size="sm" />
              {t("chat.roomHero.public")}
            </>
          )}
        </span>
        {currentServer.ownerOnlyPosting && (
          <span>
            <Icon name="shield" size="sm" />
            {t("chat.roomHero.ownerOnly")}
          </span>
        )}
      </div>
      {canPostInCurrentHub && (
        <div className="gc-room-hero-actions">
          <button type="button" className="gc-room-hero-action" onClick={() => messageInputRef.current?.focus()}>
            <Icon name="message" />
            <span>{t("chat.roomHero.sendMessage")}</span>
          </button>
          <button type="button" className="gc-room-hero-action" onClick={() => attachmentInputRef.current?.click()}>
            <Icon name="paperclip" />
            <span>{t("chat.roomHero.uploadFile")}</span>
          </button>
          <button type="button" className="gc-room-hero-action" onClick={() => hubChat.openPollComposer("hub")}>
            <Icon name="poll" />
            <span>{t("chat.roomHero.createPoll")}</span>
          </button>
          {canCreateEventsIn(currentServer.id) && (
            <button type="button" className="gc-room-hero-action" onClick={hubChat.openEventComposer}>
              <Icon name="calendar" />
              <span>{t("chat.roomHero.scheduleEvent")}</span>
            </button>
          )}
          {canManageCurrentServer && (
            <button type="button" className="gc-room-hero-action" onClick={openManageChannel}>
              <Icon name="settings" />
              <span>{t("chat.roomHero.roomSettings")}</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
