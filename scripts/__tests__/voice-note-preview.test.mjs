import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { dmPreviewText } from "../../shared/dm-message-preview.ts";
import { pinPreview } from "../../src/features/pins/pinPreview.ts";
const { voicePushPreview, pushPreview } = await import("../../worker/push.ts");
const { workerT } = await import("../../worker/lib/i18n.ts");

const LOCALES = fs.readdirSync(new URL("../../shared/i18n/locales", import.meta.url));
import { encodeWave } from "../../shared/voice-note.ts";
const WAVE = encodeWave(new Array(64).fill(0.5));
const voiceAttachment = (ms) =>
  `__DECAVE_DM_ATTACHMENT__${JSON.stringify({ name: "Voice message.webm", voice: { ms, wave: WAVE } })}`;

test("DM preview of a voice note is the voice string, not the file name", () => {
  assert.equal(dmPreviewText(voiceAttachment(42000)), "🎤 Voice message (0:42)");
  assert.equal(dmPreviewText(voiceAttachment(120000)), "🎤 Voice message (2:00)");
});

test("an ordinary attachment keeps its file name preview", () => {
  const plain = `__DECAVE_DM_ATTACHMENT__${JSON.stringify({ name: "a.png" })}`;
  assert.equal(dmPreviewText(plain), "📎 a.png");
});

test("pin preview of a Hub voice note", () => {
  const preview = pinPreview({
    text: "",
    attachment: { name: "Voice message.webm", mimeType: "audio/webm", voice: { ms: 42000, wave: WAVE } },
  });
  assert.equal(preview, "🎤 Voice message (0:42)");
});

test("every locale has chat.voice.preview with the duration placeholder", () => {
  for (const locale of LOCALES) {
    const chat = JSON.parse(
      fs.readFileSync(new URL(`../../shared/i18n/locales/${locale}/chat.json`, import.meta.url), "utf8"),
    );
    assert.match(chat.voice.preview ?? "", /\{\{duration\}\}/, locale);
  }
});

test("Hub voice-note push uses the same string in the recipient's language", () => {
  assert.equal(voicePushPreview(42000, workerT("en")), "🎤 Voice message (0:42)");
  assert.notEqual(voicePushPreview(42000, workerT("de")), voicePushPreview(42000, workerT("en")));
  assert.match(voicePushPreview(42000, workerT("el")), /0:42/);
});

test("DM payloads stay generic in pushes", () => {
  assert.equal(pushPreview(voiceAttachment(42000), workerT("en")), "Sent an attachment");
});

test("a hostile voice duration over 2:00 falls back to the file name preview", () => {
  assert.equal(dmPreviewText(voiceAttachment(120001)), "📎 Voice message.webm");
  assert.equal(dmPreviewText(voiceAttachment(999_999_999)), "📎 Voice message.webm");
});
