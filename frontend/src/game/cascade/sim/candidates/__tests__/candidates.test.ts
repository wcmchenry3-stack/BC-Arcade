/**
 * Cascade physics spike (#3696): the candidate engines behind the sim harness's engine seam.
 *
 *  - The ported rules on today's physics reproduce `CascadeEngine` bit for bit (so A vs B vs
 *    current compares physics, not a rules drift).
 *  - The lid, drop gate, dangerRatio and hard stop behave the same on every candidate.
 *  - A's and B's own switches: density ladder, merge grow-in, observing guard rail.
 */
import * as Matter from "matter-js";
import { CascadeEngine, type EngineEvent, type StepResult } from "../../../engine";
import {
  FIXED_STEP_MS,
  FLOOR_THICKNESS,
  HARD_STOP_SETTLE_TICKS,
  OVERFLOW_IGNORE_MERGE_TICKS,
  OVERFLOW_LINE_Y,
  OVERFLOW_TICKS_THRESHOLD,
  PIECE_SLEEP_THRESHOLD,
  WORLD_HEIGHT,
} from "../../../constants";
import { tierRadius } from "../../../tiers";
import { BOTS } from "../../bots";
import { runGame, type GameMetrics } from "../../runGame";
import {
  CANDIDATE_IDS,
  CURRENT_TUNING,
  SPIKE_TUNING,
  GROW_IN_STEPS,
  candidateConfig,
  makeCandidate,
  maxMassRatio,
  tunedDensity,
  type CandidateId,
} from "../candidates";
import { CandidateEngine } from "../candidateEngine";
import type { BodyState, PhysicsBackend } from "../backend";

const HZ60 = 1000 / 60;
const HZ120 = 1000 / 120;

function withoutCost(m: GameMetrics): Omit<GameMetrics, "cost"> {
  const { cost: _cost, ...rest } = m;
  return rest;
}

function run(engine: CandidateEngine, n: number, frameMs = HZ60): StepResult[] {
  const out: StepResult[] = [];
  for (let i = 0; i < n && !engine.getState().gameOver; i++) out.push(engine.step(frameMs));
  return out;
}
const events = (rs: StepResult[]): EngineEvent[] => rs.flatMap((r) => r.events);
const gameOver = (rs: StepResult[]) => events(rs).find((e) => e.type === "gameOver");

describe("the ported rules on today's physics", () => {
  it.each([
    ["heuristic", 60],
    ["spam", 120],
    ["random", 60],
  ] as const)("reproduce CascadeEngine bit for bit (%s, %i Hz)", (bot, hz) => {
    const opts = { seed: 7, hz, bot: BOTS[bot]!, maxSimMs: 40_000 };
    const real = runGame(opts);
    const port = runGame({ ...opts, config: candidateConfig("current") });
    expect(real.drops).toBeGreaterThan(10);
    expect(real.merges).toBeGreaterThan(3);
    expect(withoutCost(port)).toEqual(withoutCost(real));
  });

  it.each(["A", "B"] as const)("%s replays the same game from the same seed", (id) => {
    const opts = { seed: 11, hz: 60 as const, bot: BOTS.random!, maxSimMs: 30_000 };
    const first = runGame({ ...opts, config: candidateConfig(id) });
    const second = runGame({ ...opts, config: candidateConfig(id) });
    expect(first.merges).toBeGreaterThan(3);
    expect(withoutCost(second)).toEqual(withoutCost(first));
  });

  it("the factory keeps every engine it made, with readable stats after the harness destroys it", () => {
    const cfg = candidateConfig("A");
    runGame({ seed: 1, hz: 60, bot: BOTS.random!, maxSimMs: 5_000, config: cfg });
    runGame({ seed: 2, hz: 60, bot: BOTS.random!, maxSimMs: 5_000, config: cfg });
    expect(cfg.engines).toHaveLength(2);
    expect(cfg.engines[0]!.stats.fixedSteps).toBe(300);
  });

  it("no candidate changes Matter's global sleep threshold (the production engine shares it)", () => {
    for (const id of CANDIDATE_IDS) makeCandidate(id).destroy();
    const sleeping = Matter.Sleeping as unknown as { _motionSleepThreshold: number };
    expect(sleeping._motionSleepThreshold).toBe(PIECE_SLEEP_THRESHOLD);
    new CascadeEngine({}).destroy();
    expect(sleeping._motionSleepThreshold).toBe(PIECE_SLEEP_THRESHOLD);
  });
});

