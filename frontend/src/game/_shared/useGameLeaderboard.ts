import {
  useLeaderboardLink,
  type LeaderboardNavigator,
  type OpenLeaderboard,
} from "../../hooks/useLeaderboardLink";
import type { Partition } from "./boardPartition";
import { sessionBoardAdapter, type SessionBoardSubmission } from "./sessionBoardAdapter";
import type { GameType } from "./types";
import {
  useLeaderboardSubmit,
  type LeaderboardAdapter,
  type LeaderboardSubmitState,
} from "./useLeaderboardSubmit";

/** One session-board adapter per game, built the first time a screen asks for it. */
const adapters = new Map<GameType, LeaderboardAdapter<SessionBoardSubmission>>();

function gameBoard(gameType: GameType): LeaderboardAdapter<SessionBoardSubmission> {
  let adapter = adapters.get(gameType);
  if (!adapter) {
    adapter = sessionBoardAdapter(gameType);
    adapters.set(gameType, adapter);
  }
  return adapter;
}

export interface GameLeaderboard {
  /**
   * The result card's rank lookup (`useLeaderboardSubmit` on the game's
   * session board): `submit({ gameId })` when the game ends, `reset()` on a
   * new game, and `toSubmission(leaderboard)` as the card's `submission`.
   */
  leaderboard: LeaderboardSubmitState<SessionBoardSubmission>;
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
 * The hook owns the game's `sessionBoardAdapter` (one per game type, kept for
 * the app's lifetime), so a screen no longer builds one at module scope.
 * `partition` opens the board the player just played on (e.g. Sudoku's
 * difficulty and variant); it may be built inline (`useLeaderboardLink` keeps
 * it stable by value).
 */
export function useGameLeaderboard(
  gameType: GameType,
  navigation: LeaderboardNavigator,
  partition?: Partition
): GameLeaderboard {
  const leaderboard = useLeaderboardSubmit(gameBoard(gameType));
  const openLeaderboard = useLeaderboardLink(navigation, gameType, partition);
  return { leaderboard, openLeaderboard };
}
