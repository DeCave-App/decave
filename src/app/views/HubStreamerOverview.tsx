// The streamer Hub overview, wired to rooms, events, announcements and the Squad Finder.

import type { StreamerEvent } from "../../../shared/streamer-mode";
import { StreamerOverview } from "../../streamer/StreamerOverview";
import type { StreamerTransport } from "../../streamer/api";
import type { Server, AccountUser } from "../types";
import { openDesktopExternalUrl } from "../desktop";
import { streamerMediaUrl } from "../streamer";
import type { HubPanelsState } from "../state/hub-panels";
import type { PageNavigation } from "../actions/page-navigation";
import type { HubChatActions } from "../actions/hub-chat";

type Props = {
  currentUser: AccountUser;
  hubPanels: HubPanelsState;
  currentServer: Server;
  announcementAvailable: boolean;
  streamerBannerPath: string;
  streamerTransport: StreamerTransport;
  pageNavigation: PageNavigation;
  changeChannel: (channelId: number) => void;
  openManageServer: () => void;
  hubChat: HubChatActions;
  streamerEvents: StreamerEvent[];
  openStreamerEvent: (event: StreamerEvent, mode: "view" | "manage") => void;
  openHubCalendar: (forceOpen?: boolean) => void;
};

export function HubStreamerOverview({
  currentUser,
  hubPanels,
  currentServer,
  announcementAvailable,
  streamerBannerPath,
  streamerTransport,
  pageNavigation,
  changeChannel,
  openManageServer,
  hubChat,
  streamerEvents,
  openStreamerEvent,
  openHubCalendar,
}: Props) {
  return (
    <StreamerOverview
      accountId={currentUser.id}
      hubId={currentServer.id}
      hubName={currentServer.name}
      bannerPath={streamerBannerPath || undefined}
      events={streamerEvents}
      announcementAvailable={announcementAvailable}
      official={Boolean(currentServer.membershipPrivate)}
      isDesktop={Boolean(window.decaveDesktop?.isDesktop)}
      actions={{
        openRoom: (name) => {
          const room = currentServer.channels.find(
            (channel) => channel.type !== "voice" && channel.name.trim().toLowerCase() === name,
          );
          if (!room) return false;
          hubPanels.setShowHubHome(false);
          hubPanels.setShowStreamerOverview(false);
          hubPanels.setShowHubCalendarPanel(false);
          changeChannel(room.id);
          return true;
        },
        createEvent: hubChat.openEventComposer,
        openCalendar: () => openHubCalendar(true),
        openEvent: (event, mode) => openStreamerEvent(event, mode),
        composeAnnouncement: hubChat.composeAnnouncement,
        findSquad: pageNavigation.openSquadFinderWorkspace,
        manageHub: openManageServer,
        openExternal: (url) => {
          void openDesktopExternalUrl(url);
        },
        mediaUrl: streamerMediaUrl,
      }}
      transport={streamerTransport}
    />
  );
}
