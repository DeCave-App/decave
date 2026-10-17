// Hub events on mobile: pure helpers shared by the calendar screen, the event
// sheet, the composer and the chat card. Mirrors web's
// src/features/events/model.ts; the API contract is shared/hub-events.ts.

import { t } from "i18next";
import type { HubEvent } from "../../../shared/hub-events";

export type { HubEvent };

export const DEFAULT_EVENT_DURATION_MS = 60 * 60_000;
export const EVENT_DURATIONS = [
  { id: "m30", ms: 30 * 60_000 },
  { id: "h1", ms: 60 * 60_000 },
  { id: "h1_5", ms: 90 * 60_000 },
  { id: "h2", ms: 2 * 60 * 60_000 },
  { id: "h3", ms: 3 * 60 * 60_000 },
  { id: "h4", ms: 4 * 60 * 60_000 },
  { id: "evening", ms: 6 * 60 * 60_000 },
] as const;
export const EVENT_REMINDERS = [
  { id: "none", minutes: null },
  { id: "atStart", minutes: 0 },
  { id: "m10", minutes: 10 },
  { id: "m30", minutes: 30 },
  { id: "h1", minutes: 60 },
  { id: "d1", minutes: 1440 },
] as const;

/** Legacy `__DECAVE_EVENT__` chat messages (and new ones announcing an API event). */
export const EVENT_PREFIX = "__DECAVE_EVENT__";
export type ChatEventPayload = { title: string; startAt: string; description: string; eventId: string | null };

export function parseChatEvent(text: string | null | undefined): ChatEventPayload | null {
  if (!text || !text.startsWith(EVENT_PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(EVENT_PREFIX.length)) as Record<string, unknown>;
    if (typeof raw.title !== "string" || typeof raw.startAt !== "string") return null;
    const title = raw.title.trim().slice(0, 100);
    if (!title || Number.isNaN(Date.parse(raw.startAt))) return null;
    return {
      title,
      startAt: raw.startAt,
      description: typeof raw.description === "string" ? raw.description.slice(0, 600) : "",
      eventId: typeof raw.eventId === "string" ? raw.eventId : null,
    };
  } catch {
    return null;
  }
}

/** The chat card web posts in the announcement room when an "everyone" event is created. */
export function chatEventAnnouncement(event: HubEvent): string {
  return `${EVENT_PREFIX}${JSON.stringify({
    title: event.title,
    startAt: new Date(event.startsAt).toISOString(),
    description: event.description.slice(0, 600),
    inviteMode: "all",
    invitedUserIds: [],
    invitedUsernames: [],
    eventId: event.id,
  })}`;
}

export const occurrenceKey = (event: HubEvent) => `${event.id}:${event.occurrenceStart}`;
export const eventEnd = (event: HubEvent) => event.occurrenceEnd ?? event.occurrenceStart + DEFAULT_EVENT_DURATION_MS;
export const isEventLive = (event: HubEvent, now: number) =>
  event.cancelledAt === null && event.occurrenceStart <= now && eventEnd(event) > now;
export const isEventOver = (event: HubEvent, now: number) => eventEnd(event) <= now;
export const isEventFull = (event: HubEvent) =>
  event.capacity !== null && event.rsvpCounts.going >= event.capacity && event.myRsvp !== "going";

