/**
 * #3396: seeded Star Swarm runs for the wave-timeline goldens, the reconciliation invariant and
 * the size measurements (goldenTimelines.test.ts, timelineReconcile.test.ts,
 * timelineSizes.test.ts). Unlike `timelineRuns.seededRun`, a run that starts with more lives
 * than the engine's 3 also opens its first wave's stats with them (`pacing.start.lives`), so the
 * lives arithmetic reconciles on every wave. Not a test file.
 */
import {
  CANVAS_H,
  CANVAS_W,
  _resetIds,
  initStarSwarm,
  tick,
  waveJustClosed,
  type WaveStatsSnapshot,
} from "../../engine";
import type { DifficultyTier, StarSwarmInput, StarSwarmState } from "../../types";
import { pilot, stubMathRandom } from "./timelineRuns";

export interface PlayOptions {
  readonly difficulty: DifficultyTier;
  readonly ticks: number;
  readonly timelineOn?: boolean;
  /** Lives the ship opens with (the wave's stats open with them too). Default 3. */
  readonly lives?: number;
  readonly seed?: number;
  /** The seed of the stand-in for the engine's `Math.random` calls. */
  readonly randomSeed?: number;
  readonly input?: (t: number) => StarSwarmInput;
  /** Applied before the tick of the same index (a test's out-of-tick change). */
  readonly before?: (t: number, s: StarSwarmState) => StarSwarmState;
  /** Applied after each tick; what it returns replaces the state (a pause and restore). */
  readonly after?: (t: number, s: StarSwarmState) => StarSwarmState;
  /** Stop once this holds after a tick (default: the run is over). */
  readonly until?: (s: StarSwarmState) => boolean;
}

export interface PlayedRun {
  readonly end: StarSwarmState;
  /** Every wave close, in order (from `waveJustClosed`, dev repeats included). */
  readonly closes: WaveStatsSnapshot[];
  readonly ticks: number;
}

/** A run opened at wave 1 with `lives`, its first wave's stats opened with them too. */
export function openRun(
  difficulty: DifficultyTier,
  {
    timelineOn = true,
    lives = 3,
    seed = 42,
  }: Pick<PlayOptions, "timelineOn" | "lives" | "seed"> = {}
): StarSwarmState {
  const init = initStarSwarm(CANVAS_W, CANVAS_H, 1, seed, difficulty, undefined, undefined, {
    timelineOn,
  });
  if (lives === init.player.lives) return init;
  const pacing = init.waveStats.pacing;
  return {
    ...init,
    player: { ...init.player, lives },
    waveStats: { ...init.waveStats, pacing: { ...pacing, start: { ...pacing.start, lives } } },
  };
}

/** Plays a seeded run from wave 1 (ids reset, `Math.random` stubbed for the run only). */
export function playRun(o: PlayOptions): PlayedRun {
  _resetIds();
  const random = stubMathRandom(o.randomSeed ?? 1234);
  try {
    let s = openRun(o.difficulty, o);
    const closes: WaveStatsSnapshot[] = [];
    const input = o.input ?? pilot;
    const until = o.until ?? ((x: StarSwarmState) => x.phase === "GameOver");
    let t = 1;
    // a close is seen wherever it happens: in a step (a `clearWave` ticks the extraction out)
    // or in the tick itself
    const step = (prev: StarSwarmState, next: StarSwarmState): StarSwarmState => {
      const snap = waveJustClosed(prev, next);
      if (snap) closes.push(snap);
      return next;
    };
    for (; t <= o.ticks; t++) {
      if (o.before) s = step(s, o.before(t, s));
      s = step(s, tick(s, t % 7 === 6 ? 33 : 16, input(t)));
      if (o.after) s = o.after(t, s); // a restore drops `lastClosedWave`: not a close
      if (until(s)) break;
    }
    return { end: s, closes, ticks: Math.min(t, o.ticks) };
  } finally {
    random.mockRestore();
  }
}

/** The counts presence is checked against, read off the run's end state. */
export function presenceCounts(end: StarSwarmState) {
  const o = end.closedTimelinesOverflow;
  return {
    waves: o.waves,
    clean: o.clean,
    devRepeats: o.devRepeats,
    unrecorded: o.unrecorded,
    summariesDropped: end.closedWavesOverflow.waves,
    recording: end.timelineOn || end.timelineLost,
  };
}
