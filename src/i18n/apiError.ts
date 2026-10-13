// Turns a Worker error body ({ code, i18nKey?, params?, error }) or a realtime
// error frame ({ type, code, i18nKey?, params?, message }) into text in the UI
// language. `i18nKey` is set when `code` is a legacy machine code clients branch
// on (e.g. "DM_KEY_STALE"); otherwise `code` is the errors-catalog key.

import { i18next } from "./index.ts";
import { noticeText } from "./notice.ts";
import type { ErrorCode } from "../../shared/i18n/error-code.ts";

export type { ErrorCode };

/**
 * `code` is a catalog key, or a legacy machine code clients branch on (then the
 * catalog key is in `i18nKey`, which wins). `error` keeps the server's English text.
 */
export type ApiErrorBody = {
  code?: string;
  i18nKey?: string;
  params?: Record<string, string | number>;
  error?: string;
};

// Codes come from the server at runtime, so they are looked up untyped.
const translate = (key: string, params?: Record<string, string | number>): string =>
  (i18next.t as unknown as (key: string, options?: Record<string, unknown>) => string)(key, params);

function hasMessage(key: string, params?: Record<string, string | number>): boolean {
  return (
    i18next.exists(key, params) &&
    typeof i18next.t(key as never, { ...params, returnObjects: true } as never) === "string"
  );
}

/**
 * A param `xKey` naming an errors-catalog string (e.g. `fieldKey` for a form
 * field's label) replaces param `x`, which holds that label in English.
 */
function translatedParams(params?: Record<string, string | number>): Record<string, string | number> | undefined {
  if (!params) return params;
  const out = { ...params };
  for (const [name, value] of Object.entries(params)) {
    if (!name.endsWith("Key") || name.length === 3 || typeof value !== "string") continue;
    if (hasMessage(`errors.${value}`, params)) out[name.slice(0, -3)] = translate(`errors.${value}`, params);
  }
  return out;
}

function serverMessage(data: ApiErrorBody | null | undefined): string | null {
  for (const code of [data?.i18nKey, data?.code]) {
    if (typeof code === "string" && code && hasMessage(`errors.${code}`, data?.params))
      return translate(`errors.${code}`, translatedParams(data?.params));
  }
  if (typeof data?.error === "string" && data.error) return data.error;
  return null;
}

/** The translated message for an error code, else the server's English text, else the fallback's text. */
export function apiErrorMessage(data: ApiErrorBody | null | undefined, fallbackKey: ErrorCode): string {
  return serverMessage(data) ?? translate(`errors.${fallbackKey}`);
}

/** The translated message for an error body, else the server's English text, else `fallback` (already translated). */
export function apiErrorOr(data: ApiErrorBody | null | undefined, fallback: string): string {
  return serverMessage(data) ?? fallback;
}

/** A realtime error frame's text: its translated notice, else translated from its code, else its English `message`, else the fallback. */
export function realtimeErrorMessage(frame: unknown, fallback: string): string {
  if (!frame || typeof frame !== "object") return fallback;
  const { code, i18nKey, params, message } = frame as Record<string, unknown>;
  // Server notices ({ notice: { code, params } }) come first; see src/i18n/notice.ts.
  const notice = noticeText((frame as { notice?: unknown }).notice);
  if (notice) return notice;
  return (
    serverMessage({
      code: typeof code === "string" ? code : undefined,
      i18nKey: typeof i18nKey === "string" ? i18nKey : undefined,
      params: params && typeof params === "object" ? (params as Record<string, string | number>) : undefined,
      error: typeof message === "string" ? message : undefined,
    }) ?? fallback
  );
}
