/**
 * Shared types for the stats + games read API (#365).
 *
 * Mirrors the Pydantic response models in backend/games/schemas.py. Keep
 * these in sync when the backend contract changes.
 */

export type { GameOutcome, GameType } from "./vocab";

/** A player participating in a game (#543). Mirrors backend PlayerRef. */
export interface PlayerRef {
  player_id: string;
}

export interface GameTypeStats {
  played: number;
  best: number | null;
  avg: number | null;
  last_played_at: string | null;
  best_chips: number | null;
  current_chips: number | null;
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
