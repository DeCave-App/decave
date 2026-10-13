// The builder-bot engine: finds the published rules an event fires, applies
// scope, bot-chain, budget, cooldown and condition checks, runs the actions
// through the registry and records each run. Never throws to its caller.

import { BOT_LIMITS, type BotAction, type BotRule } from "../../shared/bots/types";
import { renderTemplate } from "../../shared/bots/render";
import type { Env } from "../lib/env";
import { storedHubBotCapabilities } from "../lib/hub-bots";
import {
  getAction,
  setRuleRunner,
  type ActionContext,
  type ActionResult,
  type BotEvent,
  type BotInteractionResponse,
  type DryRunStep,
} from "./actions/registry";
// Registers every action handler (side-effect imports).
import "./actions/index";
import { evaluateConditions, memberHasRole } from "./conditions";
import { botsEnabled } from "./flags";
import { limitsNow, onCooldown, startCooldown, takeBudget } from "./limits";
import {
  getBot,
  listBots,
  listPublishedRules,
  logRun,
  type BotRow,
  type BotRunStatus,
  type PublishedRule,
} from "./store";
import { refusal, withAction } from "./reasons";
import { matchesTrigger } from "./triggers";
import { unsafeRegexReason } from "../../shared/bots/schema";
import type { BotRunNotice } from "../../shared/bots/run-notice.ts";
import type { ServerNoticeCode, ServerNoticeParams } from "../../shared/i18n/server-notices.ts";

export type { ActionContext, ActionHandler, BotEvent, BotInteractionResponse, DryRunStep } from "./actions/registry";

const CACHE_TTL_MS = 30_000;
type HubRules = { at: number; rules: PublishedRule[]; bots: Map<string, BotRow> };
const ruleCache = new Map<number, HubRules>();

/** Drop the cached rules after publish, bot delete/update or rule pause. */
export function invalidateHubRules(hubId: number): void {
  ruleCache.delete(hubId);
}

async function hubRules(env: Env, hubId: number): Promise<HubRules> {
  const cached = ruleCache.get(hubId);
  if (cached && limitsNow() - cached.at < CACHE_TTL_MS) return cached;
  const [rules, bots] = await Promise.all([listPublishedRules(env.DB, hubId), listBots(env.DB, hubId)]);
  const entry = { at: limitsNow(), rules, bots: new Map(bots.map((bot) => [bot.id, bot])) };
  ruleCache.set(hubId, entry);
  return entry;
}

type StepDescription = { description: string; descriptionNotice?: BotRunNotice };

/** A coded run-log text: the English plus the notice the bot builder translates. */
function coded(code: ServerNoticeCode, params?: ServerNoticeParams): { detail: string; notice: BotRunNotice } {
  const { reason, notice } = refusal(code, params);
  return { detail: reason, notice };
}

/** A step's text. DeCave-written wording also comes as a notice; action types and user text stay as written. */
function describeAction(action: BotAction, vars: Record<string, string | number>, dryRun = false): StepDescription {
  const described = (code: ServerNoticeCode, params: ServerNoticeParams): StepDescription => {
    const { detail, notice } = coded(code, params);
    return { description: detail, descriptionNotice: notice };
  };
  const text = "text" in action && typeof action.text === "string" ? action.text : null;
  if (text !== null) return { description: `${action.type}: ${renderTemplate(text, vars, () => 0)}` };
  if (action.type === "webhook") {
    if (!dryRun) return { description: `webhook: ${action.method} ${action.url}` };
    try {
      const u = new URL(renderTemplate(action.url, vars, () => 0));
      return described("bots.run.server.wouldCall", { method: action.method, url: `https://${u.host}${u.pathname}` });
    } catch {
      return { description: `webhook: ${action.method} ${action.url}` };
    }
  }
  if (action.type === "wait")
    return dryRun
      ? described("bots.run.server.wouldWait", { count: action.minutes })
      : { description: `wait: ${action.minutes} minutes` };
  if ("roleId" in action) return described("bots.run.server.roleStep", { action: action.type, role: action.roleId });
  if ("name" in action && typeof action.name === "string") return { description: `${action.type}: ${action.name}` };
  return { description: action.type };
}

