// Pure helpers for the bot builder: rule sentences, draft dirtiness, default
// parts built from the catalogue, sample test events and error lookup.
import { CATALOGUE, type BotFieldDescriptor } from "../../../shared/bots/catalogue.ts";
import { BUILT_IN_COMMANDS } from "../../../shared/bots/builtins.ts";
import { capabilitiesForRules, type BotCapabilityName } from "../../../shared/bots/capabilities.ts";
import type { BotRuleContext, BotRuleError } from "../../../shared/bots/schema.ts";
import type { BotAction, BotCondition, BotRule, BotTrigger } from "../../../shared/bots/types.ts";

/** Hub names by id, for turning ids into readable text. */
export type BotNames = {
  channels: Record<string, string>;
  voice: Record<string, string>;
  roles: Record<string, string>;
  /** Rule labels by rule id ("Rule 2"). */
  rules: Record<string, string>;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TEXT_PREVIEW = 20;

/** Cuts long message text at a word boundary so the sentence stays one line. */
function preview(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= TEXT_PREVIEW) return `"${clean}"`;
  const words = clean.split(" ");
  let out = "";
  for (const word of words) {
    if ((out ? `${out} ${word}` : word).length > TEXT_PREVIEW) break;
    out = out ? `${out} ${word}` : word;
  }
  return `"${out || clean.slice(0, TEXT_PREVIEW)} …"`;
}

/** How a room, role or rule that no longer exists is named in sentences and pickers. */
export const deletedLabel = (what: string) => `deleted ${what} (pick another)`;

function named(map: Record<string, string>, id: string | undefined, prefix: string, what: string): string {
  if (!id) return `(pick a ${what})`;
  const name = map[id];
  return name === undefined ? `${prefix}${deletedLabel(what)}` : `${prefix}${name}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function scheduleText(t: Extract<BotTrigger, { type: "schedule" }>): string {
  if (t.every !== undefined) return `every ${formatMinutes(t.every)}`;
  if (t.daily) return `every day at ${t.daily}`;
  if (t.weekly) return `every ${DAY_NAMES[t.weekly.day] ?? "?"} at ${t.weekly.time}`;
  if (t.cron) return `on cron "${t.cron}"`;
  return "on a schedule";
}

export function triggerText(t: BotTrigger, n: BotNames): string {
  switch (t.type) {
    case "command":
      return `someone uses /${t.name || "…"}`;
    case "message": {
      const how = { contains: "contains", startsWith: "starts with", exact: "is exactly", regex: "matches" }[t.mode];
      return `a message ${how} "${t.pattern}"`;
    }
    case "memberJoin":
      return "someone joins the Hub";
    case "memberLeave":
      return "someone leaves the Hub";
    case "roleAdded":
      return `someone gets ${named(n.roles, t.roleId, "@", "role")}`;
    case "roleRemoved":
      return `someone loses ${named(n.roles, t.roleId, "@", "role")}`;
    case "reactionAdded":
      return `someone reacts with ${t.emoji}`;
    case "reactionRemoved":
      return `someone removes a ${t.emoji} reaction`;
    case "component":
      return `someone uses button "${t.customId}"`;
    case "formSubmit":
      return `someone submits form "${t.formId}"`;
    case "voiceJoin":
      return `someone joins ${t.roomId ? named(n.voice, t.roomId, "", "voice room") : "any voice room"}`;
    case "voiceLeave":
      return `someone leaves ${t.roomId ? named(n.voice, t.roomId, "", "voice room") : "any voice room"}`;
    case "schedule":
      return scheduleText(t);
    case "hubEventStart":
      return "a Hub event starts";
    case "streamLive":
      return "the stream goes live on Twitch";
    case "streamOffline":
      return "the stream ends on Twitch";
  }
}

export function conditionText(c: BotCondition, n: BotNames): string {
  switch (c.type) {
    case "hasRole":
      return `they have ${named(n.roles, c.roleId, "@", "role")}`;
    case "lacksRole":
      return `they don't have ${named(n.roles, c.roleId, "@", "role")}`;
    case "channelIs":
      return `it's in ${named(n.channels, c.channelId, "#", "room")}`;
    case "channelIsNot":
      return `it's not in ${named(n.channels, c.channelId, "#", "room")}`;
    case "accountAge":
      return `their account is ${c.minDays}+ days old`;
    case "memberAge":
      return `they joined ${c.minDays}+ days ago`;
    case "variable":
      return `${c.scope} ${c.name || "…"} ${c.op} ${c.value}`;
    case "chance":
      return `${c.percent}% chance`;
    case "timeOfDay":
      return `it's between ${c.from} and ${c.to}`;
    case "weekday":
      return `it's ${c.days.map((d) => DAY_NAMES[d] ?? "?").join(", ") || "no day"}`;
  }
}

