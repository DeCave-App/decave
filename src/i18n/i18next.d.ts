// Types t() keys from the English catalogs, so an unknown key is a compile error.

import "i18next";
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
