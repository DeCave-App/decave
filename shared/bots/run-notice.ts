// Bot run-log details and test-step reasons as notices: the Worker stores the
// English `detail` plus { code, params, action? } so the bot builder shows the
// reason in the viewer's language. `action` is the failing action type chain
// ("sendMessage", "runRule: sendMessage"), an identifier shown as written.

import { readServerNotice, type ServerNotice } from "../i18n/server-notices.ts";

export type BotRunNotice = ServerNotice & { action?: string };

const MAX_ACTION_CHARS = 200;

/** The run notice in a stored row or API payload when it is well formed and known, else null. */
export function readBotRunNotice(value: unknown): BotRunNotice | null {
  const notice = readServerNotice(value);
  if (!notice) return null;
  const action = (value as { action?: unknown }).action;
  return typeof action === "string" && action && action.length <= MAX_ACTION_CHARS ? { ...notice, action } : notice;
}

/** A stored detail_notice column value (JSON text) as a notice, or null. */
export function parseBotRunNotice(json: unknown): BotRunNotice | null {
  if (typeof json !== "string" || !json) return null;
  try {
    return readBotRunNotice(JSON.parse(json));
  } catch {
    return null;
  }
}
