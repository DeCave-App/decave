// Settings → Language & region → Date style: the languages dates can be
// written in, saved per account as `language`. One for every UI language
// ("pt" is Portuguese, which also covers pt-BR).

export const DATE_STYLE_LANGUAGES = ["en", "pl", "el", "de", "fr", "es", "it", "pt", "nl", "uk"] as const;

export type DateStyleLanguage = (typeof DATE_STYLE_LANGUAGES)[number];

export function isDateStyleLanguage(value: unknown): value is DateStyleLanguage {
  return typeof value === "string" && (DATE_STYLE_LANGUAGES as readonly string[]).includes(value);
}
