import assert from "node:assert/strict";
import { test } from "node:test";

const { shouldSend, isEmojiOnly, normalizeChatPrefs, DEFAULT_CHAT_PREFS } =
  await import("../../src/features/settings/chatPrefs.ts");

const key = (patch = {}) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, ...patch });

test("defaults are today's behaviour", () => {
  assert.deepEqual(DEFAULT_CHAT_PREFS, {
    sendWith: "enter",
    animate: "always",
    largeEmoji: true,
    spoilers: "click",
    spellcheck: true,
  });
  assert.deepEqual(normalizeChatPrefs(undefined), DEFAULT_CHAT_PREFS);
  assert.deepEqual(normalizeChatPrefs({ sendWith: "ctrlEnter", animate: "nope", largeEmoji: false }), {
    ...DEFAULT_CHAT_PREFS,
    sendWith: "ctrlEnter",
    largeEmoji: false,
  });
});

test("Enter mode: Enter sends, Shift+Enter is a new line, Ctrl/Cmd+Enter sends", () => {
  const prefs = { ...DEFAULT_CHAT_PREFS, sendWith: "enter" };
  assert.equal(shouldSend(key(), prefs), true);
  assert.equal(shouldSend(key({ shiftKey: true }), prefs), false);
  assert.equal(shouldSend(key({ ctrlKey: true }), prefs), true);
  assert.equal(shouldSend(key({ metaKey: true }), prefs), true);
  assert.equal(shouldSend(key({ key: "a" }), prefs), false);
});

test("Ctrl+Enter mode: only Ctrl/Cmd+Enter sends", () => {
  const prefs = { ...DEFAULT_CHAT_PREFS, sendWith: "ctrlEnter" };
  assert.equal(shouldSend(key(), prefs), false);
  assert.equal(shouldSend(key({ shiftKey: true }), prefs), false);
  assert.equal(shouldSend(key({ ctrlKey: true }), prefs), true);
  assert.equal(shouldSend(key({ metaKey: true }), prefs), true);
  assert.equal(shouldSend(key({ ctrlKey: true, shiftKey: true }), prefs), false);
});

test("emoji-only messages: one to three emoji or :emotes:", () => {
  assert.equal(isEmojiOnly("😀😀"), true);
  assert.equal(isEmojiOnly(" 😀 "), true);
  assert.equal(isEmojiOnly("😀 hi"), false);
  assert.equal(isEmojiOnly("😀😀😀😀"), false);
  assert.equal(isEmojiOnly(":gg:"), true);
  assert.equal(isEmojiOnly(":gg: 🎉"), true);
  assert.equal(isEmojiOnly("👍🏽"), true, "skin tones are part of one emoji");
  assert.equal(isEmojiOnly("👨‍👩‍👧"), true, "a family is one emoji");
  assert.equal(isEmojiOnly("🇬🇷"), true, "a flag is one emoji");
  assert.equal(isEmojiOnly("123"), false);
  assert.equal(isEmojiOnly(""), false);
  assert.equal(isEmojiOnly("#"), false);
});
