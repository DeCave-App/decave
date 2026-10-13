import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { LOCALES, LANGUAGES, PSEUDO_LOCALE, I18N_PICKER_ENABLED, resolveLocale, isLocale } =
  await import("../../shared/i18n/languages.ts");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");

const localesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../shared/i18n/locales");

test("resolveLocale picks the first supported language", () => {
  assert.equal(resolveLocale(["pt-PT"]), "pt-BR");
  assert.equal(resolveLocale(["pt"]), "pt-BR");
  assert.equal(resolveLocale(["zh-CN", "de-AT"]), "de");
  assert.equal(resolveLocale(["zh"]), "en");
  assert.equal(resolveLocale(["zh-CN"]), "en");
  assert.equal(resolveLocale([]), "en");
  assert.equal(resolveLocale(["EL"]), "el");
  assert.equal(resolveLocale(["pt-br"]), "pt-BR");
  assert.equal(resolveLocale(["", "uk-UA"]), "uk");
});

test("isLocale accepts only the ten supported codes", () => {
  for (const code of LOCALES) assert.equal(isLocale(code), true);
  assert.equal(isLocale("en-XA"), false);
  assert.equal(isLocale("pt"), false);
  assert.equal(isLocale(null), false);
  assert.equal(isLocale(42), false);
});

test("language list matches the locale order and only English is reviewed", () => {
  assert.deepEqual(LOCALES, ["en", "el", "es", "pt-BR", "fr", "nl", "de", "it", "pl", "uk"]);
  assert.deepEqual(
    LANGUAGES.map((language) => language.code),
    LOCALES,
  );
  assert.deepEqual(
    LANGUAGES.filter((language) => language.reviewed).map((language) => language.code),
    ["en"],
  );
  assert.equal(PSEUDO_LOCALE, "en-XA");
  assert.equal(I18N_PICKER_ENABLED, true);
});

test("every locale has one JSON catalog per namespace", () => {
  for (const locale of LOCALES) {
    for (const namespace of NAMESPACES) {
      const file = path.join(localesDir, locale, `${namespace}.json`);
      assert.ok(fs.existsSync(file), `${locale}/${namespace}.json is missing`);
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(typeof parsed, "object");
    }
    const extra = fs
      .readdirSync(path.join(localesDir, locale))
      .filter((name) => !NAMESPACES.includes(name.replace(/\.json$/, "")));
    assert.deepEqual(extra, [], `${locale} has unknown catalog files`);
  }
  assert.deepEqual(fs.readdirSync(localesDir).sort(), [...LOCALES].sort());
});

test("glossary lists the terms kept in English", async () => {
  const glossary = JSON.parse(fs.readFileSync(path.join(localesDir, "..", "glossary.json"), "utf8"));
  for (const term of ["DeCave", "Hub", "PUG", "ClearVoice", "FACEIT", "Steam", "Twitch", "Discord", "OK"]) {
    assert.ok(glossary.keepEnglish.includes(term), term);
  }
  assert.equal(typeof glossary.sameAsEnglish, "object");
});