const forDuration = (minutes: number | undefined) => (minutes ? ` for ${formatMinutes(minutes)}` : "");

export function actionText(a: BotAction, n: BotNames): string {
  switch (a.type) {
    case "sendMessage":
      return `send ${preview(a.text)} in ${a.channel === "trigger" ? "the same channel" : named(n.channels, a.channel, "#", "room")}`;
    case "reply":
      return `reply ${preview(a.text)}`;
    case "editMessage":
      return `edit the message to ${preview(a.text)}`;
    case "pin":
      return "pin the message";
    case "unpin":
      return "unpin the message";
    case "deleteTrigger":
      return "delete the message";
    case "react":
      return `react with ${a.emoji}`;
    case "createThread":
      return `start thread ${preview(a.name)}`;
    case "privateNotice":
      return `privately tell them ${preview(a.text)}`;
    case "addRole":
      return `give ${named(n.roles, a.roleId, "@", "role")}${forDuration(a.durationMinutes)}`;
    case "removeRole":
      return `remove ${named(n.roles, a.roleId, "@", "role")}${forDuration(a.durationMinutes)}`;
    case "toggleRole":
      return `toggle ${named(n.roles, a.roleId, "@", "role")}${forDuration(a.durationMinutes)}`;
    case "openForm":
      return `open form ${preview(a.title)}`;
    case "startPoll":
      return `start poll ${preview(a.question)}`;
    case "createEvent":
      return `create event ${preview(a.title)}`;
    case "setVariable":
      return `set ${a.name || "…"} to ${a.value ?? '""'}`;
    case "addVariable":
      return `add ${a.value ?? 1} to ${a.name || "…"}`;
    case "resetVariable":
      return `reset ${a.name || "…"}`;
    case "wait":
      return `wait ${formatMinutes(a.minutes)}`;
    case "stop":
      return "stop";
    case "runRule":
      return `run ${a.ruleId ? (n.rules[a.ruleId] ?? deletedLabel("rule")) : "(pick a rule)"}`;
    case "webhook":
      return `call ${a.method} ${a.url || "…"}`;
  }
}

/** One-line summary: When … · If … · Do … · Otherwise … */
export function ruleToSentence(rule: BotRule, names: BotNames): string {
  const parts = [`When ${triggerText(rule.trigger, names)}`];
  const all = rule.when?.all ?? [];
  const any = rule.when?.any ?? [];
  const ifs = [
    all.map((c) => conditionText(c, names)).join(" and "),
    any.length ? any.map((c) => conditionText(c, names)).join(" or ") : "",
  ].filter(Boolean);
  if (ifs.length) parts.push(`If ${ifs.join(" and (")}${ifs.length > 1 ? ")" : ""}`);
  parts.push(`Do ${rule.then.map((a) => actionText(a, names)).join(", then ") || "nothing"}`);
  if (rule.else?.length) parts.push(`Otherwise ${rule.else.map((a) => actionText(a, names)).join(", then ")}`);
  return parts.join(" · ");
}

// Dirtiness ---------------------------------------------------------------

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameRule(a: BotRule | null | undefined, b: BotRule | null | undefined): boolean {
  return stable(a ?? null) === stable(b ?? null);
}

/** True when a rule's saved draft differs from what is live. */
export function isRuleDirty(rule: { draft: BotRule; published: BotRule | null }): boolean {
  return !sameRule(rule.draft, rule.published);
}

// Defaults from the catalogue ---------------------------------------------

const TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

function defaultValue(field: BotFieldDescriptor): unknown {
  switch (field.kind) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "choice":
      return field.multiple ? [] : field.choices?.[0];
    case "duration":
      return 60;
    case "template":
      return field.multiple ? ["", ""] : "";
    case "options":
    case "form":
      return [];
    default:
      return "";
  }
}

