// Leaf module — keeps navigation param types out of App.tsx to break the
// App.tsx → lazyScreens.ts → *Screen.tsx → App.tsx circular dependency that
// caused a TDZ crash at bundle time (issue #1553).
import type { AiDifficulty, GameState } from "../game/yacht/types";
import type { GameType } from "../api/vocab";

/**
 * The shared leaderboard screen (#2633): one game's board. `partition` picks
 * the board of a partitioned game (e.g. `{ difficulty: "hard" }` for Sudoku,
 * `{ difficulty_tier: "Captain" }` for Star Swarm); a key left out starts on
 * the board's default. Only games with an openable board link here
 * (`hasLeaderboard`).
 */
export type LeaderboardParams = {
  gameType: GameType;
  partition?: Readonly<Record<string, string>>;
  /**
   * Opened from a result card whose rank was still pending: the board is
   * fetched again once local games (and the display name) have synced.
   */
  refreshAfterSync?: boolean;
};

export type RootStackParamList = {
  MainTabs: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
  Game: {
    initialState: GameState;
    aiDifficulty?: AiDifficulty;
    aiState?: GameState;
    /** A restored finished game's session id, for its rank lookup (#2630). */
    finishedGameId?: string;
  };
  Cascade: undefined;
  StarSwarm: undefined;
  BlackjackBetting: undefined;
  BlackjackTable: undefined;
  BlackjackVictory: undefined;
  BlackjackStats: undefined;
  Twenty48: undefined;
  Solitaire: undefined;
  FreeCell: undefined;
  Hearts: undefined;
  Sudoku: undefined;
  Mahjong: undefined;
  MahjongLayoutInspector: undefined;
  MahjongLayoutDetail: { layoutId: string };
  Sort: undefined;
  DailyWord: undefined;
  Leaderboard: LeaderboardParams;
  Scoreboard: {
    gameKey: "hearts" | "yacht" | "blackjack" | "twenty48" | "solitaire" | "sudoku" | "cascade";
  };
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
  GameDetail: { gameId: string };
};
