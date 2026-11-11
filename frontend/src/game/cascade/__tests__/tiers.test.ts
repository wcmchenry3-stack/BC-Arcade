/**
 * The tier ladder (#3695): one table, read by everything. These tests pin its invariants, that
 * the engine and the renderer use its radius, and that no other module restates a per-tier
 * radius, score or density.
 */
import * as fs from "fs";
import * as path from "path";

import { CascadeEngine } from "../engine";
import { DROPPABLE_PIECE_TIERS, MAX_TIER, PIECE_DEFS } from "../pieceDefs";
import {
  CAPSTONE_TIER,
  DROPPABLE_TIERS,
  TIER_COUNT,
  TIERS,
  spriteHalfSize,
  tierRadius,
} from "../tiers";
import { OVERFLOW_LINE_Y, WALL_THICKNESS, WORLD_WIDTH } from "../constants";
import { FRUIT_SETS } from "../../../theme/fruitSets";

const INNER_WIDTH = WORLD_WIDTH - 2 * WALL_THICKNESS;

describe("the ladder", () => {
  it("has 12 tiers, numbered 0..11", () => {
    expect(TIER_COUNT).toBe(12);
    expect(TIERS).toHaveLength(12);
    expect(TIERS.map((t) => t.tier)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(CAPSTONE_TIER).toBe(11);
  });

  it("has strictly increasing radius and score", () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i]!.radius).toBeGreaterThan(TIERS[i - 1]!.radius);
      expect(TIERS[i]!.score).toBeGreaterThan(TIERS[i - 1]!.score);
    }
  });

  it("follows the documented geometric series, radius(n) = round(22 * 4^(n/10))", () => {
    TIERS.forEach((t) => expect(t.radius).toBe(Math.round(22 * Math.pow(4, t.tier / 10))));
  });

  it("scores double per tier (provisional until the time-bonus story, #3700)", () => {
    TIERS.forEach((t) => expect(t.score).toBe(2 ** t.tier));
  });

  it("has a density on every tier (1 until the physics story, #3697)", () => {
    TIERS.forEach((t) => expect(t.density).toBe(1));
  });

  it("drops tiers 0-4 only; the capstone is never dropped", () => {
    expect(DROPPABLE_TIERS).toEqual([0, 1, 2, 3, 4]);
    expect(DROPPABLE_PIECE_TIERS).toEqual([0, 1, 2, 3, 4]);
    expect(TIERS[CAPSTONE_TIER]!.droppable).toBe(false);
  });

  it("lets two tier-10 pieces sit side by side in the bin and touch, and fits the capstone", () => {
    expect(4 * TIERS[10]!.radius).toBeLessThanOrEqual(INNER_WIDTH);
    expect(2 * TIERS[CAPSTONE_TIER]!.radius).toBeLessThanOrEqual(INNER_WIDTH);
  });

  it("spawns every droppable tier on the canvas, over the lid", () => {
    for (const tier of DROPPABLE_TIERS) {
      const r = tierRadius(tier);
      const spawnTop = OVERFLOW_LINE_Y - r - 5 - r;
      expect(spawnTop).toBeGreaterThanOrEqual(-1);
    }
  });

  it("is what PIECE_DEFS and MAX_TIER are built from", () => {
    expect(PIECE_DEFS).toHaveLength(TIER_COUNT);
    expect(MAX_TIER).toBe(CAPSTONE_TIER);
    PIECE_DEFS.forEach((def, i) => {
      expect(def.shape).toEqual({ kind: "circle", radius: TIERS[i]!.radius });
      expect(def.scoreValue).toBe(TIERS[i]!.score);
      expect(def.density).toBe(TIERS[i]!.density);
    });
  });

  it("names every tier of both sets from the ladder's keys, in the owner's order", () => {
    expect(TIERS.map((t) => t.nameKeys.fruits)).toEqual([
      "cherry",
      "blueberry",
      "lemon",
      "grape",
      "orange",
      "apple",
      "peach",
      "coconut",
      "dragonfruit",
      "pineapple",
      "watermelon",
      "pumpkin",
    ]);
    expect(TIERS.map((t) => t.nameKeys.cosmos)).toEqual([
      "moon",
      "pluto",
      "mercury",
      "mars",
      "venus",
      "earth",
      "neptune",
      "uranus",
      "saturn",
      "jupiter",
      "sun",
      "milkyWay",
    ]);
    for (const set of Object.values(FRUIT_SETS)) {
      set.fruits.forEach((f) => {
        const key = TIERS[f.tier]!.nameKeys[set.id as "fruits" | "cosmos"];
        expect(f.i18nKey).toBe(`${set.id}.${key}`);
      });
    }
  });
});

