// Shared Hub calendar event contract + pure helpers used by the Worker (and
// available to the client). Keep this file free of Worker/DOM-only APIs.

export type HubEventRecurrence = "none" | "daily" | "weekly" | "monthly";
export type HubEventAudience = "all" | "roles" | "members";
export type HubEventRsvpStatus = "going" | "maybe" | "declined";

export const HUB_EVENT_RECURRENCES: readonly HubEventRecurrence[] = ["none", "daily", "weekly", "monthly"];
export const HUB_EVENT_AUDIENCES: readonly HubEventAudience[] = ["all", "roles", "members"];
export const HUB_EVENT_RSVP_STATUSES: readonly HubEventRsvpStatus[] = ["going", "maybe", "declined"];

export const HUB_EVENT_LIMITS = {
  titleMax: 100,
  descriptionMax: 2000,
  coverUrlMax: 500,
  gameTagMax: 40,
  timezoneMax: 64,
  capacityMax: 10_000,
  reminderMinutesMax: 40_320, // 28 days
  audienceIdsMax: 100,
  pastToleranceMs: 5 * 60_000,
  maxDurationMs: 14 * 24 * 60 * 60_000,
  maxOccurrences: 200,
  maxRangeMs: 400 * 24 * 60 * 60_000,
  goingPreviewMax: 12,
} as const;

export type HubEvent = {
  id: string;
  hubId: number;
  channelId: number | null;
  voiceChannelId: number | null;
  title: string;
  description: string;
  coverUrl: string | null;
  /** Series start (ms since epoch, UTC). */
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  recurrence: HubEventRecurrence;
  audience: HubEventAudience;
  /** Custom role ids (audience "roles") or public user ids (audience "members"). */
  audienceIds: string[];
  reminderMinutes: number | null;
  capacity: number | null;
  gameTag: string | null;
  /** Public user id of the creator. */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  cancelledAt: number | null;
  /** Start of this occurrence (== startsAt for non-recurring events). */
  occurrenceStart: number;
  /** End of this occurrence, or null when the event has no end. */
  occurrenceEnd: number | null;
  rsvpCounts: { going: number; maybe: number; declined: number };
  myRsvp: HubEventRsvpStatus | null;
  /** Up to 12 public user ids with status "going" (most recent first). */
  goingUserIds: string[];
  /** Whether the viewer may PATCH / DELETE this event. */
  canManage: boolean;
};

export type HubEventInput = {
  title: string;
  description: string;
  coverUrl: string | null;
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  recurrence: HubEventRecurrence;
  audience: HubEventAudience;
  audienceIds: string[];
  reminderMinutes: number | null;
  capacity: number | null;
  gameTag: string | null;
  channelId: number | null;
  voiceChannelId: number | null;
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string; field: string };

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max + 1);
}