export type RuleOutcome = { status: BotRunStatus; detail: string; notice?: BotRunNotice };

async function runActions(ctx: ActionContext, actions: BotAction[]): Promise<RuleOutcome> {
  const capabilities = storedHubBotCapabilities(ctx.bot.capabilities);
  const list = actions.slice(0, BOT_LIMITS.actionsPerRule);
  for (const [index, action] of list.entries()) {
    ctx.actionIndex = index;
    ctx.remaining = list.slice(index + 1);
    const handler = getAction(action.type);
    const described = describeAction(action, ctx.vars, ctx.dryRun);
    const step = { ruleId: ctx.ruleId, action: action.type, ...described };
    const fail = (reason: string, limited = false, notice?: BotRunNotice): RuleOutcome => {
      ctx.steps.push({ ...step, ok: false, reason, ...(notice ? { reasonNotice: notice } : {}) });
      const actionNotice = withAction(notice, action.type);
      return {
        status: limited ? "limited" : "error",
        detail: `${action.type}: ${reason}`,
        ...(actionNotice ? { notice: actionNotice } : {}),
      };
    };
    const failCoded = (code: ServerNoticeCode, params?: ServerNoticeParams) => {
      const { reason, notice } = refusal(code, params);
      return fail(reason, false, notice);
    };
    if (!handler) return failCoded("bots.run.server.unknownAction", { action: action.type });
    if (handler.capability && !capabilities.includes(handler.capability))
      return failCoded("bots.run.server.capabilityMissing", { capability: handler.capability });
    let result;
    try {
      result = await handler.run(ctx, action);
    } catch (error) {
      // An unexpected error's own message is internal and stays as written.
      return error instanceof Error ? fail(error.message) : failCoded("bots.run.server.actionFailed");
    }
    if ("stop" in result) {
      ctx.steps.push({ ...step, ok: true });
      break;
    }
    if (!result.ok) return fail(result.reason, result.limited === true, result.notice);
    ctx.steps.push({ ...step, ok: true });
    if (result.vars) Object.assign(ctx.vars, result.vars);
  }
  return { status: "ok", ...coded(actions.length ? "bots.run.server.ranActions" : "bots.run.server.ranNothing") };
}

/**
 * Variables every rule can use. People and places are named, never by database
 * id: {user} / {user.name} is the display name (else username), {user.id} the
 * public DeCave id, {user.mention} the chat's @username mention; {channel} and
 * {hub} are names, {role} the role a role trigger is about.
 */
async function baseVars(env: Env, event: BotEvent): Promise<Record<string, string | number>> {
  const vars: Record<string, string | number> = {};
  const hub = await env.DB.prepare("SELECT name FROM decave_hubs WHERE id=?")
    .bind(event.hubId)
    .first<{ name: string }>()
    .catch(() => null);
  vars.hub = hub?.name ?? "";
  if (event.actorId) {
    const user = await env.DB.prepare("SELECT username,display_name,public_id FROM decave_users WHERE id=?")
      .bind(event.actorId)
      .first<{ username: string; display_name: string | null; public_id: string | null }>()
      .catch(() => null);
    if (user) {
      const name = user.display_name?.trim() || user.username;
      vars.user = name;
      vars["user.name"] = name;
      vars["user.id"] = user.public_id ?? "";
      vars["user.mention"] = `@${user.username}`;
    }
  }
  if (event.roomId !== null) {
    const room = await env.DB.prepare("SELECT name FROM decave_rooms WHERE id=?")
      .bind(event.roomId)
      .first<{ name: string }>()
      .catch(() => null);
    vars.channel = room?.name ?? "";
  }
  if (typeof event.data.roleId === "string" && event.data.roleId) {
    const role = await env.DB.prepare("SELECT name FROM decave_custom_roles WHERE id=? AND hub_id=?")
      .bind(event.data.roleId, event.hubId)
      .first<{ name: string }>()
      .catch(() => null);
    if (role) vars.role = role.name;
  }
  if (typeof event.data.text === "string") vars.text = event.data.text.slice(0, BOT_LIMITS.renderMaxChars);
  return vars;
}

