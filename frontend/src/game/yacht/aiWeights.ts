/**
 * Difficulty weight maps for the Yacht Utility AI (GH #2027, story A3).
 *
 * One `WeightMap` pair (hold + score) per difficulty level.  A higher weight
 * amplifies the corresponding consideration's influence on the weighted-sum
 * decision score.  Difficulty: Easy 13% / Medium 3% / Hard 0% cognitive noise.
 * Recalibrated in #2129: Hard wins ~62–68% vs Easy, ~47–53% vs Medium
 * (200-game baseline; see ai.baseline.test.ts).
 */

import type { WeightMap } from "../_shared/utilityAi/types";
import type { AiDifficulty } from "./types";

// ─── Key types ────────────────────────────────────────────────────────────────

export type HoldWeightKey = "upperBonusUrgency" | "evOfHold";
export type ScoreWeightKey =
  "immediateValue" | "chanceSafetyValve" | "adversarialVariance" | "upperCategoryEfficiency";

export type HoldWeights = WeightMap<HoldWeightKey>;
export type ScoreWeights = WeightMap<ScoreWeightKey>;

// ─── Hold weight maps ─────────────────────────────────────────────────────────

// Easy: balanced hold, greedy score — 13% cognitive noise is the primary lever
export const EASY_HOLD_WEIGHTS: HoldWeights = {
  upperBonusUrgency: 0.5,
  evOfHold: 0.5,
};

// Medium: balanced hold (equal urgency/EV split, unlike Hard's EV-dominant 0.3/0.7)
export const MEDIUM_HOLD_WEIGHTS: HoldWeights = {
  upperBonusUrgency: 0.5,
  evOfHold: 0.5,
};

// Hard: EV-dominant — no noise; adds adversarial variance on top of Medium
export const HARD_HOLD_WEIGHTS: HoldWeights = {
  upperBonusUrgency: 0.3,
  evOfHold: 0.7,
};

// ─── Score weight maps ────────────────────────────────────────────────────────

// Easy: immediate value dominant (greedy); noise does the heavy lifting
export const EASY_SCORE_WEIGHTS: ScoreWeights = {
  immediateValue: 1.0,
  chanceSafetyValve: 0.2,
  adversarialVariance: 0.3,
  upperCategoryEfficiency: 0.3,
};

// Medium: greedy score; upper-efficiency weight (5.0 > Hard's 3.0) is intentionally
// high — it's the primary signal that separates Medium from Easy rather than
// adversarialVariance, which Medium keeps low to avoid adversarial play.
export const MEDIUM_SCORE_WEIGHTS: ScoreWeights = {
  immediateValue: 1.0,
  chanceSafetyValve: 0.4,
  adversarialVariance: 0.3,
  upperCategoryEfficiency: 5.0,
};

// Hard: immediate value + adversarial variance dominant
export const HARD_SCORE_WEIGHTS: ScoreWeights = {
  immediateValue: 1.0,
  chanceSafetyValve: 0.4,
  adversarialVariance: 0.8,
  upperCategoryEfficiency: 3.0,
};

// ─── Cognitive noise rates ────────────────────────────────────────────────────

/** Probability of ignoring the best-scoring action and picking a random legal one. */
export const NOISE_RATE: Readonly<Record<AiDifficulty, number>> = {
  easy: 0.13,
  medium: 0.03,
  hard: 0.0,
};
