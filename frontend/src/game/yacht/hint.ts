/**
 * The solo Hint (#3748): what the exact optimal-play oracle (`ai.ts`, λ = 1 — optimal play, no
 * slips) would do with the dice on the table. Before the last roll it names the dice to keep;
 * after the third roll, or when the best play is to stop and score, the best row.
 *
 * Pure and deterministic; reads the oracle, changes no state and records nothing (a hint costs
 * nothing, as in 2048). The first call decodes the oracle table (about 400 ms in Jest, more on a
 * phone, once per session): `useYachtHint` warms it with `preloadOracleTable` after the first roll,
 * off the press.
 */

import type { Category } from "./engine";
import type { GameState } from "./types";
import { keptToMask, scoreCategories, scoreHolds } from "./ai";

/** Optimal play: no discount on the value still to come. */
const FORESIGHT = 1;

export type YachtHint =
  /** Keep the dice marked `true` and roll the rest (all `false` = roll all five). */
  | { readonly kind: "hold"; readonly held: readonly boolean[] }
  /** Score the dice now, in this row. */
  | { readonly kind: "score"; readonly category: Category };

/** The best row for the dice on the table (Joker rules included), or null if none is legal. */
export function bestCategory(state: GameState): Category | null {
  let best: Category | null = null;
  let bestValue = -Infinity;
  for (const option of scoreCategories(state, FORESIGHT)) {
    if (option.value > bestValue) {
      best = option.category;
      bestValue = option.value;
    }
  }
  return best;
}

/**
 * The hint for `state`, or null when there is nothing useful to say: before the first roll, with
 * the game over, or if the oracle has no answer.
 */
export function suggestHint(state: GameState): YachtHint | null {
  if (state.game_over || state.rolls_used < 1) return null;
  if (state.rolls_used < 3) {
    // The best hold. A hold that can't beat banking the dice is not a candidate (`dominated`);
    // keeping all five is "stop and score", which ends in the row hint below.
    let best: { kept: readonly number[]; value: number } | null = null;
    for (const hold of scoreHolds(state, FORESIGHT)) {
      if (hold.dominated) continue;
      if (best === null || hold.value > best.value) best = hold;
    }
    if (best !== null && best.kept.length < 5) {
      return { kind: "hold", held: keptToMask(state.dice, best.kept) };
    }
  }
  const category = bestCategory(state);
  return category === null ? null : { kind: "score", category };
}
