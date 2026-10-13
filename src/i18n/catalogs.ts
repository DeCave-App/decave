// Vite wiring for the catalogs: English is bundled with the app, every other
// language is one chunk (src/i18n/bundles/<locale>.ts) fetched the first time
// it is used.

import type { Namespace } from "../../shared/i18n/namespaces.ts";
import { setCatalogSource, type Catalog, type Catalogs } from "./index.ts";

const english = import.meta.glob<Catalog>("../../shared/i18n/locales/en/*.json", { eager: true, import: "default" });
const bundles = import.meta.glob<Record<string, Catalog>>("./bundles/*.ts", { import: "default" });

function byNamespace(modules: Record<string, Catalog>): Catalogs {
  return Object.fromEntries(
    Object.entries(modules).map(([path, catalog]) => [
      path.slice(path.lastIndexOf("/") + 1, -".json".length) as Namespace,
      catalog,
    ]),
  );
}

setCatalogSource({
  english: byNamespace(english),
  async load(locale) {
    const bundle = bundles[`./bundles/${locale}.ts`];
    return bundle ? byNamespace(await bundle()) : {};
  },
});
