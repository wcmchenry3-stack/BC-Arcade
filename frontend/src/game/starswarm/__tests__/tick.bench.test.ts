/**
 * Micro-benchmark for #2963: 10,000 engine `tick`s on a seeded wave-9 game.
 *
 * The timing and allocation figures are printed, never asserted — they depend on the machine —
 * so the test is deterministic. What is asserted is that the run is a real one (the game is
 * still live and moving at the end). The full run takes several seconds under jest, so CI runs
 * a 500-tick smoke of the same code; set STARSWARM_BENCH=1 for the 10,000-tick measurement.
 *
 * Allocation pressure is read off the garbage collector: the number of GC passes during the run
 * and the heap delta across it. Run it on its own, with an explicit GC for a cleaner heap figure:
 *   cd frontend && STARSWARM_BENCH=1 node --expose-gc node_modules/.bin/jest \
 *     src/game/starswarm/__tests__/tick.bench.test.ts
 *
 * Recorded numbers (before and after #2963) are in docs/PERFORMANCE.md.
 */
import { PerformanceObserver } from "perf_hooks";
import { CANVAS_H, CANVAS_W, _resetIds, initStarSwarm, tick } from "../engine";
import type { StarSwarmState } from "../types";

const FULL = process.env.STARSWARM_BENCH === "1";
const TICKS = FULL ? 10_000 : 500;

/** Scripted pilot (as in the golden replay): a triangle-wave sweep, firing with short lulls. */
function pilot(t: number): { playerX: number; fire: boolean } {
  const period = 240;
  const phase = t % period;
  const frac = phase < period / 2 ? phase / (period / 2) : 2 - phase / (period / 2);
  return { playerX: 20 + frac * (CANVAS_W - 40), fire: t % 300 < 270 };
}

function wave9(): StarSwarmState {
  _resetIds();
  const init = initStarSwarm(CANVAS_W, CANVAS_H, 9, 42, "Commander");
  // A deep reserve so the pilot (which never dodges) is still flying at the end of the run
  return { ...init, player: { ...init.player, lives: 9_999 } };
}

function run(s0: StarSwarmState): StarSwarmState {
  let s = s0;
  for (let t = 1; t <= TICKS; t++) s = tick(s, t % 7 === 6 ? 33 : 16, pilot(t));
  return s;
}

describe("Star Swarm tick micro-benchmark (#2963)", () => {
  it(`${TICKS} ticks on a seeded wave-9 game`, async () => {
    const random = jest.spyOn(Math, "random").mockReturnValue(0.5);
    const gc = (globalThis as { gc?: () => void }).gc;
    let gcs = 0;
    let gcMs = 0;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        gcs++;
        gcMs += e.duration;
      }
    });
    try {
      if (FULL) run(wave9()); // warm-up: JIT the engine before timing it
      const s0 = wave9();
      gc?.();
      obs.observe({ entryTypes: ["gc"] });
      const heap0 = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      const end = run(s0);
      const ms = performance.now() - t0;
      const heap1 = process.memoryUsage().heapUsed;
      await new Promise((r) => setTimeout(r, 0)); // let the observer deliver
      obs.disconnect();
      process.stdout.write(
        `[bench #2963] ${TICKS} ticks, wave 9: ${ms.toFixed(0)} ms ` +
          `(${((ms * 1000) / TICKS).toFixed(1)} µs/tick), ` +
          `heap delta ${((heap1 - heap0) / 1048576).toFixed(1)} MB, ` +
          `${gcs} GC passes (${gcMs.toFixed(0)} ms)` +
          `${gc ? "" : " [run with --expose-gc for a clean heap baseline]"}\n`
      );
      expect(end.phase).not.toBe("GameOver");
      expect(end).not.toBe(s0);
    } finally {
      obs.disconnect();
      random.mockRestore();
    }
  }, 120_000);
});
