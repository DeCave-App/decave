// Translation runtime for the mobile app: one i18next instance shared with
// react-i18next, every catalog bundled (shared/i18n/resources.ts), and the
// language choice (account, then this device, then the device language).

import { useEffect, useRef } from "react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";
import * as SecureStore from "expo-secure-store";
import {
  DEFAULT_LOCALE,
  I18N_PICKER_ENABLED,
  isLocale,
  resolveLocale,
  type Locale,
} from "../../shared/i18n/languages.ts";
import { DEFAULT_NAMESPACE, NAMESPACES } from "../../shared/i18n/namespaces.ts";
import { RESOURCES } from "../../shared/i18n/resources.ts";
import { apiFetch } from "./lib/api";

import type admin from "../../shared/i18n/locales/en/admin.json";
import type auth from "../../shared/i18n/locales/en/auth.json";
import type bots from "../../shared/i18n/locales/en/bots.json";
import type chat from "../../shared/i18n/locales/en/chat.json";
import type common from "../../shared/i18n/locales/en/common.json";
import type desktop from "../../shared/i18n/locales/en/desktop.json";
import type discover from "../../shared/i18n/locales/en/discover.json";
import type dm from "../../shared/i18n/locales/en/dm.json";
import type email from "../../shared/i18n/locales/en/email.json";
import type errors from "../../shared/i18n/locales/en/errors.json";
import type events from "../../shared/i18n/locales/en/events.json";
import type forum from "../../shared/i18n/locales/en/forum.json";
import type hub from "../../shared/i18n/locales/en/hub.json";
import type official from "../../shared/i18n/locales/en/official.json";
import type push from "../../shared/i18n/locales/en/push.json";
import type safety from "../../shared/i18n/locales/en/safety.json";
import type settings from "../../shared/i18n/locales/en/settings.json";
import type social from "../../shared/i18n/locales/en/social.json";
import type streamer from "../../shared/i18n/locales/en/streamer.json";
import type voice from "../../shared/i18n/locales/en/voice.json";

// Types t() keys from the English catalogs, so an unknown key is a compile error.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    nsSeparator: ".";
    keySeparator: ".";
    returnNull: false;
    resources: {
      common: typeof common;
      auth: typeof auth;
      settings: typeof settings;
      hub: typeof hub;
      chat: typeof chat;
      forum: typeof forum;
      events: typeof events;
      voice: typeof voice;
      dm: typeof dm;
      social: typeof social;
      discover: typeof discover;
      bots: typeof bots;
      streamer: typeof streamer;
      safety: typeof safety;
      admin: typeof admin;
      errors: typeof errors;
      email: typeof email;
      push: typeof push;
      desktop: typeof desktop;
      official: typeof official;
    };
  }
}

export const LOCALE_STORAGE_KEY = "decave_locale_v1";

/** The device's preferred languages, most preferred first (e.g. ["pt-PT", "en-US"]). */
function deviceLanguages(): string[] {
  try {
    return Localization.getLocales()
      .map((locale) => locale.languageTag)
      .filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
  } catch {
    return [];
  }
}

/** The first supported device language (pt and pt-* become pt-BR), else English. */
export function deviceLocale(): Locale {
  return resolveLocale(deviceLanguages());
}

/**
 * The language to start in before this device's saved choice is read. Until the
 * picker ships, only an explicit choice changes it, so phones set to other
 * languages keep today's English app.
 */
function initialLocale(): Locale {
  return I18N_PICKER_ENABLED ? deviceLocale() : DEFAULT_LOCALE;
}

void i18next.use(initReactI18next).init({
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  ns: [...NAMESPACES],
  defaultNS: DEFAULT_NAMESPACE,
  // Keys are written "namespace.area.purpose" everywhere.
  nsSeparator: ".",
  keySeparator: ".",
  resources: RESOURCES,
  load: "currentOnly",
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

/** The signed-in session, so language changes also save to the account. */
let accountToken: string | null = null;
/** Bumped by every explicit choice, so a slow storage read cannot undo it. */
let choiceVersion = 0;

async function readStored(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function writeStored(locale: Locale | null): Promise<void> {
  try {
    if (locale) await SecureStore.setItemAsync(LOCALE_STORAGE_KEY, locale);
    else await SecureStore.deleteItemAsync(LOCALE_STORAGE_KEY);
  } catch {}
}

function switchTo(locale: Locale): void {
  if (i18next.language !== locale) void i18next.changeLanguage(locale);
}

/** The UI language now in use. */
export function activeLocale(): Locale {
  const current = i18next.language;
  return isLocale(current) ? current : DEFAULT_LOCALE;
}

/** The language saved on this device, or null when it follows the device language. */
export async function storedLocale(): Promise<Locale | null> {
  const stored = await readStored();
  return isLocale(stored) ? stored : null;
}

// Apply the language saved on this device once storage answers.
const startVersion = choiceVersion;
void storedLocale().then((stored) => {
  if (stored && choiceVersion === startVersion) switchTo(stored);
});

/**
 * Applies the language saved on the account. The account choice wins over this
 * device's; an unset account keeps the local choice.
 */
export function applyAccountLocale(locale: unknown): void {
  if (!isLocale(locale)) return;
  choiceVersion += 1;
  void writeStored(locale);
  switchTo(locale);
}

/** Changes the UI language; null follows the device. Saved on this device and, when signed in, the account. */
export async function setLocale(next: Locale | null): Promise<void> {
  choiceVersion += 1;
  await writeStored(next);
  switchTo(next ?? deviceLocale());
  if (!accountToken) return;
  try {
    await apiFetch(
      "/api/account/locale",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      },
      accountToken,
    );
  } catch {
    // Offline: this device keeps the choice and the next change syncs it.
  }
}

/**
 * Keeps the UI language in step with the signed-in account: reads the saved
 * language once per session token and lets setLocale() sync later changes.
 */
export function useAccountLocaleSync(token: string | null): void {
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    accountToken = token;
    if (!token) {
      fetchedFor.current = null;
      return;
    }
    if (fetchedFor.current === token) return;
    fetchedFor.current = token;
    void (async () => {
      try {
        const response = await apiFetch("/api/auth/me", {}, token);
        if (!response.ok || accountToken !== token) return;
        const data = (await response.json().catch(() => ({}))) as { locale?: unknown };
        if (accountToken === token) applyAccountLocale(data.locale);
      } catch {
        // Offline: keep this device's choice until the next session check.
      }
    })();
  }, [token]);
}

export { i18next };
