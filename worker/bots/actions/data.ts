// Variable actions: set, add to and reset hub or per-member variables. A new
// variable name past the hub's limit is refused.
// wait pauses the rule and resumes its remaining actions later.

import { renderTemplate } from "../../../shared/bots/render";
import { BOT_LIMITS, type BotVariableScope } from "../../../shared/bots/types";
import { limitsNow } from "../limits";
import { refusal, type Refusal } from "../reasons";
import { deleteVariable, getVariable, putTimer, setVariable } from "../store";
import { armRoomTimers } from "../timer-arm";
import { guardPublisher, refused, timerHostRoom } from "./guard";
import { registerAction, type ActionContext, type ActionResult } from "./registry";

type Target = { owner: string | null } | Refusal;

async function target(ctx: ActionContext, scope: BotVariableScope): Promise<Target> {
  const publisher = await guardPublisher(ctx);
  if (refused(publisher)) return publisher;
  if (scope === "user" && !ctx.event.actorId) return refusal("bots.run.server.noMember");
  return { owner: scope === "user" ? ctx.event.actorId : null };
}

function value(ctx: ActionContext, raw: string | number | undefined): string | number {
  if (typeof raw === "number") return raw;
  return raw === undefined ? "" : renderTemplate(raw, ctx.vars);
}

registerAction("setVariable", {
  capability: null,
  async run(ctx, action): Promise<ActionResult> {
    if (action.type !== "setVariable") return { ok: true };
    const t = await target(ctx, action.scope);
    if ("reason" in t) return { ok: false, reason: t.reason, notice: t.notice };
    if (ctx.dryRun) return { ok: true };
    const stored = await setVariable(
      ctx.env.DB,
      ctx.event.hubId,
      action.name,
      action.scope,
      t.owner,
      value(ctx, action.value),
    );
    return stored ? { ok: true } : { ok: false, ...refusal("bots.run.server.variableLimit") };
  },
});

registerAction("addVariable", {
  capability: null,
  async run(ctx, action): Promise<ActionResult> {
    if (action.type !== "addVariable") return { ok: true };
    const t = await target(ctx, action.scope);
    if ("reason" in t) return { ok: false, reason: t.reason, notice: t.notice };
    const amount = Number(action.value === undefined ? 1 : value(ctx, action.value));
    if (!Number.isFinite(amount)) return { ok: false, ...refusal("bots.run.server.notANumber") };
    if (ctx.dryRun) return { ok: true };
    const current = Number((await getVariable(ctx.env.DB, ctx.event.hubId, action.name, action.scope, t.owner)) ?? 0);
    const next = (Number.isFinite(current) ? current : 0) + amount;
    const stored = await setVariable(ctx.env.DB, ctx.event.hubId, action.name, action.scope, t.owner, next);
    return stored ? { ok: true } : { ok: false, ...refusal("bots.run.server.variableLimit") };
  },
});

registerAction("resetVariable", {
  capability: null,
  async run(ctx, action): Promise<ActionResult> {
    if (action.type !== "resetVariable") return { ok: true };
    const t = await target(ctx, action.scope);
    if ("reason" in t) return { ok: false, reason: t.reason, notice: t.notice };
    if (!ctx.dryRun) await deleteVariable(ctx.env.DB, ctx.event.hubId, action.name, action.scope, t.owner);
    return { ok: true };
  },
});

// wait: stores the actions after it, the run's vars and its event in a timer
// and stops; the timer runner resumes them later. A dry run waits for nothing.
registerAction("wait", {
  capability: null,
  async run(ctx, action): Promise<ActionResult> {
    if (action.type !== "wait") return { ok: true };
    if (ctx.dryRun) return { ok: true };
    const rest = ctx.remaining ?? [];
    if (!rest.length) return { stop: true };
    const hostRoomId = await timerHostRoom(ctx);
    if (hostRoomId === null) return { ok: false, ...refusal("bots.run.server.waitNeedsChannel") };
    const minutes = Math.min(Math.max(Math.trunc(action.minutes), 1), BOT_LIMITS.maxWaitMinutes);
    await putTimer(ctx.env.DB, {
      key: `wait:${crypto.randomUUID()}:${ctx.actionIndex ?? 0}`,
      hubId: ctx.event.hubId,
      roomId: hostRoomId,
      botId: ctx.bot.id,
      ruleId: ctx.ruleId,
      fireAt: limitsNow() + minutes * 60_000,
      payload: { kind: "wait", actions: rest, vars: ctx.vars, event: ctx.event },
    });
    await armRoomTimers(ctx.env, hostRoomId);
    return { stop: true };
  },
});
