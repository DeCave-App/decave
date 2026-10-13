// "Describe it": turns an admin's plain-language description into draft bot
// rules with the Anthropic API. Only the description, the rule catalogue and the
// hub's room/role names and ids (plus the rule being edited) leave DeCave: no
// usernames, member lists or message text. 5 generations per hub per UTC day,
// counted once the provider has been called.

import { BOT_LIMITS, type BotRule } from "../../shared/bots/types";
import { validateRule } from "../../shared/bots/schema";
import { BUILT_IN_COMMANDS } from "../../shared/bots/builtins";
import { ACTION_TYPES, CATALOGUE, CONDITION_TYPES, TRIGGER_TYPES } from "../../shared/bots/catalogue";
import type { Env } from "../lib/env";
import { errorFields, type ErrorFields } from "../lib/http";
import { releaseAiUsage, reserveAiUsage } from "./store";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 20_000;
export const DESCRIPTION_MAX = 1000;

type Named = { id: string; name: string };

export type GenerateInput = {
  hubId: number;
  description: string;
  channels: Named[];
  voiceRooms: Named[];
  roles: Named[];
  existing?: BotRule;
  /** Rule ids a generated runRule action may point at. */
  ruleIds?: string[];
};

export type GenerateResult =
  | { ok: true; rules: BotRule[]; unsupported: string[]; remainingToday: number }
  | ({ ok: false; status: 422 | 429 | 502 } & ErrorFields);

export const utcDay = (at = new Date()) => at.toISOString().slice(0, 10);

const typed = (types: string[]) => ({
  type: "object",
  properties: { type: { type: "string", enum: types } },
  required: ["type"],
  additionalProperties: true,
});

/** The build_rules tool schema: rule shape with every type limited to the catalogue. */
export function buildRulesSchema() {
  const actions = { type: "array", items: typed(ACTION_TYPES), maxItems: BOT_LIMITS.actionsPerRule };
  const conditions = { type: "array", items: typed(CONDITION_TYPES), maxItems: 20 };
  const ids = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    properties: {
      rules: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            v: { type: "integer", enum: [1] },
            trigger: typed(TRIGGER_TYPES),
            scope: {
              type: "object",
              properties: { channels: ids, roles: ids },
              required: ["channels", "roles"],
              additionalProperties: false,
            },
            cooldown: {
              type: "object",
              properties: {
                perUser: { type: "integer", minimum: 0, maximum: 86400 },
                perChannel: { type: "integer", minimum: 0, maximum: 86400 },
              },
              required: ["perUser", "perChannel"],
              additionalProperties: false,
            },
            when: {
              type: "object",
              properties: { all: conditions, any: conditions },
              additionalProperties: false,
            },
            then: actions,
            else: actions,
            allowBotTriggers: { type: "boolean" },
          },
          required: ["v", "trigger", "scope", "cooldown", "then"],
          additionalProperties: false,
        },
      },
      unsupported: { type: "array", items: { type: "string" } },
    },
    required: ["rules", "unsupported"],
    additionalProperties: false,
  };
}

const SYSTEM_PROMPT = [
  "You build automation rules for a DeCave hub bot (a chat community like a Discord server).",
  "Call build_rules once with the rules that do what the admin describes.",
  "Use only the trigger, condition and action types in the catalogue below, with exactly the fields listed",
  "(keys in each entry's fields; flat on the trigger/condition/action object, except the schedule field which",
  "stands for the trigger's every/daily/weekly/cron and timezone fields).",
  'Use only the channel, voice room and role ids given in the request; scope.channels ["*"] means every room.',
  "Cooldowns are in seconds. Message text may use placeholders such as {user}, {user.mention}, {channel}, {args.name}.",
  "Anything the admin asks for that the catalogue cannot do goes in unsupported as a short plain sentence;",
  "never invent types, fields or ids. If editing, the request includes existingRule: return the edited rule.",
  `Bots act only in hub rooms and forums, never in direct messages. At most ${BOT_LIMITS.actionsPerRule} actions per rule,`,
  `schedules at least ${BOT_LIMITS.minScheduleMinutes} minutes apart, waits at most ${BOT_LIMITS.maxWaitMinutes} minutes.`,
  "",
  "Catalogue:",
].join("\n");

export function systemPrompt(): string {
  return `${SYSTEM_PROMPT}\n${JSON.stringify(CATALOGUE)}`;
}

/** The exact request body sent to Anthropic. */
export function anthropicRequest(input: GenerateInput) {
  const payload: Record<string, unknown> = {
    description: input.description,
    channels: input.channels.map(({ id, name }) => ({ id, name })),
    voiceRooms: input.voiceRooms.map(({ id, name }) => ({ id, name })),
    roles: input.roles.map(({ id, name }) => ({ id, name })),
  };
  if (input.existing) payload.existingRule = input.existing;
  return {
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt(),
    tools: [
      {
        name: "build_rules",
        description: "Return the bot rules built from the description, and what could not be built.",
        input_schema: buildRulesSchema(),
      },
    ],
    tool_choice: { type: "tool", name: "build_rules" },
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  };
}

const failed = (): GenerateResult => ({ ok: false, status: 422, ...errorFields("botAi.failed") });

export async function generateRules(
  env: Env,
  input: GenerateInput,
  fetchImpl: typeof fetch = fetch,
): Promise<GenerateResult> {
  const day = utcDay();
  // Reserve the slot before calling so two requests can't both take the last one.
  const used = await reserveAiUsage(env.DB, input.hubId, day, BOT_LIMITS.aiPerDay);
  if (used === null)
    return { ok: false, status: 429, ...errorFields("botAi.dailyLimit", { limit: BOT_LIMITS.aiPerDay }) };

  const remainingToday = Math.max(0, BOT_LIMITS.aiPerDay - used);
  let requestBody: string;
  try {
    requestBody = JSON.stringify(anthropicRequest(input));
  } catch (error) {
    // Never reached the provider: the generation doesn't count.
    await releaseAiUsage(env.DB, input.hubId, day);
    throw error;
  }
  // From here the provider is called (or times out mid-call): the generation counts.
  let response: Response | null = null;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: requestBody,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("bot ai request failed", error instanceof Error ? error.name : "error");
  }
  if (!response || !response.ok) {
    if (response) console.error("bot ai provider error", response.status);
    return { ok: false, status: 502, ...errorFields("botAi.unavailable") };
  }

  let output: unknown;
  try {
    const body = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    output = body.content?.find((block) => block.type === "tool_use" && block.name === "build_rules")?.input;
  } catch {
    output = undefined;
  }
  const { rules, unsupported } = (output ?? {}) as { rules?: unknown; unsupported?: unknown };
  const notes = Array.isArray(unsupported)
    ? unsupported
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.slice(0, 300))
        .slice(0, 20)
    : [];
  // No rules is a valid answer when the model explains what it couldn't do.
  if (!Array.isArray(rules) || rules.length > BOT_LIMITS.rulesPerBot || (rules.length === 0 && !notes.length))
    return failed();

  const ctx = {
    channelIds: new Set(input.channels.map((c) => c.id)),
    voiceRoomIds: new Set(input.voiceRooms.map((c) => c.id)),
    roleIds: new Set(input.roles.map((r) => r.id)),
    ruleIds: new Set(input.ruleIds ?? []),
    builtInCommands: new Set(BUILT_IN_COMMANDS),
  };
  const valid: BotRule[] = [];
  for (const rule of rules) {
    const checked = validateRule(rule, ctx);
    if (!checked.ok) return failed();
    valid.push(checked.rule);
  }
  return { ok: true, rules: valid, unsupported: notes, remainingToday };
}
