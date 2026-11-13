/**
 * Twenty48 state types.
 */

/** One of the two tiles a merge was made from: its id and the cell it started the move in. */
export interface MergeSource {
  id: number;
  row: number;
  col: number;
}

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
  /**
   * The two tiles this merged tile was made from, with the cells they started in (#3689): the
   * renderer slides both into this tile's cell, then pops it. Optional: a save or tile from
   * before it has none, and with none the merged tile just appears and pops, as it always did.
   */
  mergedFrom?: readonly MergeSource[];
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
  /**
   * Replay recording (#3286): the moves logged and rows used by this game so
   * far, so a game resumed after a kill carries its unit numbers and per-game
   * limits on (`withRecorded`, twenty48/replay.ts). Absent before the first move.
   */
  recordedMoves?: number;
  recordedRows?: number;
  /** One-shot events emitted on the move that caused them; undefined otherwise. */
  events?: readonly GameEvent[];
}
