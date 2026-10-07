// Hub calendar: event lookups and permissions, member names and avatars on events, and opening events or their rooms.

import type { Dispatch, SetStateAction } from "react";
import type { StreamerEvent } from "../../../shared/streamer-mode";
import {
  itemEnd,
  type CalendarItem,
  type EventComposerSeed,
  type HubEvent as ApiHubEvent,
  type HubEventsStore,
} from "../../features/events";
import type { Server, ServerMemberView, HubCalendarEvent } from "../types";
import { UserAvatar } from "../components/UserAvatar";
import type { HubPanelsState } from "../state/hub-panels";

export type CalendarActionsDeps = {
  setShowHome: Dispatch<SetStateAction<boolean>>;
  servers: Server[];
  hubMembers: ServerMemberView[];
  currentServer: Server;
  hubEvents: HubEventsStore;
  setEventDrawerItem: Dispatch<SetStateAction<CalendarItem | null>>;
  syncHomeCalendar: () => Promise<void>;
  joinVoiceChannel: (channelId: number, recoveryRetry?: boolean) => Promise<void>;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  loadHubMembers: (serverId: number) => Promise<void>;
  openEventComposerWith: (seed: EventComposerSeed, hubId?: number) => void;
  allCalendarItems: CalendarItem[];
  calendarNowMs: number;
  currentHubCalendarEvents: HubCalendarEvent[];
  canCreateCurrentHubEventsFallback: boolean;
  hubPanels: HubPanelsState;
};

/** Called once per render with that render's values. */
export function createCalendarActions(deps: CalendarActionsDeps) {
  const {
    setShowHome,
    servers,
    hubMembers,
    currentServer,
    hubEvents,
    setEventDrawerItem,
    syncHomeCalendar,
    joinVoiceChannel,
    changeServer,
    changeChannel,
    loadHubMembers,
    openEventComposerWith,
    allCalendarItems,
    calendarNowMs,
    currentHubCalendarEvents,
    canCreateCurrentHubEventsFallback,
    hubPanels,
  } = deps;
  const { setShowHubMembersPanel, setShowHubCalendarPanel, showHubCalendarPanel } = hubPanels;

  const findApiHubEvent = (eventId: string): ApiHubEvent | null => {
    const matches = hubEvents.allEvents.filter((event) => event.id === eventId);
    return (
      matches.find((event) => (event.occurrenceEnd ?? event.occurrenceStart + 3_600_000) > calendarNowMs) ??
      matches[0] ??
      null
    );
  };

  const canCreateEventsIn = (hubId: number) =>
    hubEvents.byHub[hubId]?.canCreate ?? (hubId === currentServer.id ? canCreateCurrentHubEventsFallback : false);

  const eventRoomsFor = (hubId: number) =>
    (servers.find((hub) => hub.id === hubId)?.channels ?? []).map((room) => ({
      id: room.id,
      name: room.name,
      type: room.type,
    }));

  const renderEventMemberAvatar = (userId: string) => {
    const member = hubMembers.find((candidate) => candidate.userId === userId);
    return <UserAvatar username={member?.username ?? "?"} avatarUrl={member?.avatarUrl} />;
  };

  const eventMemberName = (userId: string) =>
    hubMembers.find((candidate) => candidate.userId === userId)?.username ?? "Hub member";

  const openCalendarItem = (item: CalendarItem) => {
    setEventDrawerItem(item);
    if (item.hubId === currentServer.id && hubMembers.length === 0) void loadHubMembers(item.hubId);
  };

  const leaveCalendarForRoom = (hubId: number, roomId: number, joinVoiceRoom: boolean) => {
    setEventDrawerItem(null);
    setShowHubCalendarPanel(false);
    setShowHome(false);
    if (hubId !== currentServer.id) changeServer(hubId);
    window.setTimeout(() => {
      changeChannel(roomId);
      if (joinVoiceRoom) void joinVoiceChannel(roomId);
    }, 0);
  };

  const navigateToHubCalendarEvent = (event: HubCalendarEvent) => {
    const item =
      allCalendarItems.find((candidate) => candidate.id === event.id && itemEnd(candidate) > calendarNowMs) ??
      allCalendarItems.find((candidate) => candidate.id === event.id);
    if (item) {
      openCalendarItem(item);
      return;
    }
    if (event.channelId) leaveCalendarForRoom(event.hubId, event.channelId, false);
  };

  const openStreamerEvent = (event: StreamerEvent, mode: "view" | "manage") => {
    const calendarEvent = currentHubCalendarEvents.find((candidate) => candidate.id === event.id);
    if (!calendarEvent) return;
    const api = mode === "manage" ? findApiHubEvent(event.id) : null;
    if (api?.canManage) {
      openEventComposerWith({ editing: api }, api.hubId);
      return;
    }
    navigateToHubCalendarEvent(calendarEvent);
  };

  const openHubCalendar = (forceOpen = false) => {
    const nextOpen = forceOpen || !showHubCalendarPanel;
    setShowHubMembersPanel(false);
    setShowHubCalendarPanel(nextOpen);
    if (nextOpen) {
      if (hubMembers.length === 0) void loadHubMembers(currentServer.id);
      void syncHomeCalendar();
    }
  };

  return {
    findApiHubEvent,
    canCreateEventsIn,
    eventRoomsFor,
    renderEventMemberAvatar,
    eventMemberName,
    openCalendarItem,
    leaveCalendarForRoom,
    navigateToHubCalendarEvent,
    openStreamerEvent,
    openHubCalendar,
  };
}
