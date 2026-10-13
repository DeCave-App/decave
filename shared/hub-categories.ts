// Hub categories are stored as the text the owner typed ("Gaming" by default).
// The built-in English names below are shown in the UI language; anything else
// is the owner's own text and is shown as typed.

/** The category a Hub gets when none is set (the database default). */
export const DEFAULT_HUB_CATEGORY = "Gaming";

/** Built-in categories: catalog id -> stored English value. */
export const BUILT_IN_HUB_CATEGORIES = {
  gaming: "Gaming",
  community: "Community",
  racing: "Racing",
  creative: "Creative",
  music: "Music",
} as const;

export type HubCategoryId = keyof typeof BUILT_IN_HUB_CATEGORIES;

const byLowerValue = new Map<string, HubCategoryId>(
  (Object.entries(BUILT_IN_HUB_CATEGORIES) as [HubCategoryId, string][]).map(([id, value]) => [
    value.toLowerCase(),
    id,
  ]),
);

/** The built-in category a stored value names, or null for a custom category. */
export function builtInHubCategory(value: string | null | undefined): HubCategoryId | null {
  return byLowerValue.get((value ?? "").trim().toLowerCase()) ?? null;
}

type Translate = (key: string) => string;

/** A stored category in the UI language: built-in names translated, custom ones as typed. */
export function hubCategoryLabel(value: string, t: Translate): string {
  const id = builtInHubCategory(value);
  return id ? t(`hub.hubCategories.${id}`) : value;
}

/**
 * A category field's text: only an exact built-in value is shown translated,
 * so what someone is typing is never rewritten under them.
 */
export function hubCategoryFieldText(value: string, t: Translate): string {
  const id = builtInHubCategory(value);
  return id && BUILT_IN_HUB_CATEGORIES[id] === value ? t(`hub.hubCategories.${id}`) : value;
}

/**
 * The value to store for text typed into a category field: a translated
 * built-in name is saved as its English value, so every language shows it
 * in its own words; anything else is saved as typed.
 */
export function hubCategoryValue(input: string, t: Translate): string {
  const lower = input.trim().toLowerCase();
  for (const [id, value] of Object.entries(BUILT_IN_HUB_CATEGORIES) as [HubCategoryId, string][]) {
    const label = t(`hub.hubCategories.${id}`);
    if (label !== value && label.toLowerCase() === lower) return value;
  }
  return input;
}