async function runRule(
  env: Env,
  event: BotEvent,
  entry: PublishedRule,
  bot: BotRow,
  dryRun: boolean,
  steps: DryRunStep[],
  interaction?: BotInteractionResponse,
): Promise<void> {
  const rule: BotRule = entry.rule;
  const record = async (status: BotRunStatus, detail: string, notice?: BotRunNotice) => {
    if (!dryRun)
      await logRun(env.DB, {
        botId: entry.botId,
        ruleId: entry.ruleId,
        trigger: rule.trigger.type,
        status,
        detail,
        notice,
      });
  };
  const recordCoded = (status: BotRunStatus, code: ServerNoticeCode) => {
    const { detail, notice } = coded(code);
    return record(status, detail, notice);
  };

  if (rule.trigger.type === "schedule" && event.data.ruleId !== entry.ruleId) return;
  // Re-checked here so a pattern stored before the safe-subset rule never runs.
  if (rule.trigger.type === "message" && rule.trigger.mode === "regex" && unsafeRegexReason(rule.trigger.pattern))
    return event.kind === "message" ? recordCoded("skipped", "bots.run.server.patternNotAllowed") : undefined;
  const matched = matchesTrigger(rule.trigger, event);
  if (!matched.match) return;
  // Bot-authored events are ignored silently unless the rule opts in.
  if (event.actorIsBot && !rule.allowBotTriggers) return;
  // "*" (what templates and the builder save) means every room, like an empty list.
  const channels = rule.scope.channels;
  if (channels.length && !channels.includes("*") && (event.roomId === null || !channels.includes(String(event.roomId))))
    return;
  if (rule.scope.roles.length) {
    if (!event.actorId) return;
    let inScope = false;
    for (const roleId of rule.scope.roles) {
      if (await memberHasRole(env.DB, event.hubId, event.actorId, roleId)) {
        inScope = true;
        break;
      }
    }
    if (!inScope) return;
  }

  if (event.chainDepth >= BOT_LIMITS.maxChainDepth) return recordCoded("limited", "bots.run.server.chainTooDeep");

  const cooldownKeys: [string, number][] = [];
  if (rule.cooldown.perUser > 0 && event.actorId)
    cooldownKeys.push([`${entry.ruleId}:u:${event.actorId}`, rule.cooldown.perUser]);
  if (rule.cooldown.perChannel > 0 && event.roomId !== null)
    cooldownKeys.push([`${entry.ruleId}:c:${event.roomId}`, rule.cooldown.perChannel]);

  if (!dryRun) {
    if (onCooldown(cooldownKeys.map(([key]) => key))) return recordCoded("skipped", "bots.run.server.coolingDown");
    if (!takeBudget(event.hubId, "runs")) return recordCoded("limited", "bots.run.server.runLimit");
  }

  // Base vars go last so no trigger-provided value can spoof user/channel/hub/text.
  const vars = { ...matched.vars, ...(await baseVars(env, event)) };
  const passes = await evaluateConditions(rule.when, { env, event, vars });
  const actions = passes ? rule.then : (rule.else ?? []);
  if (!passes && !actions.length) return recordCoded("skipped", "bots.run.server.conditionsNotMet");
  // Only a rule that actually runs (then or else) cools down.
  if (!dryRun) for (const [key, seconds] of cooldownKeys) startCooldown(key, seconds);

  const ctx: ActionContext = {
    env,
    event,
    bot,
    publishedBy: entry.publishedBy ?? bot.published_by ?? bot.created_by,
    ruleId: entry.ruleId,
    vars,
    dryRun,
    steps,
    interaction,
  };
  const outcome = await runActions(ctx, actions);
  await record(outcome.status, outcome.detail, outcome.notice);
  // An error may have auto-paused the bot; reload so it stops at once.
  if (outcome.status === "error" && !dryRun) invalidateHubRules(event.hubId);
}

