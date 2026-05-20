import { CascadeEngine, type EngineEvent, type StepResult } from "../engine2";
import { PIECE_DEFS, MAX_TIER } from "../pieceDefs";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  OVERFLOW_LINE_Y,
  OVERFLOW_TICKS_THRESHOLD,
  MAX_SPAWN_VELOCITY,
  COMBO_WINDOW_TICKS,
  OVERFLOW_IGNORE_MERGE_TICKS,
} from "../constants";

function runSteps(engine: CascadeEngine, count: number): StepResult[] {
  const results: StepResult[] = [];
  for (let i = 0; i < count; i++) {
    results.push(engine.step(16.67));
  }
  return results;
}

function allEvents(results: StepResult[]): EngineEvent[] {
  return results.flatMap((r) => r.events);
}

describe("CascadeEngine — construction", () => {
  it("constructs without throwing", () => {
    expect(() => new CascadeEngine({})).not.toThrow();
  });

  it("getState() returns initial empty state", () => {
    const engine = new CascadeEngine({});
    expect(engine.getState()).toEqual({ pieces: [], score: 0, gameOver: false });
  });
});

describe("CascadeEngine — drop", () => {
  it("adds a piece to the world", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    expect(engine.getState().pieces).toHaveLength(1);
  });

  it("dropped piece has the correct tier", () => {
    const engine = new CascadeEngine({});
    engine.drop(2, 200);
    expect(engine.getState().pieces[0]!.tier).toBe(2);
  });

  it("dropped piece x position matches the specified x (within tolerance)", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 150);
    expect(engine.getState().pieces[0]!.x).toBeCloseTo(150, 0);
  });

  it("dropping the same tier twice gives 2 pieces", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 100);
    engine.drop(0, 300);
    expect(engine.getState().pieces).toHaveLength(2);
  });
});

describe("CascadeEngine — physics / falling", () => {
  it("after N steps, a dropped piece y position is greater than its starting y", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    const initialY = engine.getState().pieces[0]!.y;
    runSteps(engine, 30);
    expect(engine.getState().pieces[0]!.y).toBeGreaterThan(initialY);
  });

  it("after enough steps, a dropped piece reaches near the floor", () => {
    const engine = new CascadeEngine({});
    const tier = 0;
    const radius = (PIECE_DEFS[tier]!.shape as { radius: number }).radius;
    engine.drop(tier, 200);
    runSteps(engine, 300);
    const floorY = WORLD_HEIGHT - FLOOR_THICKNESS;
    expect(engine.getState().pieces[0]!.y).toBeGreaterThan(floorY - radius * 2);
  });

  it("a piece dropped near the left wall stays inside the left wall boundary", () => {
    const engine = new CascadeEngine({});
    const tier = 0;
    const radius = (PIECE_DEFS[tier]!.shape as { radius: number }).radius;
    engine.drop(tier, WALL_THICKNESS + 1);
    runSteps(engine, 300);
    // centroid must clear the wall by at least the piece radius
    expect(engine.getState().pieces[0]!.x).toBeGreaterThanOrEqual(WALL_THICKNESS + radius);
  });

  it("a piece dropped near the right wall stays inside the right wall boundary", () => {
    const engine = new CascadeEngine({});
    const tier = 0;
    const radius = (PIECE_DEFS[tier]!.shape as { radius: number }).radius;
    engine.drop(tier, WORLD_WIDTH - WALL_THICKNESS - 1);
    runSteps(engine, 300);
    // centroid must clear the wall by at least the piece radius
    expect(engine.getState().pieces[0]!.x).toBeLessThanOrEqual(
      WORLD_WIDTH - WALL_THICKNESS - radius
    );
  });
});

describe("CascadeEngine — merge", () => {
  it("merge event fires with correct shape: { type, tierA, tierB, result }", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    const results = runSteps(engine, 600);
    const mergeEvent = allEvents(results).find((e) => e.type === "merge");
    expect(mergeEvent).toMatchObject({ type: "merge", tierA: 0, tierB: 0, result: 1 });
  });

  it("after merge, getState().pieces has 1 piece (not 2)", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    runSteps(engine, 600);
    expect(engine.getState().pieces).toHaveLength(1);
  });

  it("remaining piece after merge has tier 1", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    runSteps(engine, 600);
    expect(engine.getState().pieces[0]!.tier).toBe(1);
  });

  it("score increases by PIECE_DEFS[1].scoreValue after a tier-0 + tier-0 merge", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    runSteps(engine, 600);
    expect(engine.getState().score).toBe(PIECE_DEFS[1]!.scoreValue);
  });

  it("merging the highest tier does not crash — result is capped or handled gracefully", () => {
    const engine = new CascadeEngine({});
    engine.drop(MAX_TIER, 200);
    engine.drop(MAX_TIER, 200);
    expect(() => runSteps(engine, 600)).not.toThrow();
  });
});

