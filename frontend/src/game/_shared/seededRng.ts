/**
 * Shared seeded RNG (#2985) — one LCG and one test-seam slot for every engine.
 *
 * The LCG is the classic Numerical Recipes generator
 * `state = (1664525 * state + 1013904223) mod 2^32`, normalised by dividing by
 * 2^32 so a draw is always in [0, 1) — `Math.floor(rng() * n)` can never index
 * out of range. Not cryptographic: deal reproducibility and tests only.
 *
 * `_shared/simRandom.ts` (Mulberry32, sim-only) is deliberately separate.
 */

export type RandomSource = () => number;

/** 2^32 — the LCG state space; dividing by it keeps draws strictly below 1. */
export const LCG_MODULUS = 4294967296;

/** Advance a 32-bit LCG state one step. `Math.imul` keeps the product exact in 32 bits. */
export function lcgNext(state: number): number {
  return (Math.imul(1664525, state) + 1013904223) >>> 0;
}

/** Deterministic generator for a given seed; yields values in [0, 1). */
export function createSeededRng(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = lcgNext(state);
    return state / LCG_MODULUS;
  };
}

export interface RngSlot {
  /** Draw from the currently installed source (stable reference; safe to pass around). */
  rng: RandomSource;
  /** Install a source — tests pin shuffles/rolls with `setRng(createSeededRng(seed))`. */
  setRng: (fn: RandomSource) => void;
  getRng: () => RandomSource;
}

/** A per-engine swappable RNG source. Each engine owns its slot so test seams stay isolated. */
export function createRngSlot(initial: RandomSource = Math.random): RngSlot {
  let current = initial;
  return {
    rng: () => current(),
    setRng: (fn) => {
      current = fn;
    },
    getRng: () => current,
  };
}
