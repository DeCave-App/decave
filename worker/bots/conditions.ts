// Rule conditions ("only when ..."). Role, age and variable checks read D1.
// Owner/admin base roles are not custom roles: hasRole is true only for an
// assigned custom role.

import type { BotCondition, BotRule } from "../../shared/bots/types";
import type { Env } from "../lib/env";
import type { BotEvent } from "./actions/registry";
import { limitsNow } from "./limits";
import { getVariable } from "./store";

export type ConditionContext = {
  env: Env;
  event: BotEvent;
  vars: Record<string, string | number>;
  rng?: () => number;
};

const DAY_MS = 86_400_000;

export async function memberHasRole(db: D1Database, hubId: number, userId: string, roleId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM decave_member_roles m JOIN decave_custom_roles r ON r.id=m.role_id AND r.hub_id=m.hub_id
       WHERE m.hub_id=? AND m.user_id=? AND m.role_id=? LIMIT 1`,
    )
    .bind(hubId, userId, roleId)
    .first<{ found: number }>();
  return Boolean(row);
}

function olderThan(iso: string | null | undefined, minDays: number): boolean {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) && limitsNow() - at >= minDays * DAY_MS;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function localMinutes(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(limitsNow()));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return get("hour") * 60 + get("minute");
  } catch {
    const now = new Date(limitsNow());
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

function compare(actual: string | number | null, op: string, expected: string | number): boolean {
  const left = actual ?? "";
  switch (op) {
    case "=":
      return String(left) === String(expected);
    case "!=":
      return String(left) !== String(expected);
    case ">":
      return Number(left) > Number(expected);
    case "<":
      return Number(left) < Number(expected);
    case "contains":
      return String(left).toLowerCase().includes(String(expected).toLowerCase());
    default:
      return false;
  }
}

export async function evaluateCondition(condition: BotCondition, ctx: ConditionContext): Promise<boolean> {
  const { env, event } = ctx;
  const db = env.DB;
  const actor = event.actorId;
  switch (condition.type) {
    case "hasRole":
      return Boolean(actor) && (await memberHasRole(db, event.hubId, actor as string, condition.roleId));
    case "lacksRole":
      return !actor || !(await memberHasRole(db, event.hubId, actor, condition.roleId));
    case "channelIs":
      return event.roomId !== null && String(event.roomId) === condition.channelId;
    case "channelIsNot":
      return event.roomId === null || String(event.roomId) !== condition.channelId;
    case "accountAge": {
      if (!actor) return false;
      const row = await db
        .prepare("SELECT created_at FROM decave_users WHERE id=?")
        .bind(actor)
        .first<{ created_at: string }>();
      return olderThan(row?.created_at, condition.minDays);
    }
    case "memberAge": {
      if (!actor) return false;
      const row = await db
        .prepare("SELECT joined_at FROM decave_hub_members WHERE hub_id=? AND user_id=?")
        .bind(event.hubId, actor)
        .first<{ joined_at: string }>();
      return olderThan(row?.joined_at, condition.minDays);
    }
    case "variable": {
      const value = await getVariable(db, event.hubId, condition.name, condition.scope, actor);
      return compare(value, condition.op, condition.value);
    }
    case "chance":
      return (ctx.rng ?? Math.random)() * 100 < condition.percent;
    case "timeOfDay": {
      const now = localMinutes(condition.timezone);
      const from = minutesOf(condition.from);
      const to = minutesOf(condition.to);
      return from <= to ? now >= from && now < to : now >= from || now < to;
    }
    case "weekday":
      return condition.days.includes(new Date(limitsNow()).getUTCDay());
  }
}

/** `all` must all hold and, when present, at least one of `any`. No conditions means true. */
export async function evaluateConditions(when: BotRule["when"], ctx: ConditionContext): Promise<boolean> {
  if (!when) return true;
  for (const condition of when.all ?? []) if (!(await evaluateCondition(condition, ctx))) return false;
  if (when.any?.length) {
    for (const condition of when.any) if (await evaluateCondition(condition, ctx)) return true;
    return false;
  }
  return true;
}
