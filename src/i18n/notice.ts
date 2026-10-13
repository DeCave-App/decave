// Server notices ({ code, params } next to the English `message`) in the UI
// language. Codes: shared/i18n/server-notices.ts.

import { readServerNotice } from "../../shared/i18n/server-notices.ts";
import { i18next } from "./index.ts";

// Codes come from the server at runtime, so they are looked up untyped.
const translate = (key: string, params?: Record<string, string | number>): string =>
  (i18next.t as unknown as (key: string, options?: Record<string, unknown>) => string)(key, params);

/** The notice's text in the UI language, or null when there is no known notice. */
export function noticeText(notice: unknown): string | null {
  const parsed = readServerNotice(notice);
  if (!parsed || !i18next.exists(parsed.code)) return null;
  return translate(parsed.code, parsed.params);
}

/**
 * Text for a realtime frame or response body carrying `notice` and `message`:
 * the translated notice, else the server's English `message`, else the fallback.
 */
export function serverMessage(data: object | null | undefined, fallback: string): string {
  const fields = (data ?? {}) as { notice?: unknown; message?: unknown };
  const translated = noticeText(fields.notice);
  if (translated) return translated;
  return typeof fields.message === "string" && fields.message ? fields.message : fallback;
}
