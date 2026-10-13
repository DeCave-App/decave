// Run-log details and test-step texts in the UI language. The server sends the
// English text plus a notice ({ code, params, action? }); older runs and
// unexpected errors have no notice and show the English as stored.

import { readBotRunNotice } from "../../../shared/bots/run-notice.ts";
import { i18next } from "../../i18n/index.ts";
import { noticeText } from "../../i18n/notice.ts";

export function runNoticeText(notice: unknown, english: string): string {
  const parsed = readBotRunNotice(notice);
  const text = parsed ? noticeText(parsed) : null;
  if (!parsed || !text) return english;
  return parsed.action ? i18next.t("bots.activity.detail", { action: parsed.action, text }) : text;
}
