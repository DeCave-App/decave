// Loads the English catalogs into the app's translation runtime, so tests that run
// app code see the same English text the app shows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");
const runtime = await import("../../src/i18n/index.ts");

const english = Object.fromEntries(
  NAMESPACES.map((ns) => [
    ns,
    JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales/en", `${ns}.json`), "utf8")),
  ]),
);
runtime.setCatalogSource({ english, load: async () => ({}) });
await runtime.initI18n("en", { setHtmlLang: false });
