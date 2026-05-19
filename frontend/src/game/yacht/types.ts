/**
 * Yacht API response shapes.
 */

import type { GameOutcome, GameSession } from "../_shared/types";

/** Difficulty tier for the Yacht AI opponent. Governs hold and scoring strategy. */
export type AiDifficulty = "easy" | "medium" | "hard";

export const AI_DIFFICULTIES: readonly AiDifficulty[] = ["easy", "medium", "hard"];

export type GameEvent =
  | { readonly type: "diceRoll"; readonly rolledIndices: readonly number[] }
  | { readonly type: "dieHold"; readonly index: number }
  | { readonly type: "dieRelease"; readonly index: number }
  | { readonly type: "yacht" }
  | { readonly type: "joker" }
  | { readonly type: "largeStraight" }
  | { readonly type: "smallStraight" }
  | { readonly type: "upperBonus" };

export interface GameState {
  dice: number[];
  held: boolean[];
  rolls_used: number;
  round: number;
  scores: Record<string, number | null>;
  game_over: boolean;
  upper_subtotal: number;
  upper_bonus: number;
  yacht_bonus_count: number;
  yacht_bonus_total: number;
  total_score: number;
  events?: readonly GameEvent[];
}

export interface PossibleScores {
  possible_scores: Record<string, number>;
}

export type YachtSession = GameSession<GameState>;

/** Outcome for a completed Yacht game. */
export interface YachtOutcome extends GameOutcome {
  /** Breakdown of upper and lower section totals. */
  upperTotal: number;
  lowerTotal: number;
}
