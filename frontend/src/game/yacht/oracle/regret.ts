/**
 * Yacht AI regret metric (#2244) — per-decision EV-loss vs the optimal oracle.
 *
 * Win rate says who won; it says nothing about how well either side played,
 * especially in a dice game where a bot can win on luck while playing badly
 * or lose while playing perfectly. This module scores individual decisions:
 * for a hold or category choice, "EV-loss" (regret) is `optimalEV - chosenEV`,
 * computed against the exact ground-truth oracle (#2243) — the Yacht
 * analogue of chess's average centipawn loss. Unlike Hearts (#2239), no
 * approximate reference is needed here: the oracle is exact, so this regret
 * is ground truth, not an estimate.
 *
 * Split into a pure core (`holdEvLoss` / `categoryEvLoss`, operating on
 * already-computed EV data) and thin async wrappers (`computeHoldEvLoss` /
 * `computeCategoryEvLoss`) that fetch that data from `oracle.ts`. The pure
 * core is what unit tests exercise directly — fixed EV fixtures, no oracle
 * table mocking needed — and the async wrappers are what the simulator calls.
 *
 * Pure module except for the two oracle-querying wrappers: no React, no
 * Math.random, no Date.now.
 */

import type { Category } from "../engine";
import type { GameState } from "../types";
import { keyOf } from "./multisetIndex";
import { optimalCategoryEVs, optimalHoldEVs, type HoldEV } from "./oracle";

// ---------------------------------------------------------------------------
// Blunder bands
// ---------------------------------------------------------------------------

/**
 * EV-loss thresholds (in points) separating "minor" / "mistake" / "blunder".
 * Documented, adjustable — see docs/TESTING.md for how these are read.
 */
export interface EvLossBands {
  /** Upper bound (exclusive) of the "minor" band. */
  readonly minor: number;
  /** Upper bound (inclusive) of the "mistake" band; anything above is "blunder". */
  readonly mistake: number;
}

/** optimal: loss <= 0. minor: 0 < loss < 1. mistake: 1 <= loss <= 5. blunder: loss > 5. */
export const DEFAULT_EV_LOSS_BANDS: EvLossBands = { minor: 1, mistake: 5 };

export type EvLossBand = "optimal" | "minor" | "mistake" | "blunder";

/**
 * Band a raw EV-loss value.
 *
 * `loss <= 0` is "optimal" — no epsilon fuzz needed. `holdEvLoss`/`categoryEvLoss`
 * derive `chosenEV` and `optimalEV` from the SAME computed EV array (one is a
 * lookup, the other a max over that array), so a truly-optimal choice always
 * nets an exact `0.0`, not float noise near zero.
 */
export function bandForLoss(loss: number, bands: EvLossBands = DEFAULT_EV_LOSS_BANDS): EvLossBand {
  if (loss <= 0) return "optimal";
  if (loss < bands.minor) return "minor";
  if (loss <= bands.mistake) return "mistake";
  return "blunder";
}

// ---------------------------------------------------------------------------
// Shared result shape
// ---------------------------------------------------------------------------

export type YachtDecisionType = "hold" | "category";

interface EvLossBase {
  readonly evLoss: number;
  readonly band: EvLossBand;
  readonly optimalEV: number;
  readonly chosenEV: number;
}

/** Regret for one hold decision, including both the chosen and optimal holds (for blunder-tail reporting). */
export interface HoldEvLossResult extends EvLossBase {
  readonly decisionType: "hold";
  readonly chosenHold: readonly number[];
  readonly optimalHold: readonly number[];
}

/** Regret for one category decision, including both the chosen and optimal categories. */
export interface CategoryEvLossResult extends EvLossBase {
  readonly decisionType: "category";
  readonly chosenCategory: Category;
  readonly optimalCategory: Category;
}

export type EvLossResult = HoldEvLossResult | CategoryEvLossResult;

// ---------------------------------------------------------------------------
// Hold decisions
// ---------------------------------------------------------------------------

/**
 * Sorted kept dice values for a boolean hold mask (parallel to `dice`),
 * matching `HoldEV.hold`'s convention (`optimalHoldEVs` in ./oracle.ts).
 */
