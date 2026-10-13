// Bot timers: schedules, waits and temporary-role reverts. Rows live in
// decave_bot_timers; the realtime Durable Object's alarm calls
// runAllDueBotTimers and re-arms itself for the next fire time.
//
// Exactly once: takeDueTimers deletes the due rows and returns them in one
// statement, so two overlapping alarms never get the same timer. A timer whose
// run fails is put back once, a minute later, with a ":retry" key; a second
// failure drops it and logs an error run.

import { BOT_LIMITS, type BotAction, type BotRule, type BotTrigger } from "../../shared/bots/types";
import { parseCron } from "../../shared/bots/cron";
import { expandOccurrences, type HubEvent } from "../../shared/hub-events";
import type { Env } from "../lib/env";
import { hostRoomFor } from "./actions/guard";
import { dispatchBotEvent, resumeBotRun, type BotEvent } from "./engine";
import { botsEnabled } from "./flags";
import { limitsNow } from "./limits";
import { refusal } from "./reasons";
import {
  deleteStaleRuleTimers,
  dueTimerRoomIds,
  getBot,
  listDraftRules,
  logRun,
  nextTimerAtAnyRoom,
  putTimer,
  takeDueTimers,
  type BotTimer,
} from "./store";
import { armRoomTimers, whileRunningTimers } from "./timer-arm";

export type ScheduleTrigger = Extract<BotTrigger, { type: "schedule" }>;

const MINUTE = 60_000;
const RETRY_SUFFIX = ":retry";

// Wall-clock time in an IANA zone --------------------------------------------

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      // An unknown zone falls back to UTC rather than never firing.
      format = formatter("UTC");
    }
    formatters.set(timeZone, format);
  }
  return format;
}

function wallTime(ms: number, timeZone: string): Wall {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(ms)))
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  return { y: parts.year, mo: parts.month, d: parts.day, h: parts.hour % 24, mi: parts.minute, s: parts.second };
}

/** The zone's offset from UTC at an instant, in ms. */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallTime(ms, timeZone);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall-clock time happens in the zone (DST gaps shift forward). */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return second;
}

function parseTime(text: string): [number, number] | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const h = Number(match[1]);
  const mi = Number(match[2]);
  return h <= 23 && mi <= 59 ? [h, mi] : null;
}

/**
 * The first fire time strictly after `from`, or null when the schedule can't
 * fire (bad time or cron text). Weekdays are 0 = Sunday, like the weekday
 * condition. Wall-clock schedules follow the trigger's timezone through DST.
 */
export function nextFireAt(trigger: ScheduleTrigger, from: Date): Date | null {
  const fromMs = from.getTime();
  if (trigger.every !== undefined) {
    const minutes = Math.max(Math.trunc(trigger.every), BOT_LIMITS.minScheduleMinutes);
    return new Date(fromMs + minutes * MINUTE);
  }
  const zone = trigger.timezone || "UTC";
  let times: [number, number][];
  let dayMatches: (y: number, mo: number, d: number, weekday: number) => boolean;
  let horizonDays = 8;
  if (trigger.daily !== undefined) {
    const time = parseTime(trigger.daily);
    if (!time) return null;
    times = [time];
    dayMatches = () => true;
  } else if (trigger.weekly !== undefined) {
    const time = parseTime(trigger.weekly.time);
    if (!time) return null;
    times = [time];
    const day = trigger.weekly.day;
    dayMatches = (_y, _mo, _d, weekday) => weekday === day;
  } else if (trigger.cron !== undefined) {
    const cron = parseCron(trigger.cron);
    if (!cron) return null;
    times = cron.hours.flatMap((h) => cron.minutes.map((mi): [number, number] => [h, mi]));
    dayMatches = (_y, mo, d, weekday) => {
      if (!cron.months.has(mo)) return false;
      const dayOk = cron.days.has(d);
      const weekdayOk = cron.weekdays.has(weekday);
      // Standard cron: when both are restricted, either one matching is enough.
      if (!cron.anyDay && !cron.anyWeekday) return dayOk || weekdayOk;
      return dayOk && weekdayOk;
    };
    horizonDays = 366 * 4 + 1;
  } else {
    return null;
  }

  const start = wallTime(fromMs, zone);
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + offset));
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    if (!dayMatches(y, mo, d, day.getUTCDay())) continue;
    for (const [h, mi] of times) {
      const at = wallToUtc(y, mo, d, h, mi, zone);
      if (at > fromMs) return new Date(at);
    }
  }
  return null;
}

