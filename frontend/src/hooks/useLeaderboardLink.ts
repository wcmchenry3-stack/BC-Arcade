import { useCallback } from "react";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { GameType } from "../api/vocab";
import type { HomeStackParamList } from "../types/navigation";
import { hasLeaderboard } from "../game/_shared/leaderboardAvailability";

/** Any Home-stack screen's navigation object (from props or `useNavigation`). */
export type LeaderboardNavigator = Pick<NativeStackNavigationProp<HomeStackParamList>, "navigate">;

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
  partition?: Readonly<Record<string, string>>
): (() => void) | undefined {
  // A string, so a new object with the same values keeps the callback stable.
  const partitionKey = partition ? JSON.stringify(partition) : "";
  const open = useCallback(
    () =>
      navigation.navigate("Leaderboard", {
        gameType,
        ...(partitionKey ? { partition: JSON.parse(partitionKey) as Record<string, string> } : {}),
      }),
    [navigation, gameType, partitionKey]
  );
  return hasLeaderboard(gameType) ? open : undefined;
}
