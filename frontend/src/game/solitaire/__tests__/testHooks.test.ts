/**
 * Solitaire's draw-3 test hook (#3532): a fixed draw-3 deal in test builds,
 * nothing in store builds.
 */
import { dealGame, drawDealSeed } from "../engine";
import { isTestDealControlShown, registerSolitaireTestHooks } from "../testHooks";

const ORIGINAL = process.env.EXPO_PUBLIC_TEST_HOOKS;
type Hooked = { __solitaire_deal?: (drawMode: number) => void };
const g = globalThis as unknown as Hooked;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = ORIGINAL;
  delete g.__solitaire_deal;
});

describe("registerSolitaireTestHooks", () => {
  it("installs __solitaire_deal in a test build and removes it on cleanup", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const deal = jest.fn();
    const cleanup = registerSolitaireTestHooks({ deal });
    g.__solitaire_deal!(3);
    g.__solitaire_deal!(7);
    expect(deal.mock.calls).toEqual([[3], [1]]);
    cleanup();
    expect(g.__solitaire_deal).toBeUndefined();
  });

  it("installs nothing in a store build", () => {
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    registerSolitaireTestHooks({ deal: jest.fn() });
    expect(g.__solitaire_deal).toBeUndefined();
  });
});

describe("isTestDealControlShown", () => {
  it("is true on native test builds only", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    expect(isTestDealControlShown("android")).toBe(true);
    expect(isTestDealControlShown("ios")).toBe(true);
    expect(isTestDealControlShown("web")).toBe(false);
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    expect(isTestDealControlShown("android")).toBe(false);
    expect(isTestDealControlShown("ios")).toBe(false);
  });
});

// The deal the draw-3 Maestro flow documents (e2e/maestro/flows/solitaire/
// drag-draw3.yaml). If the seed bank or the shuffle changes, this fails and
// the flow's header and coordinates must be re-derived.
describe("the fixed draw-3 deal", () => {
  const label = (c: { rank: number; suit: string }) =>
    `${({ 1: "A", 11: "J", 12: "Q", 13: "K" } as Record<number, string>)[c.rank] ?? c.rank}${
      ({ spades: "S", hearts: "H", diamonds: "D", clubs: "C" } as Record<string, string>)[c.suit]
    }`;

  it("is seed 3 in every test build", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    expect(drawDealSeed(3)).toEqual({ seed: 3, index: 0 });
    expect(drawDealSeed(3)).toEqual({ seed: 3, index: 0 });
  });

  it("has the tops and stock order the flow relies on", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const s = dealGame(3);
    expect(s.drawMode).toBe(3);
    expect(s.tableau.map((p) => label(p[p.length - 1]!))).toEqual([
      "KH",
      "QS",
      "4H",
      "QD",
      "JD",
      "2D",
      "8C",
    ]);
    // The stock draws from its end.
    expect([...s.stock].reverse().map(label)).toEqual(
      "KS 3D 5C KD 6H 2C 4D 5H 2S 7D 7S 4C 9H QC AD 8D 3C KC 10S JS 7H 8S 9D AH".split(" ")
    );
  });

  it("is random outside a test build", () => {
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    const seeds = new Set(Array.from({ length: 40 }, () => drawDealSeed(3).index));
    expect(seeds.size).toBeGreaterThan(1);
  });
});
