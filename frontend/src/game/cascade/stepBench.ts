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
 *
 * The merge storm (#4082, `runMergeStormBench`) times the other case: merges on. A pre-built pile
 * (`mergeStormPile`) sets off a burst of about a dozen merges in a few frames, with the grow-ins
 * and the pop impulses they bring, so the step's cost during a big chain can be read the same way.
 */
import { CascadeEngine } from "./engine";
import { FLOOR_THICKNESS, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { tierRadius } from "./tiers";
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

  return { pieces, ...summarize(stats) };
}

/** The timed frames' count, mean, p95 and max, read back from the ring. */
function summarize(
  stats: ReturnType<typeof createFrameStats>
): Pick<StepBenchResult, "frames" | "meanMs" | "p95Ms" | "maxMs"> {
  const n = Math.min(stats.frames, stats.frameMs.length);
  const costs = stats.frameMs.slice(0, n).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += costs[i]!;
  return {
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

/** The merge storm's result: the step cost, and the merges the pile made. */
export interface MergeStormResult extends StepBenchResult {
  /** Merges in the timed frames. */
  readonly merges: number;
  /** The most merges in one frame. */
  readonly peakMergesPerFrame: number;
  /** Frames from the first merge to the last. */
  readonly stormFrames: number;
}

export interface MergeStormOptions {
  /** Frames timed from the restore (default 240: 4 s, the storm and the settle after it). */
  readonly frames?: number;
  /** Clock (ms); `performance.now` by default. */
  readonly now?: () => number;
}

const STORM_FRAMES = 240;
/** The cherry block: columns × rows, centred on the floor. */
const STORM_COLS = 4;
const STORM_ROWS = 4;
/**
 * A tower's tiers, biggest first: `top`, `top - 2`, `top - 4`. The left tower starts at 9 and
 * the right at 8, so all six differ and none of the towers' pieces merge.
 */
const towerTiers = (top: number): number[] => Array.from({ length: 3 }, (_, i) => top - 2 * i);
const STORM_LEFT = towerTiers(9);
const STORM_RIGHT = towerTiers(8);

/** A tower against one wall: pieces of distinct tiers, each on the one below (1 px apart). */
function stormTower(
  tiers: readonly number[],
  side: "left" | "right"
): { tier: number; x: number; y: number }[] {
  const floorY = WORLD_HEIGHT - FLOOR_THICKNESS;
  const out: { tier: number; x: number; y: number }[] = [];
  let prev: { x: number; y: number; r: number } | null = null;
  for (const tier of tiers) {
    const r = tierRadius(tier);
    const x = side === "left" ? WALL_THICKNESS + r : WORLD_WIDTH - WALL_THICKNESS - r;
    let y = floorY - r - 1;
    if (prev) {
      const d = prev.r + r + 1;
      y = prev.y - Math.sqrt(Math.max(0, d * d - (x - prev.x) ** 2));
    }
    out.push({ tier, x, y });
    prev = { x, y, r };
  }
  return out;
}

/**
 * The merge storm's pile (#4082): a tower of distinct tiers against each wall (the mass a late
 * board holds, none of it merging on its own) and, between them on the floor, a block of 16
 * cherries packed in contact. The cherries merge in pairs on the first step (8 merges), the
 * Lychees they make touch and merge, and so on: about 15 merges in a few frames, each with its
 * grow-in, the pop impulse and the pile woken around it. Deterministic: no RNG, no drops.
 */
export function mergeStormPile(): { tier: number; x: number; y: number }[] {
  const floorY = WORLD_HEIGHT - FLOOR_THICKNESS;
  const r = tierRadius(0);
  // Just under a diameter apart: every neighbour's contact begins on the first step.
  const pitch = 2 * r - 0.5;
  const x0 = WORLD_WIDTH / 2 - ((STORM_COLS - 1) * pitch) / 2;
  const cherries: { tier: number; x: number; y: number }[] = [];
  for (let row = 0; row < STORM_ROWS; row++) {
    for (let col = 0; col < STORM_COLS; col++) {
      cherries.push({ tier: 0, x: x0 + col * pitch, y: floorY - r - 1 - row * pitch });
    }
  }
  return [...stormTower(STORM_LEFT, "left"), ...stormTower(STORM_RIGHT, "right"), ...cherries];
}

/**
 * Runs the merge storm once (synchronously): merges on, the lid off, the pile restored, then
 * `frames` frames of `step(1000 / 60)`, each timed into the frameStats ring.
 */
export function runMergeStormBench(opts: MergeStormOptions = {}): MergeStormResult {
  const total = opts.frames ?? STORM_FRAMES;
  const now = opts.now ?? (() => performance.now());
  const engine = new CascadeEngine({ bench: { noLid: true, noDropNudge: true } });
  engine.restore(mergeStormPile(), 0);
  const stats = createFrameStats(total);
  let merges = 0;
  let peak = 0;
  let first = -1;
  let last = -1;
  for (let f = 0; f < total; f++) {
    const t0 = now();
    const { events } = engine.step(FRAME_MS);
    const t1 = now();
    recordFrame(stats, t1, t1 - t0);
    let n = 0;
    for (const ev of events) if (ev.type === "merge") n++;
    if (n > 0) {
      merges += n;
      peak = Math.max(peak, n);
      if (first < 0) first = f;
      last = f;
    }
  }
  const pieces = engine.getState().pieces.length;
  engine.destroy();

  return {
    pieces,
    ...summarize(stats),
    merges,
    peakMergesPerFrame: peak,
    stormFrames: first < 0 ? 0 : last - first + 1,
  };
}

/** One line for the dev panel, e.g. `storm: 15 merges in 30 f · 1.23 ms mean · 2.50 p95 · …`. */
export function formatMergeStorm(r: MergeStormResult): string {
  const ms = (x: number) => x.toFixed(2);
  return `storm: ${r.merges} merges in ${r.stormFrames} f · ${ms(r.meanMs)} ms mean · ${ms(r.p95Ms)} p95 · ${ms(r.maxMs)} max (${r.frames} f)`;
}
