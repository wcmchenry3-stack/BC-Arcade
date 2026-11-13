/**
 * The lid (#3694): the game-over rule that always fires.
 *
 * Fixtures are columns of pieces of distinct tiers (so nothing merges; two equal neighbours
 * would), stacked exactly on top of each other on the floor at x = 121 (`stack`). planck keeps
 * such a stack (no sideways force acts on it). `COLUMN` is a capstone and tiers 10, 9, 8 and 7:
 * its top piece rests with its centre under the lid (`OVERFLOW_LINE_Y` = 80) and its top edge at
 * y = 72, over it. The right half of the bin is an empty lane with one Cherry on the floor.
 * Restore grants the merge grace once (`OVERFLOW_IGNORE_MERGE_TICKS`), so the count starts after
 * it.
 *
 * #3697: the fixtures are built from the ladder (`tierRadius`) instead of fixed coordinates, for
 * the smaller lively ladder (r0 / r10 / r11 = 18 / 56 / 63). The old ones (a capstone, a tier 10
 * and a tier 9 at radii 101 / 88 / 77) no longer reach the lid; on the new ladder that takes five
 * or six pieces. Droppable pieces (tiers 0-5) now spawn with their top edge on the canvas, so the
 * tests about a piece whose top edge is above the canvas at spawn drop a big tier (8, r 45, top
 * edge at y = -15) the way the dev panel and the test seams can.
 */
import { World } from "planck";
import { CascadeEngine, type EngineEvent, type StepResult } from "../engine";
import { tierRadius } from "../tiers";
import {
  FIXED_STEP_MS,
  FLOOR_THICKNESS,
  HARD_STOP_SETTLE_TICKS,
  MAX_SUBSTEPS,
  OVERFLOW_IGNORE_MERGE_TICKS,
  OVERFLOW_LINE_Y,
  OVERFLOW_TICKS_THRESHOLD,
  WORLD_HEIGHT,
} from "../constants";

const HZ60 = 16.67;
const HZ120 = 8.33;

const FLOOR_TOP = WORLD_HEIGHT - FLOOR_THICKNESS;
const STACK_X = 121;
const LANE_X = 360;
/** A big tier that spawns with its top edge above the canvas (a dev-panel drop). */
const BIG = 8;

type Placed = { tier: number; x: number; y: number };

/** Pieces of `tiers` stacked bottom first on the floor at x, each resting on the one below. */
function stack(tiers: number[], x = STACK_X): Placed[] {
  const out: Placed[] = [];
  let bottom = FLOOR_TOP;
  for (const tier of tiers) {
    const r = tierRadius(tier);
    out.push({ tier, x, y: bottom - r });
    bottom -= 2 * r;
  }
  return out;
}

/** Where a stack's top edge is. */
function stackTop(pieces: Placed[]): number {
  const top = pieces[pieces.length - 1]!;
  return top.y - tierRadius(top.tier);
}

/** Top edge at y = 72: over the lid, top piece's centre under it. */
const COLUMN_TIERS = [11, 10, 9, 8, 7];
const COLUMN = [...stack(COLUMN_TIERS), { tier: 0, x: LANE_X, y: FLOOR_TOP - tierRadius(0) }];
/** Top edge at y = 38: a tier 2 (r 23) on it has its top edge at y = -8, above the canvas. */
const TALL = stack([11, 10, 9, 8, 5, 3]);
/** Fixed steps from a COLUMN restore to game over: the grace, then the full count. */
const COLUMN_GAME_OVER_STEP = OVERFLOW_IGNORE_MERGE_TICKS + OVERFLOW_TICKS_THRESHOLD;

const radius = tierRadius;

function events(results: StepResult[]): EngineEvent[] {
  return results.flatMap((r) => r.events);
}

function gameOverEvent(results: StepResult[]) {
  return events(results).find((e) => e.type === "gameOver");
}

function column(): CascadeEngine {
  const engine = new CascadeEngine({});
  engine.restore(COLUMN, 0);
  return engine;
}

/** Steps `n` frames of `frameMs`, stopping at game over. */
function run(engine: CascadeEngine, n: number, frameMs = HZ60): StepResult[] {
  const out: StepResult[] = [];
  for (let i = 0; i < n && !engine.getState().gameOver; i++) out.push(engine.step(frameMs));
  return out;
}

