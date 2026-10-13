// Catalog rules every translation must pass (scripts/__tests__/i18n-catalogs.test.mjs):
// complete keys, no empty values, matching {{placeholders}} and <Trans> tags,
// every plural form the language needs, and no untranslated copies of English.

import glossaryJson from "./glossary.json" with { type: "json" };
import { DEFAULT_LOCALE } from "./languages.ts";

/** Every locale must translate every namespace; an empty {} file fails. */
export const REQUIRE_COMPLETE = true;

export type Glossary = { keepEnglish: string[]; sameAsEnglish: Record<string, string[]> };

export type CatalogMap = Record<string, Record<string, Record<string, unknown>>>;

export type CatalogRule = "missing" | "unknown" | "empty" | "placeholders" | "tags" | "plurals" | "sameAsEnglish";

export type CatalogProblem = {
  rule: CatalogRule;
  locale: string;
  namespace: string;
  /** The full key, "namespace.path.to.key". */
  key: string;
  message: string;
};

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;
const PLURAL_SUFFIX = new RegExp(`_(${PLURAL_SUFFIXES.join("|")})$`);

/** Nested catalog to "a.b.c" → value. */
export function flattenCatalog(catalog: Record<string, unknown>, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, innerValue] of flattenCatalog(value as Record<string, unknown>, path)) {
        out.set(inner, innerValue);
      }
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function placeholdersOf(value: string): string[] {
  return [...new Set([...value.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((match) => match[1]))].sort();
}

function tagsOf(value: string): string[] {
  return [...value.matchAll(/<\/?([0-9]+|[A-Za-z][\w-]*)\s*\/?>/g)].map((match) => match[0].replace(/\s+/g, "")).sort();
}

const sameList = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when a value has nothing to translate: only kept-English words, numbers, symbols and placeholders. */
export function onlyKeptEnglish(value: string, keepEnglish: readonly string[]): boolean {
  let rest = value.replace(/\{\{[^}]*\}\}/g, " ").replace(/<\/?[^>]*>/g, " ");
  const terms = [...keepEnglish].sort((left, right) => right.length - left.length);
  for (const term of terms)
    rest = rest.replace(new RegExp(`(^|[^\\p{L}])${escapeRegExp(term)}(?![\\p{L}])`, "gu"), "$1 ");
  return !/\p{L}/u.test(rest);
}

function pluralBase(key: string): string | null {
  const match = PLURAL_SUFFIX.exec(key);
  return match ? key.slice(0, -match[0].length) : null;
}

export function checkCatalogs(
  catalogs: CatalogMap,
  options: { requireComplete?: boolean; glossary?: Glossary } = {},
): CatalogProblem[] {
  const requireComplete = options.requireComplete ?? REQUIRE_COMPLETE;
  const glossary = options.glossary ?? (glossaryJson as Glossary);
  const english = catalogs[DEFAULT_LOCALE] ?? {};
  const problems: CatalogProblem[] = [];
  const report = (rule: CatalogRule, locale: string, namespace: string, key: string, message: string) =>
    problems.push({ rule, locale, namespace, key: `${namespace}.${key}`, message });

  for (const [namespace, catalog] of Object.entries(english)) {
    for (const [key, value] of flattenCatalog(catalog)) {
      if (typeof value !== "string" || value.trim() === "") {
        report("empty", DEFAULT_LOCALE, namespace, key, "English value is empty or not text");
      }
    }
  }

  for (const [locale, namespaces] of Object.entries(catalogs)) {
    if (locale === DEFAULT_LOCALE) continue;
    const categories = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
    const allowedSame = new Set(glossary.sameAsEnglish[locale] ?? []);

    for (const [namespace, englishCatalog] of Object.entries(english)) {
      const englishKeys = flattenCatalog(englishCatalog);
      const translated = flattenCatalog(namespaces[namespace] ?? {});
      if (translated.size === 0 && !requireComplete) continue;

      // Plural bases in English, e.g. "items" for items_one / items_other. A key that only
      // happens to end in "_one" (an audit event id like session_revoked_one) is not a plural.
      const pluralBases = new Map<string, string>();
      for (const key of englishKeys.keys()) {
        const base = pluralBase(key);
        if (base && englishKeys.has(`${base}_one`) && englishKeys.has(`${base}_other`)) pluralBases.set(base, key);
      }
      const englishFor = (key: string): string | undefined => {
        if (englishKeys.has(key)) return englishKeys.get(key) as string;
        const base = pluralBase(key);
        if (base && pluralBases.has(base)) {
          return (englishKeys.get(`${base}_other`) ?? englishKeys.get(`${base}_one`)) as string | undefined;
        }
        return undefined;
      };

      for (const key of englishKeys.keys()) {
        const base = pluralBase(key);
        if (base && pluralBases.has(base)) continue; // checked per plural category below
        if (!translated.has(key)) report("missing", locale, namespace, key, `missing in ${locale}`);
      }
      for (const base of pluralBases.keys()) {
        const missing = [...categories].filter((category) => !translated.has(`${base}_${category}`));
        if (missing.length) {
          report("plurals", locale, namespace, base, `${locale} needs plural forms: ${missing.join(", ")}`);
        }
      }

      for (const [key, value] of translated) {
        const source = englishFor(key);
        if (source === undefined) {
          report("unknown", locale, namespace, key, "key does not exist in English");
          continue;
        }
        if (typeof value !== "string" || value.trim() === "") {
          report("empty", locale, namespace, key, "value is empty or not text");
          continue;
        }
        if (!sameList(placeholdersOf(value), placeholdersOf(source))) {
          report(
            "placeholders",
            locale,
            namespace,
            key,
            `placeholders ${placeholdersOf(value).join(",") || "(none)"} differ from English ${placeholdersOf(source).join(",") || "(none)"}`,
          );
        }
        if (!sameList(tagsOf(value), tagsOf(source))) {
          report("tags", locale, namespace, key, "<tags> differ from English");
        }
        if (
          value === source &&
          !allowedSame.has(`${namespace}.${key}`) &&
          !onlyKeptEnglish(value, glossary.keepEnglish)
        ) {
          report("sameAsEnglish", locale, namespace, key, "value is still the English text");
        }
      }
    }
  }
  return problems;
}
