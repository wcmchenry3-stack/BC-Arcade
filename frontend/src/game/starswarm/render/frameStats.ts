/**
 * #2567 (epic #2562, phase 5): frame-time and React-commit sampling for the native canvas.
 *
 * The RAF loop records each frame's interval and `GameCanvas` records each React commit into
 * fixed-size ring buffers — no allocation per frame. `summarizeFrameStats` reads the last second
 * for the on-screen "Frame" readout (polled at 4 Hz, never per frame) and the
 * `__starswarm_getRunStats` test hook.
 *
 * Pure and React-free, so the maths is unit-tested.
 */

/** Ring size: more than a second of frames at 120 Hz, and of commits at any sane rate. */
export const FRAME_STATS_CAPACITY = 256;

/** The window the readout summarizes. */
export const FRAME_STATS_WINDOW_MS = 1000;

export interface FrameStats {
  /** When each frame was recorded (ms, `performance.now()` clock). */
  readonly frameAt: Float64Array;
  /** Each frame's interval since the previous one (ms), uncapped. */
  readonly frameMs: Float64Array;
  /** Total frames recorded; the next slot is `frames % capacity`. */
  frames: number;
  /** When each React commit happened (ms). */
  readonly commitAt: Float64Array;
  commits: number;
}

export interface FrameStatsSummary {
  /** Mean frame interval over the window, ms. */
  readonly avgMs: number;
  /** 95th-percentile frame interval over the window (nearest rank), ms. */
  readonly p95Ms: number;
  /** Frames in the window. */
  readonly frames: number;
  /** React commits of the canvas per second over the window. */
  readonly commitsPerSec: number;
}

export function createFrameStats(capacity = FRAME_STATS_CAPACITY): FrameStats {
  return {
    frameAt: new Float64Array(capacity),
    frameMs: new Float64Array(capacity),
    frames: 0,
    commitAt: new Float64Array(capacity),
    commits: 0,
  };
}

/** Record one RAF frame: `now` on the `performance.now()` clock, `intervalMs` since the last. */
export function recordFrame(stats: FrameStats, now: number, intervalMs: number): void {
  const i = stats.frames % stats.frameAt.length;
  stats.frameAt[i] = now;
  stats.frameMs[i] = intervalMs;
  stats.frames++;
}

/** Record one React commit of the canvas. */
export function recordCommit(stats: FrameStats, now: number): void {
  stats.commitAt[stats.commits % stats.commitAt.length] = now;
  stats.commits++;
}

/** Nearest-rank percentile of an ascending-sorted array; `p` in (0, 1]. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

/** Newest-first walk over a ring, stopping at the first entry older than `since`. */
function countSince(at: Float64Array, total: number, since: number): number {
  const n = Math.min(total, at.length);
  let count = 0;
  for (let k = 0; k < n; k++) {
    const i = (total - 1 - k) % at.length;
    if ((at[i] ?? -Infinity) <= since) break;
    count++;
  }
  return count;
}

/**
 * The last `windowMs` of frames and commits as of `now`, or null before any frame lands in it
 * (a backgrounded app, or a canvas that has not started).
 */
export function summarizeFrameStats(
  stats: FrameStats,
  now: number,
  windowMs = FRAME_STATS_WINDOW_MS
): FrameStatsSummary | null {
  const since = now - windowMs;
  const n = countSince(stats.frameAt, stats.frames, since);
  if (n === 0) return null;
  const cap = stats.frameAt.length;
  const window = new Float64Array(n); // read side only, 4 Hz — the record side never allocates
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const v = stats.frameMs[(stats.frames - 1 - k) % cap] ?? 0;
    window[k] = v;
    sum += v;
  }
  window.sort();
  const commits = countSince(stats.commitAt, stats.commits, since);
  return {
    avgMs: sum / n,
    p95Ms: percentile(window, 0.95),
    frames: n,
    commitsPerSec: (commits * 1000) / windowMs,
  };
}

/** One line for the on-screen readout, e.g. `16.7 ms avg · 18.2 p95 · 60 f · 2 commits/s`. */
export function formatFrameStats(s: FrameStatsSummary | null): string {
  if (!s) return "frame: no samples";
  const ms = (x: number) => x.toFixed(1);
  const commits = Number.isInteger(s.commitsPerSec)
    ? String(s.commitsPerSec)
    : s.commitsPerSec.toFixed(1);
  return `${ms(s.avgMs)} ms avg · ${ms(s.p95Ms)} p95 · ${s.frames} f · ${commits} commits/s`;
}
