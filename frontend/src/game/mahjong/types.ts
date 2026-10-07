/**
 * Mahjong Solitaire — shared types (#891).
 *
 * Pure data. No React, no AsyncStorage, no side effects. Imported by the
 * engine, UI components, and persistence layer alike.
 */

export type Suit =
  "characters" | "circles" | "bamboos" | "winds" | "dragons" | "flowers" | "seasons";

/** Rank 1–9 covers all suits; suits with fewer ranks (e.g. dragons 1–3) simply
 * never use the higher values. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface Tile {
  readonly suit: Suit;
  readonly rank: Rank;
  /**
   * 1-based SVG asset index matching the filenames in assets/mahjong/:
   *   01 = white dragon … 07 = north wind
   *   08–16 = characters 1–9
   *   17–25 = circles 1–9
   *   26–34 = bamboos 1–9
   *   35–38 = seasons (spring/summer/autumn/winter)
   *   39–42 = flowers (plum/orchid/chrysanthemum/bamboo)
   */
  readonly faceId: number;
}

/** A tile instance placed on the board. */
export interface SlotTile extends Tile {
  /** Unique tile instance id within a game (0–143). */
  readonly id: number;
  /**
   * Left column edge. Tiles are 2 grid units wide; adjacent tiles in the same
   * row step by 2 (e.g. cols 4, 6, 8 …). Stacked tiles sit at the same col.
   */
  readonly col: number;
  readonly row: number;
  readonly layer: number;
}

/** A position on the layout (col/row/layer) before a tile is placed there. */
export interface Slot {
  readonly col: number;
  readonly row: number;
  readonly layer: number;
}

/** A layout is a static list of slot positions totalling 144. */
export type Layout = readonly Slot[];

/** Metadata entry for a named board layout in the registry. */
export interface LayoutMeta {
  readonly id: string;
  readonly name: string;
  /** 1 = free, 2 = premium. */
  readonly tier: 1 | 2;
  readonly tileCount: number;
  /** Raw JSON data: flat array of {col, row, layer} objects. */
  readonly data: readonly { col: number; row: number; layer: number }[];
}

/** A tile a match removed, and its index in `tiles` just before the match. */
export interface RemovedTile {
  readonly index: number;
  readonly tile: SlotTile;
}

/**
 * The state fields a move changes besides the board, as they were before it.
 * There is no clock here: an undo keeps the live clock (#2750, `undoMove`).
 */
interface UndoEntryBase {
  readonly scoreBefore: number;
  readonly pairsRemovedBefore: number;
  readonly shufflesLeftBefore: number;
  readonly selectedBefore: SlotTile | null;
  readonly isCompleteBefore: boolean;
  readonly isDeadlockedBefore: boolean;
}

/** A matched pair: `undoMove` puts both tiles back at their indices (#2961). */
export interface MatchUndoEntry extends UndoEntryBase {
  readonly kind: "match";
  /** Ascending by `index`. */
  readonly removedTiles: readonly [RemovedTile, RemovedTile];
}

/**
 * A shuffle renumbers and re-faces every tile, so it keeps the whole board
 * from before it; null when the shuffle left the board as it was (a
 * geometric deadlock). At most `MAX_SHUFFLES` of these per game.
 */
export interface ShuffleUndoEntry extends UndoEntryBase {
  readonly kind: "shuffle";
  readonly tilesBefore: readonly SlotTile[] | null;
}

/** One undoable move, stored as what it changed rather than a board snapshot (#2961). */
export type MahjongUndoEntry = MatchUndoEntry | ShuffleUndoEntry;

/** Immutable snapshot of a Mahjong Solitaire game. `_v` is a schema version
 * so persisted saves can be migrated or rejected safely: 2 since undo entries
 * became deltas (#2961); a version 1 save held full snapshots. */
export interface MahjongState {
  readonly _v: 2;
  /** All tiles currently on the board. Removed tiles are absent. */
  readonly tiles: readonly SlotTile[];
  readonly pairsRemoved: number;
  readonly score: number;
  readonly shufflesLeft: number;
  /** Tile awaiting a match, or null. */
  readonly selected: SlotTile | null;
  /** What each undoable move changed, most recent last. Capped at UNDO_CAP. */
  readonly undoStack: readonly MahjongUndoEntry[];
  readonly isComplete: boolean;
  /** True when no free matching pairs remain and no shuffles are left. */
  readonly isDeadlocked: boolean;
  /** Timestamp (Date.now()) when the current play session started; null if
   * no move has been made yet. */
  readonly startedAt: number | null;
  /** Accumulated elapsed milliseconds from all sessions before the current. */
  readonly accumulatedMs: number;
  /** The clock is paused (the player is away), not merely stopped: see `PlayClock`. */
  readonly paused?: boolean;
  /** Short 4-char hex identifier computed from the dealt face sequence.
   * Changes on every new deal; lets players confirm they have a fresh shuffle. */
  readonly dealId: string;
  /** Registry ID of the layout used for this game (e.g. "turtle").
   * Optional so old persisted saves without this field remain valid. */
  readonly currentLayoutId?: string;
}
