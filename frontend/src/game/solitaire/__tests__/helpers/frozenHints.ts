/**
 * Frozen, test-only copy of the Solitaire hint policy as it was BEFORE #3362
 * (including the unconditional `fromIndex === 0` rule that let a run ping-pong
 * between two columns).
 *
 * Why it exists: `playGame` follows the hint to play long scripted games for
 * the replay and bench fixtures (seeds, action counts, winning seeds). Those
 * tests check replay encode/decode, not hint quality, so they must not move
 * when the production hint heuristics change. Do NOT "fix" this copy, and
 * never import it from production code.
 */

import { canStackOnFoundation } from "../../../_shared/cards/foundations";
import { validateMove } from "../../engine";
import type { Move, SolitaireState } from "../../types";

const TABLEAU_COLUMNS = 7;

function topOf<T>(arr: readonly T[]): T | undefined {
  return arr.length === 0 ? undefined : arr[arr.length - 1];
}

function isProductiveMoveFrozen(state: SolitaireState, move: Move): boolean {
  if (move.type !== "tableau-to-tableau") return true;

  const src = state.tableau[move.fromCol];
  const dst = state.tableau[move.toCol];
  if (src === undefined || dst === undefined) return true;

  if (move.fromIndex === 0) return true;

  const cardBelowRun = src[move.fromIndex - 1];
  if (cardBelowRun !== undefined && !cardBelowRun.faceUp) return true;

  if (
    cardBelowRun !== undefined &&
    canStackOnFoundation(cardBelowRun, state.foundations[cardBelowRun.suit])
  )
    return true;

  const destTop = topOf(dst);
  if (destTop === undefined) return true;

  return false;
}

export function getHintMovesFrozen(state: SolitaireState): Move[] {
  const moves: Move[] = [];

  const wasteFoundation: Move = { type: "waste-to-foundation" };
  if (validateMove(state, wasteFoundation)) moves.push(wasteFoundation);

  for (let col = 0; col < TABLEAU_COLUMNS; col++) {
    const m: Move = { type: "tableau-to-foundation", fromCol: col };
    if (validateMove(state, m)) moves.push(m);
  }

  const revealingMoves: Move[] = [];
  const otherProductiveMoves: Move[] = [];

  for (let fromCol = 0; fromCol < TABLEAU_COLUMNS; fromCol++) {
    const src = state.tableau[fromCol];
    if (!src || src.length === 0) continue;
    let foundForCol = false;
    for (let fromIndex = 0; fromIndex < src.length && !foundForCol; fromIndex++) {
      const card = src[fromIndex];
      if (card === undefined || !card.faceUp) continue;
      for (let toCol = 0; toCol < TABLEAU_COLUMNS; toCol++) {
        if (toCol === fromCol) continue;
        const m: Move = { type: "tableau-to-tableau", fromCol, fromIndex, toCol };
        if (!validateMove(state, m)) continue;
        if (!isProductiveMoveFrozen(state, m)) continue;

        const revealsFaceDown =
          fromIndex > 0 && src[fromIndex - 1] !== undefined && !src[fromIndex - 1]!.faceUp;

        if (revealsFaceDown) {
          revealingMoves.push(m);
        } else {
          otherProductiveMoves.push(m);
        }
        foundForCol = true;
        break;
      }
    }
  }

  moves.push(...revealingMoves);

  for (let toCol = 0; toCol < TABLEAU_COLUMNS; toCol++) {
    const m: Move = { type: "waste-to-tableau", toCol };
    if (validateMove(state, m)) {
      moves.push(m);
      break;
    }
  }

  moves.push(...otherProductiveMoves);

  return moves;
}
