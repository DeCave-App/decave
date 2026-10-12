// Mobile helpers for the no-code bot builder: the phone only manages bots
// (list, switch on/off, activity, start from a template); rules are edited on desktop or web.

export type ClientBotRule = { id: string; enabled: boolean };
export type ClientBot = {
  id: string;
  kind: "builder" | "token";
  name: string;
  description: string;
  color: string;
  avatarEmoji: string;
  enabled: boolean;
  pausedReason: "errors" | null;
  hasUnpublishedChanges: boolean;
  rules: ClientBotRule[];
  /** Filled in by the screen from the run log; not part of the list response. */
  lastRunAt?: string | null;
};
export type BotTemplate = { id: string; name: string; description: string };
export type BotRun = {
  id: number;
  bot_id: string;
  rule_id: string | null;
  trigger: string;
  status: string;
  detail: string;
  created_at: string;
};
export type BotBuilderOverview = { bots: ClientBot[]; templates: BotTemplate[] };

export const PUBLISH_ON_DESKTOP_NOTE = "Publish it on desktop or web to make it live";
export const EDIT_ON_DESKTOP_NOTE = "Edit rules on desktop or web";
export const TOKEN_BOT_NOTE = "Manage on desktop or web";

/** Run timestamps are UTC; D1 stores them as "YYYY-MM-DD HH:MM:SS" without a zone. */
export function parseRunTime(value: string): number {
  const text = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(text);
}

export function timeAgo(at: string, now: number): string {
  const ms = parseRunTime(at);
  if (!Number.isFinite(ms)) return "";
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function summarizeBot(bot: Pick<ClientBot, "pausedReason" | "rules" | "lastRunAt">, now: number): string {
  if (bot.pausedReason === "errors") return "Paused after errors";
  const count = bot.rules.length;
  const rules = `${count} ${count === 1 ? "rule" : "rules"}`;
  const last = bot.lastRunAt ? timeAgo(bot.lastRunAt, now) : "";
  return `${rules} · ${last ? `last run ${last}` : "No runs yet"}`;
}