export async function dispatchBotEvent(
  env: Env,
  event: BotEvent,
  opts: {
    dryRun?: boolean;
    onlyRuleId?: string;
    interaction?: BotInteractionResponse;
    /** Test runs: run this (draft) rule instead of the published ones, even if the bot is off. Needs dryRun. */
    ruleOverride?: PublishedRule;
  } = {},
): Promise<DryRunStep[]> {
  const steps: DryRunStep[] = [];
  if (!botsEnabled(env)) return steps;
  const dryRun = Boolean(opts.dryRun);
  const override = dryRun ? opts.ruleOverride : undefined;
  let entries: HubRules;
  try {
    // A test run needs only its own rule and bot.
    entries = override ? { at: 0, rules: [], bots: new Map() } : await hubRules(env, event.hubId);
  } catch (error) {
    console.error("bot rules load failed", error);
    return steps;
  }
  for (const entry of override ? [override] : entries.rules) {
    if (opts.onlyRuleId && entry.ruleId !== opts.onlyRuleId) continue;
    // A test run reads its bot fresh: the cache may predate a just-created bot.
    const bot = override ? await getBot(env.DB, event.hubId, entry.botId) : entries.bots.get(entry.botId);
    if (!bot || (!bot.enabled && !override)) continue;
    try {
      await runRule(env, event, entry, bot, dryRun, steps, opts.interaction);
    } catch (error) {
      console.error("bot rule failed", entry.ruleId, error);
      if (!dryRun) {
        await logRun(env.DB, {
          botId: entry.botId,
          ruleId: entry.ruleId,
          trigger: entry.rule.trigger.type,
          status: "error",
          ...(error instanceof Error ? { detail: error.message } : coded("bots.run.server.ruleFailed")),
        }).catch(() => undefined);
        invalidateHubRules(event.hubId);
      }
    }
  }
  return steps;
}

/**
 * The runRule action: runs another published rule of the same bot one chain
 * level deeper. Its trigger, scope and cooldown are skipped (it was asked for
 * by name); its conditions still choose then or else. Logged as its own run.
 */
async function runLinkedRule(ctx: ActionContext, ruleId: string): Promise<ActionResult> {
  const chainDepth = ctx.event.chainDepth + 1;
  if (chainDepth >= BOT_LIMITS.maxChainDepth) return { ok: false, ...refusal("bots.run.server.chainTooDeep") };
  const { rules } = await hubRules(ctx.env, ctx.event.hubId);
  const entry = rules.find((candidate) => candidate.botId === ctx.bot.id && candidate.ruleId === ruleId);
  if (!entry) return { ok: false, ...refusal("bots.run.server.ruleUnavailable") };
  // A linked run is a run: it spends the hub's run budget like any other.
  if (!ctx.dryRun && !takeBudget(ctx.event.hubId, "runs")) {
    await logRun(ctx.env.DB, {
      botId: entry.botId,
      ruleId: entry.ruleId,
      trigger: "runRule",
      status: "limited",
      ...coded("bots.run.server.runLimit"),
    });
    return { stop: true };
  }
  const event: BotEvent = { ...ctx.event, chainDepth };
  const vars = { ...ctx.vars };
  const passes = await evaluateConditions(entry.rule.when, { env: ctx.env, event, vars });
  const actions = passes ? entry.rule.then : (entry.rule.else ?? []);
  const sub: ActionContext = {
    ...ctx,
    event,
    ruleId: entry.ruleId,
    vars,
    publishedBy: entry.publishedBy ?? ctx.publishedBy,
  };
  const outcome = await runActions(sub, actions);
  if (!ctx.dryRun)
    await logRun(ctx.env.DB, {
      botId: entry.botId,
      ruleId: entry.ruleId,
      trigger: "runRule",
      status: outcome.status,
      detail: outcome.detail,
      notice: outcome.notice,
    });
  return outcome.status === "ok" ? { ok: true } : { ok: false, reason: outcome.detail, notice: outcome.notice };
}

