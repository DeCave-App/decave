// Server notices: text DeCave writes for people to read, sent as the English
// `message` older clients show plus a `notice` ({ code, params }) that current
// clients render in the reader's language. Codes: shared/i18n/server-notices.ts.

import { DEFAULT_LOCALE } from "../../shared/i18n/languages.ts";
import type { ServerNotice, ServerNoticeCode, ServerNoticeParams } from "../../shared/i18n/server-notices.ts";
import { workerT } from "./i18n";

/** The English text of a notice, exactly as clients without translations show it. */
export function noticeEnglish(code: ServerNoticeCode, params?: ServerNoticeParams): string {
  const t = workerT(DEFAULT_LOCALE) as unknown as (key: string, options?: ServerNoticeParams) => string;
  return t(code, params);
}

export function noticeOf(code: ServerNoticeCode, params?: ServerNoticeParams): ServerNotice {
  return params ? { code, params } : { code };
}

/** Spread into a realtime frame or JSON body: `{ type: "ERROR", ...serverNotice(code) }`. */
export function serverNotice(
  code: ServerNoticeCode,
  params?: ServerNoticeParams,
): { message: string; notice: ServerNotice } {
  return { message: noticeEnglish(code, params), notice: noticeOf(code, params) };
}
