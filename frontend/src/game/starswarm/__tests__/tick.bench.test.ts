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
 *
 * #3396: the same measurement with the wave timeline off and on (the run option `timelineOn`),
 * on the seeded wave-9 game and on a wave-7 FleetAdmiral stress game, each run back to back in
 * one process. Printed, never asserted, as above. Asserted: a timeline-off run never allocates a
 * timeline (no live buffer on any tick, nothing closed), and the two runs play identically
 * (the same gameplay hash and the same closed waves). Recorded numbers are in
 * docs/PERFORMANCE.md ("Star Swarm timeline diagnostics").
 */
import { PerformanceObserver } from "perf_hooks";
import { CANVAS_H, CANVAS_W, _resetIds, initStarSwarm, tick } from "../engine";
import type { DifficultyTier, StarSwarmState } from "../types";
import { sha } from "./helpers/goldenRuns";

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
      try {
        obs.observe({ entryTypes: ["gc"] });
      } catch {
        // no "gc" performance entries in this runtime: the GC count just reads 0
      }
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

// ---------------------------------------------------------------------------
// #3396: the wave timeline off and on
// ---------------------------------------------------------------------------

interface BenchGame {
  readonly name: string;
  readonly wave: number;
  readonly difficulty: DifficultyTier;
}

/** Interleaved off/on rounds: 3 for the measurement, 1 for the CI smoke. */
const ROUNDS = FULL ? 3 : 1;

const GAMES: BenchGame[] = [
  { name: "wave 9, Commander", wave: 9, difficulty: "Commander" },
  { name: "wave 7, FleetAdmiral (stress)", wave: 7, difficulty: "FleetAdmiral" },
];

function openGame(g: BenchGame, timelineOn: boolean): StarSwarmState {
  _resetIds();
  const init = initStarSwarm(CANVAS_W, CANVAS_H, g.wave, 42, g.difficulty, undefined, undefined, {
    timelineOn,
  });
  return { ...init, player: { ...init.player, lives: 9_999 } };
}

interface Timed {
  readonly end: StarSwarmState;
  readonly ms: number;
  readonly heapMb: number;
  readonly gcs: number;
  readonly gcMs: number;
  /** Ticks whose state held a live timeline buffer. */
  readonly withBuffer: number;
}

/** One timed run of TICKS ticks (after a warm-up run when FULL), with its GC passes. */
async function timed(g: BenchGame, timelineOn: boolean): Promise<Timed> {
  const gc = (globalThis as { gc?: () => void }).gc;
  const play = (s0: StarSwarmState) => {
    let s = s0;
    let withBuffer = 0;
    for (let t = 1; t <= TICKS; t++) {
      s = tick(s, t % 7 === 6 ? 33 : 16, pilot(t));
      if (s.waveTimeline !== null) withBuffer++;
    }
    return { s, withBuffer };
  };
  if (FULL) play(openGame(g, timelineOn)); // warm-up
  const s0 = openGame(g, timelineOn);
  gc?.();
  let gcs = 0;
  let gcMs = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      gcs++;
      gcMs += e.duration;
    }
  });
  try {
    obs.observe({ entryTypes: ["gc"] });
  } catch {
    // no "gc" performance entries in this runtime: the GC count just reads 0
  }
  try {
    const heap0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const { s, withBuffer } = play(s0);
    const ms = performance.now() - t0;
    const heapMb = (process.memoryUsage().heapUsed - heap0) / 1048576;
    await new Promise((r) => setTimeout(r, 0)); // let the observer deliver
    return { end: s, ms, heapMb, gcs, gcMs, withBuffer };
  } finally {
    obs.disconnect();
  }
}

describe("the wave timeline off and on (#3396)", () => {
  it.each(GAMES.map((g) => [g.name, g] as const))(
    `${TICKS} ticks, %s: off allocates no timeline, on plays identically`,
    async (name, g) => {
      const random = jest.spyOn(Math, "random").mockReturnValue(0.5);
      try {
        // interleaved rounds (off, on, off, on, ...) so neither flag always runs first
        const offs: Timed[] = [];
        const ons: Timed[] = [];
        for (let r = 0; r < ROUNDS; r++) {
          offs.push(await timed(g, false));
          ons.push(await timed(g, true));
        }
        const off = offs[0]!;
        const on = ons[0]!;
        const med = (xs: Timed[], f: (r: Timed) => number) =>
          xs.map(f).sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
        const line = (label: string, xs: Timed[]) => {
          const ms = med(xs, (r) => r.ms);
          return (
            `${label} ${ms.toFixed(0)} ms (${((ms * 1000) / TICKS).toFixed(1)} µs/tick), ` +
            `heap delta ${med(xs, (r) => r.heapMb).toFixed(1)} MB, ` +
            `${med(xs, (r) => r.gcs)} GC passes (${med(xs, (r) => r.gcMs).toFixed(0)} ms)`
          );
        };
        const gc = (globalThis as { gc?: () => void }).gc;
        process.stdout.write(
          `[bench #3396] ${TICKS} ticks, ${name}, median of ${ROUNDS}: ` +
            `${line("timeline off", offs)}; ${line("timeline on", ons)}; ${on.end.closedTimelines.length} timelines kept, ` +
            `${on.end.closedWaves.length} waves closed` +
            `${gc ? "" : " [run with --expose-gc for a clean heap baseline]"}\n`
        );
        // off: no buffer on any tick, nothing closed or counted
        expect(off.withBuffer).toBe(0);
        expect(off.end.waveTimeline).toBeNull();
        expect(off.end.closedTimelines).toEqual([]);
        expect(off.end.closedTimelinesBytes).toBe(0);
        // on: it did record, and the game is the same game
        expect(on.withBuffer).toBe(TICKS);
        expect(sha(on.end)).toBe(sha(off.end));
        expect(on.end.closedWaves).toEqual(off.end.closedWaves);
        expect(on.end.phase).not.toBe("GameOver");
        // the full measurement reaches wave closes, so it times the close path with timelines too
        if (FULL) expect(on.end.closedWaves.length).toBeGreaterThan(0);
      } finally {
        random.mockRestore();
      }
    },
    240_000
  );
});
