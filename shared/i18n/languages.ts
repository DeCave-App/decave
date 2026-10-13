// The languages DeCave can show its own text in, and how a browser or device
// language list maps onto them.

export const LOCALES = ["en", "el", "es", "pt-BR", "fr", "nl", "de", "it", "pl", "uk"] as const;

export type Locale = (typeof LOCALES)[number];

/** Development-only locale that accents and pads every string to find untranslated text. */
export const PSEUDO_LOCALE = "en-XA";

export const DEFAULT_LOCALE = "en" satisfies Locale;

/** The language picker stays hidden until every language has been translated. */
export const I18N_PICKER_ENABLED = true;

export type Language = {
  code: Locale;
  /** The language's name in itself, shown in the picker. */
  nativeName: string;
  englishName: string;
  /** Reviewed by a native speaker; unreviewed languages carry a "beta" tag. */
  reviewed: boolean;
};

export const LANGUAGES: readonly Language[] = [
  { code: "en", nativeName: "English", englishName: "English", reviewed: true },
  { code: "el", nativeName: "Ελληνικά", englishName: "Greek", reviewed: false },
  { code: "es", nativeName: "Español", englishName: "Spanish", reviewed: false },
  { code: "pt-BR", nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)", reviewed: false },
  { code: "fr", nativeName: "Français", englishName: "French", reviewed: false },
  { code: "nl", nativeName: "Nederlands", englishName: "Dutch", reviewed: false },
  { code: "de", nativeName: "Deutsch", englishName: "German", reviewed: false },
  { code: "it", nativeName: "Italiano", englishName: "Italian", reviewed: false },
  { code: "pl", nativeName: "Polski", englishName: "Polish", reviewed: false },
  { code: "uk", nativeName: "Українська", englishName: "Ukrainian", reviewed: false },
];

const byLowerCode = new Map<string, Locale>(LOCALES.map((code) => [code.toLowerCase(), code]));

/** Base languages whose regional variants all map to one supported locale. */
const BASE_LANGUAGE: Record<string, Locale> = { pt: "pt-BR" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

function matchOne(candidate: string): Locale | null {
  const tag = candidate.trim().replace(/_/g, "-").toLowerCase();
  if (!tag) return null;
  const exact = byLowerCode.get(tag);
  if (exact) return exact;
  const base = tag.split("-")[0];
  return BASE_LANGUAGE[base] ?? byLowerCode.get(base) ?? null;
}

/** The first supported language in a preference list (e.g. navigator.languages), else English. */
export function resolveLocale(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const match = matchOne(candidate);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
