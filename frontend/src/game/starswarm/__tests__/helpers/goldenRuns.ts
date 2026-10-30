/**
 * The Star Swarm golden seeded replay's scenarios, pilot and hash (#2955), shared by
 * `goldenReplay.test.ts` (the gameplay and wave fixtures) and `goldenTimelines.test.ts` (#3396, the
 * same replays with the wave timeline on). Moved here unchanged from goldenReplay.test.ts; the
 * contract is that file's header. Not a test file.
 */
import { createHash } from "crypto";
import {
  CANVAS_H,
  CANVAS_W,
  _resetIds,
  applyPowerUp,
  engineCounters,
  initStarSwarm,
  killEscorts,
  throwAsteroid,
  tick,
} from "../../engine";
import type { DifficultyTier, StarSwarmState } from "../../types";

export const CHECKPOINT_EVERY = 100;

export interface Scenario {
  name: string;
  wave: number;
  difficulty: DifficultyTier;
  ticks: number;
  /** Out-of-tick actions GameCanvas can apply between frames, keyed by tick index. */
  actions?: Record<number, (s: StarSwarmState) => StarSwarmState>;
}

export const SCENARIOS: Scenario[] = [
  { name: "wave1-lieutenantJG", wave: 1, difficulty: "LieutenantJG", ticks: 4000 },
  {
    name: "wave3-lieutenant-actions",
    wave: 3,
    difficulty: "Lieutenant",
    ticks: 3000,
    actions: {
      400: (s) => applyPowerUp(s, "buddy"),
      450: (s) => throwAsteroid(s),
      600: (s) => applyPowerUp(s, "salvage"),
      650: (s) => applyPowerUp(s, "hull"),
      800: (s) => applyPowerUp(s, "shield"),
      1000: (s) => throwAsteroid(s),
      1300: (s) => applyPowerUp(s, "lightning"),
      1600: (s) => applyPowerUp(s, "bomb"),
    },
  },
  {
    name: "wave5-boss-carrier",
    wave: 5,
    difficulty: "Commander",
    ticks: 3000,
    actions: { 900: (s) => killEscorts(s) },
  },
];

/**
 * Lives the scripted pilot starts with. It does not dodge, so with the usual 3 it is dead
 * within a wave; a deep reserve lets one replay reach wave clears, extraction and boss waves.
 */
export const PILOT_LIVES = 30;

/** Independent LCG for the engine's two Math.random calls (power-up type and spawn X). */
export function stubMathRandom(seed: number): jest.SpyInstance {
  let s = seed >>> 0;
  return jest.spyOn(Math, "random").mockImplementation(() => {
    s = (Math.imul(1103515245, s) + 12345) >>> 0;
    return s / 4294967296;
  });
}

/** Scripted pilot: a triangle-wave sweep across the canvas, firing except for short lulls. */
export function pilot(t: number): { playerX: number; fire: boolean } {
  const period = 240;
  const phase = t % period;
  const frac = phase < period / 2 ? phase / (period / 2) : 2 - phase / (period / 2);
  return { playerX: 20 + frac * (CANVAS_W - 40), fire: t % 300 < 270 };
}

/** Frame length: mostly 60 fps, with a dropped frame every 7th tick. */
export function dtFor(t: number): number {
  return t % 7 === 6 ? 33 : 16;
}

/** Decimal places kept for non-integer numbers in the hashed state (see the header). */
const HASH_DECIMALS = 1e6;

/**
 * Runtime-independent form of a value: object keys sorted, non-integer finite numbers rounded
 * to 6 decimal places (`-0` folded to `0`), integers and everything else unchanged.
 */
function canonical(v: unknown): unknown {
  if (typeof v === "number") {
    return Number.isFinite(v) && !Number.isInteger(v)
      ? Math.round(v * HASH_DECIMALS) / HASH_DECIMALS + 0
      : v;
  }
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

export function sha(state: StarSwarmState): string {
  // #3245: the per-wave stats are observations of play, not play state; they stay out of the
  // hash so the recorded gameplay stays comparable (#3252 records them in the fixture).
  // #3251: so does the run's list of closed waves.
  // #3392: and the wave timeline, live and closed (#3396 records the timelines in the fixture).
  // #3510: and the run's dev flag, an observation like them.
  const {
    waveStats: _waveStats,
    lastClosedWave: _lastClosedWave,
    closedWaves: _closedWaves,
    closedWavesOverflow: _closedWavesOverflow,
    closedWavesBytes: _closedWavesBytes,
    waveTimeline: _waveTimeline,
    timelineOn: _timelineOn,
    timelineLost: _timelineLost,
    closedTimelines: _closedTimelines,
    closedTimelinesLens: _closedTimelinesLens,
    closedTimelinesBytes: _closedTimelinesBytes,
    closedTimelinesOverflow: _closedTimelinesOverflow,
    devAffected: _devAffected,
    ...rest
  } = state;
  // #3246: likewise a pickup's `source` — a label for the stats, never read by play
  const played = { ...rest, powerUps: rest.powerUps.map(({ source: _source, ...p }) => p) };
  return createHash("sha256")
    .update(JSON.stringify(canonical(played)))
    .digest("hex");
}

export function summary(t: number, s: StarSwarmState) {
  return {
    tick: t,
    phase: s.phase,
    wave: s.wave,
    score: s.score,
    lives: s.player.lives,
    enemies: s.enemies.length,
    asteroids: s.asteroids.length,
    buddies: s.buddyShips.length,
    powerUps: s.powerUps.length,
    carrierStage: s.carrierStage,
    sha256: sha(s),
  };
}

export interface ReplayOptions {
  /** #3396: start the run with the wave timeline on (the run option `timelineOn`). */
  readonly timelineOn?: boolean;
  /**
   * #3396: called after each tick with the tick index and the state; what it returns replaces
   * the state (a pause and restore mid-wave). Identity when absent.
   */
  readonly between?: (t: number, s: StarSwarmState) => StarSwarmState;
}

export function replay(sc: Scenario, { timelineOn = false, between }: ReplayOptions = {}) {
  _resetIds();
  const random = stubMathRandom(1234);
  try {
    const init = timelineOn
      ? initStarSwarm(CANVAS_W, CANVAS_H, sc.wave, 42, sc.difficulty, undefined, undefined, {
          timelineOn,
        })
      : initStarSwarm(CANVAS_W, CANVAS_H, sc.wave, 42, sc.difficulty);
    let s: StarSwarmState = { ...init, player: { ...init.player, lives: PILOT_LIVES } };
    const checkpoints = [summary(0, s)];
    for (let t = 1; t <= sc.ticks; t++) {
      const action = sc.actions?.[t];
      if (action) s = action(s);
      s = tick(s, dtFor(t), pilot(t));
      if (between) s = between(t, s);
      if (t % CHECKPOINT_EVERY === 0 || t === sc.ticks) checkpoints.push(summary(t, s));
    }
    return { recorded: { name: sc.name, checkpoints, counters: engineCounters() }, end: s };
  } finally {
    random.mockRestore();
  }
}
