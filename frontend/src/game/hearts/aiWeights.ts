/**
 * Difficulty weight maps for the Hearts Utility AI (GH #2031, story A7).
 *
 * One PlayWeights + PassWeights pair per AiPersona. The Daring moon-attempt
 * variant applies when the old `isMoonAttempt` thresholds fire — rateMoonAttemptProgress
 * dominates at 100.0 (calibration-drift guard) while card selection stays utility-driven.
 *
 * Noise rates: Cautious 25% / Schemer 10% / Daring 0%.
 * Daring noise is 0 because even a small random deviation can derail moon attempts.
 */

import type { WeightMap } from "../_shared/utilityAi/types";
import type { AiPersona } from "./types";

// ─── Key types ────────────────────────────────────────────────────────────────

export type PlayWeightKey =
  | "minimizePoints" // rateMinimizeImmediatePoints
  | "queenSpadesRisk" // rateQueenSpadesRisk
  | "moonThreat" // rateMoonThreat
  | "moonProgress"; // rateMoonAttemptProgress

export type PassWeightKey =
  | "passingQuality" // ratePassingQuality
  | "suitVoiding"; // rateSuitVoidingUtility

export type PlayWeights = WeightMap<PlayWeightKey>;
export type PassWeights = WeightMap<PassWeightKey>;

// ─── Play weight maps ─────────────────────────────────────────────────────────

// Cautious: heavy point-avoidance; never attempts moon shots
export const CAUTIOUS_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 3.0,
  queenSpadesRisk: 2.0,
  moonThreat: 1.0,
  moonProgress: 0.0,
};

// Schemer: balanced risk/blocking; no moon progress
export const SCHEMER_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 2.0,
  queenSpadesRisk: 1.5,
  moonThreat: 1.5,
  moonProgress: 0.0,
};

// Daring (standard). moonProgress stays 0: rateQueenSpadesRisk already sorts Q♠ first
// in void discards (1.0 for off-suit Q♠ dump vs 0.8 for other discards while holding Q♠),
// so even at weight 1.0 Q♠ beats every other discard. moonProgress only matters inside
// moon-attempt mode (DARING_MOON_PLAY_WEIGHTS).
export const DARING_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 1.5,
  queenSpadesRisk: 1.0,
  moonThreat: 1.0,
  moonProgress: 0.0,
};

// Daring moon-attempt mode: rateMoonAttemptProgress dominates (100.0) so the
// old earlyMoon/midMoon activation threshold is effectively hardcoded while
// card selection within the mode remains utility-driven (calibration-drift guard).
export const DARING_MOON_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 0.05,
  queenSpadesRisk: 0.2,
  moonThreat: 0.0,
  moonProgress: 100.0,
};

// Daring endgame mode: any player ≥ 65 cumulative pts, no moon attempt.
// Dumps Q♠ and high hearts aggressively on the score leader;
// minimizePoints reduced since self-protection matters less near game end.
export const DARING_ENDGAME_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 1.0,
  queenSpadesRisk: 2.5,
  moonThreat: 2.0,
  moonProgress: 0.0,
};

// Daring adversarial mode: void in led suit + seat 0 winning the current trick.
// Strongly weights Q♠ first (rateQueenSpadesRisk 1.0 vs 0.8 for other off-suit
// discards while holding Q♠), then hearts, to maximize pressure on the human.
export const DARING_ADVERSARIAL_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 1.0,
  queenSpadesRisk: 5.0,
  moonThreat: 2.0,
  moonProgress: 0.0,
};

// ─── Pass weight maps ─────────────────────────────────────────────────────────

// Cautious: danger-card focus; minimal void creation
export const CAUTIOUS_PASS_WEIGHTS: PassWeights = {
  passingQuality: 1.0,
  suitVoiding: 0.2,
};

// Schemer: balanced danger-card + void creation
export const SCHEMER_PASS_WEIGHTS: PassWeights = {
  passingQuality: 1.0,
  suitVoiding: 0.8,
};

// Daring: equal danger-card + void creation; moon-viable mode overrides in broker
export const DARING_PASS_WEIGHTS: PassWeights = {
  passingQuality: 1.0,
  suitVoiding: 1.0,
};

// ─── Cognitive noise rates ─────────────────────────────────────────────────────

/** Probability of ignoring the best-scoring action and picking a random legal one. */
export const NOISE_RATE: Readonly<Record<AiPersona, number>> = {
  cautious: 0.25,
  schemer: 0.1,
  daring: 0.0,
};
