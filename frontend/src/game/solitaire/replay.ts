/**
 * Solitaire replay recording (#3289, epic #3273).
 *
 * The deal is recorded once, in `game_started`: `seed` (+ `draw_mode`,
 * `engine_version`, #3281). `dealGame(draw_mode, seed)` rebuilds the opening
 * (the shuffled deck order), so the deck itself is never sent. Everything the
 * player does after it is one action, a small array of integers whose first
 * number is the kind:
 *
 *     0  [0]               draw from the stock (1 or 3 cards)
 *     1  [1]               recycle the waste back to the stock
 *     2  [2]               undo
 *     3  [3]               hint (costs points, so it is part of the score)
 *     4  [4, to]           waste -> tableau column `to`
 *     5  [5]               waste -> foundation
 *     6  [6, from, to, n]  tableau column `from` -> column `to`, the top `n` cards
 *     7  [7, from]         tableau column `from` -> its foundation
 *     8  [8, suit, to]     foundation `suit` (index into SUITS) -> tableau column `to`
 *
 * An auto-complete step is the same action plus `AUTO_OFFSET` (16): `[23, 2]`
 * is an auto-complete move of column 2 to its foundation. Replaying an action
 * is calling the engine function it names (`applyAction`), so the score, the
 * undo stack and the stock cycle rebuild exactly; a card's face-up flip and the
 * +5 for it follow from the move.
 *
 * Actions go to the shared GameRecorder (`useGameRecorder`) in chunks of
 * `MOVES_PER_CHUNK` (cards/moveLog.ts): a `moves` event is
 * `{ s, m: [action, ...] }` with the recorder's envelope, where `s` is the
 * index of its first action in the game. A chunk is one recorder unit.
 *
 * Cost -> performance -> data: building an action is a handful of integers in
 * a fresh array; nothing here serialises, stores or schedules, so it is safe in
 * the tap and drag handlers and in each Auto Complete step, which would
 * otherwise cost a save per card. The recorder measures and saves a chunk at an
 * idle moment. A partial chunk is handed over when the game ends, a new one
 * starts, the player leaves or the app is backgrounded (the screen calls
 * `flush`); a kill loses the chunk in progress (at most `MOVES_PER_CHUNK - 1`
 * actions). The saved game carries `recorded`, the actions handed to the log,
 * so a game resumed after a kill carries its `s` and unit numbers on; the lost
 * actions show as a gap in `s`.
 */

import type { Action } from "../_shared/cards/moveLog";
import { applyHint, applyMove, drawFromStock, recycleWaste, undo, type AutoStep } from "./engine";
import type { Move, SolitaireState } from "./types";
import { SUITS } from "./types";

/**
 * The action kinds, by number.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const KIND = {
  draw: 0,
  recycle: 1,
  undo: 2,
  hint: 3,
  wasteToTableau: 4,
  wasteToFoundation: 5,
  tableauToTableau: 6,
  tableauToFoundation: 7,
  foundationToTableau: 8,
} as const;

/** Added to a kind for an Auto Complete step. */
export const AUTO_OFFSET = 16;

/** The action for a card move, played from `state` (the board before it). */
export function moveAction(state: SolitaireState, move: Move, auto = false): Action {
  const base = auto ? AUTO_OFFSET : 0;
  switch (move.type) {
    case "waste-to-tableau":
      return [base + KIND.wasteToTableau, move.toCol];
    case "waste-to-foundation":
      return [base + KIND.wasteToFoundation];
    case "tableau-to-tableau": {
      const run = (state.tableau[move.fromCol]?.length ?? 0) - move.fromIndex;
      return [base + KIND.tableauToTableau, move.fromCol, move.toCol, run];
    }
    case "tableau-to-foundation":
      return [base + KIND.tableauToFoundation, move.fromCol];
    case "foundation-to-tableau":
      return [base + KIND.foundationToTableau, SUITS.indexOf(move.fromSuit), move.toCol];
  }
}

/** The action for pressing the stock from `state`: a draw, or a recycle once the stock is empty. */
export function stockAction(state: SolitaireState): Action {
  return [state.stock.length > 0 ? KIND.draw : KIND.recycle];
}

/** The action for an undo. */
export function undoAction(): Action {
  return [KIND.undo];
}

/** The action for a hint. */
export function hintAction(): Action {
  return [KIND.hint];
}

/** The action for one Auto Complete step (`autoCompleteStepOf`), taken from `state`. */
export function autoAction(state: SolitaireState, step: AutoStep): Action {
  return step.type === "draw" ? [AUTO_OFFSET + KIND.draw] : moveAction(state, step, true);
}

/**
 * `state` with the replay log's counts stamped on it (same object when
 * unchanged): the actions logged and the rows handed over, saved with the game.
 */
export function withRecorded(
  state: SolitaireState,
  recorded: number,
  rows: number
): SolitaireState {
  return state.recorded === recorded && state.recordedRows === rows
    ? state
    : { ...state, recorded, recordedRows: rows };
}

/**
 * `state` without its `recorded` count. A game that stopped recording (see
 * `recordedStart`) drops it, so a later load sees a game with history and no
 * count, which is not recorded, instead of resuming the old count under a new,
 * seedless session.
 */
export function withoutRecorded(state: SolitaireState): SolitaireState {
  if (state.recorded === undefined && state.recordedRows === undefined) return state;
  const { recorded: _recorded, recordedRows: _rows, ...rest } = state;
  return rest;
}

/**
 * Where the replay log of a game restored from a save starts counting: the
 * save's `recorded` when it is a non-negative integer, 0 for a save with no
 * count (or a corrupt one) and no history, and null for one with no usable
 * count and history, whose earlier actions were never recorded: a log starting
 * at 0 would rebuild the wrong board, so that game is not recorded.
 */
export function recordedStart(state: SolitaireState): number | null {
  const recorded: unknown = state.recorded;
  if (typeof recorded === "number" && Number.isInteger(recorded) && recorded >= 0) return recorded;
  // `score` and `recycleCount` are redundant safety: an empty `undoStack` means the original deal.
  return state.undoStack.length > 0 || state.score > 0 || state.recycleCount > 0 ? null : 0;
}

/**
 * Play one recorded action on `state` with the engine, as the screen did.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function applyAction(state: SolitaireState, action: Action): SolitaireState {
  const [code = -1, a = 0, b = 0, c = 0] = action;
  const kind = code >= AUTO_OFFSET ? code - AUTO_OFFSET : code;
  switch (kind) {
    case KIND.draw:
      return drawFromStock(state);
    case KIND.recycle:
      return recycleWaste(state);
    case KIND.undo:
      return undo(state);
    case KIND.hint:
      return applyHint(state);
    case KIND.wasteToTableau:
      return applyMove(state, { type: "waste-to-tableau", toCol: a });
    case KIND.wasteToFoundation:
      return applyMove(state, { type: "waste-to-foundation" });
    case KIND.tableauToTableau:
      return applyMove(state, {
        type: "tableau-to-tableau",
        fromCol: a,
        fromIndex: (state.tableau[a]?.length ?? 0) - c,
        toCol: b,
      });
    case KIND.tableauToFoundation:
      return applyMove(state, { type: "tableau-to-foundation", fromCol: a });
    case KIND.foundationToTableau: {
      const fromSuit = SUITS[a];
      if (fromSuit === undefined) throw new Error(`unknown suit ${a}`);
      return applyMove(state, { type: "foundation-to-tableau", fromSuit, toCol: b });
    }
    default:
      throw new Error(`unknown action ${code}`);
  }
}
