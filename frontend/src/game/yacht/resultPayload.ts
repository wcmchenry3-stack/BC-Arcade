/**
 * The `result` block Yacht sends on `PATCH /games/{id}/complete` (#2839).
 *
 * Pure so the payload can be tested without the screen. The server model is
 * `YachtResult` in backend/yacht/models.py, which documents the bonus
 * accounting: `total = sum(filled categories) + upper_bonus + yacht_bonus_total`.
 * Joker (extra Yacht) category scores are already inside `categories`; only
 * the 100-point extra-Yacht bonus is in `yacht_bonus_total`.
 */

import { CATEGORIES } from "./engine";
import type { GameState } from "./types";

export interface YachtScorecardPayload {
  /** Filled categories only; an unfilled category is omitted. */
  categories: Record<string, number>;
  upper_bonus: number;
  yacht_bonus_count: number;
  yacht_bonus_total: number;
}

export type YachtEndOutcome = "completed" | "abandoned";
export type YachtVsResult = "win" | "loss" | "draw";

export function scorecardPayload(s: GameState): YachtScorecardPayload {
  const categories: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    const v = s.scores[cat];
    if (v !== null && v !== undefined) categories[cat] = v;
  }
  return {
    categories,
    upper_bonus: s.upper_bonus,
    yacht_bonus_count: s.yacht_bonus_count,
    yacht_bonus_total: s.yacht_bonus_total,
  };
}

/**
 * `opponent` (a vs game) is passed only when there is one; its scorecard and
 * `opponent_score` go in only once the computer has finished, as before.
 * `recordOutcome` maps the vs result to the row's outcome (#2517).
 */
export function buildEndedPayload(
  s: GameState,
  outcome: YachtEndOutcome,
  opponent: GameState | null | undefined,
  vsOutcome: (player: GameState, cpu: GameState) => YachtVsResult,
  recordOutcome: (r: YachtVsResult) => string
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    final_score: s.total_score,
    upper_bonus: s.upper_bonus,
    yacht_bonus_total: s.yacht_bonus_total,
    outcome,
    scorecard: scorecardPayload(s),
  };
  if (opponent?.game_over && outcome === "completed") {
    const vsResult = vsOutcome(s, opponent);
    payload.opponent_score = opponent.total_score;
    payload.opponent_scorecard = scorecardPayload(opponent);
    payload.vs_result = vsResult;
    payload.outcome = recordOutcome(vsResult);
  }
  return payload;
}
