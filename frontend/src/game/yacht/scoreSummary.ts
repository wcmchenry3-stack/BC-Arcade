/**
 * Small pure helpers for the Yacht screen's wording and highlights (#3748), kept out of the
 * screen so they can be tested on their own.
 */

import type { GameState } from "./types";

/**
 * The best open row by points on the table now (a boxed potential on the scorecard), or null
 * when every potential is 0: there is nothing worth marking. The first of equals wins.
 */
export function bestPotentialKey(
  potentials: Readonly<Record<string, number>>,
  order: readonly string[]
): string | null {
  let best: string | null = null;
  let bestValue = 0;
  for (const key of order) {
    const v = potentials[key];
    if (v !== undefined && v > bestValue) {
      best = key;
      bestValue = v;
    }
  }
  return best;
}

export type SoloSubtitle =
  | { readonly kind: "yachtBonus"; readonly count: number; readonly total: number }
  | { readonly kind: "yachtScored"; readonly score: number }
  | { readonly kind: "upperBonus" }
  | null;

/**
 * What a finished solo game's card brags about, rarest first: Yacht bonuses (a further five of a
 * kind, 100 each), then a Yacht scored in its row, then the upper bonus. A scored Yacht was
 * once outranked by "+35 Upper Bonus included!" (audit bug 12).
 */
export function soloSubtitle(state: GameState): SoloSubtitle {
  if (state.yacht_bonus_total > 0) {
    return { kind: "yachtBonus", count: state.yacht_bonus_count, total: state.yacht_bonus_total };
  }
  const yachtScore = state.scores["yacht"];
  if (yachtScore != null && yachtScore > 0) return { kind: "yachtScored", score: yachtScore };
  if (state.upper_bonus > 0) return { kind: "upperBonus" };
  return null;
}
