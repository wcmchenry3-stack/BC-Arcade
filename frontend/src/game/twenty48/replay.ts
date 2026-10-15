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
 * player leaves or the app is backgrounded (the screen calls `flush`). A kill
 * loses the chunk in progress (at most `MOVES_PER_CHUNK - 1` moves): a game
 * resumed after one has a hole there, which shows as a `total` that does not
 * follow from the replay, and its unit numbers and `t_ms` start again.
 */

import type { Direction } from "./engine";
import { SIZE } from "./engine";
import type { Twenty48State } from "./types";

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

/** Collects moves and hands them over `size` at a time. */
export interface MoveLog {
  /** Add one move; hands the chunk over when it reaches `size`. */
  push(move: MoveTuple): void;
  /** Hand over what is collected, if anything. */
  flush(): void;
}

/**
 * A move log. `emit` receives each chunk as a fresh array the log never
 * touches again (the recorder takes `data` by ownership).
 */
export function createMoveLog(
  emit: (moves: MoveTuple[]) => void,
  size: number = MOVES_PER_CHUNK
): MoveLog {
  let chunk: MoveTuple[] = [];
  const flush = (): void => {
    if (chunk.length === 0) return;
    const out = chunk;
    chunk = [];
    emit(out);
  };
  return {
    push(move) {
      chunk.push(move);
      if (chunk.length >= size) flush();
    },
    flush,
  };
}
