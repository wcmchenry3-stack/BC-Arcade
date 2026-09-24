/**
 * VS-mode turn order (#2203).
 *
 * The human always moves first each round, and the computer's turn state
 * isn't saved separately — it's derived from the two scorecards, so a game
 * restored after the app was killed mid-AI-turn picks the AI turn back up
 * instead of handing the human an extra turn.
 */

import { possibleScores, roll, score, type Category } from "./engine";
import type { GameState } from "./types";

/**
 * True when the computer owes a turn: the human has already scored this
 * round (their round counter is ahead) or has finished the game while the
 * computer hasn't. Includes an AI turn that was interrupted part-way through
 * (rolls_used 1-3) — `rolls_used` isn't consulted, only whose round it is.
 */
export function isAiTurnPending(human: GameState, ai: GameState): boolean {
  if (ai.game_over) return false;
  return human.game_over || ai.round < human.round;
}

/**
 * Finish the computer's turn without the AI: roll once if it hasn't rolled,
 * then score the legal category worth the most right now. Used only when the
 * normal AI turn throws, so the computer never falls a round behind — a
 * skipped round would leave its game unable to reach game_over, and the VS
 * result screen waits on both games (#2203).
 */
export function finishTurnFallback(state: GameState): GameState {
  const rolled = state.rolls_used === 0 ? roll(state, [false, false, false, false, false]) : state;
  const options = Object.entries(possibleScores(rolled));
  if (options.length === 0) throw new Error("finishTurnFallback: no legal category");
  const [best] = options.reduce((a, b) => (b[1] > a[1] ? b : a));
  return score(rolled, best as Category);
}
