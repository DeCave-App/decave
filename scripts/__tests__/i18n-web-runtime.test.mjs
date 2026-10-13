import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const localesDir = path.join(root, "shared/i18n/locales");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");
const runtime = await import("../../src/i18n/index.ts");
const { default: i18next } = await import("i18next");

const readLocale = (locale) =>
  Object.fromEntries(
    NAMESPACES.map((ns) => [ns, JSON.parse(fs.readFileSync(path.join(localesDir, locale, `${ns}.json`), "utf8"))]),
  );
const loads = [];
runtime.setCatalogSource({
  english: readLocale("en"),
  async load(locale) {
    loads.push(locale);
    return readLocale(locale);
  },
});

const storage = (value) => ({ getItem: (key) => (key === runtime.LOCALE_STORAGE_KEY ? value : null) });

test("detectLocale prefers this device's choice, then the browser languages", () => {
  assert.equal(runtime.detectLocale({ storage: storage("de"), languages: ["el-GR"] }), "de");
  assert.equal(runtime.detectLocale({ storage: storage(null), languages: ["el-GR"] }), "el");
  assert.equal(runtime.detectLocale({ storage: storage("xx"), languages: ["pt-PT"] }), "pt-BR");
  assert.equal(runtime.detectLocale({ storage: storage("en-XA"), languages: ["zh-CN"] }), "en");
  assert.equal(runtime.detectLocale({ storage: null, languages: [] }), "en");
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(runtime.detectLocale({ storage: throwing, languages: ["fr-CA"] }), "fr");
});

test("initI18n('en') renders English catalogs", async () => {
  await runtime.initI18n("en");
  assert.equal(i18next.t("common.app.name"), "DeCave");
  assert.equal(runtime.activeLocale(), "en");
});

test("other languages load on demand and fall back to English while untranslated", async () => {
  await runtime.initI18n("el");
  assert.deepEqual(loads, ["el"]);
  assert.equal(runtime.activeLocale(), "el");
  assert.equal(i18next.t("common.app.name"), "DeCave");
  await runtime.initI18n("el");
  assert.deepEqual(loads, ["el"], "catalogs load once");
  await runtime.initI18n("en");
});

test("the pseudo-locale accents English strings", async () => {
  await runtime.initI18n("en-XA");
  const value = i18next.t("common.app.name");
  assert.notEqual(value, "DeCave");
  assert.ok(value.startsWith("[") && value.endsWith("]"), value);
  assert.equal(runtime.activeLocale(), "en", "pseudo counts as English for formatting");
  await runtime.initI18n("en");
  assert.equal(i18next.t("common.app.name"), "DeCave");
});

test("<html lang> follows the UI language; English keeps following the Date style", async () => {
  const hadDocument = "document" in globalThis;
  const previous = globalThis.document;
  globalThis.document = { documentElement: { lang: "en" } };
  try {
    await runtime.initI18n("de");
    runtime.setDateStyleHtmlLang("pl");
    assert.equal(globalThis.document.documentElement.lang, "de", "a Date style does not override German");
    await runtime.initI18n("en");
    assert.equal(globalThis.document.documentElement.lang, "pl", "English shows the Date style language");
    runtime.setDateStyleHtmlLang("fr");
    assert.equal(globalThis.document.documentElement.lang, "fr");
  } finally {
    if (hadDocument) globalThis.document = previous;
    else delete globalThis.document;
  }
});

test("until the picker ships, startup stays English without an explicit choice", () => {
  assert.equal(runtime.startupLocale(), "en");
  assert.equal(runtime.pseudoLocaleAllowed(), false, "no Vite env in tests");
});

test("every non-English locale has a lazy bundle for its catalogs", async () => {
  const { LOCALES } = await import("../../shared/i18n/languages.ts");
  const bundleDir = path.join(root, "src/i18n/bundles");
  assert.deepEqual(
    fs.readdirSync(bundleDir).sort(),
    LOCALES.filter((locale) => locale !== "en")
      .map((locale) => `${locale}.ts`)
      .sort(),
  );
  for (const locale of LOCALES.filter((code) => code !== "en")) {
    const text = fs.readFileSync(path.join(bundleDir, `${locale}.ts`), "utf8");
    assert.ok(text.includes(`/shared/i18n/locales/${locale}/*.json`), locale);
  }
});
