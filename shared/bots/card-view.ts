// View helpers for builder-bot messages, shared by the web/desktop and mobile
// chat: card buttons and select, safe links, form payloads and slash-command
// autocomplete. Everything here is pure; card content is untrusted bot output.
import { BOT_LIMITS } from "./types.ts";
import type { BotCardButton, BotCommandOption, BotFormField } from "./types.ts";

/** Catalog key of the private-notice label; render it with t(). */
export const PRIVATE_NOTICE_LABEL_KEY = "bots.card.privateNotice";
/** The label's English text (bots.card.privateNotice), for clients without translations yet. */
export const PRIVATE_NOTICE_LABEL = "Only you can see this";

export type MessageBot = { id: string; name: string; color: string | null; avatarEmoji: string | null };
export type CardButtonStyle = "primary" | "secondary" | "danger" | "success";
export type CardSelect = { customId: string; options: { label: string; value: string }[] };
export type BotForm = { formId: string; title: string; fields: BotFormField[] };
export type BotCommandInfo = { name: string; botId: string; botName: string; options: BotCommandOption[] };
export type CardTextPart = { kind: "text" | "link"; value: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";

/** The `bot`, `card` and `privateNotice` fields of a message from the API, checked. */
export function messageBotFields(raw: unknown): {
  bot?: MessageBot;
  card?: Record<string, unknown> | null;
  privateNotice?: boolean;
} {
  if (!isObject(raw) || !isObject(raw.bot) || !str(raw.bot.id)) return {};
  const bot = raw.bot;
  return {
    bot: {
      id: bot.id as string,
      name: str(bot.name) ? bot.name : "Bot",
      color: str(bot.color) && /^#[0-9a-fA-F]{6}$/.test(bot.color) ? bot.color : null,
      avatarEmoji: str(bot.avatarEmoji) ? bot.avatarEmoji.slice(0, 16) : null,
    },
    card: isObject(raw.card) ? raw.card : null,
    ...(raw.privateNotice === true ? { privateNotice: true } : {}),
  };
}

export function buttonStyle(style: unknown): CardButtonStyle {
  return style === "primary" || style === "danger" || style === "success" ? style : "secondary";
}

/** Well-formed buttons on a card, at most the card limit. */
export function cardButtons(card: unknown): BotCardButton[] {
  if (!isObject(card) || !Array.isArray(card.buttons)) return [];
  return card.buttons
    .filter((b): b is BotCardButton => isObject(b) && str(b.customId) && str(b.label))
    .slice(0, BOT_LIMITS.cardMaxButtons)
    .map((b) => ({ customId: b.customId, label: b.label, style: buttonStyle(b.style) }));
}

export function cardSelect(card: unknown): CardSelect | null {
  if (!isObject(card) || !isObject(card.select) || !str(card.select.customId)) return null;
  const options = Array.isArray(card.select.options)
    ? card.select.options
        .filter((o): o is { label: string; value: string } => isObject(o) && str(o.label) && str(o.value))
        .slice(0, 25)
        .map((o) => ({ label: o.label, value: o.value }))
    : [];
  return options.length ? { customId: card.select.customId, options } : null;
}

export function cardFields(card: unknown): { name: string; value: string }[] {
  if (!isObject(card) || !Array.isArray(card.fields)) return [];
  return card.fields
    .filter((f): f is { name: string; value: string } => isObject(f) && str(f.name) && str(f.value))
    .slice(0, 25);
}

/** The url when it is a well-formed https link, else null. */
export function safeCardLink(url: unknown): string | null {
  if (!str(url) || url.length > 2048 || !/^https:\/\//i.test(url)) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Card text split into plain text and https links (trailing punctuation stays text). */
export function cardTextParts(text: unknown): CardTextPart[] {
  if (!str(text) || !text) return [];
  const parts: CardTextPart[] = [];
  for (const token of text.split(/(https:\/\/[^\s<>"']+)/i)) {
    if (!token) continue;
    const match = /^(https:\/\/[^\s<>"']+?)([.,!?;:)\]]*)$/i.exec(token);
    const link = match ? safeCardLink(match[1]) : null;
    if (match && link) {
      parts.push({ kind: "link", value: link });
      if (match[2]) parts.push({ kind: "text", value: match[2] });
    } else parts.push({ kind: "text", value: token });
  }
  return parts;
}

export function interactionBody(messageId: string, customId: string, value?: string) {
  return value === undefined ? { messageId, customId } : { messageId, customId, value };
}

/** Catalog key of the title shown for a bot form that has none; render it with t(). */
export const UNTITLED_FORM_KEY = "bots.card.form.untitled";
/** That title's English text, for clients without translations yet. */
export const UNTITLED_FORM_TITLE = "Form";

/** The form an interaction response asks to open, or null. `untitled` titles a form that has no title. */
export function formFromResponse(data: unknown, untitled = UNTITLED_FORM_TITLE): BotForm | null {
  if (!isObject(data) || !isObject(data.form)) return null;
  const form = data.form;
  if (!str(form.formId) || !Array.isArray(form.fields)) return null;
  const fields = form.fields
    .filter((f): f is BotFormField => isObject(f) && str(f.id) && str(f.label))
    .slice(0, BOT_LIMITS.formMaxFields)
    .map(
      (f) =>
        ({
          id: f.id,
          label: f.label,
          style: f.style === "long" ? "long" : "short",
          required: f.required === true,
        }) as BotFormField,
    );
  return { formId: form.formId, title: str(form.title) ? form.title : untitled, fields };
}

/** Body for POST bot-forms/:formId: every declared field, nothing else. */
export function formPayload(fields: BotFormField[], values: Record<string, string>) {
  return { fields: Object.fromEntries(fields.map((f) => [f.id, values[f.id] ?? ""])) };
}

/** Labels of required fields left blank. */
export function missingRequired(fields: BotFormField[], values: Record<string, string>): string[] {
  return fields.filter((f) => f.required && !values[f.id]?.trim()).map((f) => f.label);
}

/** Commands matching the composer text while it is a bare "/prefix" (no space yet), max 8. */
export function filterCommands(commands: BotCommandInfo[], input: string): BotCommandInfo[] {
  const match = /^\/([\w-]*)$/.exec(input);
  if (!match) return [];
  const prefix = match[1].toLowerCase();
  return commands
    .filter((c) => c.name.toLowerCase().startsWith(prefix))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
}

/** Parses GET /api/servers/:hubId/bot-commands. */
export function commandsFromResponse(data: unknown): BotCommandInfo[] {
  if (!isObject(data) || !Array.isArray(data.commands)) return [];
  return data.commands
    .filter((c): c is BotCommandInfo => isObject(c) && str(c.name) && str(c.botName))
    .map((c) => ({
      name: c.name,
      botId: str(c.botId) ? c.botId : "",
      botName: c.botName,
      options: Array.isArray(c.options) ? c.options.filter(isCommandOption).map(commandOption) : [],
    }));
}

const OPTION_TYPES = new Set(["text", "number", "user", "role", "channel", "choice"]);

function isCommandOption(value: unknown): value is BotCommandOption {
  return (
    isObject(value) &&
    str(value.name) &&
    str(value.type) &&
    OPTION_TYPES.has(value.type) &&
    typeof value.required === "boolean"
  );
}

function commandOption(option: BotCommandOption): BotCommandOption {
  const choices = Array.isArray(option.choices) ? option.choices.filter(str) : undefined;
  return { name: option.name, type: option.type, required: option.required, ...(choices ? { choices } : {}) };
}

/** True when the text is exactly a known command with no required options, so Enter sends it. */
export function sendsCommandDirectly(commands: BotCommandInfo[], input: string): boolean {
  const name = /^\/([\w-]+)$/.exec(input)?.[1]?.toLowerCase();
  const command = name ? commands.find((c) => c.name.toLowerCase() === name) : undefined;
  return !!command && !command.options.some((option) => option.required);
}

const BOT_TEXT_PREFIX = "__DECAVE_BOT__";

/** The text of a stored bot message (`__DECAVE_BOT__{botId,name,text}`); other text is returned as is. */
export function botMessageText(text: string): string {
  if (!text.startsWith(BOT_TEXT_PREFIX)) return text;
  try {
    const payload = JSON.parse(text.slice(BOT_TEXT_PREFIX.length)) as { text?: unknown };
    return typeof payload.text === "string" ? payload.text : "";
  } catch {
    return "";
  }
}

/**
 * The server notice ({ code, params }) stored with a bot message's text, when
 * DeCave wrote that text (usage hints, Twitch clips): clients render it in the
 * reader's language instead of the English text.
 */
export function botMessageNotice(text: string): unknown {
  if (!text.startsWith(BOT_TEXT_PREFIX)) return null;
  try {
    const payload = JSON.parse(text.slice(BOT_TEXT_PREFIX.length)) as { notice?: unknown } | null;
    return payload && typeof payload === "object" ? (payload.notice ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * How to show a message: "card" (the bot renderer) only when a bot posted
 * bot-wrapped text; otherwise "default" — the normal pipeline (forum post, GIF,
 * plain text...) with a BOT badge next to the author when `bot` is set.
 */
export function botRenderMode(message: { text: string; bot?: unknown }): "card" | "default" {
  return isObject(message.bot) && message.text.startsWith(BOT_TEXT_PREFIX) ? "card" : "default";
}

/** A card image that is Hub artwork uploaded to this DeCave server (no third-party load), else null. */
export function hubArtworkUrl(url: string, baseUrl: string): string | null {
  try {
    const target = new URL(url);
    const origin = new URL(baseUrl).origin;
    return target.origin === origin &&
      /^\/uploads\/hub-media\/\d+\/(banner|header|icon|clip)\/[\w-]+$/.test(target.pathname)
      ? target.toString()
      : null;
  } catch {
    return null;
  }
}
