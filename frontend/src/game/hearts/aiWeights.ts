/**
 * Difficulty weight maps for the Hearts Utility AI (GH #2031, story A7).
 *
 * One PlayWeights + PassWeights pair per AiPersona. The Daring moon-attempt
 * variant applies when the old `isMoonAttempt` thresholds fire — rateMoonAttemptProgress
 * dominates at 100.0 (calibration-drift guard) while card selection stays utility-driven.
 *
 * Noise rates: Cautious 37% / Schemer 10% / Daring 0%.
 * Daring noise is 0 because even a small deviation can derail moon attempts.
 *
 * Noise is what sets the difficulty ladder (#2555). Cautious's point-avoidance
 * weights are strong Hearts play on their own: at 25% noise Cautious was the
 * strongest persona and the all-Cautious table the hardest for the human.
 * The sim gate (sim/gate.ts) showed the weights barely move its strength
 * while noise does, so 35% put it back at the bottom, and #2235's moon
 * defense took it to 38%.
 *
 * #2283 made the mistakes plausible: a noise hit used to play a uniformly
 * random card, so every slip cost the same ~1.3 points whoever made it (the
 * regret report, #2239) and could look like a broken bot. It now picks a
 * near-best card (MISTAKE_SPREAD). Rates were re-tuned to the chosen ladder —
 * a competent player (the sim's Schemer stand-in) winning ~40% at the
 * Cautious table, ~26% at Schemer's, ~16% at Daring's.
 */

import type { WeightMap } from "../_shared/utilityAi/types";
import type { AiPersona } from "./types";

// ─── Key types ────────────────────────────────────────────────────────────────

export type PlayWeightKey =
  | "minimizePoints" // rateMinimizeImmediatePoints
  | "queenSpadesRisk" // rateQueenSpadesRisk
  | "moonThreat" // rateMoonThreat
  | "moonProgress" // rateMoonAttemptProgress
  | "tactics"; // rateTactics (#2236): 1.0 everywhere, 0 in moon-attempt mode

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
  tactics: 1.0,
};

// Schemer: balanced risk/blocking; no moon progress
export const SCHEMER_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 2.0,
  queenSpadesRisk: 1.5,
  moonThreat: 1.5,
  moonProgress: 0.0,
  tactics: 1.0,
};

// Daring (standard). moonProgress stays 0: rateQueenSpadesRisk already sorts Q♠ first
// in void discards (1.0 for off-suit Q♠ dump vs 0.8 for other discards while holding Q♠),
// so even at weight 1.0 Q♠ beats every other discard. moonProgress only matters inside
// moon-attempt mode (DARING_MOON_PLAY_WEIGHTS).
export const DARING_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 1.5,
  queenSpadesRisk: 3.0,
  moonThreat: 1.0,
  moonProgress: 0.0,
  tactics: 1.0,
};

// Daring moon-attempt mode: rateMoonAttemptProgress dominates (100.0) so the
// moon-attempt trigger (detectMoonAttempt → moonHand.ts, #2234) is effectively hardcoded while
// card selection within the mode remains utility-driven (calibration-drift guard).
export const DARING_MOON_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 0.05,
  queenSpadesRisk: 0.2,
  moonThreat: 0.0,
  moonProgress: 100.0,
  tactics: 0.0,
};

// Daring endgame mode: any player ≥ 65 cumulative pts, no moon attempt.
// Dumps Q♠ and high hearts aggressively on the score leader;
// minimizePoints reduced since self-protection matters less near game end.
export const DARING_ENDGAME_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 1.0,
  queenSpadesRisk: 2.5,
  moonThreat: 2.0,
  moonProgress: 0.0,
  tactics: 1.0,
};

// Daring adversarial mode: void in led suit + seat 0 winning the current trick.
// Strongly weights Q♠ first (rateQueenSpadesRisk 1.0 vs 0.8 for other off-suit
// discards while holding Q♠), then hearts, to maximize pressure on the human.
export const DARING_ADVERSARIAL_PLAY_WEIGHTS: PlayWeights = {
  minimizePoints: 1.0,
  queenSpadesRisk: 5.0,
  moonThreat: 2.0,
  moonProgress: 0.0,
  tactics: 1.0,
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
  suitVoiding: 2.5,
};

// ─── Cognitive noise ───────────────────────────────────────────────────────────

/**
 * How often each persona makes a mistake: the chance, per decision with an
 * alternative, of not playing (or passing) its best-scoring choice.
 */
export const NOISE_RATE: Readonly<Record<AiPersona, number>> = {
  cautious: 0.37,
  schemer: 0.1,
  daring: 0.0,
};

/**
 * How far from the best a mistake strays (#2283), in utility-score units: a
 * mistake picks card c with weight exp(−(best − score(c)) / spread), so
 * near-best cards are likely and clear blunders rare — the slips of a weaker
 * player, not a random card. Infinity would be the old uniform noise.
 */
export const MISTAKE_SPREAD: Readonly<Record<AiPersona, number>> = {
  cautious: 0.5,
  schemer: 0.5,
  daring: 0.5,
};
