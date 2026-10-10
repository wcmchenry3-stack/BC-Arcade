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
const EXCLUDED_PATHS = new Set(
  Object.values(HIDDEN_GAME_SCREENS)
    .flat()
    .map((name) => path.join(SCREENS_DIR, `${name}.tsx`))
);

/** True when a bundle hides the premium games, i.e. SHOW_HIDDEN_GAMES is false. */
function isStoreBundle(dev, env) {
  if (dev) return false;
  if (env.EXPO_PUBLIC_TEST_HOOKS === "1") return false;
  return !PRE_LAUNCH_API.test(env.EXPO_PUBLIC_API_URL ?? "");
}

/**
 * Wraps `resolver.resolveRequest` so a store bundle resolves the hidden games'
 * screens to the stub. Every other resolution is passed through untouched.
 */
function withStoreBundleExclusions(config, env = process.env) {
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolution = upstream
      ? upstream(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
    if (
      resolution.type === "sourceFile" &&
      EXCLUDED_PATHS.has(resolution.filePath) &&
      isStoreBundle(context.dev, env)
    ) {
      return { type: "sourceFile", filePath: STUB_SCREEN };
    }
    return resolution;
  };
  return config;
}

module.exports = {
  HIDDEN_GAME_SCREENS,
  STUB_SCREEN,
  isStoreBundle,
  withStoreBundleExclusions,
};