describe("CascadeEngine — game over", () => {
  // Alternate between two adjacent tiers so pieces do not merge with each other,
  // guaranteeing vertical stacking rather than merges that reduce piece count.
  function overflowWorld(engine: CascadeEngine): StepResult[] {
    const all: StepResult[] = [];
    for (let i = 0; i < 25; i++) {
      engine.drop(i % 2 === 0 ? MAX_TIER - 2 : MAX_TIER - 1, WORLD_WIDTH / 2);
      all.push(...runSteps(engine, 8));
    }
    all.push(...runSteps(engine, OVERFLOW_TICKS_THRESHOLD + 60));
    return all;
  }

  it(`stacking pieces above OVERFLOW_LINE_Y (y=${OVERFLOW_LINE_Y}) for ${OVERFLOW_TICKS_THRESHOLD} ticks → gameOver event fires`, () => {
    const engine = new CascadeEngine({});
    const results = overflowWorld(engine);
    expect(allEvents(results).some((e) => e.type === "gameOver")).toBe(true);
  });

  it("after gameOver event, getState().gameOver is true", () => {
    const engine = new CascadeEngine({});
    overflowWorld(engine);
    expect(engine.getState().gameOver).toBe(true);
  });

  it("drop() after game-over is a no-op — no new piece added", () => {
    const engine = new CascadeEngine({});
    overflowWorld(engine);
    const countBefore = engine.getState().pieces.length;
    engine.drop(0, 200);
    expect(engine.getState().pieces).toHaveLength(countBefore);
  });
});

describe("CascadeEngine — sleep system", () => {
  it("a piece dropped from low height comes to rest without bouncing indefinitely", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, WORLD_WIDTH / 2);
    runSteps(engine, 400);
    // Must be resting near the floor — not bounced above the midpoint
    expect(engine.getState().pieces[0]!.y).toBeGreaterThan(WORLD_HEIGHT / 2);
  });

  it("after enough steps, a resting piece is flagged as sleeping", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, WORLD_WIDTH / 2);
    // Run long enough for the piece to settle and sleep
    runSteps(engine, 600);
    expect(engine.getState().pieces[0]!.isSleeping).toBe(true);
  });
});

describe("CascadeEngine — merge spawn velocity", () => {
  it("spawn velocity of merge-result body is clamped to MAX_SPAWN_VELOCITY", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    let mergeFound = false;
    for (let i = 0; i < 600; i++) {
      const result = engine.step(16.67);
      if (result.events.some((e) => e.type === "merge")) {
        // Capture velocity in the same step the merge fired, before gravity alters it
        const piece = engine.getState().pieces[0]!;
        expect(Math.abs(piece.vx)).toBeLessThanOrEqual(MAX_SPAWN_VELOCITY);
        expect(Math.abs(piece.vy)).toBeLessThanOrEqual(MAX_SPAWN_VELOCITY);
        mergeFound = true;
        break;
      }
    }
    expect(mergeFound).toBe(true);
  });

  it("merge in a crowded bin does not eject a piece above the overflow line", () => {
    const engine = new CascadeEngine({});
    // Build a partial stack of non-merging pieces (alternating tier 1 / tier 2)
    for (let i = 0; i < 4; i++) {
      engine.drop(i % 2 === 0 ? 1 : 2, WORLD_WIDTH / 2);
      runSteps(engine, 20);
    }
    // Drop two tier-0 pieces at the same x — guaranteed to collide and merge
    engine.drop(0, WORLD_WIDTH / 2);
    engine.drop(0, WORLD_WIDTH / 2);
    const results = runSteps(engine, 300);
    expect(allEvents(results).some((e) => e.type === "merge")).toBe(true);
    // The merged tier-1 piece must not have flown above the overflow line
    const mergedPiece = engine.getState().pieces.find((p) => p.tier === 1);
    expect(mergedPiece).toBeDefined();
    expect(mergedPiece!.y).toBeGreaterThan(OVERFLOW_LINE_Y);
  });
});

describe("CascadeEngine — guard rails (no silent removal)", () => {
  it("pieces count never decreases outside of a confirmed merge", () => {
    const engine = new CascadeEngine({});
    // Use different tiers so they do not merge with each other
    engine.drop(0, 100);
    engine.drop(1, 300);
    let mergeCount = 0;
    for (let i = 0; i < 300; i++) {
      const result = engine.step(16.67);
      mergeCount += result.events.filter((e) => e.type === "merge").length;
      expect(engine.getState().pieces.length).toBeGreaterThanOrEqual(2 - mergeCount);
    }
  });

  it("piece is not silently removed during normal play", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    runSteps(engine, 300);
    // The piece must still be present — guard rail moves OOB pieces back inside, never deletes them
    expect(engine.getState().pieces).toHaveLength(1);
  });
});

