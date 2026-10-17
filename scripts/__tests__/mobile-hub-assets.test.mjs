import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { STICKER_PREFIX, findEmote, parseSticker, stickerMessageText } =
  await import("../../mobile/src/lib/hub-assets.ts");

const pog = { id: "a1", kind: "emote", name: "Pog", mimeType: "image/png", url: "/api/hub-assets/1/a1" };
const wave = { id: "s1", kind: "sticker", name: "wave", mimeType: "image/gif", url: "/api/hub-assets/1/s1" };

test("stickers use web's prefix and round-trip", () => {
  assert.equal(STICKER_PREFIX, "__DECAVE_STICKER__");
  const text = stickerMessageText(wave);
  assert.ok(text.startsWith("__DECAVE_STICKER__{"));
  assert.deepEqual(parseSticker(text), {
    id: "s1",
    kind: "sticker",
    name: "wave",
    mimeType: "image/gif",
    url: "/api/hub-assets/1/s1",
  });
});

test("broken or url-less sticker payloads are not stickers", () => {
  assert.equal(parseSticker("hello"), null);
  assert.equal(parseSticker("__DECAVE_STICKER__{nope"), null);
  assert.equal(parseSticker('__DECAVE_STICKER__{"name":"x"}'), null);
});

test("emotes match :name: case-insensitively and only emotes", () => {
  assert.equal(findEmote([pog, wave], ":pog:"), pog);
  assert.equal(findEmote([pog, wave], ":POG:"), pog);
  assert.equal(findEmote([pog, wave], ":wave:"), null, "stickers are not inline emotes");
  assert.equal(findEmote([pog], "pog"), null);
  assert.equal(findEmote([pog], "::"), null);
});

test("the message token regex is built lazily, with an ASCII fallback", () => {
  const source = fs.readFileSync(
    new URL("../../mobile/src/components/channel/messageFormat.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\/[^/\n]*\p\{L\}[^/\n]*\/[gimsuy]*u/,
    "no Unicode property regex literal at import time",
  );
  assert.match(
    source,
    /catch \{\s*tokenPattern = new RegExp\(String\.raw`\(\$\{LINK_AND_MENTION\}\|:\[A-Za-z0-9_-\]\+:\)`, "gi"\);/,
  );
});
