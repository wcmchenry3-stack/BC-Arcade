/**
 * Star Swarm engine tests: difficulty tiers and their multipliers.
 *
 * One file per planned `engine/` module (#2988): this file follows `engine/tuning.ts`. Split out of
 * the former monolithic `engine.test.ts` (#2955) with describe blocks moved whole; shared fixtures
 * live in `helpers/engineFixtures.ts`.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  DIFFICULTY_TIERS,
  difficultyMultiplier,
  difficultyParamScale,
  difficultyLabel,
} from "../engine";
import type { Bullet, DifficultyTier, StarSwarmState } from "../types";
import { NO_INPUT, advanceMs, runExtraction } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

// ---------------------------------------------------------------------------
// #1037 — Difficulty tiers
// ---------------------------------------------------------------------------

describe("#1037 Difficulty tiers", () => {
  it("DIFFICULTY_TIERS has 10 entries ordered Ensign→FleetAdmiral", () => {
    expect(DIFFICULTY_TIERS.length).toBe(10);
    expect(DIFFICULTY_TIERS[0]).toBe("Ensign");
    expect(DIFFICULTY_TIERS[9]).toBe("FleetAdmiral");
  });

  it("difficultyMultiplier returns 1 for Ensign and 10 for FleetAdmiral", () => {
    expect(difficultyMultiplier("Ensign")).toBe(1);
    expect(difficultyMultiplier("FleetAdmiral")).toBe(10);
  });

  it("difficultyMultiplier returns a positive number for every tier", () => {
    for (const tier of DIFFICULTY_TIERS) {
      expect(difficultyMultiplier(tier)).toBeGreaterThan(0);
    }
  });

  it("difficultyParamScale returns 0.7 for Ensign and 3.0 for FleetAdmiral", () => {
    expect(difficultyParamScale("Ensign")).toBeCloseTo(0.7);
    expect(difficultyParamScale("FleetAdmiral")).toBeCloseTo(3.0);
  });

  it("difficultyLabel returns a non-empty string for every tier", () => {
    for (const tier of DIFFICULTY_TIERS) {
      expect(difficultyLabel(tier).length).toBeGreaterThan(0);
    }
  });

  it("initStarSwarm stores difficulty in state", () => {
    const tiers: DifficultyTier[] = ["Ensign", "Captain", "FleetAdmiral"];
    for (const tier of tiers) {
      const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, tier);
      expect(s.difficulty).toBe(tier);
    }
  });

  it("Ensign disables straggler; all other tiers enable it", () => {
    const ensign = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    expect(ensign.stragglerEnabled).toBe(false);
    for (const tier of DIFFICULTY_TIERS.filter((t) => t !== "Ensign")) {
      const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, tier);
      expect(s.stragglerEnabled).toBe(true);
    }
  });

  it("score multiplier is applied: FleetAdmiral kill worth 10× base", () => {
    let base = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    let hard = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "FleetAdmiral");
    base = advanceMs(base, 8000);
    hard = advanceMs(hard, 8000);
    expect(base.phase).toBe("Playing");
    expect(hard.phase).toBe("Playing");

    const gruntBase = base.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    const gruntHard = hard.enemies.find((e) => e.isAlive && e.tier === "Grunt");
    if (!gruntBase || !gruntHard) throw new Error("no grunt found");

    const kill = (s: StarSwarmState, id: number): StarSwarmState => {
      const e = s.enemies.find((en) => en.id === id)!;
      const b: Bullet = {
        id: 55500 + id,
        x: e.x,
        y: e.y,
        vx: 0,
        vy: 0,
        owner: "player",
        width: e.width,
        height: e.height,
        damage: 999,
      };
      return tick({ ...s, playerBullets: [b] }, 16, NO_INPUT);
    };

    const scoreBase = kill(base, gruntBase.id).score;
    const scoreHard = kill(hard, gruntHard.id).score;
    expect(scoreHard).toBe(scoreBase * 10);
  });

  it("difficulty carries over to next wave", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Admiral");
    s = advanceMs(s, 8000);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    s = advanceMs(s, 3000);
    expect(s.wave).toBe(2);
    expect(s.difficulty).toBe("Admiral");
  });

  it("wave clear bonus is multiplied by difficulty", () => {
    let base = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign");
    let hard = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Captain"); // ×4
    base = advanceMs(base, 8000);
    hard = advanceMs(hard, 8000);

    // Kill all enemies to trigger wave clear bonus
    const wipeAll = (s: StarSwarmState): StarSwarmState => ({
      ...s,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    });
    base = runExtraction(tick(wipeAll(base), 16, NO_INPUT));
    hard = runExtraction(tick(wipeAll(hard), 16, NO_INPUT));

    // Both should have advanced to wave 2, and hard score should be ≥ 4× base score
    expect(base.wave).toBe(2);
    expect(hard.wave).toBe(2);
    expect(hard.score).toBeGreaterThanOrEqual(base.score * 4);
  });
});
