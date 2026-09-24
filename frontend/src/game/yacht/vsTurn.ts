/**
 * VS-mode turn order (#2203).
 *
 * The human always moves first each round, and the computer's turn state
 * isn't saved separately — it's derived from the two scorecards, so a game
 * restored after the app was killed mid-AI-turn picks the AI turn back up
 * instead of handing the human an extra turn.
 */

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