// The production lid fixtures (`../../../__tests__/engine.lid.test.ts`), on every candidate.
const LANE_X = 360;
const COLUMN = [
  { tier: 11, x: 121, y: 479 },
  { tier: 10, x: 121, y: 290 },
  { tier: 9, x: 121, y: 125 },
  { tier: 0, x: LANE_X, y: 558 },
];
const COLUMN_GAME_OVER_STEP = OVERFLOW_IGNORE_MERGE_TICKS + OVERFLOW_TICKS_THRESHOLD;

describe.each(CANDIDATE_IDS)("the lid on candidate %s", (id: CandidateId) => {
  const column = (): CandidateEngine => {
    const e = makeCandidate(id);
    e.restore(COLUMN, 0);
    return e;
  };

  it("a pile settled over the lid ends the game after the grace and the full count", () => {
    const results = run(column(), COLUMN_GAME_OVER_STEP + 10);
    expect(gameOver(results)).toEqual({ type: "gameOver", reason: "overflow" });
    expect(results).toHaveLength(COLUMN_GAME_OVER_STEP);
  });

  it("dangerRatio rises in equal steps after the grace", () => {
    const e = column();
    const ratios: number[] = [];
    for (let i = 0; i < OVERFLOW_IGNORE_MERGE_TICKS + 2; i++) {
      e.step(HZ60);
      ratios.push(e.getState().dangerRatio);
    }
    expect(ratios[OVERFLOW_IGNORE_MERGE_TICKS - 1]).toBe(0);
    expect(ratios[OVERFLOW_IGNORE_MERGE_TICKS]).toBeCloseTo(1 / OVERFLOW_TICKS_THRESHOLD);
    expect(ratios[OVERFLOW_IGNORE_MERGE_TICKS + 1]).toBeCloseTo(2 / OVERFLOW_TICKS_THRESHOLD);
  });

  it("the piece falling from the spawner is ignored", () => {
    const e = makeCandidate(id);
    e.drop(4, 200);
    let max = 0;
    for (let i = 0; i < 120; i++) {
      e.step(HZ60);
      max = Math.max(max, e.getState().dangerRatio);
    }
    expect(max).toBe(0);
    expect(e.getState().gameOver).toBe(false);
  });

  it("a merge near the lid resets the count and pauses it for the grace", () => {
    const e = column();
    run(e, OVERFLOW_IGNORE_MERGE_TICKS + 30);
    expect(e.getState().dangerRatio).toBeGreaterThan(0);
    e.drop(0, LANE_X);
    e.drop(0, LANE_X);
    expect(e.step(HZ60).events.some((ev) => ev.type === "merge")).toBe(true);
    expect(e.getState().dangerRatio).toBe(0);
    run(e, OVERFLOW_IGNORE_MERGE_TICKS - 1);
    expect(e.getState().dangerRatio).toBe(0);
    run(e, 5);
    expect(e.getState().dangerRatio).toBeGreaterThan(0);
  });

  it("a settled piece at the canvas top is a hard stop at once", () => {
    const e = makeCandidate(id);
    e.restore([...COLUMN.slice(0, 3), { tier: 3, x: 121, y: 15 }], 0);
    expect(e.step(HZ60).events).toContainEqual({ type: "gameOver", reason: "hardStop" });
    expect(e.getState()).toMatchObject({ gameOver: true, dangerRatio: 1, canDrop: false });
  });

  it("a dropped piece resting above the canvas hard-stops only after the settle run", () => {
    const e = makeCandidate(id);
    e.restore(COLUMN.slice(0, 3), 0);
    e.drop(3, 121);
    const results = run(e, 120);
    expect(gameOver(results)).toEqual({ type: "gameOver", reason: "hardStop" });
    expect(results.length).toBeGreaterThanOrEqual(HARD_STOP_SETTLE_TICKS);
    expect(results.length).toBeLessThan(OVERFLOW_TICKS_THRESHOLD);
  });

  it("canDrop holds until the dropped piece is below the lid, the same at 60 and 120 Hz", () => {
    const clearMs = (frameMs: number): number => {
      const e = makeCandidate(id);
      e.drop(3, 200);
      expect(e.canDrop()).toBe(false);
      let t = 0;
      while (!e.canDrop() && t < 2000) {
        e.step(frameMs);
        t += frameMs;
      }
      const p = e.getState().pieces[0]!;
      expect(p.y - tierRadius(3)).toBeGreaterThanOrEqual(OVERFLOW_LINE_Y);
      return t;
    };
    const at60 = clearMs(HZ60);
    expect(at60).toBeLessThan(30 * FIXED_STEP_MS);
    expect(Math.abs(at60 - clearMs(HZ120))).toBeLessThan(HZ60 + 1);
  });

  it("restore clears the gate; canDrop is false after game over", () => {
    const e = makeCandidate(id);
    e.drop(0, 200);
    e.restore([{ tier: 0, x: 200, y: 500 }], 0);
    expect(e.canDrop()).toBe(true);
    const c = column();
    run(c, COLUMN_GAME_OVER_STEP);
    expect(c.canDrop()).toBe(false);
  });
});

