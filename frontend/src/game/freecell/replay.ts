/**
 * FreeCell replay recording (#3289, epic #3273).
 *
 * The deal is recorded once, in `game_started`: `seed` (+ `engine_version`,
 * #3281). `dealGame(seed)` rebuilds the opening (the shuffled deck order), so
 * the deck itself is never sent. Everything the player does after it is one
 * action, a small array of integers whose first number is the kind:
 *
 *     0  [0, from, to, n]  tableau column `from` -> column `to`, the top `n` cards (a supermove when n > 1)
 *     1  [1, from, cell]   tableau column `from` -> free cell `cell`
 *     2  [2, from]         tableau column `from` -> its foundation
 *     3  [3, cell, to]     free cell `cell` -> tableau column `to`
 *     4  [4, cell]         free cell `cell` -> its foundation
 *     5  [5, suit, to]     foundation `suit` (index into SUITS) -> tableau column `to`
 *     6  [6]               undo
 *     7  [7]               hint (no score effect; recorded as a sign the player asked for help)
 *
 * An auto-complete step is the same action plus `AUTO_OFFSET` (16): `[20, 3]`
 * is an auto-complete move of free cell 3 to its foundation. Replaying an
 * action is calling the engine function it names (`applyAction`), so the move
 * count and the undo stack rebuild exactly.
 *
 * Actions go to the shared GameRecorder (`useGameRecorder`) in chunks of
 * `MOVES_PER_CHUNK` (cards/moveLog.ts): a `moves` event is
 * `{ s, m: [action, ...] }` with the recorder's envelope, where `s` is the
 * index of its first action in the game. A chunk is one recorder unit.
 *
 * Cost -> performance -> data: building an action is a few integers in a fresh
 * array; nothing here serialises, stores or schedules, so it is safe in the
 * drag and tap handlers and in each Auto Complete step, which would otherwise
 * cost a save per card. The recorder measures and saves a chunk at an idle
 * moment. A partial chunk is handed over when the game ends, a new one starts,
 * the player leaves or the app is backgrounded (the screen calls `flush`); a
 * kill loses the chunk in progress (at most `MOVES_PER_CHUNK - 1` actions). The
 * saved game carries `recorded`, the actions handed to the log, so a game
 * resumed after a kill carries its `s` and unit numbers on; the lost actions
 * show as a gap in `s`.
 */

import type { Action } from "../_shared/cards/moveLog";
import { applyHint, applyMove, undoMove } from "./engine";
import type { FreeCellState, Move } from "./types";
import { SUITS } from "./types";

/**
 * The action kinds, by number.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const KIND = {
  tableauToTableau: 0,
  tableauToFreeCell: 1,
  tableauToFoundation: 2,
  freeCellToTableau: 3,
  freeCellToFoundation: 4,
  foundationToTableau: 5,
  undo: 6,
  hint: 7,
} as const;

/** Added to a kind for an Auto Complete step. */
export const AUTO_OFFSET = 16;

/** The action for a card move, played from `state` (the board before it). */
export function moveAction(state: FreeCellState, move: Move, auto = false): Action {
  const base = auto ? AUTO_OFFSET : 0;
  switch (move.type) {
    case "tableau-to-tableau": {
      const run = (state.tableau[move.fromCol]?.length ?? 0) - move.fromIndex;
      return [base + KIND.tableauToTableau, move.fromCol, move.toCol, run];
    }
    case "tableau-to-freecell":
      return [base + KIND.tableauToFreeCell, move.fromCol, move.toCell];
    case "tableau-to-foundation":
      return [base + KIND.tableauToFoundation, move.fromCol];
    case "freecell-to-tableau":
      return [base + KIND.freeCellToTableau, move.fromCell, move.toCol];
    case "freecell-to-foundation":
      return [base + KIND.freeCellToFoundation, move.fromCell];
    case "foundation-to-tableau":
      return [base + KIND.foundationToTableau, SUITS.indexOf(move.fromSuit), move.toCol];
  }
}

/** The action for an undo. */
export function undoAction(): Action {
  return [KIND.undo];
}

/** The action for a hint. */
export function hintAction(): Action {
  return [KIND.hint];
}

/** `state` with the count of actions handed to the replay log stamped on it (same object when unchanged). */
export function withRecorded(state: FreeCellState, recorded: number): FreeCellState {
  return state.recorded === recorded ? state : { ...state, recorded };
}

/**
 * Play one recorded action on `state` with the engine, as the screen did.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function applyAction(state: FreeCellState, action: Action): FreeCellState {
  const [code = -1, a = 0, b = 0, c = 0] = action;
  const kind = code >= AUTO_OFFSET ? code - AUTO_OFFSET : code;
  switch (kind) {
    case KIND.tableauToTableau:
      return applyMove(state, {
        type: "tableau-to-tableau",
        fromCol: a,
        fromIndex: (state.tableau[a]?.length ?? 0) - c,
        toCol: b,
      });
    case KIND.tableauToFreeCell:
      return applyMove(state, { type: "tableau-to-freecell", fromCol: a, toCell: b });
    case KIND.tableauToFoundation:
      return applyMove(state, { type: "tableau-to-foundation", fromCol: a });
    case KIND.freeCellToTableau:
      return applyMove(state, { type: "freecell-to-tableau", fromCell: a, toCol: b });
    case KIND.freeCellToFoundation:
      return applyMove(state, { type: "freecell-to-foundation", fromCell: a });
    case KIND.foundationToTableau: {
      const fromSuit = SUITS[a];
      if (fromSuit === undefined) throw new Error(`unknown suit ${a}`);
      return applyMove(state, { type: "foundation-to-tableau", fromSuit, toCol: b });
    }
    case KIND.undo:
      return undoMove(state);
    case KIND.hint:
      return applyHint(state);
    default:
      throw new Error(`unknown action ${code}`);
  }
}
