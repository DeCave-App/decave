// Keeps the Home calendar in step with every Hub's events: a full sync, plus adding
// events seen in the open room and dropping ones whose message was deleted.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { Channel, Server, ChatMessage, HubCalendarEvent } from "../types";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";
import { trimLegacyCalendarEvents, homeCalendarEventForMessage } from "../calendar";
import type { HubEventsStore } from "../../features/events";

export type HomeCalendarActionsDeps = {
  authToken: string;
  setHomeCalendarEvents: Dispatch<SetStateAction<HubCalendarEvent[]>>;
  setHomeCalendarBusy: Dispatch<SetStateAction<boolean>>;
  setHomeCalendarNotice: Dispatch<SetStateAction<string>>;
  homeCalendarSyncRef: MutableRefObject<number>;
  servers: Server[];
  hubEvents: HubEventsStore;
};

/** Called once per render with that render's values. */
export function createHomeCalendarActions(deps: HomeCalendarActionsDeps) {
  const {
    authToken,
    setHomeCalendarEvents,
    setHomeCalendarBusy,
    setHomeCalendarNotice,
    homeCalendarSyncRef,
    servers,
    hubEvents,
  } = deps;

  // F2: drop past legacy events before capping, so the cap keeps the soonest upcoming ones.
  const upsertHomeCalendarEvent = (event: HubCalendarEvent) => {
    setHomeCalendarEvents((current) =>
      trimLegacyCalendarEvents([...current.filter((item) => item.id !== event.id), event]),
    );
  };

  // F3: deleted event messages leave the calendar.
  const removeHomeCalendarMessage = (messageId: string) => {
    setHomeCalendarEvents((current) =>
      current.some((item) => item.id === messageId) ? current.filter((item) => item.id !== messageId) : current,
    );
  };

  const syncHomeCalendar = async () => {
    if (!authToken || !servers.length) return;
    const syncId = homeCalendarSyncRef.current + 1;
    homeCalendarSyncRef.current = syncId;
    setHomeCalendarBusy(true);
    setHomeCalendarNotice("");
    hubEvents.pruneHubs(servers.map((hub) => hub.id));
    void hubEvents.loadUpcoming(servers.map((hub) => hub.id));

    const found = new Map<string, HubCalendarEvent>();
    const targets = servers.flatMap((hub) =>
      hub.channels.filter((channel) => channel.type !== "voice").map((channel) => ({ hub, channel })),
    );

    const addPlainMessages = (hub: Server, channel: Channel, values: unknown[]) => {
      for (const value of values) {
        if (!value || typeof value !== "object") continue;
        const item = value as Partial<ChatMessage>;
        if (typeof item.id !== "string" || typeof item.text !== "string") continue;
        const event = homeCalendarEventForMessage(
          item.id,
          item.text,
          hub,
          channel,
          typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
          typeof item.username === "string" ? item.username : "Hub member",
        );
        if (event) found.set(event.id, event);
      }
    };

    try {
      // Keep legacy plaintext reads bounded so opening Home cannot flood the API.
      for (let offset = 0; offset < targets.length; offset += 4) {
        await Promise.all(
          targets.slice(offset, offset + 4).map(async ({ hub, channel }) => {
            try {
              const response = await authorizedFetch(`${HTTP_URL}/api/channels/${channel.id}/messages`);
              if (!response.ok) return;
              const data: unknown = await response.json();
              if (Array.isArray(data)) addPlainMessages(hub, channel, data);
            } catch {
              // A private or unavailable room should not prevent other Hub events
              // from appearing on the calendar.
            }
          }),
        );
      }

      if (homeCalendarSyncRef.current === syncId) {
        setHomeCalendarEvents(trimLegacyCalendarEvents([...found.values()]));
      }
    } catch {
      if (homeCalendarSyncRef.current === syncId)
        setHomeCalendarNotice("Calendar events could not be synced right now.");
    } finally {
      if (homeCalendarSyncRef.current === syncId) setHomeCalendarBusy(false);
    }
  };

  return {
    upsertHomeCalendarEvent,
    removeHomeCalendarMessage,
    syncHomeCalendar,
  };
}
