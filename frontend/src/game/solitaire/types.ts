/**
 * Klondike Solitaire — shared types (#593).
 *
 * Pure data. No React, no AsyncStorage, no side effects. Imported by the
 * engine, UI components, and persistence layer alike.
 */

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];

/** 1 = Ace, 11 = Jack, 12 = Queen, 13 = King. Numeric so rank arithmetic
 * (foundation ascends A→K, tableau descends K→A) stays obvious. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
  readonly faceUp: boolean;
}

/** Draw-1 flips one card per stock click; Draw-3 flips three. Leaderboard is shared. */
export type DrawMode = 1 | 3;

/** 4 foundation piles keyed by suit; each is ascending A→K. */
export type Foundations = Readonly<Record<Suit, readonly Card[]>>;

/** Immutable snapshot of the full game. `_v` is a schema version so
 * persisted saves can be migrated or rejected safely. */
export interface SolitaireState {
  readonly _v: 1;
  readonly drawMode: DrawMode;
  /** 7 columns. Column i starts with i+1 cards (only the top face-up). */
  readonly tableau: readonly (readonly Card[])[];
  readonly foundations: Foundations;
  /** Face-down draw pile. Top of pile = end of array. */
  readonly stock: readonly Card[];
  /** Face-up discard. Top of pile = end of array — that's the playable card. */
  readonly waste: readonly Card[];
  readonly score: number;
  /** Number of times the waste has been recycled back to stock. First recycle is free; 2nd+ costs -50. */
  readonly recycleCount: number;
  /** Prior-state snapshots, most recent last. Capped at 50 entries (FIFO eviction).
   * Nested `undoStack` is always `[]` to prevent exponential nesting. */
  readonly undoStack: readonly SolitaireState[];
  readonly isComplete: boolean;
  /** Timestamp (Date.now()) when the current play session started; null if not yet started or game is over. */
  readonly startedAt: number | null;
  /** Total elapsed milliseconds accumulated across all sessions before the current one. */
  readonly accumulatedMs: number;
  readonly events?: readonly GameEvent[];
  /** Active hint move. Set by applyHint(), cleared after any real move. */
  readonly hint?: Move;
}

export type GameEvent = "cardFlip" | "cardPlace" | "foundationComplete" | "gameWin" | "invalidMove";

/** Card moves are the 5 player actions that shuffle cards between piles.
 * Stock draw and waste recycle are separate operations (no `Move` variant). */
export type Move =
  | { readonly type: "waste-to-tableau"; readonly toCol: number }
  | { readonly type: "waste-to-foundation" }
  | {
      readonly type: "tableau-to-tableau";
      readonly fromCol: number;
      readonly fromIndex: number;
      readonly toCol: number;
    }
  | { readonly type: "tableau-to-foundation"; readonly fromCol: number }
  | { readonly type: "foundation-to-tableau"; readonly fromSuit: Suit; readonly toCol: number };

/** Red suits (hearts, diamonds) must alternate with black (spades, clubs) in the tableau. */
export function cardColor(card: Card): "red" | "black" {
  return card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
}
