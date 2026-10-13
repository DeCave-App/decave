// Emails and push notifications render in the recipient's saved language
// (decave_users.locale); with no saved language the English text is exactly
// what was sent before translation existed.

import assert from "node:assert/strict";
import { register } from "node:module";
import { after, test } from "node:test";
import { D1Mock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const email = await import("../../worker/lib/email.ts");
const { userLocale, userLocales, workerT } = await import("../../worker/lib/i18n.ts");
const policy = await import("../../worker/push-policy.ts");
const { pushPreview } = await import("../../worker/push.ts");
const { dmPushText } = await import("../../worker/lib/dm-e2ee.ts");
const { RESOURCES } = await import("../../shared/i18n/resources.ts");
const { LOCALES } = await import("../../shared/i18n/languages.ts");
const { flattenCatalog } = await import("../../shared/i18n/check.ts");

const db = new D1Mock();
after(() => db.sqlite.close());
const now = new Date().toISOString();
for (const [id, locale] of [
  ["no-locale", null],
  ["portuguese", "pt-BR"],
  ["garbage", "xx-NOPE"],
]) {
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,locale) VALUES(?,?,'s','h',?,?)",
    id,
    `user-${id}`,
    now,
    locale,
  );
}

/** Calls an email sender with a fake mail binding and returns the message it sent. */
async function render(name, args, locale) {
  let sent;
  const env = { EMAIL: { send: async (message) => (sent = message) } };
  await email[name](env, ...args, ...(locale === undefined ? [] : [locale]));
  return sent;
}

const TEMPLATES = {
  verify: ["sendVerificationEmail", ["ann@example.test", "Ann & <Co>", "tok-1", "https://app.example.test"]],
  reset: ["sendResetEmail", ["ann@example.test", "Ann & <Co>", "tok-2", "https://app.example.test"]],
  signInAlert: [
    "sendSignInAlertEmail",
    [
      "ann@example.test",
      "Ann & <Co>",
      "Chrome on Windows",
      "2026-10-13T09:14:00.000Z",
      "tok-3",
      "https://app.example.test",
    ],
  ],
  emailChanged: ["sendEmailChangeNotice", ["old@example.test", "Ann & <Co>", "new@example.test"]],
};

const FROM = { email: "security@de-cave.com", name: "DeCave Security" };

// Captured from worker/lib/email.ts before translation: English must not change by a byte.
const ENGLISH = {
  verify: {
    to: "ann@example.test",
    from: FROM,
    subject: "Verify your DeCave email",
    text: "Hi Ann & <Co>, verify your DeCave email: https://app.example.test/#token=tok-1",
    html: '<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2>Verify your DeCave email</h2><p>Hi Ann &amp; &lt;Co&gt;,</p><p>Confirm this email address to activate your account.</p><p><a href="https://app.example.test/#token=tok-1" style="display:inline-block;padding:12px 18px;background:#5fe1ff;color:#06111b;border-radius:10px;text-decoration:none;font-weight:700">Verify email</a></p><p>This link expires in 24 hours.</p></div>',
  },
  reset: {
    to: "ann@example.test",
    from: FROM,
    subject: "Reset your DeCave password",
    text: "Hi Ann & <Co>, reset your DeCave password: https://app.example.test/api/auth/reset?token=tok-2",
    html: '<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2>Reset your DeCave password</h2><p>Hi Ann &amp; &lt;Co&gt;,</p><p>If you requested a password reset, use the button below.</p><p><a href="https://app.example.test/api/auth/reset?token=tok-2" style="display:inline-block;padding:12px 18px;background:#8c6cff;color:white;border-radius:10px;text-decoration:none;font-weight:700">Reset password</a></p><p>This link expires in 30 minutes.</p></div>',
  },
  signInAlert: {
    to: "ann@example.test",
    from: FROM,
    subject: "New sign-in to your DeCave account",
    text: "Hi Ann & <Co>,\n\nYour DeCave account was just used to sign in on: Chrome on Windows\nTime: Tue, 13 Oct 2026 09:14:00 GMT\n\nIf this was you, you don't need to do anything.\n\nIf it wasn't you, secure your account now (signs out every device and sends a password reset link): https://app.example.test/api/auth/secure-account#token=tok-3\n\nYou can turn these emails off in Settings > Account & security.",
    html: '<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2 style="margin-top:0">New sign-in to DeCave</h2><p>Hi Ann &amp; &lt;Co&gt;,</p><p>Your account was just used to sign in on:</p><p style="padding:12px 14px;border-radius:10px;background:#10182a;border:1px solid #273653"><strong>Chrome on Windows</strong><br><span style="color:#9fb0c8">Tue, 13 Oct 2026 09:14:00 GMT</span></p><p>If this was you, you don\'t need to do anything.</p><p><a href="https://app.example.test/api/auth/secure-account#token=tok-3" style="display:inline-block;padding:12px 18px;background:#ff6b7d;color:#14060a;border-radius:10px;text-decoration:none;font-weight:700">This wasn\'t me</a></p><p style="color:#9fb0c8;font-size:13px">That signs out every device and emails you a password reset link. The link works for 7 days. Turn these emails off in Settings &gt; Account &amp; security.</p></div>',
  },
  emailChanged: {
    to: "old@example.test",
    from: FROM,
    subject: "Your DeCave email address was changed",
    text: "Hi Ann & <Co>,\n\nThe email address on your DeCave account was changed to new@example.test. If you did not make this change, sign in to DeCave, change your password and sign out other devices in Settings > Account & security.",
    html: '<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2 style="margin-top:0">Your DeCave email address changed</h2><p>Hi Ann &amp; &lt;Co&gt;,</p><p>The email address on your account was changed to <strong>new@example.test</strong>.</p><p>If you did not make this change, sign in to DeCave, change your password and sign out other devices in Settings &gt; Account &amp; security.</p></div>',
  },
};