describe("candidate A and B physics switches", () => {
  it("the tuned density keeps the largest mass ratio at or under 10:1 (21:1 at density 1)", () => {
    expect(maxMassRatio(tunedDensity)).toBeLessThanOrEqual(10);
    expect(maxMassRatio(() => 1)).toBeGreaterThan(20);
    expect(tunedDensity(0)).toBe(1);
  });

  it.each(["A", "B"] as const)(
    "%s: a merged piece grows in from its parents' radius over the grow-in steps",
    (id) => {
      const e = makeCandidate(id);
      e.restore(
        [
          { tier: 2, x: 150, y: 550 },
          { tier: 2, x: 150 + 2 * tierRadius(2) - 1, y: 550 },
        ],
        0
      );
      const first = e.step(HZ60);
      expect(first.events).toContainEqual(expect.objectContaining({ type: "merge", result: 3 }));
      const merged = e.getState().pieces[0]!;
      const radii = [e.currentRadius(merged.id)];
      for (let i = 0; i < GROW_IN_STEPS; i++) {
        e.step(HZ60);
        radii.push(e.currentRadius(merged.id));
      }
      expect(radii[0]).toBe(tierRadius(2));
      expect(radii[GROW_IN_STEPS]).toBe(tierRadius(3));
      expect(radii.every((r, i) => i === 0 || r > radii[i - 1]!)).toBe(true);
    }
  );

  it("today's engine has no grow-in: the merged piece is full size at once", () => {
    const e = makeCandidate("current");
    e.restore(
      [
        { tier: 2, x: 150, y: 550 },
        { tier: 2, x: 150 + 2 * tierRadius(2) - 1, y: 550 },
      ],
      0
    );
    e.step(HZ60);
    expect(e.currentRadius(e.getState().pieces[0]!.id)).toBe(tierRadius(3));
  });

  describe("guard rail modes, on a backend with no solver (pieces stay where they are put)", () => {
    const floorTop = WORLD_HEIGHT - FLOOR_THICKNESS;
    const r = tierRadius(0);
    function stillBackend(speed = 1): PhysicsBackend {
      const bodies = new Map<number, BodyState>();
      let next = 1;
      return {
        addPiece: (_tier, x, y) => {
          bodies.set(next, {
            x,
            y,
            vx: 0,
            vy: speed,
            speed,
            angle: 0,
            angularVelocity: 0,
            isSleeping: false,
          });
          return next++;
        },
        removePiece: (id) => void bodies.delete(id),
        step: () => {},
        get: (id) => ({ ...bodies.get(id)! }),
        setVelocity: (id, vx, vy) =>
          Object.assign(bodies.get(id)!, { vx, vy, speed: Math.hypot(vx, vy) }),
        setAngularVelocity: (id, w) => Object.assign(bodies.get(id)!, { angularVelocity: w }),
        setPosition: (id, x, y) => Object.assign(bodies.get(id)!, { x, y }),
        setRadius: () => {},
        destroy: () => bodies.clear(),
      };
    }
    const sunk = [{ tier: 0, x: 200, y: floorTop - r + 3 }];

    it("observe: a piece 3 px into the floor is reported every step and never moved", () => {
      const e = new CandidateEngine(stillBackend(), SPIKE_TUNING);
      e.restore(sunk, 0);
      const results = run(e, 3);
      expect(events(results)).toEqual(
        Array.from({ length: 3 }, () =>
          expect.objectContaining({ type: "guardRailFired", reason: "beyondTolerance" })
        )
      );
      expect(e.getState().pieces[0]!.y).toBe(floorTop - r + 3);
      expect(e.stats).toMatchObject({
        railStrict: 3,
        railBeyondTolerance: 3,
        railBeyond3Px: 0,
        escapes: 0,
      });
    });

    it("teleport (today): the same piece is clamped onto the rail and stopped, once", () => {
      const e = new CandidateEngine(stillBackend(), CURRENT_TUNING);
      e.restore(sunk, 0);
      const results = run(e, 3);
      expect(events(results)).toEqual([
        expect.objectContaining({ type: "guardRailFired", reason: "outOfBounds" }),
      ]);
      expect(e.getState().pieces[0]).toMatchObject({ y: floorTop - r, vx: 0, vy: 0 });
    });

    it("observe: a piece that left the bin is caught and counted as an escape", () => {
      const e = new CandidateEngine(stillBackend(), SPIKE_TUNING);
      e.restore([{ tier: 0, x: 200, y: floorTop + r + 5 }], 0);
      e.step(HZ60);
      expect(e.stats.escapes).toBe(1);
      expect(e.getState().pieces[0]!.y).toBe(floorTop - r);
      expect(e.stats.railMaxDepthPx).toBeCloseTo(2 * r + 5);
    });

    // Two Cherries side by side on the floor, 0.5 px apart: they never touch.
    const nearPair = (gap: number) => [
      { tier: 0, x: 100, y: floorTop - r },
      { tier: 0, x: 100 + 2 * r + gap, y: floorTop - r },
    ];

    it("counts a resting same-tier pair 0-2 px apart as a near miss, and leaves it unmerged", () => {
      const e = new CandidateEngine(stillBackend(0), { ...SPIKE_TUNING, measureNearMiss: true });
      e.restore(nearPair(0.5), 0);
      const results = run(e, 4);
      expect(events(results).some((ev) => ev.type === "merge")).toBe(false);
      expect(e.stats.nearMissPairSteps).toBe(4);
    });

    it("mergeGapPx merges a same-tier pair within that gap, and not one further apart", () => {
      const near = new CandidateEngine(stillBackend(0), { ...SPIKE_TUNING, mergeGapPx: 1 });
      near.restore(nearPair(0.5), 0);
      expect(near.step(HZ60).events).toContainEqual(
        expect.objectContaining({ type: "merge", result: 1 })
      );
      const far = new CandidateEngine(stillBackend(0), { ...SPIKE_TUNING, mergeGapPx: 1 });
      far.restore(nearPair(1.5), 0);
      expect(events(run(far, 3)).some((ev) => ev.type === "merge")).toBe(false);
    });
  });

  it("B matches today's gravity and air friction: the same free fall within 2%", () => {
    const fall = (id: CandidateId): number => {
      const e = makeCandidate(id);
      e.drop(0, 200);
      const y0 = e.getState().pieces[0]!.y;
      run(e, 15);
      return e.getState().pieces[0]!.y - y0;
    };
    const current = fall("current");
    expect(current).toBeGreaterThan(50);
    expect(Math.abs(fall("B") - current) / current).toBeLessThan(0.02);
  });
});
