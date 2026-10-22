/**
 * #3392: seeded Star Swarm runs for the wave-timeline tests (waveTimeline.capture.test.ts,
 * waveTimeline.invariants.test.ts). Each run is played once per difficulty and recording flag and
 * cached, since a run is a few thousand ticks. Not a test file.
 */
import {
  CANVAS_H,
  CANVAS_W,
  _resetIds,
  engineCounters,
  initStarSwarm,
  tick,
  waveJustClosed,
  type WaveStatsSnapshot,
} from "../../engine";
import type { DifficultyTier, StarSwarmInput, StarSwarmState } from "../../types";

// ---------------------------------------------------------------------------
// Seeded runs: identity, cost, invariants
// ---------------------------------------------------------------------------

/** A seeded stand-in for the engine's unseeded `Math.random` calls. */
export function stubMathRandom(seed: number): jest.SpyInstance {
  let s = seed >>> 0;
  return jest.spyOn(Math, "random").mockImplementation(() => {
    s = (Math.imul(1103515245, s) + 12345) >>> 0;
    return s / 4294967296;
  });
}

/** The golden replay's pilot: a triangle-wave sweep, firing with short lulls (it never dodges). */
export function pilot(t: number): StarSwarmInput {
  const period = 240;
  const phase = t % period;
  const frac = phase < period / 2 ? phase / (period / 2) : 2 - phase / (period / 2);
  return { playerX: 20 + frac * (CANVAS_W - 40), fire: t % 300 < 270 };
}

export interface SeededRun {
  /** The state after every tick, the first state first. */
  readonly states: StarSwarmState[];
  readonly closed: WaveStatsSnapshot[];
  readonly end: StarSwarmState;
  readonly counters: ReturnType<typeof engineCounters>;
}

const TICKS = 6_000;
const runs = new Map<string, SeededRun>();

/** Wave 1 at `difficulty`, 6 lives, the pilot for up to TICKS ticks (each run made once). */
export function seededRun(difficulty: DifficultyTier, timelineOn: boolean): SeededRun {
  const key = `${difficulty}:${timelineOn}`;
  let run = runs.get(key);
  if (!run) runs.set(key, (run = playRun(difficulty, timelineOn, TICKS)));
  return run;
}

function playRun(difficulty: DifficultyTier, timelineOn: boolean, ticks: number): SeededRun {
  _resetIds();
  const random = stubMathRandom(1234);
  try {
    const init = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, difficulty, undefined, undefined, {
      timelineOn,
    });
    let s: StarSwarmState = { ...init, player: { ...init.player, lives: 6 } };
    const states = [s];
    const closed: WaveStatsSnapshot[] = [];
    for (let t = 1; t <= ticks && s.phase !== "GameOver"; t++) {
      const next = tick(s, t % 7 === 6 ? 33 : 16, pilot(t));
      const snap = waveJustClosed(s, next);
      if (snap) closed.push(snap);
      s = next;
      states.push(s);
    }
    return { states, closed, end: s, counters: engineCounters() };
  } finally {
    random.mockRestore();
  }
}
