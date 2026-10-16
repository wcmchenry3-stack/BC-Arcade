/**
 * Store-build payload exclusion for the hidden premium games (#2830).
 *
 * `gameVisibility.ts` hides the premium games in store builds, but hiding a
 * route does not keep its code out of the native bundle: every screen is still
 * reachable through `lazyScreens.ts`'s `import()` calls, and on native those
 * modules — and every asset they `require()` (Star Swarm/Mahjong BGM, Cascade
 * art) — are bundled into the one Hermes bundle and copied into the APK/IPA.
 *
 * In a store bundle, Metro therefore resolves the hidden games' screen modules
 * to `src/screens/StoreBuildExcludedScreen.tsx` (an empty screen), which drops
 * their whole module subtree and assets from the build. The screens are
 * unreachable in a store build anyway: `visiblePremiumRoutes()` registers no
 * route for a hidden game, and the Mahjong layout inspector is only opened
 * from inside the Mahjong screen.
 *
 * `isStoreBundle` must agree with `SHOW_HIDDEN_GAMES` in gameVisibility.ts
 * (minus `__DEV__`, which is `!dev` here): a dev bundle, an e2e bundle
 * (`EXPO_PUBLIC_TEST_HOOKS=1`) or a pre-launch-API bundle keeps all twelve
 * games. `storeBundle.test.ts` pins that parity and the screen list.
 *
 * The hidden locales get the same treatment (#3150). iOS/Android store builds
 * offer only `LAUNCH_LOCALE_CODES` (`availableLocales()` in resolveLocale.ts),
 * but `localeLoaders.ts` has an `import()` for every locale file, so the other
 * locales' JSON would still be bundled. In an iOS/Android store bundle their
 * files resolve to `src/i18n/storeBuildExcludedLocale.json` (`{}`), which is
 * what `loadLocaleNamespace` already returns for a missing file. Web is not a
 * store platform and keeps every locale.
 */
const path = require("path");

// Same pattern as PRE_LAUNCH_API in src/game/_shared/envFlags.ts.
const PRE_LAUNCH_API = /^https:\/\/dev-games-api\.buffingchi\.com(?:[/:?#]|$)/;

/** Screens owned by the games in HIDDEN_GAMES (src/entitlements/gameVisibility.ts). */
const HIDDEN_GAME_SCREENS = {
  blackjack: [
    "BlackjackBettingScreen",
    "BlackjackTableScreen",
    "BlackjackVictoryScreen",
    "BlackjackStatsScreen",
  ],
  cascade: ["CascadeScreen"],
  hearts: ["HeartsScreen"],
  mahjong: ["MahjongScreen", "MahjongLayoutInspectorScreen", "MahjongLayoutDetailScreen"],
  starswarm: ["StarSwarmScreen"],
};

const SCREENS_DIR = path.join(__dirname, "..", "src", "screens");
const STUB_SCREEN = path.join(SCREENS_DIR, "StoreBuildExcludedScreen.tsx");
const EXCLUDED_SCREENS = new Set(Object.values(HIDDEN_GAME_SCREENS).flat());
// `<Name>.tsx` plus any platform variant Metro may pick (`.ios.tsx`, `.native.tsx`, ...).
const SCREEN_FILE = /^([A-Za-z0-9]+)(?:\.(?:ios|android|native|web))?\.(?:tsx|ts|jsx|js)$/;

/** Mirrors LAUNCH_LOCALE_CODES (src/i18n/locales.js, an ES module Metro's config cannot require). */
const LAUNCH_LOCALES = ["en", "fr-CA", "es"];

const LOCALES_DIR = path.join(__dirname, "..", "src", "i18n", "locales");
const STUB_LOCALE = path.join(LOCALES_DIR, "..", "storeBuildExcludedLocale.json");

/** True for `locales/<code>/<namespace>.json` of a locale that is not a launch locale. */
function isExcludedLocaleFile(filePath) {
  if (path.extname(filePath) !== ".json") return false;
  const localeDir = path.dirname(filePath);
  if (path.dirname(localeDir) !== LOCALES_DIR) return false;
  const code = path.basename(localeDir);
  // `_meta` holds translator notes, not a locale; nothing imports it.
  return code !== "_meta" && !LAUNCH_LOCALES.includes(code);
}

/** True for the platforms whose store builds offer only the launch locales. */
function isStorePlatform(platform) {
  return platform === "ios" || platform === "android";
}

/** True for a hidden game's screen module, whichever platform file Metro resolved. */
function isExcludedScreen(filePath) {
  if (path.dirname(filePath) !== SCREENS_DIR) return false;
  const match = SCREEN_FILE.exec(path.basename(filePath));
  return match !== null && EXCLUDED_SCREENS.has(match[1]);
}

/** True when a bundle hides the premium games, i.e. SHOW_HIDDEN_GAMES is false. */
function isStoreBundle(dev, env) {
  if (dev) return false;
  if (env.EXPO_PUBLIC_TEST_HOOKS === "1") return false;
  return !PRE_LAUNCH_API.test(env.EXPO_PUBLIC_API_URL ?? "");
}

/**
 * Wraps `resolver.resolveRequest` so a store bundle resolves the hidden games'
 * screens, and on iOS/Android the hidden locales' files, to their stubs. Every
 * other resolution is passed through untouched.
 */
function withStoreBundleExclusions(config, env = process.env) {
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolution = upstream
      ? upstream(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
    if (resolution.type !== "sourceFile" || !isStoreBundle(context.dev, env)) return resolution;
    if (isExcludedScreen(resolution.filePath)) {
      return { type: "sourceFile", filePath: STUB_SCREEN };
    }
    if (isStorePlatform(platform) && isExcludedLocaleFile(resolution.filePath)) {
      return { type: "sourceFile", filePath: STUB_LOCALE };
    }
    return resolution;
  };
  return config;
}

module.exports = {
  HIDDEN_GAME_SCREENS,
  LAUNCH_LOCALES,
  STUB_LOCALE,
  STUB_SCREEN,
  isExcludedLocaleFile,
  isExcludedScreen,
  isStoreBundle,
  withStoreBundleExclusions,
};
