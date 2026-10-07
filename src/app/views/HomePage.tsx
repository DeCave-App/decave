// Home: your personal dashboard of widgets (Hubs, friends, voice rooms, events, messages, now playing, notes, quick links).

import type { Dispatch, SetStateAction } from "react";
import type { HubTemplateId } from "../../../shared/hub-templates";
import { Icon } from "../../components/Icon";
import {
  DEFAULT_HOME_PRESET,
  HOME_WIDGET_DEFINITIONS,
  HomeClockWidget,
  HomeDashboardHero,
  HomeEmpty,
  HomeEventsWidget,
  HomeFriendsWidget,
  HomeHubsWidget,
  HomeJumpBackWidget,
  HomeMessagesWidget,
  HomeNotesWidget,
  HomeNowPlayingWidget,
  HomeProfileWidget,
  HomeStatsWidget,
  HomeVoiceRoomsWidget,
  HomeWidgetBoard,
  HomeWidgetLibrary,
  homeWidgetDefinition,
  type HomeBoardItem,
  type HomeWidgetSize,
} from "../../features/home";
import { itemColor as calendarItemColor } from "../../features/events/model";
import { isLive, itemEnd, formatCountdown, type CalendarItem, type HubEventsStore } from "../../features/events";
import type {
  ServerVisibility,
  Channel,
  Server,
  AccountUser,
  VoiceParticipant,
  SocialUser,
  DmConversation,
  ActivityState,
  HomeDashboardWidget,
} from "../types";
import { loadLastWorkspaceSelection } from "../settings-storage";
import {
  MAX_EXTERNAL_HOME_WIDGETS,
  MAX_EXTERNAL_HOME_WIDGET_TITLE_LENGTH,
  MAX_EXTERNAL_HOME_WIDGET_URL_LENGTH,
  MAX_HOME_QUICK_LINK_NAME_LENGTH,
  type HomeQuickLink,
  isExternalHomeWidget,
} from "../home-dashboard";
import { activeTimeFormatPreference } from "../locale";
import { HomeQuickLinkLogo } from "../components/HomeQuickLinkLogo";
import { resolveAvatarUrl, presenceLabel, presenceColor } from "../user-display";
import { UserAvatar } from "../components/UserAvatar";
import type { ExternalWidgetFormState } from "../state/external-widget-form";
import type { PageNavigation } from "../actions/page-navigation";
import type { HomeDashboardActions } from "../actions/home-dashboard";

type Props = {
  currentUser: AccountUser;
  activityState: ActivityState | null;
  homeWidgets: HomeDashboardWidget[];
  homeQuickLinks: HomeQuickLink[];
  homeCalendarBusy: boolean;
  homeCalendarNotice: string;
  homeEditMode: boolean;
  setHomeEditMode: Dispatch<SetStateAction<boolean>>;
  showQuickLinkEditor: boolean;
  setShowQuickLinkEditor: Dispatch<SetStateAction<boolean>>;
  quickLinkDraft: HomeQuickLink[];
  quickLinkError: string;
  setQuickLinkError: Dispatch<SetStateAction<string>>;
  homeNotes: string;
  setHomeNotes: Dispatch<SetStateAction<string>>;
  setShowHome: Dispatch<SetStateAction<boolean>>;
  roomUnread: Record<number, number>;
  servers: Server[];
  setShowCreateServer: Dispatch<SetStateAction<boolean>>;
  setNewServerName: Dispatch<SetStateAction<string>>;
  setNewServerVisibility: Dispatch<SetStateAction<ServerVisibility>>;
  setNewServerTemplate: Dispatch<SetStateAction<HubTemplateId>>;
  setServerCreateError: Dispatch<SetStateAction<string>>;
  setShowServerBrowser: Dispatch<SetStateAction<boolean>>;
  friends: SocialUser[];
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setSocialView: Dispatch<SetStateAction<"friends" | "dm">>;
  dmConversations: DmConversation[];
  dmUnread: Record<string, number>;
  voiceParticipants: VoiceParticipant[];
  voiceChannelId: number | null;
  currentServer: Server;
  hubEvents: HubEventsStore;
  syncHomeCalendar: () => Promise<void>;
  openServerBrowser: () => void;
  loadSocialState: () => Promise<void>;
  openDirectMessage: (user: SocialUser) => Promise<void>;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  dmUnreadTotal: number;
  allCalendarItems: CalendarItem[];
  openCalendarItem: (item: CalendarItem) => void;
  leaveCalendarForRoom: (hubId: number, roomId: number, joinVoiceRoom: boolean) => void;
  automaticActivityElapsed: string;
  currentAutomaticGameName: string;
  currentGameIcon: string;
  activeVoiceLocation: { server: Server; channel: Channel } | null;
  externalWidgetForm: ExternalWidgetFormState;
  pageNavigation: PageNavigation;
  homeDashboard: HomeDashboardActions;
};

