/**
 * #2881 asteroid-awareness sim. The fast smoke runs in normal CI (a few seeds, well under 30 s).
 * The full sweep is skipped unless asked for:
 *   SIM=1 npx jest tooling/starswarm/__tests__/asteroidAwareness.sim.test.ts
 * Knobs: SIM_SEEDS (default 40), SIM_DIFFS (comma list, default Ensign,LieutenantJG,Admiral).
 */
import {
  FAST_PARAMS,
  SIM_CELLS,
  formatMetrics,
  measureAwareness,
  runTrial,
} from "../asteroidAwareness";
import type { DifficultyTier } from "../../../src/game/starswarm/types";

const RUN = process.env.SIM === "1";
const seeds = Number(process.env.SIM_SEEDS ?? 40);
const diffs = (process.env.SIM_DIFFS ?? "Ensign,LieutenantJG,Admiral").split(
  ","
) as DifficultyTier[];

describe("asteroid awareness sim (#2881) fast smoke", () => {
  it("every cell can be forced and a trial is deterministic for its seed", () => {
    for (const cell of SIM_CELLS) {
      const a = runTrial(3, "LieutenantJG", cell, "live");
      expect(a).not.toBeNull();
      expect(runTrial(3, "LieutenantJG", cell, "live")).toEqual(a);
    }
  });

  it("measureAwareness is pure, deterministic and returns plain rates", () => {
    const a = measureAwareness(FAST_PARAMS);
    const b = measureAwareness(FAST_PARAMS);
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a); // plain data: a gate can store/diff it
    expect(a.cells).toHaveLength(FAST_PARAMS.cells!.length);
    for (const c of a.cells) {
      expect(c.live.n).toBeGreaterThan(0);
      for (const v of [c.controlHit, c.live.threatened, c.live.hit]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("Circling ships now detect the rock, and Grunt divers visibly react", () => {
    const m = measureAwareness(FAST_PARAMS);
    const circ = m.cells.find((c) => c.cell.phase === "Circling")!;
    expect(circ.live.threatened).toBeGreaterThan(0);
    const dive = m.cells.find((c) => c.cell.tier === "Grunt" && c.cell.phase === "Diving")!;
    expect(dive.live.flinched).toBeGreaterThan(0.5);
  });
});

(RUN ? describe : describe.skip)("asteroid awareness sim (#2881) full sweep", () => {
  jest.setTimeout(30 * 60_000);

  it.each(diffs)("%s: engine metrics", (difficulty) => {
    const m = measureAwareness({ seeds, difficulty });
    process.stdout.write(`\n${difficulty} seeds=${seeds}\n${formatMetrics(m)}\n`);
  });
});
