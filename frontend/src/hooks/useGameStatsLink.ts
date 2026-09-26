import { useCallback } from "react";
import type { GameType } from "../api/vocab";
import type { LeaderboardNavigator } from "./useLeaderboardLink";

/**
 * Opens `gameType`'s stats screen (#2635), for the ⋯ menu's "Stats" item
 * (`GameShell.onOpenStats`). Every game has one, so unlike
 * `useLeaderboardLink` this is never undefined.
 */
export function useGameStatsLink(navigation: LeaderboardNavigator, gameType: GameType): () => void {
  return useCallback(() => navigation.navigate("GameStats", { gameType }), [navigation, gameType]);
}
