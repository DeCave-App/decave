// Left sidebar of an open Hub: banner, Hub header and room list.

import { hubRoleName } from "./roleLabels";
import { formatNumber } from "../../i18n/format";
import { useTranslation } from "react-i18next";
import type { CSSProperties, Dispatch, SetStateAction, MutableRefObject, DragEvent as ReactDragEvent } from "react";
import { Icon } from "../../components/Icon";
import { HubRoomBoxes, type ForumPreview } from "../../features/hub-sidebar/HubRoomBoxes";
import type { HubHomeCatchUp } from "../../features/hub-home/HubHome";
import { VoicePanel } from "../../features/hub-sidebar/VoicePanel";
import { HubCalendarPage } from "../../features/calendar";
import type { CalendarItem, EventComposerSeed, HubEventsStore } from "../../features/events";
import type { Channel, Server, ServerMemberView, VoiceParticipant, VoiceJoinAttempt } from "../types";
import { HTTP_URL } from "../env";
import { memberRoleIcons, presenceLabel } from "../user-display";
import { UserAvatar } from "../components/UserAvatar";
import { HubActionIcon } from "../components/HubActionIcon";
import type { HubPanelsState } from "../state/hub-panels";
import type { VoiceCallState } from "../state/voice-call";
import type { CallMediaState } from "../state/call-media";
import type { VoiceControlActions } from "../actions/voice-controls";
import type { ContextMenuActions } from "../actions/context-menus";