function fromFields(type: string, fields: BotFieldDescriptor[]): Record<string, unknown> {
  const out: Record<string, unknown> = { type };
  for (const field of fields) if (field.required && field.kind !== "schedule") out[field.key] = defaultValue(field);
  return out;
}

const TRIGGER_DEFAULTS: Partial<Record<BotTrigger["type"], Record<string, unknown>>> = {
  schedule: { every: 60, timezone: TIMEZONE },
  reactionAdded: { emoji: "✅" },
  reactionRemoved: { emoji: "✅" },
};
const CONDITION_DEFAULTS: Partial<Record<BotCondition["type"], Record<string, unknown>>> = {
  chance: { percent: 50 },
  timeOfDay: { from: "09:00", to: "17:00", timezone: TIMEZONE },
  weekday: { days: [1, 2, 3, 4, 5] },
  accountAge: { minDays: 7 },
  memberAge: { minDays: 7 },
};
const ACTION_DEFAULTS: Partial<Record<BotAction["type"], Record<string, unknown>>> = {
  sendMessage: { channel: "trigger" },
  react: { emoji: "👍" },
  wait: { minutes: 5 },
  webhook: { method: "POST" },
  openForm: { formId: "form", title: "", fields: [{ id: "answer", label: "Answer", style: "short", required: true }] },
};

export function defaultTrigger<T extends BotTrigger["type"]>(type: T): Extract<BotTrigger, { type: T }> {
  return {
    ...fromFields(type, CATALOGUE.triggers[type].fields),
    ...TRIGGER_DEFAULTS[type],
  } as Extract<BotTrigger, { type: T }>;
}

export function defaultCondition<T extends BotCondition["type"]>(type: T): Extract<BotCondition, { type: T }> {
  return {
    ...fromFields(type, CATALOGUE.conditions[type].fields),
    ...CONDITION_DEFAULTS[type],
  } as Extract<BotCondition, { type: T }>;
}

export function defaultAction<T extends BotAction["type"]>(type: T): Extract<BotAction, { type: T }> {
  return {
    ...fromFields(type, CATALOGUE.actions[type].fields),
    ...ACTION_DEFAULTS[type],
  } as Extract<BotAction, { type: T }>;
}

export function newRule(triggerType: BotTrigger["type"] = "command"): BotRule {
  return {
    v: 1,
    trigger: defaultTrigger(triggerType),
    scope: { channels: ["*"], roles: [] },
    cooldown: { perUser: 0, perChannel: 0 },
    then: [defaultAction("sendMessage")],
  };
}

// Test runs ---------------------------------------------------------------

export type SampleEvent = { kind: BotTrigger["type"]; data: Record<string, unknown> };

/** A sample event that fires the trigger, for the Test tab to start from. */
export function sampleEvent(trigger: BotTrigger): SampleEvent {
  switch (trigger.type) {
    case "command":
      return {
        kind: "command",
        data: { command: trigger.name, args: Object.fromEntries(trigger.options.map((o) => [o.name, ""])) },
      };
    case "message":
      return { kind: "message", data: { text: trigger.mode === "regex" ? "" : trigger.pattern } };
    case "roleAdded":
    case "roleRemoved":
      return { kind: trigger.type, data: { roleId: trigger.roleId } };
    case "reactionAdded":
    case "reactionRemoved":
      return {
        kind: trigger.type,
        data: trigger.messageId ? { emoji: trigger.emoji, messageId: trigger.messageId } : { emoji: trigger.emoji },
      };
    case "component":
      return { kind: "component", data: { customId: trigger.customId, value: "" } };
    case "formSubmit":
      return { kind: "formSubmit", data: { formId: trigger.formId, fields: {} } };
    default:
      return { kind: trigger.type, data: {} };
  }
}

// Errors ------------------------------------------------------------------

/** Errors at or under a path such as "then[0]" or "trigger". */
export function errorsFor(errors: BotRuleError[], base: string): BotRuleError[] {
  return errors.filter((e) => e.path === base || e.path.startsWith(`${base}.`) || e.path.startsWith(`${base}[`));
}

