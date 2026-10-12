// Action registry: each action type registers one handler. Handlers must not
// write anything when ctx.dryRun is set.

import type { BotAction, BotFormField, BotTrigger } from "../../../shared/bots/types";
import type { Env } from "../../lib/env";
import type { HubBotCapability } from "../../lib/hub-bots";
import type { BotRow } from "../store";

export type BotEvent = {
  hubId: number;
  roomId: number | null;
  kind: BotTrigger["type"];
  actorId: string | null;
  actorIsBot: boolean;
  chainDepth: number;
  /** text, messageId, command, args, emoji, roleId, customId, value, formId, fields, eventId, ruleId (schedules) */
  data: Record<string, unknown>;
};

export type DryRunStep = { ruleId: string; action: string; description: string; ok: boolean; reason?: string };

/** What an interaction (slash command, button, select) answers with; filled by actions such as openForm. */
export type BotInteractionResponse = { form?: { formId: string; title: string; fields: BotFormField[] } };

export type ActionContext = {
  env: Env;
  event: BotEvent;
  bot: BotRow;
  publishedBy: string;
  ruleId: string;
  vars: Record<string, string | number>;
  dryRun: boolean;
  steps: DryRunStep[];
  /** Present only when the event is an interaction that can answer (Task 9 passes it). */
  interaction?: BotInteractionResponse;
  /** Set by the engine while an action runs: its index and the actions after it (used by wait). */
  actionIndex?: number;
  remaining?: BotAction[];
};

export type ActionResult =
  | { ok: true; vars?: Record<string, string | number> }
  | { ok: false; reason: string; /** Budget miss: logged as "limited", not a failure. */ limited?: true }
  | { stop: true };

export type ActionHandler = {
  capability: HubBotCapability | null;
  run(ctx: ActionContext, action: BotAction): Promise<ActionResult>;
};

const handlers = new Map<BotAction["type"], ActionHandler>();

export function registerAction(type: BotAction["type"], handler: ActionHandler): void {
  handlers.set(type, handler);
}

export function getAction(type: BotAction["type"]): ActionHandler | undefined {
  return handlers.get(type);
}

/** Runs another published rule of the same bot one chain level deeper (set by the engine). */
export type RuleRunner = (ctx: ActionContext, ruleId: string) => Promise<ActionResult>;

let ruleRunner: RuleRunner | null = null;

export function setRuleRunner(runner: RuleRunner): void {
  ruleRunner = runner;
}

export function getRuleRunner(): RuleRunner | null {
  return ruleRunner;
}
