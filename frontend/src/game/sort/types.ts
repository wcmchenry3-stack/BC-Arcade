/**
 * Sort Puzzle — shared types (#1175).
 *
 * Pure data. No React, no side effects.
 */

export type Color = "red" | "blue" | "green" | "yellow" | "orange" | "purple" | "pink" | "teal";

/** Max units per bottle — must match DEPTH in backend/sort/generate_levels.py. */
export const BOTTLE_DEPTH = 4;

/** A bottle is a stack of colors, bottom-first. Length <= BOTTLE_DEPTH. */
export type Bottle = readonly Color[];

export interface Move {
  readonly from: number;
  readonly to: number;
}

export interface SortState {
  readonly bottles: readonly Bottle[];
  readonly moveCount: number;
  readonly undosUsed: number;
  readonly isComplete: boolean;
  readonly selectedBottleIndex: number | null;
}
