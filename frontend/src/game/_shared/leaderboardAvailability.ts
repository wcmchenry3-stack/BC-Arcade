/**
 * Which games have a leaderboard the player can open (#2633).
 *
 * A game has one when its board is enabled (`BOARDS`, generated from each
 * backend `GameModule.board`) and the game exists in this build
 * (`isGameVisible`: store builds hide the premium games, #2390). Blackjack and
 * Daily Word declare disabled boards, so they never get a "View leaderboard"
 * link, a "Leaderboard" menu item or a reachable board screen.
 */

import { BOARDS, type BoardDefinition, type GameType } from "../../api/vocab";
import { isGameVisible } from "../../entitlements/gameVisibility";

/** The game's board when the player can open it, else null. */
export function openableBoard(gameType: GameType): BoardDefinition | null {
  const board = BOARDS[gameType];
  return board?.enabled && isGameVisible(gameType) ? board : null;
}

export function hasLeaderboard(gameType: GameType): boolean {
  return openableBoard(gameType) !== null;
}
