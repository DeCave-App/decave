// Top bar: DeCave brand, Hub switcher, the active Hub and the account menu button.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import decaveMark from "../../assets/decave-mark-reference.png";
import type { HubTemplateId } from "../../../shared/hub-templates";
import { Icon } from "../../components/Icon";
import { HubSwitcher } from "../../features/hub-sidebar/HubSwitcher";
import type { ServerVisibility, Server, SquadSearch, AccountUser, VoiceParticipant } from "../types";
import { HTTP_URL } from "../env";
import { presenceLabel, presenceColor, presenceGlow } from "../user-display";
import { UserAvatar } from "../components/UserAvatar";
import type { ContextMenuActions } from "../actions/context-menus";

type Props = {
  currentUser: AccountUser;
  setShowCommandPalette: Dispatch<SetStateAction<boolean>>;
  setCommandPaletteQuery: Dispatch<SetStateAction<string>>;
  setCommandPaletteIndex: Dispatch<SetStateAction<number>>;
  setShowInbox: Dispatch<SetStateAction<boolean>>;
  profileAccent: string;
  showHome: boolean;
  roomUnread: Record<number, number>;
  roomMentions: Record<number, number>;
  mutedHubIds: number[];
  servers: Server[];
  selectedServer: number;
  setShowCreateServer: Dispatch<SetStateAction<boolean>>;
  setNewServerName: Dispatch<SetStateAction<string>>;
  setNewServerVisibility: Dispatch<SetStateAction<ServerVisibility>>;
  setNewServerTemplate: Dispatch<SetStateAction<HubTemplateId>>;
  setServerCreateError: Dispatch<SetStateAction<string>>;
  showServerBrowser: boolean;
  squadCurrent: SquadSearch | null;
  showSocial: boolean;
  socialView: "friends" | "dm";
  voiceParticipants: VoiceParticipant[];
  selfConnectionIdRef: MutableRefObject<string>;
  currentServer: Server;
  openSquadFinderWorkspace: () => void;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  inboxTotal: number;
  primaryHubsActive: boolean;
  contextMenus: ContextMenuActions;
};

