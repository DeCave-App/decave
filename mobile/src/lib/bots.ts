// Mobile helpers for the no-code bot builder: the phone only manages bots
// (list, switch on/off, activity, start from a template); rules are edited on desktop or web.

import i18next from "i18next";

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
  /** `detail` as a notice to show in the app's language (absent or null for older runs). */
  notice?: unknown;
  created_at: string;
};
export type BotBuilderOverview = { bots: ClientBot[]; templates: BotTemplate[] };

// Notes shown on the phone's bot screens, kept in the UI language: they are
// re-read from the catalogs whenever the language or its strings change.
export let PUBLISH_ON_DESKTOP_NOTE = "";
export let EDIT_ON_DESKTOP_NOTE = "";
export let TOKEN_BOT_NOTE = "";

function refreshNotes(): void {
  PUBLISH_ON_DESKTOP_NOTE = i18next.t("bots.mobile.publishOnDesktop");
  EDIT_ON_DESKTOP_NOTE = i18next.t("bots.mobile.editOnDesktop");
  TOKEN_BOT_NOTE = i18next.t("bots.mobile.tokenBot");
}
refreshNotes();
for (const event of ["initialized", "languageChanged", "added", "loaded"] as const) i18next.on(event, refreshNotes);

/** Run timestamps are UTC; D1 stores them as "YYYY-MM-DD HH:MM:SS" without a zone. */
export function parseRunTime(value: string): number {
  const text = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(text);
}

export function timeAgo(at: string, now: number): string {
  const ms = parseRunTime(at);
  if (!Number.isFinite(ms)) return "";
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 60) return i18next.t("forum.time.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18next.t("bots.mobile.time.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18next.t("bots.mobile.time.hours", { count: hours });
  return i18next.t("bots.mobile.time.days", { count: Math.floor(hours / 24) });
}

export function summarizeBot(bot: Pick<ClientBot, "pausedReason" | "rules" | "lastRunAt">, now: number): string {
  if (bot.pausedReason === "errors") return i18next.t("bots.mobile.pausedAfterErrors");
  const rules = i18next.t("bots.page.ruleCount", { count: bot.rules.length });
  const last = bot.lastRunAt ? timeAgo(bot.lastRunAt, now) : "";
  return i18next.t("bots.mobile.summary", {
    rules,
    last: last ? i18next.t("bots.mobile.lastRun", { time: last }) : i18next.t("bots.mobile.noRuns"),
  });
}
