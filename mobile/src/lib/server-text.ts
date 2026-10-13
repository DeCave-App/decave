// Text the server writes for people to read, in the app language: server
// notices ({ notice: { code, params } } next to the English `message`) and
// realtime error frames. Codes: shared/i18n/server-notices.ts. Mirrors the web
// app's src/i18n/notice.ts (the mobile bundle cannot import web src).

import i18next from "i18next";
import { readServerNotice } from "../../../shared/i18n/server-notices.ts";
import { apiErrorText } from "./api-error";

// Codes come from the server at runtime, so they are looked up untyped.
const translate = (key: string, params?: Record<string, string | number>): string =>
  (i18next.t as unknown as (key: string, options?: Record<string, unknown>) => string)(key, params);

/** The notice's text in the app language, or null when there is no known notice. */
export function noticeText(notice: unknown): string | null {
  const parsed = readServerNotice(notice);
  if (!parsed || !i18next.exists(parsed.code)) return null;
  return translate(parsed.code, parsed.params);
}

// Success messages the server still sends only in English (no notice yet), with
// the catalog key holding the same English.
const ENGLISH_SERVER_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  "Account created. Check your email to verify it before logging in.": "auth.mobile.session.accountCreatedVerify",
  "Local test account created. You can sign in now.": "auth.mobile.session.localAccountCreated",
  "If that verified email exists, a reset link has been sent.": "errors.client.auth.resetLinkSent",
};

/**
 * A response body's `message` in the app language: its translated notice, else
 * the translation of a known English message, else the message as sent ("" when none).
 */
export function serverMessageText(data: { message?: unknown; notice?: unknown } | null | undefined): string {
  const notice = noticeText(data?.notice);
  if (notice) return notice;
  const message = typeof data?.message === "string" ? data.message : "";
  const key = ENGLISH_SERVER_MESSAGE_KEYS[message];
  return key && i18next.exists(key) ? translate(key) : message;
}

/**
 * A realtime frame's text: its translated notice, else its translated error
 * code, else the server's English `message`, else `fallback`.
 */
export function realtimeMessage(frame: unknown, fallback: string): string {
  if (!frame || typeof frame !== "object") return fallback;
  const fields = frame as Record<string, unknown>;
  const notice = noticeText(fields.notice);
  if (notice) return notice;
  return apiErrorText(
    {
      i18nKey: fields.i18nKey,
      messageCode: fields.messageCode,
      code: fields.code,
      params: fields.params,
      error: fields.message,
    },
    fallback,
  );
}
