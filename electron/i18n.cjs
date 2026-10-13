// Translations for the desktop shell's own text (tray, windows, update and
// verification messages, screen-share picker, voice overlay). Reads the same
// catalogs as the web app (shared/i18n/locales/<locale>/desktop.json) with
// i18next. The renderer reports the language it shows through preload IPC;
// until it does, the last reported language or the OS language is used.

const fs = require("node:fs");
const path = require("node:path");
const i18next = require("i18next");

// Same list as shared/i18n/languages.ts (checked by scripts/__tests__/desktop-i18n.test.mjs).
const LOCALES = ["en", "el", "es", "pt-BR", "fr", "nl", "de", "it", "pl", "uk"];
const DEFAULT_LOCALE = "en";
const NAMESPACE = "desktop";
const LOCALES_DIR = path.join(__dirname, "..", "shared", "i18n", "locales");

const byLowerCode = new Map(LOCALES.map((code) => [code.toLowerCase(), code]));
const BASE_LANGUAGE = { pt: "pt-BR" };

function isLocale(value) {
  return typeof value === "string" && LOCALES.includes(value);
}

/** The first supported language in a preference list (e.g. app.getPreferredSystemLanguages()), else English. */
function resolveLocale(candidates) {
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (typeof candidate !== "string") continue;
    const tag = candidate.trim().replace(/_/g, "-").toLowerCase();
    if (!tag) continue;
    const exact = byLowerCode.get(tag);
    if (exact) return exact;
    const base = tag.split("-")[0];
    const match = BASE_LANGUAGE[base] ?? byLowerCode.get(base);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

function readCatalog(locale) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, `${NAMESPACE}.json`), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const instance = i18next.createInstance();
void instance.init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: LOCALES,
  ns: [NAMESPACE],
  defaultNS: NAMESPACE,
  // Keys are written "desktop.area.purpose", like everywhere else.
  nsSeparator: ".",
  keySeparator: ".",
  resources: Object.fromEntries(LOCALES.map((locale) => [locale, { [NAMESPACE]: readCatalog(locale) }])),
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

const listeners = new Set();

/** Text for a "desktop.*" key in the current language; missing keys fall back to English. */
function tMain(key, params) {
  return instance.t(key, params);
}

function currentLocale() {
  return isLocale(instance.language) ? instance.language : DEFAULT_LOCALE;
}

/** Switches the language; returns true when it changed. Unsupported values are ignored. */
function setMainLocale(value) {
  if (!isLocale(value) || value === currentLocale()) return false;
  void instance.changeLanguage(value);
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.warn("DeCave language listener failed:", error);
    }
  }
  return true;
}

/** Runs `listener(locale)` after every language change; returns an unsubscribe function. */
function onMainLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = {
  LOCALES,
  DEFAULT_LOCALE,
  isLocale,
  resolveLocale,
  tMain,
  currentLocale,
  setMainLocale,
  onMainLocaleChange,
};
