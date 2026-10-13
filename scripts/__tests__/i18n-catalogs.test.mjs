import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const { checkCatalogs, onlyKeptEnglish, REQUIRE_COMPLETE } = await import("../../shared/i18n/check.ts");
const { LOCALES } = await import("../../shared/i18n/languages.ts");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");

const localesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../shared/i18n/locales");
const glossary = {
  keepEnglish: ["DeCave", "Hub", "OK", "Epic Games"],
  sameAsEnglish: { es: ["common.app.allowed"] },
};

const english = {
  common: {
    app: { name: "DeCave", greeting: "Hi {{name}}", link: "Read <1>the rules</1>", allowed: "Online" },
    items_one: "{{count}} item",
    items_other: "{{count}} items",
  },
};
const goodEs = {
  common: {
    app: { name: "DeCave", greeting: "Hola {{name}}", link: "Lee <1>las reglas</1>", allowed: "Online" },
    items_one: "{{count}} elemento",
    items_many: "{{count}} elementos",
    items_other: "{{count}} elementos",
  },
};
const rulesOf = (problems) => problems.map((problem) => `${problem.rule}:${problem.locale}:${problem.key}`).sort();
const run = (locales, requireComplete = false) =>
  checkCatalogs({ en: english, ...locales }, { requireComplete, glossary });

test("a correct translation passes", () => {
  assert.deepEqual(run({ es: goodEs }), []);
});

test("a translated placeholder name fails", () => {
  const es = structuredClone(goodEs);
  es.common.app.greeting = "Hola {{nombre}}";
  assert.deepEqual(rulesOf(run({ es })), ["placeholders:es:common.app.greeting"]);
});

test("a dropped or renamed Trans tag fails", () => {
  const es = structuredClone(goodEs);
  es.common.app.link = "Lee las reglas";
  assert.deepEqual(rulesOf(run({ es })), ["tags:es:common.app.link"]);
});

test("a missing plural form fails", () => {
  const pl = {
    common: {
      app: { name: "DeCave", greeting: "Cześć {{name}}", link: "Przeczytaj <1>zasady</1>", allowed: "Dostępny" },
      items_one: "{{count}} element",
      items_many: "{{count}} elementów",
      items_other: "{{count}} elementu",
    },
  };
  const problems = run({ pl });
  assert.deepEqual(rulesOf(problems), ["plurals:pl:common.items"]);
  assert.match(problems[0].message, /few/);
});

test("an empty value fails", () => {
  const es = structuredClone(goodEs);
  es.common.app.greeting = "";
  assert.deepEqual(rulesOf(run({ es })), ["empty:es:common.app.greeting"]);
});

test("a value left in English fails unless the glossary allows it", () => {
  const es = structuredClone(goodEs);
  es.common.app.greeting = "Hi {{name}}";
  assert.deepEqual(rulesOf(run({ es })), ["sameAsEnglish:es:common.app.greeting"]);
  // The same "Online" is fine for es (allowlisted key) and DeCave is a kept-English word.
  const fr = structuredClone(goodEs);
  fr.common.app.allowed = "Online";
  assert.deepEqual(
    rulesOf(run({ fr })).filter((rule) => rule.startsWith("sameAsEnglish")),
    ["sameAsEnglish:fr:common.app.allowed"],
  );
});

test("missing and unknown keys fail", () => {
  const es = structuredClone(goodEs);
  delete es.common.app.link;
  es.common.app.extra = "Extra";
  assert.deepEqual(rulesOf(run({ es })), ["missing:es:common.app.link", "unknown:es:common.app.extra"]);
});

test("empty locale files are allowed until translations are required", () => {
  assert.deepEqual(run({ es: { common: {} } }), []);
  const problems = run({ es: { common: {} } }, true);
  assert.ok(problems.length > 0);
  assert.ok(problems.every((problem) => problem.rule === "missing" || problem.rule === "plurals"));
});

test("a key that only ends in _one is not a plural", () => {
  const withEvent = structuredClone(english);
  withEvent.common.session_revoked_one = "Signed out one session";
  const es = structuredClone(goodEs);
  es.common.session_revoked_one = "Se cerró una sesión";
  const pl = {
    common: {
      app: { name: "DeCave", greeting: "Cześć {{name}}", link: "Przeczytaj <1>zasady</1>", allowed: "Dostępny" },
      items_one: "{{count}} element",
      items_few: "{{count}} elementy",
      items_many: "{{count}} elementów",
      items_other: "{{count}} elementu",
      session_revoked_one: "Wylogowano jedną sesję",
    },
  };
  assert.deepEqual(checkCatalogs({ en: withEvent, es, pl }, { requireComplete: true, glossary }), []);
});

test("every translation is required", () => {
  assert.equal(REQUIRE_COMPLETE, true);
});

test("onlyKeptEnglish ignores brands, numbers, symbols and placeholders", () => {
  assert.equal(onlyKeptEnglish("DeCave", glossary.keepEnglish), true);
  assert.equal(onlyKeptEnglish("{{count}} × Epic Games!", glossary.keepEnglish), true);
  assert.equal(onlyKeptEnglish("OK", glossary.keepEnglish), true);
  assert.equal(onlyKeptEnglish("Hubs", glossary.keepEnglish), false);
  assert.equal(onlyKeptEnglish("Open DeCave", glossary.keepEnglish), false);
});

test("the shipped catalogs pass every rule", () => {
  const catalogs = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      Object.fromEntries(
        NAMESPACES.map((ns) => [ns, JSON.parse(fs.readFileSync(path.join(localesDir, locale, `${ns}.json`), "utf8"))]),
      ),
    ]),
  );
  assert.deepEqual(checkCatalogs(catalogs, { requireComplete: REQUIRE_COMPLETE }), []);
});
