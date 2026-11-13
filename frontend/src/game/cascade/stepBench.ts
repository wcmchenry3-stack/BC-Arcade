/**
 * Cascade step-cost bench (#3697), run on demand from the dev panel so the owner can time the
 * planck engine on a real phone (docs/PERFORMANCE.md: 90 pieces on a mid-range Android and an
 * older iPhone).
 *
 * The protocol is the #3696 spike's and #3697's sim bench, so a phone's numbers compare with the
 * ones measured in CI's container: merges and the lid off (`EngineConfig.bench`), `pieces` tier-0
 * and tier-1 pieces (alternating) dropped every 15 frames (250 ms) across the bin, each frame one
 * `step(1000 / 60)`, timed from the (pieces - 4)th piece to 180 frames (3 s) after the last.
 * The frame costs go into Star Swarm's `frameStats` ring buffer (the dev panel's frame readout),
 * and the mean / p95 are read back from it.
 *
 * Nothing here runs unless the dev panel's button is pressed: it is never on the frame path. It
 * blocks the JS thread while it runs (about 1,500 steps), which is the point: it measures the step
 * alone.
 */
import { CascadeEngine } from "./engine";
import { WALL_THICKNESS, WORLD_WIDTH } from "./constants";
import { createSeededRng } from "../_shared/seededRng";
import { createFrameStats, percentile, recordFrame } from "../starswarm/render/frameStats";

export interface StepBenchResult {
  /** Pieces on the board at the end. */
  readonly pieces: number;
  /** Frames timed. */
  readonly frames: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface StepBenchOptions {
  /** Pieces to drop (default 90: the most a lively board was seen to hold). */
  readonly pieces?: number;
  /** Clock (ms); `performance.now` by default. */
  readonly now?: () => number;
}

const FRAME_MS = 1000 / 60;
const DROP_EVERY_FRAMES = 15;
const TAIL_FRAMES = 180;
const TIMED_BEFORE_LAST = 4;
/** Drops stay this far from the walls (px). */
const DROP_MARGIN = 30;
const SEED = 1000;

/** Runs the bench once (synchronously) and returns the step cost. */
export function runStepBench(opts: StepBenchOptions = {}): StepBenchResult {
  const total = opts.pieces ?? 90;
  const now = opts.now ?? (() => performance.now());
  const engine = new CascadeEngine({ bench: { noMerges: true, noLid: true } });
  const rng = createSeededRng(SEED);
  // Room for every timed frame: (TIMED_BEFORE_LAST + 1) drops' worth plus the tail.
  const stats = createFrameStats((TIMED_BEFORE_LAST + 1) * DROP_EVERY_FRAMES + TAIL_FRAMES);
  const span = WORLD_WIDTH - 2 * (WALL_THICKNESS + DROP_MARGIN);
  let dropped = 0;
  let tail = 0;
  for (let f = 0; tail < TAIL_FRAMES; f++) {
    if (dropped < total && f % DROP_EVERY_FRAMES === 0) {
      engine.drop(dropped % 2, WALL_THICKNESS + DROP_MARGIN + rng() * span);
      dropped++;
    }
    const t0 = now();
    engine.step(FRAME_MS);
    const t1 = now();
    if (dropped >= total - TIMED_BEFORE_LAST) recordFrame(stats, t1, t1 - t0);
    if (dropped >= total) tail++;
  }
  const pieces = engine.getState().pieces.length;
  engine.destroy();

  const n = Math.min(stats.frames, stats.frameMs.length);
  const costs = stats.frameMs.slice(0, n).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += costs[i]!;
  return {
    pieces,
    frames: n,
    meanMs: n > 0 ? sum / n : 0,
    p95Ms: percentile(costs, 0.95),
    maxMs: n > 0 ? costs[n - 1]! : 0,
  };
}

/** One line for the dev panel, e.g. `90 pieces · 1.23 ms mean · 2.50 p95 · 4.10 max (240 f)`. */
export function formatStepBench(r: StepBenchResult): string {
  const ms = (x: number) => x.toFixed(2);
  return `${r.pieces} pieces · ${ms(r.meanMs)} ms mean · ${ms(r.p95Ms)} p95 · ${ms(r.maxMs)} max (${r.frames} f)`;
}
