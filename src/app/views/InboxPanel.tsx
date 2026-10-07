// The Inbox: desktop updates, unread rooms and recent mentions in one panel.

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { Channel, Server, SocialUser, DmConversation, DesktopUpdateState } from "../types";
import { UserAvatar } from "../components/UserAvatar";
import type { SettingsWindowState } from "../state/settings-window";
import type { PageNavigation } from "../actions/page-navigation";
import type { MessageRendering } from "../actions/message-rendering";

type Props = {
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  settingsWindow: SettingsWindowState;
  setShowInbox: Dispatch<SetStateAction<boolean>>;
  setShowAdminDashboard: Dispatch<SetStateAction<boolean>>;
  setShowHome: Dispatch<SetStateAction<boolean>>;
  setRoomUnread: Dispatch<SetStateAction<Record<number, number>>>;
  setRoomMentions: Dispatch<SetStateAction<Record<number, number>>>;
  setShowServerBrowser: Dispatch<SetStateAction<boolean>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  dmUnread: Record<string, number>;
  setDmUnread: Dispatch<SetStateAction<Record<string, number>>>;
  desktopUpdateState: DesktopUpdateState | null;
  openDirectMessage: (user: SocialUser) => Promise<void>;
  pageNavigation: PageNavigation;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  messageRendering: MessageRendering;
  inboxRoomItems: { server: Server; channel: Channel; unread: number; mentions: number }[];
  inboxDmItems: DmConversation[];
  desktopUpdateAvailable: boolean;
  inboxTotal: number;
};

export function InboxPanel({
  setShowSettings,
  settingsWindow,
  setShowInbox,
  setShowAdminDashboard,
  setShowHome,
  setRoomUnread,
  setRoomMentions,
  setShowServerBrowser,
  setShowSocial,
  dmUnread,
  setDmUnread,
  desktopUpdateState,
  openDirectMessage,
  pageNavigation,
  changeServer,
  changeChannel,
  messageRendering,
  inboxRoomItems,
  inboxDmItems,
  desktopUpdateAvailable,
  inboxTotal,
}: Props) {
  return (
    <div
      className="modal-overlay dc-command-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowInbox(false);
      }}
    >
      <section className="dc-inbox-panel" role="dialog" aria-modal="true" aria-labelledby="dc-inbox-title">
        <header className="ds-page-header">
          <div className="ds-page-header-copy">
            <span className="ds-kicker">Inbox</span>
            <h2 id="dc-inbox-title">Unread & mentions</h2>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-sm"
              disabled={inboxTotal === 0}
              onClick={() => {
                setRoomUnread({});
                setRoomMentions({});
                setDmUnread({});
              }}
            >
              <Icon name="check" />
              Mark all read
            </button>
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              onClick={() => setShowInbox(false)}
              aria-label="Close"
              title="Close"
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className="dc-inbox-list ds-list">
          {desktopUpdateAvailable && desktopUpdateState?.availableVersion && (
            <button
              type="button"
              className="ds-row ds-row-boxed dc-inbox-update-item"
              onClick={() => {
                setShowInbox(false);
                settingsWindow.setSettingsTab("system");
                pageNavigation.openSettings();
              }}
            >
              <span className="dc-inbox-update-icon" aria-hidden="true">
                <Icon name="upload" />
              </span>
              <span className="ds-row-copy">
                <strong className="ds-row-title">
                  Desktop update {desktopUpdateState.status === "downloading" ? "downloading" : "ready"}
                </strong>
                <small className="ds-row-sub">
                  Installed version {desktopUpdateState.currentVersion} ·{" "}
                  {desktopUpdateState.status === "downloading"
                    ? `Downloading ${desktopUpdateState.availableVersion}`
                    : `Version ${desktopUpdateState.availableVersion} is ready. Open Settings to update.`}
                </small>
              </span>
              <span className="ds-badge">New</span>
            </button>
          )}
          {inboxDmItems.map((conversation) => (
            <button
              type="button"
              className="ds-row"
              key={`inbox-dm-${conversation.user.id}`}
              onClick={() => {
                setShowInbox(false);
                void openDirectMessage(conversation.user);
              }}
            >
              <span className="ds-avatar-wrap">
                <UserAvatar username={conversation.user.username} avatarUrl={conversation.user.avatarUrl} />
              </span>
              <span className="ds-row-copy">
                <strong className="ds-row-title">{conversation.user.username}</strong>
                <small className="ds-row-sub">
                  {messageRendering.dmPreviewText(conversation.latestMessage) || "Private message"}
                </small>
              </span>
              <span className="ds-badge">{dmUnread[conversation.user.id]}</span>
            </button>
          ))}
          {inboxRoomItems.map(({ server, channel, unread, mentions }) => (
            <button
              type="button"
              className="ds-row"
              key={`inbox-room-${channel.id}`}
              onClick={() => {
                setShowInbox(false);
                setShowHome(false);
                setShowSocial(false);
                setShowSettings(false);
                setShowServerBrowser(false);
                setShowAdminDashboard(false);
                changeServer(server.id);
                window.setTimeout(() => changeChannel(channel.id), 0);
              }}
            >
              <span className="dc-inbox-room-icon" aria-hidden="true">
                {channel.icon || (
                  <Icon name={channel.type === "forum" ? "forum" : channel.type === "voice" ? "volume" : "hash"} />
                )}
              </span>
              <span className="ds-row-copy">
                <strong className="ds-row-title">{channel.name}</strong>
                <small className="ds-row-sub">
                  {server.name} · {mentions ? `${mentions} mention${mentions === 1 ? "" : "s"}` : `${unread} unread`}
                </small>
              </span>
              <span className={mentions ? "ds-badge mention" : "ds-badge"}>
                {mentions ? <Icon name="at" size="sm" /> : unread}
              </span>
            </button>
          ))}
          {inboxTotal === 0 && (
            <div className="ds-empty">
              <span className="ds-empty-icon">
                <Icon name="bell" />
              </span>
              <h3>You’re all caught up</h3>
              <p>Unread DMs, room messages, and mentions will appear here.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
