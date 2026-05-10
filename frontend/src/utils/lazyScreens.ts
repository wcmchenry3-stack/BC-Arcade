import React from "react";

// Factories are held separately so prefetch callers can invoke the same
// import() as React.lazy — the module loader dedupes, so once prefetched the
// React.lazy promise resolves synchronously on navigation.
const factories = {
  Cascade: () => import("../screens/CascadeScreen"),
  StarSwarm: () => import("../screens/StarSwarmScreen"),
  BlackjackBetting: () => import("../screens/BlackjackBettingScreen"),
  BlackjackTable: () => import("../screens/BlackjackTableScreen"),
  BlackjackVictory: () => import("../screens/BlackjackVictoryScreen"),
  Twenty48: () => import("../screens/Twenty48Screen"),
  Solitaire: () => import("../screens/SolitaireScreen"),
  FreeCell: () => import("../screens/FreeCellScreen"),
  Hearts: () => import("../screens/HeartsScreen"),
  Sudoku: () => import("../screens/SudokuScreen"),
  Mahjong: () => import("../screens/MahjongScreen"),
  Sort: () => import("../screens/SortScreen"),
  DailyWord: () => import("../screens/DailyWordScreen"),
  Leaderboard: () => import("../screens/LeaderboardScreen"),
  GameDetail: () => import("../screens/GameDetailScreen"),
  Settings: () => import("../screens/SettingsScreen"),
  Scoreboard: () => import("../screens/ScoreboardScreen"),
} as const;

export const LazyScreens = {
  Cascade: React.lazy(factories.Cascade),
  StarSwarm: React.lazy(factories.StarSwarm),
  BlackjackBetting: React.lazy(factories.BlackjackBetting),
  BlackjackTable: React.lazy(factories.BlackjackTable),
  BlackjackVictory: React.lazy(factories.BlackjackVictory),
  Twenty48: React.lazy(factories.Twenty48),
  Solitaire: React.lazy(factories.Solitaire),
  FreeCell: React.lazy(factories.FreeCell),
  Hearts: React.lazy(factories.Hearts),
  Sudoku: React.lazy(factories.Sudoku),
  Mahjong: React.lazy(factories.Mahjong),
  Sort: React.lazy(factories.Sort),
  DailyWord: React.lazy(factories.DailyWord),
  Leaderboard: React.lazy(factories.Leaderboard),
  GameDetail: React.lazy(factories.GameDetail),
  Settings: React.lazy(factories.Settings),
  Scoreboard: React.lazy(factories.Scoreboard),
} as const;

// Slugs for premium games that have lazy screens.
const PREMIUM_LAZY: Array<[keyof typeof factories, string]> = [
  ["Cascade", "cascade"],
  ["StarSwarm", "starswarm"],
  ["Hearts", "hearts"],
  ["Sudoku", "sudoku"],
  ["Sort", "sort"],
];

/**
 * Fire-and-forget prefetch of lobby game chunks. Called from HomeScreen after
 * interactions settle so the Suspense fallback doesn't flash when the user
 * taps into a game (issue #706). Safe to call multiple times — the module
 * loader dedupes.
 *
 * Free game chunks are always prefetched. Premium chunks are only prefetched
 * when canPlay returns true for that slug so unentitled sessions never receive
 * premium code (issue #1055).
 */
export function prefetchLobbyGameScreens(canPlay: (slug: string) => boolean): void {
  factories.BlackjackBetting().catch(() => undefined);
  factories.Twenty48().catch(() => undefined);
  factories.Solitaire().catch(() => undefined);
  factories.FreeCell().catch(() => undefined);
  factories.Mahjong().catch(() => undefined);
  factories.DailyWord().catch(() => undefined);

  for (const [key, slug] of PREMIUM_LAZY) {
    if (canPlay(slug)) {
      factories[key]().catch(() => undefined);
    }
  }
}
