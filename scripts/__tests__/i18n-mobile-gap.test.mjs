// Mobile text that comes from the server or from shared helpers goes through the
// catalogs, and its English stays exactly what the app showed before.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register("../test-support/mobile-extensionless-loader.mjs", import.meta.url);
// The same i18next instance the mobile modules import, loaded with the English catalogs.
const { default: i18next } = await import("../test-support/mobile-i18n-english.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { apiErrorText } = await import("../../mobile/src/lib/api-error.ts");
const { noticeText, realtimeMessage, serverMessageText } = await import("../../mobile/src/lib/server-text.ts");
const { dateLocale } = await import("../../mobile/src/lib/date-locale.ts");
const { e2eeErrorText } = await import("../../mobile/src/lib/e2ee-error-text.ts");
const { DmCryptoError } = await import("../../mobile/src/lib/e2ee/dm-e2ee.ts");
const { UNKNOWN_DEVICE_LABEL } = await import("../../shared/dm-e2ee-session.ts");
const { dmPreviewText, ENGLISH_DM_PREVIEW_LABELS } = await import("../../shared/dm-message-preview.ts");
const { accountExportStatus } = await import("../../mobile/src/lib/account-export.ts");
const { botMessageNotice, formFromResponse, UNTITLED_FORM_KEY, UNTITLED_FORM_TITLE } =
  await import("../../shared/bots/card-view.ts");

const t = (key, params) => i18next.t(key, params);

test("API errors prefer i18nKey, then messageCode, then code, then the server text", () => {
  assert.equal(
    apiErrorText({ i18nKey: "errors.account.localeInvalid", code: "mobile.requestFailed", error: "x" }, "f"),
    "Choose a supported language.",
  );
  assert.equal(apiErrorText({ i18nKey: "account.localeInvalid", error: "x" }, "f"), "Choose a supported language.");
  assert.equal(
    apiErrorText({ i18nKey: "chat.server.roomReadOnly", params: { room: "general" } }, "f"),
    "#general is read-only.",
  );
  assert.equal(
    apiErrorText({ messageCode: "account.localeInvalid", code: "LOCALE", error: "x" }, "f"),
    "Choose a supported language.",
  );
  assert.equal(apiErrorText({ code: "mobile.requestFailed", params: { status: 502 } }, "f"), "Request failed (502)");
  assert.equal(apiErrorText({ i18nKey: "nope.missing", code: "UNKNOWN", error: "Server text" }, "f"), "Server text");
  // A code naming a whole catalog section is not a message.
  assert.equal(apiErrorText({ code: "mobile", error: "Server text" }, "f"), "Server text");
  assert.equal(apiErrorText(null, "fallback"), "fallback");
});

test("realtime notices render from the catalog, with the English message as fallback", () => {
  const frame = {
    type: "ERROR",
    message: "#general is read-only.",
    notice: { code: "chat.server.roomReadOnly", params: { room: "general" } },
  };
  assert.equal(realtimeMessage(frame, "fallback"), "#general is read-only.");
  assert.equal(noticeText({ code: "not.a.notice" }), null);
  assert.equal(realtimeMessage({ type: "VOICE_ERROR", message: "Old server text" }, "fallback"), "Old server text");
  assert.equal(realtimeMessage({ type: "VOICE_ERROR" }, "fallback"), "fallback");
});

test("known English server messages read from the catalog unchanged", () => {
  for (const message of [
    "Account created. Check your email to verify it before logging in.",
    "Local test account created. You can sign in now.",
    "If that verified email exists, a reset link has been sent.",
  ]) {
    assert.equal(serverMessageText({ message }), message);
  }
  assert.equal(serverMessageText({ message: "Something new" }), "Something new");
  assert.equal(serverMessageText({}), "");
});

test("dates use the UI language, and the device format in English", async () => {
  assert.equal(dateLocale(), undefined);
  await i18next.changeLanguage("de");
  try {
    assert.equal(dateLocale(), "de");
  } finally {
    await i18next.changeLanguage("en");
  }
});

test("bot notices and untitled forms read from the catalog", () => {
  const text = `__DECAVE_BOT__${JSON.stringify({ botId: "b", name: "Bot", text: "Usage: /roll", notice: { code: "bots.server.commandUsage", params: { usage: "/roll" } } })}`;
  assert.deepEqual(botMessageNotice(text), { code: "bots.server.commandUsage", params: { usage: "/roll" } });
  assert.equal(botMessageNotice("plain"), null);
  assert.equal(t(UNTITLED_FORM_KEY), UNTITLED_FORM_TITLE);
  assert.equal(formFromResponse({ form: { formId: "f", fields: [] } }).title, "Form");
  assert.equal(formFromResponse({ form: { formId: "f", fields: [] } }, "Formular").title, "Formular");
});

test("DM list previews have catalog labels with the same English", () => {
  const labels = {
    gif: () => t("dm.preview.gif"),
    attachment: () => t("dm.preview.attachment"),
    namedAttachment: (name) => t("dm.preview.namedAttachment", { name }),
    poll: () => t("dm.preview.poll"),
    pollQuestion: (question) => t("dm.preview.pollQuestion", { question }),
    message: () => t("dm.preview.message"),
    encrypted: () => t("dm.preview.encrypted"),
  };
  for (const text of [
    '__DECAVE_GIF__{"url":"x"}',
    '__DECAVE_DM_ATTACHMENT__{"name":"a {{b}}.png"}',
    "__DECAVE_DM_ATTACHMENT__{}",
    '__DECAVE_POLL__{"question":"Pizza?"}',
    "__DECAVE_POLL__{}",
    "__DECAVE_OTHER__",
    "hello",
  ]) {
    assert.equal(dmPreviewText(text, labels), dmPreviewText(text), text);
  }
  assert.equal(labels.encrypted(), ENGLISH_DM_PREVIEW_LABELS.encrypted());
  assert.equal(t("dm.e2ee.approve.unnamedDevice"), UNKNOWN_DEVICE_LABEL);
});

test("DM encryption crypto errors carry keys whose English is the message", () => {
  const internal = new Set([
    "An account key is 32 bytes.",
    "A keyring holds 1 to 120 keys.",
    "Bad stream key.",
    "Too many recipients.",
  ]);
  const messages = new Set();
  for (const file of ["shared/dm-e2ee.ts", "shared/dm-e2ee-session.ts"]) {
    for (const match of fs.readFileSync(path.join(root, file), "utf8").matchAll(/new DmCryptoError\("([^"]+)"/g)) {
      messages.add(match[1]);
    }
  }
  assert.ok(messages.size > 10);
  for (const message of messages) {
    const error = new DmCryptoError(message, "decrypt-failed");
    if (internal.has(message)) {
      assert.equal(error.key, null, message);
      continue;
    }
    assert.match(error.key ?? "", /^dm\.e2ee\.errors\.crypto\./, message);
    assert.equal(t(error.key), message);
    assert.equal(e2eeErrorText(error, "fallback"), message);
  }
});

test("account export errors carry keys whose English is the message", () => {
  const unfinished = accountExportStatus('{"a":[');
  assert.equal(unfinished.errorKey, "settings.accountExport.unfinished");
  assert.equal(t(unfinished.errorKey), unfinished.error);
  const failed = accountExportStatus(
    '],"complete":false,"error":"The export could not be completed. Retry the download."}',
  );
  assert.equal(failed.errorKey, "settings.accountExport.failed");
  assert.equal(t(failed.errorKey), failed.error);
  assert.equal(accountExportStatus('],"complete":false,"error":"Other"}').errorKey, undefined);
});
