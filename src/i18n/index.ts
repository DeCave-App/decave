// Translation runtime for the web app and the desktop renderer: one i18next
// instance shared with react-i18next, the language choice (account, then this
// device, then the browser) and the development pseudo-locale.

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LOCALE,
  I18N_PICKER_ENABLED,
  PSEUDO_LOCALE,
  isLocale,
  resolveLocale,
  type Locale,
} from "../../shared/i18n/languages.ts";
import { DEFAULT_NAMESPACE, NAMESPACES, type Namespace } from "../../shared/i18n/namespaces.ts";
import { pseudoCatalog } from "../../shared/i18n/pseudo.ts";

export type ActiveLocale = Locale | typeof PSEUDO_LOCALE;
export type Catalog = Record<string, unknown>;
export type Catalogs = Partial<Record<Namespace, Catalog>>;

/** Where catalogs come from: English is bundled, other languages load on demand. */
export type CatalogSource = {
  english: Catalogs;
  load: (locale: Exclude<Locale, typeof DEFAULT_LOCALE>) => Promise<Catalogs>;
};

export const LOCALE_STORAGE_KEY = "decave_locale_v1";

let source: CatalogSource = { english: {}, load: async () => ({}) };
const loaded = new Set<ActiveLocale>();
let accountSignedIn = false;

function addCatalogs(locale: ActiveLocale, catalogs: Catalogs): void {
  for (const [namespace, catalog] of Object.entries(catalogs)) {
    i18next.addResourceBundle(locale, namespace, catalog ?? {}, true, true);
  }
  loaded.add(locale);
}

/** Installs the catalogs (src/i18n/catalogs.ts in the app; the file system in tests). */
export function setCatalogSource(next: CatalogSource): void {
  source = next;
  loaded.clear();
  if (i18next.isInitialized) addCatalogs(DEFAULT_LOCALE, next.english);
}

function ensureInitialized(): void {
  if (i18next.isInitialized) return;
  void i18next.use(initReactI18next).init({
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    // Keys are written "namespace.area.purpose" everywhere.
    nsSeparator: ".",
    keySeparator: ".",
    resources: { [DEFAULT_LOCALE]: source.english },
    load: "currentOnly",
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
  loaded.add(DEFAULT_LOCALE);
}

async function ensureLoaded(locale: ActiveLocale): Promise<void> {
  if (loaded.has(locale)) return;
  if (locale === PSEUDO_LOCALE) {
    addCatalogs(
      locale,
      Object.fromEntries(Object.entries(source.english).map(([ns, catalog]) => [ns, pseudoCatalog(catalog ?? {})])),
    );
  } else if (locale === DEFAULT_LOCALE) {
    addCatalogs(locale, source.english);
  } else {
    addCatalogs(locale, await source.load(locale));
  }
}

/** The Date style language (Settings → Language & region), used for <html lang> in English. */
let dateStyleLang: string | null = null;

/**
 * <html lang> follows the UI language. In English it keeps following the Date
 * style setting, as it did before translations.
 */
function setHtmlLang(locale: ActiveLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === DEFAULT_LOCALE && dateStyleLang ? dateStyleLang : locale;
}

/** Records the Date style language and updates <html lang> when the UI is in English. */
export function setDateStyleHtmlLang(language: string): void {
  dateStyleLang = language;
  const current = i18next.isInitialized ? i18next.language : DEFAULT_LOCALE;
  setHtmlLang(isLocale(current) || current === PSEUDO_LOCALE ? current : DEFAULT_LOCALE);
}

/** Switches the UI language, loading its catalogs first. English is ready synchronously. */
export async function initI18n(locale: ActiveLocale, options: { setHtmlLang?: boolean } = {}): Promise<void> {
  ensureInitialized();
  await ensureLoaded(locale);
  if (i18next.language !== locale) await i18next.changeLanguage(locale);
  if (options.setHtmlLang !== false) setHtmlLang(locale);
}

/** The UI language now in use; the pseudo-locale counts as English. */
export function activeLocale(): Locale {
  const current = i18next.language;
  return isLocale(current) ? current : DEFAULT_LOCALE;
}

type StorageLike = Pick<Storage, "getItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(locale: Locale | null): void {
  try {
    if (locale) localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    else localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {}
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

/** The language chosen on this device, else the first supported browser language, else English. */
export function detectLocale(env: { storage?: StorageLike | null; languages?: readonly string[] } = {}): Locale {
  const stored = readStored(env.storage === undefined ? defaultStorage() : env.storage);
  if (isLocale(stored)) return stored;
  return resolveLocale(env.languages ?? systemLanguages());
}

/** The pseudo-locale is for development builds (or builds made with VITE_I18N_PSEUDO=1). */
export function pseudoLocaleAllowed(): boolean {
  const env = import.meta.env as Record<string, unknown> | undefined;
  return env?.DEV === true || env?.VITE_I18N_PSEUDO === "1";
}

function pseudoRequested(): boolean {
  if (!pseudoLocaleAllowed()) return false;
  try {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("lang") === PSEUDO_LOCALE) {
      return true;
    }
  } catch {}
  return readStored() === PSEUDO_LOCALE;
}

/**
 * The language to start in. Until the picker ships, only an explicit choice
 * (saved on this device or the account) changes it, so browsers set to other
 * languages keep today's English page, including <html lang>.
 */
export function startupLocale(): ActiveLocale {
  if (pseudoRequested()) return PSEUDO_LOCALE;
  if (I18N_PICKER_ENABLED) return detectLocale();
  const stored = readStored();
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

/** Starts the runtime; English renders immediately and other languages swap in once loaded. */
export function startI18n(): Promise<void> {
  const locale = startupLocale();
  // English leaves <html lang> to the existing Dates & times setting.
  return initI18n(locale, { setHtmlLang: locale !== DEFAULT_LOCALE });
}

/**
 * Applies the language saved on the account after /api/auth/me. The account
 * choice wins over this device's; an unset account keeps the local choice.
 */
export function applyAccountLocale(locale: unknown): void {
  accountSignedIn = true;
  if (!isLocale(locale) || i18next.language === PSEUDO_LOCALE) return;
  writeStored(locale);
  if (locale !== i18next.language) void initI18n(locale);
}

/** Marks the session signed out, so later language changes stay on this device. */
export function clearAccountLocale(): void {
  accountSignedIn = false;
}

/** Changes the UI language; null follows the system. Saved on this device and, when signed in, the account. */
export async function setLocale(next: Locale | null): Promise<void> {
  writeStored(next);
  await initI18n(next ?? detectLocale({ storage: null }));
  if (!accountSignedIn) return;
  try {
    await fetch("/api/account/locale", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    });
  } catch {
    // Offline: this device keeps the choice and the next change syncs it.
  }
}

export { i18next };
