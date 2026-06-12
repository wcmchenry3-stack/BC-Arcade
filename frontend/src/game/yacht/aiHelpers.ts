/**
 * Shared scoring helpers for Yacht AI modules (GH #2025, story A1).
 *
 * Extracted from ai.ts / probTables.ts so both share one implementation and
 * remain in sync when scoring rules change.
 */

import { GameState } from "./types";
import { CATEGORIES, UPPER_CATEGORIES, calculateScore } from "./engine";

const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS_VALUE = 35;

/**
 * Maximum score available right now across all open categories.
 *
 * Upper-section scores that would push the running subtotal from below 63
 * to ≥ 63 receive a +35 bonus credit.  The `curUpperSubtotal < 63` guard
 * prevents crediting the bonus a second time when it is already earned.
 */
export function maxImmediateScore(
  dice: readonly number[],
  scores: GameState["scores"],
  curUpperSubtotal: number
): number {
  let best = 0;
  for (const cat of CATEGORIES) {
    const v = scores[cat];
    if (v !== null && v !== undefined) continue;
    const s = calculateScore(cat, dice);
    const bonusCredit =
      UPPER_CATEGORIES.has(cat) &&
      s > 0 &&
      curUpperSubtotal < UPPER_BONUS_THRESHOLD &&
      curUpperSubtotal + s >= UPPER_BONUS_THRESHOLD
        ? UPPER_BONUS_VALUE
        : 0;
    if (s + bonusCredit > best) best = s + bonusCredit;
  }
  return best;
}
