/**
 * Where each locale's translation files are (#2193).
 *
 * Metro needs a literal path per `import()`, so every locale file is listed
 * here. A file that exists but is not listed is never loaded: i18next quietly
 * falls back to English for it, which is how six games shipped in English to
 * every other language. `__tests__/localeLoaders.test.ts` fails when a file
 * on disk is missing from this table.
 */

/** Every namespace, one per file in `locales/en/`. */
export const NAMESPACES = [
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
  "daily_challenge",
  "result",
] as const;

export type Namespace = (typeof NAMESPACES)[number];
export type TranslationModule = Promise<{ default: Record<string, string> }>;
type Loaders = Partial<Record<Namespace, () => TranslationModule>>;

export const localeLoaders: Record<string, Loaders> = {
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
    daily_challenge: () => import("./locales/en/daily_challenge.json") as TranslationModule,
    result: () => import("./locales/en/result.json") as TranslationModule,
  },
  "fr-CA": {
    common: () => import("./locales/fr-CA/common.json") as TranslationModule,
    yacht: () => import("./locales/fr-CA/yacht.json") as TranslationModule,
    cascade: () => import("./locales/fr-CA/cascade.json") as TranslationModule,
    errors: () => import("./locales/fr-CA/errors.json") as TranslationModule,
    blackjack: () => import("./locales/fr-CA/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/fr-CA/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/fr-CA/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/fr-CA/freecell.json") as TranslationModule,
    hearts: () => import("./locales/fr-CA/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/fr-CA/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/fr-CA/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/fr-CA/mahjong.json") as TranslationModule,
  },
  es: {
    common: () => import("./locales/es/common.json") as TranslationModule,
    yacht: () => import("./locales/es/yacht.json") as TranslationModule,
    cascade: () => import("./locales/es/cascade.json") as TranslationModule,
    errors: () => import("./locales/es/errors.json") as TranslationModule,
    blackjack: () => import("./locales/es/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/es/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/es/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/es/freecell.json") as TranslationModule,
    hearts: () => import("./locales/es/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/es/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/es/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/es/mahjong.json") as TranslationModule,
  },
  hi: {
    common: () => import("./locales/hi/common.json") as TranslationModule,
    yacht: () => import("./locales/hi/yacht.json") as TranslationModule,
    cascade: () => import("./locales/hi/cascade.json") as TranslationModule,
    errors: () => import("./locales/hi/errors.json") as TranslationModule,
    blackjack: () => import("./locales/hi/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/hi/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/hi/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/hi/freecell.json") as TranslationModule,
    hearts: () => import("./locales/hi/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/hi/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/hi/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/hi/mahjong.json") as TranslationModule,
    daily_word: () => import("./locales/hi/daily_word.json") as TranslationModule,
  },
  ar: {
    common: () => import("./locales/ar/common.json") as TranslationModule,
    yacht: () => import("./locales/ar/yacht.json") as TranslationModule,
    cascade: () => import("./locales/ar/cascade.json") as TranslationModule,
    errors: () => import("./locales/ar/errors.json") as TranslationModule,
    blackjack: () => import("./locales/ar/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/ar/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/ar/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/ar/freecell.json") as TranslationModule,
    hearts: () => import("./locales/ar/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/ar/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/ar/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/ar/mahjong.json") as TranslationModule,
  },
  zh: {
    common: () => import("./locales/zh/common.json") as TranslationModule,
    yacht: () => import("./locales/zh/yacht.json") as TranslationModule,
    cascade: () => import("./locales/zh/cascade.json") as TranslationModule,
    errors: () => import("./locales/zh/errors.json") as TranslationModule,
    blackjack: () => import("./locales/zh/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/zh/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/zh/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/zh/freecell.json") as TranslationModule,
    hearts: () => import("./locales/zh/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/zh/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/zh/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/zh/mahjong.json") as TranslationModule,
  },
  ja: {
    common: () => import("./locales/ja/common.json") as TranslationModule,
    yacht: () => import("./locales/ja/yacht.json") as TranslationModule,
    cascade: () => import("./locales/ja/cascade.json") as TranslationModule,
    errors: () => import("./locales/ja/errors.json") as TranslationModule,
    blackjack: () => import("./locales/ja/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/ja/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/ja/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/ja/freecell.json") as TranslationModule,
    hearts: () => import("./locales/ja/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/ja/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/ja/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/ja/mahjong.json") as TranslationModule,
  },
  ko: {
    common: () => import("./locales/ko/common.json") as TranslationModule,
    yacht: () => import("./locales/ko/yacht.json") as TranslationModule,
    cascade: () => import("./locales/ko/cascade.json") as TranslationModule,
    errors: () => import("./locales/ko/errors.json") as TranslationModule,
    blackjack: () => import("./locales/ko/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/ko/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/ko/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/ko/freecell.json") as TranslationModule,
    hearts: () => import("./locales/ko/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/ko/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/ko/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/ko/mahjong.json") as TranslationModule,
  },
  pt: {
    common: () => import("./locales/pt/common.json") as TranslationModule,
    yacht: () => import("./locales/pt/yacht.json") as TranslationModule,
    cascade: () => import("./locales/pt/cascade.json") as TranslationModule,
    errors: () => import("./locales/pt/errors.json") as TranslationModule,
    blackjack: () => import("./locales/pt/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/pt/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/pt/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/pt/freecell.json") as TranslationModule,
    hearts: () => import("./locales/pt/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/pt/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/pt/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/pt/mahjong.json") as TranslationModule,
  },
  he: {
    common: () => import("./locales/he/common.json") as TranslationModule,
    yacht: () => import("./locales/he/yacht.json") as TranslationModule,
    cascade: () => import("./locales/he/cascade.json") as TranslationModule,
    errors: () => import("./locales/he/errors.json") as TranslationModule,
    blackjack: () => import("./locales/he/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/he/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/he/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/he/freecell.json") as TranslationModule,
    hearts: () => import("./locales/he/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/he/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/he/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/he/mahjong.json") as TranslationModule,
  },
  de: {
    common: () => import("./locales/de/common.json") as TranslationModule,
    yacht: () => import("./locales/de/yacht.json") as TranslationModule,
    cascade: () => import("./locales/de/cascade.json") as TranslationModule,
    errors: () => import("./locales/de/errors.json") as TranslationModule,
    blackjack: () => import("./locales/de/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/de/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/de/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/de/freecell.json") as TranslationModule,
    hearts: () => import("./locales/de/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/de/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/de/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/de/mahjong.json") as TranslationModule,
  },
  nl: {
    common: () => import("./locales/nl/common.json") as TranslationModule,
    yacht: () => import("./locales/nl/yacht.json") as TranslationModule,
    cascade: () => import("./locales/nl/cascade.json") as TranslationModule,
    errors: () => import("./locales/nl/errors.json") as TranslationModule,
    blackjack: () => import("./locales/nl/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/nl/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/nl/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/nl/freecell.json") as TranslationModule,
    hearts: () => import("./locales/nl/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/nl/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/nl/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/nl/mahjong.json") as TranslationModule,
  },
  ru: {
    common: () => import("./locales/ru/common.json") as TranslationModule,
    yacht: () => import("./locales/ru/yacht.json") as TranslationModule,
    cascade: () => import("./locales/ru/cascade.json") as TranslationModule,
    errors: () => import("./locales/ru/errors.json") as TranslationModule,
    blackjack: () => import("./locales/ru/blackjack.json") as TranslationModule,
    twenty48: () => import("./locales/ru/twenty48.json") as TranslationModule,
    solitaire: () => import("./locales/ru/solitaire.json") as TranslationModule,
    freecell: () => import("./locales/ru/freecell.json") as TranslationModule,
    hearts: () => import("./locales/ru/hearts.json") as TranslationModule,
    sudoku: () => import("./locales/ru/sudoku.json") as TranslationModule,
    feedback: () => import("./locales/ru/feedback.json") as TranslationModule,
    mahjong: () => import("./locales/ru/mahjong.json") as TranslationModule,
  },
};

/**
 * The backend loader: the locale's file for `ns`, else the English one. The
 * English fallback is what `fallbackLng` would show anyway; loading it here
 * keeps a namespace with no translation yet from failing to load.
 */
export function loadLocaleNamespace(lng: string, ns: string): TranslationModule {
  const namespace = ns as Namespace;
  const fallback: Loaders = localeLoaders["en"] ?? {};
  const localeNamespaces: Loaders = localeLoaders[lng] ?? fallback;
  const loader = localeNamespaces[namespace] ?? fallback[namespace];
  if (!loader) {
    // Should only happen if a namespace is referenced before it's registered.
    return Promise.resolve({ default: {} });
  }
  return loader();
}