setRuleRunner(runLinkedRule);

/** startedActions: actions that ran ok; retryable: nothing ran and the failure was transient. */
export type ResumedOutcome = RuleOutcome & { startedActions: number; retryable: boolean };

export type ResumedRun = {
  hubId: number;
  botId: string;
  ruleId: string;
  actions: BotAction[];
  vars: Record<string, string | number>;
  event: BotEvent;
  /** Run-log trigger label ("wait", "role"). */
  trigger: string;
  /**
   * Waits need the rule still published and the bot enabled. Role reverts
   * (false) are clean-up: they run while the bot exists, even if paused.
   */
  requireLiveRule: boolean;
};

/**
 * Continues a run later (a wait's remaining actions, a temporary role's
 * revert) with the same guards, capabilities, budget and logging as a fresh
 * run. Null when the run was dropped because its bot or rule is gone; else the
 * outcome ("error"/"limited" let the timer runner retry).
 */
export async function resumeBotRun(env: Env, run: ResumedRun): Promise<ResumedOutcome | null> {
  if (!botsEnabled(env)) return null;
  let started = false;
  const record = (status: BotRunStatus, detail: string, notice?: BotRunNotice) =>
    logRun(env.DB, { botId: run.botId, ruleId: run.ruleId, trigger: run.trigger, status, detail, notice });
  try {
    const bot = await getBot(env.DB, run.hubId, run.botId);
    if (!bot || bot.kind !== "builder") return null;
    let publishedBy: string | null = null;
    if (run.requireLiveRule) {
      if (!bot.enabled) return null;
      const entry = (await listPublishedRules(env.DB, run.hubId)).find(
        (candidate) => candidate.botId === run.botId && candidate.ruleId === run.ruleId,
      );
      if (!entry) return null;
      publishedBy = entry.publishedBy;
    } else {
      const row = await env.DB.prepare("SELECT published_by FROM decave_bot_rules WHERE id=? AND bot_id=?")
        .bind(run.ruleId, run.botId)
        .first<{ published_by: string | null }>();
      publishedBy = row?.published_by ?? null;
    }
    // Deterministic: retrying would be refused the same way.
    if (run.event.chainDepth >= BOT_LIMITS.maxChainDepth) {
      const { detail, notice } = coded("bots.run.server.chainTooDeep");
      await record("limited", detail, notice);
      return { status: "limited", detail, notice, startedActions: 0, retryable: false };
    }
    if (!takeBudget(run.hubId, "runs")) {
      const { detail, notice } = coded("bots.run.server.runLimit");
      await record("limited", detail, notice);
      return { status: "limited", detail, notice, startedActions: 0, retryable: true };
    }
    const ctx: ActionContext = {
      env,
      event: run.event,
      bot,
      publishedBy: publishedBy ?? bot.published_by ?? bot.created_by,
      ruleId: run.ruleId,
      vars: { ...run.vars },
      dryRun: false,
      steps: [],
    };
    started = true;
    const outcome = await runActions(ctx, run.actions);
    await record(outcome.status, outcome.detail, outcome.notice);
    if (outcome.status === "error") invalidateHubRules(run.hubId);
    const startedActions = ctx.steps.filter((step) => step.ok).length;
    // Only a transient budget miss on the very first action can be retried:
    // once an action has run, a retry would repeat it.
    return { ...outcome, startedActions, retryable: outcome.status === "limited" && startedActions === 0 };
  } catch (error) {
    const { detail, notice } =
      error instanceof Error ? { detail: error.message, notice: undefined } : coded("bots.run.server.runFailed");
    await record("error", detail, notice).catch(() => undefined);
    invalidateHubRules(run.hubId);
    // A throw before any action ran (e.g. D1 unavailable) is transient.
    return { status: "error", detail, ...(notice ? { notice } : {}), startedActions: 0, retryable: !started };
  }
}
