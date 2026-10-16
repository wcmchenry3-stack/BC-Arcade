/**
 * Test helper (#3289): plays a scripted, seeded FreeCell game through the real
 * engine and logs every action with the replay builders, the way the screen
 * does. Used by the golden-replay and bench tests.
 */

import type { Action } from "../../../_shared/cards/moveLog";
import {
  applyHint,
  applyMove,
  autoComplete,
  canAutoComplete,
  dealGame,
  getHintMoves,
  nextAutoMove,
  undoMove,
} from "../../engine";
import { hintAction, moveAction, undoAction, AUTO_OFFSET } from "../../replay";
import type { FreeCellState } from "../../types";

export interface Played {
  readonly seed: number;
  readonly opening: FreeCellState;
  readonly actions: Action[];
  readonly final: FreeCellState;
  /** Actions that were Auto Complete steps. */
  readonly autoSteps: number;
}

/** What a replay must reproduce: the board and the move count. */
export function summary(state: FreeCellState) {
  return {
    tableau: state.tableau,
    freeCells: state.freeCells,
    foundations: state.foundations,
    moveCount: state.moveCount,
    isComplete: state.isComplete,
    undoDepth: state.undoStack.length,
  };
}

/** The board as a string, to tell a position the bot has been in. */
function signature(state: FreeCellState): string {
  const id = (c: { suit: string; rank: number } | null) => (c ? `${c.suit[0]}${c.rank}` : "-");
  return JSON.stringify([
    state.tableau.map((col) => col.map(id)),
    [...state.freeCells].map(id).sort(),
    state.foundations.spades.length,
    state.foundations.hearts.length,
    state.foundations.diamonds.length,
    state.foundations.clubs.length,
  ]);
}

/**
 * Plays up to `maxActions` actions: the first hint move that leads somewhere
 * new; every 9th action an undo, every 7th a hint; Auto Complete the moment
 * it can finish the game.
 */
export function playGame(seed: number, maxActions: number): Played {
  const opening = dealGame(seed);
  let state = opening;
  const actions: Action[] = [];
  let autoSteps = 0;
  const seen = new Set<string>([signature(state)]);
  for (let i = 0; actions.length < maxActions && !state.isComplete; i += 1) {
    if (canAutoComplete(state)) {
      while (!state.isComplete && actions.length < maxActions) {
        const move = nextAutoMove(state);
        const next = autoComplete(state);
        if (move === null || next === state) break;
        actions.push(moveAction(state, move, true));
        autoSteps += 1;
        state = next;
      }
      break;
    }
    if (i % 9 === 8 && state.undoStack.length > 0) {
      actions.push(undoAction());
      state = undoMove(state);
      continue;
    }
    const hints = getHintMoves(state);
    if (i % 7 === 3 && hints.length > 0) {
      actions.push(hintAction());
      state = applyHint(state);
      continue;
    }
    const move = hints.find((m) => !seen.has(signature(applyMove(state, m))));
    if (move === undefined) break;
    actions.push(moveAction(state, move));
    state = applyMove(state, move);
    seen.add(signature(state));
  }
  return { seed, opening, actions, final: state, autoSteps };
}

/** True when an action is an Auto Complete step. */
export function isAuto(action: Action): boolean {
  return (action[0] ?? 0) >= AUTO_OFFSET;
}