/** The first error for one field of a part ("then[1]", "roleId"). */
export function fieldError(errors: BotRuleError[], base: string, key: string): string | undefined {
  const path = base ? `${base}.${key}` : key;
  return errors.find((e) => e.path === path || e.path.startsWith(`${path}.`) || e.path.startsWith(`${path}[`))?.message;
}

// Hub lookups ---------------------------------------------------------------

export type HubRef = { id: string; name: string };
/** The Hub parts a rule can point at. Text rooms match what the server accepts (type "text"). */
export type BotHub = { textRooms: HubRef[]; voiceRooms: HubRef[]; roles: HubRef[] };

export const ruleLabel = (index: number) => `Rule ${index + 1}`;

export function namesFor(hub: BotHub, ruleIds: string[]): BotNames {
  const byId = (list: HubRef[]) => Object.fromEntries(list.map((item) => [item.id, item.name]));
  return {
    channels: byId(hub.textRooms),
    voice: byId(hub.voiceRooms),
    roles: byId(hub.roles),
    rules: Object.fromEntries(ruleIds.map((id, i) => [id, ruleLabel(i)])),
  };
}

/** Same checks as a server save, so errors show next to fields before the round trip. */
export function ruleContextFor(hub: BotHub, ruleIds: string[]): BotRuleContext {
  return {
    channelIds: new Set(hub.textRooms.map((r) => r.id)),
    voiceRoomIds: new Set(hub.voiceRooms.map((r) => r.id)),
    roleIds: new Set(hub.roles.map((r) => r.id)),
    ruleIds: new Set(ruleIds),
    builtInCommands: new Set(BUILT_IN_COMMANDS),
  };
}

/** Template variables a rule can use, with a sample value for the live preview. */
export function variablesFor(trigger: BotTrigger): { name: string; label: string; sample: string }[] {
  const vars = [
    { name: "user", label: "Member", sample: "Sam" },
    { name: "channel", label: "Room", sample: "general" },
    { name: "date", label: "Today's date", sample: new Date().toISOString().slice(0, 10) },
    { name: "random 1-6", label: "Random number", sample: "4" },
  ];
  if (trigger.type === "message")
    vars.push(
      { name: "text", label: "Message text", sample: "hello there" },
      { name: "match.0", label: "Matched part", sample: trigger.pattern || "hello" },
    );
  if (trigger.type === "command")
    for (const option of trigger.options)
      vars.push({
        name: `args.${option.name}`,
        label: `/${trigger.name} ${option.name}`,
        sample: option.type === "number" ? "20" : option.name,
      });
  if (trigger.type === "reactionAdded" || trigger.type === "reactionRemoved")
    vars.push({ name: "emoji", label: "Emoji", sample: trigger.emoji });
  if (trigger.type === "component") vars.push({ name: "value", label: "Picked value", sample: "option" });
  if (trigger.type === "streamLive" || trigger.type === "streamOffline")
    vars.push(
      { name: "stream.title", label: "Stream title", sample: "Ranked grind tonight" },
      { name: "stream.game", label: "Game", sample: "Counter-Strike 2" },
      { name: "stream.url", label: "Stream link", sample: "https://www.example.com/yourname" },
      { name: "streamer", label: "Twitch channel", sample: "yourname" },
    );
  return vars;
}

// Capabilities ----------------------------------------------------------------

/** What a bot may do; mirrors HUB_BOT_CAPABILITIES in worker/lib/hub-bots.ts. */
export type BotCapability = BotCapabilityName;

export const CAPABILITY_LABELS: Record<BotCapability, { label: string; description: string }> = {
  send_messages: { label: "Send messages", description: "Messages, replies, reactions, threads and private notices." },
  create_polls: { label: "Create polls", description: "The Start poll action." },
  create_events: { label: "Create events", description: "The Create Hub event action." },
  manage_roles: { label: "Manage roles", description: "Give, remove and toggle roles." },
  manage_messages: { label: "Manage messages", description: "Pin, unpin and delete messages." },
  webhooks: { label: "Call webhooks", description: "Send requests to HTTPS URLs." },
};

/** Capabilities the rules use that the bot hasn't been given. */
export function missingCapabilities(rules: BotRule[], granted: readonly string[]): BotCapability[] {
  return capabilitiesForRules(rules).filter((c) => !granted.includes(c));
}
