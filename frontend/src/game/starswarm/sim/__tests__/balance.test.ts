/**
 * #2880 Buddy balance simulation: the fast smoke layer (a few seconds, every PR).
 *
 * The harness drives the real engine, its attribution adds up to Buddy's real HP loss, a seeded
 * cell replays to the same metrics, a no-override engine variant is the shipped engine, and every
 * preset variant still applies to the current engine source. The full run is the CLI
 * (`npx tsx scripts/simulate-starswarm.ts`), see docs/games/starswarm.md → "Balance simulation".
 */
import * as fs from "fs";
import * as realEngine from "../../engine";
import {
  PILOTS,
  cellSeed,
  measureCell,
  runCell,
  runOne,
  type CellSpec,
  type RunSpec,
} from "../balance";
import { loadEngineVariant, patchEngineSource } from "../engineVariant";
import { FAST, VARIANTS, engineFor } from "../presets";
import { formatOffense, formatReport } from "../report";

const fastCells: CellSpec[] = FAST.groups.flatMap((g) =>
  g.scenarios.flatMap((scenario) =>
    g.difficulties.map((difficulty) => ({
      scenario,
      difficulty,
      pilot: g.pilots[0]!,
      variant: g.variants[0]!.name,
      seeds: FAST.seeds,
    }))
  )
);

describe("balance sim harness (fast)", () => {
  it("launches Buddy through the real power-up path and accounts for every hit point", () => {
    for (const cell of fastCells) {
      for (const r of runCell(realEngine, cell)) {
        expect(r.reached).toBe(true);
        expect(r.sortieMs).toBeGreaterThan(0);
        expect(r.hpEnd).toBeGreaterThanOrEqual(0);
        expect(r.hpEnd).toBeLessThanOrEqual(realEngine.BUDDY_HP);
        // a shot fired and landed within one tick is invisible to diffing: rare, and counted
        expect(r.attributionMisses).toBeLessThanOrEqual(1);
        const taken = Object.values(r.damageTaken).reduce((a, b) => a + b, 0);
        if (r.destroyed) expect(taken + r.attributionMisses).toBeGreaterThanOrEqual(1);
        else expect(realEngine.BUDDY_HP - taken - r.attributionMisses).toBe(r.hpEnd);
        expect(r.fleetAtLaunch).toBeGreaterThan(0);
        const kills = r.killsByRun.reduce((a, b) => a + b, 0);
        expect(kills).toBe(Object.values(r.buddyKills).reduce((a, b) => a + b, 0));
        expect(r.killsByRun.length).toBeLessThanOrEqual(realEngine.BUDDY_BURSTS);
      }
    }
  });

  it("measures a cell deterministically into a plain metrics object", () => {
    const cell = fastCells[0]!;
    const a = measureCell(realEngine, cell);
    expect(measureCell(realEngine, cell)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.reached).toBe(cell.seeds);
    expect(a.destroyedPct).toBeGreaterThanOrEqual(0);
    expect(a.destroyedPct).toBeLessThanOrEqual(1);
    expect(formatReport([a])).toContain("| Capt |");
    expect(formatOffense([a])).toContain("base");
  });

  it("hashes seeds instead of counting them (the engine's LCG correlates neighbours)", () => {
    const seeds = new Set(Array.from({ length: 50 }, (_, i) => cellSeed(i)));
    expect(seeds.size).toBe(50);
    expect(Math.abs(cellSeed(1) - cellSeed(0))).toBeGreaterThan(1000);
  });

  it("a variant with no overrides replays the shipped engine exactly", () => {
    const spec: RunSpec = {
      scenario: "boss-exposed",
      difficulty: "Commander",
      seed: cellSeed(0),
      pilot: PILOTS.normal,
      variant: "x",
    };
    expect(runOne(loadEngineVariant({}), spec)).toEqual(runOne(realEngine, spec));
  });

  it("every preset variant still applies to the current engine source", () => {
    const src = fs.readFileSync(require.resolve("../../engine.ts"), "utf8");
    for (const v of VARIANTS) {
      expect(() => patchEngineSource(src, v.spec)).not.toThrow();
      expect(typeof engineFor(v).tick).toBe("function");
    }
    expect(() => patchEngineSource(src, { consts: { NOT_A_CONSTANT: "1" } })).toThrow();
  });
});
