/**
 * Yacht consideration evaluators (GH #2026, story A2).
 *
 * Pure functions — no React, no IO, no Math.random, no Date.now.
 * Each accepts the info set (from #2025) plus a candidate action and returns
 * a normalized score in [0.0, 1.0].  Consumed by the weight broker + selector
 * (story A3).
 *
 * Hold considerations (action = YachtHoldAction):
 *   rateUpperBonusUrgency  — how well this hold pursues the upper-section bonus
 *   rateEVOfHold           — expected value of this hold, via the prob tables
 *
 * Score considerations (action = YachtScoreAction):
 *   rateScorecardSafety    — 0 for filled categories, 1 for open
 *   rateChanceSafetyValve  — penalises burning Chance early in the game
 *   rateAdversarialVariance — boost high-variance plays when trailing, low when leading
 */

import type { YachtInfoSet } from "./aiInfoSet";
import type { Category } from "./engine";
import type { GameState } from "./types";
import { evForHold1Roll, evForHold2Roll } from "./probTables";

// ─── Action types ─────────────────────────────────────────────────────────────

/** A hold decision: parallel boolean array indicating which of the 5 dice to keep. */
export type YachtHoldAction = readonly boolean[];

/** A score decision: which category to score into this turn. */
export type YachtScoreAction = Category;

// ─── Constants ────────────────────────────────────────────────────────────────

const FACE_TO_UPPER_CAT: Readonly<Record<number, Category>> = {
  1: "ones",
  2: "twos",
  3: "threes",
  4: "fours",
  5: "fives",
  6: "sixes",
};

/** Upper categories searched in descending value order to find a filled slot quickly. */
const UPPER_ORDER: readonly Category[] = ["sixes", "fives", "fours", "threes", "twos", "ones"];

/** Max attainable score from one category in a single turn (yacht = 50). */
const MAX_TURN_EV = 50;

const TRAIL_THRESHOLD = -20;
const LEAD_THRESHOLD = 50;
const NEUTRAL = 0.5;

/**
 * Subjective variance level per scoring category.
 * Decomposed from the trailing/leading heuristics in `scoreHard` (ai.ts).
 * Upper categories default to UPPER_CAT_VARIANCE (steady, low-risk).
 */
const CATEGORY_VARIANCE: Partial<Record<Category, number>> = {
  yacht: 1.0,
  large_straight: 0.85,
  four_of_a_kind: 0.75,
  small_straight: 0.70,
  full_house: 0.65,
  three_of_a_kind: 0.45,
  chance: 0.35,
};
const UPPER_CAT_VARIANCE = 0.25;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a minimal `GameState["scores"]`-compatible object from an info set so
 * that `evForHold1Roll` / `evForHold2Roll` can be called directly.
 *
 * Open categories → null; filled categories → 0.
 *
 * The functions in probTables.ts compute the running upper subtotal from the
 * scores map to decide whether a roll would earn the bonus.  Since we don't
 * carry per-category values in the info set, we assign the full `upperSubtotal`
 * to the first filled upper category we find.  `maxImmediateScore` skips all
 * non-null entries for scoring (it only cares about nullness), so only the SUM
 * matters — not which slot holds it.
 */
function buildEVScores(infoSet: YachtInfoSet): GameState["scores"] {
  const scores: GameState["scores"] = {};
  for (const cat of infoSet.openCategories) scores[cat] = null;
  for (const cat of infoSet.filledCategories) scores[cat] = 0;

  if (infoSet.upperSubtotal > 0) {
    for (const cat of UPPER_ORDER) {
      if (infoSet.filledCategories.has(cat)) {
        scores[cat] = infoSet.upperSubtotal;
        break;
      }
    }
  }

  return scores;
}

// ─── Hold considerations ──────────────────────────────────────────────────────

/**
 * Rate how well this hold pattern pursues the upper-section bonus.
 *
 * Returns the fraction of the remaining bonus gap covered by the best
 * mono-face upper group in the held dice.  1.0 when the held dice alone
 * accumulate enough of an open upper face to close the bonus on the NEXT
 * scoring decision (heldCount × faceValue ≥ toBonus).  0 when the bonus is
 * already earned, unreachable, or no held dice target an open upper category.
 */