// Scheduling ----------------------------------------------------------------

/**
 * Stores the rule's next schedule timer (no-op for other triggers) in the
 * bot's host room and wakes that room's alarm. Returns the fire time.
 */
export async function scheduleRuleTimers(
  env: Env,
  hubId: number,
  botId: string,
  ruleId: string,
  rule: BotRule,
  from: Date = new Date(limitsNow()),
): Promise<number | null> {
  if (rule.trigger.type !== "schedule") return null;
  const next = nextFireAt(rule.trigger, from);
  if (!next) return null;
  const bot = await getBot(env.DB, hubId, botId);
  if (!bot) return null;
  const roomId = await hostRoomFor(env.DB, hubId, null, bot.allowed_room_ids);
  if (roomId === null) return null;
  const fireAt = next.getTime();
  await putTimer(env.DB, {
    key: `sched:${ruleId}:${next.toISOString()}`,
    hubId,
    roomId,
    botId,
    ruleId,
    fireAt,
    payload: { kind: "schedule" },
  });
  await armRoomTimers(env, roomId);
  return fireAt;
}

/** After publish: drop stale schedule and wait timers, then arm one per published schedule rule. */
export async function syncBotSchedules(env: Env, hubId: number, botId: string): Promise<void> {
  await deleteStaleRuleTimers(env.DB, botId);
  for (const { ruleId, published } of await listDraftRules(env.DB, botId)) {
    if (published?.trigger.type === "schedule") await scheduleRuleTimers(env, hubId, botId, ruleId, published);
  }
}

// Running -------------------------------------------------------------------

