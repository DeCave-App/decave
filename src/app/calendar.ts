// Home calendar helpers: legacy event messages as calendar events, trimming,
// and de-duplicating repeated occurrences.

import type { HubCalendarEvent, Server, Channel } from "./types";
import { parseHubCalendarEvent, parsePrefixedJson, EVENT_PREFIX } from "./message-payloads";
import type { CalendarItem } from "../features/events";

export const trimLegacyCalendarEvents = (list: HubCalendarEvent[]) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return list
    .filter((item) => Date.parse(item.startAt) >= cutoff)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 300);
};

export const homeCalendarEventForMessage = (
  messageId: string,
  text: string,
  hub: Server,
  channel: Channel,
  createdAt: string,
  authorName: string,
): HubCalendarEvent | null => {
  const payload = parseHubCalendarEvent(text);
  if (!payload) return null;
  const announced = parsePrefixedJson<{ eventId?: unknown }>(text, EVENT_PREFIX)?.eventId;
  return {
    ...payload,
    ...(typeof announced === "string" && announced ? { eventId: announced.slice(0, 80) } : {}),
    id: messageId,
    hubId: hub.id,
    hubName: hub.name,
    channelId: channel.id,
    channelName: channel.name,
    createdAt,
    authorName: authorName || "Hub member",
  };
};

export const firstOccurrencePerEvent = (list: CalendarItem[]) => {
  const seen = new Set<string>();
  return list.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
};
