import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// t() keys are checked by the compiler; keys built at runtime (tk(`settings.a.${x}.b`),
// labelKey: "settings....") are checked here against the English catalog.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { flattenCatalog } = await import("../../shared/i18n/check.ts");
const settings = JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales/en/settings.json"), "utf8"));
const keys = [...flattenCatalog(settings)].map(([key]) => `settings.${key.replace(/_(one|other)$/, "")}`);

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const files = [
  ...sources(path.join(root, "src/features/settings")),
  ...sources(path.join(root, "src/app/views/settings")),
  path.join(root, "src/components/session/QuietPresenceSettings.tsx"),
  path.join(root, "src/e2ee/DmEncryptionUi.tsx"),
];

test("every settings key built at runtime exists in the English catalog", () => {
  const missing = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/`(settings\.[A-Za-z0-9_.]*\$\{[^`]*)`/g)) {
      const pattern = new RegExp(
        `^${match[1]
          .split(/\$\{[^}]*\}/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("[A-Za-z0-9_-]+")}$`,
      );
      if (!keys.some((key) => pattern.test(key))) missing.push(`${path.relative(root, file)}: ${match[1]}`);
    }
    for (const match of text.matchAll(/["'](settings\.[A-Za-z0-9_.]+)["']/g)) {
      const key = match[1];
      if (key.endsWith(".")) continue;
      if (!keys.includes(key)) missing.push(`${path.relative(root, file)}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
