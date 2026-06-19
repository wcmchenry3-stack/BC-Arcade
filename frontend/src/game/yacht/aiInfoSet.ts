/**
 * Yacht information-set builder (GH #2025, story A1).
 *
 * `buildYachtInfoSet` converts a live GameState into a read-only decision
 * snapshot that implements the shared `InformationSet` contract.  It is a
 * pure function: no React, no IO, no Math.random, no Date.now.
 *
 * The snapshot is consumed by consideration evaluators in later stories
 * (A2 / A3) that score hold and scoring actions.  Nothing here changes any
 * public AI behaviour — holdStrategy / scoreStrategy are unchanged.
 */

import type { InformationSet } from "../_shared/utilityAi/types";
import type { GameState } from "./types";
import { CATEGORIES, UPPER_CATEGORIES, Category } from "./engine";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A read-only snapshot of all decision-relevant information for one Yacht
 * turn.  Consuming code (consideration evaluators) must never mutate this
 * object.
 */
export interface YachtInfoSet extends InformationSet {
  readonly kind: "yacht";

  // ── Dice state ──────────────────────────────────────────────────────────
  /** Current dice values (length 5, 1-6 after first roll, 0 before). */
  readonly dice: readonly number[];
  /** Number of rolls used this turn (0–3). */
  readonly rollsUsed: number;
  /** Rolls still available this turn (0–3). */
  readonly rollsRemaining: number;

  // ── Category state ──────────────────────────────────────────────────────
  /** Categories that have not yet been scored. */
  readonly openCategories: ReadonlySet<Category>;
  /** Categories that have already been scored (value ≥ 0). */
  readonly filledCategories: ReadonlySet<Category>;
  /** How many categories remain unfilled. */
  readonly categoriesRemaining: number;

  // ── Upper-section bonus tracking ────────────────────────────────────────
  /** Sum of all filled upper-section scores (ones … sixes). */
  readonly upperSubtotal: number;
  /**
   * Points still needed toward the 63-point threshold to earn the 35-pt
   * upper-section bonus.  0 when the bonus is already earned.
   */
  readonly toBonus: number;
  /**
   * True when the upper bonus has already been secured (upperSubtotal ≥ 63).
   */
  readonly bonusEarned: boolean;
  /**
   * True when the upper bonus is no longer mathematically attainable.
   *
   * This is set when the maximum points still available from open upper
   * categories (each face × 5 dice) cannot bring the subtotal up to 63.
   * It remains false once the bonus is earned.
   */
  readonly bonusUnreachable: boolean;

  // ── Score totals ────────────────────────────────────────────────────────
  /** My current total score (sum of filled categories + any upper bonus + yacht bonuses). */
  readonly myScore: number;
  /** Opponent's current total score. */
  readonly opponentScore: number;
  /** myScore − opponentScore (positive = leading). */
  readonly scoreDelta: number;

  // ── Round info ───────────────────────────────────────────────────────────
  /** Current round number (1–13). */
  readonly round: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UPPER_BONUS_THRESHOLD = 63;
const MAX_ROLLS_PER_TURN = 3;

/** Maximum upper-section score attainable from a single category (face × 5 dice). */
const UPPER_FACE_MAX: Readonly<Partial<Record<Category, number>>> = {
  ones: 5,
  twos: 10,
  threes: 15,
  fours: 20,
  fives: 25,
  sixes: 30,
};

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a `YachtInfoSet` from the current game state and the opponent's score.
 *
 * @param state        The current GameState (from engine.ts).
 * @param opponentScore The opponent's running total (0 when unknown / single-player).
 * @returns A frozen, read-only decision snapshot.
 */
export function buildYachtInfoSet(state: GameState, opponentScore: number): YachtInfoSet {
  // ── Category sets ─────────────────────────────────────────────────────
  const open = new Set<Category>();
  const filled = new Set<Category>();
  for (const cat of CATEGORIES) {
    const v = state.scores[cat];
    if (v === null || v === undefined) {
      open.add(cat);
    } else {
      filled.add(cat);
    }
  }

  // ── Upper-section subtotal ─────────────────────────────────────────────
  let upperSub = 0;
  for (const cat of UPPER_CATEGORIES) {
    const v = state.scores[cat];
    if (v !== null && v !== undefined) upperSub += v;
  }

  const bonusEarned = upperSub >= UPPER_BONUS_THRESHOLD;
  const toBonus = bonusEarned ? 0 : Math.max(0, UPPER_BONUS_THRESHOLD - upperSub);

  // Maximum additional upper score attainable from remaining open upper cats.
  let maxAdditionalUpper = 0;
  for (const cat of UPPER_CATEGORIES) {
    if (open.has(cat)) {
      maxAdditionalUpper += UPPER_FACE_MAX[cat] ?? 0;
    }
  }
  // bonusUnreachable is meaningful only when the bonus hasn't been earned.
  const bonusUnreachable = !bonusEarned && upperSub + maxAdditionalUpper < UPPER_BONUS_THRESHOLD;

  // ── Score totals ──────────────────────────────────────────────────────
  const myScore = state.total_score;
  const scoreDelta = myScore - opponentScore;

  // ── Assemble and freeze ───────────────────────────────────────────────
  const infoSet: YachtInfoSet = {
    kind: "yacht",
    dice: Object.freeze([...state.dice]),
    rollsUsed: state.rolls_used,
    rollsRemaining: Math.max(0, MAX_ROLLS_PER_TURN - state.rolls_used),
    openCategories: Object.freeze(open) as ReadonlySet<Category>,
    filledCategories: Object.freeze(filled) as ReadonlySet<Category>,
    categoriesRemaining: open.size,
    upperSubtotal: upperSub,
    toBonus,
    bonusEarned,
    bonusUnreachable,
    myScore,
    opponentScore,
    scoreDelta,
    round: state.round,
  };

  return Object.freeze(infoSet);
}
