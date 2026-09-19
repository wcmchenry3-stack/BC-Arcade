/**
 * Yacht oracle — per-state/per-query turn micro-DP (#2243).
 *
 * Shipped: this is the SAME core computation used both by the offline
 * solver (wrapped in a full retrograde sweep over ~786K states,
 * oracleBuild/solver.ts) and by the runtime oracle (evaluated for one live
 * dice roll at a time, oracle.ts's `optimalHoldEVs`/`optimalCategoryEVs`) —
 * sharing it means both call sites are provably consistent, and a runtime
 * hold-EV query is exactly "the same math the table was built with,
 * evaluated fresh for this one roll" rather than a parallel reimplementation.
 *
 * Given a scorecard-state key and a way to look up successor-state VTGs
 * (the shipped table at runtime; the in-progress result array during the
 * offline solve), computes the turn value: roll → (reroll ≤2 times,
 * optimally) → score.
 */

import { legalCategoriesFor, successorAfterScore } from "./stateKey";
import { MULTISETS5, type HoldOption } from "./multisetIndex";

/**
 * rerollsLeft = 0 layer: for each of the 252 possible dice, the value of
 * scoring optimally right now (no more rerolls available).
 */
export function computeArr0(
  key: number,
  getSuccessorVTG: (nextKey: number) => number
): Float64Array {
  const n = MULTISETS5.values.length;
  const arr0 = new Float64Array(n);

  for (let m = 0; m < n; m++) {
    const dice = MULTISETS5.values[m]!;
    const legal = legalCategoriesFor(key, dice);
    let best = -Infinity;
    for (const category of legal) {
      const { scoreDelta, nextKey } = successorAfterScore(key, category, dice);
      const value = scoreDelta + getSuccessorVTG(nextKey);
      if (value > best) best = value;
    }
    // `legal` is only ever empty at a terminal (0-remaining) state, which
    // neither the offline solver nor a live query ever calls this for —
    // defensive fallback only (see oracleBuild/__tests__/solver.test.ts).
    arr0[m] = best === -Infinity ? 0 : best;
  }

  return arr0;
}

/**
 * One reroll layer: for each of the 252 possible dice, the value of the best
 * hold decision, given `source` (the value of each resulting multiset one
 * reroll layer closer to scoring).
 */
export function computeHoldLayer(
  source: Float64Array,
  holdOptions: readonly (readonly HoldOption[])[]
): Float64Array {
  const out = new Float64Array(holdOptions.length);
  for (let m = 0; m < holdOptions.length; m++) {
    let best = -Infinity;
    for (const option of holdOptions[m]!) {
      let ev = 0;
      for (const t of option.transitions) {
        ev += t.weight * source[t.targetIndex]!;
      }
      if (ev > best) best = ev;
    }
    out[m] = best;
  }
  return out;
}

/**
 * Full turn value for `key`: expectation over the mandatory first roll (252
 * outcomes) of the best 2-reroll-then-score play. This is VTG(key) — what
 * the offline solver stores in the shipped table for every reachable state.
 */
export function solveStateVTG(
  key: number,
  holdOptions: readonly (readonly HoldOption[])[],
  getSuccessorVTG: (nextKey: number) => number
): number {
  const arr0 = computeArr0(key, getSuccessorVTG);
  const arr1 = computeHoldLayer(arr0, holdOptions);
  const arr2 = computeHoldLayer(arr1, holdOptions);

  let turnEV = 0;
  for (let m = 0; m < MULTISETS5.values.length; m++) {
    turnEV += MULTISETS5.prob[m]! * arr2[m]!;
  }
  return turnEV;
}
