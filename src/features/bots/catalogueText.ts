// The builder's names for triggers, conditions, actions and their fields, in the
// UI language. shared/bots/catalogue.ts keeps the English (the AI helper reads
// it); bots.catalogue.* in the catalogs mirrors it, and anything added there
// later without a key shows its English until it is translated.
import type { BotCatalogueEntry, BotFieldDescriptor } from "../../../shared/bots/catalogue.ts";
import { i18next } from "../../i18n/index.ts";

export type CatalogueKind = "triggers" | "conditions" | "actions";

function lookup(key: string, english: string): string {
  if (!i18next.exists(key)) return english;
  return (i18next.t as unknown as (key: string) => string)(key);
}

const base = (kind: CatalogueKind, type: string) => `bots.catalogue.${kind}.${type}`;

export const entryLabel = (kind: CatalogueKind, type: string, entry: BotCatalogueEntry) =>
  lookup(`${base(kind, type)}.label`, entry.label);

export const entryDescription = (kind: CatalogueKind, type: string, entry: BotCatalogueEntry) =>
  lookup(`${base(kind, type)}.description`, entry.description);

export const fieldLabel = (kind: CatalogueKind, type: string, field: BotFieldDescriptor) =>
  lookup(`${base(kind, type)}.fields.${field.key}.label`, field.label);

/** The hint without the storage details meant for the AI helper. */
export const fieldHint = (kind: CatalogueKind, type: string, field: BotFieldDescriptor) =>
  lookup(`${base(kind, type)}.fields.${field.key}.hint`, (field.hint ?? "").replace(/ Stored as.*$/, ""));
