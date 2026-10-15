/**
 * Test helper (#3289): plays a scripted, seeded Klondike game through the real
 * engine and logs every action with the replay builders, the way the screen
 * does. Used by the golden-replay and bench tests.
 */

import type { Action } from "../../../_shared/cards/moveLog";
import {
  applyHint,
  applyMove,
  canAutoComplete,
  dealGame,
  drawFromStock,
  getHintMoves,
  autoCompleteStepOf,
  recycleWaste,
  undo,
} from "../../engine";
import {
  autoAction,
  hintAction,
  moveAction,
  stockAction,
  undoAction,
  AUTO_OFFSET,
} from "../../replay";
import type { DrawMode, SolitaireState } from "../../types";

export interface Played {
  readonly seed: number;
  readonly drawMode: DrawMode;
  readonly opening: SolitaireState;
  readonly actions: Action[];
  readonly final: SolitaireState;
  /** Actions that were Auto Complete steps. */
  readonly autoSteps: number;
}

/** What a replay must reproduce: the board and the score (not the clock). */
export function summary(state: SolitaireState) {
  return {
    tableau: state.tableau,
    foundations: state.foundations,
    stock: state.stock,
    waste: state.waste,
    score: state.score,
    recycleCount: state.recycleCount,
    isComplete: state.isComplete,
    undoDepth: state.undoStack.length,
  };
}

/** The board as a string, to tell a position the bot has been in. */
function signature(state: SolitaireState): string {
  const id = (c: { suit: string; rank: number; faceUp: boolean }) =>
    `${c.suit[0]}${c.rank}${c.faceUp ? "" : "?"}`;
  return JSON.stringify([
    state.tableau.map((col) => col.map(id)),
    state.waste.map(id),
    state.stock.length,
    state.foundations.spades.length,
    state.foundations.hearts.length,
    state.foundations.diamonds.length,
    state.foundations.clubs.length,
  ]);
}

/**
 * Plays up to `maxActions` actions: the first hint move that leads somewhere
 * new, else a stock draw (or a recycle); every 11th action an undo, every 13th
 * a hint; Auto Complete the moment it can finish the game.
 */
export function playGame(seed: number, drawMode: DrawMode, maxActions: number): Played {
  const opening = dealGame(drawMode, seed);
  let state = opening;
  const actions: Action[] = [];
  let autoSteps = 0;
  const seen = new Set<string>([signature(state)]);
  for (let i = 0; actions.length < maxActions && !state.isComplete; i += 1) {
    if (canAutoComplete(state)) {
      while (!state.isComplete && actions.length < maxActions) {
        const { state: next, step } = autoCompleteStepOf(state);
        if (step === null || next === state) break;
        actions.push(autoAction(state, step));
        autoSteps += 1;
        state = next;
      }
      break;
    }
    if (i % 11 === 7 && state.undoStack.length > 0) {
      actions.push(undoAction());
      state = undo(state);
      continue;
    }
    const hints = getHintMoves(state);
    if (i % 13 === 5 && hints.length > 0) {
      actions.push(hintAction());
      state = applyHint(state);
      continue;
    }
    const move = hints.find((m) => !seen.has(signature(applyMove(state, m))));
    if (move !== undefined) {
      actions.push(moveAction(state, move));
      state = applyMove(state, move);
      seen.add(signature(state));
    } else if (state.stock.length > 0) {
      actions.push(stockAction(state));
      state = drawFromStock(state);
      seen.add(signature(state));
    } else if (state.waste.length > 0 && state.recycleCount < 6) {
      actions.push(stockAction(state));
      state = recycleWaste(state);
    } else {
      break;
    }
  }
  return { seed, drawMode, opening, actions, final: state, autoSteps };
}

/** True when an action is an Auto Complete step. */
export function isAuto(action: Action): boolean {
  return (action[0] ?? 0) >= AUTO_OFFSET;
}
