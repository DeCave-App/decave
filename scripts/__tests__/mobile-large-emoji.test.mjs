// Mobile large emoji must match desktop's rule (src/features/settings/chatPrefs.ts),
// and fall back to normal size instead of crashing where Unicode property regexes are missing.
import assert from "node:assert/strict";
import { test } from "node:test";

const mobile = await import("../../mobile/src/lib/emoji-only.ts");
const desktop = await import("../../src/features/settings/chatPrefs.ts");

const SAMPLES = [
  "😀",
  "😀😀😀",
  "😀😀😀😀",
  " 🎮  🔥 ",
  "👨‍👩‍👧‍👦",
  "👍🏽",
  "🇬🇷🇵🇱",
  "🏳️‍🌈",
  "1️⃣",
  "❤️",
  ":pog:",
  ":pog: 😀",
  "hi 😀",
  "😀!",
  "123",
  "",
  "   ",
  "gg",
];

test("mobile isEmojiOnly agrees with desktop", () => {
  for (const sample of SAMPLES)
    assert.equal(mobile.isEmojiOnly(sample), desktop.isEmojiOnly(sample), JSON.stringify(sample));
});

test("an engine without Unicode property regexes shows normal size instead of throwing", async () => {
  const Native = RegExp;
  globalThis.RegExp = function (source, flags) {
    if (String(source).includes(String.raw`\p{`)) throw new SyntaxError("Invalid property name");
    return new Native(source, flags);
  };
  try {
    const fresh = await import(`../../mobile/src/lib/emoji-only.ts?noprops=${Date.now()}`);
    assert.equal(fresh.isEmojiOnly("😀"), false);
    assert.equal(fresh.isEmojiOnly("hello"), false);
  } finally {
    globalThis.RegExp = Native;
  }
});
