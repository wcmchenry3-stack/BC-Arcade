/**
 * Shared scoring helpers for Yacht AI modules (GH #2025, story A1).
 *
 * Extracted from ai.ts / probTables.ts so both share one implementation and
 * remain in sync when scoring rules change.
 */

import { GameState } from "./types";
import { CATEGORIES, UPPER_CATEGORIES, calculateScore } from "./engine";

function upperSubtotal(scores: GameState["scores"]): number {
  let s = 0;
  for (const cat of UPPER_CATEGORIES) {
    const v = scores[cat];
    if (v !== null && v !== undefined) s += v;
  }
  return s;
}

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

/**
 * Brute-force expected score when `keptIndices` dice are held and the rest are
 * rerolled once.  Enumerates all 6^(free) outcomes — tractable when free ≤ 5.
 *
 * Exported for parity tests in probTables.test.ts. Do NOT use at runtime; the
 * precomputed prob-table functions (evForHold1Roll / evForHold2Roll) are faster.
 */
export function evForHold(
  dice: readonly number[],
  keptIndices: readonly number[],
  scores: GameState["scores"]
): number {
  const keptValues = keptIndices.map((i) => dice[i]!);
  const freeCount = 5 - keptIndices.length;
  const curUpperSubtotal = upperSubtotal(scores);
  if (freeCount === 0) return maxImmediateScore(keptValues, scores, curUpperSubtotal);

  const outcomes = Math.pow(6, freeCount);
  let total = 0;

  for (let mask = 0; mask < outcomes; mask++) {
    const freeRoll: number[] = [];
    let rem = mask;
    for (let j = 0; j < freeCount; j++) {
      freeRoll.push((rem % 6) + 1);
      rem = Math.floor(rem / 6);
    }
    total += maxImmediateScore([...keptValues, ...freeRoll], scores, curUpperSubtotal);
  }

  return total / outcomes;
}
