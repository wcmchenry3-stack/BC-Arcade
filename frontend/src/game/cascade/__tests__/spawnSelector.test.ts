import { MAX_SPAWN_TIER } from "../../../theme/fruitSets";
import {
  BASE_SPAWN_WEIGHTS,
  ControlledSpawnSelector,
  createSeededRng,
  randomSpawnTierPure,
  simulateSpawns,
} from "../spawnSelector";

describe("createSeededRng determinism", () => {
  it("same seed produces identical tier sequence", () => {
    const sel1 = new ControlledSpawnSelector(createSeededRng(42));
    const sel2 = new ControlledSpawnSelector(createSeededRng(42));
    for (let i = 0; i < 50; i++) {
      expect(sel1.next()).toBe(sel2.next());
    }
  });

  it("different seeds produce different sequences", () => {
    const run1 = new ControlledSpawnSelector(createSeededRng(1));
    const run2 = new ControlledSpawnSelector(createSeededRng(99999));
    const tiers1 = Array.from({ length: 50 }, () => run1.next());
    const tiers2 = Array.from({ length: 50 }, () => run2.next());
    expect(tiers1).not.toEqual(tiers2);
  });

  it("recreating with same seed after drops resets determinism", () => {
    const fresh = new ControlledSpawnSelector(createSeededRng(99));
    const firstRun = Array.from({ length: 20 }, () => fresh.next());

    const reset = new ControlledSpawnSelector(createSeededRng(99));
    const secondRun = Array.from({ length: 20 }, () => reset.next());

    expect(firstRun).toEqual(secondRun);
  });
});

describe("ControlledSpawnSelector", () => {
  it("always returns a valid spawn tier", () => {
    const selector = new ControlledSpawnSelector(createSeededRng(11));
    for (let i = 0; i < 500; i++) {
      const tier = selector.next();
      expect(tier).toBeGreaterThanOrEqual(0);
      expect(tier).toBeLessThanOrEqual(MAX_SPAWN_TIER);
    }
  });

  it("keeps the distribution close to base weights over many drops", () => {
    const selector = new ControlledSpawnSelector(createSeededRng(12));
    const { stats } = simulateSpawns(5000, () => selector.next());
    const totalWeight = BASE_SPAWN_WEIGHTS.reduce((sum, weight) => sum + weight, 0);

    BASE_SPAWN_WEIGHTS.forEach((weight, tier) => {
      const expectedRatio = weight / totalWeight;
      const observedRatio = (stats.frequencyByTier[tier] ?? 0) / 5000;
      // Soft correction should not dramatically override base weights.
      expect(Math.abs(observedRatio - expectedRatio)).toBeLessThan(0.06);
    });
  });

  it("reduces severe droughts and extreme streaks vs pure weighted random", () => {
    const controlled = new ControlledSpawnSelector(createSeededRng(99));
    const controlledRun = simulateSpawns(8000, () => controlled.next());

    const pureRng = createSeededRng(99);
    const pureRun = simulateSpawns(8000, () => randomSpawnTierPure(pureRng));

    expect(controlledRun.stats.longestDroughtByTier[4] ?? 0).toBeLessThan(
      pureRun.stats.longestDroughtByTier[4] ?? 0
    );
    expect(controlledRun.stats.longestRepeatStreak).toBeLessThanOrEqual(
      pureRun.stats.longestRepeatStreak
    );
  });
});
