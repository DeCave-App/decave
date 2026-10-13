// Server notices ({ code, params } next to the English text) in the app's
// language. Codes: shared/i18n/server-notices.ts.

import i18next from "i18next";
import { readBotRunNotice } from "../../../shared/bots/run-notice.ts";
import { noticeText } from "./server-text";

// Codes come from the server at runtime, so they are looked up untyped.
const translate = (key: string, params?: Record<string, string | number>): string =>
  (i18next.t as unknown as (key: string, options?: Record<string, unknown>) => string)(key, params);

export { noticeText };

/**
 * A bot run-log detail in the app's language: the server sends the English
 * `detail` plus a notice ({ code, params, action? }); older runs and unexpected
 * errors have no notice and show the English as stored.
 */
export function runNoticeText(notice: unknown, english: string): string {
  const parsed = readBotRunNotice(notice);
  const text = parsed ? noticeText(parsed) : null;
  if (!parsed || !text) return english;
  return parsed.action ? translate("bots.activity.detail", { action: parsed.action, text }) : text;
}
