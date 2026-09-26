import { useCallback } from "react";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { GameType } from "../api/vocab";
import type { HomeStackParamList } from "../types/navigation";
import { hasLeaderboard } from "../game/_shared/leaderboardAvailability";
import { useStablePartition, type Partition } from "../game/_shared/boardPartition";

/** Any Home-stack screen's navigation object (from props or `useNavigation`). */
export type LeaderboardNavigator = Pick<NativeStackNavigationProp<HomeStackParamList>, "navigate">;

export interface OpenLeaderboardOptions {
  /**
   * The game just finished may not be on the server yet (the result card's
   * rank is still pending): the board refetches once local games have synced.
   */
  pendingSync?: boolean;
}

export type OpenLeaderboard = (options?: OpenLeaderboardOptions) => void;

/**
 * Opens `gameType`'s leaderboard (#2633): the result card's "View
 * leaderboard" link (`GameResultModal.onViewLeaderboard`) and the ⋯ menu's
 * "Leaderboard" item (`GameShell.onOpenLeaderboard`) both take it.
 *
 * Returns `undefined` when the game has no board the player can open
 * (`hasLeaderboard`: a disabled board, or a game hidden in this build), so
 * neither the link nor the menu item appears. `partition` opens the board the
 * player just played on (e.g. Sudoku's difficulty and variant).
 */
export function useLeaderboardLink(
  navigation: LeaderboardNavigator,
  gameType: GameType,
  partition?: Partition
): OpenLeaderboard | undefined {
  const stable = useStablePartition(partition);
  const hasPartition = partition !== undefined;
  const open = useCallback(
    (options?: OpenLeaderboardOptions) =>
      navigation.navigate("Leaderboard", {
        gameType,
        ...(hasPartition ? { partition: stable } : {}),
        ...(options?.pendingSync ? { refreshAfterSync: true } : {}),
      }),
    [navigation, gameType, stable, hasPartition]
  );
  return hasLeaderboard(gameType) ? open : undefined;
}