export function rateUpperBonusUrgency(infoSet: YachtInfoSet, holdMask: YachtHoldAction): number {
  if (infoSet.bonusEarned || infoSet.bonusUnreachable || infoSet.toBonus === 0) return 0;

  const heldFaceCounts = new Map<number, number>();
  for (let i = 0; i < infoSet.dice.length; i++) {
    if (holdMask[i]) {
      const face = infoSet.dice[i]!;
      heldFaceCounts.set(face, (heldFaceCounts.get(face) ?? 0) + 1);
    }
  }

  let bestProgress = 0;
  for (const [face, cnt] of heldFaceCounts) {
    const cat = FACE_TO_UPPER_CAT[face];
    if (!cat || !infoSet.openCategories.has(cat)) continue;
    const progress = (cnt * face) / infoSet.toBonus;
    if (progress > bestProgress) bestProgress = progress;
  }

  return Math.min(1.0, bestProgress);
}

/**
 * Rate the expected value of this hold mask, normalised to [0, 1].
 *
 * Delegates to the precomputed prob-table functions from #2025:
 * - rollsRemaining ≤ 1 → exact 1-roll EV
 * - rollsRemaining ≥ 2 → hold-fixed 2-roll approximation (monotone: 2-roll ≥ 1-roll)
 *
 * Normalised by MAX_TURN_EV (50 pts); clamped to 1.0 for the rare case where
 * bonus credit pushes the EV above 50.
 */
export function rateEVOfHold(infoSet: YachtInfoSet, holdMask: YachtHoldAction): number {
  const keptValues = infoSet.dice.filter((_, i) => holdMask[i]);
  const freeCount = holdMask.filter((h) => !h).length;
  const scores = buildEVScores(infoSet);

  const ev =
    infoSet.rollsRemaining <= 1
      ? evForHold1Roll(keptValues, freeCount, scores)
      : evForHold2Roll(keptValues, freeCount, scores);

  return Math.min(1.0, ev / MAX_TURN_EV);
}

// ─── Score considerations ─────────────────────────────────────────────────────

/**
 * State-availability coefficient: 1.0 if the category is open, 0.0 if filled.
 *
 * A zero here zeroes out the entire weighted-sum score for a closed category,
 * preventing the weight broker from ever selecting an illegal move.
 */
export function rateScorecardSafety(infoSet: YachtInfoSet, category: YachtScoreAction): number {
  return infoSet.openCategories.has(category) ? 1.0 : 0.0;
}

/**
 * Rate the desirability of scoring `category` from a Chance-preservation
 * perspective.
 *
 * Chance is a high-value safety valve: it scores whatever the dice sum to,
 * making it a reliable last resort when no category fits well.  Burning it
 * early wastes that insurance.
 *
 * Returns 1.0 when the action is not Chance (no safety concern).
 * When scoring Chance: rises linearly from 0 (first turn — don't burn it) to
 * 1 (last turn — must use it now).
 */
export function rateChanceSafetyValve(
  infoSet: YachtInfoSet,
  category: YachtScoreAction
): number {
  if (category !== "chance" || !infoSet.openCategories.has("chance")) return 1.0;
  return Math.max(0, (13 - infoSet.categoriesRemaining) / 12);
}

/**
 * Rate this scoring action for adversarial variance appropriateness.
 *
 * Trailing (scoreDelta ≤ −20): high-variance categories score near 1.0 — take
 *   the gamble to close the gap.
 * Leading (scoreDelta ≥ +50): low-variance categories score near 1.0 — lock in
 *   points, protect the lead.
 * Neutral (delta ≈ 0): all categories return 0.5 (no directional preference).
 *
 * Between the thresholds, the score interpolates smoothly.  Category variance
 * levels are decomposed from the trailing/leading heuristics in `scoreHard`.
 */
export function rateAdversarialVariance(
  infoSet: YachtInfoSet,
  category: YachtScoreAction
): number {
  const delta = infoSet.scoreDelta;
  const variance = CATEGORY_VARIANCE[category] ?? UPPER_CAT_VARIANCE;

  if (delta <= TRAIL_THRESHOLD) return variance;
  if (delta >= LEAD_THRESHOLD) return 1.0 - variance;

  if (delta < 0) {
    const t = delta / TRAIL_THRESHOLD;
    return NEUTRAL + t * (variance - NEUTRAL);
  } else {
    const t = delta / LEAD_THRESHOLD;
    return NEUTRAL + t * (1.0 - variance - NEUTRAL);
  }
}
