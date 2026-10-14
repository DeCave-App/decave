// Large emoji (Settings → Chat): a message of one to three emoji and nothing
// else shows bigger, like on desktop (src/features/settings/chatPrefs.ts).
// The Unicode property regexes are built on first use inside try: if the JS
// engine rejected them at import time, every chat screen would fail to load.

const EMOTE = /:[A-Za-z0-9_-]+:/g;

type Patterns = { pictograph: RegExp; notEmoji: RegExp };
let patterns: Patterns | null | undefined;

function emojiPatterns(): Patterns | null {
  if (patterns !== undefined) return patterns;
  try {
    patterns = {
      pictograph: new RegExp("\\p{Extended_Pictographic}|\\p{Regional_Indicator}|⃣", "u"),
      notEmoji: new RegExp("[\\p{L}\\p{N}\\p{P}]", "u"),
    };
  } catch {
    patterns = null;
  }
  return patterns;
}

/** Groups emoji sequences (ZWJ families, flags, skin tones, keycaps) into one symbol each. */
function emojiSymbols(text: string): string[] {
  const symbols: string[] = [];
  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) ?? 0;
    const previous = symbols[symbols.length - 1];
    const joinsPrevious =
      previous !== undefined &&
      (code === 0x200d || // zero-width joiner
        previous.endsWith("‍") ||
        (code >= 0xfe00 && code <= 0xfe0f) || // variation selectors
        (code >= 0x1f3fb && code <= 0x1f3ff) || // skin tones
        code === 0x20e3 || // keycap
        (code >= 0xe0020 && code <= 0xe007f) || // tag sequences
        // Second half of a regional-indicator flag.
        (code >= 0x1f1e6 && code <= 0x1f1ff && isLoneRegionalIndicator(previous)));
    if (joinsPrevious) symbols[symbols.length - 1] = previous + char;
    else symbols.push(char);
  }
  return symbols;
}

function isLoneRegionalIndicator(symbol: string): boolean {
  const chars = Array.from(symbol);
  const code = chars[0]?.codePointAt(0) ?? 0;
  return chars.length === 1 && code >= 0x1f1e6 && code <= 0x1f1ff;
}

/** One to three emoji and nothing else (whitespace ignored); custom :emote: tokens count as emoji. */
export function isEmojiOnly(text: string): boolean {
  const found = emojiPatterns();
  if (!found) return false;
  const emotes = text.match(EMOTE)?.length ?? 0;
  const rest = text.replace(EMOTE, "").replace(/\s+/g, "");
  const symbols = rest ? emojiSymbols(rest) : [];
  for (const symbol of symbols) {
    if (!found.pictograph.test(symbol)) return false;
    // Keycaps start with a digit or # and end with U+20E3; anything else with letters, digits or punctuation is text.
    if (!symbol.includes("⃣") && found.notEmoji.test(symbol)) return false;
  }
  const count = emotes + symbols.length;
  return count >= 1 && count <= 3;
}

/** Text style for an emoji-only message. */
export const LARGE_EMOJI_TEXT = { fontSize: 38, lineHeight: 46 } as const;
