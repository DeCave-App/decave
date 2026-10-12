// Hand-written validator for bot rules. Pure: no I/O, collects every error.
import { BOT_LIMITS } from "./types.ts";
import type { BotRule } from "./types.ts";
import { cronMinuteGap, parseCron } from "./cron.ts";
import { compileBotPattern } from "./regex-vm.ts";

export type BotRuleContext = {
  channelIds: Set<string>;
  voiceRoomIds: Set<string>;
  roleIds: Set<string>;
  ruleIds: Set<string>;
  builtInCommands: Set<string>;
};

export type BotRuleError = { path: string; message: string };

export type ValidateRuleResult = { ok: true; rule: BotRule } | { ok: false; errors: BotRuleError[] };

type Obj = Record<string, unknown>;
type Errors = BotRuleError[];

const COMMAND_NAME = /^[a-z0-9-]{1,32}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const OPTION_TYPES = ["text", "number", "user", "role", "channel", "choice"];
const MESSAGE_MODES = ["contains", "startsWith", "exact", "regex"];
const VAR_OPS = ["=", "!=", ">", "<", "contains"];
const SCOPES = ["user", "hub"];
const MAX_TEXT = BOT_LIMITS.renderMaxChars;
// Role grants/event starts may be scheduled up to a year out.
const MAX_FUTURE_MINUTES = 525600;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const join = (base: string, key: string) => (base ? `${base}.${key}` : key);

// Rejects keys outside `allowed`; returns false when the value is not an object.
function checkObject(v: unknown, path: string, allowed: string[], errors: Errors): v is Obj {
  if (!isObj(v)) {
    errors.push({ path, message: "Must be an object." });
    return false;
  }
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) errors.push({ path: join(path, key), message: "Unknown field." });
  }
  return true;
}

function str(o: Obj, key: string, path: string, errors: Errors, max: number = MAX_TEXT, optional = false): boolean {
  const v = o[key];
  if (v === undefined && optional) return false;
  if (!isStr(v) || v.length === 0) {
    errors.push({ path: join(path, key), message: "Must be a non-empty string." });
    return false;
  }
  if (v.length > max) {
    errors.push({ path: join(path, key), message: `Must be at most ${max} characters.` });
    return false;
  }
  return true;
}

function bool(o: Obj, key: string, path: string, errors: Errors, optional = false) {
  if (o[key] === undefined && optional) return;
  if (typeof o[key] !== "boolean") errors.push({ path: join(path, key), message: "Must be true or false." });
}

function num(o: Obj, key: string, path: string, errors: Errors, min: number, max: number, optional = false) {
  const v = o[key];
  if (v === undefined && optional) return;
  if (!isNum(v) || v < min || v > max) {
    errors.push({ path: join(path, key), message: `Must be a number from ${min} to ${max}.` });
  }
}

function oneOf(o: Obj, key: string, path: string, errors: Errors, values: string[]) {
  if (!isStr(o[key]) || !values.includes(o[key])) {
    errors.push({ path: join(path, key), message: `Must be one of: ${values.join(", ")}.` });
  }
}

function time(o: Obj, key: string, path: string, errors: Errors) {
  if (!isStr(o[key]) || !TIME.test(o[key])) {
    errors.push({ path: join(path, key), message: "Must be a time like 09:30." });
  }
}

function id(o: Obj, key: string, path: string, errors: Errors, known: Set<string>, what: string) {
  const v = o[key];
  if (!isStr(v) || v.length === 0) {
    errors.push({ path: join(path, key), message: `Must be a ${what} id.` });
  } else if (!known.has(v)) {
    errors.push({ path: join(path, key), message: `Unknown ${what} in this hub.` });
  }
}

function varValue(o: Obj, path: string, errors: Errors, optional: boolean) {
  const v = o.value;
  if (v === undefined && optional) return;
  if (!(isStr(v) && v.length <= MAX_TEXT) && !isNum(v)) {
    errors.push({ path: join(path, "value"), message: "Must be a number or short text." });
  }
}

// Regex triggers never run through JS RegExp: they are parsed against a small
// whitelist grammar and run by a linear-time VM (see regex-vm.ts). Checked on
// save and again before matching.
export function unsafeRegexReason(pattern: string): string | null {
  const compiled = compileBotPattern(pattern);
  return "error" in compiled ? compiled.error : null;
}

