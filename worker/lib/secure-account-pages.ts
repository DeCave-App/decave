// Pages for "This wasn't me" in a sign-in alert email (/api/auth/secure-account).
// They render in the account's saved language when the link resolves to an
// account, else the browser's Accept-Language (see link-pages.ts).

import { DEFAULT_LOCALE, type Locale } from "../../shared/i18n/languages.ts";
import { parseSessionDeviceLabel, sessionDeviceText } from "../../shared/session-device";
import { workerT } from "./i18n";

/** HTML-escapes text placed between tags; quotes stay as typed. */
const escapeText = (value: string) =>
  value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char);

const escapeAttribute = (value: string) => escapeText(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, private",
  "referrer-policy": "no-referrer",
};

type Translate = (key: string, options?: Record<string, string>) => string;

function translator(locale: Locale): Translate {
  return workerT(locale) as unknown as Translate;
}

const htmlLang = (locale: Locale) => (locale === DEFAULT_LOCALE ? "" : ` lang="${escapeAttribute(locale)}"`);

const heading = (text: string) => `<h1 style="margin-top:0">${escapeText(text)}</h1>`;
const paragraph = (text: string) => `<p>${escapeText(text)}</p>`;

/** A stored device label in the page's language; labels the Worker did not write show as stored. */
function deviceText(locale: Locale, label: string): string {
  const device = parseSessionDeviceLabel(label);
  return device ? sessionDeviceText(device, translator(locale), locale, label) : label;
}

export type SecureAccountPrompt = { kind: "noToken" } | { kind: "expired" } | { kind: "device"; deviceLabel: string };

/** GET: explains what continuing does, with the button that POSTs the token. */
export function secureAccountPromptPage(locale: Locale, token: string, prompt: SecureAccountPrompt): Response {
  const t = translator(locale);
  let body: string;
  if (prompt.kind === "expired") {
    body = heading(t("auth.secureAccount.expiredTitle")) + paragraph(t("auth.secureAccount.expiredHelp"));
  } else if (prompt.kind === "device") {
    const marker = "\u0001device\u0001";
    const sentence = escapeText(t("auth.secureAccount.signedInOn", { device: marker })).replace(
      marker,
      `<strong>${escapeText(deviceText(locale, prompt.deviceLabel))}</strong>`,
    );
    body =
      heading(t("auth.secureAccount.title")) + `<p>${sentence}</p>` + paragraph(t("auth.secureAccount.continueHelp"));
  } else {
    body = heading(t("auth.secureAccount.title")) + paragraph(t("auth.secureAccount.continueHelp"));
  }
  const invalid = escapeAttribute(t("auth.secureAccount.invalidLink"));
  return new Response(
    `<!doctype html><html${htmlLang(locale)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeText(t("auth.secureAccount.pageTitle"))}</title></head><body style="margin:0;background:#080d18;color:#eef4ff;font-family:Arial;display:grid;place-items:center;min-height:100vh"><div style="width:min(460px,calc(100vw - 40px));background:#10182a;border:1px solid #273653;border-radius:16px;padding:28px;box-sizing:border-box">${body}<form method="post" action="/api/auth/secure-account" data-email-action="secure"><input id="secure-account-token" name="token" type="hidden" value="${escapeAttribute(token)}"><button data-invalid-text="${invalid}" style="width:100%;margin-top:8px;padding:12px;border:0;border-radius:10px;background:#ff6b7d;color:#14060a;font-weight:800">${escapeText(t("auth.secureAccount.button"))}</button></form></div><script src="/api/auth/secure-account.js" defer></script></body></html>`,
    { headers: HEADERS },
  );
}

/** The script for the GET page; the "invalid link" text comes from the page's button. */
export const SECURE_ACCOUNT_SCRIPT = `const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";\nif (location.hash) history.replaceState(history.state, "", location.pathname + location.search);\nconst input = document.getElementById("secure-account-token");\nif (input && token) input.value = token;\nconst form = document.querySelector('form[data-email-action="secure"]');\nconst button = form && form.querySelector("button");\nif (button && !input?.value) { button.disabled = true; button.textContent = button.dataset.invalidText || "Invalid or expired link"; }`;

export type SecureAccountResult = "expired" | "notFound" | { mailed: boolean };

/** POST: the outcome of securing the account. */
export function secureAccountResultPage(locale: Locale, result: SecureAccountResult, status = 200): Response {
  const t = translator(locale);
  const body =
    result === "expired"
      ? heading(t("auth.secureAccount.expiredTitle")) + paragraph(t("auth.secureAccount.expiredShort"))
      : result === "notFound"
        ? heading(t("auth.secureAccount.notFound"))
        : heading(t("auth.secureAccount.securedTitle")) +
          paragraph(t("auth.secureAccount.signedOut")) +
          paragraph(t(result.mailed ? "auth.secureAccount.resetMailed" : "auth.secureAccount.resetInApp")) +
          `<p style="color:#9fb0c8">${escapeText(t("auth.secureAccount.turnOnTwoFactor"))}</p>`;
  return new Response(
    `<!doctype html><html${htmlLang(locale)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeText(t("auth.secureAccount.securedPageTitle"))}</title></head><body style="margin:0;background:#080d18;color:#eef4ff;font-family:Arial;display:grid;place-items:center;min-height:100vh"><div style="width:min(460px,calc(100vw - 40px));background:#10182a;border:1px solid #273653;border-radius:16px;padding:28px;box-sizing:border-box">${body}</div></body></html>`,
    { status, headers: HEADERS },
  );
}
