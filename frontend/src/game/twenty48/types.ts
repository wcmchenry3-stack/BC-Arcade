/**
 * Twenty48 state types.
 */

export interface TileData {
  id: number;
  value: number;
  row: number;
  col: number;
  /** null = newly spawned this turn (no slide animation) */
  prevRow: number | null;
  prevCol: number | null;
  /** true = spawned this turn — triggers scale-in animation */
  isNew: boolean;
  /** true = result of a merge this turn — triggers pop animation */
  isMerge: boolean;
}

export type GameEvent = "win2048" | "gameOver";

export interface Twenty48State {
  board: number[][];
  tiles: TileData[];
  score: number;
  /** Points gained on the most recent move (drives score-delta flash). */
  scoreDelta: number;
  game_over: boolean;
  has_won: boolean;
  /** Timestamp (Date.now()) when the current play session started; null if not yet started or game is over. */
  startedAt: number | null;
  /** Total elapsed milliseconds accumulated across all sessions before the current one. */
  accumulatedMs: number;
  /** The clock is paused (the player is away), not merely stopped: see `PlayClock`. */
  paused?: boolean;
  /** One-shot events emitted on the move that caused them; undefined otherwise. */
  events?: readonly GameEvent[];
}
