/**
 * Yacht AI engine — hold and score strategies for Easy / Medium / Hard.
 *
 * Utility AI: state parser → consideration evaluators [0,1] → per-difficulty
 * weight broker → decision selector + cognitive noise.
 *
 * Win-rate targets (calibrated with YACHT_SIM_FULL):
 *   Easy   ~65%  — greedy/reactive; 25% cognitive noise
 *   Medium ~50%  — balanced hold/score weighting; 10% cognitive noise
 *   Hard   ~35%  — EV-dominant hold, adversarial score; no noise
 */

import { AiDifficulty, GameState } from "./types";
import { Category, possibleScores, getRng } from "./engine";
import { buildYachtInfoSet, type YachtInfoSet } from "./aiInfoSet";
import {
  rateUpperBonusUrgency,
  rateEVOfHold,
  rateScorecardSafety,
  rateImmediateValue,
  rateChanceSafetyValve,
  rateAdversarialVariance,
  rateUpperCategoryEfficiency,
  type YachtHoldAction,
} from "./aiConsiderations";
import {
  EASY_HOLD_WEIGHTS,
  MEDIUM_HOLD_WEIGHTS,
  HARD_HOLD_WEIGHTS,
  EASY_SCORE_WEIGHTS,
  MEDIUM_SCORE_WEIGHTS,
  HARD_SCORE_WEIGHTS,
  NOISE_RATE,
  type HoldWeights,
} from "./aiWeights";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function maskToBools(mask: number): boolean[] {
  return [!!(mask & 1), !!(mask & 2), !!(mask & 4), !!(mask & 8), !!(mask & 16)];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pure, noise-free hold selection: the hold mask with the highest weighted-sum
 * score under `weights`. Extracted out of `holdStrategy` so the regret
 * simulator (#2244) can compute a diagnostic "what would this weight map
 * choose with cognitive noise disabled" decision using the exact same scoring
 * logic the live AI uses, rather than a reimplementation that could quietly
 * drift from it.
 */
export function bestHoldMask(infoSet: YachtInfoSet, weights: HoldWeights): boolean[] {
  let bestMask = 0;
  let bestScore = -Infinity;
  for (let mask = 0; mask < 32; mask++) {
    const holdMask: YachtHoldAction = maskToBools(mask);
    const s =
      weights.upperBonusUrgency * rateUpperBonusUrgency(infoSet, holdMask) +
      weights.evOfHold * rateEVOfHold(infoSet, holdMask);
    if (s > bestScore) {
      bestScore = s;
      bestMask = mask;
    }
  }
  return maskToBools(bestMask);
}

/**
 * Returns which dice the AI should hold before its next roll.
 *
 * Call after each roll (when state.rolls_used is 1 or 2). Returns a boolean[]
 * parallel to state.dice — true means keep that die.
 */
export function holdStrategy(state: GameState, difficulty: AiDifficulty): boolean[] {
  const infoSet = buildYachtInfoSet(state, 0);
  const weights =
    difficulty === "easy"
      ? EASY_HOLD_WEIGHTS
      : difficulty === "medium"
        ? MEDIUM_HOLD_WEIGHTS
        : HARD_HOLD_WEIGHTS;

  const best = bestHoldMask(infoSet, weights);

  const noiseRate = NOISE_RATE[difficulty];
  if (noiseRate > 0) {
    const rng = getRng();
    if (rng() < noiseRate) {
      return maskToBools(Math.floor(rng() * 32));
    }
  }

  return best;
}

/**
 * Returns the category the AI should score into.
 *
 * Call when the AI decides to stop rolling (rolls_used >= 3 or elects to bank).
 * Uses engine.possibleScores() as the legal move set — this enforces Joker
 * priority rules automatically, preventing illegal category selections.
 * `opponentScore` is the human player's current total, used by Hard for
 * adversarial awareness (high-variance plays when trailing, conservative when
 * leading). `opponentRound` is the opponent's current round number — pass it
 * whenever it's known so adversarial scoring can tell a "moving first this
 * round" turn from a "moving second" one instead of always comparing against
 * a stale snapshot (GH #2200); omit it only for solo play / callers with no
 * opponent turn-order tracking.
 */
export function scoreStrategy(
  state: GameState,
  difficulty: AiDifficulty,
  opponentScore = 0,
  opponentRound?: number
): Category {
  const infoSet = buildYachtInfoSet(state, opponentScore, opponentRound);
  const legalCats = Object.keys(possibleScores(state)) as Category[];
  const weights =
    difficulty === "easy"
      ? EASY_SCORE_WEIGHTS
      : difficulty === "medium"
        ? MEDIUM_SCORE_WEIGHTS
        : HARD_SCORE_WEIGHTS;

  let bestCat = legalCats[0]!;
  let bestScore = -Infinity;
  for (const cat of legalCats) {
    const s =
      rateScorecardSafety(infoSet, cat) *
      (weights.immediateValue * rateImmediateValue(infoSet, cat) +
        weights.chanceSafetyValve * rateChanceSafetyValve(infoSet, cat) +
        weights.adversarialVariance * rateAdversarialVariance(infoSet, cat) +
        weights.upperCategoryEfficiency * rateUpperCategoryEfficiency(infoSet, cat));
    if (s > bestScore) {
      bestScore = s;
      bestCat = cat;
    }
  }

  const noiseRate = NOISE_RATE[difficulty];
  if (noiseRate > 0) {
    const rng = getRng();
    if (rng() < noiseRate) {
      return legalCats[Math.floor(rng() * legalCats.length)]!;
    }
  }

  return bestCat;
}