type Props = {
  homeCalendarBusy: boolean;
  homeCalendarNotice: string;
  roomUnread: Record<number, number>;
  roomMentions: Record<number, number>;
  servers: Server[];
  selectedChannel: number;
  hubMembers: ServerMemberView[];
  roomReorderError: string;
  setRoomReorderError: Dispatch<SetStateAction<string>>;
  lobbyPendingJoinRef: MutableRefObject<{ channelId: number; muted: boolean; camera: boolean } | null>;
  showManageServer: boolean;
  manageUseBannerBackground: boolean;
  hubRailCollapsed: boolean;
  setHubRailCollapsed: Dispatch<SetStateAction<boolean>>;
  forumPreviews: Record<number, ForumPreview | null>;
  hubMembersPanelSearch: string;
  setHubMembersPanelSearch: Dispatch<SetStateAction<string>>;
  hubMembersPanelRole: string;
  setHubMembersPanelRole: Dispatch<SetStateAction<string>>;
  draggedChannelId: number | null;
  voiceParticipants: VoiceParticipant[];
  voiceChannelId: number | null;
  voiceJoinAttemptRef: MutableRefObject<VoiceJoinAttempt | null>;
  selfConnectionIdRef: MutableRefObject<string>;
  currentServer: Server;
  currentChannel: Channel;
  isStreamerHub: boolean;
  streamerOverviewActive: boolean;
  streamerSidebarProps: {
    "data-streamer-sidebar": string | undefined;
    style: { "--dc-streamer-sidebar-banner": string };
  };
  canManageCurrentServer: boolean;
  canManageCurrentRooms: boolean;
  /** Bot managers (Manage Bots / Manage Rooms) reach Hub settings for the Bots section. */
  canManageCurrentBots?: boolean;
  isCurrentServerOwner: boolean;
  hubEvents: HubEventsStore;
  syncHomeCalendar: () => Promise<void>;
  isParticipantSpeaking: (participant: VoiceParticipant) => boolean;
  joinVoiceChannel: (channelId: number, recoveryRetry?: boolean) => Promise<void>;
  leaveVoice: () => void;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  leaveServer: () => Promise<void>;
  openManageServer: () => void;
  reorderChannel: (sourceId: number, targetId: number) => Promise<void>;
  openCreateRoomOfType: (type: "text" | "voice" | "forum") => void;
  channelDragProps: (channel: Channel) => {
    draggable: boolean;
    onDragStart: (event: ReactDragEvent<HTMLElement>) => void;
    onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
    onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
    onDrop: (event: ReactDragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  openEventComposerWith: (seed: EventComposerSeed, hubId?: number) => void;
  currentHubCalendarItems: CalendarItem[];
  hubCalendarUpcomingCount: number;
  canCreateEventsIn: (hubId: number) => boolean;
  openCalendarItem: (item: CalendarItem) => void;
  openHubCalendar: (forceOpen?: boolean) => void;
  primaryHubsActive: boolean;
  hiddenHubRailProps: Record<string, unknown>;
  ownVoiceRttMs: number | null;
  voiceQuality: "good" | "fair" | "poor" | null;
  voiceAudioHealth: { loss: number; conceal: number; jitter: number } | null;
  hubHomeActive: boolean;
  hubHomeCatchUp: HubHomeCatchUp[];
  hubPanels: HubPanelsState;
  voiceCall: VoiceCallState;
  callMedia: CallMediaState;
  voiceControls: VoiceControlActions;
  contextMenus: ContextMenuActions;
};

export function HubSidebar({
  homeCalendarBusy,
  homeCalendarNotice,
  roomUnread,
  roomMentions,
  servers,
  selectedChannel,
  hubMembers,
  roomReorderError,
  setRoomReorderError,
  lobbyPendingJoinRef,
  showManageServer,
  manageUseBannerBackground,
  hubRailCollapsed,
  setHubRailCollapsed,
  forumPreviews,
  hubMembersPanelSearch,
  setHubMembersPanelSearch,
  hubMembersPanelRole,
  setHubMembersPanelRole,
  draggedChannelId,
  voiceParticipants,
  voiceChannelId,
  voiceJoinAttemptRef,
  selfConnectionIdRef,
  currentServer,
  currentChannel,
  isStreamerHub,
  streamerOverviewActive,
  streamerSidebarProps,
  canManageCurrentServer,
  canManageCurrentRooms,
  canManageCurrentBots,
  isCurrentServerOwner,
  hubEvents,
  syncHomeCalendar,
  isParticipantSpeaking,
  joinVoiceChannel,
  leaveVoice,
  changeServer,
  changeChannel,
  leaveServer,
  openManageServer,
  reorderChannel,
  openCreateRoomOfType,
  channelDragProps,
  openEventComposerWith,
  currentHubCalendarItems,
  hubCalendarUpcomingCount,
  canCreateEventsIn,
  openCalendarItem,
  openHubCalendar,
  primaryHubsActive,
  hiddenHubRailProps,
  ownVoiceRttMs,
  voiceAudioHealth,
  voiceQuality,
  hubHomeActive,
  hubHomeCatchUp,
  hubPanels,
  voiceCall,
  callMedia,
  voiceControls,
  contextMenus,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const { openUserContextMenu, openResourceContextMenu } = contextMenus;
  const { toggleMute, toggleDeafen, stopScreenShare, startScreenShare } = voiceControls;
  const { isScreenSharing } = callMedia;
  const { lobbyJoinMuted, voiceStatus, setVoiceChatOpen, isMuted, isDeafened, isServerMuted, isServerDeafened } =
    voiceCall;
  const {
    showHubMembersPanel,
    setShowHubMembersPanel,
    setShowHubHome,
    setShowStreamerOverview,
    showHubCalendarPanel,
    setShowHubCalendarPanel,
  } = hubPanels;
  return (
    <aside
      className="channel-sidebar hsb-sidebar"
      data-hub-banner={
        (showManageServer ? manageUseBannerBackground : currentServer.useBannerBackground === true) &&
        currentServer.bannerUrl
          ? "on"
          : "off"
      }
      {...hiddenHubRailProps}
      {...streamerSidebarProps}
      style={
        {
          // The banner is only painted when "Use banner as background" is on
          // (live preview while Manage Hub is open, saved flag otherwise).
          "--hub-cover-image":
            (showManageServer ? manageUseBannerBackground : currentServer.useBannerBackground === true) &&
            currentServer.bannerUrl
              ? `url(${HTTP_URL}${currentServer.bannerUrl})`
              : "none",
          ...streamerSidebarProps.style,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="dc-hub-rail-fold"
        title={hubRailCollapsed ? t("hub.sidebar.show") : t("hub.sidebar.hide")}
        aria-label={hubRailCollapsed ? t("hub.sidebar.show") : t("hub.sidebar.hide")}
        onClick={() =>
          setHubRailCollapsed((current) => {
            const next = !current;
            try {
              localStorage.setItem("decave-hub-rail-collapsed-v1", next ? "1" : "0");
            } catch {}
            return next;
          })
        }
      >
        <Icon name={hubRailCollapsed ? "chevron-right" : "chevron-left"} size="sm" />
      </button>
      <div
        className="server-header v21-hub-header hub-c__cover hbx-strip"
        style={
          currentServer.bannerUrl &&
          !(showManageServer ? manageUseBannerBackground : currentServer.useBannerBackground === true)
            ? ({ "--hbx-strip-image": `url(${HTTP_URL}${currentServer.bannerUrl})` } as CSSProperties)
            : undefined
        }
        onContextMenu={(event) => openResourceContextMenu(event, { kind: "hub", server: currentServer })}
      >
        <div className="hub-c__cover-shade" aria-hidden="true" />
        <div className="hub-c__identity">
          {currentServer.iconUrl ? (
            <img
              className="vadrion-hub-badge v21-hub-image hub-c__avatar"
              src={`${HTTP_URL}${currentServer.iconUrl}`}
              alt=""
            />
          ) : (
            <div className="vadrion-hub-badge hub-c__avatar">{currentServer.icon}</div>
          )}
          <div className="vadrion-hub-copy hsb-hub-copy" style={{ minWidth: 0 }}>
            <strong title={currentServer.name}>{currentServer.name}</strong>
            <div className="hsb-hub-stats">
              {currentServer.membershipPrivate && !isCurrentServerOwner ? (
                <span>
                  <Icon name="lock" size="sm" />
                  {t("hub.sidebar.membershipPrivate")}
                </span>
              ) : (
                <>
                  <span>
                    <i className="hsb-dot online" aria-hidden="true" />
                    {t("hub.sidebar.online", {
                      count: currentServer.onlineCount ?? 0,
                      value: formatNumber(currentServer.onlineCount ?? 0),
                    })}
                  </span>
                  <span>
                    <i className="hsb-dot" aria-hidden="true" />
                    {t("hub.sidebar.members", {
                      count: currentServer.memberCount ?? 0,
                      value: formatNumber(currentServer.memberCount ?? 0),
                    })}
                  </span>
                </>
              )}
            </div>
            {(currentServer.ownerOnlyPosting ||
              currentServer.myRole === "owner" ||
              currentServer.myRole === "admin" ||
              currentServer.visibility === "private") && (
              <div className="hsb-hub-badges">
                {currentServer.ownerOnlyPosting && (
                  <span className="hsb-badge official">
                    <Icon name="check" size="sm" />
                    {t("hub.sidebar.official")}
                  </span>
                )}
                {currentServer.myRole === "owner" && (
                  <span className="hsb-badge owner">
                    <Icon name="crown" size="sm" />
                    {t("common.roles.owner")}
                  </span>
                )}
                {currentServer.myRole === "admin" && (
                  <span className="hsb-badge">
                    <Icon name="shield" size="sm" />
                    {t("common.roles.admin")}
                  </span>
                )}
                {currentServer.visibility === "private" && (
                  <span className="hsb-badge">
                    <Icon name="lock" size="sm" />
                    {t("hub.sidebar.private")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {servers.length > 0 && currentServer.myRole !== "owner" && (
          <div className="hub-c__leave-control" style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
            <button
              type="button"
              className="hsb-leave"
              title={t("hub.sidebar.leave")}
              aria-label={t("hub.sidebar.leave")}
              onClick={() => void leaveServer()}
            >
              <Icon name="log-out" size="sm" />
            </button>
          </div>
        )}
      </div>

      {showHubMembersPanel && (
        <div className="dc-hub-members-popover">
          <div className="dc-hub-members-popover-head">
            <strong>{t("hub.sidebar.membersTitle")}</strong>
            <button type="button" onClick={() => setShowHubMembersPanel(false)}>
              <Icon name="close" size="sm" />
            </button>
          </div>
          <input
            className="dc-hub-members-search"
            type="search"
            value={hubMembersPanelSearch}
            onChange={(event) => setHubMembersPanelSearch(event.target.value)}
            placeholder={t("hub.sidebar.searchMembers")}
            aria-label={t("hub.sidebar.searchMembers")}
          />
          <div className="dc-hub-member-filters role-only">
            <select
              value={hubMembersPanelRole}
              onChange={(event) => setHubMembersPanelRole(event.target.value)}
              aria-label={t("hub.sidebar.filterRole")}
            >
              <option value="all">{t("hub.sidebar.allRoles")}</option>
              <option value="owner">{t("hub.sidebar.owners")}</option>
              <option value="admin">{t("hub.sidebar.admins")}</option>
              <option value="moderator">{t("hub.sidebar.moderators")}</option>
              <option value="member">{t("hub.sidebar.membersFilter")}</option>
            </select>
          </div>
          {(() => {
            const query = hubMembersPanelSearch.trim().toLowerCase();
            const filteredMembers = hubMembers
              .filter(
                (member) =>
                  (!query || member.username.toLowerCase().includes(query)) &&
                  (hubMembersPanelRole === "all" || member.role.toLowerCase() === hubMembersPanelRole),
              )
              .sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
            return (
              <div className="dc-hub-members-list">
                {filteredMembers.map((member) => (
                  <button
                    type="button"
                    className="dc-hub-member-row"
                    key={member.userId}
                    onClick={(event) =>
                      openUserContextMenu(event, {
                        userId: member.userId,
                        username: member.username,
                        avatarUrl: member.avatarUrl,
                        role: member.role,
                      })
                    }
                  >
                    <UserAvatar username={member.username} avatarUrl={member.avatarUrl} />
                    <span>
                      <strong>
                        <span
                          className="dc-member-role-icons"
                          title={t("hub.sidebar.roleTitle", { role: hubRoleName(member.role) })}
                        >
                          {memberRoleIcons(member)}
                        </span>{" "}
                        {member.username}
                      </strong>
                      <small>
                        {t("hub.sidebar.memberMeta", {
                          role: hubRoleName(member.role),
                          presence: presenceLabel(member.status, member.online),
                        })}
                      </small>
                    </span>
                  </button>
                ))}
                {filteredMembers.length === 0 && (
                  <div className="dc-hub-members-empty">{t("hub.sidebar.noMembers")}</div>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {showHubCalendarPanel && (
        <HubCalendarPage
          key={currentServer.id}
          hubName={currentServer.name}
          items={currentHubCalendarItems}
          canCreate={canCreateEventsIn(currentServer.id)}
          busy={hubEvents.busy || homeCalendarBusy}
          error={hubEvents.byHub[currentServer.id]?.error || homeCalendarNotice}
          onClose={() => setShowHubCalendarPanel(false)}
          onCreate={(start, end) => openEventComposerWith({ start, end })}
          onOpenItem={openCalendarItem}
          onRangeChange={(from, to) => void hubEvents.load(currentServer.id, from, to)}
          onRefresh={() => {
            void hubEvents.refreshHub(currentServer.id);
            void syncHomeCalendar();
          }}
        />
      )}

      <HubRoomBoxes
        hubId={currentServer.id}
        rooms={currentServer.channels}
        selectedRoomId={selectedChannel}
        homeSelected={hubHomeActive || streamerOverviewActive}
        homeBadge={hubHomeCatchUp.length}
        onOpenHome={() => {
          setShowHubCalendarPanel(false);
          // Streamer Hubs keep their own overview as the home surface.
          if (isStreamerHub) setShowStreamerOverview(true);
          else setShowHubHome(true);
        }}
        forumPreviews={forumPreviews}
        homeActions={
          <div
            className="dc-hub-visible-actions hsb-nav hbx-actions"
            role="toolbar"
            aria-label={t("hub.sidebar.navigation")}
          >
            {(!currentServer.membershipPrivate || isCurrentServerOwner) && (
              <button
                type="button"
                data-hub-members-toggle="true"
                aria-label={t("hub.sidebar.membersCount", { members: hubMembers.length })}
                data-tooltip={t("hub.sidebar.membersTooltip", { members: hubMembers.length })}
                aria-expanded={showHubMembersPanel}
                onClick={() => setShowHubMembersPanel((value) => !value)}
              >
                <HubActionIcon kind="members" />
                <span>{t("hub.sidebar.membersCount", { members: hubMembers.length })}</span>
              </button>
            )}
            {currentServer.channels.some((channel) => channel.type === "text") && (
              <button
                type="button"
                data-hub-calendar-toggle="true"
                aria-label={
                  hubCalendarUpcomingCount > 0
                    ? t("hub.sidebar.calendarUpcoming", { count: hubCalendarUpcomingCount })
                    : t("hub.sidebar.calendar")
                }
                data-tooltip={t("hub.sidebar.calendar")}
                onClick={() => openHubCalendar()}
              >
                <HubActionIcon kind="calendar" />
                <span>
                  {hubCalendarUpcomingCount > 0
                    ? t("hub.sidebar.calendarCount", { upcoming: hubCalendarUpcomingCount })
                    : t("hub.sidebar.calendar")}
                </span>
                {hubCalendarUpcomingCount > 0 && (
                  <b className="hsb-nav-badge" aria-hidden="true">
                    {hubCalendarUpcomingCount > 9 ? "9+" : hubCalendarUpcomingCount}
                  </b>
                )}
              </button>
            )}
            {(canManageCurrentServer || canManageCurrentBots) && (
              <button
                type="button"
                aria-label={t("hub.sidebar.manage")}
                data-tooltip={t("hub.sidebar.manage")}
                onClick={openManageServer}
              >
                <HubActionIcon kind="manage" />
                <span>{t("hub.sidebar.manage")}</span>
              </button>
            )}
          </div>
        }
        draggedRoomId={draggedChannelId}
        ownerOnlyPosting={currentServer.ownerOnlyPosting === true}
        canManageRooms={canManageCurrentRooms}
        unread={roomUnread}
        mentions={roomMentions}
        voiceParticipants={voiceParticipants}
        connectedVoiceRoomId={voiceChannelId}
        reorderError={roomReorderError}
        onDismissReorderError={() => setRoomReorderError("")}
        dragProps={channelDragProps}
        onSelectRoom={(channel) => changeChannel(channel.id)}
        onJoinVoiceRoom={(channel) => {
          if (selectedChannel !== channel.id || hubHomeActive) changeChannel(channel.id);
          if (voiceChannelId === channel.id || voiceJoinAttemptRef.current !== null) return;
          lobbyPendingJoinRef.current = { channelId: channel.id, muted: lobbyJoinMuted, camera: false };
          void joinVoiceChannel(channel.id);
        }}
        onRoomContextMenu={(event, channel) =>
          openResourceContextMenu(event, { kind: "room", server: currentServer, channel })
        }
        onReorderRooms={(sourceId, targetId) => void reorderChannel(sourceId, targetId)}
        onCreateRoom={openCreateRoomOfType}
        isSpeaking={isParticipantSpeaking}
        onParticipantClick={(event, participant) => {
          if (participant.connectionId === selfConnectionIdRef.current) {
            openUserContextMenu(event, {
              userId: participant.userId,
              username: participant.username,
              avatarUrl: participant.avatarUrl,
              role: participant.role,
              connectionId: participant.connectionId,
              voiceParticipant: participant,
            });
          }
        }}
        onParticipantContextMenu={(event, participant) =>
          openUserContextMenu(event, {
            userId: participant.userId,
            username: participant.username,
            avatarUrl: participant.avatarUrl,
            role: participant.role,
            connectionId: participant.connectionId,
            voiceParticipant: participant,
          })
        }
        renderAvatar={(participant) => <UserAvatar username={participant.username} avatarUrl={participant.avatarUrl} />}
      />

      {/* Rooms are created from the "+" in each room box (or the empty-Hub button). */}
      {/* The stage control bar replaces these voice controls while the connected room is on screen. */}
      {voiceChannelId !== null &&
        !(
          primaryHubsActive &&
          !hubHomeActive &&
          currentChannel.type === "voice" &&
          currentChannel.id === voiceChannelId
        ) &&
        (() => {
          const voiceServer = servers.find((server) =>
            server.channels.some((channel) => channel.id === voiceChannelId),
          );
          const voiceRoom = voiceServer?.channels.find((channel) => channel.id === voiceChannelId);
          return (
            <VoicePanel
              roomName={voiceRoom?.name ?? t("hub.sidebar.voiceRoom")}
              hubName={voiceServer && voiceServer.id !== currentServer.id ? voiceServer.name : undefined}
              status={voiceStatus}
              quality={voiceQuality}
              rttMs={ownVoiceRttMs}
              audioHealth={voiceAudioHealth}
              participants={voiceParticipants
                .filter((participant) => participant.channelId === voiceChannelId)
                .map((participant) => ({
                  id: participant.connectionId,
                  name: participant.username,
                  avatarUrl: participant.avatarUrl,
                  speaking: isParticipantSpeaking(participant),
                }))}
              muted={isMuted}
              serverMuted={isServerMuted}
              deafened={isDeafened}
              serverDeafened={isServerDeafened}
              screenSharing={isScreenSharing}
              onOpenRoom={() => {
                if (voiceServer && voiceServer.id !== currentServer.id) changeServer(voiceServer.id);
                changeChannel(voiceChannelId);
                setVoiceChatOpen(false);
              }}
              onToggleMute={toggleMute}
              onToggleDeafen={toggleDeafen}
              onToggleScreenShare={() => {
                if (isScreenSharing) stopScreenShare();
                else void startScreenShare();
              }}
              onDisconnect={leaveVoice}
            />
          );
        })()}
    </aside>
  );
}
