import {
  useLeaderboardLink,
  type LeaderboardNavigator,
  type OpenLeaderboard,
} from "../../hooks/useLeaderboardLink";
import type { Partition } from "./boardPartition";
import type { GameType } from "./types";
import { useGameRank, type GameRankState } from "./useGameRank";

export interface GameLeaderboard {
  /**
   * The result card's rank lookup (`useGameRank` on the game's session board):
   * `lookup(gameId)` when the game ends, `reset()` on a new game, and
   * `toSubmission(leaderboard)` as the card's `submission`.
   */
  leaderboard: GameRankState;
  /**
   * Opens the game's leaderboard, for both `GameResultModal.onViewLeaderboard`
   * and `GameShell.onOpenLeaderboard`; `undefined` when the game has no board
   * the player can open (`useLeaderboardLink`).
   */
  openLeaderboard: OpenLeaderboard | undefined;
}

/**
 * A game screen's leaderboard wiring in one call (#2976): the rank lookup on
 * `gameType`'s session board and the opener for that board.
 *
 *   const { leaderboard, openLeaderboard } = useGameLeaderboard("sudoku", navigation, {
 *     difficulty,
 *   });
 *
 * `partition` opens the board the player just played on (e.g. Sudoku's
 * difficulty and variant); it may be built inline (`useLeaderboardLink` keeps
 * it stable by value).
 */
export function useGameLeaderboard(
  gameType: GameType,
  navigation: LeaderboardNavigator,
  partition?: Partition
): GameLeaderboard {
  const leaderboard = useGameRank(gameType);
  const openLeaderboard = useLeaderboardLink(navigation, gameType, partition);
  return { leaderboard, openLeaderboard };
}
