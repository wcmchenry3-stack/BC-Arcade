/**
 * Where the selected card or run can go (#3606): the tableau columns and the
 * foundation suits that accept it, so the board can outline them while something
 * is selected. Uses the engine's own `validateMove`, so an outline is never a
 * move the engine would refuse.
 */

import { validateMove } from "./engine";
import type { Move, SolitaireState, Suit } from "./types";

/** What the player has selected. */
export type SolitaireSelection =
  | { readonly kind: "waste" }
  | { readonly kind: "tableau"; readonly col: number; readonly index: number }
  | { readonly kind: "foundation"; readonly suit: Suit };

export interface LegalTargets {
  readonly cols: ReadonlySet<number>;
  readonly suits: ReadonlySet<Suit>;
}

const NONE: LegalTargets = { cols: new Set(), suits: new Set() };

export function legalTargets(
  state: SolitaireState,
  selection: SolitaireSelection | null
): LegalTargets {
  if (selection === null) return NONE;
  const cols = new Set<number>();
  const suits = new Set<Suit>();

  for (let toCol = 0; toCol < state.tableau.length; toCol++) {
    let move: Move | null = null;
    if (selection.kind === "waste") move = { type: "waste-to-tableau", toCol };
    else if (selection.kind === "foundation") {
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

  // Only the top card of the waste or of a column goes to a foundation.
  if (selection.kind === "waste") {
    const top = state.waste[state.waste.length - 1];
    if (top !== undefined && validateMove(state, { type: "waste-to-foundation" })) {
      suits.add(top.suit);
    }
  } else if (selection.kind === "tableau") {
    const pile = state.tableau[selection.col];
    const top = pile?.[pile.length - 1];
    if (
      top !== undefined &&
      selection.index === (pile?.length ?? 0) - 1 &&
      validateMove(state, { type: "tableau-to-foundation", fromCol: selection.col })
    ) {
      suits.add(top.suit);
    }
  }

  return { cols, suits };
}
