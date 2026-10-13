// Sends real hub activity into the bot engine: messages and slash commands,
// joins and leaves, role changes, reactions, voice, hub event starts and card
// interactions. Hub rooms and forums only: DMs and group chats never reach
// this module (they are end-to-end encrypted and handled elsewhere).
//
// Dispatch runs in the background (waitUntil when the caller has one) and
// never fails or delays the user's own request.

import type { BotCommandOption, BotRule } from "../../shared/bots/types";
import { storedHubBotCapabilities } from "../lib/hub-bots";
import type { Env } from "../lib/env";
import { noticeEnglish, noticeOf } from "../lib/notices";
import { getAction, type ActionContext, type BotEvent } from "./actions/registry";
import { dispatchBotEvent } from "./engine";
import { botsEnabled } from "./flags";
import { takeBudget } from "./limits";
import { getBot, logRun } from "./store";

type WaitUntil = ((work: Promise<unknown>) => void) | undefined;

const pending = new Set<Promise<unknown>>();
let sink: ((event: BotEvent) => void) | null = null;

/** Tests only: see every queued event (null removes the spy). */
export function setBotEventSpyForTests(next: ((event: BotEvent) => void) | null): void {
  sink = next;
}

/** Tests only: waits for every background dispatch queued so far. */
export async function settleBotEventsForTests(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

/** Runs work in the background: waitUntil when available, else fire-and-forget. Never throws. */
export function inBackground(work: () => Promise<unknown>, waitUntil?: WaitUntil): void {
  const promise = (async () => {
    try {
      await work();
    } catch (error) {
      console.error("bot event dispatch failed", error);
    }
  })();
  pending.add(promise);
  void promise.finally(() => pending.delete(promise));
  if (typeof waitUntil === "function") {
    try {
      waitUntil(promise);
    } catch {
      /* already tracked above */
    }
  }
}

/** Queues one event for the engine (no-op when the builder is off). */
export function queueBotEvent(env: Env, event: BotEvent, waitUntil?: WaitUntil): void {
  if (!botsEnabled(env)) return;
  sink?.(event);
  inBackground(() => dispatchBotEvent(env, event), waitUntil);
}

// Slash commands -------------------------------------------------------------

/** `/name arg "quoted arg"` -> name and raw tokens; null when the text isn't a command. */
export function parseCommandLine(text: string): { name: string; tokens: string[] } | null {
  const match = /^\/([a-z0-9-]{1,32})(?=\s|$)/i.exec(text.trim());
  if (!match) return null;
  const rest = text.trim().slice(match[0].length);
  const tokens: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(rest)) && tokens.length < 50) {
    tokens.push(found[1] !== undefined ? found[1].replace(/\\(.)/g, "$1") : found[2]);
  }
  return { name: match[1].toLowerCase(), tokens };
}

export type CommandLookups = {
  user(ref: string): Promise<string | null>;
  role(ref: string): Promise<string | null>;
  channel(ref: string): Promise<string | null>;
};

export function commandUsage(name: string, options: BotCommandOption[]): string {
  return noticeEnglish("bots.server.commandUsage", { usage: commandSyntax(name, options) });
}

