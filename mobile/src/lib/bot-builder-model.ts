// The bot builder's pure helpers on mobile: rule sentences, default parts from
// the shared catalogue, test events, error lookup and capability labels. A port
// of web's src/features/bots/model.ts (and catalogueText.ts / ruleErrors.ts)
// using the same bots.* translation keys, so both apps read the same.

import i18next, { t } from "i18next";
import { CATALOGUE, type BotCatalogueEntry, type BotFieldDescriptor } from "../../../shared/bots/catalogue";
import { BUILT_IN_COMMANDS } from "../../../shared/bots/builtins";
import { capabilitiesForRules, type BotCapabilityName } from "../../../shared/bots/capabilities";
import type { BotRuleContext, BotRuleError } from "../../../shared/bots/schema";
import type { BotAction, BotCondition, BotRule, BotTrigger } from "../../../shared/bots/types";

export type BotNames = {
  channels: Record<string, string>;
  voice: Record<string, string>;
  roles: Record<string, string>;
  rules: Record<string, string>;
};

export type HubRef = { id: string; name: string };
/** The Hub parts a rule can point at. Text rooms match what the server accepts (type "text"). */
export type BotHub = { textRooms: HubRef[]; voiceRooms: HubRef[]; roles: HubRef[] };
export type BotRefKind = "room" | "voiceRoom" | "role" | "rule";
export type CatalogueKind = keyof typeof CATALOGUE;
export type BotPart = { type: string } & Record<string, unknown>;

const tr = (key: string, params?: Record<string, unknown>) =>
  (t as unknown as (key: string, params?: Record<string, unknown>) => string)(key, params);

export function weekdayName(day: number, width: "short" | "long"): string {
  if (!Number.isInteger(day) || day < 0 || day > 6) return "?";
  try {
    // 1 January 2023 was a Sunday.
    return new Date(Date.UTC(2023, 0, 1 + day)).toLocaleDateString(i18next.language || undefined, { weekday: width, timeZone: "UTC" });
  } catch {
    return String(day);
  }
}

// Catalogue names in the UI language (English when a key is missing) -------

function lookup(key: string, english: string): string {
  return i18next.exists(key) ? tr(key) : english;
}
const base = (kind: CatalogueKind, type: string) => `bots.catalogue.${kind}.${type}`;
export const entryLabel = (kind: CatalogueKind, type: string, entry: BotCatalogueEntry) => lookup(`${base(kind, type)}.label`, entry.label);
export const entryDescription = (kind: CatalogueKind, type: string, entry: BotCatalogueEntry) =>
  lookup(`${base(kind, type)}.description`, entry.description);
export const fieldLabel = (kind: CatalogueKind, type: string, field: BotFieldDescriptor) =>
  lookup(`${base(kind, type)}.fields.${field.key}.label`, field.label);
export const fieldHint = (kind: CatalogueKind, type: string, field: BotFieldDescriptor) =>
  lookup(`${base(kind, type)}.fields.${field.key}.hint`, (field.hint ?? "").replace(/ Stored as.*$/, ""));

/** Rule validation errors carry a bots.validation.* code next to the English message. */
export function translateRuleErrors<T extends BotRuleError>(errors: T[]): T[] {
  return errors.map((error) =>
    typeof error.code === "string" && error.code.startsWith("bots.validation.") && i18next.exists(error.code)
      ? { ...error, message: tr(error.code, error.params) }
      : error,
  );
}

// Sentences -----------------------------------------------------------------

const TEXT_PREVIEW = 20;

function preview(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= TEXT_PREVIEW) return `"${clean}"`;
  let out = "";
  for (const word of clean.split(" ")) {
    if ((out ? `${out} ${word}` : word).length > TEXT_PREVIEW) break;
    out = out ? `${out} ${word}` : word;
  }
  return `"${out || clean.slice(0, TEXT_PREVIEW)} …"`;
}

export const deletedLabel = (what: BotRefKind) => tr(`bots.rule.deleted.${what}`);

