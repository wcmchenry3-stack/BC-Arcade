/**
 * @jest-environment node
 *
 * Store-build release guard (#2783).
 *
 * Automated half of "verify exactly the seven intended free games and no
 * accessible incomplete premium/purchase flows". It complements, and does not
 * repeat:
 *  - entitlements/__tests__/gameVisibility.test.ts  (visibility predicate per
 *    build flavour, .env.production, Xcode Cloud API selection),
 *  - entitlements/__tests__/premiumRoutes.test.ts   (premium route registry),
 *  - screens/__tests__/HomeScreen.test.tsx           (seven home tiles),
 *  - navigation/__tests__/mainTabs.test.tsx          (three tabs).
 * iOS API-target selection at Xcode Cloud time is tightened by PR #2774; this
 * file only pins the Android/JS side (tracked .env.production).
 *
 * What it adds, by reading the real source/config files (Jest cannot render
 * App.tsx):
 *  1. every route App.tsx registers statically is a free-game or shared route;
 *     premium routes come only from the visibility-filtered registry;
 *  2. no purchase / paywall / IAP dependency, screen, or route exists;
 *  3. no deep-link surface: no React Navigation `linking` config and no
 *     Android VIEW intent-filter, so an external URL cannot open any screen;
 *  4. the production env file targets the production API and nothing else.
 * Manual counterpart: docs/RELEASE-ACCEPTANCE-v1.0.md.
 */
import * as fs from "fs";
import * as path from "path";

import { PREMIUM_GAMES } from "../entitlements/EntitlementContext";
import { __forceStoreBuildForTests, isGameVisible } from "../entitlements/gameVisibility";
import { PREMIUM_ROUTES, visiblePremiumRoutes } from "../entitlements/premiumRoutes";

// frontend/ is one level above src/
const frontendRoot = path.resolve(__dirname, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(frontendRoot, rel), "utf-8");

/** Free games -> the Home stack route each opens (App.tsx). */
const FREE_GAME_ROUTES: Record<string, string> = {
  yacht: "Game",
  solitaire: "Solitaire",
  freecell: "FreeCell",
  sort: "Sort",
  daily_word: "DailyWord",
  twenty48: "Twenty48",
  sudoku: "Sudoku",
};
const SHARED_ROUTES = ["Home", "Leaderboard", "GameStats", "Scorecard"];
// Mahjong debug screens are only navigable from the (hidden) Mahjong game.
const MAHJONG_DEBUG_ROUTES = ["MahjongLayoutInspector", "MahjongLayoutDetail"];
const PRODUCTION_API_URL = "https://games-api.buffingchi.com";
const PURCHASE_WORDS = /paywall|purchase|upgrade|subscri|checkout/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("store build exposes exactly the seven free games", () => {
  afterEach(() => __forceStoreBuildForTests(false));

  it("the free set and the premium set partition the twelve games", () => {
    const free = Object.keys(FREE_GAME_ROUTES);
    expect(free).toHaveLength(7);
    expect(free.filter((s) => PREMIUM_GAMES.has(s))).toEqual([]);
    expect(PREMIUM_GAMES.size).toBe(5);
  });

  it("only the seven free games are visible; every premium game is hidden", () => {
    __forceStoreBuildForTests(true);
    const all = [...Object.keys(FREE_GAME_ROUTES), ...PREMIUM_GAMES];
    expect(all.filter(isGameVisible).sort()).toEqual(Object.keys(FREE_GAME_ROUTES).sort());
  });

  it("App.tsx statically registers only free-game and shared routes", () => {
    const app = read("App.tsx");
    const statics = [...app.matchAll(/<HomeStack\.Screen\s+name="(\w+)"/g)].map((m) => m[1]);
    const premiumNames = new Set<string>(PREMIUM_ROUTES.map((r) => r.route));
    const allowed = [...Object.values(FREE_GAME_ROUTES), ...SHARED_ROUTES, ...MAHJONG_DEBUG_ROUTES];
    expect(statics.length).toBeGreaterThan(0);
    for (const name of statics) {
      expect(premiumNames.has(name)).toBe(false);
      expect(allowed).toContain(name);
    }
    for (const route of Object.values(FREE_GAME_ROUTES)) expect(statics).toContain(route);
    // Premium routes must come from the visibility-filtered registry only.
    expect(app).toContain("visiblePremiumRoutes().map(");
  });

  it("the Mahjong debug screens are reachable only from the Mahjong screens (inspector -> detail)", () => {
    const users = walk(path.join(frontendRoot, "src"))
      .filter((f) =>
        /navigate\(\s*["']MahjongLayout(Inspector|Detail)["']/.test(fs.readFileSync(f, "utf-8"))
      )
      .map((f) => path.basename(f))
      .sort();
    expect(users).toEqual(["MahjongLayoutInspectorScreen.tsx", "MahjongScreen.tsx"]);
  });

  it("store build registers no premium route", () => {
    __forceStoreBuildForTests(true);
    expect(visiblePremiumRoutes()).toEqual([]);
  });
});

describe("no purchase / paywall entry point ships in v1.0", () => {
  it("has no in-app-purchase dependency", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => /(iap|purchases?|storekit|billing|revenuecat)/i.test(n))).toEqual(
      []
    );
  });

  it("imports no purchase SDK and declares no paywall/purchase screen or route", () => {
    const sdk =
      /from\s+["'](react-native-iap|react-native-purchases|expo-iap|expo-in-app-purchases|@revenuecat\/[^"']*)["']/;
    const files = walk(path.join(frontendRoot, "src")).concat(path.join(frontendRoot, "App.tsx"));
    const offenders = files
      .filter((file) => sdk.test(fs.readFileSync(file, "utf-8")))
      .map((file) => path.relative(frontendRoot, file));
    expect(offenders).toEqual([]);

    const screens = fs.readdirSync(path.join(frontendRoot, "src/screens"));
    expect(screens.filter((f) => PURCHASE_WORDS.test(f))).toEqual([]);
    expect(read("src/types/navigation.ts")).not.toMatch(PURCHASE_WORDS);
  });

  it("Android declares no billing permission or library", () => {
    expect(read("android/app/src/main/AndroidManifest.xml")).not.toMatch(/vending\.BILLING/);
    expect(read("android/app/build.gradle")).not.toMatch(/billing/i);
  });

  it("LockedGameScreen has one use, inside the premium guard of visibility-filtered routes", () => {
    const app = read("App.tsx");
    expect(app.match(/<LockedGameScreen\s*\/>/g) ?? []).toHaveLength(1);
    expect(app).toMatch(/if \(!canPlay\(slug\)\) return <LockedGameScreen \/>/);
  });
});