/** "/name <required> [optional]" */
function commandSyntax(name: string, options: BotCommandOption[]): string {
  const parts = options.map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`));
  return `/${[name, ...parts].join(" ")}`;
}

/**
 * Maps tokens to the declared options in order, with type coercion. A trailing
 * text option takes the rest of the line. Fails on a bad value or a missing
 * required option.
 */
export async function bindCommandOptions(
  options: BotCommandOption[],
  tokens: string[],
  lookups: CommandLookups,
): Promise<
  | { ok: true; args: Record<string, string | number> }
  | { ok: false; reason: string; problem: "missing" | "invalid"; option: string }
> {
  const args: Record<string, string | number> = {};
  for (const [index, option] of options.entries()) {
    const last = index === options.length - 1;
    const raw = last && option.type === "text" ? tokens.slice(index).join(" ") : tokens[index];
    if (raw === undefined || raw === "") {
      if (option.required)
        return { ok: false, reason: `Missing ${option.name}`, problem: "missing", option: option.name };
      continue;
    }
    const bad = {
      ok: false as const,
      reason: `Invalid ${option.name}`,
      problem: "invalid" as const,
      option: option.name,
    };
    switch (option.type) {
      case "text":
        args[option.name] = raw.slice(0, 500);
        break;
      case "number": {
        const value = Number(raw);
        if (!/^-?\d+(\.\d+)?$/.test(raw) || !Number.isFinite(value)) return bad;
        args[option.name] = value;
        break;
      }
      case "choice": {
        const choice = (option.choices ?? []).find((c) => c.toLowerCase() === raw.toLowerCase());
        if (choice === undefined) return bad;
        args[option.name] = choice;
        break;
      }
      case "user":
      case "role":
      case "channel": {
        const id = await lookups[option.type](raw);
        if (id === null) return bad;
        args[option.name] = id;
        break;
      }
    }
  }
  return { ok: true, args };
}

function hubLookups(db: D1Database, hubId: number): CommandLookups {
  return {
    async user(ref) {
      const id = /^<@!?([^>&]+)>$/.exec(ref)?.[1];
      const name = id ? null : /^@?([A-Za-z0-9_.-]{1,40})$/.exec(ref)?.[1];
      if (!id && !name) return null;
      const row = await db
        .prepare(
          `SELECT u.id FROM decave_users u JOIN decave_hub_members hm ON hm.user_id=u.id AND hm.hub_id=?
           WHERE u.deleted_at IS NULL AND ${id ? "(u.id=? OR u.public_id=?)" : "u.username=? COLLATE NOCASE"} LIMIT 1`,
        )
        .bind(...(id ? [hubId, id, id] : [hubId, name]))
        .first<{ id: string }>();
      return row?.id ?? null;
    },
    async role(ref) {
      const id = /^<@&([^>]+)>$/.exec(ref)?.[1];
      const name = id ? null : ref.replace(/^@/, "");
      const row = await db
        .prepare(
          `SELECT id FROM decave_custom_roles WHERE hub_id=? AND ${id ? "id=?" : "name=? COLLATE NOCASE"} LIMIT 1`,
        )
        .bind(hubId, id ?? name)
        .first<{ id: string }>();
      return row?.id ?? null;
    },
    async channel(ref) {
      const id = /^<#(\d{1,15})>$/.exec(ref)?.[1];
      const name = id ? null : /^#(.{1,64})$/.exec(ref)?.[1];
      if (!id && !name) return null;
      const row = await db
        .prepare(
          `SELECT id FROM decave_rooms WHERE hub_id=? AND type='text' AND ${id ? "id=?" : "name=? COLLATE NOCASE"} LIMIT 1`,
        )
        .bind(hubId, id ? Number(id) : name)
        .first<{ id: number }>();
      return row ? String(row.id) : null;
    },
  };
}

type CommandMatch = { botId: string; ruleId: string; rule: BotRule; publishedBy: string | null };

async function publishedCommand(db: D1Database, hubId: number, name: string): Promise<CommandMatch | null> {
  const row = await db
    .prepare(
      `SELECT c.bot_id,c.rule_id,r.published_json,r.published_by FROM decave_bot_commands c
       JOIN decave_bot_rules r ON r.id=c.rule_id AND r.bot_id=c.bot_id
       JOIN decave_hub_bots b ON b.id=c.bot_id AND b.hub_id=c.hub_id
       WHERE c.hub_id=? AND c.name=? AND r.published_json IS NOT NULL AND r.enabled=1 AND b.enabled=1 LIMIT 1`,
    )
    .bind(hubId, name)
    .first<{ bot_id: string; rule_id: string; published_json: string; published_by: string | null }>();
  if (!row) return null;
  try {
    const rule = JSON.parse(row.published_json) as BotRule;
    if (rule.trigger.type !== "command") return null;
    return { botId: row.bot_id, ruleId: row.rule_id, rule, publishedBy: row.published_by };
  } catch {
    return null;
  }
}

/** Bad command input: logs a failed run and, when the bot may post here, tells the user how to use it. */
async function refuseCommand(
  env: Env,
  event: BotEvent,
  command: CommandMatch,
  refusal: { reason: string; problem: "missing" | "invalid"; option: string },
  usage: { text: string; syntax: string },
) {
  // A refusal spends the hub's run budget (over budget: dropped silently) and
  // is "skipped", not "error": member typos must never auto-pause a bot.
  if (!takeBudget(event.hubId, "runs")) return;
  await logRun(env.DB, {
    botId: command.botId,
    ruleId: command.ruleId,
    trigger: "command",
    status: "skipped",
    detail: `${refusal.reason}. ${usage.text}`,
    notice: noticeOf(
      refusal.problem === "missing" ? "bots.run.server.commandMissingOption" : "bots.run.server.commandInvalidOption",
      { option: refusal.option, usage: usage.syntax },
    ),
  });
  const bot = await getBot(env.DB, event.hubId, command.botId);
  if (!bot || !bot.enabled || !event.actorId) return;
  if (!storedHubBotCapabilities(bot.capabilities).includes("send_messages")) return;
  const notice = getAction("privateNotice");
  if (!notice) return;
  const ctx: ActionContext = {
    env,
    event,
    bot,
    publishedBy: command.publishedBy ?? bot.published_by ?? bot.created_by,
    ruleId: command.ruleId,
    // Rendered as a template: hide braces so the usage text is shown as written.
    vars: {},
    dryRun: false,
    steps: [],
    systemNotice: noticeOf("bots.server.commandUsage", { usage: usage.syntax.replace(/[{}]/g, "") }),
  };
  await notice.run(ctx, { type: "privateNotice", text: usage.text.replace(/[{}]/g, "") });
}

export type HubMessageInput = {
  hubId: number;
  roomId: number;
  messageId: string;
  text: string;
  actorId: string;
  actorIsBot: boolean;
  chainDepth: number;
};

/**
 * A message saved in a hub room or forum: a published slash command becomes a
 * `command` event, anything else (unknown /commands included) a `message`
 * event. The message itself is saved and shown either way.
 */
export async function dispatchHubMessage(env: Env, input: HubMessageInput): Promise<void> {
  if (!botsEnabled(env)) return;
  const base = {
    hubId: input.hubId,
    roomId: input.roomId,
    actorId: input.actorId,
    actorIsBot: input.actorIsBot,
    chainDepth: input.chainDepth,
  };
  const line = input.actorIsBot ? null : parseCommandLine(input.text);
  const command = line ? await publishedCommand(env.DB, input.hubId, line.name) : null;
  if (line && command && command.rule.trigger.type === "command") {
    const options = command.rule.trigger.options ?? [];
    const event: BotEvent = {
      ...base,
      kind: "command",
      data: { command: line.name, text: input.text, messageId: input.messageId, args: {} },
    };
    const bound = await bindCommandOptions(options, line.tokens, hubLookups(env.DB, input.hubId));
    if (!bound.ok) {
      await refuseCommand(env, event, command, bound, {
        text: commandUsage(line.name, options),
        syntax: commandSyntax(line.name, options),
      });
      return;
    }
    event.data.args = bound.args;
    sink?.(event);
    await dispatchBotEvent(env, event);
    return;
  }
  const event: BotEvent = { ...base, kind: "message", data: { text: input.text, messageId: input.messageId } };
  sink?.(event);
  await dispatchBotEvent(env, event);
}

/** Background form of dispatchHubMessage. */
export function queueHubMessage(env: Env, input: HubMessageInput, waitUntil?: WaitUntil): void {
  if (!botsEnabled(env)) return;
  inBackground(() => dispatchHubMessage(env, input), waitUntil);
}

/** Every room this user is in voice in, across their sockets. */
export function voiceRoomsOf(states: { userId: string | null; voiceChannelId: number | null }[], userId: string) {
  const rooms = new Set<number>();
  for (const state of states)
    if (state.userId === userId && state.voiceChannelId !== null) rooms.add(state.voiceChannelId);
  return rooms;
}