/** true = done (ran or dropped on purpose); false = failed, retry once. */
async function runSchedule(env: Env, timer: BotTimer, now: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT r.published_json,r.enabled,b.enabled AS bot_enabled FROM decave_bot_rules r
     JOIN decave_hub_bots b ON b.id=r.bot_id
     WHERE r.id=? AND r.bot_id=? AND b.kind='builder'`,
  )
    .bind(timer.ruleId, timer.botId)
    .first<{ published_json: string | null; enabled: number; bot_enabled: number }>();
  // Unpublished, deleted or no longer a schedule: drop silently.
  if (!row?.published_json) return true;
  const rule = JSON.parse(row.published_json) as BotRule;
  if (rule.trigger.type !== "schedule") return true;

  // Re-arm first so a slow or failing run never loses the schedule. Exactly
  // one occurrence is armed per fire: payload.rearmed travels into a ":retry"
  // copy, so a retry re-arms only when the original never got that far.
  if (timer.payload.rearmed !== true) {
    // After a long outage, skip the missed occurrences instead of replaying
    // them. The 5-minute floor also guards cron text saved before validation.
    let from = Math.max(timer.fireAt, now - MINUTE);
    if (rule.trigger.cron !== undefined)
      from = Math.max(from, timer.fireAt + BOT_LIMITS.minScheduleMinutes * MINUTE - 1);
    await scheduleRuleTimers(env, timer.hubId, timer.botId, timer.ruleId, rule, new Date(from));
    timer.payload.rearmed = true;
  }

  // A paused rule or bot keeps its schedule but skips this occurrence.
  if (!row.enabled || !row.bot_enabled) return true;
  const event: BotEvent = {
    hubId: timer.hubId,
    roomId: timer.roomId,
    kind: "schedule",
    actorId: null,
    actorIsBot: false,
    chainDepth: 0,
    data: { ruleId: timer.ruleId },
  };
  await scheduleDispatch(env, event, { onlyRuleId: timer.ruleId });
  return true;
}

let scheduleDispatch: typeof dispatchBotEvent = dispatchBotEvent;

/** Tests only: replace the schedule dispatcher (null restores it). */
export function setScheduleDispatchForTests(next: typeof dispatchBotEvent | null): void {
  scheduleDispatch = next ?? dispatchBotEvent;
}

async function runWait(env: Env, timer: BotTimer): Promise<boolean> {
  const { actions, vars, event } = timer.payload as {
    actions?: BotAction[];
    vars?: Record<string, string | number>;
    event?: BotEvent;
  };
  if (!Array.isArray(actions) || !event || typeof event !== "object") return true;
  const outcome = await resumeBotRun(env, {
    hubId: timer.hubId,
    botId: timer.botId,
    ruleId: timer.ruleId,
    actions,
    vars: vars ?? {},
    event: { ...event, hubId: timer.hubId },
    trigger: "wait",
    requireLiveRule: true,
  });
  // Retried only when nothing ran and the failure was transient (see resumeBotRun).
  return !outcome?.retryable;
}

async function runRoleRevert(env: Env, timer: BotTimer): Promise<boolean> {
  const { op, userId, roleId } = timer.payload as { op?: string; userId?: string; roleId?: string };
  if ((op !== "add" && op !== "remove") || typeof userId !== "string" || typeof roleId !== "string") return true;
  const outcome = await resumeBotRun(env, {
    hubId: timer.hubId,
    botId: timer.botId,
    ruleId: timer.ruleId,
    actions: [{ type: op === "add" ? "addRole" : "removeRole", roleId }],
    vars: {},
    event: {
      hubId: timer.hubId,
      roomId: timer.roomId,
      kind: "schedule",
      actorId: userId,
      actorIsBot: false,
      chainDepth: 0,
      data: {},
    },
    trigger: "role",
    requireLiveRule: false,
  });
  // A single role change is safe to repeat, so any failure is retried.
  return outcome === null || outcome.status === "ok";
}

async function runTimer(env: Env, timer: BotTimer, now: number): Promise<boolean> {
  switch (timer.payload.kind) {
    case "schedule":
      return runSchedule(env, timer, now);
    case "wait":
      return runWait(env, timer);
    case "role":
      return runRoleRevert(env, timer);
    case "hubEvent":
      // Never retried: a missed start is not announced late.
      return runHubEventStart(env, timer, now).catch((error) => {
        console.error("hub event start failed", timer.key, error);
        return true;
      });
    default:
      return true;
  }
}

/** The run-log detail for a timer dropped after its retry failed. */
function timerDropped(kind: string) {
  const { reason, notice } = refusal("bots.run.server.timerDropped", { kind });
  return { detail: reason, notice };
}

async function retryOrDrop(env: Env, timer: BotTimer, now: number): Promise<void> {
  if (!timer.key.endsWith(RETRY_SUFFIX)) {
    await putTimer(env.DB, { ...timer, key: `${timer.key}${RETRY_SUFFIX}`, fireAt: now + MINUTE });
    return;
  }
  const kind = String(timer.payload.kind ?? "timer");
  console.error("bot timer failed twice", timer.key);
  await logRun(env.DB, {
    botId: timer.botId,
    ruleId: timer.ruleId,
    trigger: kind,
    status: "error",
    ...timerDropped(kind),
  }).catch(() => undefined);
}

/**
 * Runs the room's due timers once each. The caller (the Durable Object alarm)
 * re-arms afterwards, so timers written meanwhile skip the wake-up request.
 */
export async function runDueBotTimers(env: Env, roomId: number, now: number): Promise<number> {
  if (!botsEnabled(env)) return 0;
  return whileRunningTimers(async () => {
    const due = await takeDueTimers(env.DB, roomId, now);
    for (const timer of due) {
      let done = false;
      try {
        done = await runTimer(env, timer, now);
      } catch (error) {
        console.error("bot timer failed", timer.key, error);
      }
      if (!done) await retryOrDrop(env, timer, now).catch((error) => console.error("bot timer retry failed", error));
    }
    return due.length;
  });
}

/** Every room's due timers (one Durable Object hosts all rooms). */
export async function runAllDueBotTimers(env: Env, now: number): Promise<void> {
  if (!botsEnabled(env)) return;
  for (const roomId of await dueTimerRoomIds(env.DB, now)) await runDueBotTimers(env, roomId, now);
}

/** When the alarm must next wake for bot timers; null when there are none (or bots are off). */
export async function nextBotTimerAt(env: Env): Promise<number | null> {
  if (!botsEnabled(env)) return null;
  return nextTimerAtAnyRoom(env.DB);
}

// Hub event starts -------------------------------------------------------------

type HubEventTimingRow = {
  id: string;
  hub_id: number;
  channel_id: number | null;
  title: string;
  starts_at: number;
  ends_at: number | null;
  recurrence: HubEvent["recurrence"];
  timezone: string;
  cancelled_at: number | null;
};

/** How late an event start may still be announced (after an outage it is skipped). */
const EVENT_START_GRACE_MS = 10 * MINUTE;

function occurrencesOf(row: HubEventTimingRow, from: number, to: number, cap: number): number[] {
  return expandOccurrences(
    {
      startsAt: Number(row.starts_at),
      endsAt: row.ends_at === null ? null : Number(row.ends_at),
      recurrence: row.recurrence,
      timezone: row.timezone,
    },
    from,
    to,
    cap,
  );
}

/**
 * Arms a timer for the event's next start (bot hubEventStart triggers). Called
 * when an event is created or edited and again after each start of a
 * recurring event. Not tied to a bot: every published rule of the hub sees it.
 */
export async function scheduleHubEventStart(
  env: Env,
  row: HubEventTimingRow,
  from: number = limitsNow(),
): Promise<number | null> {
  if (!botsEnabled(env) || row.cancelled_at !== null) return null;
  const next = occurrencesOf(row, from, from + 400 * 24 * 60 * MINUTE, 3).find((start) => start > from);
  if (next === undefined) return null;
  const roomId = row.channel_id ?? (await hostRoomFor(env.DB, Number(row.hub_id), null, "[]"));
  if (roomId === null) return null;
  await putTimer(env.DB, {
    key: `hubevent:${row.id}:${next}`,
    hubId: Number(row.hub_id),
    roomId,
    botId: "",
    ruleId: "",
    fireAt: next,
    payload: { kind: "hubEvent", eventId: row.id, occurrence: next },
  });
  await armRoomTimers(env, roomId);
  return next;
}

async function runHubEventStart(env: Env, timer: BotTimer, now: number): Promise<boolean> {
  const { eventId, occurrence } = timer.payload as { eventId?: string; occurrence?: number };
  if (typeof eventId !== "string" || typeof occurrence !== "number") return true;
  const row = await env.DB.prepare("SELECT * FROM decave_hub_events WHERE id=? AND hub_id=?")
    .bind(eventId, timer.hubId)
    .first<HubEventTimingRow>();
  // Deleted, cancelled or moved (an edit armed its own timer): drop this one.
  if (!row || row.cancelled_at !== null) return true;
  if (!occurrencesOf(row, occurrence, occurrence + 1, 1).includes(occurrence)) return true;
  if (row.recurrence !== "none") await scheduleHubEventStart(env, row, occurrence);
  if (now - occurrence > EVENT_START_GRACE_MS) return true;
  await scheduleDispatch(env, {
    hubId: timer.hubId,
    roomId: row.channel_id ?? timer.roomId,
    kind: "hubEventStart",
    actorId: null,
    actorIsBot: false,
    chainDepth: 0,
    data: { eventId, title: row.title },
  });
  return true;
}
