/**
 * 2048 replay recording (#3286, epic #3273).
 *
 * A game's opening board is in `game_started`; this records what the player
 * did after it, compactly enough that the opening board plus the moves rebuild
 * the final board and score. One move is a 5-tuple
 *
 *     [direction, cell, value, gained, total]
 *
 *   - `direction`: `DIRECTION_ORDER` index — 0 up, 1 down, 2 left, 3 right;
 *   - `cell`, `value`: the tile the move spawned — `row * SIZE + col`, and 2 or 4;
 *   - `gained`, `total`: the points the move scored and the running total.
 *
 * Replaying a move is: slide and merge the board in `direction` (the engine's
 * rule), put `value` at `cell`. The slide is deterministic and the spawn is
 * the only random part, which is why the spawn is what is recorded. `total`
 * repeats what replaying the scores would give; it lets a reader check a
 * stretch of play it can trust, and spot a hole in one (a resumed game, below).
 * Whether a move won or ended the game is not recorded: replaying shows it, and
 * `game_ended` carries the result.
 *
 * Moves go to the shared GameRecorder (`useGameRecorder`) in chunks of
 * `MOVES_PER_CHUNK`: a `moves` event holds a chunk, in `m`, and each chunk is
 * one recorder unit, so a 2,000-move game is 80 saves where it was 2,000
 * (one `move` event and one storage write per swipe).
 *
 * Cost → performance → data: building a tuple is a scan of 16 tiles and an
 * array of five numbers — no `JSON.stringify`, no storage, no allocation
 * beyond the tuple; the chunk is handed to the recorder (memory only) once per
 * `MOVES_PER_CHUNK` moves, and the recorder measures and saves it at an idle
 * moment, never inside the swipe's handler.
 *
 * A partial chunk is handed over when the game ends, a new one starts, the
 * player leaves or the app goes to the background (the screen calls `flush`;
 * not on `inactive`). A kill loses the chunk in progress (at most
 * `MOVES_PER_CHUNK - 1` moves): a game resumed after one has a hole there,
 * which shows as a `total` that does not follow from the replay, and as a
 * skipped unit number.
 *
 * Per-game limits: the recorder's byte cap restarts with every process, so the
 * game bounds itself with two counts saved in its state (`recordedMoves`,
 * `recordedRows`, stamped on every move by `withRecorded`): at
 * `MAX_RECORDED_MOVES` moves or `MAX_RECORDED_ROWS` rows the log stops. A game
 * resumed after a kill starts its log at the saved counts (`reset`), so its
 * unit numbers carry on (unit = row number) and the limits hold across kills.
 * The saved row count includes the chunk in progress, so a flush on the way
 * out never needs another save, and a chunk a kill lost still uses its number.
 */

import type { Direction } from "./engine";
import { SIZE } from "./engine";
import type { Twenty48State } from "./types";
import { captureThrottledMessage } from "../_shared/sentryThrottle";

/** Swipes per `moves` event (and recorder unit). Sized in docs/games/twenty48.md ("Replay recording"). */
export const MOVES_PER_CHUNK = 25;

/**
 * The direction codes, by index.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export const DIRECTION_ORDER: readonly Direction[] = ["up", "down", "left", "right"];

const DIRECTION_CODE: Readonly<Record<Direction, number>> = {
  up: 0,
  down: 1,
  left: 2,
  right: 3,
};

/** One recorded move: `[direction, cell, value, gained, total]`. */
export type MoveTuple = readonly [number, number, number, number, number];

/**
 * The tuple for the move that produced `next`, or null when no tile spawned
 * (the engine always spawns after a move that changed the board, so null is a
 * state this was not called with).
 */
export function moveTuple(direction: Direction, next: Twenty48State): MoveTuple | null {
  for (const tile of next.tiles) {
    if (tile.isNew) {
      return [
        DIRECTION_CODE[direction],
        tile.row * SIZE + tile.col,
        tile.value,
        next.scoreDelta,
        next.score,
      ];
    }
  }
  return null;
}

/**
 * The most moves one game records, across kills and resumes: 44 full chunks.
 * Sized so the worst game the two limits allow is under the epic's 40 KB per
 * game, stored (docs/games/twenty48.md, "Size against the budget"). A game to
 * the 2048 tile takes about 950 to 1,200 swipes (each spawns 2.2 on average,
 * and the board then sums 2,048 and more), so a long win loses its last moves.
 */
