/**
 * gameVisibility (#2390) — the only automated guard that a store build hides
 * the premium games (Maestro is descoped for launch). `SHOW_HIDDEN_GAMES` is a
 * module-level constant, so each build flavour is loaded in isolation.
 */

import * as fs from "fs";
import * as path from "path";

import { PREMIUM_GAMES } from "../EntitlementContext";

const PREMIUM_SLUGS = ["blackjack", "cascade", "hearts", "sudoku", "starswarm", "sort"];
const FREE_SLUGS = ["yacht", "solitaire", "freecell", "mahjong", "daily_word", "twenty48"];

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
        expect(isGameVisible("blackjack")).toBe(false);
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

  it("the test seam can only hide: it never reveals hidden games in a store build", () => {
    const store = loadWith({ dev: false });
    store.__forceStoreBuildForTests(false);
    expect(store.isGameVisible("blackjack")).toBe(false);

    const dev = loadWith({ dev: true });
    dev.__forceStoreBuildForTests(true);
    expect(dev.isGameVisible("blackjack")).toBe(false);
    expect(dev.isGameVisible("yacht")).toBe(true);
    dev.__forceStoreBuildForTests(false);
    expect(dev.isGameVisible("blackjack")).toBe(true);
  });

  // v1.0 hides every premium game. Relax this when IAP (#822) unhides a subset.
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

    describe("Xcode Cloud (ios/ci_scripts/ci_post_clone.sh)", () => {
      // The script force-writes .env on every Xcode Cloud build, choosing the URL
      // from the workflow's BC_API_TARGET (docs/IOS.md). Any third URL, or a
      // default other than production, would silently change which games ship —
      // update this test and docs/IOS.md together if that is ever needed.
      const script = fs.readFileSync(
        path.join(frontendRoot, "ios/ci_scripts/ci_post_clone.sh"),
        "utf-8"
      );

      function assigned(name: string): string {
        const value = script.match(new RegExp(`^${name}=(\\S+)$`, "m"))?.[1];
        if (value === undefined) throw new Error(`ci_post_clone.sh does not set ${name}`);
        return value;
      }

      it("writes only the URL chosen by BC_API_TARGET into .env", () => {
        expect(script.match(/^EXPO_PUBLIC_API_URL=.*$/gm)).toEqual([
          "EXPO_PUBLIC_API_URL=$API_URL",
        ]);
      });

      it("knows exactly the pre-launch and the production API", () => {
        expect(assigned("PRELAUNCH_API_URL")).toBe(PRE_LAUNCH_API_URL);
        expect(assigned("PRODUCTION_API_URL")).toBe(PRODUCTION_API_URL);
        expect(loadWith({ dev: false, apiUrl: PRE_LAUNCH_API_URL }).SHOW_HIDDEN_GAMES).toBe(true);
        expect(loadWith({ dev: false, apiUrl: PRODUCTION_API_URL }).SHOW_HIDDEN_GAMES).toBe(false);
      });

      it("only BC_API_TARGET=prelaunch builds against the pre-launch API", () => {
        expect(script).toMatch(/^\s*prelaunch\) API_URL=\$PRELAUNCH_API_URL ;;$/m);
        expect(script.match(/\$PRELAUNCH_API_URL/g)).toHaveLength(1);
      });

      it("an unset BC_API_TARGET builds against production, an unknown one fails", () => {
        expect(script).toMatch(/^\s*""\|production\) API_URL=\$PRODUCTION_API_URL ;;$/m);
        expect(script).toMatch(/^\s*\*\)\n(?:\s*echo .*\n)?\s*exit 1\n\s*;;$/m);
      });
    });
  });
});