describe("CascadeEngine — restore", () => {
  it("populates pieces at saved positions with correct tiers", () => {
    const engine = new CascadeEngine({});
    engine.restore(
      [
        { tier: 0, x: 100, y: 400 },
        { tier: 2, x: 250, y: 350 },
      ],
      500
    );
    const { pieces, score, gameOver } = engine.getState();
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => p.tier).sort()).toEqual([0, 2]);
    expect(score).toBe(500);
    expect(gameOver).toBe(false);
  });

  it("clears any existing pieces before restoring", () => {
    const engine = new CascadeEngine({});
    engine.drop(1, 200);
    engine.drop(1, 300);
    engine.restore([{ tier: 0, x: 150, y: 400 }], 0);
    expect(engine.getState().pieces).toHaveLength(1);
  });

  it("restores with zero score when called with score 0", () => {
    const engine = new CascadeEngine({});
    engine.restore([{ tier: 0, x: 150, y: 400 }], 0);
    expect(engine.getState().score).toBe(0);
  });

  it("silently skips pieces with an invalid tier", () => {
    const engine = new CascadeEngine({});
    engine.restore(
      [
        { tier: 999, x: 100, y: 400 },
        { tier: 1, x: 200, y: 400 },
      ],
      0
    );
    expect(engine.getState().pieces).toHaveLength(1);
    expect(engine.getState().pieces[0]!.tier).toBe(1);
  });

  it("grants overflow-ignore grace period — overflow does not fire immediately after restore", () => {
    const engine = new CascadeEngine({});
    // Restore a pile above the overflow line
    const aboveOverflow = OVERFLOW_LINE_Y - 20;
    engine.restore(
      [
        { tier: 0, x: 150, y: aboveOverflow },
        { tier: 1, x: 200, y: aboveOverflow - 30 },
      ],
      0
    );
    // Run fewer ticks than the ignore window — game over must NOT fire yet
    const results: StepResult[] = [];
    for (let i = 0; i < OVERFLOW_IGNORE_MERGE_TICKS - 1; i++) {
      results.push(engine.step(16.67));
    }
    expect(allEvents(results).some((e) => e.type === "gameOver")).toBe(false);
  });
});

describe("CascadeEngine — cascadeCombo", () => {
  it("single merge from one drop → no cascadeCombo event", () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    const results = runSteps(engine, COMBO_WINDOW_TICKS + 50);
    expect(allEvents(results).some((e) => e.type === "cascadeCombo")).toBe(false);
  });

  it("two merges in one combo window → cascadeCombo { count: 2 }", () => {
    const engine = new CascadeEngine({});
    // Two pairs dropped at different x positions — each pair merges independently in the
    // first step (same-position collision). The last drop() resets the window; both merges
    // are counted, so cascadeCombo fires eagerly in that same step.
    engine.drop(0, 100);
    engine.drop(0, 100);
    engine.drop(0, 300);
    engine.drop(0, 300);
    const results = runSteps(engine, 60);
    const comboEvent = allEvents(results).find((e) => e.type === "cascadeCombo");
    expect(comboEvent).toMatchObject({ type: "cascadeCombo", count: 2 });
  });

  it("three merges in one combo window → cascadeCombo { count: 3 }", () => {
    const engine = new CascadeEngine({});
    // Three independent pairs; all merge in the first step. Validates that count
    // accumulates across multiple pending merges before the eager emission check.
    engine.drop(0, 100);
    engine.drop(0, 100);
    engine.drop(0, 200);
    engine.drop(0, 200);
    engine.drop(0, 300);
    engine.drop(0, 300);
    const results = runSteps(engine, 60);
    const comboEvent = allEvents(results).find((e) => e.type === "cascadeCombo");
    expect(comboEvent).toMatchObject({ type: "cascadeCombo", count: 3 });
  });

  it("cascadeCombo does not fire across two separate drop() calls", () => {
    const engine = new CascadeEngine({});
    // First pair merges (count=1 in first window)
    engine.drop(0, 100);
    engine.drop(0, 100);
    runSteps(engine, 50);
    // Second pair: drop() resets the window — first merge is discarded
    engine.drop(0, 300);
    engine.drop(0, 300);
    const results = runSteps(engine, COMBO_WINDOW_TICKS + 50);
    // Only second pair's merge counts in the new window: count=1 → no cascadeCombo
    expect(allEvents(results).some((e) => e.type === "cascadeCombo")).toBe(false);
  });
});
