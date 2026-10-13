// Pseudo-locale (en-XA): accents every letter and pads each string by 35 % so
// untranslated text and layouts that cannot grow stand out in the app.

const LOWER = "áƀçđéƒĝĥíĵķĺɱñóþǫŕšţúṽŵẋýž";
const UPPER = "ÁƁÇĐÉƑĜĤÍĴĶĹṀÑÓÞǪŔŠŢÚṼŴẊÝŽ";

const ACCENTS = new Map<string, string>();
for (let index = 0; index < 26; index += 1) {
  ACCENTS.set(String.fromCharCode(97 + index), Array.from(LOWER)[index]);
  ACCENTS.set(String.fromCharCode(65 + index), Array.from(UPPER)[index]);
}

/** Parts that must reach i18next untouched: {{placeholders}}, <0>Trans</0> tags and $t(nesting). */
const PROTECTED = /(\{\{[^}]*\}\}|<\/?\d+\s*\/?>|\$t\([^)]*\))/g;

const PADDING_RATIO = 0.35;

function accent(text: string): string {
  let out = "";
  for (const char of text) out += ACCENTS.get(char) ?? char;
  return out;
}

export function pseudoLocalize(value: string): string {
  const body = value
    .split(PROTECTED)
    .map((part, index) => (index % 2 === 1 ? part : accent(part)))
    .join("");
  const padding = "~".repeat(Math.max(1, Math.ceil(value.length * PADDING_RATIO) - 2));
  return `[${body}${padding}]`;
}

export function pseudoCatalog(catalog: Record<string, unknown>): Record<string, unknown> {
  const map = (value: unknown): unknown => {
    if (typeof value === "string") return pseudoLocalize(value);
    if (Array.isArray(value)) return value.map(map);
    if (value && typeof value === "object") return pseudoCatalog(value as Record<string, unknown>);
    return value;
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(catalog)) out[key] = map(value);
  return out;
}
