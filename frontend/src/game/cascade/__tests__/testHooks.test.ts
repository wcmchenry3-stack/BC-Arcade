/**
 * Cascade's E2E hooks (#3693): the same twelve (#3904: `setupWin`) `__cascade_*` names in a test build, nothing in a
 * store build.
 */
import { registerCascadeTestHooks, type CascadeHookDeps } from "../testHooks";

const ORIGINAL = process.env.EXPO_PUBLIC_TEST_HOOKS;
const NAMES = [
  "getState",
  "setSeed",
  "dropAt",
  "fastForward",
  "triggerGameOver",
  "isReady",
  "spawnTierAt",
  "seedQueue",
  "setupChain",
  "setupNearLid",
  "fillBin",
  "setupWin",
] as const;
const g = globalThis as unknown as Record<string, unknown>;

function deps(): CascadeHookDeps {
  return {
    getState: jest.fn(() => ({
      score: 0,
      gameOver: false,
      nextFruitTier: 0,
      comboCount: 0,
      fruitCount: 0,
      dangerRatio: 0,
      fruits: [],
    })),
    setSeed: jest.fn(),
    dropAt: jest.fn(),
    fastForward: jest.fn(),
    triggerGameOver: jest.fn(),
    isReady: jest.fn(() => true),
    spawnTierAt: jest.fn(),
    seedQueue: jest.fn(),
    setupChain: jest.fn(),
    setupNearLid: jest.fn(),
    fillBin: jest.fn(),
    setupWin: jest.fn(),
  };
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = ORIGINAL;
  for (const n of NAMES) delete g[`__cascade_${n}`];
});

describe("registerCascadeTestHooks", () => {
  it("installs every __cascade_* hook in a test build, wired to the deps, and removes them", () => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    const d = deps();
    const cleanup = registerCascadeTestHooks(d);
    for (const n of NAMES) expect(typeof g[`__cascade_${n}`]).toBe("function");

    (g.__cascade_setSeed as (s: number) => void)(7);
    (g.__cascade_dropAt as (x: number) => void)(120);
    (g.__cascade_fastForward as (ms: number) => void)(500);
    (g.__cascade_spawnTierAt as (t: number, x: number) => void)(3, 200);
    (g.__cascade_triggerGameOver as () => void)();
    expect(d.setSeed).toHaveBeenCalledWith(7);
    expect(d.dropAt).toHaveBeenCalledWith(120);
    expect(d.fastForward).toHaveBeenCalledWith(500);
    expect(d.spawnTierAt).toHaveBeenCalledWith(3, 200);
    expect(d.triggerGameOver).toHaveBeenCalledTimes(1);
    (g.__cascade_seedQueue as (t: number[]) => void)([0, 0, 1]);
    (g.__cascade_setupChain as () => void)();
    (g.__cascade_setupNearLid as () => void)();
    (g.__cascade_fillBin as () => void)();
    (g.__cascade_setupWin as () => void)();
    expect(d.setupWin).toHaveBeenCalledTimes(1);
    expect(d.seedQueue).toHaveBeenCalledWith([0, 0, 1]);
    expect(d.setupChain).toHaveBeenCalledTimes(1);
    expect(d.setupNearLid).toHaveBeenCalledTimes(1);
    expect(d.fillBin).toHaveBeenCalledTimes(1);
    expect((g.__cascade_isReady as () => boolean)()).toBe(true);
    expect((g.__cascade_getState as () => { score: number })().score).toBe(0);

    cleanup();
    for (const n of NAMES) expect(g[`__cascade_${n}`]).toBeUndefined();
  });

  it("installs nothing in a store build", () => {
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    registerCascadeTestHooks(deps());
    for (const n of NAMES) expect(g[`__cascade_${n}`]).toBeUndefined();
  });
});
