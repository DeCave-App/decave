// Error codes: keys of the English errors catalog, and their English text for
// the Worker's `error` field and for callers without translations. Shared
// validators return { code, params? } so the Worker can send a code clients
// translate instead of an English sentence.

import englishErrors from "./locales/en/errors.json" with { type: "json" };

// Plural keys ("x_one", "x_other") are used as "x" with a numeric `count` param.
type PluralBase<K extends string> = K extends `${infer Base}_${"zero" | "one" | "two" | "few" | "many" | "other"}`
  ? Base
  : K;

type ErrorKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${PluralBase<K>}` : ErrorKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** A key of shared/i18n/locales/en/errors.json, e.g. "account.localeInvalid". */
export type ErrorCode = ErrorKeys<typeof englishErrors>;

export type ErrorParams = Record<string, string | number>;

/** A translatable error: an errors-catalog key and its params. */
export type ErrorText = { code: ErrorCode; params?: ErrorParams };

/** { code, params? } without an empty params object. */
export function errorText(code: ErrorCode, params?: ErrorParams): ErrorText {
  return params ? { code, params } : { code };
}

const englishPlurals = new Intl.PluralRules("en");

/** The English text of an error code with its params filled in. */
export function englishErrorText(code: ErrorCode, params?: ErrorParams): string {
  const parts = code.split(".");
  const last = parts.pop() ?? "";
  let parent: unknown = englishErrors;
  for (const part of parts) parent = (parent as Record<string, unknown> | undefined)?.[part];
  const siblings = parent as Record<string, unknown> | undefined;
  let node = siblings?.[last];
  if (node === undefined && typeof params?.count === "number")
    node = siblings?.[`${last}_${englishPlurals.select(params.count)}`] ?? siblings?.[`${last}_other`];
  const text = typeof node === "string" ? node : code;
  return text.replace(/\{\{\s*([^,}\s]+)[^}]*\}\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match,
  );
}

/** A translatable error with its English text: clients render `code` with `params`; `error` is for older clients. */
export type CodedError = ErrorText & { error: string };

/** { code, params?, error } for a code, with the English text filled in. */
export function codedError(code: ErrorCode, params?: ErrorParams): CodedError {
  return { ...errorText(code, params), error: englishErrorText(code, params) };
}
