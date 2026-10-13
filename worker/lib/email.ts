// Account emails: verification, password reset, sign-in alerts and email-change notices.
// Each renders in the recipient's saved language (callers pass userLocale()); the
// HTML layout stays here and only the words come from the "email" catalog.

import { DEFAULT_LOCALE, type Locale } from "../../shared/i18n/languages.ts";
import type { Env } from "./env";
import { escapeHtml } from "./http";
import { tWith, workerT } from "./i18n";

const FROM = { email: "security@de-cave.com", name: "DeCave Security" };

/** The account-settings path named in emails, as plain text and as HTML. */
function settingsPath(t: ReturnType<typeof workerT>): { text: string; html: string } {
  const text = t("email.common.settingsPath");
  return { text, html: escapeHtml(text) };
}

/** A sign-in time readable in the recipient's language; English keeps the UTC string. */
function signInTime(at: string, locale: Locale): string {
  const date = new Date(at);
  if (locale === DEFAULT_LOCALE || Number.isNaN(date.getTime())) return date.toUTCString();
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "long", timeZone: "UTC" }).format(date);
  } catch {
    return date.toUTCString();
  }
}

export async function sendVerificationEmail(
  env: Env,
  email: string,
  username: string,
  token: string,
  baseUrl: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const t = workerT(locale);
  // Keep the one-time credential out of the request URL: mail scanners can
  // fetch the page without sending the fragment to the Worker.
  const link = `${baseUrl}/#token=${encodeURIComponent(token)}`;
  await env.EMAIL.send({
    to: email,
    from: FROM,
    subject: t("email.verify.subject"),
    text: tWith(t, "email.verify.text", { username, link }),
    html: `<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2>${t("email.verify.heading")}</h2><p>${tWith(t, "email.common.greeting", { username: escapeHtml(username) })}</p><p>${t("email.verify.body")}</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#5fe1ff;color:#06111b;border-radius:10px;text-decoration:none;font-weight:700">${t("email.verify.button")}</a></p><p>${t("email.verify.expiry")}</p></div>`,
  });
}

export async function sendResetEmail(
  env: Env,
  email: string,
  username: string,
  token: string,
  baseUrl: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const t = workerT(locale);
  const link = `${baseUrl}/api/auth/reset?token=${encodeURIComponent(token)}`;
  await env.EMAIL.send({
    to: email,
    from: FROM,
    subject: t("email.reset.subject"),
    text: tWith(t, "email.reset.text", { username, link }),
    html: `<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2>${t("email.reset.heading")}</h2><p>${tWith(t, "email.common.greeting", { username: escapeHtml(username) })}</p><p>${t("email.reset.body")}</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#8c6cff;color:white;border-radius:10px;text-decoration:none;font-weight:700">${t("email.reset.button")}</a></p><p>${t("email.reset.expiry")}</p></div>`,
  });
}

export async function sendSignInAlertEmail(
  env: Env,
  email: string,
  username: string,
  device: string,
  at: string,
  token: string,
  baseUrl: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const t = workerT(locale);
  const path = settingsPath(t);
  // Tokens in fragments are not sent in HTTP requests or referrer headers.
  const link = `${baseUrl}/api/auth/secure-account#token=${encodeURIComponent(token)}`;
  const when = signInTime(at, locale);
  await env.EMAIL.send({
    to: email,
    from: FROM,
    subject: t("email.signInAlert.subject"),
    text: `${tWith(t, "email.common.greeting", { username })}\n\n${tWith(t, "email.signInAlert.usedOnText", { device })}\n${tWith(t, "email.signInAlert.time", { when })}\n\n${t("email.signInAlert.ifYou")}\n\n${tWith(t, "email.signInAlert.notYouText", { link })}\n\n${tWith(t, "email.signInAlert.turnOffText", { settingsPath: path.text })}`,
    html: `<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2 style="margin-top:0">${t("email.signInAlert.heading")}</h2><p>${tWith(t, "email.common.greeting", { username: escapeHtml(username) })}</p><p>${t("email.signInAlert.usedOn")}</p><p style="padding:12px 14px;border-radius:10px;background:#10182a;border:1px solid #273653"><strong>${escapeHtml(device)}</strong><br><span style="color:#9fb0c8">${escapeHtml(when)}</span></p><p>${t("email.signInAlert.ifYou")}</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#ff6b7d;color:#14060a;border-radius:10px;text-decoration:none;font-weight:700">${t("email.signInAlert.button")}</a></p><p style="color:#9fb0c8;font-size:13px">${tWith(t, "email.signInAlert.footer", { settingsPath: path.html })}</p></div>`,
  });
}

export async function sendEmailChangeNotice(
  env: Env,
  oldEmail: string,
  username: string,
  newEmail: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const t = workerT(locale);
  const path = settingsPath(t);
  await env.EMAIL.send({
    to: oldEmail,
    from: FROM,
    subject: t("email.emailChanged.subject"),
    text: `${tWith(t, "email.common.greeting", { username })}\n\n${tWith(t, "email.emailChanged.changedText", { newEmail })} ${tWith(t, "email.emailChanged.notYou", { settingsPath: path.text })}`,
    html: `<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2 style="margin-top:0">${t("email.emailChanged.heading")}</h2><p>${tWith(t, "email.common.greeting", { username: escapeHtml(username) })}</p><p>${tWith(t, "email.emailChanged.changed", { newEmail: escapeHtml(newEmail) })}</p><p>${tWith(t, "email.emailChanged.notYou", { settingsPath: path.html })}</p></div>`,
  });
}
