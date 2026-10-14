// The mobile app runs on Hermes, which has no Intl.PluralRules, DisplayNames,
// ListFormat, RelativeTimeFormat or Segmenter. A shared module that builds one
// at import time throws, and the route importing it fails to load: 0.1.93 iOS
// crashed opening a Hub because shared/i18n/error-code.ts did exactly that.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MISSING_ON_HERMES = ["PluralRules", "DisplayNames", "ListFormat", "RelativeTimeFormat", "Segmenter"];

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** shared/ TypeScript modules the mobile app imports directly. */
function sharedModulesUsedByMobile() {
  const found = new Set();
  for (const file of [...filesUnder(path.join(root, "mobile/app")), ...filesUnder(path.join(root, "mobile/src"))]) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(/from\s+"((?:\.\.\/)+shared\/[^"]+)"/g)) {
      let target = path.resolve(path.dirname(file), match[1]);
      if (target.endsWith(".json")) continue;
      if (!/\.tsx?$/.test(target)) target += ".ts";
      found.add(target);
    }
  }
  return [...found].sort();
}

test("shared modules the mobile app imports load without the Intl APIs Hermes lacks", () => {
  const modules = sharedModulesUsedByMobile();
  assert.ok(
    modules.some((file) => file.endsWith(path.join("shared", "forum.ts"))),
    "expected shared/forum.ts in the list",
  );
  const script = `
    for (const name of ${JSON.stringify(MISSING_ON_HERMES)}) delete Intl[name];
    const failures = [];
    for (const url of ${JSON.stringify(modules.map((file) => pathToFileURL(file).href))}) {
      try { await import(url); } catch (error) { failures.push(url + ": " + error.message); }
    }
    const { englishErrorText } = await import(${JSON.stringify(pathToFileURL(path.join(root, "shared/i18n/error-code.ts")).href)});
    console.log(JSON.stringify({ failures, plural: typeof englishErrorText }));
  `;
  const out = execFileSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--no-warnings",
      "--loader",
      pathToFileURL(path.join(root, "scripts/test-support/cloudflare-workers-test-loader.mjs")).href,
      "--input-type=module",
      "-e",
      script,
    ],
    { cwd: root, encoding: "utf8" },
  );
  const result = JSON.parse(out.trim().split("\n").pop());
  assert.deepEqual(result.failures, []);
});

test("English error plurals pick one/other without Intl.PluralRules", async () => {
  const saved = Intl.PluralRules;
  try {
    delete Intl.PluralRules;
    const { englishPluralCategory } = await import(`../../shared/i18n/error-code.ts?nointl=${Date.now()}`);
    assert.equal(englishPluralCategory(1), "one");
    assert.equal(englishPluralCategory(0), "other");
    assert.equal(englishPluralCategory(2), "other");
    assert.equal(englishPluralCategory(1.5), "other");
  } finally {
    Intl.PluralRules = saved;
  }
});

test("the mobile Intl polyfill gives i18next Polish and Ukrainian plural forms", () => {
  const script = `
    for (const name of ${JSON.stringify(MISSING_ON_HERMES)}) delete Intl[name];
    await import(${JSON.stringify(pathToFileURL(path.join(root, "mobile/src/lib/intl-polyfills.ts")).href)});
    const { createRequire } = await import("node:module");
    const require = createRequire(${JSON.stringify(pathToFileURL(path.join(root, "mobile/package.json")).href)});
    const i18next = require("i18next");
    const hub = (locale) => JSON.parse(require("node:fs").readFileSync(${JSON.stringify(path.join(root, "shared/i18n/locales"))} + "/" + locale + "/hub.json", "utf8"));
    const i18n = i18next.createInstance();
    await i18n.init({ resources: { pl: { hub: hub("pl") }, uk: { hub: hub("uk") } }, lng: "pl", ns: ["hub"], defaultNS: "hub" });
    const pick = (lng, count) => i18n.getFixedT(lng, "hub")("sidebar.members", { count, value: count });
    console.log(JSON.stringify({ pl: [1, 2, 5, 22].map((n) => pick("pl", n)), uk: [1, 3, 11, 21].map((n) => pick("uk", n)) }));
  `;
  const out = execFileSync(
    process.execPath,
    ["--experimental-transform-types", "--no-warnings", "--input-type=module", "-e", script],
    { cwd: path.join(root, "mobile"), encoding: "utf8" },
  );
  const result = JSON.parse(out.trim().split("\n").pop());
  const keyOf = (locale, suffix) => {
    const members = JSON.parse(
      fs.readFileSync(path.join(root, `shared/i18n/locales/${locale}/hub.json`), "utf8"),
    ).sidebar;
    return (count) => members[`members_${suffix}`].replace("{{value}}", String(count));
  };
  assert.deepEqual(result.pl, [
    keyOf("pl", "one")(1),
    keyOf("pl", "few")(2),
    keyOf("pl", "many")(5),
    keyOf("pl", "few")(22),
  ]);
  assert.deepEqual(result.uk, [
    keyOf("uk", "one")(1),
    keyOf("uk", "few")(3),
    keyOf("uk", "many")(11),
    keyOf("uk", "one")(21),
  ]);
});