describe("the lid: overflow counts settled pieces only", () => {
  it("the piece falling from the spawner is ignored, though it spawns over the lid", () => {
    const engine = new CascadeEngine({});
    engine.drop(4, 200);
    const spawned = engine.getState().pieces[0]!;
    expect(spawned.y - radius(4)).toBeLessThan(OVERFLOW_LINE_Y);
    // At spawn its speed is 0 ("settled" by speed alone): only the falling-piece rule skips it.
    const ratios: number[] = [];
    for (let i = 0; i < 120; i++) {
      engine.step(HZ60);
      ratios.push(engine.getState().dangerRatio);
    }
    expect(Math.max(...ratios)).toBe(0);
    expect(engine.getState().gameOver).toBe(false);
  });

  it("every piece still falling from the spawner is ignored, not only the last one dropped", () => {
    const engine = new CascadeEngine({});
    // The dev panel and test seams can drop without the gate: two at once.
    engine.drop(3, 100);
    engine.drop(4, 300);
    const ratios: number[] = [];
    for (let i = 0; i < 60; i++) {
      engine.step(HZ60);
      ratios.push(engine.getState().dangerRatio);
    }
    expect(Math.max(...ratios)).toBe(0);
  });

  it("a settled piece whose top edge is over the lid counts, and ends the game", () => {
    const engine = column();
    const results = run(engine, COLUMN_GAME_OVER_STEP + 10);
    expect(gameOverEvent(results)).toEqual({ type: "gameOver", reason: "overflow" });
    expect(results).toHaveLength(COLUMN_GAME_OVER_STEP);
  });

  it("a piece whose centre is below the lid but top edge above it counts (top edge, not centre)", () => {
    const engine = column();
    const pieces = engine.getState().pieces;
    const top = pieces.find((p) => p.y === Math.min(...pieces.map((q) => q.y)))!;
    expect(top.y).toBeGreaterThan(OVERFLOW_LINE_Y);
    expect(top.y - radius(top.tier)).toBeLessThan(OVERFLOW_LINE_Y);
    run(engine, COLUMN_GAME_OVER_STEP);
    expect(engine.getState().gameOver).toBe(true);
  });
});

describe("the lid: merge grace only near the lid", () => {
  it("a merge far below the danger band does not reset the count", () => {
    const engine = column();
    run(engine, OVERFLOW_IGNORE_MERGE_TICKS + 30);
    const before = engine.getState().dangerRatio;
    expect(before).toBeGreaterThan(0);
    // A Cherry dropped down the empty lane merges with the one on the floor.
    engine.drop(0, LANE_X);
    const ratios: number[] = [];
    let merged: EngineEvent | undefined;
    for (let i = 0; i < 90 && !merged; i++) {
      merged = engine.step(HZ60).events.find((e) => e.type === "merge");
      ratios.push(engine.getState().dangerRatio);
    }
    expect(merged).toMatchObject({ type: "merge", result: 1 });
    expect((merged as { y: number }).y).toBeGreaterThan(500);
    // The count kept rising straight through the merge.
    expect(ratios.every((r, i) => i === 0 || r > ratios[i - 1]!)).toBe(true);
    expect(engine.getState().dangerRatio).toBeGreaterThan(before);
    // And the game still ends on time.
    run(engine, COLUMN_GAME_OVER_STEP);
    expect(engine.getState().gameOver).toBe(true);
  });

  it("a merge near the lid resets the count and pauses it for the grace", () => {
    const engine = column();
    run(engine, OVERFLOW_IGNORE_MERGE_TICKS + 30);
    expect(engine.getState().dangerRatio).toBeGreaterThan(0);
    // Two Cherries at the same spot merge at once, at spawn height (over the lid).
    engine.drop(0, LANE_X);
    engine.drop(0, LANE_X);
    const first = engine.step(HZ60);
    expect(first.events.some((e) => e.type === "merge")).toBe(true);
    expect(engine.getState().dangerRatio).toBe(0);
    run(engine, OVERFLOW_IGNORE_MERGE_TICKS - 1);
    expect(engine.getState().dangerRatio).toBe(0);
    run(engine, 5);
    expect(engine.getState().dangerRatio).toBeGreaterThan(0);
  });
});

describe("the lid: hard stop", () => {
  it("a settled piece whose top edge reaches the canvas top ends the game at once", () => {
    const engine = new CascadeEngine({});
    // The tall stack with a tier-2 piece (radius 23) on top: its top edge is at y = -8. Restore's
    // grace does not delay the hard stop.
    const top = stackTop(TALL);
    expect(top - 2 * radius(2)).toBeLessThan(-5);
    engine.restore([...TALL, { tier: 2, x: STACK_X, y: top - radius(2) }], 0);
    const result = engine.step(HZ60);
    expect(result.events).toContainEqual({ type: "gameOver", reason: "hardStop" });
    expect(engine.getState()).toMatchObject({ gameOver: true, dangerRatio: 1, canDrop: false });
  });

  it("a falling piece above the canvas top (a big piece at spawn) is not a hard stop", () => {
    const engine = new CascadeEngine({});
    engine.drop(BIG, 200);
    expect(engine.getState().pieces[0]!.y - radius(BIG)).toBeLessThan(0);
    run(engine, 30);
    expect(engine.getState().gameOver).toBe(false);
  });
});

