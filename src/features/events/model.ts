// Hub events (2026-10 redesign): client-side model shared by the calendar page,
// event drawer, composer and chat card. API events come from
// GET /api/servers/:hubId/events; legacy `__DECAVE_EVENT__` chat messages are
// still shown (merged + de-duplicated) for backwards compatibility.
import type { HubEvent } from "../../../shared/hub-events";
import { localeForLanguage, preferredTimeOptions } from "../../app/locale";

export type { HubEvent };

export type EventRoom = { id: number; name: string; type: "text" | "voice" | "forum" };

/** Legacy chat-message event (parsed from `__DECAVE_EVENT__`). */
export type LegacyCalendarEvent = {
  id: string;
  hubId: number;
  hubName: string;
  channelId: number;
  channelName: string;
  title: string;
  startAt: string;
  description: string;
  authorName: string;
  /** Set when the message announces an API event (new clients). */
  eventId?: string;
};

export type CalendarItem = {
  /** Unique per occurrence. */
  key: string;
  source: "api" | "legacy";
  id: string;
  hubId: number;
  hubName: string;
  title: string;
  description: string;
  start: number;
  end: number | null;
  channelId: number | null;
  voiceChannelId: number | null;
  coverUrl: string | null;
  timezone: string | null;
  gameTag: string | null;
  cancelled: boolean;
  event: HubEvent | null;
  legacy: LegacyCalendarEvent | null;
};

export const DEFAULT_EVENT_DURATION_MS = 60 * 60_000;

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function apiEventToItem(event: HubEvent, hubName: string): CalendarItem {
  return {
    key: `${event.id}:${event.occurrenceStart}`,
    source: "api",
    id: event.id,
    hubId: event.hubId,
    hubName,
    title: event.title,
    description: event.description,
    start: event.occurrenceStart,
    end: event.occurrenceEnd,
    channelId: event.channelId,
    voiceChannelId: event.voiceChannelId,
    coverUrl: event.coverUrl,
    timezone: event.timezone,
    gameTag: event.gameTag,
    cancelled: event.cancelledAt !== null,
    event,
    legacy: null,
  };
}

export function legacyEventToItem(event: LegacyCalendarEvent): CalendarItem | null {
  const start = Date.parse(event.startAt);
  if (!Number.isFinite(start)) return null;
  return {
    key: `legacy:${event.id}`,
    source: "legacy",
    id: event.id,
    hubId: event.hubId,
    hubName: event.hubName,
    title: event.title,
    description: event.description,
    start,
    end: null,
    channelId: event.channelId,
    voiceChannelId: null,
    coverUrl: null,
    timezone: null,
    gameTag: null,
    cancelled: false,
    event: null,
    legacy: event,
  };
}

/**
 * Merge API occurrences with legacy chat events. A legacy message is dropped
 * when it announces an API event (eventId) or duplicates one (same Hub, title
 * and start minute), so new events posted to chat are not shown twice.
 */
export function mergeCalendarItems(apiItems: CalendarItem[], legacy: LegacyCalendarEvent[]): CalendarItem[] {
  const apiIds = new Set(apiItems.map((item) => item.id));
  const signatures = new Set(
    apiItems.map((item) => `${item.hubId}|${item.title.toLowerCase()}|${Math.floor(item.start / 60_000)}`),
  );
  const out = [...apiItems];
  const seen = new Set<string>();
  for (const entry of legacy) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (entry.eventId && apiIds.has(entry.eventId)) continue;
    const item = legacyEventToItem(entry);
    if (!item) continue;
    if (signatures.has(`${item.hubId}|${item.title.toLowerCase()}|${Math.floor(item.start / 60_000)}`)) continue;
    out.push(item);
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

export function itemEnd(item: CalendarItem): number {
  return item.end ?? item.start + DEFAULT_EVENT_DURATION_MS;
}

export function isLive(item: CalendarItem, now: number): boolean {
  return !item.cancelled && item.start <= now && itemEnd(item) > now;
}

export function formatCountdown(target: number, now: number): string {
  const diff = target - now;
  if (diff <= 0) return "now";
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}${hours % 24 ? ` ${hours % 24} h` : ""}`;
}

export function formatTimeRange(start: number, end: number | null, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    ...preferredTimeOptions(),
  };
  const startLabel = new Date(start).toLocaleString(localeForLanguage(), options);
  if (end === null) return startLabel;
  const sameDay =
    new Date(start).toLocaleDateString(undefined, { timeZone }) ===
    new Date(end).toLocaleDateString(undefined, { timeZone });
  const endLabel = sameDay
    ? new Date(end).toLocaleTimeString(localeForLanguage(), {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
        ...preferredTimeOptions(),
      })
    : new Date(end).toLocaleString(localeForLanguage(), options);
  return `${startLabel} – ${endLabel}`;
}

export function timeZoneLabel(timeZone: string, at: number): string {
  try {
    const part = new Intl.DateTimeFormat(localeForLanguage(), { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(at))
      .find((p) => p.type === "timeZoneName");
    return part ? `${timeZone.replace(/_/g, " ")} (${part.value})` : timeZone;
  } catch {
    return timeZone;
  }
}

/** Stable accent per room/type so event blocks are color-coded. */
const PALETTE = ["#7c6cff", "#55d9ff", "#ff6bb5", "#64e6a6", "#f1bc65", "#ff8a5c", "#9b8cff", "#4fc3f7"];
export function itemColor(item: CalendarItem): string {
  if (item.cancelled) return "#6b7280";
  if (item.source === "legacy") return "#8a94a8";
  const seed = item.voiceChannelId ?? item.channelId ?? 0;
  if (!seed) return PALETTE[0];
  return PALETTE[Math.abs(seed) % PALETTE.length];
}

export function itemKindLabel(item: CalendarItem): string {
  if (item.cancelled) return "Cancelled";
  if (item.source === "legacy") return "Chat event";
  if (item.voiceChannelId) return "Voice";
  if (item.gameTag) return item.gameTag;
  return "Event";
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/** Monday-based week start. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Value for <input type="datetime-local"> in the viewer's local zone. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