export function formatCountdown(target: number, now: number): string {
  const diff = target - now;
  if (diff <= 0) return t("events.countdown.now");
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return t("events.countdown.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return minutes % 60 ? t("events.countdown.hoursMinutes", { hours, minutes: minutes % 60 }) : t("events.countdown.hours", { hours });
  const days = Math.floor(hours / 24);
  return hours % 24 ? t("events.countdown.daysHours", { count: days, hours: hours % 24 }) : t("events.countdown.days", { count: days });
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/** Monday-based week start, like web. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The 6×7 Monday-first grid of days shown for a month. */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** Occurrences grouped by local day (key: start-of-day ms), each day sorted by start. */
export function groupByDay(events: readonly HubEvent[]): Map<number, HubEvent[]> {
  const days = new Map<number, HubEvent[]>();
  for (const event of [...events].sort((a, b) => a.occurrenceStart - b.occurrenceStart || a.title.localeCompare(b.title))) {
    const key = startOfDay(new Date(event.occurrenceStart)).getTime();
    days.set(key, [...(days.get(key) ?? []), event]);
  }
  return days;
}

/** Replace an occurrence after a save/RSVP; RSVP and edits apply to every occurrence of the series. */
export function applyEventUpdate(events: readonly HubEvent[], updated: HubEvent): HubEvent[] {
  return events.map((event) =>
    event.id !== updated.id
      ? event
      : event.occurrenceStart === updated.occurrenceStart
        ? updated
        : {
            ...updated,
            occurrenceStart: event.occurrenceStart,
            occurrenceEnd:
              updated.occurrenceEnd === null ? null : event.occurrenceStart + (updated.occurrenceEnd - updated.occurrenceStart),
          },
  );
}

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const EVENT_LIMITS = {
  titleMax: 100,
  descriptionMax: 2000,
  capacityMax: 10_000,
  gameTagMax: 40,
  audienceIdsMax: 100,
  pastToleranceMs: 5 * 60_000,
  maxDurationMs: 14 * 24 * 60 * 60_000,
} as const;

export type EventDraft = {
  title: string;
  description: string;
  coverUrl: string;
  startsAt: number;
  endMode: "duration" | "end" | "none";
  durationMs: number;
  endsAtInput: number;
  recurrence: HubEvent["recurrence"];
  voiceChannelId: number | null;
  channelId: number | null;
  audience: HubEvent["audience"];
  roleIds: string[];
  memberIds: string[];
  reminderMinutes: number | null;
  capacity: string;
  gameTag: string;
};

export function draftEndsAt(draft: EventDraft): number | null {
  return draft.endMode === "none" ? null : draft.endMode === "duration" ? draft.startsAt + draft.durationMs : draft.endsAtInput;
}

export type EventDraftError = {
  key:
    | "titleMissing"
    | "titleLong"
    | "descriptionLong"
    | "cover"
    | "startMissing"
    | "startPast"
    | "endMissing"
    | "endBeforeStart"
    | "tooLong"
    | "noRoles"
    | "noMembers"
    | "tooManyEntries"
    | "capacity"
    | "gameTagLong";
  params?: { max: number };
};

/** Field → events.composer.errors.* key (with params), the same checks web runs before saving. */
export function validateEventDraft(
  draft: EventDraft,
  now: number,
  editing: { startsAt: number } | null,
): Record<string, EventDraftError> {
  const errors: Record<string, EventDraftError> = {};
  const title = draft.title.trim();
  if (!title) errors.title = { key: "titleMissing" };
  else if (title.length > EVENT_LIMITS.titleMax) errors.title = { key: "titleLong", params: { max: EVENT_LIMITS.titleMax } };
  if (draft.description.length > EVENT_LIMITS.descriptionMax)
    errors.description = { key: "descriptionLong", params: { max: EVENT_LIMITS.descriptionMax } };
  if (draft.coverUrl.trim() && !/^https:\/\/\S+$/.test(draft.coverUrl.trim())) errors.coverUrl = { key: "cover" };
  const startChanged = !editing || draft.startsAt !== editing.startsAt;
  if (!Number.isFinite(draft.startsAt)) errors.startsAt = { key: "startMissing" };
  else if (startChanged && draft.startsAt < now - EVENT_LIMITS.pastToleranceMs) errors.startsAt = { key: "startPast" };
  const endsAt = draftEndsAt(draft);
  if (endsAt !== null) {
    if (!Number.isFinite(endsAt)) errors.endsAt = { key: "endMissing" };
    else if (endsAt <= draft.startsAt) errors.endsAt = { key: "endBeforeStart" };
    else if (endsAt - draft.startsAt > EVENT_LIMITS.maxDurationMs) errors.endsAt = { key: "tooLong" };
  }
  if (draft.audience === "roles" && draft.roleIds.length === 0) errors.audienceIds = { key: "noRoles" };
  if (draft.audience === "members" && draft.memberIds.length === 0) errors.audienceIds = { key: "noMembers" };
  if ((draft.audience === "roles" ? draft.roleIds : draft.memberIds).length > EVENT_LIMITS.audienceIdsMax)
    errors.audienceIds = { key: "tooManyEntries", params: { max: EVENT_LIMITS.audienceIdsMax } };
  if (draft.capacity.trim()) {
    const n = Number(draft.capacity);
    if (!Number.isInteger(n) || n < 1 || n > EVENT_LIMITS.capacityMax)
      errors.capacity = { key: "capacity", params: { max: EVENT_LIMITS.capacityMax } };
  }
  if (draft.gameTag.trim().length > EVENT_LIMITS.gameTagMax) errors.gameTag = { key: "gameTagLong", params: { max: EVENT_LIMITS.gameTagMax } };
  return errors;
}

/** A sensible default start: the next half hour at least 30 minutes from now. */
export function defaultEventStart(now: number): number {
  const step = 30 * 60_000;
  return Math.ceil((now + step) / step) * step;
}
