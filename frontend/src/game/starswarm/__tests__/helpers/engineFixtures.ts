/**
 * Shared fixtures for the Star Swarm `engine.<module>.test.ts` files (#2955): inputs, tick
 * drivers and entity factories used by more than one module's tests. Not a test file.
 */
import { tick, CANVAS_W, BEAM_HALF_WIDTH, BEAM_LENGTH, BEAM_SPEED } from "../../engine";
import type { CarrierBeam, StarSwarmInput, StarSwarmState } from "../../types";

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
