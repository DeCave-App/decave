// Pure helpers for the bot builder: rule sentences, draft dirtiness, default
// parts built from the catalogue, sample test events and error lookup.
import { CATALOGUE, type BotFieldDescriptor } from "../../../shared/bots/catalogue.ts";
import { BUILT_IN_COMMANDS } from "../../../shared/bots/builtins.ts";
import { capabilitiesForRules, type BotCapabilityName } from "../../../shared/bots/capabilities.ts";
import type { BotRuleContext, BotRuleError } from "../../../shared/bots/schema.ts";
import type { BotAction, BotCondition, BotRule, BotTrigger } from "../../../shared/bots/types.ts";
import { i18next } from "../../i18n/index.ts";
import { weekdayName } from "../shared/dateParts";

/** Hub names by id, for turning ids into readable text. */
export type BotNames = {
  channels: Record<string, string>;
  voice: Record<string, string>;
  roles: Record<string, string>;
  /** Rule labels by rule id ("Rule 2"). */
  rules: Record<string, string>;
};

const t = i18next.t;
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

/** What a picker points at: a text room, voice room, role or rule. */
export type BotRefKind = "room" | "voiceRoom" | "role" | "rule";

/** How a room, role or rule that no longer exists is named in sentences and pickers. */
export const deletedLabel = (what: BotRefKind) => i18next.t(`bots.rule.deleted.${what}`);