describe("the lid: hard stop grace for the dropped piece", () => {
  /** A capstone and tiers 10, 9, 7 and 6: its top edge rests at about y = 90. */
  const LEDGE = stack([11, 10, 9, 7, 6]);

  it("a large piece touching a pile just under the lid is not a hard stop at once", () => {
    const engine = new CascadeEngine({});
    engine.restore(LEDGE, 0);
    run(engine, 60);
    const ledgeTop = Math.min(...engine.getState().pieces.map((p) => p.y - radius(p.tier)));
    expect(ledgeTop).toBeGreaterThan(OVERFLOW_LINE_Y);
    expect(ledgeTop).toBeLessThan(OVERFLOW_LINE_Y + 12);
    engine.drop(BIG, STACK_X);
    const results = run(engine, HARD_STOP_SETTLE_TICKS - 1);
    expect(results).toHaveLength(HARD_STOP_SETTLE_TICKS - 1);
    expect(events(results).find((e) => e.type === "gameOver")).toBeUndefined();
  });

  it("a dropped piece that really rests with its top edge above the canvas still hard-stops, after the run", () => {
    // The drop must land dead centre on the column (the nudge would roll it off the top).
    const engine = new CascadeEngine({ bench: { noDropNudge: true } });
    // The tall stack's top edge is at y = 38: a tier-2 piece (radius 23) dropped on it comes to
    // rest on top, its top edge at about y = -8, above the canvas.
    engine.restore(TALL, 0);
    engine.drop(2, STACK_X);
    const results = run(engine, 120);
    expect(gameOverEvent(results)).toEqual({ type: "gameOver", reason: "hardStop" });
    expect(results.length).toBeGreaterThanOrEqual(HARD_STOP_SETTLE_TICKS);
    expect(results.length).toBeLessThan(OVERFLOW_TICKS_THRESHOLD);
  });
});

describe("the lid: restore of a piece still in the air", () => {
  it("a big piece saved right after its drop is not a hard stop on restore, and lands normally", () => {
    const first = new CascadeEngine({});
    first.drop(BIG, 200);
    first.step(HZ60);
    const saved = first.getState().pieces.map(({ tier, x, y }) => ({ tier, x, y }));
    expect(saved[0]!.y - radius(BIG)).toBeLessThan(0);

    const engine = new CascadeEngine({});
    engine.restore(saved, 0);
    expect(engine.canDrop()).toBe(false);
    const results = run(engine, 240);
    expect(gameOverEvent(results)).toBeUndefined();
    const landed = engine.getState().pieces[0]!;
    expect(landed.y - radius(BIG)).toBeGreaterThan(OVERFLOW_LINE_Y);
    expect(engine.canDrop()).toBe(true);
  });
});

describe("the lid: drop gating", () => {
  it("canDrop is false until the dropped piece has fallen below the lid", () => {
    const engine = new CascadeEngine({});
    expect(engine.canDrop()).toBe(true);
    engine.drop(2, 200);
    expect(engine.canDrop()).toBe(false);
    expect(engine.getState().canDrop).toBe(false);
    let steps = 0;
    while (!engine.canDrop() && steps < 120) {
      engine.step(HZ60);
      steps++;
      const piece = engine.getState().pieces[0]!;
      // Never true while any part of the piece is still over the lid.
      if (!engine.canDrop()) continue;
      expect(piece.y - radius(2)).toBeGreaterThanOrEqual(OVERFLOW_LINE_Y);
    }
    expect(engine.canDrop()).toBe(true);
    // A short free fall, well under half a second.
    expect(steps).toBeLessThan(30);
  });

  it("a piece that lands and rests over the lid cannot deadlock: the game ends", () => {
    // A capstone and tiers 10, 9, 8 and 5: the stack's top edge is at y = 88, under the lid.
    // The drop must land dead centre on the column (the nudge would roll it off the top).
    const engine = new CascadeEngine({ bench: { noDropNudge: true } });
    const under = stack([11, 10, 9, 8, 5]);
    expect(stackTop(under)).toBeGreaterThan(OVERFLOW_LINE_Y);
    engine.restore(under, 0);
    run(engine, OVERFLOW_IGNORE_MERGE_TICKS + 10);
    expect(engine.getState().dangerRatio).toBe(0);
    expect(engine.canDrop()).toBe(true);
    // A Blueberry (tier 1, radius 20) dropped on top lands with its top edge at about y = 48:
    // over the lid, for good.
    engine.drop(1, STACK_X);
    const results = run(engine, 600);
    const landed = engine.getState().pieces.find((p) => p.tier === 1)!;
    expect(landed.y - radius(1)).toBeLessThan(OVERFLOW_LINE_Y);
    expect(events(results).filter((e) => e.type === "gameOver")).toEqual([
      { type: "gameOver", reason: "overflow" },
    ]);
    expect(engine.canDrop()).toBe(false);
  });

  it("canDrop is false after game over", () => {
    const engine = column();
    run(engine, COLUMN_GAME_OVER_STEP);
    expect(engine.canDrop()).toBe(false);
  });

  it("restore clears the gate", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    expect(engine.canDrop()).toBe(false);
    engine.restore([{ tier: 0, x: 200, y: 500 }], 0);
    expect(engine.canDrop()).toBe(true);
  });
});