describe("no deep-link surface can open a screen", () => {
  it("App.tsx configures no React Navigation linking", () => {
    const app = read("App.tsx");
    expect(app).not.toMatch(/\blinking\s*=/);
    expect(app).not.toMatch(/Linking\.(addEventListener|getInitialURL)/);
    expect(app).toMatch(/<NavigationContainer>/);
  });

  it("Android has no inbound VIEW/BROWSABLE intent-filter or custom scheme", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    // The <queries> block (outbound https resolution) is not an inbound filter.
    const inbound = manifest.replace(/<queries>[\s\S]*?<\/queries>/, "");
    expect(inbound).not.toMatch(/android\.intent\.action\.VIEW/);
    expect(inbound).not.toMatch(/android\.intent\.category\.BROWSABLE/);
    expect(inbound).not.toMatch(/<data\b/);
    expect(read("app.json")).not.toMatch(/"scheme"/);
  });
  // iOS keeps the default com.buffingchi.games:// scheme in Info.plist. It can
  // launch the app but, with no `linking` config above, cannot navigate.
});

describe("production build targets the production API (Android / JS side)", () => {
  // Expo (production mode, e.g. Gradle bundleRelease) ranks .env.production
  // above the tracked .env, so .env's pre-launch URL never wins over it.
  // iOS API selection is enforced in ios/ci_scripts/ci_post_clone.sh and
  // tightened by PR #2774; docs/ANDROID-CI.md covers the AAB bundle check.
  const env = read(".env.production");

  it(".env.production sets EXPO_PUBLIC_API_URL to exactly the production API", () => {
    const values = [...env.matchAll(/^EXPO_PUBLIC_API_URL=(.*)$/gm)].map((m) => m[1].trim());
    expect(values).toEqual([PRODUCTION_API_URL]);
  });

  it(".env.production enables no test hooks and names no dev/local host", () => {
    expect(env).not.toMatch(/^EXPO_PUBLIC_TEST_HOOKS=/m);
    expect(env).not.toMatch(/dev-games-api|localhost|127\.0\.0\.1|10\.0\.2\.2/);
    expect(env).not.toMatch(/^EXPO_PUBLIC_SENTRY_ENVIRONMENT=/m);
  });

  it("gradle config does not hard-code a dev or local API", () => {
    expect(read("android/app/build.gradle")).not.toMatch(/dev-games-api|EXPO_PUBLIC_API_URL/);
    expect(read("android/gradle.properties")).not.toMatch(/dev-games-api|EXPO_PUBLIC_API_URL/);
  });
});

describe("Android release cannot silently fall back to debug signing (#2783)", () => {
  const gradle = read("android/app/build.gradle");
  const ci = fs.readFileSync(path.join(frontendRoot, "../.github/workflows/ci.yml"), "utf-8");

  it("release-artifact tasks fail without a real upload keystore unless explicitly opted out", () => {
    expect(gradle).toContain("ALLOW_DEBUG_SIGNED_RELEASE");
    expect(gradle).toMatch(/throw new GradleException\(\s*"Refusing to build a release artifact/);
    expect(gradle).toMatch(/store\.name == 'debug\.keystore'/);
  });

  it("only the CI release smoke build opts into debug-signed release", () => {
    const optIns = ci.split("\n").filter((l) => l.includes("ALLOW_DEBUG_SIGNED_RELEASE"));
    expect(optIns).toHaveLength(1);
    const smoke = ci.slice(ci.indexOf("./gradlew assembleRelease"));
    expect(smoke.slice(0, 400)).toContain("-PALLOW_DEBUG_SIGNED_RELEASE=true");
    expect(read("android/gradle.properties")).not.toMatch(/^ALLOW_DEBUG_SIGNED_RELEASE/m);
  });
});
