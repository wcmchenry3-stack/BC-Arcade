/**
 * Yacht oracle build — retrograde DP solver (#2243).
 *
 * BUILD-ONLY. Not imported by any app screen/component — the outer
 * retrograde loop (`solveOracle`) is the only genuinely offline-only piece
 * of the oracle: it solves all ~786K states, which takes minutes and must
 * never run on-device. The per-state turn micro-DP it calls
 * (`solveStateVTG`) is shared with the runtime oracle — see
 * `../oracle/microDp.ts`'s module doc.
 *
 * Retrograde ordering: states with fewer remaining categories are solved
 * first (base case: 0 remaining → VTG=0, no more turns), and every state
 * with N remaining only ever looks up successor states with exactly N-1
 * remaining (scoring always fills exactly one more category), so by
 * construction every lookup a state needs is already computed by the time
 * it's visited.
 */

import {
  encodeKey,
  isAllUpperFilled,
  NON_YACHT_CATEGORIES,
  YACHT_OPEN,
  YACHT_FILLED_50,
  YACHT_FILLED_0,
  UPPER_CAP,
  TABLE_SIZE,
} from "../oracle/stateKey";
import { buildHoldOptions } from "../oracle/multisetIndex";
import { solveStateVTG } from "../oracle/microDp";

function popcount12(mask: number): number {
  let c = 0;
  let x = mask;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}

/**
 * Upper bound on the achievable (capped) upper subtotal for a mask's filled
 * upper categories — each filled category can contribute at most 5×faceValue.
 * Used to prune upperCapped slots that are provably unreachable, rather than
 * solving all 64 for every mask regardless of which upper categories are
 * actually filled.
 */
function maxUpperSubtotalForMask(mask: number): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    // indices 0-5 = ones..sixes; face value = i+1
    if (mask & (1 << i)) sum += 5 * (i + 1);
  }
  return Math.min(sum, UPPER_CAP);
}

export interface SolveStats {
  readonly statesComputed: number;
  readonly buildMs: number;
}

export interface SolveResult {
  readonly vtg: Float64Array;
  readonly stats: SolveStats;
}

/**
 * Solve VTG for every reachable state. `onProgress`, if given, is called
 * once per "remaining categories" level (13 calls total, 1-13) — useful for
 * a long-running build script to report progress.
 */
export function solveOracle(
  onProgress?: (remaining: number, statesSoFar: number) => void
): SolveResult {
  const start = Date.now();
  const vtg = new Float64Array(TABLE_SIZE); // zero-initialized; terminal (0-remaining) states stay 0
  const holdOptions = buildHoldOptions();
  let statesComputed = 0;

  const maskBits = NON_YACHT_CATEGORIES.length; // 12
  const maskCount = 1 << maskBits; // 4096

  const solveAndStore = (key: number) => {
    vtg[key] = solveStateVTG(key, holdOptions, (nextKey) => vtg[nextKey]!);
    statesComputed++;
  };

  // remaining=0 is the base case: every terminal key's VTG is already 0
  // (Float64Array default) — nothing to compute.
  for (let remaining = 1; remaining <= 13; remaining++) {
    for (let mask = 0; mask < maskCount; mask++) {
      const openNonYacht = maskBits - popcount12(mask);
      const upperCappedMax = isAllUpperFilled(mask) ? 0 : maxUpperSubtotalForMask(mask);

      // Case A: yacht still open (+1 to remaining).
      if (openNonYacht + 1 === remaining) {
        for (let upperCapped = 0; upperCapped <= upperCappedMax; upperCapped++) {
          solveAndStore(encodeKey(mask, YACHT_OPEN, upperCapped));
        }
      }
      // Case B: yacht already filled, either way (+0 to remaining).
      if (openNonYacht === remaining) {
        for (let upperCapped = 0; upperCapped <= upperCappedMax; upperCapped++) {
          solveAndStore(encodeKey(mask, YACHT_FILLED_50, upperCapped));
          solveAndStore(encodeKey(mask, YACHT_FILLED_0, upperCapped));
        }
      }
    }
    onProgress?.(remaining, statesComputed);
  }

  return { vtg, stats: { statesComputed, buildMs: Date.now() - start } };
}
