/**
 * Intl.PluralRules where the JS engine has none (#2754). Hermes, the engine on
 * iOS and Android, implements Intl.Collator, NumberFormat and DateTimeFormat
 * but not PluralRules. Without it i18next falls back to English's one/other
 * for every language, so ru "few"/"many", ar "zero"/"two"/"few"/"many",
 * he "two" and fr/es/pt "many" never apply.
 *
 * Import this before i18next initialises (first line of index.ts). It installs
 * only when the engine lacks PluralRules (or a broken one); where it exists
 * (Node, browsers) nothing changes, and the locale data below is a no-op.
 *
 * @formatjs/intl-pluralrules rather than the smaller intl-pluralrules: the
 * latter (2.0.1) formats the number with digit grouping before applying the
 * CLDR rule, so 1,000,000 is never fr/es/pt "many" and 1,003 is ar "other",
 * not "few". This one works out the rules in JavaScript alone. Its known gap
 * (6.3.15): a fraction such as 1.5 is read as 1, so es/hi/ar pick "one" for
 * it. Every count the app pluralises is a whole number.
 *
 * Pure JavaScript: no native module, so no iOS or Android build change.
 * Keep the locale data in step with LOCALES in ./locales.js (a test checks).
 */
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/ar.js";
import "@formatjs/intl-pluralrules/locale-data/de.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/es.js";
import "@formatjs/intl-pluralrules/locale-data/fr.js";
import "@formatjs/intl-pluralrules/locale-data/he.js";
import "@formatjs/intl-pluralrules/locale-data/hi.js";
import "@formatjs/intl-pluralrules/locale-data/ja.js";
import "@formatjs/intl-pluralrules/locale-data/ko.js";
import "@formatjs/intl-pluralrules/locale-data/nl.js";
import "@formatjs/intl-pluralrules/locale-data/pt.js";
import "@formatjs/intl-pluralrules/locale-data/ru.js";
import "@formatjs/intl-pluralrules/locale-data/zh.js";
