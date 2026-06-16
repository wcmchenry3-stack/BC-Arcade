/**
 * Difficulty weight maps for the Yacht Utility AI (GH #2027, story A3).
 *
 * One `WeightMap` pair (hold + score) per difficulty level.  A higher weight
 * amplifies the corresponding consideration's influence on the weighted-sum
 * decision score.  Difficulty differentiation comes primarily from noise rates
 * (Easy 25%, Medium 10%, Hard 0%) with weights providing secondary tuning.
 */

import type { WeightMap } from "../_shared/utilityAi/types";
import type { AiDifficulty } from "./types";

// ─── Key types ────────────────────────────────────────────────────────────────

export type HoldWeightKey = "upperBonusUrgency" | "evOfHold";
export type ScoreWeightKey = "immediateValue" | "chanceSafetyValve" | "adversarialVariance";

export type HoldWeights = WeightMap<HoldWeightKey>;
export type ScoreWeights = WeightMap<ScoreWeightKey>;

// ─── Hold weight maps ─────────────────────────────────────────────────────────

// Easy: balanced — cognitive noise (25%) is the primary difficulty lever
export const EASY_HOLD_WEIGHTS: HoldWeights = {
  upperBonusUrgency: 0.5,
  evOfHold: 0.5,
};

// Medium: bonus-hunting bias — 10% noise; pursues upper bonus more aggressively
export const MEDIUM_HOLD_WEIGHTS: HoldWeights = {
  upperBonusUrgency: 0.6,
  evOfHold: 0.4,
};

// Hard: EV-dominant — no noise; maximises expected value over bonus chasing
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
};

// Medium: immediate value + Chance-preservation conscious
export const MEDIUM_SCORE_WEIGHTS: ScoreWeights = {
  immediateValue: 1.0,
  chanceSafetyValve: 0.6,
  adversarialVariance: 0.4,
};

// Hard: immediate value + adversarial variance dominant
export const HARD_SCORE_WEIGHTS: ScoreWeights = {
  immediateValue: 1.0,
  chanceSafetyValve: 0.4,
  adversarialVariance: 0.8,
};

// ─── Cognitive noise rates ────────────────────────────────────────────────────

/** Probability of ignoring the best-scoring action and picking a random legal one. */
export const NOISE_RATE: Readonly<Record<AiDifficulty, number>> = {
  easy: 0.25,
  medium: 0.1,
  hard: 0.0,
};