function validateTrigger(t: unknown, path: string, ctx: BotRuleContext, errors: Errors) {
  if (!isObj(t)) {
    errors.push({ path, message: "Must be an object." });
    return;
  }
  const f = (...extra: string[]) => checkObject(t, path, ["type", ...extra], errors);
  switch (t.type) {
    case "command": {
      if (!f("name", "options")) return;
      if (!isStr(t.name) || !COMMAND_NAME.test(t.name)) {
        errors.push({ path: join(path, "name"), message: "Use 1-32 lowercase letters, digits or dashes." });
      } else if (ctx.builtInCommands.has(t.name)) {
        errors.push({ path: join(path, "name"), message: "This name is already used by a built-in command." });
      }
      if (!Array.isArray(t.options)) {
        errors.push({ path: join(path, "options"), message: "Must be a list." });
        return;
      }
      t.options.forEach((opt, i) => {
        const p = `${path}.options[${i}]`;
        if (!checkObject(opt, p, ["name", "type", "required", "choices"], errors)) return;
        if (!isStr(opt.name) || !COMMAND_NAME.test(opt.name)) {
          errors.push({ path: join(p, "name"), message: "Use 1-32 lowercase letters, digits or dashes." });
        }
        oneOf(opt, "type", p, errors, OPTION_TYPES);
        bool(opt, "required", p, errors);
        if (opt.choices !== undefined) {
          const ok =
            Array.isArray(opt.choices) &&
            opt.choices.length <= 25 &&
            opt.choices.every((c) => isStr(c) && c.length > 0 && c.length <= 100);
          if (!ok) errors.push({ path: join(p, "choices"), message: "Must be up to 25 short texts." });
        }
      });
      return;
    }
    case "message": {
      if (!f("mode", "pattern", "caseSensitive")) return;
      oneOf(t, "mode", path, errors, MESSAGE_MODES);
      const limit = t.mode === "regex" ? BOT_LIMITS.regexMaxLength : MAX_TEXT;
      if (str(t, "pattern", path, errors, limit) && t.mode === "regex") {
        const pattern = t.pattern as string;
        let valid = true;
        try {
          new RegExp(pattern);
        } catch {
          valid = false;
          errors.push({ path: join(path, "pattern"), message: "Not a valid regular expression." });
        }
        if (valid) {
          const problem = unsafeRegexReason(pattern);
          if (problem) errors.push({ path: join(path, "pattern"), message: problem });
        }
      }
      bool(t, "caseSensitive", path, errors);
      return;
    }
    case "memberJoin":
    case "memberLeave":
    case "hubEventStart":
    case "streamLive":
    case "streamOffline":
      f();
      return;
    case "roleAdded":
    case "roleRemoved":
      if (f("roleId")) id(t, "roleId", path, errors, ctx.roleIds, "role");
      return;
    case "reactionAdded":
    case "reactionRemoved":
      if (!f("emoji", "messageId")) return;
      str(t, "emoji", path, errors, 64);
      str(t, "messageId", path, errors, 64, true);
      return;
    case "component":
      if (f("customId")) str(t, "customId", path, errors, 100);
      return;
    case "formSubmit":
      if (f("formId")) str(t, "formId", path, errors, 100);
      return;
    case "voiceJoin":
    case "voiceLeave":
      if (!f("roomId")) return;
      if (t.roomId !== undefined) id(t, "roomId", path, errors, ctx.voiceRoomIds, "voice room");
      return;
    case "schedule": {
      if (!f("every", "daily", "weekly", "cron", "timezone")) return;
      str(t, "timezone", path, errors, 64);
      const modes = ["every", "daily", "weekly", "cron"].filter((k) => t[k] !== undefined);
      if (modes.length !== 1) {
        errors.push({ path, message: "Set exactly one of every, daily, weekly or cron." });
        return;
      }
      if (t.every !== undefined) {
        if (!isNum(t.every) || !Number.isInteger(t.every) || t.every < BOT_LIMITS.minScheduleMinutes) {
          errors.push({
            path: join(path, "every"),
            message: `Schedules must run at least every ${BOT_LIMITS.minScheduleMinutes} minutes.`,
          });
        }
      } else if (t.daily !== undefined) {
        time(t, "daily", path, errors);
      } else if (t.weekly !== undefined) {
        const p = join(path, "weekly");
        if (checkObject(t.weekly, p, ["day", "time"], errors)) {
          num(t.weekly, "day", p, errors, 0, 6);
          time(t.weekly, "time", p, errors);
        }
      } else {
        str(t, "cron", path, errors, 100);
        if (isStr(t.cron)) {
          const cron = parseCron(t.cron);
          if (!cron)
            errors.push({ path: join(path, "cron"), message: "Cron must be 5 fields: minute hour day month weekday." });
          else if (cronMinuteGap(cron) < BOT_LIMITS.minScheduleMinutes)
            errors.push({
              path: join(path, "cron"),
              message: `Schedules must run at least every ${BOT_LIMITS.minScheduleMinutes} minutes.`,
            });
        }
      }
      return;
    }
    default:
      errors.push({ path: join(path, "type"), message: "Unknown trigger type." });
  }
}