export function keptValuesFromHold(
  dice: readonly number[],
  held: readonly boolean[]
): readonly number[] {
  const kept: number[] = [];
  for (let i = 0; i < dice.length; i++) {
    if (held[i]) kept.push(dice[i]!);
  }
  return kept.sort((a, b) => a - b);
}

/**
 * Pure core: EV-loss of `chosenHold` against a precomputed set of hold EVs
 * (from `optimalHoldEVs`, or a hand-built fixture in tests).
 *
 * `holdEVs` entries are keyed by kept dice *values*, not positions — matching
 * `multisetIndex.ts`'s dedup-by-sub-multiset convention (holding "either" of
 * two equal dice is the same decision), so `chosenHold`'s position mask is
 * converted to the same value-multiset representation before matching, using
 * `multisetIndex.ts`'s own `keyOf` so this stays in sync with the canonical
 * dice-multiset key format if it ever changes.
 */
export function holdEvLoss(
  holdEVs: readonly HoldEV[],
  dice: readonly number[],
  chosenHold: readonly boolean[],
  bands: EvLossBands = DEFAULT_EV_LOSS_BANDS
): HoldEvLossResult {
  const chosenValues = keptValuesFromHold(dice, chosenHold);
  const chosenKey = keyOf(chosenValues);

  let chosenEV: number | undefined;
  let optimalEV = -Infinity;
  let optimalHold: readonly number[] = [];
  for (const option of holdEVs) {
    if (keyOf(option.hold) === chosenKey) chosenEV = option.ev;
    if (option.ev > optimalEV) {
      optimalEV = option.ev;
      optimalHold = option.hold;
    }
  }
  if (chosenEV === undefined) {
    throw new Error(
      `holdEvLoss: chosen hold ${JSON.stringify(chosenValues)} is not among the ${holdEVs.length} legal hold options`
    );
  }

  const evLoss = optimalEV - chosenEV;
  return {
    decisionType: "hold",
    evLoss,
    band: bandForLoss(evLoss, bands),
    optimalEV,
    chosenEV,
    chosenHold: chosenValues,
    optimalHold,
  };
}

/** Async wrapper: queries the oracle for `optimalHoldEVs`, then delegates to `holdEvLoss`. */
export async function computeHoldEvLoss(
  state: GameState,
  dice: readonly number[],
  rerollsLeft: 1 | 2,
  chosenHold: readonly boolean[],
  bands: EvLossBands = DEFAULT_EV_LOSS_BANDS
): Promise<HoldEvLossResult> {
  const holdEVs = await optimalHoldEVs(state, dice, rerollsLeft);
  return holdEvLoss(holdEVs, dice, chosenHold, bands);
}

// ---------------------------------------------------------------------------
// Category decisions
// ---------------------------------------------------------------------------

/** Pure core: EV-loss of `chosenCategory` against a precomputed category-EV map. */
export function categoryEvLoss(
  categoryEVs: Partial<Record<Category, number>>,
  chosenCategory: Category,
  bands: EvLossBands = DEFAULT_EV_LOSS_BANDS
): CategoryEvLossResult {
  const chosenEV = categoryEVs[chosenCategory];
  if (chosenEV === undefined) {
    throw new Error(`categoryEvLoss: "${chosenCategory}" is not among the legal categories`);
  }

  let optimalEV = -Infinity;
  let optimalCategory: Category = chosenCategory;
  for (const [cat, ev] of Object.entries(categoryEVs) as [Category, number | undefined][]) {
    if (ev !== undefined && ev > optimalEV) {
      optimalEV = ev;
      optimalCategory = cat;
    }
  }

  const evLoss = optimalEV - chosenEV;
  return {
    decisionType: "category",
    evLoss,
    band: bandForLoss(evLoss, bands),
    optimalEV,
    chosenEV,
    chosenCategory,
    optimalCategory,
  };
}

/** Async wrapper: queries the oracle for `optimalCategoryEVs`, then delegates to `categoryEvLoss`. */
export async function computeCategoryEvLoss(
  state: GameState,
  dice: readonly number[],
  chosenCategory: Category,
  bands: EvLossBands = DEFAULT_EV_LOSS_BANDS
): Promise<CategoryEvLossResult> {
  const categoryEVs = await optimalCategoryEVs(state, dice);
  return categoryEvLoss(categoryEVs, chosenCategory, bands);
}
