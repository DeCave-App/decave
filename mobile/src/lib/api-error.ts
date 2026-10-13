// Worker error bodies in the app language. Kept apart from api.ts (which reads
// the Expo config) so plain modules and Node tests can use it.

import i18next from "i18next";

/**
 * A Worker error body. `i18nKey` (a full catalog key, or one under errors.)
 * names the message for legacy-coded errors; otherwise `messageCode`, then
 * `code`, is a key of the errors catalog. `error` keeps the English text.
 */
export type ApiErrorBody = { i18nKey?: unknown; messageCode?: unknown; code?: unknown; params?: unknown; error?: unknown };

// Codes come from the server at runtime, so they are looked up untyped.
const translateKey = (key: string, params: Record<string, unknown>): unknown =>
  (i18next.t as unknown as (key: string, options?: Record<string, unknown>) => unknown)(key, params);

/** The catalog text for `key` when it names a message (not a whole section), else null. */
function catalogText(key: string, params: Record<string, unknown>): string | null {
  if (!i18next.exists(key, params)) return null;
  if (typeof translateKey(key, { ...params, returnObjects: true }) !== "string") return null;
  const text = translateKey(key, params);
  return typeof text === "string" && text ? text : null;
}

/**
 * The server's error in the app language: the translation of its i18nKey, else
 * of its messageCode or code, else the server's own text, else `fallback`.
 */
export function apiErrorText(data: ApiErrorBody | null | undefined, fallback: string): string {
  const raw = data?.params && typeof data.params === "object" ? (data.params as Record<string, unknown>) : {};
  // A param `xKey` naming an errors-catalog string (e.g. `fieldKey`, a form field's
  // label) replaces param `x`, which holds that label in English.
  const params = { ...raw };
  for (const [name, value] of Object.entries(raw)) {
    if (!name.endsWith("Key") || name.length <= 3 || typeof value !== "string") continue;
    const label = catalogText(`errors.${value}`, raw);
    if (label) params[name.slice(0, -3)] = label;
  }
  const i18nKey = typeof data?.i18nKey === "string" ? data.i18nKey : "";
  const codes = [data?.messageCode, data?.code].filter((code): code is string => typeof code === "string" && !!code);
  const candidates = [
    ...(i18nKey ? (i18nKey.startsWith("errors.") ? [i18nKey] : [`errors.${i18nKey}`, i18nKey]) : []),
    ...codes.map((code) => `errors.${code}`),
  ];
  for (const key of candidates) {
    const text = catalogText(key, params);
    if (text) return text;
  }
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}
