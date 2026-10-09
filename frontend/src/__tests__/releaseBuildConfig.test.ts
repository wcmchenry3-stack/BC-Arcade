/**
 * @jest-environment ./jest-env/node.js
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
 * iOS API-target selection at Xcode Cloud time is enforced by ios/ci_scripts/
 * select_api_target.sh (PR #2774, merged); this file only pins the Android/JS
 * side (tracked .env.production).
 *
 * What it adds, by reading the real source/config files (Jest cannot render
 * App.tsx):
 *  1. every route App.tsx registers statically is a free-game or shared route;
 *     premium routes come only from the visibility-filtered registry;
 *  2. no purchase / IAP dependency exists, and the only paywall surface is the
 *     Paywall modal (#841), registered solely behind the premium-visibility
 *     gate, so it has no route in a store build;
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
import { createFakePurchaseAdapter } from "../purchases/fakeAdapter";
import { registerPurchaseAdapterFactory, selectPurchaseAdapter } from "../purchases/selectAdapter";
import { unavailablePurchaseAdapter } from "../purchases/unavailableAdapter";

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
const PURCHASE_WORDS = /paywall|purchase|checkout|billing|iap/i;

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

    // The paywall (#841) is the one permitted purchase screen; it is reachable
    // only through the visibility-gated route asserted below.
    const screens = fs.readdirSync(path.join(frontendRoot, "src/screens"));
    expect(screens.filter((f) => PURCHASE_WORDS.test(f))).toEqual(["PaywallScreen.tsx"]);
    // ...and its route type is the only purchase word in the navigation types.
    const navTypes = read("src/types/navigation.ts").replace(
      /\/\*\*(?:(?!\*\/)[^])*\*\/\s*Paywall: \{ gameSlug: string \};/,
      ""
    );
    expect(navTypes).not.toMatch(PURCHASE_WORDS);
  });

  it("registers the Paywall route only behind the premium-visibility gate, never in a stack of free games", () => {
    const app = read("App.tsx");
    const registrations = app.match(/name="Paywall"/g) ?? [];
    expect(registrations).toHaveLength(1);
    expect(app).toMatch(
      /visiblePremiumRoutes\(\)\.length > 0 &&\s*\(\s*<Stack\.Screen\s+name="Paywall"/
    );
    expect(app).not.toMatch(/<HomeStack\.Screen\s+name="Paywall"/);
    // ...and in a store build that gate is false, so no Paywall route exists.
    __forceStoreBuildForTests(true);
    try {
      expect(visiblePremiumRoutes()).toEqual([]);
    } finally {
      __forceStoreBuildForTests(false);
    }
  });

  it("App.tsx mounts <PurchaseProvider> without an adapter override", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/<PurchaseProvider[\s>]/);
    expect(app).not.toMatch(/<PurchaseProvider[^>]*adapter=/);
  });

  it("only HomeScreen navigates to the Paywall", () => {
    const users = walk(path.join(frontendRoot, "src"))
      .concat(path.join(frontendRoot, "App.tsx"))
      .filter((f) => /navigate\(\s*["']Paywall["']/.test(fs.readFileSync(f, "utf-8")))
      .map((f) => path.basename(f));
    expect(users).toEqual(["HomeScreen.tsx"]);
  });

  it("no non-test source imports the fake purchase adapter", () => {
    const files = walk(path.join(frontendRoot, "src")).concat(path.join(frontendRoot, "App.tsx"));
    const offenders = files
      .filter((f) => path.basename(f) !== "fakeAdapter.ts")
      .filter((f) =>
        /createFakePurchaseAdapter|purchases\/fakeAdapter|\.\/fakeAdapter/.test(
          fs.readFileSync(f, "utf-8")
        )
      )
      .map((f) => path.relative(frontendRoot, f));
    expect(offenders).toEqual([]);
  });

  it("the purchase adapter stays unavailable in a store build even if a real one is registered", () => {
    __forceStoreBuildForTests(true);
    registerPurchaseAdapterFactory(() => createFakePurchaseAdapter());
    try {
      expect(selectPurchaseAdapter({ applyToken: async () => {} })).toBe(
        unavailablePurchaseAdapter
      );
    } finally {
      registerPurchaseAdapterFactory(null);
      __forceStoreBuildForTests(false);
    }
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
    expect(app).toContain("<NavigationContainer");
    expect(app).not.toMatch(/<NavigationContainer[^>]*\blinking=/);
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
  // iOS API selection is enforced in ios/ci_scripts/ci_post_clone.sh via
  // select_api_target.sh (PR #2774); docs/ANDROID-CI.md covers the AAB bundle check.
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

  it("no release input enables EXPO_PUBLIC_TEST_HOOKS (#2975)", () => {
    // Inputs a store build reads: every tracked dotenv file, the Android
    // gradle config, and the Xcode Cloud env file. Only the test-hook CI jobs
    // (ci.yml e2e, mobile-smoke-*) may set it, never these.
    const enabling = /^\s*(export\s+)?EXPO_PUBLIC_TEST_HOOKS\s*=\s*["']?1/m;
    const inputs = [
      ".env",
      ".env.example",
      ".env.production",
      "ios/.xcode.env",
      "android/gradle.properties",
    ];
    for (const rel of inputs)
      expect({ rel, enabled: enabling.test(read(rel)) }).toEqual({ rel, enabled: false });
  });

  it("gradle config does not hard-code a dev or local API", () => {
    expect(read("android/app/build.gradle")).not.toMatch(/dev-games-api|EXPO_PUBLIC_API_URL/);
    expect(read("android/gradle.properties")).not.toMatch(/dev-games-api|EXPO_PUBLIC_API_URL/);
  });
});

describe("Android release cannot silently fall back to debug signing (#2783)", () => {
  // These are string-presence checks on build.gradle / workflow YAML: jest has
  // no Android SDK, so the Gradle logic itself is never executed here.
  const gradle = read("android/app/build.gradle");
  const workflowsDir = path.join(frontendRoot, "../.github/workflows");
  const workflows = fs
    .readdirSync(workflowsDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(workflowsDir, f), "utf-8") }));

  it("release-artifact tasks fail without a real upload keystore unless explicitly opted out", () => {
    expect(gradle).toContain("ALLOW_DEBUG_SIGNED_RELEASE");
    expect(gradle).toMatch(/throw new GradleException\(\s*"Refusing to build a release artifact/);
    expect(gradle).toMatch(/store\.name == 'debug\.keystore'/);
    expect(gradle).toContain("androiddebugkey");
    expect(gradle).toContain(
      "/^(assemble|bundle|install|package|sign|validateSigning)Release(Bundle)?$/"
    );
    expect(gradle).toMatch(/logger\.warn\(/);
  });

  it("only the CI android-release-smoke step opts into debug-signed release", () => {
    const optIns = workflows.flatMap((w) =>
      w.text
        .split("\n")
        .filter((l) => l.includes("ALLOW_DEBUG_SIGNED_RELEASE"))
        .map(() => w.name)
    );
    expect(optIns).toEqual(["ci.yml"]);

    const ci = workflows.find((w) => w.name === "ci.yml")!.text;
    // The flag must sit inside the assembleRelease command of the smoke step
    // (a single shell command ending at the first blank line / next step).
    const start = ci.indexOf("./gradlew assembleRelease");
    expect(start).toBeGreaterThan(-1);
    const command = ci.slice(start).split(/\n\s*-\s+name:|\n\s*\n/)[0];
    expect(command).toContain("-PALLOW_DEBUG_SIGNED_RELEASE=true");
    expect(read("android/gradle.properties")).not.toMatch(/^ALLOW_DEBUG_SIGNED_RELEASE/m);
  });
});

describe("iOS export compliance declares exempt (OS-only) encryption", () => {
  // The app's only encryption is HTTPS through the OS networking/TLS stack
  // (plus crypto.randomUUID for IDs), which is exempt, so App Store Connect
  // must not prompt for export compliance on each build. If you add custom or
  // non-OS crypto (e.g. a crypto/cipher library, SQLCipher, a VPN/E2E SDK),
  // re-evaluate the declaration instead of updating this test.
  // See docs/RELEASE-ACCEPTANCE-v1.0.md "Store build requirements".
  it("Info.plist sets ITSAppUsesNonExemptEncryption to false", () => {
    const plist = read("ios/GamingApp/Info.plist");
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
    expect(plist.match(/<key>ITSAppUsesNonExemptEncryption<\/key>/g)).toHaveLength(1);
  });

  it("app.json mirrors it so a prebuild keeps the same value", () => {
    const ios = JSON.parse(read("app.json")).expo.ios;
    expect(ios.config.usesNonExemptEncryption).toBe(false);
    expect(ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it("depends on no third-party encryption library", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const cryptoLib = /crypt|cipher|sodium|openssl|tweetnacl|jose|node-forge|sqlcipher|aes-/i;
    expect(deps.filter((d) => cryptoLib.test(d))).toEqual([]);
  });
});
