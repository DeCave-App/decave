// Hub template names, descriptions and default room/category names in the UI
// language. The Hub is still created with the English names (shared/hub-templates.ts).

import { hubTemplateTextKey, type HubTemplateDefinition } from "../../../shared/hub-templates";
import { i18next } from "../../i18n/index.ts";

const translated = (key: string, english: string): string =>
  i18next.exists(key) ? (i18next.t as unknown as (key: string) => string)(key) : english;

export const templateName = (template: HubTemplateDefinition): string =>
  translated(`hub.templates.names.${template.id}`, template.name);

export const templateDescription = (template: HubTemplateDefinition): string =>
  translated(`hub.templates.descriptions.${template.id}`, template.description);

export const templateRoomName = (name: string): string =>
  translated(`hub.templates.rooms.${hubTemplateTextKey(name)}`, name);

export const templateCategoryName = (category: string): string =>
  translated(`hub.templates.categories.${hubTemplateTextKey(category)}`, category);
