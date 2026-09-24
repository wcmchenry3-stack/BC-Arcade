/**
 * Seeded random streams for the Yacht simulation harness (#2245).
 *
 * The old simulators seeded one engine-level LCG per game and let both
 * players draw from it in turn order, so one player's reroll count shifted
 * every die the other player saw afterwards. This module gives each player
 * its own streams instead:
 *
 * - Dice come from a per-(stream, round) table: roll k of round r always
 *   rerolls slot i to `table[k][i]`, regardless of what the opponent did or
 *   how many rerolls this player used in earlier rounds. Two policies handed
 *   the same stream therefore face the same random numbers at the same
 *   decision points (common random numbers), which is what makes the
 *   harness's mirrored-dice mode a real variance-reduction tool.
 * - AI cognitive noise (`ai.ts` draws it from `getRng()`) gets its own
 *   per-(stream, round) sub-stream, so noise consumption never shifts dice.
 *
 * Seeds are derived by hashing, not by adding offsets: with the engine's LCG
 * (`createSeededRng`), seeds s and s+1 produce first draws that correlate at
 * ~0.998 (the same first die face ~99.8% of the time) and second draws at
 * ~0.5, so the old simulators' `seedOffset + i` games were not independent
 * samples.
 */

import type { RandomSource } from "../engine";

const GOLDEN = 0x9e3779b9;

/** Stream tags so dice and noise sub-streams never share a seed. */
export const DICE_TAG = 0x44494345; // "DICE"
export const NOISE_TAG = 0x4e4f4953; // "NOIS"

/** MurmurHash3 32-bit finalizer — a cheap, well-mixed bijection on uint32. */
export function mix32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash an ordered list of integers into one uint32 seed. */
export function deriveSeed(...parts: readonly number[]): number {
  let h = GOLDEN;
  for (const part of parts) {
    h = mix32((h ^ mix32(part)) + GOLDEN);
  }
  return h;
}

/** Mulberry32: small, fast, full-period 32-bit generator. Testing only. */
export function createStream(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The 3 × 5 dice table for one player's turn: row k is used for roll k
 * (0 = opening roll, 1-2 = rerolls), column i for die slot i.
 */
export function turnDiceTable(streamSeed: number, round: number): number[][] {
  const rng = createStream(deriveSeed(streamSeed, DICE_TAG, round));
  const table: number[][] = [];
  for (let k = 0; k < 3; k++) {
    const row: number[] = [];
    for (let i = 0; i < 5; i++) row.push(1 + Math.floor(rng() * 6));
    table.push(row);
  }
  return table;
}

/** The AI-noise stream for one player's turn. */
export function turnNoiseStream(streamSeed: number, round: number): RandomSource {
  return createStream(deriveSeed(streamSeed, NOISE_TAG, round));
}