export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > HUB_EVENT_LIMITS.timezoneMax) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function optionalInt(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

function isAllowedCoverUrl(value: string): boolean {
  if (value.startsWith("/uploads/") || value.startsWith("/api/media/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate a create (partial=false) or PATCH (partial=true, merged onto
 * `existing`) payload. Room ownership and audience-id membership are checked by
 * the Worker because they need the database.
 */
export function validateHubEventInput(
  body: Record<string, unknown>,
  options: { now: number; existing?: HubEventInput; partial?: boolean },
): ValidationResult<HubEventInput> {
  const partial = options.partial === true && options.existing !== undefined;
  const base = options.existing;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
  const fail = (field: string, error: string): ValidationResult<HubEventInput> => ({ ok: false, field, error });

  let title = base?.title ?? "";
  if (!partial || has("title")) {
    title = cleanText(body.title, HUB_EVENT_LIMITS.titleMax);
    if (!title) return fail("title", "Title is required.");
    if (Array.from(title).length > HUB_EVENT_LIMITS.titleMax)
      return fail("title", "Title must be 100 characters or fewer.");
  }

  let description = base?.description ?? "";
  if (!partial || has("description")) {
    if (body.description !== undefined && body.description !== null && typeof body.description !== "string")
      return fail("description", "Description must be text.");
    description = typeof body.description === "string" ? body.description.normalize("NFC").trim() : "";
    if (description.length > HUB_EVENT_LIMITS.descriptionMax)
      return fail("description", "Description must be 2000 characters or fewer.");
  }

  let coverUrl = base?.coverUrl ?? null;
  if (!partial || has("coverUrl")) {
    if (body.coverUrl === null || body.coverUrl === undefined || body.coverUrl === "") coverUrl = null;
    else if (
      typeof body.coverUrl !== "string" ||
      body.coverUrl.length > HUB_EVENT_LIMITS.coverUrlMax ||
      !isAllowedCoverUrl(body.coverUrl.trim())
    )
      return fail("coverUrl", "Cover must be an uploaded image or an https URL.");
    else coverUrl = body.coverUrl.trim();
  }

  let startsAt = base?.startsAt ?? Number.NaN;
  const startsChanged = !partial || has("startsAt");
  if (startsChanged) {
    const n = optionalInt(body.startsAt);
    if (n === undefined || n === null || Number.isNaN(n) || n <= 0)
      return fail("startsAt", "A valid start time (ms) is required.");
    startsAt = n;
    if (startsAt < options.now - HUB_EVENT_LIMITS.pastToleranceMs)
      return fail("startsAt", "Events cannot start in the past.");
  }

  let endsAt = base?.endsAt ?? null;
  if (!partial || has("endsAt")) {
    const n = optionalInt(body.endsAt);
    if (n === undefined || n === null) endsAt = null;
    else if (Number.isNaN(n)) return fail("endsAt", "End time must be a timestamp in ms.");
    else endsAt = n;
  }
  if (endsAt !== null) {
    if (endsAt <= startsAt) return fail("endsAt", "End time must be after the start time.");
    if (endsAt - startsAt > HUB_EVENT_LIMITS.maxDurationMs) return fail("endsAt", "Events can last at most 14 days.");
  }

  let timezone = base?.timezone ?? "UTC";
  if (!partial || has("timezone")) {
    timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "UTC";
    if (!isValidTimeZone(timezone)) return fail("timezone", "Unknown time zone.");
  }

  let recurrence = base?.recurrence ?? "none";
  if (!partial || has("recurrence")) {
    const value = body.recurrence ?? "none";
    if (!HUB_EVENT_RECURRENCES.includes(value as HubEventRecurrence))
      return fail("recurrence", "Recurrence must be none, daily, weekly or monthly.");
    recurrence = value as HubEventRecurrence;
  }

  let audience = base?.audience ?? "all";
  let audienceIds = base?.audienceIds ?? [];
  if (!partial || has("audience") || has("audienceIds")) {
    const value = has("audience") ? body.audience : (base?.audience ?? "all");
    if (!HUB_EVENT_AUDIENCES.includes(value as HubEventAudience))
      return fail("audience", "Audience must be all, roles or members.");
    audience = value as HubEventAudience;
    const rawIds = has("audienceIds") ? body.audienceIds : audience === base?.audience ? base?.audienceIds : [];
    if (rawIds !== undefined && rawIds !== null && !Array.isArray(rawIds))
      return fail("audienceIds", "audienceIds must be an array.");
    const ids = Array.from(
      new Set(
        (Array.isArray(rawIds) ? rawIds : []).filter(
          (x): x is string => typeof x === "string" && x.length > 0 && x.length <= 128,
        ),
      ),
    );
    if (ids.length > HUB_EVENT_LIMITS.audienceIdsMax)
      return fail("audienceIds", "Too many audience entries (max 100).");
    audienceIds = audience === "all" ? [] : ids;
    if (audience !== "all" && audienceIds.length === 0)
      return fail("audienceIds", "Choose at least one role or member for this audience.");
  }

  let reminderMinutes = base?.reminderMinutes ?? null;
  if (!partial || has("reminderMinutes")) {
    const n = optionalInt(body.reminderMinutes);
    if (n === undefined || n === null) reminderMinutes = null;
    else if (Number.isNaN(n) || n < 0 || n > HUB_EVENT_LIMITS.reminderMinutesMax)
      return fail("reminderMinutes", "Reminder must be between 0 and 40320 minutes.");
    else reminderMinutes = n;
  }

  let capacity = base?.capacity ?? null;
  if (!partial || has("capacity")) {
    const n = optionalInt(body.capacity);
    if (n === undefined || n === null) capacity = null;
    else if (Number.isNaN(n) || n < 1 || n > HUB_EVENT_LIMITS.capacityMax)
      return fail("capacity", "Capacity must be between 1 and 10000.");
    else capacity = n;
  }

  let gameTag = base?.gameTag ?? null;
  if (!partial || has("gameTag")) {
    const value = cleanText(body.gameTag, HUB_EVENT_LIMITS.gameTagMax);
    if (value.length > HUB_EVENT_LIMITS.gameTagMax) return fail("gameTag", "Game tag must be 40 characters or fewer.");
    gameTag = value || null;
  }

  let channelId = base?.channelId ?? null;
  if (!partial || has("channelId")) {
    const n = optionalInt(body.channelId);
    if (n === undefined || n === null) channelId = null;
    else if (Number.isNaN(n) || n <= 0) return fail("channelId", "Invalid room.");
    else channelId = n;
  }
  let voiceChannelId = base?.voiceChannelId ?? null;
  if (!partial || has("voiceChannelId")) {
    const n = optionalInt(body.voiceChannelId);
    if (n === undefined || n === null) voiceChannelId = null;
    else if (Number.isNaN(n) || n <= 0) return fail("voiceChannelId", "Invalid voice room.");
    else voiceChannelId = n;
  }

  return {
    ok: true,
    value: {
      title,
      description,
      coverUrl,
      startsAt,
      endsAt,
      timezone,
      recurrence,
      audience,
      audienceIds,
      reminderMinutes,
      capacity,
      gameTag,
      channelId,
      voiceChannelId,
    },
  };
}

// ---------------------------------------------------------------------------
// Time-zone aware recurrence expansion

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function wallClockInZone(epochMs: number, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
    ms: ((epochMs % 1000) + 1000) % 1000,
  };
}

function wallAsUtc(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.ms);
}

/** Convert a wall-clock time in `timeZone` to epoch ms (DST gaps resolve forward). */
export function zonedWallToEpoch(w: WallClock, timeZone: string): number {
  const target = wallAsUtc(w);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const offset = wallAsUtc(wallClockInZone(guess, timeZone)) - guess;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Occurrence start times of an event that overlap [from, to). Recurring events
 * keep their wall-clock time in the event time zone across DST changes; monthly
 * events skip months without that day (e.g. the 31st).
 */
export function expandOccurrences(
  event: { startsAt: number; endsAt: number | null; recurrence: HubEventRecurrence; timezone: string },
  from: number,
  to: number,
  cap: number = HUB_EVENT_LIMITS.maxOccurrences,
): number[] {
  const duration = event.endsAt === null ? 0 : event.endsAt - event.startsAt;
  const overlaps = (start: number) => start < to && (duration > 0 ? start + duration > from : start >= from);
  if (event.recurrence === "none") return overlaps(event.startsAt) ? [event.startsAt] : [];
  const tz = isValidTimeZone(event.timezone) ? event.timezone : "UTC";
  const origin = wallClockInZone(event.startsAt, tz);
  const out: number[] = [];

  // Jump close to the range start instead of iterating from the series origin.
  let index = 0;
  const dayMs = 86_400_000;
  const earliest = from - duration;
  if (earliest > event.startsAt) {
    const approx =
      event.recurrence === "daily"
        ? (earliest - event.startsAt) / dayMs
        : event.recurrence === "weekly"
          ? (earliest - event.startsAt) / (7 * dayMs)
          : ((earliest - event.startsAt) / (28 * dayMs)) * (28 / 31);
    index = Math.max(0, Math.floor(approx) - 2);
  }

  for (let guard = 0; guard < cap * 3 + 50 && out.length < cap; guard++, index++) {
    let w: WallClock | null;
    if (event.recurrence === "daily" || event.recurrence === "weekly") {
      const step = event.recurrence === "daily" ? index : index * 7;
      const d = new Date(Date.UTC(origin.year, origin.month - 1, origin.day + step));
      w = { ...origin, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    } else {
      const monthIndex = origin.month - 1 + index;
      const year = origin.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      w = origin.day > daysInMonth(year, month) ? null : { ...origin, year, month };
    }
    if (!w) continue;
    const start = zonedWallToEpoch(w, tz);
    if (start >= to) break;
    if (overlaps(start)) out.push(start);
  }
  return out;
}

// ---------------------------------------------------------------------------
// iCalendar export

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsDate(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function foldLine(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (bytes.encode(current + char).length > limit) {
      out.push(current);
      current = char;
      limit = 74; // continuation lines start with a space
    } else current += char;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

export function hubEventToIcs(
  event: Pick<
    HubEvent,
    "id" | "title" | "description" | "startsAt" | "endsAt" | "recurrence" | "cancelledAt" | "updatedAt" | "createdAt"
  >,
  options: { hubName?: string; url?: string; now?: number } = {},
): string {
  const rrule =
    event.recurrence === "daily"
      ? "FREQ=DAILY"
      : event.recurrence === "weekly"
        ? "FREQ=WEEKLY"
        : event.recurrence === "monthly"
          ? "FREQ=MONTHLY"
          : "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DeCave//Hub Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@decave`,
    `DTSTAMP:${icsDate(options.now ?? Date.now())}`,
    `CREATED:${icsDate(event.createdAt)}`,
    `LAST-MODIFIED:${icsDate(event.updatedAt)}`,
    `DTSTART:${icsDate(event.startsAt)}`,
    `DTEND:${icsDate(event.endsAt ?? event.startsAt + 60 * 60_000)}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  if (options.hubName) lines.push(`LOCATION:${icsEscape(options.hubName)}`);
  if (options.url) lines.push(`URL:${options.url}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  lines.push(`STATUS:${event.cancelledAt ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
