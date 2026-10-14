// Hermes has no Intl.PluralRules, so i18next fell back to English one/other and
// Polish/Ukrainian (one/few/many/other) or Spanish/French/Italian/Portuguese
// ("many") picked the wrong plural. Install the FormatJS polyfill with the
// plural data for every UI language (shared/i18n/languages.ts). Import this
// before the translation runtime starts.
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/el.js";
import "@formatjs/intl-pluralrules/locale-data/es.js";
import "@formatjs/intl-pluralrules/locale-data/pt.js";
import "@formatjs/intl-pluralrules/locale-data/fr.js";
import "@formatjs/intl-pluralrules/locale-data/nl.js";
import "@formatjs/intl-pluralrules/locale-data/de.js";
import "@formatjs/intl-pluralrules/locale-data/it.js";
import "@formatjs/intl-pluralrules/locale-data/pl.js";
import "@formatjs/intl-pluralrules/locale-data/uk.js";
