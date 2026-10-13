// Hub categories in the UI language (see shared/hub-categories.ts).

import { hubCategoryFieldText, hubCategoryLabel, hubCategoryValue } from "../../../shared/hub-categories";
import { i18next } from "../i18n";

const translate = (key: string): string => (i18next.t as unknown as (key: string) => string)(key);

/** A stored Hub category as shown to the user: built-in names translated, custom ones as typed. */
export const hubCategoryText = (category: string): string => hubCategoryLabel(category, translate);

/** A Hub category field's text: the stored value, with an exact built-in name translated. */
export const hubCategoryField = (value: string): string => hubCategoryFieldText(value, translate);

/** The value to save for text typed into a Hub category field. */
export const hubCategoryInput = (input: string): string => hubCategoryValue(input, translate);
