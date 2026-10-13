// Every catalog, statically imported, for runtimes that bundle all languages
// (the Worker, and later Electron main and mobile). The web app lazy-loads
// catalogs instead (src/i18n/index.ts).

import type { Locale } from "./languages.ts";
import type { Namespace } from "./namespaces.ts";

import enCommon from "./locales/en/common.json" with { type: "json" };
import enAuth from "./locales/en/auth.json" with { type: "json" };
import enSettings from "./locales/en/settings.json" with { type: "json" };
import enHub from "./locales/en/hub.json" with { type: "json" };
import enChat from "./locales/en/chat.json" with { type: "json" };
import enForum from "./locales/en/forum.json" with { type: "json" };
import enEvents from "./locales/en/events.json" with { type: "json" };
import enVoice from "./locales/en/voice.json" with { type: "json" };
import enDm from "./locales/en/dm.json" with { type: "json" };
import enSocial from "./locales/en/social.json" with { type: "json" };
import enDiscover from "./locales/en/discover.json" with { type: "json" };
import enBots from "./locales/en/bots.json" with { type: "json" };
import enStreamer from "./locales/en/streamer.json" with { type: "json" };
import enSafety from "./locales/en/safety.json" with { type: "json" };
import enAdmin from "./locales/en/admin.json" with { type: "json" };
import enErrors from "./locales/en/errors.json" with { type: "json" };
import enEmail from "./locales/en/email.json" with { type: "json" };
import enPush from "./locales/en/push.json" with { type: "json" };
import enDesktop from "./locales/en/desktop.json" with { type: "json" };
import enOfficial from "./locales/en/official.json" with { type: "json" };
import elCommon from "./locales/el/common.json" with { type: "json" };
import elAuth from "./locales/el/auth.json" with { type: "json" };
import elSettings from "./locales/el/settings.json" with { type: "json" };
import elHub from "./locales/el/hub.json" with { type: "json" };
import elChat from "./locales/el/chat.json" with { type: "json" };
import elForum from "./locales/el/forum.json" with { type: "json" };
import elEvents from "./locales/el/events.json" with { type: "json" };
import elVoice from "./locales/el/voice.json" with { type: "json" };
import elDm from "./locales/el/dm.json" with { type: "json" };
import elSocial from "./locales/el/social.json" with { type: "json" };
import elDiscover from "./locales/el/discover.json" with { type: "json" };
import elBots from "./locales/el/bots.json" with { type: "json" };
import elStreamer from "./locales/el/streamer.json" with { type: "json" };
import elSafety from "./locales/el/safety.json" with { type: "json" };
import elAdmin from "./locales/el/admin.json" with { type: "json" };
import elErrors from "./locales/el/errors.json" with { type: "json" };
import elEmail from "./locales/el/email.json" with { type: "json" };
import elPush from "./locales/el/push.json" with { type: "json" };
import elDesktop from "./locales/el/desktop.json" with { type: "json" };
import elOfficial from "./locales/el/official.json" with { type: "json" };
import esCommon from "./locales/es/common.json" with { type: "json" };
import esAuth from "./locales/es/auth.json" with { type: "json" };
import esSettings from "./locales/es/settings.json" with { type: "json" };
import esHub from "./locales/es/hub.json" with { type: "json" };
import esChat from "./locales/es/chat.json" with { type: "json" };
import esForum from "./locales/es/forum.json" with { type: "json" };
import esEvents from "./locales/es/events.json" with { type: "json" };
import esVoice from "./locales/es/voice.json" with { type: "json" };
import esDm from "./locales/es/dm.json" with { type: "json" };
import esSocial from "./locales/es/social.json" with { type: "json" };
import esDiscover from "./locales/es/discover.json" with { type: "json" };
import esBots from "./locales/es/bots.json" with { type: "json" };
import esStreamer from "./locales/es/streamer.json" with { type: "json" };
import esSafety from "./locales/es/safety.json" with { type: "json" };
import esAdmin from "./locales/es/admin.json" with { type: "json" };
import esErrors from "./locales/es/errors.json" with { type: "json" };
import esEmail from "./locales/es/email.json" with { type: "json" };
import esPush from "./locales/es/push.json" with { type: "json" };
import esDesktop from "./locales/es/desktop.json" with { type: "json" };
import esOfficial from "./locales/es/official.json" with { type: "json" };
import ptBRCommon from "./locales/pt-BR/common.json" with { type: "json" };
import ptBRAuth from "./locales/pt-BR/auth.json" with { type: "json" };
import ptBRSettings from "./locales/pt-BR/settings.json" with { type: "json" };
import ptBRHub from "./locales/pt-BR/hub.json" with { type: "json" };
import ptBRChat from "./locales/pt-BR/chat.json" with { type: "json" };
import ptBRForum from "./locales/pt-BR/forum.json" with { type: "json" };
import ptBREvents from "./locales/pt-BR/events.json" with { type: "json" };
import ptBRVoice from "./locales/pt-BR/voice.json" with { type: "json" };
import ptBRDm from "./locales/pt-BR/dm.json" with { type: "json" };
import ptBRSocial from "./locales/pt-BR/social.json" with { type: "json" };
import ptBRDiscover from "./locales/pt-BR/discover.json" with { type: "json" };
import ptBRBots from "./locales/pt-BR/bots.json" with { type: "json" };
import ptBRStreamer from "./locales/pt-BR/streamer.json" with { type: "json" };
import ptBRSafety from "./locales/pt-BR/safety.json" with { type: "json" };
import ptBRAdmin from "./locales/pt-BR/admin.json" with { type: "json" };
import ptBRErrors from "./locales/pt-BR/errors.json" with { type: "json" };
import ptBREmail from "./locales/pt-BR/email.json" with { type: "json" };
import ptBRPush from "./locales/pt-BR/push.json" with { type: "json" };
import ptBRDesktop from "./locales/pt-BR/desktop.json" with { type: "json" };
import ptBROfficial from "./locales/pt-BR/official.json" with { type: "json" };
import frCommon from "./locales/fr/common.json" with { type: "json" };
import frAuth from "./locales/fr/auth.json" with { type: "json" };
import frSettings from "./locales/fr/settings.json" with { type: "json" };
import frHub from "./locales/fr/hub.json" with { type: "json" };
import frChat from "./locales/fr/chat.json" with { type: "json" };
import frForum from "./locales/fr/forum.json" with { type: "json" };
import frEvents from "./locales/fr/events.json" with { type: "json" };
import frVoice from "./locales/fr/voice.json" with { type: "json" };
import frDm from "./locales/fr/dm.json" with { type: "json" };
import frSocial from "./locales/fr/social.json" with { type: "json" };
import frDiscover from "./locales/fr/discover.json" with { type: "json" };
import frBots from "./locales/fr/bots.json" with { type: "json" };
import frStreamer from "./locales/fr/streamer.json" with { type: "json" };
import frSafety from "./locales/fr/safety.json" with { type: "json" };
import frAdmin from "./locales/fr/admin.json" with { type: "json" };
import frErrors from "./locales/fr/errors.json" with { type: "json" };
import frEmail from "./locales/fr/email.json" with { type: "json" };
import frPush from "./locales/fr/push.json" with { type: "json" };
import frDesktop from "./locales/fr/desktop.json" with { type: "json" };
import frOfficial from "./locales/fr/official.json" with { type: "json" };
import nlCommon from "./locales/nl/common.json" with { type: "json" };
import nlAuth from "./locales/nl/auth.json" with { type: "json" };
import nlSettings from "./locales/nl/settings.json" with { type: "json" };
import nlHub from "./locales/nl/hub.json" with { type: "json" };
import nlChat from "./locales/nl/chat.json" with { type: "json" };
import nlForum from "./locales/nl/forum.json" with { type: "json" };
import nlEvents from "./locales/nl/events.json" with { type: "json" };
import nlVoice from "./locales/nl/voice.json" with { type: "json" };
import nlDm from "./locales/nl/dm.json" with { type: "json" };
import nlSocial from "./locales/nl/social.json" with { type: "json" };
import nlDiscover from "./locales/nl/discover.json" with { type: "json" };
import nlBots from "./locales/nl/bots.json" with { type: "json" };
import nlStreamer from "./locales/nl/streamer.json" with { type: "json" };
import nlSafety from "./locales/nl/safety.json" with { type: "json" };
import nlAdmin from "./locales/nl/admin.json" with { type: "json" };
import nlErrors from "./locales/nl/errors.json" with { type: "json" };
import nlEmail from "./locales/nl/email.json" with { type: "json" };
import nlPush from "./locales/nl/push.json" with { type: "json" };
import nlDesktop from "./locales/nl/desktop.json" with { type: "json" };
import nlOfficial from "./locales/nl/official.json" with { type: "json" };
import deCommon from "./locales/de/common.json" with { type: "json" };
import deAuth from "./locales/de/auth.json" with { type: "json" };
import deSettings from "./locales/de/settings.json" with { type: "json" };
import deHub from "./locales/de/hub.json" with { type: "json" };
import deChat from "./locales/de/chat.json" with { type: "json" };
import deForum from "./locales/de/forum.json" with { type: "json" };
import deEvents from "./locales/de/events.json" with { type: "json" };
import deVoice from "./locales/de/voice.json" with { type: "json" };
import deDm from "./locales/de/dm.json" with { type: "json" };
import deSocial from "./locales/de/social.json" with { type: "json" };
import deDiscover from "./locales/de/discover.json" with { type: "json" };
import deBots from "./locales/de/bots.json" with { type: "json" };
import deStreamer from "./locales/de/streamer.json" with { type: "json" };
import deSafety from "./locales/de/safety.json" with { type: "json" };
import deAdmin from "./locales/de/admin.json" with { type: "json" };
import deErrors from "./locales/de/errors.json" with { type: "json" };
import deEmail from "./locales/de/email.json" with { type: "json" };
import dePush from "./locales/de/push.json" with { type: "json" };
import deDesktop from "./locales/de/desktop.json" with { type: "json" };
import deOfficial from "./locales/de/official.json" with { type: "json" };
import itCommon from "./locales/it/common.json" with { type: "json" };
import itAuth from "./locales/it/auth.json" with { type: "json" };
import itSettings from "./locales/it/settings.json" with { type: "json" };
import itHub from "./locales/it/hub.json" with { type: "json" };
import itChat from "./locales/it/chat.json" with { type: "json" };
import itForum from "./locales/it/forum.json" with { type: "json" };
import itEvents from "./locales/it/events.json" with { type: "json" };
import itVoice from "./locales/it/voice.json" with { type: "json" };
import itDm from "./locales/it/dm.json" with { type: "json" };
import itSocial from "./locales/it/social.json" with { type: "json" };
import itDiscover from "./locales/it/discover.json" with { type: "json" };
import itBots from "./locales/it/bots.json" with { type: "json" };
import itStreamer from "./locales/it/streamer.json" with { type: "json" };
import itSafety from "./locales/it/safety.json" with { type: "json" };
import itAdmin from "./locales/it/admin.json" with { type: "json" };
import itErrors from "./locales/it/errors.json" with { type: "json" };
import itEmail from "./locales/it/email.json" with { type: "json" };
import itPush from "./locales/it/push.json" with { type: "json" };
import itDesktop from "./locales/it/desktop.json" with { type: "json" };
import itOfficial from "./locales/it/official.json" with { type: "json" };
import plCommon from "./locales/pl/common.json" with { type: "json" };
import plAuth from "./locales/pl/auth.json" with { type: "json" };
import plSettings from "./locales/pl/settings.json" with { type: "json" };
import plHub from "./locales/pl/hub.json" with { type: "json" };
import plChat from "./locales/pl/chat.json" with { type: "json" };
import plForum from "./locales/pl/forum.json" with { type: "json" };
import plEvents from "./locales/pl/events.json" with { type: "json" };
import plVoice from "./locales/pl/voice.json" with { type: "json" };
import plDm from "./locales/pl/dm.json" with { type: "json" };
import plSocial from "./locales/pl/social.json" with { type: "json" };
import plDiscover from "./locales/pl/discover.json" with { type: "json" };
import plBots from "./locales/pl/bots.json" with { type: "json" };
import plStreamer from "./locales/pl/streamer.json" with { type: "json" };
import plSafety from "./locales/pl/safety.json" with { type: "json" };
import plAdmin from "./locales/pl/admin.json" with { type: "json" };
import plErrors from "./locales/pl/errors.json" with { type: "json" };
import plEmail from "./locales/pl/email.json" with { type: "json" };
import plPush from "./locales/pl/push.json" with { type: "json" };
import plDesktop from "./locales/pl/desktop.json" with { type: "json" };
import plOfficial from "./locales/pl/official.json" with { type: "json" };
import ukCommon from "./locales/uk/common.json" with { type: "json" };
import ukAuth from "./locales/uk/auth.json" with { type: "json" };
import ukSettings from "./locales/uk/settings.json" with { type: "json" };
import ukHub from "./locales/uk/hub.json" with { type: "json" };
import ukChat from "./locales/uk/chat.json" with { type: "json" };
import ukForum from "./locales/uk/forum.json" with { type: "json" };
import ukEvents from "./locales/uk/events.json" with { type: "json" };
import ukVoice from "./locales/uk/voice.json" with { type: "json" };
import ukDm from "./locales/uk/dm.json" with { type: "json" };
import ukSocial from "./locales/uk/social.json" with { type: "json" };
import ukDiscover from "./locales/uk/discover.json" with { type: "json" };
import ukBots from "./locales/uk/bots.json" with { type: "json" };
import ukStreamer from "./locales/uk/streamer.json" with { type: "json" };
import ukSafety from "./locales/uk/safety.json" with { type: "json" };
import ukAdmin from "./locales/uk/admin.json" with { type: "json" };
import ukErrors from "./locales/uk/errors.json" with { type: "json" };
import ukEmail from "./locales/uk/email.json" with { type: "json" };
import ukPush from "./locales/uk/push.json" with { type: "json" };
import ukDesktop from "./locales/uk/desktop.json" with { type: "json" };
import ukOfficial from "./locales/uk/official.json" with { type: "json" };

