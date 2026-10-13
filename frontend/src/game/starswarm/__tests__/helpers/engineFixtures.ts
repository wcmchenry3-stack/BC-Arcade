/**
 * Shared fixtures for the Star Swarm `engine.<module>.test.ts` files (#2955): inputs, tick
 * drivers and entity factories used by more than one module's tests. Not a test file.
 */
import {
  tick,
  waveJustClosed,
  CANVAS_W,
  BEAM_HALF_WIDTH,
  BEAM_LENGTH,
  BEAM_SPEED,
  type WaveStatsSnapshot,
} from "../../engine";
import type { Bullet, CarrierBeam, StarSwarmInput, StarSwarmState } from "../../types";

export const NO_INPUT: StarSwarmInput = { playerX: CANVAS_W / 2, fire: false };
export const FIRE_INPUT: StarSwarmInput = { playerX: CANVAS_W / 2, fire: true };

export function advanceMs(state: StarSwarmState, ms: number, input = NO_INPUT): StarSwarmState {
  const step = 16;
  let s = state;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    s = tick(s, Math.min(step, ms - elapsed), input);
  }
  return s;
}

/** #2842: tick through a wave's extraction until the next wave opens (or the game ends). */
export function runExtraction(state: StarSwarmState, input = NO_INPUT): StarSwarmState {
  let s = state;
  const wave = s.wave;
  for (let i = 0; i < 2000 && s.wave === wave && s.phase !== "GameOver"; i++) {
    s = tick(s, 16, input);
  }
  return s;
}

/** #2842: kill every enemy, then fly the extraction out — returns the next wave's first state. */
export function clearWave(state: StarSwarmState, input = NO_INPUT): StarSwarmState {
  const s = { ...state, enemies: state.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
  return runExtraction(tick(s, 16, input), input);
}

/** #2843: a released Carrier beam whose bolt spans `y` (its leading edge 10 px below it). */
export function makeBeam(x: number, y: number, overrides: Partial<CarrierBeam> = {}): CarrierBeam {
  return {
    id: 55_555,
    x,
    y: y + 10,
    vy: BEAM_SPEED,
    length: BEAM_LENGTH,
    halfWidth: BEAM_HALF_WIDTH,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// #3245: per-wave stats scenario builders (waveStats tests and the contract rows)
// ---------------------------------------------------------------------------

/** An enemy bullet sitting on the ship: the next tick's collision pass resolves it. */
export function shotOnShip(state: StarSwarmState): Bullet {
  return {
    id: 98_765,
    x: state.player.x,
    y: state.player.y,
    vx: 0,
    vy: 0,
    owner: "enemy",
    width: 8,
    height: 8,
    damage: 1,
  };
}

/** One tick in which a lethal shot hits a last-life ship with no plating or shield. */
export function killShip(state: StarSwarmState, input = NO_INPUT): StarSwarmState {
  const s: StarSwarmState = {
    ...state,
    player: { ...state.player, lives: 1, hull: 0, invincibleTimer: 0 },
    activePowerUp: null,
    enemyBullets: [shotOnShip(state)],
  };
  return tick(s, 16, input);
}

/** Ticks `state` until its swoop-in is over (combat is live). */
export function untilPlaying(state: StarSwarmState, input = NO_INPUT): StarSwarmState {
  let s = state;
  for (let i = 0; i < 2000 && s.phase === "SwoopIn"; i++) s = tick(s, 16, input);
  return s;
}

/**
 * Applies `step` up to `maxTicks` times (stopping early once it hands back the same state) and
 * returns every wave snapshot `waveJustClosed` saw on the way.
 */
export function closesAlong(
  state: StarSwarmState,
  step: (s: StarSwarmState) => StarSwarmState,
  maxTicks: number
): { end: StarSwarmState; closed: WaveStatsSnapshot[] } {
  const closed: WaveStatsSnapshot[] = [];
  let s = state;
  for (let i = 0; i < maxTicks; i++) {
    const after = step(s);
    const snap = waveJustClosed(s, after);
    if (snap) closed.push(snap);
    if (after === s) break;
    s = after;
  }
  return { end: s, closed };
}

/** The snapshot `clearWave` closes: the wave cleared, extracted, and the next one opened. */
export function clearedSnapshot(state: StarSwarmState, input = NO_INPUT): WaveStatsSnapshot {
  const next = clearWave(state, input);
  if (next.wave !== state.wave + 1 || !next.lastClosedWave) throw new Error("wave didn't close");
  return next.lastClosedWave;
}

/** The snapshot of a wave that ends the run. */
export function diedSnapshot(state: StarSwarmState, input = NO_INPUT): WaveStatsSnapshot {
  const over = killShip(state, input);
  if (over.phase !== "GameOver" || !over.lastClosedWave) throw new Error("run didn't end");
  return over.lastClosedWave;
}