export function HomePage({
  currentUser,
  activityState,
  homeWidgets,
  homeQuickLinks,
  homeCalendarBusy,
  homeCalendarNotice,
  homeEditMode,
  setHomeEditMode,
  showQuickLinkEditor,
  setShowQuickLinkEditor,
  quickLinkDraft,
  quickLinkError,
  setQuickLinkError,
  homeNotes,
  setHomeNotes,
  setShowHome,
  roomUnread,
  servers,
  setShowCreateServer,
  setNewServerName,
  setNewServerVisibility,
  setNewServerTemplate,
  setServerCreateError,
  setShowServerBrowser,
  friends,
  setShowSocial,
  setSocialView,
  dmConversations,
  dmUnread,
  voiceParticipants,
  voiceChannelId,
  currentServer,
  hubEvents,
  syncHomeCalendar,
  openServerBrowser,
  loadSocialState,
  openDirectMessage,
  changeServer,
  changeChannel,
  dmUnreadTotal,
  allCalendarItems,
  openCalendarItem,
  leaveCalendarForRoom,
  automaticActivityElapsed,
  currentAutomaticGameName,
  currentGameIcon,
  activeVoiceLocation,
  externalWidgetForm,
  pageNavigation,
  homeDashboard,
}: Props) {
  const {
    toggleHomeWidget,
    applyHomePreset,
    openQuickLinkEditor,
    updateQuickLinkDraft,
    removeQuickLinkDraft,
    restoreQuickLinkDefaults,
    saveQuickLinkChanges,
    addExternalHomeWidget,
    moveHomeWidget,
    removeHomeWidget,
    resizeHomeWidget,
  } = homeDashboard;
  const { openSettings, openHubsWorkspace, openDirectMessagesWorkspace, openSquadFinderWorkspace } = pageNavigation;
  const {
    showExternalWidgetForm,
    setShowExternalWidgetForm,
    externalWidgetTitle,
    setExternalWidgetTitle,
    externalWidgetUrl,
    setExternalWidgetUrl,
    externalWidgetSize,
    setExternalWidgetSize,
    externalWidgetError,
    setExternalWidgetError,
  } = externalWidgetForm;
  const homeNow = Date.now();
  const lastWorkspace = loadLastWorkspaceSelection();
  const lastHub = servers.find((hub) => hub.id === lastWorkspace.serverId) ?? (servers.length ? currentServer : null);
  const lastRoom = lastHub
    ? (lastHub.channels.find((room) => room.id === lastWorkspace.channelId) ?? lastHub.channels[0] ?? null)
    : null;
  const openRoom = (hubId: number, roomId: number) => {
    setShowHome(false);
    changeServer(hubId);
    window.setTimeout(() => changeChannel(roomId), 0);
  };
  const openFriends = () => {
    setShowHome(false);
    setShowServerBrowser(false);
    setShowSocial(true);
    setSocialView("friends");
    void loadSocialState();
  };
  const openDiscover = () => {
    setShowHome(false);
    setShowSocial(false);
    openServerBrowser();
  };
  const openCreateHub = () => {
    setShowHome(false);
    setNewServerName("");
    setNewServerVisibility("private");
    setNewServerTemplate("blank");
    setServerCreateError("");
    setShowCreateServer(true);
  };
  const onlineFriends = friends.filter((friend) => friend.online);
  const activeVoice = activeVoiceLocation
    ? {
        hubName: activeVoiceLocation.server.name,
        roomName: activeVoiceLocation.channel.name,
        people: voiceParticipants.map((person) => ({
          id: person.connectionId,
          name: person.username,
          avatar: <UserAvatar username={person.username} avatarUrl={person.avatarUrl} />,
        })),
        onOpen: () => openRoom(activeVoiceLocation.server.id, activeVoiceLocation.channel.id),
      }
    : null;
  const enabledHomeWidgets = new Set<string>(homeWidgets.map((item) => item.id));
  const closeCustomize = () => {
    setHomeEditMode(false);
    setShowExternalWidgetForm(false);
    setExternalWidgetError("");
    setShowQuickLinkEditor(false);
  };
  const externalCount = homeWidgets.filter(isExternalHomeWidget).length;

  const homeBoardItem = (widget: HomeDashboardWidget): HomeBoardItem => {
    const external = isExternalHomeWidget(widget);
    if (external) {
      return {
        id: widget.id,
        size: widget.size,
        title: widget.title,
        icon: "globe",
        sizes: ["small", "medium", "wide"],
        content: (
          <div className="hdx-external">
            {!window.decaveDesktop?.isDesktop && (
              <iframe
                className="hdx-external-frame"
                title={widget.title}
                src={widget.url}
                loading="lazy"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts"
              />
            )}
            <div className="hdx-external-note">
              <span>Untrusted website · isolated from DeCave</span>
              <a className="hdx-link" href={widget.url} target="_blank" rel="noopener noreferrer">
                Open externally ↗
              </a>
            </div>
          </div>
        ),
      };
    }
    const definition = homeWidgetDefinition(widget.id);
    const base = {
      id: widget.id,
      size: widget.size,
      title: definition.title,
      icon: definition.icon,
      sizes: definition.sizes,
    };

    if (widget.id === "nowPlaying") {
      return {
        ...base,
        live: Boolean(currentAutomaticGameName),
        content: (
          <HomeNowPlayingWidget
            game={currentAutomaticGameName || null}
            icon={currentGameIcon || null}
            source={
              activityState?.source === "desktop-epic"
                ? "Epic Games"
                : activityState?.source === "steam"
                  ? "Steam presence"
                  : "Steam / PC"
            }
            elapsed={automaticActivityElapsed ? `Playing for ${automaticActivityElapsed}` : ""}
          />
        ),
      };
    }

    if (widget.id === "quickLinks") {
      const visibleQuickLinks = homeQuickLinks.filter((link) => link.visible);
      return {
        ...base,
        action: (
          <button type="button" className="hdx-link" onClick={openQuickLinkEditor}>
            Edit
          </button>
        ),
        content: showQuickLinkEditor ? (
          <div className="hdx-links-editor">
            <div className="hdx-links-editor-head">
              <strong>Choose your shortcuts</strong>
              <button
                type="button"
                className="hdx-tool"
                title="Close editor"
                aria-label="Close shortcut editor"
                onClick={() => {
                  setShowQuickLinkEditor(false);
                  setQuickLinkError("");
                }}
              >
                <Icon name="close" size="sm" />
              </button>
            </div>
            <ul className="hdx-links-editor-list">
              {quickLinkDraft.map((link) => (
                <li key={link.id} className="hdx-links-editor-row">
                  <label
                    className="hdx-links-visibility"
                    title={link.visible ? `Hide ${link.name}` : `Show ${link.name}`}
                  >
                    <input
                      type="checkbox"
                      checked={link.visible}
                      onChange={(event) => updateQuickLinkDraft(link.id, "visible", event.target.checked)}
                      aria-label={`Show ${link.name}`}
                    />
                    <span className="hdx-link-logo">
                      <HomeQuickLinkLogo link={link} />
                    </span>
                  </label>
                  <div className="hdx-links-fields">
                    <label>
                      Name
                      <input
                        className="dcx-input"
                        value={link.name}
                        onChange={(event) => updateQuickLinkDraft(link.id, "name", event.target.value)}
                        maxLength={MAX_HOME_QUICK_LINK_NAME_LENGTH}
                      />
                    </label>
                    <label>
                      URL
                      <input
                        className="dcx-input"
                        type="url"
                        value={link.url}
                        onChange={(event) => updateQuickLinkDraft(link.id, "url", event.target.value)}
                        maxLength={MAX_EXTERNAL_HOME_WIDGET_URL_LENGTH}
                        spellCheck={false}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="hdx-tool danger"
                    title={`Remove ${link.name}`}
                    aria-label={`Remove ${link.name}`}
                    onClick={() => removeQuickLinkDraft(link.id)}
                  >
                    <Icon name="close" size="sm" />
                  </button>
                </li>
              ))}
            </ul>
            {!quickLinkDraft.length && (
              <small className="hdx-notice">No shortcuts selected. Restore the defaults to add them back.</small>
            )}
            {quickLinkError && (
              <div className="hdx-error" role="alert">
                {quickLinkError}
              </div>
            )}
            <div className="hdx-form-actions">
              <button type="button" className="dcx-btn" onClick={restoreQuickLinkDefaults}>
                Restore defaults
              </button>
              <button type="button" className="dcx-btn dcx-btn-primary" onClick={saveQuickLinkChanges}>
                Save changes
              </button>
            </div>
          </div>
        ) : visibleQuickLinks.length ? (
          <div className="hdx-links-grid">
            {visibleQuickLinks.map((link) => (
              <a
                key={link.id}
                className="hdx-quick-link"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${link.name}`}
              >
                <span className="hdx-link-logo" aria-hidden="true">
                  <HomeQuickLinkLogo link={link} />
                </span>
                <span className="hdx-row-copy">
                  <strong>{link.name}</strong>
                  <small>{link.domain}</small>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <HomeEmpty
            icon={<Icon name="link" />}
            title="No shortcuts selected"
            hint="Choose the sites you want to keep here."
            action={{ label: "Edit shortcuts", onClick: openQuickLinkEditor }}
          />
        ),
      };
    }

    if (widget.id === "jumpBack") {
      return {
        ...base,
        content: (
          <HomeJumpBackWidget
            lastSession={
              lastHub && lastRoom
                ? {
                    hubName: lastHub.name,
                    roomName:
                      lastRoom.type === "voice" || lastRoom.type === "forum" ? lastRoom.name : `#${lastRoom.name}`,
                    roomIcon:
                      lastRoom.icon || (lastRoom.type === "voice" ? "🔊" : lastRoom.type === "forum" ? "▤" : "#"),
                    onOpen: () => openRoom(lastHub.id, lastRoom.id),
                  }
                : null
            }
            activeVoice={activeVoice}
            onOpenFriends={openFriends}
            onDiscover={openDiscover}
            onCreateHub={openCreateHub}
            onFindSquad={openSquadFinderWorkspace}
            onOpenSettings={openSettings}
          />
        ),
      };
    }

    if (widget.id === "stats") {
      return {
        ...base,
        content: (
          <HomeStatsWidget
            stats={{
              friendsOnline: onlineFriends.length,
              inVoice: voiceParticipants.length,
              hubs: servers.length,
              unreadDms: dmUnreadTotal,
            }}
            onOpenFriends={openFriends}
            onOpenVoice={activeVoice?.onOpen ?? openHubsWorkspace}
            onOpenHubs={openHubsWorkspace}
            onOpenDms={openDirectMessagesWorkspace}
          />
        ),
      };
    }

    if (widget.id === "friendsOnline") {
      return {
        ...base,
        live: onlineFriends.length > 0,
        action: (
          <button type="button" className="hdx-link" onClick={openFriends}>
            All friends
          </button>
        ),
        content: (
          <HomeFriendsWidget
            onOpenFriends={openFriends}
            friends={onlineFriends.map((friend) => ({
              id: friend.id,
              username: friend.username,
              avatar: <UserAvatar username={friend.username} avatarUrl={friend.avatarUrl} />,
              activity: friend.activityText || friend.statusText || undefined,
              onOpen: () => void openDirectMessage(friend),
            }))}
          />
        ),
      };
    }

    if (widget.id === "voiceRooms") {
      const voiceRooms = servers
        .flatMap((hub) =>
          hub.channels.filter((channel) => channel.type === "voice").map((channel) => ({ hub, channel })),
        )
        .sort(
          (a, b) =>
            Number(b.channel.id === voiceChannelId) - Number(a.channel.id === voiceChannelId) ||
            Number(b.hub.id === currentServer.id) - Number(a.hub.id === currentServer.id),
        );
      return {
        ...base,
        action: <span className="hdx-count">{voiceRooms.length}</span>,
        content: (
          <HomeVoiceRoomsWidget
            onDiscover={openDiscover}
            rooms={voiceRooms.map(({ hub, channel }) => ({
              key: `${hub.id}-${channel.id}`,
              hubName: hub.name,
              roomName: channel.name,
              current: channel.id === voiceChannelId,
              onJoin: () =>
                channel.id === voiceChannelId
                  ? openRoom(hub.id, channel.id)
                  : leaveCalendarForRoom(hub.id, channel.id, true),
            }))}
          />
        ),
      };
    }

    if (widget.id === "events") {
      return {
        ...base,
        action: (
          <button
            type="button"
            className="hdx-link"
            onClick={() => void syncHomeCalendar()}
            disabled={homeCalendarBusy}
            aria-label="Sync Hub events"
          >
            {homeCalendarBusy || hubEvents.busy ? "Syncing…" : "↻ Sync"}
          </button>
        ),
        content: (
          <HomeEventsWidget
            busy={homeCalendarBusy || hubEvents.busy}
            notice={homeCalendarNotice || undefined}
            events={allCalendarItems
              .filter((item) => !item.cancelled && itemEnd(item) > homeNow)
              .sort((a, b) => a.start - b.start)
              .map((item) => ({
                key: item.key,
                title: item.title,
                hubName: item.hubName,
                start: item.start,
                live: isLive(item, homeNow),
                when: formatCountdown(item.start, homeNow),
                color: calendarItemColor(item),
                onOpen: () => openCalendarItem(item),
              }))}
          />
        ),
      };
    }

    if (widget.id === "hubs") {
      const recentHubs = lastHub ? [lastHub, ...servers.filter((hub) => hub.id !== lastHub.id)] : servers;
      return {
        ...base,
        action: (
          <button type="button" className="hdx-link" onClick={openDiscover}>
            Discover
          </button>
        ),
        content: (
          <HomeHubsWidget
            onCreateHub={openCreateHub}
            hubs={recentHubs.map((hub) => ({
              id: hub.id,
              name: hub.name,
              icon: hub.iconUrl ? <img src={resolveAvatarUrl(hub.iconUrl)} alt="" /> : hub.icon,
              online: hub.membershipPrivate && hub.myRole !== "owner" ? null : (hub.onlineCount ?? 0),
              unread: hub.channels.reduce((sum, room) => sum + (roomUnread[room.id] ?? 0), 0),
              onOpen: () => {
                setShowHome(false);
                changeServer(hub.id);
              },
            }))}
          />
        ),
      };
    }

    if (widget.id === "messages") {
      return {
        ...base,
        action: (
          <button type="button" className="hdx-link" onClick={openDirectMessagesWorkspace}>
            All messages
          </button>
        ),
        content: (
          <HomeMessagesWidget
            onOpenDms={openDirectMessagesWorkspace}
            messages={dmConversations.map((conversation) => ({
              id: conversation.user.id,
              username: conversation.user.username,
              avatar: <UserAvatar username={conversation.user.username} avatarUrl={conversation.user.avatarUrl} />,
              preview: conversation.latestMessage || "Private conversation",
              unread: dmUnread[conversation.user.id] ?? 0,
              onOpen: () => void openDirectMessage(conversation.user),
            }))}
          />
        ),
      };
    }

    if (widget.id === "profile") {
      return {
        ...base,
        content: (
          <HomeProfileWidget
            avatar={<UserAvatar username={currentUser.username} avatarUrl={currentUser.avatarUrl} />}
            username={currentUser.username}
            status={currentUser.statusText || currentUser.activityText || presenceLabel(currentUser.status, true)}
            color={presenceColor(currentUser.status, true)}
            onEdit={openSettings}
          />
        ),
      };
    }

    if (widget.id === "clock") {
      return {
        ...base,
        content: (
          <HomeClockWidget
            hour12={
              activeTimeFormatPreference === "12h" ? true : activeTimeFormatPreference === "24h" ? false : undefined
            }
          />
        ),
      };
    }

    return { ...base, content: <HomeNotesWidget value={homeNotes} onChange={setHomeNotes} /> };
  };

  return (
    <div className="hdx-root">
      <HomeDashboardHero
        username={currentUser.username}
        avatar={<UserAvatar username={currentUser.username} avatarUrl={currentUser.avatarUrl} />}
        activeVoice={activeVoice}
        friendsOnline={onlineFriends.length}
        controls={
          <button
            type="button"
            className={`dcx-btn${homeEditMode ? " dcx-btn-primary" : ""}`}
            aria-pressed={homeEditMode}
            onClick={() => (homeEditMode ? closeCustomize() : setHomeEditMode(true))}
          >
            {homeEditMode ? "Done" : "✎ Customize"}
          </button>
        }
      />

      {homeEditMode && (
        <HomeWidgetLibrary
          definitions={HOME_WIDGET_DEFINITIONS}
          enabled={enabledHomeWidgets}
          onToggle={toggleHomeWidget}
          onApplyPreset={applyHomePreset}
          onReset={() => applyHomePreset(DEFAULT_HOME_PRESET)}
          onClose={closeCustomize}
          external={
            <div className="hdx-external-library">
              <div className="hdx-external-library-head">
                <span className="hdx-row-copy">
                  <strong>External widgets</strong>
                  <small>Embed a public HTTPS page. It runs in a sandbox and cannot access DeCave.</small>
                </span>
                <span className="hdx-count">
                  {externalCount}/{MAX_EXTERNAL_HOME_WIDGETS}
                </span>
              </div>
              {!showExternalWidgetForm ? (
                <button
                  type="button"
                  className="dcx-btn"
                  disabled={externalCount >= MAX_EXTERNAL_HOME_WIDGETS}
                  onClick={() => {
                    setExternalWidgetError("");
                    setShowExternalWidgetForm(true);
                  }}
                >
                  {externalCount >= MAX_EXTERNAL_HOME_WIDGETS ? "Widget limit reached" : "＋ Add external widget"}
                </button>
              ) : (
                <form
                  className="hdx-external-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addExternalHomeWidget();
                  }}
                >
                  <label>
                    Title
                    <input
                      className="dcx-input"
                      value={externalWidgetTitle}
                      onChange={(event) => setExternalWidgetTitle(event.target.value)}
                      maxLength={MAX_EXTERNAL_HOME_WIDGET_TITLE_LENGTH}
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label>
                    HTTPS URL
                    <input
                      className="dcx-input"
                      type="url"
                      value={externalWidgetUrl}
                      onChange={(event) => setExternalWidgetUrl(event.target.value)}
                      maxLength={MAX_EXTERNAL_HOME_WIDGET_URL_LENGTH}
                      placeholder="https://example.com/widget"
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label>
                    Size
                    <select
                      className="dcx-input"
                      value={externalWidgetSize}
                      onChange={(event) => setExternalWidgetSize(event.target.value as HomeWidgetSize)}
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="wide">Wide</option>
                    </select>
                  </label>
                  <p>
                    Only public HTTPS URLs are accepted. Local addresses, ports, credentials, scripts and HTML are not
                    allowed.
                  </p>
                  {externalWidgetError && (
                    <div className="hdx-error" role="alert">
                      {externalWidgetError}
                    </div>
                  )}
                  <div className="hdx-form-actions">
                    <button
                      type="button"
                      className="dcx-btn"
                      onClick={() => {
                        setShowExternalWidgetForm(false);
                        setExternalWidgetError("");
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="dcx-btn dcx-btn-primary">
                      Add widget
                    </button>
                  </div>
                </form>
              )}
            </div>
          }
        />
      )}

      <HomeWidgetBoard
        items={homeWidgets.map(homeBoardItem)}
        customizing={homeEditMode}
        onMove={moveHomeWidget}
        onResize={resizeHomeWidget}
        onRemove={removeHomeWidget}
        onAddFirst={() => setHomeEditMode(true)}
      />
    </div>
  );
}
