/**
 * gameVisibility (#2390) — the only automated guard that a store build hides
 * the premium games (Maestro is descoped for launch). `SHOW_HIDDEN_GAMES` is a
 * module-level constant, so each build flavour is loaded in isolation.
 */

import { PREMIUM_GAMES } from "../EntitlementContext";

const PREMIUM_SLUGS = ["yacht", "cascade", "hearts", "sudoku", "starswarm", "sort"];
const FREE_SLUGS = ["blackjack", "solitaire", "freecell", "mahjong", "daily_word", "twenty48"];

type GameVisibility = typeof import("../gameVisibility");
type DevGlobal = typeof globalThis & { __DEV__: boolean };

function loadWith({ dev, testHooks }: { dev: boolean; testHooks?: string }): GameVisibility {
  (globalThis as DevGlobal).__DEV__ = dev;
  if (testHooks === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = testHooks;

  let mod!: GameVisibility;
  jest.isolateModules(() => {
    mod = jest.requireActual("../gameVisibility");
  });
  return mod;
}

describe("gameVisibility", () => {
  const originalDev = (globalThis as DevGlobal).__DEV__;
  const originalTestHooks = process.env.EXPO_PUBLIC_TEST_HOOKS;

  afterEach(() => {
    (globalThis as DevGlobal).__DEV__ = originalDev;
    if (originalTestHooks === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = originalTestHooks;
  });

  it("Jest itself runs as a dev build, so every other suite still sees all 12 games", () => {
    expect(originalDev).toBe(true);
  });

  describe("store build (__DEV__ false, test hooks unset)", () => {
    it("hides all six premium games", () => {
      const { isGameVisible, SHOW_HIDDEN_GAMES } = loadWith({ dev: false });
      expect(SHOW_HIDDEN_GAMES).toBe(false);
      for (const slug of PREMIUM_SLUGS) expect(isGameVisible(slug)).toBe(false);
    });

    it("keeps all six free games", () => {
      const { isGameVisible } = loadWith({ dev: false });
      for (const slug of FREE_SLUGS) expect(isGameVisible(slug)).toBe(true);
    });

    it('only the exact value "1" enables test hooks', () => {
      for (const value of ["0", "true", ""]) {
        const { isGameVisible } = loadWith({ dev: false, testHooks: value });
        expect(isGameVisible("yacht")).toBe(false);
      }
    });
  });

  it("e2e test build (EXPO_PUBLIC_TEST_HOOKS=1) shows every game", () => {
    const { isGameVisible, SHOW_HIDDEN_GAMES } = loadWith({ dev: false, testHooks: "1" });
    expect(SHOW_HIDDEN_GAMES).toBe(true);
    for (const slug of [...PREMIUM_SLUGS, ...FREE_SLUGS]) expect(isGameVisible(slug)).toBe(true);
  });

  it("dev build shows every game", () => {
    const { isGameVisible } = loadWith({ dev: true });
    for (const slug of [...PREMIUM_SLUGS, ...FREE_SLUGS]) expect(isGameVisible(slug)).toBe(true);
  });

  it("HIDDEN_GAMES is exactly the premium set gated by EntitlementContext", () => {
    const { HIDDEN_GAMES } = loadWith({ dev: false });
    expect([...HIDDEN_GAMES].sort()).toEqual([...PREMIUM_GAMES].sort());
  });
});