export function AppTopBar({
  currentUser,
  setShowCommandPalette,
  setCommandPaletteQuery,
  setCommandPaletteIndex,
  setShowInbox,
  profileAccent,
  showHome,
  roomUnread,
  roomMentions,
  mutedHubIds,
  servers,
  selectedServer,
  setShowCreateServer,
  setNewServerName,
  setNewServerVisibility,
  setNewServerTemplate,
  setServerCreateError,
  showServerBrowser,
  squadCurrent,
  showSocial,
  socialView,
  voiceParticipants,
  selfConnectionIdRef,
  currentServer,
  openSquadFinderWorkspace,
  changeServer,
  inboxTotal,
  primaryHubsActive,
  contextMenus,
}: Props) {
  const { openUserContextMenu, openResourceContextMenu } = contextMenus;
  return (
    <header
      className={`vadrion-topbar${showSocial || showServerBrowser ? " dc-full-workspace-topbar" : ""}`}
      data-navigation-surface={
        showHome ? "home" : showSocial && socialView === "dm" ? "dms" : primaryHubsActive ? "hubs" : "secondary"
      }
    >
      <div
        className="decave-top-brand"
        title="DeCave"
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: "auto",
          height: "42px",
          overflow: "visible",
        }}
      >
        <img className="decave-top-mark" src={decaveMark} alt="" draggable={false} />
        <span
          aria-label="DeCave"
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            fontSize: "21px",
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: "-0.055em",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--ds-text)" }}>De</span>
          <span
            style={{
              color: "var(--ds-accent)",
              background: "linear-gradient(180deg, #667cff 0%, #6b57ff 45%, #8a49ff 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            C
          </span>
          <span style={{ color: "var(--ds-text)" }}>ave</span>
        </span>
      </div>

      <HubSwitcher
        hubs={servers.map((server) => {
          const textRoomIds = server.channels.filter((channel) => channel.type === "text").map((channel) => channel.id);
          return {
            id: server.id,
            name: server.name,
            icon: server.icon,
            iconUrl: server.iconUrl ? `${HTTP_URL}${server.iconUrl}` : null,
            accent: server.accent,
            iconRing: server.iconRing,
            role: server.myRole,
            muted: mutedHubIds.includes(server.id),
            unread: textRoomIds.reduce((total, channelId) => total + (roomUnread[channelId] ?? 0), 0),
            mentions: textRoomIds.reduce((total, channelId) => total + (roomMentions[channelId] ?? 0), 0),
          };
        })}
        activeId={selectedServer}
        onSelect={(hubId) => changeServer(hubId)}
        onContextMenu={(event, hubId) => {
          const server = servers.find((item) => item.id === hubId);
          if (server) openResourceContextMenu(event, { kind: "hub", server });
        }}
        onCreate={() => {
          setNewServerName("");
          setNewServerVisibility("private");
          setNewServerTemplate("blank");
          setServerCreateError("");
          setShowCreateServer(true);
        }}
      />

      <div
        className="decave-active-hub"
        style={{
          minWidth: 0,
          maxWidth: "180px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          lineHeight: 1.05,
        }}
        title={currentServer.name}
      >
        <span
          style={{
            color: "var(--ds-muted)",
            fontSize: "8px",
            fontWeight: 900,
            letterSpacing: ".12em",
            whiteSpace: "nowrap",
          }}
        >
          ACTIVE HUB
        </span>
        <strong
          style={{
            maxWidth: "100%",
            marginTop: "4px",
            color: "var(--ds-text)",
            fontSize: "12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentServer.name}
        </strong>
      </div>

      <div className="vadrion-top-account" style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <div className="dc-global-tools">
          <button
            type="button"
            className="dc-top-search"
            onClick={() => {
              setCommandPaletteQuery("");
              setShowCommandPalette(true);
              setCommandPaletteIndex(0);
              setShowInbox(false);
            }}
            title="Search and quick switch (Ctrl+K)"
            aria-label="Search and quick switch"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>Search</span>
          </button>
          <button
            type="button"
            className="dc-top-inbox"
            onClick={() => {
              setShowInbox(true);
              setShowCommandPalette(false);
            }}
            title="Inbox (Ctrl+Shift+I)"
            aria-label={`Inbox${inboxTotal ? `, ${inboxTotal} unread` : ""}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M10 21h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            {inboxTotal > 0 && <b>{inboxTotal > 99 ? "99+" : inboxTotal}</b>}
          </button>
        </div>
        {squadCurrent && (
          <button
            type="button"
            className="dc-top-squad-status"
            title={`Squad search running · ${squadCurrent.game}`}
            onClick={openSquadFinderWorkspace}
          >
            <i aria-hidden="true" />
            <span>
              <strong>Squad search</strong>
              <small>{squadCurrent.game}</small>
            </span>
          </button>
        )}
        <button
          type="button"
          className="vadrion-top-user vadrion-top-user-button"
          onClick={(event) =>
            openUserContextMenu(event, {
              userId: currentUser.id,
              username: currentUser.username,
              avatarUrl: currentUser.avatarUrl,
              role: currentServer.myRole,
              connectionId: selfConnectionIdRef.current || undefined,
              voiceParticipant: voiceParticipants.find(
                (participant) => participant.connectionId === selfConnectionIdRef.current,
              ),
              source: "top-profile",
            })
          }
          onContextMenu={(event) =>
            openUserContextMenu(event, {
              userId: currentUser.id,
              username: currentUser.username,
              avatarUrl: currentUser.avatarUrl,
              role: currentServer.myRole,
              connectionId: selfConnectionIdRef.current || undefined,
              voiceParticipant: voiceParticipants.find(
                (participant) => participant.connectionId === selfConnectionIdRef.current,
              ),
              source: "top-profile",
            })
          }
          title="Your profile"
          style={{
            minWidth: "172px",
            maxWidth: "220px",
            display: "grid",
            gridTemplateColumns: "36px minmax(0, 1fr) auto",
            alignItems: "center",
            columnGap: "9px",
            overflow: "visible",
          }}
        >
          <span className="vadrion-top-user-avatar-wrap">
            <UserAvatar
              className="vadrion-top-user-avatar"
              username={currentUser.username}
              avatarUrl={currentUser.avatarUrl}
              style={{
                border: `2px solid ${profileAccent}`,
                boxShadow: `0 0 0 2px ${profileAccent}22, 0 0 12px ${profileAccent}55`,
              }}
            />
            <span
              className={`vadrion-top-user-status ${currentUser.status ?? "online"}`}
              title={presenceLabel(currentUser.status, true)}
              style={{
                background: presenceColor(currentUser.status, true),
                boxShadow: presenceGlow(currentUser.status, true),
              }}
            />
          </span>
          <span
            className="vadrion-top-user-copy"
            style={{
              minWidth: 0,
              display: "grid",
              gap: "1px",
              textAlign: "left",
              overflow: "visible",
            }}
          >
            <strong
              style={{
                display: "block",
                maxWidth: "145px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={currentUser.username}
            >
              {currentUser.username}
            </strong>
            <small
              style={{
                display: "block",
                maxWidth: "145px",
                overflow: "visible",
                textOverflow: "clip",
                whiteSpace: "nowrap",
                textTransform: "none",
                letterSpacing: ".02em",
                fontWeight: 800,
              }}
              title={
                currentServer.myRole
                  ? currentServer.myRole.charAt(0).toUpperCase() + currentServer.myRole.slice(1)
                  : "Member"
              }
            >
              {currentServer.myRole
                ? currentServer.myRole.charAt(0).toUpperCase() + currentServer.myRole.slice(1)
                : "Member"}
            </small>
          </span>
          <span className="vadrion-top-user-chevron" aria-hidden="true">
            <Icon name="chevron-down" size="sm" />
          </span>
        </button>
      </div>
    </header>
  );
}
