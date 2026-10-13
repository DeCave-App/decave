// Server-side translation: the account's saved language and a cached i18next
// instance per language for emails, push notifications and error text.

import i18next, { type TFunction } from "i18next";
import { DEFAULT_LOCALE, isLocale, type Locale } from "../../shared/i18n/languages.ts";
import { DEFAULT_NAMESPACE, NAMESPACES } from "../../shared/i18n/namespaces.ts";
import { RESOURCES } from "../../shared/i18n/resources.ts";

/** A stored locale value as the API returns it: unsupported or garbage values read as unset. */
export function storedLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null;
}

/** The language to render server text in for an account; English when unset. */
export async function userLocale(db: D1Database, userId: string): Promise<Locale> {
  const row = await db
    .prepare("SELECT locale FROM decave_users WHERE id=? LIMIT 1")
    .bind(userId)
    .first<{ locale: string | null }>()
    .catch(() => null);
  return storedLocale(row?.locale) ?? DEFAULT_LOCALE;
}

/** userLocale() for many accounts in one query per 90 ids; anyone missing reads as English. */
export async function userLocales(db: D1Database, userIds: readonly string[]): Promise<Map<string, Locale>> {
  const out = new Map<string, Locale>();
  for (let offset = 0; offset < userIds.length; offset += 90) {
    const chunk = userIds.slice(offset, offset + 90);
    const rows = await db
      .prepare(`SELECT id, locale FROM decave_users WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ id: string; locale: string | null }>()
      .catch(() => null);
    for (const row of rows?.results ?? []) {
      const locale = storedLocale(row.locale);
      if (locale) out.set(row.id, locale);
    }
  }
  for (const id of userIds) if (!out.has(id)) out.set(id, DEFAULT_LOCALE);
  return out;
}

/**
 * t() for text carrying user content (names, emails, links): every param is
 * inserted verbatim in one pass, so a username like "{{link}}" or "$t(x)"
 * stays literal instead of being interpolated again by i18next.
 */
export function tWith(t: TFunction, key: string, params: Record<string, string>): string {
  const names = Object.keys(params);
  const marked: Record<string, string> = {};
  names.forEach((name, index) => (marked[name] = `\u0001${index}\u0001`));
  return String(t(key, marked)).replace(/\u0001(\d+)\u0001/g, (_match, index: string) => params[names[Number(index)]]);
}

const instances = new Map<Locale, TFunction>();

/** A t() for one language. Missing keys fall back to English. */
export function workerT(locale: Locale): TFunction {
  const cached = instances.get(locale);
  if (cached) return cached;
  const instance = i18next.createInstance();
  void instance.init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...new Set<Locale>([locale, DEFAULT_LOCALE])],
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    // Keys are written "namespace.area.purpose" everywhere.
    nsSeparator: ".",
    keySeparator: ".",
    resources: {
      [locale]: RESOURCES[locale],
      [DEFAULT_LOCALE]: RESOURCES[DEFAULT_LOCALE],
    },
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  const t = instance.t.bind(instance) as TFunction;
  instances.set(locale, t);
  return t;
}
