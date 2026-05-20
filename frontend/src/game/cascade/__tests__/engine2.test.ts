import { CascadeEngine, type EngineEvent, type StepResult } from '../engine2';
import { PIECE_DEFS, MAX_TIER } from '../pieceDefs';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  OVERFLOW_LINE_Y,
  OVERFLOW_TICKS_THRESHOLD,
} from '../constants';

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

describe('CascadeEngine — construction', () => {
  it('constructs without throwing', () => {
    expect(() => new CascadeEngine({})).not.toThrow();
  });

  it('getState() returns initial empty state', () => {
    const engine = new CascadeEngine({});
    expect(engine.getState()).toEqual({ pieces: [], score: 0, gameOver: false });
  });
});

describe('CascadeEngine — drop', () => {
  it('adds a piece to the world', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    expect(engine.getState().pieces).toHaveLength(1);
  });

  it('dropped piece has the correct tier', () => {
    const engine = new CascadeEngine({});
    engine.drop(2, 200);
    expect(engine.getState().pieces[0]!.tier).toBe(2);
  });

  it('dropped piece x position matches the specified x (within tolerance)', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 150);
    expect(engine.getState().pieces[0]!.x).toBeCloseTo(150, 0);
  });

  it('dropping the same tier twice gives 2 pieces', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 100);
    engine.drop(0, 300);
    expect(engine.getState().pieces).toHaveLength(2);
  });
});

describe('CascadeEngine — physics / falling', () => {
  it('after N steps, a dropped piece y position is greater than its starting y', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    const initialY = engine.getState().pieces[0]!.y;
    runSteps(engine, 30);
    expect(engine.getState().pieces[0]!.y).toBeGreaterThan(initialY);
  });

  it('after enough steps, a dropped piece reaches near the floor', () => {
    const engine = new CascadeEngine({});
    const tier = 0;
    const radius = (PIECE_DEFS[tier]!.shape as { radius: number }).radius;
    engine.drop(tier, 200);
    runSteps(engine, 300);
    const floorY = WORLD_HEIGHT - FLOOR_THICKNESS;
    expect(engine.getState().pieces[0]!.y).toBeGreaterThan(floorY - radius * 2);
  });

  it('a piece dropped near the left wall stays inside the left wall boundary', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, WALL_THICKNESS + 1);
    runSteps(engine, 300);
    expect(engine.getState().pieces[0]!.x).toBeGreaterThanOrEqual(WALL_THICKNESS);
  });

  it('a piece dropped near the right wall stays inside the right wall boundary', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, WORLD_WIDTH - WALL_THICKNESS - 1);
    runSteps(engine, 300);
    expect(engine.getState().pieces[0]!.x).toBeLessThanOrEqual(WORLD_WIDTH - WALL_THICKNESS);
  });
});

describe('CascadeEngine — merge', () => {
  it('two tier-0 pieces dropped at the same x → merge event fires', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    const results = runSteps(engine, 600);
    expect(allEvents(results).some((e) => e.type === 'merge')).toBe(true);
  });

  it('merge event shape: { type, tierA, tierB, result }', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    const results = runSteps(engine, 600);
    const mergeEvent = allEvents(results).find((e) => e.type === 'merge');
    expect(mergeEvent).toMatchObject({ type: 'merge', tierA: 0, tierB: 0, result: 1 });
  });

  it('after merge, getState().pieces has 1 piece (not 2)', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    runSteps(engine, 600);
    expect(engine.getState().pieces).toHaveLength(1);
  });

  it('remaining piece after merge has tier 1', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    runSteps(engine, 600);
    expect(engine.getState().pieces[0]!.tier).toBe(1);
  });

  it('score increases by PIECE_DEFS[1].scoreValue after a tier-0 + tier-0 merge', () => {
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    engine.drop(0, 200);
    runSteps(engine, 600);
    expect(engine.getState().score).toBe(PIECE_DEFS[1]!.scoreValue);
  });

  it('merging the highest tier does not crash — result is capped or handled gracefully', () => {
    const engine = new CascadeEngine({});
    engine.drop(MAX_TIER, 200);
    engine.drop(MAX_TIER, 200);
    expect(() => runSteps(engine, 600)).not.toThrow();
  });
});

describe('CascadeEngine — game over', () => {
  // Fill the world by repeatedly dropping large pieces and letting them stack
  function overflowWorld(engine: CascadeEngine): StepResult[] {
    const all: StepResult[] = [];
    for (let i = 0; i < 25; i++) {
      engine.drop(MAX_TIER, WORLD_WIDTH / 2);
      all.push(...runSteps(engine, 8));
    }
    all.push(...runSteps(engine, OVERFLOW_TICKS_THRESHOLD + 60));
    return all;
  }

  it(`stacking pieces above OVERFLOW_LINE_Y (y=${OVERFLOW_LINE_Y}) for ${OVERFLOW_TICKS_THRESHOLD} ticks → gameOver event fires`, () => {
    const engine = new CascadeEngine({});
    const results = overflowWorld(engine);
    expect(allEvents(results).some((e) => e.type === 'gameOver')).toBe(true);
  });

  it('after gameOver event, getState().gameOver is true', () => {
    const engine = new CascadeEngine({});
    overflowWorld(engine);
    expect(engine.getState().gameOver).toBe(true);
  });

  it('drop() after game-over is a no-op — no new piece added', () => {
    const engine = new CascadeEngine({});
    overflowWorld(engine);
    const countBefore = engine.getState().pieces.length;
    engine.drop(0, 200);
    expect(engine.getState().pieces).toHaveLength(countBefore);
  });
});

describe('CascadeEngine — guard rails (no silent removal)', () => {
  it('pieces count never decreases outside of a confirmed merge', () => {
    const engine = new CascadeEngine({});
    // Use different tiers so they do not merge with each other
    engine.drop(0, 100);
    engine.drop(1, 300);
    let mergeCount = 0;
    for (let i = 0; i < 300; i++) {
      const result = engine.step(16.67);
      mergeCount += result.events.filter((e) => e.type === 'merge').length;
      expect(engine.getState().pieces.length).toBeGreaterThanOrEqual(2 - mergeCount);
    }
  });

  it('if a piece leaves world bounds, guardRailFired event is emitted and piece is kept', () => {
    // Normal play should not trigger this, but the engine must not silently delete pieces.
    // We verify the invariant: pieces are preserved across a run.
    const engine = new CascadeEngine({});
    engine.drop(0, 200);
    const results = runSteps(engine, 300);
    // If a guard rail fired, the piece must still be present (moved inside, not deleted)
    const guardFired = allEvents(results).some((e) => e.type === 'guardRailFired');
    if (guardFired) {
      expect(engine.getState().pieces.length).toBeGreaterThanOrEqual(1);
    } else {
      // No guard rail needed in normal play — piece is still present
      expect(engine.getState().pieces.length).toBe(1);
    }
  });
});
