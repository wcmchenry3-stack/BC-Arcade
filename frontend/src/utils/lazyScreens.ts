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
  BlackjackStats: () => import("../screens/BlackjackStatsScreen"),
  Twenty48: () => import("../screens/Twenty48Screen"),
  Solitaire: () => import("../screens/SolitaireScreen"),
  FreeCell: () => import("../screens/FreeCellScreen"),
  Hearts: () => import("../screens/HeartsScreen"),
  Sudoku: () => import("../screens/SudokuScreen"),
  Mahjong: () => import("../screens/MahjongScreen"),
  MahjongLayoutInspector: () => import("../screens/MahjongLayoutInspectorScreen"),
  MahjongLayoutDetail: () => import("../screens/MahjongLayoutDetailScreen"),
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
  BlackjackStats: React.lazy(factories.BlackjackStats),
  Twenty48: React.lazy(factories.Twenty48),
  Solitaire: React.lazy(factories.Solitaire),
  FreeCell: React.lazy(factories.FreeCell),
  Hearts: React.lazy(factories.Hearts),
  Sudoku: React.lazy(factories.Sudoku),
  Mahjong: React.lazy(factories.Mahjong),
  MahjongLayoutInspector: React.lazy(factories.MahjongLayoutInspector),
  MahjongLayoutDetail: React.lazy(factories.MahjongLayoutDetail),
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

// Max simultaneous Metro bundle requests. Windows Node.js defaults to 512 fds;
// PR #1777 split sounds/images into per-game modules so each lazy chunk opens
// more files than before. Capping at 3 prevents EMFILE on Windows (#1788).
const PREFETCH_CONCURRENCY = 3;

function runThrottled(tasks: Array<() => Promise<unknown>>): void {
  let index = 0;
  let running = 0;

  function next(): void {
    while (running < PREFETCH_CONCURRENCY && index < tasks.length) {
      running++;
      const task = tasks[index++];
      task().then(
        () => { running--; next(); },
        () => { running--; next(); },
      );
    }
  }

  next();
}

/**
 * Fire-and-forget prefetch of lobby game chunks. Called from HomeScreen after
 * interactions settle so the Suspense fallback doesn't flash when the user
 * taps into a game (issue #706). Safe to call multiple times — the module
 * loader dedupes.
 *
 * Free game chunks are always prefetched. Premium chunks are only prefetched
 * when canPlay returns true for that slug so unentitled sessions never receive
 * premium code (issue #1055).
 *
 * Imports are throttled to PREFETCH_CONCURRENCY to avoid EMFILE on Windows
 * where Node.js caps open file descriptors at 512 (#1788).
 */
export function prefetchLobbyGameScreens(canPlay: (slug: string) => boolean): void {
  const tasks: Array<() => Promise<unknown>> = [
    factories.BlackjackBetting,
    factories.Twenty48,
    factories.Solitaire,
    factories.FreeCell,
    factories.Mahjong,
    factories.DailyWord,
    ...PREMIUM_LAZY
      .filter(([, slug]) => canPlay(slug))
      .map(([key]) => factories[key]),
  ];
  runThrottled(tasks);
}