function named(map: Record<string, string>, id: string | undefined, prefix: string, what: BotRefKind): string {
  if (!id) return i18next.t(`bots.rule.pick.${what}`);
  const name = map[id];
  return name === undefined ? `${prefix}${deletedLabel(what)}` : `${prefix}${name}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return t("bots.rule.duration.days", { count: minutes / 1440 });
  if (minutes % 60 === 0) return t("bots.rule.duration.hours", { count: minutes / 60 });
  return t("bots.rule.duration.minutes", { count: minutes });
}

export function scheduleText(s: Extract<BotTrigger, { type: "schedule" }>): string {
  if (s.every !== undefined) return t("bots.rule.schedule.every", { duration: formatMinutes(s.every) });
  if (s.daily) return t("bots.rule.schedule.daily", { time: s.daily });
  if (s.weekly) return t("bots.rule.schedule.weekly", { day: weekdayName(s.weekly.day, "short"), time: s.weekly.time });
  if (s.cron) return t("bots.rule.schedule.cron", { cron: s.cron });
  return t("bots.rule.schedule.any");
}

export function triggerText(tr: BotTrigger, n: BotNames): string {
  switch (tr.type) {
    case "command":
      return t("bots.rule.trigger.command", { name: tr.name || "…" });
    case "message":
      return t(`bots.rule.trigger.message.${tr.mode}`, { pattern: tr.pattern });
    case "memberJoin":
      return t("bots.rule.trigger.memberJoin");
    case "memberLeave":
      return t("bots.rule.trigger.memberLeave");
    case "roleAdded":
      return t("bots.rule.trigger.roleAdded", { role: named(n.roles, tr.roleId, "@", "role") });
    case "roleRemoved":
      return t("bots.rule.trigger.roleRemoved", { role: named(n.roles, tr.roleId, "@", "role") });
    case "reactionAdded":
      return t("bots.rule.trigger.reactionAdded", { emoji: tr.emoji });
    case "reactionRemoved":
      return t("bots.rule.trigger.reactionRemoved", { emoji: tr.emoji });
    case "component":
      return t("bots.rule.trigger.component", { id: tr.customId });
    case "formSubmit":
      return t("bots.rule.trigger.formSubmit", { id: tr.formId });
    case "voiceJoin":
      return t("bots.rule.trigger.voiceJoin", {
        room: tr.roomId ? named(n.voice, tr.roomId, "", "voiceRoom") : t("bots.rule.anyVoiceRoom"),
      });
    case "voiceLeave":
      return t("bots.rule.trigger.voiceLeave", {
        room: tr.roomId ? named(n.voice, tr.roomId, "", "voiceRoom") : t("bots.rule.anyVoiceRoom"),
      });
    case "schedule":
      return scheduleText(tr);
    case "hubEventStart":
      return t("bots.rule.trigger.hubEventStart");
    case "streamLive":
      return t("bots.rule.trigger.streamLive");
    case "streamOffline":
      return t("bots.rule.trigger.streamOffline");
  }
}

export function conditionText(c: BotCondition, n: BotNames): string {
  switch (c.type) {
    case "hasRole":
      return t("bots.rule.condition.hasRole", { role: named(n.roles, c.roleId, "@", "role") });
    case "lacksRole":
      return t("bots.rule.condition.lacksRole", { role: named(n.roles, c.roleId, "@", "role") });
    case "channelIs":
      return t("bots.rule.condition.channelIs", { room: named(n.channels, c.channelId, "#", "room") });
    case "channelIsNot":
      return t("bots.rule.condition.channelIsNot", { room: named(n.channels, c.channelId, "#", "room") });
    case "accountAge":
      return t("bots.rule.condition.accountAge", { count: c.minDays });
    case "memberAge":
      return t("bots.rule.condition.memberAge", { count: c.minDays });
    case "variable":
      return `${c.scope} ${c.name || "…"} ${c.op} ${c.value}`;
    case "chance":
      return t("bots.rule.condition.chance", { percent: c.percent });
    case "timeOfDay":
      return t("bots.rule.condition.timeOfDay", { from: c.from, to: c.to });
    case "weekday":
      return c.days.length
        ? t("bots.rule.condition.weekday", { days: c.days.map((d) => weekdayName(d, "short")).join(", ") })
        : t("bots.rule.condition.noDay");
  }
}

function roleAction(
  key: "addRole" | "removeRole" | "toggleRole",
  a: { roleId: string; durationMinutes?: number },
  n: BotNames,
) {
  const role = named(n.roles, a.roleId, "@", "role");
  return a.durationMinutes
    ? t(`bots.rule.action.${key}For`, { role, duration: formatMinutes(a.durationMinutes) })
    : t(`bots.rule.action.${key}`, { role });
}

export function actionText(a: BotAction, n: BotNames): string {
  switch (a.type) {
    case "sendMessage":
      return t("bots.rule.action.sendMessage", {
        text: preview(a.text),
        room: a.channel === "trigger" ? t("bots.rule.sameChannel") : named(n.channels, a.channel, "#", "room"),
      });
    case "reply":
      return t("bots.rule.action.reply", { text: preview(a.text) });
    case "editMessage":
      return t("bots.rule.action.editMessage", { text: preview(a.text) });
    case "pin":
      return t("bots.rule.action.pin");
    case "unpin":
      return t("bots.rule.action.unpin");
    case "deleteTrigger":
      return t("bots.rule.action.deleteTrigger");
    case "react":
      return t("bots.rule.action.react", { emoji: a.emoji });
    case "createThread":
      return t("bots.rule.action.createThread", { name: preview(a.name) });
    case "privateNotice":
      return t("bots.rule.action.privateNotice", { text: preview(a.text) });
    case "addRole":
    case "removeRole":
    case "toggleRole":
      return roleAction(a.type, a, n);
    case "openForm":
      return t("bots.rule.action.openForm", { title: preview(a.title) });
    case "startPoll":
      return t("bots.rule.action.startPoll", { question: preview(a.question) });
    case "createEvent":
      return t("bots.rule.action.createEvent", { title: preview(a.title) });
    case "setVariable":
      return t("bots.rule.action.setVariable", { name: a.name || "…", value: a.value ?? '""' });
    case "addVariable":
      return t("bots.rule.action.addVariable", { name: a.name || "…", value: a.value ?? 1 });
    case "resetVariable":
      return t("bots.rule.action.resetVariable", { name: a.name || "…" });
    case "wait":
      return t("bots.rule.action.wait", { duration: formatMinutes(a.minutes) });
    case "stop":
      return t("bots.rule.action.stop");
    case "runRule":
      return t("bots.rule.action.runRule", {
        rule: a.ruleId ? (n.rules[a.ruleId] ?? deletedLabel("rule")) : t("bots.rule.pick.rule"),
      });
    case "webhook":
      return t("bots.rule.action.webhook", { method: a.method, url: a.url || "…" });
  }
}

/** Joins clauses pairwise with a translated connective ("a and b", "a, then b"). */
function joinWith(items: string[], key: "bots.rule.join.and" | "bots.rule.join.or" | "bots.rule.join.then"): string {
  return items.reduce((left, right) => t(key, { left, right }));
}

/** One-line summary: When … · If … · Do … · Otherwise … */
export function ruleToSentence(rule: BotRule, names: BotNames): string {
  const parts = [t("bots.rule.sentence.when", { trigger: triggerText(rule.trigger, names) })];
  const all = (rule.when?.all ?? []).map((c) => conditionText(c, names));
  const any = (rule.when?.any ?? []).map((c) => conditionText(c, names));
  const allText = all.length ? joinWith(all, "bots.rule.join.and") : "";
  const anyText = any.length ? joinWith(any, "bots.rule.join.or") : "";
  if (allText && anyText) parts.push(t("bots.rule.sentence.ifBoth", { all: allText, any: anyText }));
  else if (allText || anyText) parts.push(t("bots.rule.sentence.if", { conditions: allText || anyText }));
  parts.push(
    rule.then.length
      ? t("bots.rule.sentence.do", {
          actions: joinWith(
            rule.then.map((a) => actionText(a, names)),
            "bots.rule.join.then",
          ),
        })
      : t("bots.rule.sentence.doNothing"),
  );
  if (rule.else?.length)
    parts.push(
      t("bots.rule.sentence.otherwise", {
        actions: joinWith(
          rule.else.map((a) => actionText(a, names)),
          "bots.rule.join.then",
        ),
      }),
    );
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
  get openForm() {
    return {
      formId: "form",
      title: "",
      fields: [{ id: "answer", label: t("bots.rule.defaultFormField"), style: "short", required: true }],
    };
  },
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

export const ruleLabel = (index: number) => t("bots.rule.label", { number: index + 1 });

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
    { name: "user", label: t("bots.variable.user"), sample: "Sam" },
    { name: "channel", label: t("bots.variable.channel"), sample: "general" },
    { name: "date", label: t("bots.variable.date"), sample: new Date().toISOString().slice(0, 10) },
    { name: "random 1-6", label: t("bots.variable.random"), sample: "4" },
  ];
  if (trigger.type === "message")
    vars.push(
      { name: "text", label: t("bots.variable.text"), sample: t("bots.variable.textSample") },
      { name: "match.0", label: t("bots.variable.match"), sample: trigger.pattern || t("bots.variable.matchSample") },
    );
  if (trigger.type === "command")
    for (const option of trigger.options)
      vars.push({
        name: `args.${option.name}`,
        label: `/${trigger.name} ${option.name}`,
        sample: option.type === "number" ? "20" : option.name,
      });
  if (trigger.type === "reactionAdded" || trigger.type === "reactionRemoved")
    vars.push({ name: "emoji", label: t("bots.variable.emoji"), sample: trigger.emoji });
  if (trigger.type === "component") vars.push({ name: "value", label: t("bots.variable.value"), sample: "option" });
  if (trigger.type === "streamLive" || trigger.type === "streamOffline")
    vars.push(
      { name: "stream.title", label: t("bots.variable.streamTitle"), sample: t("bots.variable.streamTitleSample") },
      { name: "stream.game", label: t("bots.variable.streamGame"), sample: "Counter-Strike 2" },
      { name: "stream.url", label: t("bots.variable.streamUrl"), sample: "https://www.example.com/yourname" },
      { name: "streamer", label: t("bots.variable.streamer"), sample: "yourname" },
    );
  return vars;
}

// Capabilities ----------------------------------------------------------------

/** What a bot may do; mirrors HUB_BOT_CAPABILITIES in worker/lib/hub-bots.ts. */
export type BotCapability = BotCapabilityName;

/** Labels are getters, so they read in the current UI language; phrase fits inside a sentence. */
export const CAPABILITY_LABELS: Record<BotCapability, { label: string; description: string; phrase: string }> = {
  send_messages: {
    get label() {
      return t("bots.capability.send_messages.label");
    },
    get description() {
      return t("bots.capability.send_messages.description");
    },
    get phrase() {
      return t("bots.capability.send_messages.phrase");
    },
  },
  create_polls: {
    get label() {
      return t("bots.capability.create_polls.label");
    },
    get description() {
      return t("bots.capability.create_polls.description");
    },
    get phrase() {
      return t("bots.capability.create_polls.phrase");
    },
  },
  create_events: {
    get label() {
      return t("bots.capability.create_events.label");
    },
    get description() {
      return t("bots.capability.create_events.description");
    },
    get phrase() {
      return t("bots.capability.create_events.phrase");
    },
  },
  manage_roles: {
    get label() {
      return t("bots.capability.manage_roles.label");
    },
    get description() {
      return t("bots.capability.manage_roles.description");
    },
    get phrase() {
      return t("bots.capability.manage_roles.phrase");
    },
  },
  manage_messages: {
    get label() {
      return t("bots.capability.manage_messages.label");
    },
    get description() {
      return t("bots.capability.manage_messages.description");
    },
    get phrase() {
      return t("bots.capability.manage_messages.phrase");
    },
  },
  webhooks: {
    get label() {
      return t("bots.capability.webhooks.label");
    },
    get description() {
      return t("bots.capability.webhooks.description");
    },
    get phrase() {
      return t("bots.capability.webhooks.phrase");
    },
  },
};

/** Capabilities the rules use that the bot hasn't been given. */
export function missingCapabilities(rules: BotRule[], granted: readonly string[]): BotCapability[] {
  return capabilitiesForRules(rules).filter((c) => !granted.includes(c));
}