export type Catalog = Record<string, unknown>;

export const RESOURCES: Record<Locale, Record<Namespace, Catalog>> = {
  en: {
    common: enCommon,
    auth: enAuth,
    settings: enSettings,
    hub: enHub,
    chat: enChat,
    forum: enForum,
    events: enEvents,
    voice: enVoice,
    dm: enDm,
    social: enSocial,
    discover: enDiscover,
    bots: enBots,
    streamer: enStreamer,
    safety: enSafety,
    admin: enAdmin,
    errors: enErrors,
    email: enEmail,
    push: enPush,
    desktop: enDesktop,
    official: enOfficial,
  },
  el: {
    common: elCommon,
    auth: elAuth,
    settings: elSettings,
    hub: elHub,
    chat: elChat,
    forum: elForum,
    events: elEvents,
    voice: elVoice,
    dm: elDm,
    social: elSocial,
    discover: elDiscover,
    bots: elBots,
    streamer: elStreamer,
    safety: elSafety,
    admin: elAdmin,
    errors: elErrors,
    email: elEmail,
    push: elPush,
    desktop: elDesktop,
    official: elOfficial,
  },
  es: {
    common: esCommon,
    auth: esAuth,
    settings: esSettings,
    hub: esHub,
    chat: esChat,
    forum: esForum,
    events: esEvents,
    voice: esVoice,
    dm: esDm,
    social: esSocial,
    discover: esDiscover,
    bots: esBots,
    streamer: esStreamer,
    safety: esSafety,
    admin: esAdmin,
    errors: esErrors,
    email: esEmail,
    push: esPush,
    desktop: esDesktop,
    official: esOfficial,
  },
  "pt-BR": {
    common: ptBRCommon,
    auth: ptBRAuth,
    settings: ptBRSettings,
    hub: ptBRHub,
    chat: ptBRChat,
    forum: ptBRForum,
    events: ptBREvents,
    voice: ptBRVoice,
    dm: ptBRDm,
    social: ptBRSocial,
    discover: ptBRDiscover,
    bots: ptBRBots,
    streamer: ptBRStreamer,
    safety: ptBRSafety,
    admin: ptBRAdmin,
    errors: ptBRErrors,
    email: ptBREmail,
    push: ptBRPush,
    desktop: ptBRDesktop,
    official: ptBROfficial,
  },
  fr: {
    common: frCommon,
    auth: frAuth,
    settings: frSettings,
    hub: frHub,
    chat: frChat,
    forum: frForum,
    events: frEvents,
    voice: frVoice,
    dm: frDm,
    social: frSocial,
    discover: frDiscover,
    bots: frBots,
    streamer: frStreamer,
    safety: frSafety,
    admin: frAdmin,
    errors: frErrors,
    email: frEmail,
    push: frPush,
    desktop: frDesktop,
    official: frOfficial,
  },
  nl: {
    common: nlCommon,
    auth: nlAuth,
    settings: nlSettings,
    hub: nlHub,
    chat: nlChat,
    forum: nlForum,
    events: nlEvents,
    voice: nlVoice,
    dm: nlDm,
    social: nlSocial,
    discover: nlDiscover,
    bots: nlBots,
    streamer: nlStreamer,
    safety: nlSafety,
    admin: nlAdmin,
    errors: nlErrors,
    email: nlEmail,
    push: nlPush,
    desktop: nlDesktop,
    official: nlOfficial,
  },
  de: {
    common: deCommon,
    auth: deAuth,
    settings: deSettings,
    hub: deHub,
    chat: deChat,
    forum: deForum,
    events: deEvents,
    voice: deVoice,
    dm: deDm,
    social: deSocial,
    discover: deDiscover,
    bots: deBots,
    streamer: deStreamer,
    safety: deSafety,
    admin: deAdmin,
    errors: deErrors,
    email: deEmail,
    push: dePush,
    desktop: deDesktop,
    official: deOfficial,
  },
  it: {
    common: itCommon,
    auth: itAuth,
    settings: itSettings,
    hub: itHub,
    chat: itChat,
    forum: itForum,
    events: itEvents,
    voice: itVoice,
    dm: itDm,
    social: itSocial,
    discover: itDiscover,
    bots: itBots,
    streamer: itStreamer,
    safety: itSafety,
    admin: itAdmin,
    errors: itErrors,
    email: itEmail,
    push: itPush,
    desktop: itDesktop,
    official: itOfficial,
  },
  pl: {
    common: plCommon,
    auth: plAuth,
    settings: plSettings,
    hub: plHub,
    chat: plChat,
    forum: plForum,
    events: plEvents,
    voice: plVoice,
    dm: plDm,
    social: plSocial,
    discover: plDiscover,
    bots: plBots,
    streamer: plStreamer,
    safety: plSafety,
    admin: plAdmin,
    errors: plErrors,
    email: plEmail,
    push: plPush,
    desktop: plDesktop,
    official: plOfficial,
  },
  uk: {
    common: ukCommon,
    auth: ukAuth,
    settings: ukSettings,
    hub: ukHub,
    chat: ukChat,
    forum: ukForum,
    events: ukEvents,
    voice: ukVoice,
    dm: ukDm,
    social: ukSocial,
    discover: ukDiscover,
    bots: ukBots,
    streamer: ukStreamer,
    safety: ukSafety,
    admin: ukAdmin,
    errors: ukErrors,
    email: ukEmail,
    push: ukPush,
    desktop: ukDesktop,
    official: ukOfficial,
  },
};
