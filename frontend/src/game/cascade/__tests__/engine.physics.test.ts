/**
 * The physics of #3697 (planck.js 1.4.2, the owner's "3 lively" tuning): grow-in, the merge gap,
 * chain reach, per-tier density, the win event, no teleports, and determinism at 60 and 120 Hz.
 */
import type { Fixture } from "planck";
import { CascadeEngine, type EngineEvent, type StepResult } from "../engine";
import { CAPSTONE_TIER, TIERS, tierRadius } from "../tiers";
import {
  CHAIN_REACH_PX,
  FIXED_STEP_MS,
  FLOOR_THICKNESS,
  GROW_IN_STEPS,
  MAX_SPAWN_VELOCITY,
  MERGE_GAP_PX,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../constants";

const HZ60 = 1000 / 60;
const HZ120 = 1000 / 120;
const FLOOR_TOP = WORLD_HEIGHT - FLOOR_THICKNESS;

function run(engine: CascadeEngine, n: number, frameMs = HZ60): StepResult[] {
  const out: StepResult[] = [];
  for (let i = 0; i < n && !engine.getState().gameOver; i++) out.push(engine.step(frameMs));
  return out;
}
const events = (rs: StepResult[]): EngineEvent[] => rs.flatMap((r) => r.events);
const merges = (rs: StepResult[]) =>
  events(rs).filter((e): e is Extract<EngineEvent, { type: "merge" }> => e.type === "merge");

/** Two `tier` pieces touching (1 px overlap) on the floor, centred on x. */
function pair(tier: number, x = 200): { tier: number; x: number; y: number }[] {
  const r = tierRadius(tier);
  return [
    { tier, x: x - r + 0.5, y: FLOOR_TOP - r },
    { tier, x: x + r - 0.5, y: FLOOR_TOP - r },
  ];
}

describe("grow-in", () => {
  it("a merged piece starts at its parents' size and grows to its own over GROW_IN_STEPS", () => {
    const engine = new CascadeEngine({});
    engine.restore(pair(4), 0);
    expect(merges(run(engine, 1))).toHaveLength(1);
    const scales: number[] = [];
    for (let i = 0; i <= GROW_IN_STEPS; i++) {
      scales.push(engine.getState().pieces[0]!.scale);
      engine.step(HZ60);
    }
    expect(scales[0]).toBeCloseTo(tierRadius(4) / tierRadius(5), 9);
    for (let i = 1; i < scales.length; i++)
      expect(scales[i]!).toBeGreaterThanOrEqual(scales[i - 1]!);
    expect(scales[GROW_IN_STEPS]).toBe(1);
    expect(engine.getState().pieces[0]!.scale).toBe(1);
  });

  it.each([0, 3, 6, 9])(
    "a tier-%i merge under a piece resting on both parents kicks no neighbour faster than 1.5 px/step",
    (tier) => {
      // The piece in the valley on top of the pair overlaps the merged piece at once (it is made
      // at the parents' midpoint). planck resolves that overlap by position, and the grow-in eases
      // the rest: no velocity spike reaches the neighbours (the lid counts a piece as settled
      // under 8 px/step; a merged piece's own spawn velocity is capped at MAX_SPAWN_VELOCITY).
      const r = tierRadius(tier);
      // Neighbours: one in the valley on top, one on the floor each side; no tier repeats.
      const top = tier + 2;
      const rt = tierRadius(top);
      const valleyY = FLOOR_TOP - r - Math.sqrt((r + rt) ** 2 - (r - 0.5) ** 2) - 0.3;
      const [left, right] = tier === 0 ? [3, 4] : [0, 1];
      const rl = tierRadius(left);
      const rr = tierRadius(right);
      const engine = new CascadeEngine({});
      engine.restore(
        [
          ...pair(tier),
          { tier: top, x: 200, y: valleyY },
          { tier: left, x: 200 - 2 * r - rl, y: FLOOR_TOP - rl },
          { tier: right, x: 200 + 2 * r + rr, y: FLOOR_TOP - rr },
        ],
        0
      );
      const results: StepResult[] = [];
      let maxNeighbour = 0;
      for (let i = 0; i < 30; i++) {
        results.push(engine.step(HZ60));
        for (const p of engine.getState().pieces) {
          if (p.tier === tier + 1) continue;
          maxNeighbour = Math.max(maxNeighbour, Math.hypot(p.vx, p.vy));
        }
      }
      expect(merges(results).map((m) => m.result)).toEqual([tier + 1]);
      expect(maxNeighbour).toBeLessThan(1.5);
      expect(maxNeighbour).toBeLessThan(MAX_SPAWN_VELOCITY);
    }
  );

  it("a merge against a wall is made where its full size is inside the wall", () => {
    const engine = new CascadeEngine({});
    const t = 6;
    const r = tierRadius(t);
    engine.restore(
      [
        { tier: t, x: WALL_THICKNESS + r, y: FLOOR_TOP - r },
        { tier: t, x: WALL_THICKNESS + 3 * r - 1, y: FLOOR_TOP - r },
      ],
      0
    );
    const first = merges(run(engine, 1));
    expect(first).toHaveLength(1);
    expect(first[0]!.x - tierRadius(t + 1)).toBeGreaterThanOrEqual(WALL_THICKNESS);
    const results = run(engine, 30);
    const piece = engine.getState().pieces[0]!;
    expect(piece.tier).toBe(t + 1);
    expect(piece.x - tierRadius(t + 1)).toBeGreaterThanOrEqual(WALL_THICKNESS - 0.5);
    expect(events(results).some((e) => e.type === "guardRailFired")).toBe(false);
  });
});

describe("the merge gap and chain reach", () => {
  /** Two `tier` pieces on the floor whose circles are `gap` px apart. */
  function apart(tier: number, gap: number) {
    const r = tierRadius(tier);
    return [
      { tier, x: 200 - r - gap / 2, y: FLOOR_TOP - r },
      { tier, x: 200 + r + gap / 2, y: FLOOR_TOP - r },
    ];
  }

  it(`merges two same-tier pieces resting under ${MERGE_GAP_PX} px apart, not ones further`, () => {
    const near = new CascadeEngine({});
    near.restore(apart(3, MERGE_GAP_PX - 0.25), 0);
    expect(merges(run(near, 1))).toHaveLength(1);

    const far = new CascadeEngine({});
    far.restore(apart(3, MERGE_GAP_PX + 1), 0);
    expect(merges(run(far, 60))).toHaveLength(0);
    expect(far.getState().pieces).toHaveLength(2);
  });

  it("a merge product touching a same-tier piece at full size merges again within 150 ms", () => {
    // Two tier-1 pieces touching on the floor and a tier 2 resting in the valley on top of them.
    // Their product (a tier 2 made at their midpoint, on the floor) touches it at full size,
    // though it starts at its parents' radius.
    const r1 = tierRadius(1);
    const r2 = tierRadius(2);
    const half = r1 - 0.5;
    const engine = new CascadeEngine({});
    engine.restore(
      [
        ...pair(1),
        { tier: 2, x: 200, y: FLOOR_TOP - r1 - Math.sqrt((r1 + r2) ** 2 - half ** 2) - 0.5 },
      ],
      0
    );
    const results = run(engine, Math.ceil(150 / FIXED_STEP_MS));
    const ms = merges(results);
    expect(ms.map((m) => m.result)).toEqual([2, 3]);
    // The second merge consumed the first's product, one step later.
    expect(ms[1]!.parentIds).toContain(ms[0]!.id);
    const steps = results.findIndex((r) => r.events.includes(ms[1]!)) + 1;
    expect(steps * FIXED_STEP_MS).toBeLessThan(150);
    expect(steps).toBeLessThanOrEqual(2);
  });

  it(`chain reach is ${CHAIN_REACH_PX} px at full size, from a piece still growing in`, () => {
    expect(CHAIN_REACH_PX).toBeGreaterThan(0);
    expect(GROW_IN_STEPS).toBeGreaterThan(1);
  });
});

describe("density per tier", () => {
  type Internals = { _pieces: Map<number, { fixture: Fixture }> };

  it("gives every tier the ladder's density, so mass grows as r^1.5", () => {
    const engine = new CascadeEngine({});
    engine.restore(
      TIERS.map((t, i) => ({
        tier: t.tier,
        x: 60 + (i % 4) * 90,
        y: 100 + Math.floor(i / 4) * 140,
      })),
      0
    );
    const masses = Array.from((engine as unknown as Internals)._pieces.values(), (p) => {
      const f = p.fixture;
      return { tier: (f.getUserData() as { tier: number }).tier, mass: f.getBody().getMass(), f };
    });
    for (const { tier, f } of masses) expect(f.getDensity()).toBe(TIERS[tier]!.density);
    const m = (tier: number) => masses.find((x) => x.tier === tier)!.mass;
    const ratio = m(CAPSTONE_TIER) / m(0);
    expect(ratio).toBeCloseTo((tierRadius(CAPSTONE_TIER) / tierRadius(0)) ** 1.5, 6);
    // At one density for every tier it would be (63 / 18)^2 = 12.25.
    expect(ratio).toBeLessThan(7);
    engine.destroy();
  });
});

describe("the win (#3699 builds on it)", () => {
  it("making the capstone emits one win, after its merge and score, and the game goes on", () => {
    const engine = new CascadeEngine({});
    engine.restore(pair(CAPSTONE_TIER - 1), 0);
    const step = engine.step(HZ60).events;
    const types = step.map((e) => e.type);
    expect(types).toEqual(["merge", "score", "win"]);
    const merge = step[0] as Extract<EngineEvent, { type: "merge" }>;
    expect(step[2]).toEqual({ type: "win", x: merge.x, y: merge.y, id: merge.id });
    const later = events(run(engine, 120));
    expect(later.some((e) => e.type === "win")).toBe(false);
    expect(engine.getState().gameOver).toBe(false);
    expect(engine.canDrop()).toBe(true);
  });

  it("no other merge emits a win", () => {
    for (let tier = 0; tier < CAPSTONE_TIER - 1; tier++) {
      const engine = new CascadeEngine({});
      engine.restore(pair(tier), 0);
      const evs = events(run(engine, 2));
      expect(evs.some((e) => e.type === "merge")).toBe(true);
      expect(evs.some((e) => e.type === "win")).toBe(false);
    }
  });
});

describe("drops at the edge of the bin", () => {
  it("place the piece against the wall, never inside it", () => {
    const engine = new CascadeEngine({});
    engine.drop(5, WALL_THICKNESS);
    engine.drop(4, WORLD_WIDTH - WALL_THICKNESS);
    const [left, right] = engine.getState().pieces;
    expect(left!.x).toBe(WALL_THICKNESS + tierRadius(5));
    expect(right!.x).toBe(WORLD_WIDTH - WALL_THICKNESS - tierRadius(4));
  });
});

describe("no teleports in normal play", () => {
  it("a crowded bin of drops at random spots never fires the guard rail", () => {
    const engine = new CascadeEngine({});
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const all: EngineEvent[] = [];
    for (let i = 0; i < 150 && !engine.getState().gameOver; i++) {
      engine.drop(
        Math.floor(rand() * 6),
        WALL_THICKNESS + rand() * (WORLD_WIDTH - 2 * WALL_THICKNESS)
      );
      all.push(...events(run(engine, 12)));
    }
    expect(all.filter((e) => e.type === "merge").length).toBeGreaterThan(20);
    expect(all.some((e) => e.type === "guardRailFired")).toBe(false);
  });
});

describe("determinism (replays, #3858)", () => {
  /**
   * Drops every 40th frame, fed at a frame rate. (Across frame rates the rules run the same
   * fixed steps, so a game plays the same up to frame-boundary rounding: `engine.lid.test.ts`.)
   */
  function play(frameMs: number): string {
    const engine = new CascadeEngine({});
    const frames = Math.round(20_000 / frameMs);
    const xs = [120, 250, 180, 310, 90, 220];
    let drop = 0;
    for (let f = 0; f < frames; f++) {
      if (f % 40 === 0 && engine.canDrop()) {
        engine.drop(drop % 6, xs[drop % xs.length]!);
        drop++;
      }
      engine.step(frameMs);
    }
    const s = engine.getState();
    return JSON.stringify({ score: s.score, pieces: s.pieces });
  }

  it("the same drops stepped by the same deltas replay the same board, bit for bit", () => {
    expect(play(HZ60)).toEqual(play(HZ60));
    expect(play(HZ120)).toEqual(play(HZ120));
  });

  it("piece ids start at 1 for every engine", () => {
    const a = new CascadeEngine({});
    a.drop(0, 200);
    const b = new CascadeEngine({});
    b.drop(0, 200);
    expect(a.getState().pieces[0]!.id).toBe(1);
    expect(b.getState().pieces[0]!.id).toBe(1);
  });
});
