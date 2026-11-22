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
import {
  __forceStoreBuildForTests,
  DISABLED_GAMES,
  HIDDEN_GAMES,
  isGameVisible,
} from "../gameVisibility";
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
  STUBBED_MODULES: Map<string, string>;
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

// The hidden games' lobby tile images and their image-free store stand-in (#4011).
const HOME_COMPONENTS = path.resolve(__dirname, "../../components/home");
const TILE_ART = path.join(HOME_COMPONENTS, "hiddenGameTileArt.ts");
const TILE_ART_STORE = path.join(HOME_COMPONENTS, "hiddenGameTileArt.store.ts");

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

  // A disabled game (DISABLED_GAMES, empty today) stays out of store bundles too.
  // When #2875 shrinks HIDDEN_GAMES, storeBundle.js must keep excluding disabled games.
  it("has screens for every hidden or disabled game, so each can stay out of store bundles", () => {
    const keys = new Set(Object.keys(storeBundle.HIDDEN_GAME_SCREENS));
    for (const slug of [...HIDDEN_GAMES, ...DISABLED_GAMES]) expect(keys.has(slug)).toBe(true);
    // Cascade stands in for a disabled game while DISABLED_GAMES is empty.
    expect(storeBundle.HIDDEN_GAME_SCREENS.cascade.length).toBeGreaterThan(0);
    for (const name of storeBundle.HIDDEN_GAME_SCREENS.cascade) {
      expect(storeBundle.isExcludedScreen(screenPath(name))).toBe(true);
    }
  });

  it("excludes every disabled game's screens from store bundles", () => {
    for (const slug of DISABLED_GAMES) {
      expect(storeBundle.HIDDEN_GAME_SCREENS[slug]?.length ?? 0).toBeGreaterThan(0);
      for (const name of storeBundle.HIDDEN_GAME_SCREENS[slug]) {
        expect(storeBundle.isExcludedScreen(screenPath(name))).toBe(true);
      }
    }
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

  // #2960: Cascade's web route loads CanvasKit and its `.wasm`; it must be stubbed out of a
  // store web build like the screen itself while Cascade is in HIDDEN_GAMES.
  it("excludes Cascade's route and its web variant, so the store bundle has no CanvasKit", () => {
    for (const file of ["CascadeRoute.tsx", "CascadeRoute.web.tsx", "CascadeScreen.tsx"]) {
      expect({
        file,
        excluded: storeBundle.isExcludedScreen(path.join(SCREENS_DIR, file)),
      }).toEqual({ file, excluded: true });
    }
    expect(fs.existsSync(path.join(SCREENS_DIR, "CascadeRoute.web.tsx"))).toBe(true);
  });

  it("stubs CascadeRoute.web.tsx in a store web bundle, and keeps it in dev", () => {
    const route = path.join(SCREENS_DIR, "CascadeRoute.web.tsx");
    const config = storeBundle.withStoreBundleExclusions({ resolver: {} }, STORE_ENV);
    const resolve = (dev: boolean) =>
      config.resolver.resolveRequest!(
        {
          dev,
          resolveRequest: (_ctx: object, moduleName: string) => ({
            type: "sourceFile",
            filePath: moduleName,
          }),
        },
        route,
        "web"
      );
    expect(resolve(false)).toEqual({ type: "sourceFile", filePath: storeBundle.STUB_SCREEN });
    expect(resolve(true).filePath).toBe(route);
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

/**
 * Cascade's test controls (#3719) and demo set-ups ride on the Cascade screen. A store bundle has
 * no Cascade screen (it resolves to the empty stub), so none of their code reaches the store
 * build, as long as nothing else imports them. These tests pin both halves.
 */
describe("Cascade test controls stay out of store bundles (#3719)", () => {
  const SRC = path.resolve(__dirname, "../..");
  const CONTROL_MODULES = ["CascadeTestControls", "cascade/testHooks"];

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it("a store bundle resolves the Cascade screen to the stub; a test-hooks bundle keeps it", () => {
    const cascade = screenPath("CascadeScreen");
    const resolve = (env: Record<string, string | undefined>) =>
      storeBundle.withStoreBundleExclusions({ resolver: {} }, env).resolver.resolveRequest!(
        {
          dev: false,
          resolveRequest: (_c: object, name: string) => ({ type: "sourceFile", filePath: name }),
        } as object,
        cascade,
        "ios"
      );
    expect(resolve(STORE_ENV).filePath).toBe(storeBundle.STUB_SCREEN);
    expect(resolve({ ...STORE_ENV, EXPO_PUBLIC_TEST_HOOKS: "1" }).filePath).toBe(cascade);
  });

  it("only the Cascade screen imports the controls and the set-ups (outside tests)", () => {
    const importers = sourceFiles(SRC).filter((file) => {
      if (CONTROL_MODULES.some((m) => file.endsWith(`${m}.ts`) || file.endsWith(`${m}.tsx`))) {
        return false;
      }
      const source = fs.readFileSync(file, "utf8");
      return CONTROL_MODULES.some((m) => new RegExp(`from "[^"]*${m}"`).test(source));
    });
    expect(importers.map((f) => path.relative(SRC, f))).toEqual([
      path.join("screens", "CascadeScreen.tsx"),
    ]);
  });
});

/**
 * Lobby tile images (#4011). Metro packages every image HomeScreen imports, whether its tile
 * renders or not, so a hidden game's tile image lives in `hiddenGameTileArt.ts`, which a store
 * bundle resolves to an image-free stand-in. `starswarm-tile.webp` used to be imported by
 * HomeScreen directly and was packaged in store builds.
 */
describe("hidden games' lobby tile images stay out of store bundles (#4011)", () => {
  const HOME_SCREEN = path.resolve(__dirname, "../../screens/HomeScreen.tsx");
  const TILES_DIR = path.resolve(__dirname, "../../../assets/home");
  const resolve = (dev: boolean, env: Record<string, string | undefined>, platform = "android") =>
    storeBundle.withStoreBundleExclusions({ resolver: {} }, env).resolver.resolveRequest!(
      {
        dev,
        resolveRequest: (_c: object, name: string) => ({ type: "sourceFile", filePath: name }),
      } as object,
      TILE_ART,
      platform
    ).filePath;
  /** Games a store build keeps out: HIDDEN_GAMES union DISABLED_GAMES, like `isGameVisible`. */
  const STORE_EXCLUDED: ReadonlySet<string> = new Set([...HIDDEN_GAMES, ...DISABLED_GAMES]);
  /** Problems with the tile-art module: a non-excluded slug in it, or an excluded tile not in it. */
  const tileArtMismatches = (
    artSlugs: string[],
    onDisk: string[],
    excluded: ReadonlySet<string>
  ): string[] => [
    ...artSlugs.filter((slug) => !excluded.has(slug)).map((slug) => `not excluded: ${slug}`),
    ...onDisk
      .filter((slug) => excluded.has(slug) && !artSlugs.includes(slug))
      .map((slug) => `missing: ${slug}`),
  ];
  /** The excluded games' tiles that HomeScreen still imports directly. */
  const homeScreenMismatches = (homeSlugs: string[], excluded: ReadonlySet<string>): string[] =>
    homeSlugs.filter((slug) => excluded.has(slug));
  /** The `assets/home/<slug>-tile.*` images a source file imports, by slug. */
  const tileImports = (file: string): string[] =>
    [...fs.readFileSync(file, "utf8").matchAll(/assets\/home\/([a-z0-9_]+)-tile\.\w+"/g)].map(
      (m) => m[1]
    );

  it("a store bundle gets the stand-in; dev, e2e and pre-launch bundles keep the art", () => {
    for (const platform of ["android", "ios", "web"]) {
      expect(resolve(false, STORE_ENV, platform)).toBe(TILE_ART_STORE);
    }
    expect(resolve(true, STORE_ENV)).toBe(TILE_ART);
    expect(resolve(false, { ...STORE_ENV, EXPO_PUBLIC_TEST_HOOKS: "1" })).toBe(TILE_ART);
    expect(resolve(false, { EXPO_PUBLIC_API_URL: "https://dev-games-api.buffingchi.com" })).toBe(
      TILE_ART
    );
  });

  it("the tile art is the only module a store bundle swaps for a stand-in (#4013)", () => {
    // Cascade's Skia-drawn tile icon (#3698) and its emoji-only store variant are gone: its tile
    // is an image in hiddenGameTileArt.ts like the other hidden games'.
    expect([...storeBundle.STUBBED_MODULES]).toEqual([[TILE_ART, TILE_ART_STORE]]);
    expect(
      fs.existsSync(path.resolve(__dirname, "../../components/cascade/CascadeTileIcon.tsx"))
    ).toBe(false);
  });

  it("the art and its stand-in hold exactly the hidden games, and the store resolves all five to the stand-in (#4013)", () => {
    const keys = (file: string) =>
      [...fs.readFileSync(file, "utf8").matchAll(/^\s{2}(\w+): /gm)].map((m) => m[1]).sort();
    const hidden = [...HIDDEN_GAMES].sort();
    expect(hidden).toEqual(["blackjack", "cascade", "hearts", "mahjong", "starswarm"]);
    expect(keys(TILE_ART)).toEqual(hidden);
    expect(keys(TILE_ART_STORE)).toEqual(hidden);
    expect(tileImports(TILE_ART).sort()).toEqual(hidden);
    expect(resolve(false, STORE_ENV)).toBe(TILE_ART_STORE);
  });

  it("HomeScreen pulls in no Cascade component, so no Skia or piece art reaches a store bundle", () => {
    const src = fs.readFileSync(HOME_SCREEN, "utf8");
    expect(src).not.toMatch(/components\/cascade\//);
    expect(src).not.toMatch(/react-native-skia|FruitGlyph|game\/cascade\/art/);
  });

  it("the stand-in imports no image", () => {
    const stub = fs.readFileSync(TILE_ART_STORE, "utf8");
    expect(stub).not.toMatch(/\.(webp|png|jpe?g|svg)"/);
    expect(stub).not.toMatch(/require\(/);
    expect(stub).toMatch(/import type \{ HiddenGameTileArt \}/);
  });

  it("holds every hidden or disabled game's tile and only those", () => {
    const slugs = tileImports(TILE_ART);
    expect(slugs.length).toBeGreaterThan(0);
    const onDisk = fs
      .readdirSync(TILES_DIR)
      .map((file) => /^([a-z0-9_]+)-tile\.\w+$/.exec(file)?.[1])
      .filter((slug): slug is string => slug !== undefined);
    expect(tileArtMismatches(slugs, onDisk, STORE_EXCLUDED)).toEqual([]);
  });

  it("a disabled-only game's tile counts as excluded art (#4017)", () => {
    // `cascade` is only disabled here: its tile must live in hiddenGameTileArt.ts, not HomeScreen.
    const excluded = new Set([...new Set(["starswarm"]), ...new Set(["cascade"])]);
    expect(
      tileArtMismatches(["starswarm", "cascade"], ["starswarm", "cascade", "yacht"], excluded)
    ).toEqual([]);
    // Tile art missing for the disabled game, or a disabled game's tile left in HomeScreen.
    expect(tileArtMismatches(["starswarm"], ["starswarm", "cascade"], excluded)).not.toEqual([]);
    expect(homeScreenMismatches(["yacht", "cascade"], excluded)).toEqual(["cascade"]);
    expect(homeScreenMismatches(["yacht"], excluded)).toEqual([]);
  });

  // No module exports the store-excluded set, so STORE_EXCLUDED above is recomputed from the real
  // sets; this ties it to the real rule (`isGameVisible` in a store build) so it cannot drift.
  it("STORE_EXCLUDED matches what isGameVisible hides in a store build", () => {
    __forceStoreBuildForTests(true);
    try {
      for (const slug of STORE_EXCLUDED) expect(isGameVisible(slug)).toBe(false);
      for (const slug of ["yacht", "sudoku", "sort", "twenty48"]) {
        expect(STORE_EXCLUDED.has(slug)).toBe(false);
        expect(isGameVisible(slug)).toBe(true);
      }
    } finally {
      __forceStoreBuildForTests(false);
    }
  });

  it("HomeScreen imports no hidden or disabled game's tile image directly", () => {
    const slugs = tileImports(HOME_SCREEN);
    expect(slugs.sort()).toEqual([
      "daily_word",
      "freecell",
      "solitaire",
      "sort",
      "sudoku",
      "twenty48",
      "yacht",
    ]);
    expect(homeScreenMismatches(slugs, STORE_EXCLUDED)).toEqual([]);
    expect(fs.readFileSync(HOME_SCREEN, "utf8")).toMatch(
      /from "\.\.\/components\/home\/hiddenGameTileArt"/
    );
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
