// Trigger matching. Pure: decides whether an event fires a trigger and which
// template variables it provides.

import { BOT_LIMITS, type BotTrigger } from "../../shared/bots/types";
import { compileBotPattern } from "../../shared/bots/regex-vm";
import type { BotEvent } from "./actions/registry";

type Vars = Record<string, string | number>;
const NO = { match: false, vars: {} as Vars };

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function scalarVars(source: unknown, prefix = ""): Vars {
  const vars: Vars = {};
  if (!source || typeof source !== "object") return vars;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") vars[prefix + key] = value;
  }
  return vars;
}

function matchMessage(trigger: Extract<BotTrigger, { type: "message" }>, raw: string) {
  // Capped first so a pathological pattern only ever sees a bounded input.
  const text = raw.slice(0, BOT_LIMITS.renderMaxChars);
  if (trigger.mode === "regex") {
    const matcher = compileBotPattern(trigger.pattern, { caseInsensitive: !trigger.caseSensitive });
    if ("error" in matcher) return NO;
    // A tighter cap for regex: a second safety net behind the linear-time VM.
    const found = matcher.exec(text.slice(0, BOT_LIMITS.regexMaxInput));
    if (!found) return NO;
    const vars: Vars = {};
    found.groups.forEach((group, index) => {
      vars[`match.${index}`] = group ?? "";
    });
    return { match: true, vars };
  }
  const hay = trigger.caseSensitive ? text : text.toLowerCase();
  const needle = trigger.caseSensitive ? trigger.pattern : trigger.pattern.toLowerCase();
  // match.0 is the matched part of the message in its original case.
  let matched: string | null = null;
  if (trigger.mode === "exact") matched = hay.trim() === needle.trim() ? text.trim() : null;
  else if (trigger.mode === "startsWith") matched = hay.startsWith(needle) ? text.slice(0, needle.length) : null;
  else {
    const at = hay.indexOf(needle);
    matched = at >= 0 ? text.slice(at, at + needle.length) : null;
  }
  return matched === null ? NO : { match: true, vars: { "match.0": matched } };
}

export function matchesTrigger(trigger: BotTrigger, event: BotEvent): { match: boolean; vars: Vars } {
  if (trigger.type !== event.kind) return NO;
  const data = event.data;
  switch (trigger.type) {
    case "message":
      return matchMessage(trigger, str(data.text));
    case "command":
      return str(data.command).toLowerCase() === trigger.name.toLowerCase()
        ? { match: true, vars: scalarVars(data.args, "args.") }
        : NO;
    case "roleAdded":
    case "roleRemoved":
      return str(data.roleId) === trigger.roleId ? { match: true, vars: {} } : NO;
    case "reactionAdded":
    case "reactionRemoved":
      if (str(data.emoji) !== trigger.emoji) return NO;
      if (trigger.messageId && str(data.messageId) !== trigger.messageId) return NO;
      return { match: true, vars: { emoji: trigger.emoji } };
    case "component":
      return str(data.customId) === trigger.customId ? { match: true, vars: { value: str(data.value) } } : NO;
    case "formSubmit":
      return str(data.formId) === trigger.formId ? { match: true, vars: scalarVars(data.fields, "field.") } : NO;
    case "voiceJoin":
    case "voiceLeave":
      return !trigger.roomId || trigger.roomId === str(event.roomId) ? { match: true, vars: {} } : NO;
    case "memberJoin":
    case "memberLeave":
    case "hubEventStart":
      return { match: true, vars: {} };
    case "streamLive":
    case "streamOffline":
      return {
        match: true,
        vars: {
          "stream.title": str(data.title),
          "stream.game": str(data.game),
          "stream.url": str(data.url),
          streamer: str(data.streamer),
        },
      };
    case "schedule":
      // The scheduler names the rule it fires; the engine checks data.ruleId.
      return { match: true, vars: {} };
  }
}