describe("the engine reads the ladder", () => {
  type Internals = {
    _pieces: Map<number, { body: { circleRadius: number; density: number }; tier: number }>;
  };
  const bodies = (e: CascadeEngine) => Array.from((e as unknown as Internals)._pieces.values());

  it("gives every tier a collider of exactly its ladder radius and density", () => {
    for (const t of TIERS) {
      const engine = new CascadeEngine({});
      engine.restore([{ tier: t.tier, x: 200, y: 500 }], 0);
      const [piece] = bodies(engine);
      expect(piece!.body.circleRadius).toBe(t.radius);
      expect(piece!.body.density).toBeCloseTo(0.001 * t.density, 10);
    }
  });

  it("merges two tier-10 pieces into the capstone and scores it from the ladder", () => {
    const engine = new CascadeEngine({});
    engine.drop(10, 200);
    engine.drop(10, 200);
    const events = engine.step(16.67).events;
    expect(events.some((e) => e.type === "merge" && e.result === 11)).toBe(true);
    const state = engine.getState();
    expect(state.pieces.map((p) => p.tier)).toEqual([11]);
    expect(state.score).toBe(TIERS[11]!.score);
  });

  it("never merges two capstones", () => {
    const engine = new CascadeEngine({});
    engine.drop(CAPSTONE_TIER, 200);
    engine.drop(CAPSTONE_TIER, 200);
    for (let i = 0; i < 120; i++) {
      const events = engine.step(16.67).events;
      expect(events.some((e) => e.type === "merge")).toBe(false);
    }
    expect(engine.getState().pieces.map((p) => p.tier)).toEqual([11, 11]);
  });
});

describe("drawn size = collider size", () => {
  it("sizes every sprite so the visible fruit has the ladder radius", () => {
    for (const set of Object.values(FRUIT_SETS)) {
      for (const f of set.fruits) {
        if (f.bakedClipR === undefined) continue;
        // half-size per unit of fruit radius is bakedClipR, so visible radius = half / bakedClipR
        expect(spriteHalfSize(f.tier, f.bakedClipR) / f.bakedClipR).toBeCloseTo(
          tierRadius(f.tier),
          9
        );
      }
    }
  });

  it("falls back to the plain ladder radius for a tier with no sprite (placeholder circle)", () => {
    expect(spriteHalfSize(CAPSTONE_TIER, undefined)).toBe(tierRadius(CAPSTONE_TIER));
  });

  it("has no radius, score or density left on the fruit-set definitions", () => {
    for (const set of Object.values(FRUIT_SETS)) {
      for (const f of set.fruits) {
        expect(f).not.toHaveProperty("radius");
        expect(f).not.toHaveProperty("scoreValue");
        expect(f).not.toHaveProperty("density");
      }
    }
  });
});

describe("one table only", () => {
  const SRC = path.resolve(__dirname, "../../..");
  /** Where Cascade's tier data could creep back in. */
  const ROOTS = ["game/cascade", "theme", "components/cascade", "screens/CascadeScreen.tsx"];
  const ALLOWED = new Set([path.join(SRC, "game/cascade/tiers.ts")]);

  function files(p: string): string[] {
    const full = path.join(SRC, p);
    if (fs.statSync(full).isFile()) return [full];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((d) => {
      if (d.name === "__tests__") return [];
      const child = path.join(full, d.name);
      if (d.isDirectory()) return files(path.relative(SRC, child));
      return /\.(ts|tsx)$/.test(d.name) ? [child] : [];
    });
  }

  // A per-tier radius/score/density: an old-style table (RADII, SCORE_VALUES, ...) or a numeric
  // `radius:` / `scoreValue:` / `density:` property (the ladder is the only place for those).
  const FORBIDDEN = [
    /\bRADII\b/,
    /\bSCORE_VALUES\b/,
    /\bTIER_(RADII|SCORES|DENSIT\w+)\b/,
    /\b(radius|scoreValue|score|density)\s*:\s*-?\d/,
  ];

  it("defines no per-tier radius, score or density outside tiers.ts", () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap(files)) {
      if (ALLOWED.has(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(text)) offenders.push(`${path.relative(SRC, file)} matches ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
