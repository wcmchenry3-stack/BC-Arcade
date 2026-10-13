/**
 * metro/storeBundle.js (#2830) keeps the hidden premium games' code and assets
 * out of store bundles. It runs in Metro, not the app, so these tests pin it to
 * the app-side rules it mirrors: SHOW_HIDDEN_GAMES (gameVisibility.ts) and the
 * premium screens lazyScreens.ts imports. It does the same for the locales
 * store builds do not offer (#3150), pinned here to LAUNCH_LOCALE_CODES and
 * the locale files on disk.
 */
import fs from "fs";
import path from "path";

import { isPreLaunchApiBuild, areTestHooksEnabled } from "../../game/_shared/envFlags";
import { LAUNCH_LOCALE_CODES, LOCALES } from "../../i18n/locales";
import { HIDDEN_GAMES } from "../gameVisibility";
import { PREMIUM_ROUTES } from "../premiumRoutes";

type Resolution = { type: string; filePath?: string };
type Resolver = (context: object, moduleName: string, platform: string | null) => Resolution;
type MetroConfigLike = { resolver: { resolveRequest?: Resolver } };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const storeBundle = require("../../../metro/storeBundle") as {
  HIDDEN_GAME_SCREENS: Record<string, string[]>;
  LAUNCH_LOCALES: string[];
  STUB_LOCALE: string;
  STUB_SCREEN: string;
  isExcludedLocaleFile: (filePath: string) => boolean;
  isExcludedScreen: (filePath: string) => boolean;
  isStoreBundle: (dev: boolean, env: Record<string, string | undefined>) => boolean;
  withStoreBundleExclusions: (
    config: MetroConfigLike,
    env: Record<string, string | undefined>
  ) => MetroConfigLike;
};

const SCREENS_DIR = path.resolve(__dirname, "../../screens");
const screenPath = (name: string) => path.join(SCREENS_DIR, `${name}.tsx`);

const LOCALES_DIR = path.resolve(__dirname, "../../i18n/locales");
/** Every translation file on disk, as [locale, absolute path]. */
const LOCALE_FILES: Array<[string, string]> = LOCALES.flatMap(({ code }) =>
  fs
    .readdirSync(path.join(LOCALES_DIR, code))
    .filter((file) => file.endsWith(".json"))
    .map((file): [string, string] => [code, path.join(LOCALES_DIR, code, file)])
);

const STORE_ENV = { EXPO_PUBLIC_API_URL: "https://games-api.buffingchi.com" };

