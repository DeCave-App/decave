// Loads the English catalogs into the i18next instance the mobile app's modules
// import (mobile/node_modules when installed, else the root one), so tests that
// run mobile code see the same English text the app shows.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");

// Resolve the package's ESM entry the way an `import "i18next"` from mobile/src
// would, so this is the same module instance the mobile code gets.
const fromMobile = createRequire(path.join(root, "mobile/src/lib/api.ts"));
const manifestPath = fromMobile.resolve("i18next/package.json");
const entry = JSON.parse(fs.readFileSync(manifestPath, "utf8")).exports["."].import;
const entryPath = path.join(path.dirname(manifestPath), typeof entry === "string" ? entry : entry.default);
const { default: i18next } = await import(pathToFileURL(entryPath).href);

const english = Object.fromEntries(
  NAMESPACES.map((ns) => [
    ns,
    JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales/en", `${ns}.json`), "utf8")),
  ]),
);

if (!i18next.isInitialized) {
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    ns: [...NAMESPACES],
    defaultNS: "common",
    nsSeparator: ".",
    keySeparator: ".",
    resources: { en: english },
    interpolation: { escapeValue: false },
    returnNull: false,
  });
} else {
  for (const [ns, catalog] of Object.entries(english)) i18next.addResourceBundle("en", ns, catalog, true, true);
}

export default i18next;
