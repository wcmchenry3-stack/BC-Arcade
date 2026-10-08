/**
 * FreeCell — shared types (#808).
 *
 * Pure data. No React, no AsyncStorage, no side effects. Imported by the
 * engine, UI components, and persistence layer alike.
 */

import type { Foundations as SharedFoundations } from "../_shared/cards/foundations";
import type { PlayingCard, Suit } from "../_shared/cards/types";

export { cardColor, RANKS, SUITS } from "../_shared/cards/types";
export type { Rank, Suit } from "../_shared/cards/types";

/** All FreeCell cards are always face-up — no faceUp field needed. */
export type Card = PlayingCard;

/** 4 temporary holding cells; each slot holds at most one card. */
export type FreeCells = readonly [Card | null, Card | null, Card | null, Card | null];

/** 4 foundation piles keyed by suit; each is ascending A→K. */
export type Foundations = SharedFoundations<Card>;

export type GameEvent =
  | { readonly type: "cardPlace" }
  | { readonly type: "supermove"; readonly cardCount: number }
  | { readonly type: "foundationComplete"; readonly suit: Suit }
  | { readonly type: "gameWin" }
  | { readonly type: "invalidMove" }
  | { readonly type: "noMovesAvailable" };

/** Immutable snapshot of the full game. `_v` is a schema version. */
export interface FreeCellState {
  readonly _v: 1;
  /** 8 columns. Cols 0–3 start with 7 cards; cols 4–7 start with 6 cards. */
  readonly tableau: readonly (readonly Card[])[];
  readonly freeCells: FreeCells;
  readonly foundations: Foundations;
  /** Prior-state snapshots, most recent last. Capped at 50 entries (FIFO eviction).
   * Nested undoStack is always [] to prevent exponential nesting. */
  readonly undoStack: readonly FreeCellState[];
  readonly isComplete: boolean;
  readonly moveCount: number;
  readonly events?: readonly GameEvent[];
  /** Active hint move. Set by applyHint(), cleared after any real move. */
  readonly hint?: Move;
}

export type Move =
  | {
      readonly type: "tableau-to-tableau";
      readonly fromCol: number;
      /** Index of the first card in the run to move (inclusive). */
      readonly fromIndex: number;
      readonly toCol: number;
    }
  | { readonly type: "tableau-to-freecell"; readonly fromCol: number; readonly toCell: number }
  | { readonly type: "tableau-to-foundation"; readonly fromCol: number }
  | { readonly type: "freecell-to-tableau"; readonly fromCell: number; readonly toCol: number }
  | { readonly type: "freecell-to-foundation"; readonly fromCell: number }
  | {
      readonly type: "foundation-to-tableau";
      readonly fromSuit: Suit;
      readonly toCol: number;
    };