describe("isStoreBundle", () => {
  // Mutate, never replace, process.env: Expo's env shim holds the original object.
  const KEYS = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_TEST_HOOKS"] as const;
  const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  function setEnv(env: Record<string, string | undefined>): void {
    for (const key of KEYS) {
      const value = key in env ? env[key] : undefined;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  afterEach(() => setEnv(original));

  // Every case the app-side predicate distinguishes, plus lookalikes it rejects.
  const envCases: Array<Record<string, string | undefined>> = [
    {},
    { EXPO_PUBLIC_API_URL: "https://games-api.buffingchi.com" },
    { EXPO_PUBLIC_API_URL: "https://dev-games-api.buffingchi.com" },
    { EXPO_PUBLIC_API_URL: "https://dev-games-api.buffingchi.com/v1" },
    { EXPO_PUBLIC_API_URL: "http://dev-games-api.buffingchi.com" },
    { EXPO_PUBLIC_API_URL: "https://dev-games-api.buffingchi.com.example.org" },
    { EXPO_PUBLIC_API_URL: "https://games-api.buffingchi.com", EXPO_PUBLIC_TEST_HOOKS: "1" },
    { EXPO_PUBLIC_API_URL: "https://games-api.buffingchi.com", EXPO_PUBLIC_TEST_HOOKS: "0" },
  ];

  it.each(envCases)("agrees with SHOW_HIDDEN_GAMES for a release bundle (%o)", (env) => {
    setEnv(env);
    const showsHiddenGames = areTestHooksEnabled() || isPreLaunchApiBuild();
    expect(storeBundle.isStoreBundle(false, env)).toBe(!showsHiddenGames);
  });

  it("never treats a dev bundle as a store bundle", () => {
    expect(storeBundle.isStoreBundle(true, STORE_ENV)).toBe(false);
    expect(storeBundle.isStoreBundle(true, {})).toBe(false);
  });
});

describe("HIDDEN_GAME_SCREENS", () => {
  it("covers exactly the hidden games", () => {
    expect(Object.keys(storeBundle.HIDDEN_GAME_SCREENS).sort()).toEqual([...HIDDEN_GAMES].sort());
  });

  it("lists only screens that exist, and the stub exists", () => {
    for (const name of Object.values(storeBundle.HIDDEN_GAME_SCREENS).flat()) {
      expect(fs.existsSync(screenPath(name))).toBe(true);
    }
    expect(fs.existsSync(storeBundle.STUB_SCREEN)).toBe(true);
  });

  it("includes the screen behind every premium route lazyScreens.ts imports", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../utils/lazyScreens.ts"), "utf8");
    for (const { slug, route } of PREMIUM_ROUTES) {
      const match = source.match(
        new RegExp(`\\b${route}: \\(\\) => import\\("\\.\\./screens/(\\w+)"\\)`)
      );
      expect(match).not.toBeNull();
      expect(storeBundle.HIDDEN_GAME_SCREENS[slug]).toContain(match![1]);
    }
  });
});

describe("isExcludedScreen", () => {
  it("matches a hidden screen and its platform variants", () => {
    for (const file of [
      "MahjongScreen.tsx",
      "MahjongScreen.ios.tsx",
      "MahjongScreen.native.tsx",
      "StarSwarmScreen.android.tsx",
    ]) {
      expect(storeBundle.isExcludedScreen(path.join(SCREENS_DIR, file))).toBe(true);
    }
  });

  it("ignores free screens, lookalikes and other directories", () => {
    for (const file of [
      path.join(SCREENS_DIR, "SudokuScreen.tsx"),
      path.join(SCREENS_DIR, "MahjongScreenHeader.tsx"),
      path.join(SCREENS_DIR, "__tests__", "MahjongScreen.tsx"),
      path.join(SCREENS_DIR, "..", "components", "MahjongScreen.tsx"),
    ]) {
      expect(storeBundle.isExcludedScreen(file)).toBe(false);
    }
  });
});

describe("withStoreBundleExclusions", () => {
  const excluded = screenPath("MahjongScreen");
  const kept = screenPath("SudokuScreen");

  function resolverFor(env: Record<string, string | undefined>, upstream?: Resolver) {
    const config = storeBundle.withStoreBundleExclusions(
      { resolver: { resolveRequest: upstream } },
      env
    );
    return config.resolver.resolveRequest!;
  }

  // Default resolver: maps the module name straight to a file path.
  const context = (dev: boolean) => ({
    dev,
    resolveRequest: (_ctx: object, moduleName: string) => ({
      type: "sourceFile",
      filePath: moduleName,
    }),
  });

  it("stubs a hidden game's screen in a store bundle", () => {
    expect(resolverFor(STORE_ENV)(context(false), excluded, "android")).toEqual({
      type: "sourceFile",
      filePath: storeBundle.STUB_SCREEN,
    });
  });

  it("keeps hidden games' screens in dev, e2e and pre-launch bundles", () => {
    expect(resolverFor(STORE_ENV)(context(true), excluded, "ios").filePath).toBe(excluded);
    expect(
      resolverFor({ ...STORE_ENV, EXPO_PUBLIC_TEST_HOOKS: "1" })(context(false), excluded, "ios")
        .filePath
    ).toBe(excluded);
    expect(
      resolverFor({ EXPO_PUBLIC_API_URL: "https://dev-games-api.buffingchi.com" })(
        context(false),
        excluded,
        "android"
      ).filePath
    ).toBe(excluded);
  });

  it("passes every other resolution through", () => {
    expect(resolverFor(STORE_ENV)(context(false), kept, "android").filePath).toBe(kept);
    const asset = { type: "assetFiles", filePaths: ["x.png"] };
    const upstream: Resolver = () => asset;
    expect(resolverFor(STORE_ENV, upstream)(context(false), "./x.png", "ios")).toBe(asset);
  });

  it("chains to an existing resolveRequest (e.g. Sentry's)", () => {
    const upstream = jest.fn<Resolution, Parameters<Resolver>>(() => ({
      type: "sourceFile",
      filePath: excluded,
    }));
    const result = resolverFor(STORE_ENV, upstream)(
      context(false),
      "../screens/MahjongScreen",
      "ios"
    );
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(result.filePath).toBe(storeBundle.STUB_SCREEN);
  });
});

describe("LAUNCH_LOCALES", () => {
  it("mirrors LAUNCH_LOCALE_CODES", () => {
    expect([...storeBundle.LAUNCH_LOCALES].sort()).toEqual([...LAUNCH_LOCALE_CODES].sort());
  });

  it("has an empty stub", () => {
    expect(JSON.parse(fs.readFileSync(storeBundle.STUB_LOCALE, "utf8"))).toEqual({});
  });
});

describe("isExcludedLocaleFile", () => {
  it("matches exactly the non-launch locales' files", () => {
    expect(LOCALE_FILES.length).toBeGreaterThan(LOCALES.length);
    for (const [code, file] of LOCALE_FILES) {
      expect({ file, excluded: storeBundle.isExcludedLocaleFile(file) }).toEqual({
        file,
        excluded: !LAUNCH_LOCALE_CODES.has(code),
      });
    }
  });

  it("ignores translator metadata, the stub and lookalikes", () => {
    for (const file of [
      path.join(LOCALES_DIR, "_meta", "common.meta.json"),
      path.join(LOCALES_DIR, "provenance.json"),
      storeBundle.STUB_LOCALE,
      path.join(LOCALES_DIR, "de", "common.ts"),
      path.join(LOCALES_DIR, "de", "nested", "common.json"),
      path.join(SCREENS_DIR, "locales", "de", "common.json"),
    ]) {
      expect(storeBundle.isExcludedLocaleFile(file)).toBe(false);
    }
  });
});

describe("withStoreBundleExclusions: locales (#3150)", () => {
  type Env = Record<string, string | undefined>;
  // The locale files a bundle ends up with: what each `import()` target resolves to.
  function bundledLocaleFiles(env: Env, dev: boolean, platform: string): string[] {
    const config = storeBundle.withStoreBundleExclusions({ resolver: {} }, env);
    const context = {
      dev,
      resolveRequest: (_ctx: object, moduleName: string) => ({
        type: "sourceFile",
        filePath: moduleName,
      }),
    };
    return LOCALE_FILES.map(
      ([, file]) => config.resolver.resolveRequest!(context, file, platform).filePath!
    );
  }
  const allFiles = LOCALE_FILES.map(([, file]) => file);
  const launchFiles = LOCALE_FILES.filter(([code]) => LAUNCH_LOCALE_CODES.has(code)).map(
    ([, file]) => file
  );

  it.each(["ios", "android"])("%s store bundle has no non-launch locale JSON", (platform) => {
    const bundled = bundledLocaleFiles(STORE_ENV, false, platform);
    expect(bundled.filter((file) => file !== storeBundle.STUB_LOCALE)).toEqual(launchFiles);
    expect(bundled.filter((file) => file === storeBundle.STUB_LOCALE)).toHaveLength(
      allFiles.length - launchFiles.length
    );
  });

  it("web bundles keep every locale, store config included", () => {
    expect(bundledLocaleFiles(STORE_ENV, false, "web")).toEqual(allFiles);
  });

  it.each(["ios", "android", "web"])("%s dev bundle keeps every locale", (platform) => {
    expect(bundledLocaleFiles(STORE_ENV, true, platform)).toEqual(allFiles);
  });

  it.each(["ios", "android"])("%s e2e and pre-launch bundles keep every locale", (platform) => {
    expect(
      bundledLocaleFiles({ ...STORE_ENV, EXPO_PUBLIC_TEST_HOOKS: "1" }, false, platform)
    ).toEqual(allFiles);
    expect(
      bundledLocaleFiles(
        { EXPO_PUBLIC_API_URL: "https://dev-games-api.buffingchi.com" },
        false,
        platform
      )
    ).toEqual(allFiles);
  });
});

describe("StoreBuildExcludedScreen", () => {
  it("renders nothing", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stub = require("../../screens/StoreBuildExcludedScreen").default as () => null;
    expect(Stub()).toBeNull();
  });
});
