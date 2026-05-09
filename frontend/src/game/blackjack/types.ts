/**
 * Blackjack API response shapes.
 */

import type { GameOutcome, GameSession } from "../_shared/types";

export type BlackjackGameEvent =
  | { readonly type: "cardDeal" }
  | { readonly type: "blackjack" }
  | { readonly type: "bust" }
  | { readonly type: "win" }
  | { readonly type: "loss" }
  | { readonly type: "push" };

export interface CardResponse {
  rank: string;
  suit: string;
  face_down: boolean;
}

export interface HandResponse {
  cards: CardResponse[];
  value: number;
  /** True when at least one Ace is counted as 11 (soft hand). */
  soft: boolean;
}

export interface GameRules {
  hit_soft_17: boolean;
  deck_count: number;
  penetration: number;
}

export interface BlackjackState {
  phase: string; // "betting" | "player" | "result" | "victory"
  chips: number;
  bet: number;
  player_hand: HandResponse;
  dealer_hand: HandResponse;
  outcome: string | null; // "blackjack" | "win" | "lose" | "push" | null
  payout: number;
  game_over: boolean;
  double_down_available: boolean;
  split_available: boolean;
  // Multi-hand split fields
  player_hands: HandResponse[];
  hand_bets: number[];
  active_hand_index: number;
  hand_outcomes: (string | null)[];
  hand_payouts: number[];
  rules: GameRules;
  /** Net chip delta from the previously completed hand. Null until at least one hand resolves. */
  last_win: number | null;
  /** One-shot UI events emitted by the engine and consumed by the animation layer. */
  events?: readonly BlackjackGameEvent[];
  // Run-mode fields
  run_goal: number | null;
  run_starting_chips: number;
  run_complete: boolean;
}

export type BlackjackSession = GameSession<BlackjackState>;

/** Outcome for a completed Blackjack hand. */
export interface BlackjackOutcome extends GameOutcome {
  /** Raw outcome string from the server ("blackjack" | "win" | "lose" | "push"). */
  handResult: string | null;
}