describe("the lid: dangerRatio", () => {
  it("rises from 0 to 1 in equal steps while the pile stays over the lid", () => {
    const engine = column();
    const ratios: number[] = [];
    for (let i = 0; i < COLUMN_GAME_OVER_STEP; i++) {
      engine.step(HZ60);
      ratios.push(engine.getState().dangerRatio);
    }
    expect(ratios[0]).toBe(0);
    expect(ratios[OVERFLOW_IGNORE_MERGE_TICKS - 1]).toBe(0);
    expect(ratios[OVERFLOW_IGNORE_MERGE_TICKS]).toBeCloseTo(1 / OVERFLOW_TICKS_THRESHOLD);
    expect(ratios.every((r, i) => i === 0 || r >= ratios[i - 1]!)).toBe(true);
    expect(ratios[ratios.length - 1]).toBe(1);
    expect(engine.getState().gameOver).toBe(true);
  });
});

describe("the lid: restore grace", () => {
  it("still holds the count off for the grace after a restore, then the count runs", () => {
    const engine = column();
    run(engine, OVERFLOW_IGNORE_MERGE_TICKS);
    expect(engine.getState().dangerRatio).toBe(0);
    run(engine, 1);
    expect(engine.getState().dangerRatio).toBeGreaterThan(0);
  });

  it("restoring again gives one grace per restore, and does not extend a running count past it", () => {
    const engine = column();
    run(engine, COLUMN_GAME_OVER_STEP - 1);
    expect(engine.getState().gameOver).toBe(false);
    // A second restore of the same board: one more grace, then the full count again.
    engine.restore(COLUMN, 0);
    const results = run(engine, COLUMN_GAME_OVER_STEP + 10);
    expect(results).toHaveLength(COLUMN_GAME_OVER_STEP);
    expect(gameOverEvent(results)).toEqual({ type: "gameOver", reason: "overflow" });
  });
});

describe("step(): the accumulator is capped", () => {
  it("frames under 20 fps drop their backlog instead of building it", () => {
    const engine = new CascadeEngine({});
    const update = jest.spyOn(World.prototype, "step");
    for (let i = 0; i < 50; i++) engine.step(100);
    update.mockClear();
    // Drain whatever backlog is left with empty frames: at most the cap, not 50 frames' worth.
    for (let i = 0; i < 20; i++) engine.step(0);
    expect(update.mock.calls.length).toBeLessThanOrEqual(MAX_SUBSTEPS);
    update.mockRestore();
  });
});

describe("the lid: fixed steps, equivalent at 60 and 120 Hz", () => {
  function gameOverMs(frameMs: number): number {
    const engine = column();
    let t = 0;
    while (!engine.getState().gameOver && t < 20_000) {
      engine.step(frameMs);
      t += frameMs;
    }
    return t;
  }

  it("ends the game at the same simulated time at 60 Hz and 120 Hz, to within one frame", () => {
    const at60 = gameOverMs(HZ60);
    const at120 = gameOverMs(HZ120);
    const expected = COLUMN_GAME_OVER_STEP * FIXED_STEP_MS;
    expect(Math.abs(at60 - expected)).toBeLessThan(HZ60 + 1);
    expect(Math.abs(at120 - expected)).toBeLessThan(HZ60 + 1);
    expect(Math.abs(at60 - at120)).toBeLessThan(HZ60 + 1);
  });

  it("drop gating clears after the same simulated time at 60 Hz and 120 Hz, to within one frame", () => {
    function clearMs(frameMs: number): number {
      const engine = new CascadeEngine({});
      engine.drop(3, 200);
      let t = 0;
      while (!engine.canDrop()) {
        engine.step(frameMs);
        t += frameMs;
      }
      return t;
    }
    expect(Math.abs(clearMs(HZ60) - clearMs(HZ120))).toBeLessThan(HZ60 + 1);
  });
});
