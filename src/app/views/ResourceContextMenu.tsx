// Right-click menu for a Hub or room: open it, copy its share link, mute the Hub, or manage it.

import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { Server, ResourceContextMenuState } from "../types";
import type { ContextMenuActions } from "../actions/context-menus";

type Props = {
  mutedHubIds: number[];
  selectedServer: number;
  resourceContextMenu: ResourceContextMenuState;
  setResourceContextMenu: Dispatch<SetStateAction<ResourceContextMenuState | null>>;
  setResourceContextMoreOpen: Dispatch<SetStateAction<boolean>>;
  toggleMutedHub: (serverId: number) => void;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  contextMenus: ContextMenuActions;
};

export function ResourceContextMenu({
  mutedHubIds,
  selectedServer,
  resourceContextMenu,
  setResourceContextMenu,
  setResourceContextMoreOpen,
  toggleMutedHub,
  changeServer,
  changeChannel,
  contextMenus,
}: Props) {
  const { openManageServerFor, openManageChannelFor, copyHubShareLink } = contextMenus;
  const target = resourceContextMenu.target;
  const isHub = target.kind === "hub";
  const server = target.server;
  const channel = target.kind === "room" ? target.channel : null;
  const canManageHub = server.myRole === "owner" || server.myRole === "admin";
  const canManageRoom = canManageHub;
  const canEdit = isHub ? canManageHub : canManageRoom;

  const menuButtonStyle: CSSProperties = {
    width: "100%",
    border: 0,
    borderRadius: "9px",
    padding: "9px 10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    background: "transparent",
    color: "#dce6f7",
    fontSize: "12px",
    fontWeight: 750,
    textAlign: "left",
    cursor: "pointer",
  };

  const menuMutedStyle: CSSProperties = {
    color: "#718099",
    fontSize: "10px",
    fontWeight: 800,
    letterSpacing: ".08em",
    textTransform: "uppercase",
  };

  return (
    <div
      style={{
        position: "fixed",
        left: resourceContextMenu.x,
        top: resourceContextMenu.y,
        zIndex: 10050,
        width: "224px",
        padding: "7px",
        border: "1px solid color-mix(in srgb, var(--ds-border) 28%, transparent)",
        borderRadius: "13px",
        background: "linear-gradient(180deg, rgba(14,20,36,.985), rgba(8,13,25,.985))",
        boxShadow: "0 18px 50px rgba(0,0,0,.48), 0 0 0 1px rgba(111,228,255,.04) inset",
        backdropFilter: "blur(18px)",
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        style={{
          padding: "7px 9px 8px",
          borderBottom: "1px solid color-mix(in srgb, var(--ds-border) 15%, transparent)",
          marginBottom: "5px",
          minWidth: 0,
        }}
      >
        <div style={menuMutedStyle}>{isHub ? "HUB" : `${channel?.type ?? ""} ROOM`}</div>
        <strong
          style={{
            display: "block",
            marginTop: "3px",
            color: "var(--ds-text)",
            fontSize: "13px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={isHub ? server.name : channel?.name}
        >
          {isHub ? server.name : channel?.name}
        </strong>
      </div>

      <button
        type="button"
        style={menuButtonStyle}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "rgba(111,228,255,.08)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
        }}
        onClick={() => {
          if (isHub) {
            changeServer(server.id);
          } else if (channel) {
            if (selectedServer !== server.id) changeServer(server.id);
            changeChannel(channel.id);
          }
          setResourceContextMenu(null);
          setResourceContextMoreOpen(false);
        }}
      >
        <span>Open</span>
        <span className="ds-text-accent">
          <Icon name="external" size="sm" />
        </span>
      </button>

      {isHub && (
        <button
          type="button"
          style={menuButtonStyle}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "rgba(111,228,255,.08)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
          onClick={() => void copyHubShareLink(server)}
        >
          <span>Copy Share Link</span>
          <span className="ds-text-accent">
            <Icon name="link" size="sm" />
          </span>
        </button>
      )}

      {isHub && (
        <button
          type="button"
          style={menuButtonStyle}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "rgba(255,255,255,.045)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
          onClick={() => {
            toggleMutedHub(server.id);
            setResourceContextMenu(null);
            setResourceContextMoreOpen(false);
          }}
        >
          <span>{mutedHubIds.includes(server.id) ? "Unmute Hub" : "Mute Hub"}</span>
          <span className="ds-text-muted">
            <Icon name={mutedHubIds.includes(server.id) ? "check" : "bell"} size="sm" />
          </span>
        </button>
      )}

      {canEdit && (
        <button
          type="button"
          style={menuButtonStyle}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "rgba(124,92,255,.12)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
          onClick={() => {
            setResourceContextMenu(null);
            setResourceContextMoreOpen(false);
            if (isHub) {
              openManageServerFor(server);
            } else if (channel) {
              openManageChannelFor(server, channel);
            }
          }}
        >
          <span>Edit {isHub ? "Hub" : "Room"}</span>
          <span className="ds-text-accent">
            <Icon name="edit" size="sm" />
          </span>
        </button>
      )}
    </div>
  );
}