/** A stand-in catalog: every English value prefixed with a marker, placeholders and tags kept. */
function fixtureCatalog(catalog, marker) {
  return Object.fromEntries(
    Object.entries(catalog).map(([key, value]) => [
      key,
      typeof value === "string" ? `${marker} ${value}` : fixtureCatalog(value, marker),
    ]),
  );
}

/** Text that shows a key, a placeholder or an internal marker instead of words. */
function missingKeyOutput(value) {
  return /\b(email|push)\.[a-zA-Z]+\.[a-zA-Z]+|\{\{|\}\}|\u0001|\$t\(/.exec(value);
}

test("no saved locale: every email is today's English, byte for byte", async () => {
  const locale = await userLocale(db, "no-locale");
  assert.equal(locale, "en");
  assert.equal(await userLocale(db, "garbage"), "en", "unsupported stored values read as English");
  assert.equal(await userLocale(db, "missing-user"), "en");
  for (const [template, [name, args]] of Object.entries(TEMPLATES)) {
    assert.deepEqual(await render(name, args, locale), ENGLISH[template], template);
    assert.deepEqual(await render(name, args), ENGLISH[template], `${template} without a locale argument`);
  }
});

test("no saved locale: push titles and bodies are today's English", () => {
  const t = workerT("en");
  const settings = (preview) =>
    policy.pushSettingsFromJson(JSON.stringify({ privacy: { notificationPreview: preview } }));
  assert.deepEqual(policy.pushText(settings("hidden"), "Ann", "#general", "hi", t), {
    title: "DeCave",
    body: "New message in a Hub",
  });
  assert.deepEqual(policy.pushText(settings("hidden"), "Ann", null, "hi", t), {
    title: "DeCave",
    body: "You have a new message",
  });
  assert.deepEqual(policy.pushText(settings("sender"), "Ann", "#general", "hi", t), {
    title: "#general",
    body: "Ann sent a message",
  });
  assert.deepEqual(policy.pushText(settings("sender"), "Ann", null, "hi", t), {
    title: "Ann",
    body: "Ann sent you a message",
  });
  assert.deepEqual(policy.pushText(settings("full"), "Ann", "#general", "hi", t), {
    title: "Ann in #general",
    body: "hi",
  });
  assert.deepEqual(policy.pushText(settings("full"), "Ann", null, "hi", t), { title: "Ann", body: "hi" });
  assert.equal(pushPreview("__DECAVE_GIF__{}", t), "Sent a GIF");
  assert.equal(pushPreview("__DECAVE_DM_ATTACHMENT__{}", t), "Sent an attachment");
  assert.equal(pushPreview("  plain   words  ", t), "plain words");
  assert.equal(dmPushText({ text: "", envelope: "{}" }, t), "Sent you an encrypted message");
  assert.equal(t("push.sender.someone"), "Someone");
  assert.equal(t("push.sender.unknownDirect"), "New message");
});

test("user content is inserted literally, never interpolated as a key or placeholder", async () => {
  const sneaky = "{{link}} $t(email.verify.subject) <b>";
  const sent = await render("sendVerificationEmail", ["a@example.test", sneaky, "tok", "https://app.test"], "en");
  assert.equal(sent.text, `Hi ${sneaky}, verify your DeCave email: https://app.test/#token=tok`);
  assert.match(sent.html, /<p>Hi \{\{link\}\} \$t\(email\.verify\.subject\) &lt;b&gt;,<\/p>/);
  const full = policy.pushSettingsFromJson(JSON.stringify({ privacy: { notificationPreview: "full" } }));
  assert.equal(policy.pushText(full, "{{where}}", "#room", "x", workerT("en")).title, "{{where}} in #room");
});

test("a pt-BR user (fixture catalog) gets pt-BR subjects and push text", async (t) => {
  // Real translations arrive later; inject a marked stand-in for this test only.
  const original = { email: RESOURCES["pt-BR"].email, push: RESOURCES["pt-BR"].push };
  RESOURCES["pt-BR"].email = fixtureCatalog(RESOURCES.en.email, "[pt-BR]");
  RESOURCES["pt-BR"].push = fixtureCatalog(RESOURCES.en.push, "[pt-BR]");
  t.after(() => {
    RESOURCES["pt-BR"].email = original.email;
    RESOURCES["pt-BR"].push = original.push;
  });

  const locale = await userLocale(db, "portuguese");
  assert.equal(locale, "pt-BR");
  for (const [template, [name, args]] of Object.entries(TEMPLATES)) {
    const sent = await render(name, args, locale);
    assert.equal(sent.subject, `[pt-BR] ${ENGLISH[template].subject}`, template);
    assert.equal(sent.to, ENGLISH[template].to);
    assert.deepEqual(sent.from, FROM);
    assert.equal(missingKeyOutput(sent.subject + sent.text + sent.html), null, template);
    // HTML structure is unchanged: same tags in the same order.
    const tags = (html) => html.match(/<[^>]+>/g);
    assert.deepEqual(tags(sent.html), tags(ENGLISH[template].html), `${template} keeps its layout`);
  }
  const alert = await render(...TEMPLATES.signInAlert, locale);
  assert.doesNotMatch(alert.text, /GMT/, "sign-in time is formatted for the recipient's language");

  const locales = await userLocales(db, ["portuguese", "no-locale", "garbage", "missing-user"]);
  assert.deepEqual(Object.fromEntries(locales), {
    portuguese: "pt-BR",
    "no-locale": "en",
    garbage: "en",
    "missing-user": "en",
  });
  const pt = workerT(locales.get("portuguese"));
  const hidden = policy.pushSettingsFromJson(null);
  assert.deepEqual(policy.pushText(hidden, "Ann", "#general", "hi", pt), {
    title: "DeCave",
    body: "[pt-BR] New message in a Hub",
  });
  const full = policy.pushSettingsFromJson(JSON.stringify({ privacy: { notificationPreview: "full" } }));
  assert.deepEqual(policy.pushText(full, "Ann", "#general", "hi", pt), {
    title: "[pt-BR] Ann in #general",
    body: "hi",
  });
  assert.equal(pushPreview("__DECAVE_GIF__{}", pt), "[pt-BR] Sent a GIF");
  assert.equal(dmPushText({ text: "", envelope: "{}" }, pt), "[pt-BR] Sent you an encrypted message");
});

test("every email and push text renders in all 10 locales without missing-key output", async () => {
  const englishEmailKeys = [...flattenCatalog(RESOURCES.en.email).keys()];
  const englishPushKeys = [...flattenCatalog(RESOURCES.en.push).keys()];
  assert.ok(englishEmailKeys.length > 0 && englishPushKeys.length > 0);
  for (const locale of LOCALES) {
    const t = workerT(locale);
    const translatedEmail = flattenCatalog(RESOURCES[locale].email ?? {});
    for (const [template, [name, args]] of Object.entries(TEMPLATES)) {
      const sent = await render(name, args, locale);
      for (const field of ["subject", "text", "html"]) {
        assert.equal(typeof sent[field], "string", `${locale} ${template} ${field}`);
        assert.ok(sent[field].length > 0, `${locale} ${template} ${field}`);
        assert.equal(missingKeyOutput(sent[field]), null, `${locale} ${template} ${field}: ${sent[field]}`);
      }
      // An untranslated catalog falls back to English.
      if (!translatedEmail.has(`${template}.subject`)) {
        assert.equal(sent.subject, ENGLISH[template].subject, `${locale} ${template} falls back to English`);
      }
    }
    for (const key of [...englishEmailKeys.map((k) => `email.${k}`), ...englishPushKeys.map((k) => `push.${k}`)]) {
      const value = t(key, {
        username: "u",
        link: "l",
        device: "d",
        when: "w",
        settingsPath: "s",
        newEmail: "n",
        sender: "x",
        where: "y",
        place: "c",
        game: "g",
        text: "t",
        count: 2,
      });
      assert.equal(missingKeyOutput(value), null, `${locale} ${key}: ${value}`);
    }
    for (const preview of ["hidden", "sender", "full"]) {
      const settings = policy.pushSettingsFromJson(JSON.stringify({ privacy: { notificationPreview: preview } }));
      for (const where of ["#general", null]) {
        const { title, body } = policy.pushText(settings, "Ann", where, pushPreview("__DECAVE_GIF__", t), t);
        assert.equal(missingKeyOutput(title + body), null, `${locale} push ${preview}`);
        assert.ok(title && body);
      }
    }
  }
});
