// Role actions: give, take or toggle a custom role on the acting member. With
// durationMinutes a revert timer is stored for the scheduler (timers.ts).

import { BOT_LIMITS } from "../../../shared/bots/types";
import { audit } from "../../db";
import { realtimeRecheckAccess } from "../../lib/realtime";
import { memberHasRole } from "../conditions";
import { limitsNow } from "../limits";
import { refusal } from "../reasons";
import { putTimer } from "../store";
import { armRoomTimers } from "../timer-arm";
import { guardActor, guardRole, refused, timerHostRoom } from "./guard";
import { registerAction, type ActionContext, type ActionResult } from "./registry";

type RoleOp = "add" | "remove" | "toggle";

async function changeRole(
  ctx: ActionContext,
  roleId: string,
  op: RoleOp,
  durationMinutes: number | undefined,
): Promise<ActionResult> {
  const role = await guardRole(ctx, roleId);
  if (refused(role)) return { ok: false, reason: role.reason, notice: role.notice };
  const userId = await guardActor(ctx);
  if (refused(userId)) return { ok: false, reason: userId.reason, notice: userId.notice };
  const timed = typeof durationMinutes === "number" && durationMinutes > 0;
  // Timers run in a room's Durable Object; pick the room that hosts this one.
  const hostRoomId = timed ? await timerHostRoom(ctx) : null;
  if (timed && hostRoomId === null) return { ok: false, ...refusal("bots.run.server.timedRoleNeedsChannel") };

  const db = ctx.env.DB;
  const has = await memberHasRole(db, ctx.event.hubId, userId, role.id);
  const applied: "add" | "remove" = op === "toggle" ? (has ? "remove" : "add") : op;
  if (ctx.dryRun) return { ok: true };

  if (applied === "add" && !has)
    await db
      .prepare("INSERT OR IGNORE INTO decave_member_roles(hub_id,user_id,role_id) VALUES(?,?,?)")
      .bind(ctx.event.hubId, userId, role.id)
      .run();
  if (applied === "remove" && has)
    await db
      .prepare("DELETE FROM decave_member_roles WHERE hub_id=? AND user_id=? AND role_id=?")
      .bind(ctx.event.hubId, userId, role.id)
      .run();

  if (timed && hostRoomId !== null) {
    const minutes = Math.min(Math.trunc(durationMinutes), BOT_LIMITS.maxWaitMinutes);
    const fireAt = limitsNow() + minutes * 60_000;
    await putTimer(db, {
      key: `role:${userId}:${role.id}:${new Date(fireAt).toISOString()}`,
      hubId: ctx.event.hubId,
      roomId: hostRoomId,
      botId: ctx.bot.id,
      ruleId: ctx.ruleId,
      fireAt,
      payload: { kind: "role", op: applied === "add" ? "remove" : "add", userId, roleId: role.id },
    });
    await armRoomTimers(ctx.env, hostRoomId);
  }
  if (applied === "add" ? !has : has) {
    await audit(db, ctx.event.hubId, ctx.publishedBy, `bot.role.${applied}`, userId, `${ctx.bot.name}:${role.id}`);
    await realtimeRecheckAccess(ctx.env, ctx.event.hubId);
  }
  return { ok: true };
}

for (const op of ["add", "remove", "toggle"] as const) {
  const type = `${op}Role` as const;
  registerAction(type, {
    capability: "manage_roles",
    run: (ctx, action) =>
      action.type === type ? changeRole(ctx, action.roleId, op, action.durationMinutes) : Promise.resolve({ ok: true }),
  });
}
