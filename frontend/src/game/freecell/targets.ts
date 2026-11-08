/**
 * Where the selected card or run can go (#3607): the tableau columns, free
 * cells and foundation suits that accept it, so the board can outline them
 * while something is selected. Built on the engine's own `validateMove`, so an
 * outline is never a move the engine would refuse, and a run is only offered a
 * column the supermove capacity allows (`supermoveMax`).
 */

import { validateMove } from "./engine";
import type { FreeCellState, Move, Suit } from "./types";

/** What the player has selected. */
export type FreeCellSelection =
  | { readonly kind: "tableau"; readonly col: number; readonly index: number }
  | { readonly kind: "freecell"; readonly cell: number }
  | { readonly kind: "foundation"; readonly suit: Suit };

export interface FreeCellTargets {
  readonly cols: ReadonlySet<number>;
  readonly cells: ReadonlySet<number>;
  readonly suits: ReadonlySet<Suit>;
}

const NONE: FreeCellTargets = { cols: new Set(), cells: new Set(), suits: new Set() };

export function legalTargets(
  state: FreeCellState,
  selection: FreeCellSelection | null
): FreeCellTargets {
  if (selection === null) return NONE;
  const cols = new Set<number>();
  const cells = new Set<number>();
  const suits = new Set<Suit>();

  for (let toCol = 0; toCol < state.tableau.length; toCol++) {
    let move: Move | null = null;
    if (selection.kind === "freecell") {
      move = { type: "freecell-to-tableau", fromCell: selection.cell, toCol };
    } else if (selection.kind === "foundation") {
      move = { type: "foundation-to-tableau", fromSuit: selection.suit, toCol };
    } else if (selection.col !== toCol) {
      move = {
        type: "tableau-to-tableau",
        fromCol: selection.col,
        fromIndex: selection.index,
        toCol,
      };
    }
    if (move !== null && validateMove(state, move)) cols.add(toCol);
  }

  if (selection.kind === "tableau") {
    // Only a column's top card goes to a free cell or a foundation; a run does not.
    const pile = state.tableau[selection.col];
    const top = pile?.[pile.length - 1];
    if (top !== undefined && selection.index === pile!.length - 1) {
      for (let cell = 0; cell < state.freeCells.length; cell++) {
        const move: Move = { type: "tableau-to-freecell", fromCol: selection.col, toCell: cell };
        if (validateMove(state, move)) cells.add(cell);
      }
      if (validateMove(state, { type: "tableau-to-foundation", fromCol: selection.col })) {
        suits.add(top.suit);
      }
    }
  } else if (selection.kind === "freecell") {
    const card = state.freeCells[selection.cell];
    if (
      card !== null &&
      card !== undefined &&
      validateMove(state, { type: "freecell-to-foundation", fromCell: selection.cell })
    ) {
      suits.add(card.suit);
    }
  }

  return { cols, cells, suits };
}