function named(map: Record<string, string>, id: string | undefined, prefix: string, what: BotRefKind): string {
  if (!id) return tr(`bots.rule.pick.${what}`);
  const name = map[id];
  return name === undefined ? `${prefix}${deletedLabel(what)}` : `${prefix}${name}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return tr("bots.rule.duration.days", { count: minutes / 1440 });
  if (minutes % 60 === 0) return tr("bots.rule.duration.hours", { count: minutes / 60 });
  return tr("bots.rule.duration.minutes", { count: minutes });
}

export function scheduleText(s: Extract<BotTrigger, { type: "schedule" }>): string {
  if (s.every !== undefined) return tr("bots.rule.schedule.every", { duration: formatMinutes(s.every) });
  if (s.daily) return tr("bots.rule.schedule.daily", { time: s.daily });
  if (s.weekly) return tr("bots.rule.schedule.weekly", { day: weekdayName(s.weekly.day, "short"), time: s.weekly.time });
  if (s.cron) return tr("bots.rule.schedule.cron", { cron: s.cron });
  return tr("bots.rule.schedule.any");
}

export function triggerText(trig: BotTrigger, n: BotNames): string {
  switch (trig.type) {
    case "command":
      return tr("bots.rule.trigger.command", { name: trig.name || "…" });
    case "message":
      return tr(`bots.rule.trigger.message.${trig.mode}`, { pattern: trig.pattern });
    case "roleAdded":
    case "roleRemoved":
      return tr(`bots.rule.trigger.${trig.type}`, { role: named(n.roles, trig.roleId, "@", "role") });
    case "reactionAdded":
    case "reactionRemoved":
      return tr(`bots.rule.trigger.${trig.type}`, { emoji: trig.emoji });
    case "component":
      return tr("bots.rule.trigger.component", { id: trig.customId });
    case "formSubmit":
      return tr("bots.rule.trigger.formSubmit", { id: trig.formId });
    case "voiceJoin":
    case "voiceLeave":
      return tr(`bots.rule.trigger.${trig.type}`, {
        room: trig.roomId ? named(n.voice, trig.roomId, "", "voiceRoom") : tr("bots.rule.anyVoiceRoom"),
      });
    case "schedule":
      return scheduleText(trig);
    default:
      return tr(`bots.rule.trigger.${trig.type}`);
  }
}

export function conditionText(c: BotCondition, n: BotNames): string {
  switch (c.type) {
    case "hasRole":
    case "lacksRole":
      return tr(`bots.rule.condition.${c.type}`, { role: named(n.roles, c.roleId, "@", "role") });
    case "channelIs":
    case "channelIsNot":
      return tr(`bots.rule.condition.${c.type}`, { room: named(n.channels, c.channelId, "#", "room") });
    case "accountAge":
    case "memberAge":
      return tr(`bots.rule.condition.${c.type}`, { count: c.minDays });
    case "variable":
      return `${c.scope} ${c.name || "…"} ${c.op} ${c.value}`;
    case "chance":
      return tr("bots.rule.condition.chance", { percent: c.percent });
    case "timeOfDay":
      return tr("bots.rule.condition.timeOfDay", { from: c.from, to: c.to });
    case "weekday":
      return c.days.length
        ? tr("bots.rule.condition.weekday", { days: c.days.map((d) => weekdayName(d, "short")).join(", ") })
        : tr("bots.rule.condition.noDay");
  }
}

export function actionText(a: BotAction, n: BotNames): string {
  switch (a.type) {
    case "sendMessage":
      return tr("bots.rule.action.sendMessage", {
        text: preview(a.text),
        room: a.channel === "trigger" ? tr("bots.rule.sameChannel") : named(n.channels, a.channel, "#", "room"),
      });
    case "reply":
    case "editMessage":
    case "privateNotice":
      return tr(`bots.rule.action.${a.type}`, { text: preview(a.text) });
    case "react":
      return tr("bots.rule.action.react", { emoji: a.emoji });
    case "createThread":
      return tr("bots.rule.action.createThread", { name: preview(a.name) });
    case "addRole":
    case "removeRole":
    case "toggleRole": {
      const role = named(n.roles, a.roleId, "@", "role");
      return a.durationMinutes
        ? tr(`bots.rule.action.${a.type}For`, { role, duration: formatMinutes(a.durationMinutes) })
        : tr(`bots.rule.action.${a.type}`, { role });
    }
    case "openForm":
      return tr("bots.rule.action.openForm", { title: preview(a.title) });
    case "startPoll":
      return tr("bots.rule.action.startPoll", { question: preview(a.question) });
    case "createEvent":
      return tr("bots.rule.action.createEvent", { title: preview(a.title) });
    case "setVariable":
      return tr("bots.rule.action.setVariable", { name: a.name || "…", value: a.value ?? '""' });
    case "addVariable":
      return tr("bots.rule.action.addVariable", { name: a.name || "…", value: a.value ?? 1 });
    case "resetVariable":
      return tr("bots.rule.action.resetVariable", { name: a.name || "…" });
    case "wait":
      return tr("bots.rule.action.wait", { duration: formatMinutes(a.minutes) });
    case "runRule":
      return tr("bots.rule.action.runRule", {
        rule: a.ruleId ? (n.rules[a.ruleId] ?? deletedLabel("rule")) : tr("bots.rule.pick.rule"),
      });
    case "webhook":
      return tr("bots.rule.action.webhook", { method: a.method, url: a.url || "…" });
    default:
      return tr(`bots.rule.action.${a.type}`);
  }
}

function joinWith(items: string[], key: "bots.rule.join.and" | "bots.rule.join.or" | "bots.rule.join.then"): string {
  return items.reduce((left, right) => tr(key, { left, right }));
}

/** One-line summary: When … · If … · Do … · Otherwise … */
export function ruleToSentence(rule: BotRule, names: BotNames): string {
  const parts = [tr("bots.rule.sentence.when", { trigger: triggerText(rule.trigger, names) })];
  const all = (rule.when?.all ?? []).map((c) => conditionText(c, names));
  const any = (rule.when?.any ?? []).map((c) => conditionText(c, names));
  const allText = all.length ? joinWith(all, "bots.rule.join.and") : "";
  const anyText = any.length ? joinWith(any, "bots.rule.join.or") : "";
  if (allText && anyText) parts.push(tr("bots.rule.sentence.ifBoth", { all: allText, any: anyText }));
  else if (allText || anyText) parts.push(tr("bots.rule.sentence.if", { conditions: allText || anyText }));
  parts.push(
    rule.then.length
      ? tr("bots.rule.sentence.do", { actions: joinWith(rule.then.map((a) => actionText(a, names)), "bots.rule.join.then") })
      : tr("bots.rule.sentence.doNothing"),
  );
  if (rule.else?.length)
    parts.push(tr("bots.rule.sentence.otherwise", { actions: joinWith(rule.else.map((a) => actionText(a, names)), "bots.rule.join.then") }));
  return parts.join(" · ");
}

// Dirtiness -----------------------------------------------------------------

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

// Defaults from the catalogue -------------------------------------------------

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

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

const TRIGGER_DEFAULTS = (): Partial<Record<BotTrigger["type"], Record<string, unknown>>> => ({
  schedule: { every: 60, timezone: viewerTimeZone() },
  reactionAdded: { emoji: "✅" },
  reactionRemoved: { emoji: "✅" },
});
const CONDITION_DEFAULTS = (): Partial<Record<BotCondition["type"], Record<string, unknown>>> => ({
  chance: { percent: 50 },
  timeOfDay: { from: "09:00", to: "17:00", timezone: viewerTimeZone() },
  weekday: { days: [1, 2, 3, 4, 5] },
  accountAge: { minDays: 7 },
  memberAge: { minDays: 7 },
});
const ACTION_DEFAULTS = (): Partial<Record<BotAction["type"], Record<string, unknown>>> => ({
  sendMessage: { channel: "trigger" },
  react: { emoji: "👍" },
  wait: { minutes: 5 },
  webhook: { method: "POST" },
  openForm: { formId: "form", title: "", fields: [{ id: "answer", label: tr("bots.rule.defaultFormField"), style: "short", required: true }] },
});

export function defaultPart(kind: CatalogueKind, type: string): BotPart {
  const catalogue = CATALOGUE[kind] as Record<string, BotCatalogueEntry>;
  const extra =
    kind === "triggers"
      ? TRIGGER_DEFAULTS()[type as BotTrigger["type"]]
      : kind === "conditions"
        ? CONDITION_DEFAULTS()[type as BotCondition["type"]]
        : ACTION_DEFAULTS()[type as BotAction["type"]];
  return { ...fromFields(type, catalogue[type]?.fields ?? []), ...extra } as BotPart;
}

export function newRule(triggerType: BotTrigger["type"] = "command"): BotRule {
  return {
    v: 1,
    trigger: defaultPart("triggers", triggerType) as unknown as BotTrigger,
    scope: { channels: ["*"], roles: [] },
    cooldown: { perUser: 0, perChannel: 0 },
    then: [defaultPart("actions", "sendMessage") as unknown as BotAction],
  };
}

// Test runs -------------------------------------------------------------------

export type SampleEvent = { kind: BotTrigger["type"]; data: Record<string, unknown> };

/** A sample event that fires the trigger, for the Test tab to start from. */
export function sampleEvent(trigger: BotTrigger): SampleEvent {
  switch (trigger.type) {
    case "command":
      return { kind: "command", data: { command: trigger.name, args: Object.fromEntries(trigger.options.map((o) => [o.name, ""])) } };
    case "message":
      return { kind: "message", data: { text: trigger.mode === "regex" ? "" : trigger.pattern } };
    case "roleAdded":
    case "roleRemoved":
      return { kind: trigger.type, data: { roleId: trigger.roleId } };
    case "reactionAdded":
    case "reactionRemoved":
      return { kind: trigger.type, data: trigger.messageId ? { emoji: trigger.emoji, messageId: trigger.messageId } : { emoji: trigger.emoji } };
    case "component":
      return { kind: "component", data: { customId: trigger.customId, value: "" } };
    case "formSubmit":
      return { kind: "formSubmit", data: { formId: trigger.formId, fields: {} } };
    default:
      return { kind: trigger.type, data: {} };
  }
}

// Errors ----------------------------------------------------------------------

/** The first error for one field of a part ("then[1]", "roleId"). */
export function fieldError(errors: BotRuleError[], path: string, key: string): string | undefined {
  const full = path ? `${path}.${key}` : key;
  return errors.find((e) => e.path === full || e.path.startsWith(`${full}.`) || e.path.startsWith(`${full}[`))?.message;
}

// Hub lookups -------------------------------------------------------------------

export const ruleLabel = (index: number) => tr("bots.rule.label", { number: index + 1 });

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

export type BotVariable = { name: string; label: string; sample: string };

/** Template variables a rule can use, with a sample value for the preview. */
export function variablesFor(trigger: BotTrigger): BotVariable[] {
  const vars: BotVariable[] = [
    { name: "user", label: tr("bots.variable.user"), sample: "Sam" },
    { name: "channel", label: tr("bots.variable.channel"), sample: "general" },
    { name: "date", label: tr("bots.variable.date"), sample: new Date().toISOString().slice(0, 10) },
    { name: "random 1-6", label: tr("bots.variable.random"), sample: "4" },
  ];
  if (trigger.type === "message")
    vars.push(
      { name: "text", label: tr("bots.variable.text"), sample: tr("bots.variable.textSample") },
      { name: "match.0", label: tr("bots.variable.match"), sample: trigger.pattern || tr("bots.variable.matchSample") },
    );
  if (trigger.type === "command")
    for (const option of trigger.options)
      vars.push({ name: `args.${option.name}`, label: `/${trigger.name} ${option.name}`, sample: option.type === "number" ? "20" : option.name });
  if (trigger.type === "reactionAdded" || trigger.type === "reactionRemoved")
    vars.push({ name: "emoji", label: tr("bots.variable.emoji"), sample: trigger.emoji });
  if (trigger.type === "component") vars.push({ name: "value", label: tr("bots.variable.value"), sample: "option" });
  if (trigger.type === "streamLive" || trigger.type === "streamOffline")
    vars.push(
      { name: "stream.title", label: tr("bots.variable.streamTitle"), sample: tr("bots.variable.streamTitleSample") },
      { name: "stream.game", label: tr("bots.variable.streamGame"), sample: "Counter-Strike 2" },
      { name: "stream.url", label: tr("bots.variable.streamUrl"), sample: "https://www.example.com/yourname" },
      { name: "streamer", label: tr("bots.variable.streamer"), sample: "yourname" },
    );
  return vars;
}

/**
 * A light stand-in for the server renderer (shared/bots/render.ts needs ES2022),
 * like web's: innermost {…} first, random ranges and choices show their first
 * value, upper/lower/default filters apply, unknown names render empty.
 */
export function previewTemplate(text: string, variables: BotVariable[]): string {
  const vars = new Map(variables.map((v) => [v.name, v.sample]));
  let out = text;
  for (let pass = 0; pass < 10 && /\{[^{}]*\}/.test(out); pass++)
    out = out.replace(/\{([^{}]*)\}/g, (_match, raw: string) => {
      const expr = raw.trim();
      const range = /^random\s+(-?\d+)\s*-\s*(-?\d+)$/.exec(expr);
      if (range) return range[1];
      if (expr.startsWith("random:")) return expr.slice("random:".length).split("|")[0];
      const [name, ...filters] = expr.split("|");
      let value = vars.get(name.trim()) ?? "";
      for (const filter of filters.map((f) => f.trim())) {
        if (filter === "upper") value = value.toUpperCase();
        else if (filter === "lower") value = value.toLowerCase();
        else if (filter.startsWith("default:") && !value) value = filter.slice("default:".length);
      }
      return value;
    });
  return out;
}

// Capabilities ------------------------------------------------------------------

export type BotCapability = BotCapabilityName;
export const CAPABILITIES: BotCapability[] = ["send_messages", "create_polls", "create_events", "manage_roles", "manage_messages", "webhooks"];
export const capabilityLabel = (id: BotCapability) => tr(`bots.capability.${id}.label`);
export const capabilityDescription = (id: BotCapability) => tr(`bots.capability.${id}.description`);
export const capabilityPhrase = (id: BotCapability) => tr(`bots.capability.${id}.phrase`);

/** Capabilities the rules use that the bot hasn't been given. */
export function missingCapabilities(rules: BotRule[], granted: readonly string[]): BotCapability[] {
  return capabilitiesForRules(rules).filter((c) => !granted.includes(c));
}