function validateCondition(c: unknown, path: string, ctx: BotRuleContext, errors: Errors) {
  if (!isObj(c)) {
    errors.push({ path, message: "Must be an object." });
    return;
  }
  const f = (...extra: string[]) => checkObject(c, path, ["type", ...extra], errors);
  switch (c.type) {
    case "hasRole":
    case "lacksRole":
      if (f("roleId")) id(c, "roleId", path, errors, ctx.roleIds, "role");
      return;
    case "channelIs":
    case "channelIsNot":
      if (f("channelId")) id(c, "channelId", path, errors, ctx.channelIds, "channel");
      return;
    case "accountAge":
    case "memberAge":
      if (f("minDays")) num(c, "minDays", path, errors, 0, 36500);
      return;
    case "variable":
      if (!f("name", "scope", "op", "value")) return;
      str(c, "name", path, errors, 64);
      oneOf(c, "scope", path, errors, SCOPES);
      oneOf(c, "op", path, errors, VAR_OPS);
      varValue(c, path, errors, false);
      return;
    case "chance":
      if (f("percent")) num(c, "percent", path, errors, 0, 100);
      return;
    case "timeOfDay":
      if (!f("from", "to", "timezone")) return;
      time(c, "from", path, errors);
      time(c, "to", path, errors);
      str(c, "timezone", path, errors, 64);
      return;
    case "weekday": {
      if (!f("days")) return;
      const ok =
        Array.isArray(c.days) &&
        c.days.length > 0 &&
        c.days.every((d) => isNum(d) && Number.isInteger(d) && d >= 0 && d <= 6);
      if (!ok) errors.push({ path: join(path, "days"), message: "Must be a list of days from 0 to 6." });
      return;
    }
    default:
      errors.push({ path: join(path, "type"), message: "Unknown condition type." });
  }
}

