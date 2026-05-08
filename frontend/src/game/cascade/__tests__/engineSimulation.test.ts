/**
 * engineSimulation.test.ts — multi-step Fruit Merge engine simulation tests.
 *
 * Extends the unit tests in engine.test.ts with multi-step scenarios:
 *   - Chain merges (tier 0 → 1 → 2)
 *   - Score accumulation across a merge sequence
 *   - Game-over with multiple fruits above the danger line
 *   - Determinism: same drop + collision sequence → identical events
 *   - Watermelon (tier 10): merge produces no new body
 *
 * Uses the manual Rapier2D mock at frontend/__mocks__/@dimforge/rapier2d-compat.ts
 * so no WASM binary is required.
 *
 * jest-expo defaults to iOS/native platform, so haste resolves "../engine" to
 * engine.native.ts (matter.js).  We explicitly load engine.ts (Rapier/web) via
 * an absolute path to bypass haste platform resolution.
 */
jest.mock("@dimforge/rapier2d-compat");

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const _engine: typeof import("../engine") = require(
  require("path").resolve(__dirname, "..", "engine.ts")
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const { createEngine } = _engine;
import type { EngineHandle } from "../engine.shared";
import { FIXED_STEP_MS, GAME_OVER_CONSECUTIVE_TICKS } from "../engine.shared";
import { scoreForMerge } from "../scoring";
import { FRUIT_SETS, FruitSet, FruitDefinition } from "../../../theme/fruitSets";
import { MockWorld } from "../../../../__mocks__/@dimforge/rapier2d-compat";

// Access live mock module to inspect constructor call counts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RAPIER_MOCK = require("@dimforge/rapier2d-compat").default;

function requireFruitSet(id: string): FruitSet {
  const fs = FRUIT_SETS[id];
  if (fs === undefined) throw new Error(`FruitSet '${id}' not found`);
  return fs;
}
const fruitSet: FruitSet = requireFruitSet("fruits");

function fruit(tier: number): FruitDefinition {
  const f = fruitSet.fruits[tier];
  if (f === undefined) throw new Error(`No fruit for tier ${tier}`);
  return f;
}
const W = 300;
const H = 600;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the MockWorld created by the most recent createEngine call. */
function getWorld(): MockWorld {
  const results = (RAPIER_MOCK.World as jest.Mock).mock.results;
  const last = results[results.length - 1];
  if (last === undefined) throw new Error("No World mock results");
  return last.value as MockWorld;
}

async function buildEngine(): Promise<EngineHandle> {
  return createEngine(W, H, fruitSet);
}

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Chain merge: tier 0 → tier 1
// ---------------------------------------------------------------------------

describe("chain merge: tier 0 → tier 1", () => {
  it("emits fruitMerge(tier:0) when two tier-0 fruits collide", async () => {
    const handle = await buildEngine();
    const world = getWorld();

    // Wall colliders get handles 1000–1002; first two fruit colliders get 1003, 1004
    handle.drop(fruit(0), fruitSet.id, 100, 300);
    handle.drop(fruit(0), fruitSet.id, 110, 300);
    handle.step();

    world._fireCollision(1003, 1004);
    const { events } = handle.step();

    const mergeEvts = events.filter((e) => e.type === "fruitMerge");
    expect(mergeEvts).toHaveLength(1);
    expect((mergeEvts[0] as { tier: number }).tier).toBe(0);
  });

  it("produces a tier-1 body after a tier-0 merge", async () => {
    const handle = await buildEngine();
    const world = getWorld();

    handle.drop(fruit(0), fruitSet.id, 100, 300);
    handle.drop(fruit(0), fruitSet.id, 110, 300);
    handle.step();
    world._fireCollision(1003, 1004);
    handle.step();

    // The merged tier-1 fruit should appear in the next step
    const tiers = handle.step().snapshots.map((s) => s.tier);
    expect(tiers).toContain(1);
  });
});

// ---------------------------------------------------------------------------
// Chain merge: tier 1 → tier 2
// ---------------------------------------------------------------------------

describe("chain merge: tier 1 → tier 2", () => {
  it("emits fruitMerge(tier:1) after a second-level merge", async () => {
    const handle = await buildEngine();
    const world = getWorld();

    // First merge: two tier-0 → tier-1 (colliders 1003, 1004)
    handle.drop(fruit(0), fruitSet.id, 100, 300);
    handle.drop(fruit(0), fruitSet.id, 110, 300);
    handle.step();
    world._fireCollision(1003, 1004);
    handle.step(); // spawns tier-1 at collider 1005

    // Second merge: spawned tier-1 collides with a freshly dropped tier-1 (collider 1006).
    // The spawned body has SPAWN_GRACE_TICKS (3) grace ticks; it was decremented once in
    // the spawn step (3→2). One more step assigned 1006 (2→1). One more exhausts grace (1→0).
    handle.drop(fruit(1), fruitSet.id, 120, 300);
    handle.step(); // assigns collider 1006, grace 2→1
    handle.step(); // grace 1→0, collision groups restored
    world._fireCollision(1005, 1006);
    const { events } = handle.step();

    const tiers = events
      .filter((e) => e.type === "fruitMerge")
      .map((e) => (e as { tier: number }).tier);
    expect(tiers).toContain(1);
  });

  it("produces a tier-2 body after the second-level merge", async () => {
    const handle = await buildEngine();
    const world = getWorld();

    handle.drop(fruit(0), fruitSet.id, 100, 300);
    handle.drop(fruit(0), fruitSet.id, 110, 300);
    handle.step();
    world._fireCollision(1003, 1004);
    handle.step(); // spawns tier-1 at 1005 (grace=3, decremented to 2)

    handle.drop(fruit(1), fruitSet.id, 120, 300);
    handle.step(); // assigns 1006, grace 2→1
    handle.step(); // grace 1→0, restored
    world._fireCollision(1005, 1006);
    handle.step();

    const tiers = handle.step().snapshots.map((s) => s.tier);
    expect(tiers).toContain(2);
  });
});

// ---------------------------------------------------------------------------
// Score accumulation
// ---------------------------------------------------------------------------

describe("score accumulation across a merge sequence", () => {
  it("sum of fruitMerge tier values equals expected scores", async () => {
    let totalScore = 0;
    const handle = await buildEngine();
    const world = getWorld();

    // Merge 1: tier 0 → scores scoreForMerge(0) = 2
    handle.drop(fruit(0), fruitSet.id, 100, 300);
    handle.drop(fruit(0), fruitSet.id, 110, 300);
    handle.step();
    world._fireCollision(1003, 1004);
    const step1 = handle.step(); // spawns tier-1 at 1005

    for (const evt of step1.events) {
      if (evt.type === "fruitMerge") {
        totalScore += scoreForMerge((evt as { tier: Parameters<typeof scoreForMerge>[0] }).tier);
      }
    }

    // Merge 2: tier 1 → scores scoreForMerge(1) = 4
    // Exhaust the spawned tier-1 body's grace period (2 ticks remain after spawn step).
    handle.drop(fruit(1), fruitSet.id, 120, 300);
    handle.step(); // assigns 1006, grace 2→1
    handle.step(); // grace 1→0, restored
    world._fireCollision(1005, 1006);
    const step2 = handle.step();

    for (const evt of step2.events) {
      if (evt.type === "fruitMerge") {
        totalScore += scoreForMerge((evt as { tier: Parameters<typeof scoreForMerge>[0] }).tier);
      }
    }

    expect(totalScore).toBe(scoreForMerge(0) + scoreForMerge(1)); // 2 + 4 = 6
  });

  it("three isolated tier-0 merges produce correct cumulative score", async () => {
    let totalScore = 0;
    const handle = await buildEngine();
    const world = getWorld();

    function collectScore(evts: typeof handle.step extends () => { events: infer E } ? E : never) {
      for (const evt of evts) {
        if (evt.type === "fruitMerge") {
          totalScore += scoreForMerge((evt as { tier: Parameters<typeof scoreForMerge>[0] }).tier);
        }
      }
    }

    // Merge 1: colliders 1003, 1004
    handle.drop(fruit(0), fruitSet.id, 50, 500);
    handle.drop(fruit(0), fruitSet.id, 60, 500);
    handle.step();
    world._fireCollision(1003, 1004);
    collectScore(handle.step().events);

    // After first merge a tier-1 spawns at 1005.
    // Merge 2 uses two new tier-0 drops → 1006, 1007
    handle.drop(fruit(0), fruitSet.id, 100, 500);
    handle.drop(fruit(0), fruitSet.id, 110, 500);
    handle.step();
    world._fireCollision(1006, 1007);
    collectScore(handle.step().events);

    // After merge 2, spawned tier-1 gets collider 1008.
    // Merge 3 uses two new tier-0 drops → colliders 1009, 1010
    handle.drop(fruit(0), fruitSet.id, 150, 500);
    handle.drop(fruit(0), fruitSet.id, 160, 500);
    handle.step();
    world._fireCollision(1009, 1010);
    collectScore(handle.step().events);

    expect(totalScore).toBe(3 * scoreForMerge(0)); // 3 × 2 = 6
  });
});

// ---------------------------------------------------------------------------
// Watermelon (tier 10): merge disappears, no new body
// ---------------------------------------------------------------------------

describe("watermelon tier-10 merge", () => {
  it("emits fruitMerge(tier:10) and no new body spawns", async () => {
    const handle = await buildEngine();
    const world = getWorld();

    handle.drop(fruit(10), fruitSet.id, 100, 300);
    handle.drop(fruit(10), fruitSet.id, 110, 300);
    handle.step();
    world._fireCollision(1003, 1004);
    const { events } = handle.step();

    expect(events.some((e) => e.type === "fruitMerge" && (e as { tier: number }).tier === 10)).toBe(
      true
    );
    // No new fruit body should exist after watermelon disappears
    expect(handle.step().snapshots).toHaveLength(0);
  });

  it("awards the watermelon bonus score (256)", async () => {
    let mergeScore = 0;
    const handle = await buildEngine();
    const world = getWorld();

    handle.drop(fruit(10), fruitSet.id, 100, 300);
    handle.drop(fruit(10), fruitSet.id, 110, 300);
    handle.step();
    world._fireCollision(1003, 1004);
    const { events } = handle.step();

    for (const evt of events) {
      if (evt.type === "fruitMerge") {
        mergeScore += scoreForMerge((evt as { tier: Parameters<typeof scoreForMerge>[0] }).tier);
      }
    }
    expect(mergeScore).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// Game-over: multiple fruits above danger line
// ---------------------------------------------------------------------------

describe("game-over with multiple fruits above the danger line", () => {
  it("emits gameOver exactly once when multiple fruits exceed the danger line", async () => {
    const handle = await buildEngine();

    // tier-0 radius ≈ 18px. Top = y - 18. dangerY = H * DANGER_LINE_RATIO ≈ 108px.
    // Placing at y=50 → top = 32, well above the danger line.
    handle.drop(fruit(0), fruitSet.id, 130, 50);
    handle.drop(fruit(0), fruitSet.id, 150, 50);
    handle.drop(fruit(0), fruitSet.id, 170, 50);
    handle.step(); // within grace period — no game-over yet

    expect(handle.step().events.some((e) => e.type === "gameOver")).toBe(false);

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 3001);

    // Hysteresis requires GAME_OVER_CONSECUTIVE_TICKS consecutive ticks above the danger
    // line — advance enough steps to satisfy it, then verify exactly one gameOver fires.
    const gameOverEvents: ReturnType<typeof handle.step>["events"] = [];
    for (let i = 0; i < GAME_OVER_CONSECUTIVE_TICKS + 5; i++) {
      const { events } = handle.step();
      gameOverEvents.push(...events.filter((e) => e.type === "gameOver"));
    }
    jest.useRealTimers();

    expect(gameOverEvents).toHaveLength(1);
  });

  it("emits gameOver only once even after additional steps", async () => {
    const handle = await buildEngine();

    handle.drop(fruit(0), fruitSet.id, 150, 50);

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 3001);
    let totalGameOver = 0;
    // Run well past the 30-tick threshold; gameOver must fire exactly once.
    for (let i = 0; i < GAME_OVER_CONSECUTIVE_TICKS + 5; i++) {
      totalGameOver += handle.step().events.filter((e) => e.type === "gameOver").length;
    }
    jest.useRealTimers();

    expect(totalGameOver).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("same drop + collision sequence produces identical merge event tiers", async () => {
    async function runSequence(): Promise<number[]> {
      const tiers: number[] = [];
      const handle = await createEngine(W, H, fruitSet);
      const world = getWorld();

      handle.drop(fruit(2), fruitSet.id, 150, 300);
      handle.drop(fruit(2), fruitSet.id, 160, 300);
      handle.step();
      world._fireCollision(1003, 1004);
      const { events } = handle.step();
      for (const evt of events) {
        if (evt.type === "fruitMerge") tiers.push((evt as { tier: number }).tier);
      }

      return tiers;
    }

    // Need to clear mocks between runs so getWorld() returns the right instance
    const run1 = await runSequence();
    jest.clearAllMocks();
    const run2 = await runSequence();

    expect(run1).toEqual(run2);
    expect(run1).toEqual([2]); // one tier-2 merge
  });

  it("body count is consistent across identical drop sequences", async () => {
    async function runDrops(): Promise<number> {
      const handle = await buildEngine();
      handle.drop(fruit(1), fruitSet.id, 100, 300);
      handle.drop(fruit(2), fruitSet.id, 150, 300);
      handle.drop(fruit(3), fruitSet.id, 200, 300);
      return handle.step().snapshots.length;
    }

    const count1 = await runDrops();
    jest.clearAllMocks();
    const count2 = await runDrops();

    expect(count1).toBe(count2);
    expect(count1).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Cleanup after simulation
// ---------------------------------------------------------------------------

describe("cleanup after multi-step simulation", () => {
  it("cleanup does not throw after a full chain-merge sequence", async () => {
    const handle = await buildEngine();
    const world = getWorld();

    handle.drop(fruit(0), fruitSet.id, 100, 300);
    handle.drop(fruit(0), fruitSet.id, 110, 300);
    handle.step();
    world._fireCollision(1003, 1004);
    handle.step();
    handle.step();

    expect(() => handle.cleanup()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Merge pipeline hardening (#1224): 5 simultaneous same-tier pairs
// ---------------------------------------------------------------------------

describe("merge pipeline hardening — 5 simultaneous pairs", () => {
  it("5 simultaneous same-tier pairs produce exactly 5 child bodies", async () => {
    // Drop 10 tier-2 fruits, fire 5 non-overlapping collision pairs simultaneously.
    // Each pair should produce exactly one tier-3 child; no phantom or double merges.
    const handle = await buildEngine();
    const world = getWorld();

    // Mock _colliderHandleCounter starts at 1000; 3 wall colliders consume 1000–1002,
    // so the first fruit collider is 1003. Bodies 0–9 → colliders 1003–1012.
    for (let i = 0; i < 10; i++) {
      handle.drop(fruit(2), fruitSet.id, 50 + i * 20, 300);
    }
    handle.step();

    // Fire 5 non-overlapping pairs: (0+1), (2+3), (4+5), (6+7), (8+9)
    // colliders: 1003+1004, 1005+1006, 1007+1008, 1009+1010, 1011+1012
    world._fireCollision(1003, 1004);
    world._fireCollision(1005, 1006);
    world._fireCollision(1007, 1008);
    world._fireCollision(1009, 1010);
    world._fireCollision(1011, 1012);

    const { events } = handle.step();

    const merges = events.filter((e) => e.type === "fruitMerge");
    expect(merges).toHaveLength(5);

    // Each merge should produce one tier-3 child body
    const tiers = handle.step().snapshots.map((s) => s.tier);
    expect(tiers.filter((t) => t === 3)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Fixed-step accumulator — GH #1220
// ---------------------------------------------------------------------------

describe("fixed-step accumulator — sub-step counts", () => {
  it("step(1/60) runs exactly 1 physics sub-step", async () => {
    const handle = await buildEngine();
    const world = getWorld();
    const stepSpy = jest.spyOn(world, "step");
    handle.step(1 / 60);
    expect(stepSpy).toHaveBeenCalledTimes(1);
  });

  it("step(1/30) runs exactly 2 physics sub-steps", async () => {
    const handle = await buildEngine();
    const world = getWorld();
    const stepSpy = jest.spyOn(world, "step");
    handle.step(1 / 30);
    expect(stepSpy).toHaveBeenCalledTimes(2);
  });

  it("step(0.005) runs 0 physics sub-steps — accumulates partial frame", async () => {
    const handle = await buildEngine();
    const world = getWorld();
    const stepSpy = jest.spyOn(world, "step");
    handle.step(0.005);
    expect(stepSpy).toHaveBeenCalledTimes(0);
  });

  it("three 8ms frames accumulate to 1 sub-step on the third call", async () => {
    const handle = await buildEngine();
    const world = getWorld();
    const stepSpy = jest.spyOn(world, "step");

    handle.step(0.008); // 8ms — below 16.67ms threshold
    expect(stepSpy).toHaveBeenCalledTimes(0);
    handle.step(0.008); // 16ms cumulative — still below
    expect(stepSpy).toHaveBeenCalledTimes(0);
    handle.step(0.008); // 24ms cumulative — crosses threshold → 1 sub-step
    expect(stepSpy).toHaveBeenCalledTimes(1);
  });

  it("a huge frame delta is capped — no more than 10 sub-steps regardless of dt", async () => {
    const handle = await buildEngine();
    const world = getWorld();
    const stepSpy = jest.spyOn(world, "step");
    handle.step(10); // 10 seconds — clamped to 1/6 s → ≤ 10 sub-steps
    expect(stepSpy.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("total simulated time never exceeds total wall time across a mixed sequence", async () => {
    const handle = await buildEngine();
    const world = getWorld();
    const stepSpy = jest.spyOn(world, "step");

    const frames = [1 / 60, 1 / 60, 1 / 30, 0.005, 0.008, 0.008, 0.008, 1 / 60];
    let totalWallMs = 0;
    for (const dt of frames) {
      totalWallMs += Math.min(dt * 1000, 1000 / 6); // match the engine's 1/6s cap
      handle.step(dt);
    }

    const totalSimMs = stepSpy.mock.calls.length * FIXED_STEP_MS;
    expect(totalSimMs).toBeLessThanOrEqual(totalWallMs + 0.1);
  });
});