export const MAX_RECORDED_MOVES = 1_100;

/**
 * The most rows (`moves` events, partial chunks from background and blur
 * flushes included) one game records: the 44 full chunks of
 * `MAX_RECORDED_MOVES` and 10 for partial ones.
 */
export const MAX_RECORDED_ROWS = 54;

/** A move log's limits: moves and rows per game. */
export interface MoveLogLimits {
  readonly moves: number;
  readonly rows: number;
}

const GAME_LIMITS: MoveLogLimits = { moves: MAX_RECORDED_MOVES, rows: MAX_RECORDED_ROWS };

/** Collects moves and hands them over `size` at a time. */
export interface MoveLog {
  /** Add one move; hands the chunk over when it reaches `size`. Ignored once `capped`. */
  push(move: MoveTuple): void;
  /** Hand over what is collected, if anything. */
  flush(): void;
  /**
   * Forget what is collected and count on from `moves` moves and `rows` rows,
   * as the game's save says (0 and 0 for a new game).
   */
  reset(moves?: number, rows?: number): void;
  /** Moves logged in this game, the saved count included. */
  readonly moves: number;
  /** Rows this game has used: handed over, plus the chunk in progress if it holds a move. */
  readonly rows: number;
  /** The game reached a limit: nothing more is logged. */
  readonly capped: boolean;
}

/**
 * A move log. `emit(moves, unit)` receives each chunk as a fresh array the
 * log never touches again (the recorder takes `data` by ownership), and its
 * unit number: the row's number in the game, 1-based.
 */
export function createMoveLog(
  emit: (moves: MoveTuple[], unit: number) => void,
  size: number = MOVES_PER_CHUNK,
  limits: MoveLogLimits = GAME_LIMITS
): MoveLog {
  let chunk: MoveTuple[] = [];
  let moves = 0;
  let handed = 0;
  const flush = (): void => {
    if (chunk.length === 0) return;
    const out = chunk;
    chunk = [];
    handed += 1;
    emit(out, handed);
  };
  // A new chunk needs a free row; a chunk in progress may fill up.
  const capped = (): boolean =>
    moves >= limits.moves || (chunk.length === 0 && handed >= limits.rows);
  return {
    push(move) {
      if (capped()) return;
      chunk.push(move);
      moves += 1;
      if (chunk.length >= size) flush();
    },
    flush,
    reset(savedMoves = 0, savedRows = 0) {
      chunk = [];
      moves = savedMoves;
      handed = savedRows;
    },
    get moves() {
      return moves;
    },
    get rows() {
      return handed + (chunk.length > 0 ? 1 : 0);
    },
    get capped() {
      return capped();
    },
  };
}

/**
 * A count from a save, as a number: absent is 0 (a game saved before the
 * counts existed), and a corrupt value is `limit` (the game is not recorded
 * further).
 */
function savedCount(value: unknown, limit: number): number {
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : limit;
}

/** Where a saved game's log starts: `[moves, rows]`, each absent as 0 and corrupt as its limit. */
export function savedPosition(state: Twenty48State): [number, number] {
  return [
    savedCount(state.recordedMoves, MAX_RECORDED_MOVES),
    savedCount(state.recordedRows, MAX_RECORDED_ROWS),
  ];
}

/**
 * `state` with the log's counts stamped on it (same object when unchanged),
 * saved with the game so a resumed game carries them on.
 */
export function withRecorded(state: Twenty48State, log: MoveLog): Twenty48State {
  const { moves, rows } = log;
  return state.recordedMoves === moves && state.recordedRows === rows
    ? state
    : { ...state, recordedMoves: moves, recordedRows: rows };
}

/**
 * Run a recording call from a gameplay handler so that a failure in it never
 * reaches play: it is reported (throttled, one fixed-text Sentry warning per
 * app session) and swallowed.
 */
export function guardRecording(call: () => void): void {
  try {
    call();
  } catch (e) {
    captureThrottledMessage("twenty48Replay", "twenty48 replay: recording failed, play continues", {
      level: "warning",
      tags: { subsystem: "twenty48Replay", game_type: "twenty48" },
      extra: { error: e instanceof Error ? e.name : typeof e },
    });
  }
}
