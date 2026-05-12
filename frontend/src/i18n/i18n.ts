import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import * as Localization from "expo-localization";
import { LOCALES } from "./locales";

type Namespace =
  | "common"
  | "yacht"
  | "cascade"
  | "errors"
  | "blackjack"
  | "twenty48"
  | "solitaire"
  | "freecell"
  | "hearts"
  | "sudoku"
  | "feedback"
  | "profile"
  | "starswarm"
  | "mahjong"
  | "sort"
  | "daily_word";
type TranslationModule = Promise<{ default: Record<string, string> }>;

// Resolve the best supported locale from the device's preference list
function resolveLocale(): string {
  const deviceLocales = Localization.getLocales();
  const supported = new Set(LOCALES.map((l) => l.code));

  for (const { languageTag, languageCode } of deviceLocales) {
    if (supported.has(languageTag)) return languageTag;
    // Fall back to base language code (e.g. "fr" matches "fr-CA")
    const match = LOCALES.find((l) => l.code.split("-")[0] === languageCode);
    if (match) return match.code;
  }
  return "en";
}

const localeLoaders: Record<string, Partial<Record<Namespace, () => TranslationModule>>> = {
  en: {
    common: () => import("./locales/en/common.json") as TranslationModule,
    yacht: () => import("./locales/en/yacht.json") as TranslationModule,
    cascade: () => import("./locales/en/cascade.json") as TranslationModule,
    errors: () => import("./locales/en/errors.json") as TranslationModule,
    blackjack: () => import("./locales/en/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/en/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/en/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/en/freecell.json") as TranslationModule,
    hearts: () => import("./locales/en/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/en/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/en/feedback.json") as TranslationModule,
    profile: () => import("./locales/en/profile.json") as TranslationModule,
    starswarm: () => import("./locales/en/starswarm.json") as TranslationModule,
    mahjong: () => import("./locales/en/mahjong.json") as TranslationModule,
    sort: () => import("./locales/en/sort.json") as TranslationModule,
    daily_word: () => import("./locales/en/daily_word.json") as TranslationModule,
  },
  "fr-CA": {
    common: () => import("./locales/fr-CA/common.json") as TranslationModule,
    yacht: () => import("./locales/fr-CA/yacht.json") as TranslationModule,
    cascade: () => import("./locales/fr-CA/cascade.json") as TranslationModule,
    errors: () => import("./locales/fr-CA/errors.json") as TranslationModule,
    blackjack: () => import("./locales/fr-CA/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/fr-CA/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/fr-CA/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/fr-CA/feedback.json") as TranslationModule,
  },
  es: {
    common: () => import("./locales/es/common.json") as TranslationModule,
    yacht: () => import("./locales/es/yacht.json") as TranslationModule,
    cascade: () => import("./locales/es/cascade.json") as TranslationModule,
    errors: () => import("./locales/es/errors.json") as TranslationModule,
    blackjack: () => import("./locales/es/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/es/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/es/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/es/feedback.json") as TranslationModule,
  },
  hi: {
    common: () => import("./locales/hi/common.json") as TranslationModule,
    yacht: () => import("./locales/hi/yacht.json") as TranslationModule,
    cascade: () => import("./locales/hi/cascade.json") as TranslationModule,
    errors: () => import("./locales/hi/errors.json") as TranslationModule,
    blackjack: () => import("./locales/hi/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/hi/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/hi/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/hi/feedback.json") as TranslationModule,
    daily_word: () => import("./locales/hi/daily_word.json") as TranslationModule,
  },
  ar: {
    common: () => import("./locales/ar/common.json") as TranslationModule,
    yacht: () => import("./locales/ar/yacht.json") as TranslationModule,
    cascade: () => import("./locales/ar/cascade.json") as TranslationModule,
    errors: () => import("./locales/ar/errors.json") as TranslationModule,
    blackjack: () => import("./locales/ar/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/ar/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/ar/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/ar/feedback.json") as TranslationModule,
  },
  zh: {
    common: () => import("./locales/zh/common.json") as TranslationModule,
    yacht: () => import("./locales/zh/yacht.json") as TranslationModule,
    cascade: () => import("./locales/zh/cascade.json") as TranslationModule,
    errors: () => import("./locales/zh/errors.json") as TranslationModule,
    blackjack: () => import("./locales/zh/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/zh/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/zh/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/zh/feedback.json") as TranslationModule,
  },
  ja: {
    common: () => import("./locales/ja/common.json") as TranslationModule,
    yacht: () => import("./locales/ja/yacht.json") as TranslationModule,
    cascade: () => import("./locales/ja/cascade.json") as TranslationModule,
    errors: () => import("./locales/ja/errors.json") as TranslationModule,
    blackjack: () => import("./locales/ja/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/ja/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/ja/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/ja/feedback.json") as TranslationModule,
  },
  ko: {
    common: () => import("./locales/ko/common.json") as TranslationModule,
    yacht: () => import("./locales/ko/yacht.json") as TranslationModule,
    cascade: () => import("./locales/ko/cascade.json") as TranslationModule,
    errors: () => import("./locales/ko/errors.json") as TranslationModule,
    blackjack: () => import("./locales/ko/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/ko/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/ko/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/ko/feedback.json") as TranslationModule,
  },
  pt: {
    common: () => import("./locales/pt/common.json") as TranslationModule,
    yacht: () => import("./locales/pt/yacht.json") as TranslationModule,
    cascade: () => import("./locales/pt/cascade.json") as TranslationModule,
    errors: () => import("./locales/pt/errors.json") as TranslationModule,
    blackjack: () => import("./locales/pt/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/pt/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/pt/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/pt/feedback.json") as TranslationModule,
  },
  he: {
    common: () => import("./locales/he/common.json") as TranslationModule,
    yacht: () => import("./locales/he/yacht.json") as TranslationModule,
    cascade: () => import("./locales/he/cascade.json") as TranslationModule,
    errors: () => import("./locales/he/errors.json") as TranslationModule,
    blackjack: () => import("./locales/he/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/he/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/he/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/he/feedback.json") as TranslationModule,
  },
  de: {
    common: () => import("./locales/de/common.json") as TranslationModule,
    yacht: () => import("./locales/de/yacht.json") as TranslationModule,
    cascade: () => import("./locales/de/cascade.json") as TranslationModule,
    errors: () => import("./locales/de/errors.json") as TranslationModule,
    blackjack: () => import("./locales/de/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/de/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/de/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/de/feedback.json") as TranslationModule,
  },
  nl: {
    common: () => import("./locales/nl/common.json") as TranslationModule,
    yacht: () => import("./locales/nl/yacht.json") as TranslationModule,
    cascade: () => import("./locales/nl/cascade.json") as TranslationModule,
    errors: () => import("./locales/nl/errors.json") as TranslationModule,
    blackjack: () => import("./locales/nl/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/nl/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/nl/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/nl/feedback.json") as TranslationModule,
  },
  ru: {
    common: () => import("./locales/ru/common.json") as TranslationModule,
    yacht: () => import("./locales/ru/yacht.json") as TranslationModule,
    cascade: () => import("./locales/ru/cascade.json") as TranslationModule,
    errors: () => import("./locales/ru/errors.json") as TranslationModule,
    blackjack: () => import("./locales/ru/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/ru/twenty48.json") as TranslationModule,
    sudoku: () => import("./locales/ru/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/ru/feedback.json") as TranslationModule,
  },
};

function loadLocaleNamespace(lng: string, ns: string): TranslationModule {
  const namespace = ns as Namespace;
  const fallback: Partial<Record<Namespace, () => TranslationModule>> = localeLoaders["en"] ?? {};
  const localeNamespaces: Partial<Record<Namespace, () => TranslationModule>> =
    localeLoaders[lng] ?? fallback;
  const loader = localeNamespaces[namespace] ?? fallback[namespace];
  if (!loader) {
    // Should only happen if a namespace is referenced before it's registered.
    return Promise.resolve({ default: {} });
  }
  return loader();
}

i18n
  .use(resourcesToBackend(loadLocaleNamespace))
  .use(initReactI18next)
  .init({
    lng: resolveLocale(),
    fallbackLng: "en",
    supportedLngs: LOCALES.map((l) => l.code),
    ns: [
      "common",
      "yacht",
      "cascade",
      "errors",
      "blackjack",
      "twenty48",
      "solitaire",
      "freecell",
      "hearts",
      "sudoku",
      "feedback",
      "profile",
      "starswarm",
      "mahjong",
      "sort",
      "daily_word",
    ],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  });

export default i18n;