function validateCard(card: unknown, path: string, errors: Errors) {
  if (!checkObject(card, path, ["title", "text", "color", "imageUrl", "fields", "buttons", "select"], errors)) return;
  str(card, "title", path, errors, 256, true);
  str(card, "text", path, errors, MAX_TEXT, true);
  if (card.color !== undefined && !(isStr(card.color) && /^#[0-9a-fA-F]{6}$/.test(card.color))) {
    errors.push({ path: join(path, "color"), message: "Must be a colour like #aabbcc." });
  }
  if (
    card.imageUrl !== undefined &&
    !(isStr(card.imageUrl) && card.imageUrl.length <= 2048 && /^https:\/\//.test(card.imageUrl))
  ) {
    errors.push({ path: join(path, "imageUrl"), message: "Must be an https link." });
  }
  if (card.fields !== undefined) {
    if (!Array.isArray(card.fields) || card.fields.length > 25) {
      errors.push({ path: join(path, "fields"), message: "Must be a list of at most 25 fields." });
    } else {
      card.fields.forEach((fl, i) => {
        const p = `${path}.fields[${i}]`;
        if (!checkObject(fl, p, ["name", "value"], errors)) return;
        str(fl, "name", p, errors, 256);
        str(fl, "value", p, errors, 1024);
      });
    }
  }
  if (card.buttons !== undefined && card.select !== undefined) {
    errors.push({ path, message: "A card can have buttons or a select menu, not both." });
    return;
  }
  if (card.buttons !== undefined) {
    if (!Array.isArray(card.buttons) || card.buttons.length > BOT_LIMITS.cardMaxButtons) {
      errors.push({ path: join(path, "buttons"), message: `At most ${BOT_LIMITS.cardMaxButtons} buttons.` });
    } else {
      card.buttons.forEach((b, i) => {
        const p = `${path}.buttons[${i}]`;
        if (!checkObject(b, p, ["customId", "label", "style"], errors)) return;
        str(b, "customId", p, errors, 100);
        str(b, "label", p, errors, 80);
        str(b, "style", p, errors, 32);
      });
    }
  }
  if (card.select !== undefined) {
    const p = join(path, "select");
    if (!checkObject(card.select, p, ["customId", "options"], errors)) return;
    str(card.select, "customId", p, errors, 100);
    const opts = card.select.options;
    if (!Array.isArray(opts) || opts.length === 0 || opts.length > 25) {
      errors.push({ path: join(p, "options"), message: "Must be a list of 1 to 25 options." });
    } else {
      opts.forEach((o, i) => {
        const op = `${p}.options[${i}]`;
        if (!checkObject(o, op, ["label", "value"], errors)) return;
        str(o, "label", op, errors, 100);
        str(o, "value", op, errors, 100);
      });
    }
  }
}

function validateAction(a: unknown, path: string, ctx: BotRuleContext, errors: Errors) {
  if (!isObj(a)) {
    errors.push({ path, message: "Must be an object." });
    return;
  }
  const f = (...extra: string[]) => checkObject(a, path, ["type", ...extra], errors);
  switch (a.type) {
    case "sendMessage":
      if (!f("channel", "text", "card")) return;
      if (a.channel !== "trigger") id(a, "channel", path, errors, ctx.channelIds, "channel");
      str(a, "text", path, errors);
      if (a.card !== undefined) validateCard(a.card, join(path, "card"), errors);
      return;
    case "reply":
      if (!f("text", "card")) return;
      str(a, "text", path, errors);
      if (a.card !== undefined) validateCard(a.card, join(path, "card"), errors);
      return;
    case "editMessage":
      if (!f("messageRef", "text")) return;
      str(a, "messageRef", path, errors, 200);
      str(a, "text", path, errors);
      return;
    case "pin":
    case "unpin":
      if (f("messageRef")) str(a, "messageRef", path, errors, 200);
      return;
    case "deleteTrigger":
    case "stop":
      f();
      return;
    case "react":
      if (f("emoji")) str(a, "emoji", path, errors, 64);
      return;
    case "createThread":
      if (f("name")) str(a, "name", path, errors, 100);
      return;
    case "privateNotice":
      if (f("text")) str(a, "text", path, errors);
      return;
    case "addRole":
    case "removeRole":
    case "toggleRole":
      if (!f("roleId", "durationMinutes")) return;
      id(a, "roleId", path, errors, ctx.roleIds, "role");
      num(a, "durationMinutes", path, errors, 1, MAX_FUTURE_MINUTES, true);
      return;
    case "openForm": {
      if (!f("formId", "title", "fields")) return;
      str(a, "formId", path, errors, 100);
      str(a, "title", path, errors, 45);
      if (!Array.isArray(a.fields) || a.fields.length === 0 || a.fields.length > BOT_LIMITS.formMaxFields) {
        errors.push({ path: join(path, "fields"), message: `A form needs 1 to ${BOT_LIMITS.formMaxFields} fields.` });
        return;
      }
      a.fields.forEach((fl, i) => {
        const p = `${path}.fields[${i}]`;
        if (!checkObject(fl, p, ["id", "label", "style", "required"], errors)) return;
        str(fl, "id", p, errors, 100);
        str(fl, "label", p, errors, 45);
        oneOf(fl, "style", p, errors, ["short", "long"]);
        bool(fl, "required", p, errors);
      });
      return;
    }
    case "startPoll": {
      if (!f("question", "options")) return;
      str(a, "question", path, errors, 300);
      const ok =
        Array.isArray(a.options) &&
        a.options.length >= 2 &&
        a.options.length <= 10 &&
        a.options.every((o) => isStr(o) && o.length > 0 && o.length <= 100);
      if (!ok) errors.push({ path: join(path, "options"), message: "Needs 2 to 10 short options." });
      return;
    }
    case "createEvent":
      if (!f("title", "startsInMinutes", "durationMinutes")) return;
      str(a, "title", path, errors, 100);
      num(a, "startsInMinutes", path, errors, 0, MAX_FUTURE_MINUTES);
      num(a, "durationMinutes", path, errors, 1, BOT_LIMITS.maxWaitMinutes);
      return;
    case "setVariable":
    case "addVariable":
      if (!f("name", "scope", "value")) return;
      str(a, "name", path, errors, 64);
      oneOf(a, "scope", path, errors, SCOPES);
      varValue(a, path, errors, true);
      return;
    case "resetVariable":
      if (!f("name", "scope")) return;
      str(a, "name", path, errors, 64);
      oneOf(a, "scope", path, errors, SCOPES);
      return;
    case "wait":
      if (f("minutes")) {
        if (!isNum(a.minutes) || a.minutes < 1 || a.minutes > BOT_LIMITS.maxWaitMinutes) {
          errors.push({
            path: join(path, "minutes"),
            message: `Wait must be between 1 and ${BOT_LIMITS.maxWaitMinutes} minutes (7 days).`,
          });
        }
      }
      return;
    case "runRule":
      if (f("ruleId")) id(a, "ruleId", path, errors, ctx.ruleIds, "rule");
      return;
    case "webhook":
      if (!f("url", "method", "body")) return;
      if (!isStr(a.url) || a.url.length > 2048 || !/^https:\/\//i.test(a.url)) {
        errors.push({ path: join(path, "url"), message: "Webhook URLs must start with https://." });
      }
      oneOf(a, "method", path, errors, ["GET", "POST"]);
      str(a, "body", path, errors, MAX_TEXT, true);
      return;
    default:
      errors.push({ path: join(path, "type"), message: "Unknown action type." });
  }
}

function validateActions(list: unknown, path: string, ctx: BotRuleContext, errors: Errors, required: boolean) {
  if (!Array.isArray(list)) {
    errors.push({ path, message: "Must be a list of actions." });
    return;
  }
  if (required && list.length === 0) errors.push({ path, message: "Needs at least one action." });
  if (list.length > BOT_LIMITS.actionsPerRule) {
    errors.push({ path, message: `At most ${BOT_LIMITS.actionsPerRule} actions per rule.` });
    return;
  }
  list.forEach((a, i) => validateAction(a, `${path}[${i}]`, ctx, errors));
}

function validateIdList(
  list: unknown,
  path: string,
  known: Set<string>,
  what: string,
  allowWild: boolean,
  errors: Errors,
) {
  if (!Array.isArray(list)) {
    errors.push({ path, message: "Must be a list." });
    return;
  }
  list.forEach((v, i) => {
    if (!isStr(v) || !((allowWild && v === "*") || known.has(v))) {
      errors.push({ path: `${path}[${i}]`, message: `Unknown ${what} in this hub.` });
    }
  });
}

export function validateRule(input: unknown, ctx: BotRuleContext): ValidateRuleResult {
  const errors: Errors = [];
  const top = ["v", "trigger", "scope", "cooldown", "when", "then", "else", "allowBotTriggers"];
  if (checkObject(input, "", top, errors)) {
    if (input.v !== 1) errors.push({ path: "v", message: "Unsupported rule version." });
    validateTrigger(input.trigger, "trigger", ctx, errors);

    if (checkObject(input.scope, "scope", ["channels", "roles"], errors)) {
      validateIdList(input.scope.channels, "scope.channels", ctx.channelIds, "channel", true, errors);
      validateIdList(input.scope.roles, "scope.roles", ctx.roleIds, "role", false, errors);
    }
    if (checkObject(input.cooldown, "cooldown", ["perUser", "perChannel"], errors)) {
      num(input.cooldown, "perUser", "cooldown", errors, 0, 86400);
      num(input.cooldown, "perChannel", "cooldown", errors, 0, 86400);
    }
    if (input.when !== undefined && checkObject(input.when, "when", ["all", "any"], errors)) {
      for (const key of ["all", "any"] as const) {
        const list = input.when[key];
        if (list === undefined) continue;
        if (!Array.isArray(list) || list.length > 20) {
          errors.push({ path: `when.${key}`, message: "Must be a list of at most 20 conditions." });
          continue;
        }
        list.forEach((c, i) => validateCondition(c, `when.${key}[${i}]`, ctx, errors));
      }
    }
    validateActions(input.then, "then", ctx, errors, true);
    if (input.else !== undefined) validateActions(input.else, "else", ctx, errors, false);
    bool(input, "allowBotTriggers", "", errors, true);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rule: input as BotRule };
}
