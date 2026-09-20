/**
 * gameVisibility (#2390) — the only automated guard that a store build hides
 * the premium games (Maestro is descoped for launch). `SHOW_HIDDEN_GAMES` is a
 * module-level constant, so each build flavour is loaded in isolation.
 */

import * as fs from "fs";
import * as path from "path";

import { PREMIUM_GAMES } from "../EntitlementContext";

const PREMIUM_SLUGS = ["yacht", "cascade", "hearts", "sudoku", "starswarm", "sort"];
const FREE_SLUGS = ["blackjack", "solitaire", "freecell", "mahjong", "daily_word", "twenty48"];

const PRE_LAUNCH_API_URL = "https://dev-games-api.buffingchi.com";
const PRODUCTION_API_URL = "https://games-api.buffingchi.com";

type GameVisibility = typeof import("../gameVisibility");
type DevGlobal = typeof globalThis & { __DEV__: boolean };

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function loadWith({
  dev,
  testHooks,
  apiUrl,
}: {
  dev: boolean;
  testHooks?: string;
  apiUrl?: string;
}): GameVisibility {
  (globalThis as DevGlobal).__DEV__ = dev;
  setEnv("EXPO_PUBLIC_TEST_HOOKS", testHooks);
  setEnv("EXPO_PUBLIC_API_URL", apiUrl);

  let mod!: GameVisibility;
  jest.isolateModules(() => {
    mod = jest.requireActual("../gameVisibility");
  });
  return mod;
}

describe("gameVisibility", () => {
  const originalDev = (globalThis as DevGlobal).__DEV__;
  const originalTestHooks = process.env.EXPO_PUBLIC_TEST_HOOKS;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    (globalThis as DevGlobal).__DEV__ = originalDev;
    setEnv("EXPO_PUBLIC_TEST_HOOKS", originalTestHooks);
    setEnv("EXPO_PUBLIC_API_URL", originalApiUrl);
  });

  it("Jest itself runs as a dev build, so every other suite still sees all 12 games", () => {
    expect(originalDev).toBe(true);
  });

  describe("store build (__DEV__ false, test hooks unset, production API)", () => {
    it("hides all six premium games", () => {
      const { isGameVisible, SHOW_HIDDEN_GAMES } = loadWith({
        dev: false,
        apiUrl: PRODUCTION_API_URL,
      });
      expect(SHOW_HIDDEN_GAMES).toBe(false);
      for (const slug of PREMIUM_SLUGS) expect(isGameVisible(slug)).toBe(false);
    });

    it("keeps all six free games", () => {
      const { isGameVisible } = loadWith({ dev: false, apiUrl: PRODUCTION_API_URL });
      for (const slug of FREE_SLUGS) expect(isGameVisible(slug)).toBe(true);
    });

    it('only the exact value "1" enables test hooks', () => {
      for (const value of ["0", "true", ""]) {
        const { isGameVisible } = loadWith({
          dev: false,
          testHooks: value,
          apiUrl: PRODUCTION_API_URL,
        });
        expect(isGameVisible("yacht")).toBe(false);
      }
    });

    it("fails closed: no API URL, an unknown host or a lookalike is still a store build", () => {
      const notPreLaunch = [
        undefined,
        "",
        "https://example.org",
        "http://dev-games-api.buffingchi.com", // plain http
        "https://dev-games-api.buffingchi.com.example.org", // suffix lookalike
        "https://dev-games-api.buffingchi.com@example.org", // userinfo trick
        "https://xdev-games-api.buffingchi.com", // prefix lookalike
        "https://example.org/?u=https://dev-games-api.buffingchi.com",
      ];
      for (const apiUrl of notPreLaunch) {
        const { SHOW_HIDDEN_GAMES } = loadWith({ dev: false, apiUrl });
        expect({ apiUrl, SHOW_HIDDEN_GAMES }).toEqual({ apiUrl, SHOW_HIDDEN_GAMES: false });
      }
    });
  });

  describe("pre-launch build (__DEV__ false, test hooks unset, pre-launch API)", () => {
    it("shows every game — internal TestFlight / Play builds until launch", () => {
      for (const apiUrl of [PRE_LAUNCH_API_URL, `${PRE_LAUNCH_API_URL}/`]) {
        const { isGameVisible, SHOW_HIDDEN_GAMES } = loadWith({ dev: false, apiUrl });
        expect(SHOW_HIDDEN_GAMES).toBe(true);
        for (const slug of [...PREMIUM_SLUGS, ...FREE_SLUGS]) {
          expect(isGameVisible(slug)).toBe(true);
        }
      }
    });
  });

  it("e2e test build (EXPO_PUBLIC_TEST_HOOKS=1) shows every game", () => {
    const { isGameVisible, SHOW_HIDDEN_GAMES } = loadWith({
      dev: false,
      testHooks: "1",
      apiUrl: PRODUCTION_API_URL,
    });
    expect(SHOW_HIDDEN_GAMES).toBe(true);
    for (const slug of [...PREMIUM_SLUGS, ...FREE_SLUGS]) expect(isGameVisible(slug)).toBe(true);
  });

  it("dev build shows every game", () => {
    const { isGameVisible } = loadWith({ dev: true, apiUrl: PRODUCTION_API_URL });
    for (const slug of [...PREMIUM_SLUGS, ...FREE_SLUGS]) expect(isGameVisible(slug)).toBe(true);
  });

  it("HIDDEN_GAMES is exactly the premium set gated by EntitlementContext", () => {
    const { HIDDEN_GAMES } = loadWith({ dev: false });
    expect([...HIDDEN_GAMES].sort()).toEqual([...PREMIUM_GAMES].sort());
  });

  /**
   * "Change it back before launch" is not a to-do — it is what happens when the
   * release config is pointed at the production API. These read the real
   * config files so that stays true.
   */
  describe("release configuration", () => {
    // frontend/ is three levels above src/entitlements/__tests__/
    const frontendRoot = path.resolve(__dirname, "../../..");

    function apiUrlIn(relPath: string): string {
      const text = fs.readFileSync(path.join(frontendRoot, relPath), "utf-8");
      const value = text.match(/^EXPO_PUBLIC_API_URL=(.*)$/m)?.[1];
      if (value === undefined) {
        throw new Error(`${relPath} does not set EXPO_PUBLIC_API_URL`);
      }
      return value.trim();
    }

    it("a build using the tracked .env.production is a store build", () => {
      const { SHOW_HIDDEN_GAMES } = loadWith({ dev: false, apiUrl: apiUrlIn(".env.production") });
      expect(SHOW_HIDDEN_GAMES).toBe(false);
    });

    it("the URL Xcode Cloud writes is either the pre-launch API or the production API", () => {
      // ci_post_clone.sh force-writes .env on every Xcode Cloud build. Any third
      // value would silently change which games ship — update this test and the
      // release plan's launch-gating table together if one is ever needed.
      const xcodeCloudUrl = apiUrlIn("ios/ci_scripts/ci_post_clone.sh");
      expect([PRE_LAUNCH_API_URL, PRODUCTION_API_URL]).toContain(xcodeCloudUrl);

      const { SHOW_HIDDEN_GAMES } = loadWith({ dev: false, apiUrl: xcodeCloudUrl });
      expect(SHOW_HIDDEN_GAMES).toBe(xcodeCloudUrl === PRE_LAUNCH_API_URL);
    });
  });
});
