// Why a bot action or run did not go ahead: the English `reason` the run log
// and test steps always showed, plus a notice the bot builder renders in the
// viewer's language. Codes: shared/i18n/server-notices.ts (bots.run.server.*).

import type { BotRunNotice } from "../../shared/bots/run-notice.ts";
import type { ServerNoticeCode, ServerNoticeParams } from "../../shared/i18n/server-notices.ts";
import { noticeEnglish, noticeOf } from "../lib/notices";

export type Refusal = { reason: string; notice?: BotRunNotice };

export function refusal(code: ServerNoticeCode, params?: ServerNoticeParams): { reason: string; notice: BotRunNotice } {
  return { reason: noticeEnglish(code, params), notice: noticeOf(code, params) };
}

/** The notice for "<action>: <reason>", the way the run log's English detail reads. */
export function withAction(notice: BotRunNotice | undefined, action: string): BotRunNotice | undefined {
  if (!notice) return undefined;
  return { ...notice, action: notice.action ? `${action}: ${notice.action}` : action };
}
