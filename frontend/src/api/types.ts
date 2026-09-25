/**
 * Shared types for the stats + games read API (#365).
 *
 * Mirrors the Pydantic response models in backend/games/schemas.py. Keep
 * these in sync when the backend contract changes.
 */

import type { GameOutcome, GameType } from "./vocab";

export type { GameOutcome, GameType };

/** A player participating in a game (#543). Mirrors backend PlayerRef. */
export interface PlayerRef {
  player_id: string;
}

/** Game-specific figures in `GameTypeStats.extras`, e.g. Blackjack's chips. */
export type GameStatsExtras = Record<string, number | string | boolean | null>;

/**
 * One game's stats in `/stats/me`. Full field meanings: `GameTypeStatsResponse`
 * in backend/games/schemas.py.
 */
export interface GameTypeStats {
  // Deprecated aliases (#2620), kept for current store builds until #2644:
  // `played` (= `sessions`), `best` (highest final_score, whatever the
  // direction), `avg`, and Blackjack's `best_chips` / `current_chips`, which
  // mirror `extras`. New code reads the comparable fields below.
  played: number;
  best: number | null;
  avg: number | null;
  last_played_at: string | null;
  best_chips: number | null;
  current_chips: number | null;

  // Comparable fields (#2620). Optional only because a server older than
  // #2620 omits them; a current server always sends them.
  /** Finished games, abandons included. */
  sessions?: number;
  /** Finished games minus abandons (the Arcade XP input). */
  completed?: number;
  /**
   * Games with outcome `win` / `loss` / `push`. All three are null when the
   * game has no win concept for this player (show "—").
   * Win rate = won / (won + lost + tied).
   */
  won?: number | null;
  lost?: number | null;
  tied?: number | null;
  /**
   * Runs of consecutive wins by completion time. A loss ends a run; ties,
   * abandons and score-only finishes are skipped. Null with the win fields.
   */
  current_win_streak?: number | null;
  best_win_streak?: number | null;
  /**
   * Reported play time only: the sum of each game's `duration_ms` where it is
   * > 0 (24 h cap per game). Games with no reported duration add nothing, so
   * idle or backgrounded time is never counted.
   */
  time_played_ms?: number;
  /**
   * Best value of the game's board metric, in the board's direction, over
   * games whose outcome qualifies for the board (Daily Word: wins only). Null
   * when no qualifying game has the metric.
   */
  best_value?: number | null;
  /** i18n key for what `best_value` counts: "score", "moves", "level", … */
  best_label_key?: string | null;
  extras?: GameStatsExtras;
}

export interface StatsResponse {
  total_games: number;
  by_game: Record<string, GameTypeStats>;
  favorite_game: string | null;
  // Arcade XP + player level (#2391) — derived server-side in games/progression.py.
  // At max level xp_for_next_level is 0 and xp_into_level keeps accruing.
  arcade_xp: number;
  arcade_level: number;
  xp_into_level: number;
  xp_for_next_level: number;
  // Consecutive local days with 2+ daily-challenge goals done (#2456/#2457). Counts the
  // player's local days via the tz_offset_minutes the client sends. Always sent by a current
  // server; HomeScreen still guards against a missing value during a staggered deploy.
  streak_days: number;
}

export interface GameRow {
  id: string;
  game_type: GameType;
  started_at: string;
  completed_at: string | null;
  final_score: number | null;
  outcome: GameOutcome | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  players: PlayerRef[];
}

export interface GameHistoryResponse {
  items: GameRow[];
  next_cursor: string | null;
}

export interface GameEventRow {
  event_index: number;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

export interface GameDetailResponse extends GameRow {
  events?: GameEventRow[] | null;
}

/** Why `GET /games/{id}/rank` has no rank to report. Mirrors backend `RankReason`. */
export type GameRankReason = "no_name" | "not_finished" | "not_rankable" | "board_disabled";

/**
 * `GET /games/{id}/rank` (#2677): where one of the caller's games puts them
 * on its board. Mirrors backend `GameRankResponse`. `rank` (exact, 1-based)
 * is the rank of the player's best entry in that game's partition; `is_best`
 * says whether this game is that entry. Both are null when `ranked` is false,
 * and `reason` says why:
 *
 *   board_disabled — the game has no leaderboard
 *   not_finished   — no completion or value yet (usually still syncing)
 *   not_rankable   — this game can never rank (abandoned, over the cap…)
 *   no_name        — the player has no display name on the server
 */
export interface GameRankResponse {
  readonly rank: number | null;
  readonly is_best: boolean | null;
  readonly ranked: boolean;
  readonly reason: GameRankReason | null;
}
