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
import { createStream, deriveSeed } from "../../_shared/simRandom";

/** Stream tags so dice and noise sub-streams never share a seed. */
export const DICE_TAG = 0x44494345; // "DICE"
export const NOISE_TAG = 0x4e4f4953; // "NOIS"

// The generic hashing and generator helpers are shared with the Hearts
// harness (#2238); re-exported so existing imports keep working.
export { createStream, deriveSeed, mix32 } from "../../_shared/simRandom";

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
