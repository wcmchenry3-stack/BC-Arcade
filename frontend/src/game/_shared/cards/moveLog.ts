/**
 * The in-memory move log the card games (Solitaire, FreeCell) record through
 * (#3289, epic #3273).
 *
 * A game pushes one compact action (`number[]`) per player action; the log
 * hands them over `size` at a time, as a fresh array the log never touches
 * again (the recorder takes `data` by ownership). Nothing here serialises,
 * stores or schedules: `push` is an array append, so it is safe on the drag,
 * tap and auto-complete-animation paths.
 *
 * The log also counts the actions it has seen (`count`), which the game keeps
 * in its saved state: a game resumed after a kill starts its log at that
 * count (`reset(count)`), so the next chunk's first-action index and unit
 * number carry on from the saved game. Actions in the chunk a kill cut short
 * are missing from the stored game; the first-action index `first` of the next
 * chunk shows the hole.
 */

import { captureThrottledMessage } from "../sentryThrottle";

/** Actions per `moves` event (and recorder unit). Sized in docs/games/solitaire.md ("Replay recording"). */
export const MOVES_PER_CHUNK = 25;

/** One recorded action: small non-negative integers, the first is the kind (see each game's replay.ts). */
export type Action = readonly number[];

export interface MoveLog {
  /** Add one action; hands the chunk over when it reaches `size`. */
  push(action: Action): void;
  /** Hand over what is collected, if anything. */
  flush(): void;
  /** Forget what is collected (it was handed over, or belongs to a game that ended) and count on from `start`. */
  reset(start?: number): void;
  /** Actions seen so far in this game, `start` included. */
  readonly count: number;
}

/** The recorder unit of the chunk whose first action is number `first` (0-based): 1 for the first `size` actions. */
function chunkUnit(first: number, size: number = MOVES_PER_CHUNK): number {
  return Math.floor(first / size) + 1;
}

/**
 * A move log. `emit(actions, first)` receives each chunk and the 0-based
 * index of its first action in the game.
 */
export function createMoveLog(
  emit: (actions: Action[], first: number) => void,
  size: number = MOVES_PER_CHUNK
): MoveLog {
  let chunk: Action[] = [];
  let count = 0;
  const flush = (): void => {
    if (chunk.length === 0) return;
    const out = chunk;
    chunk = [];
    emit(out, count - out.length);
  };
  return {
    push(action) {
      chunk.push(action);
      count += 1;
      if (chunk.length >= size) flush();
    },
    flush,
    reset(start = 0) {
      chunk = [];
      count = start;
    },
    get count() {
      return count;
    },
  };
}

/** The part of `useGameRecorder` a chunk is recorded through. */
export interface MovesSink {
  beginUnit: (n?: number) => number;
  record: (type: "moves", data?: Record<string, unknown>) => void;
  closeUnit: () => void;
}

/**
 * Record one chunk as one `moves` event in its own recorder unit,
 * `{ s: first, m: actions }` plus the recorder's envelope. The unit number
 * comes from `first` (`chunkUnit`), so a game resumed after a kill carries
 * its numbering on from its saved action count. Memory only: the recorder
 * measures and saves the unit at an idle moment.
 */
export function recordChunk(sink: MovesSink, actions: Action[], first: number): void {
  sink.beginUnit(chunkUnit(first));
  sink.record("moves", { s: first, m: actions });
  sink.closeUnit();
}

/**
 * Run a recording call from a gameplay handler so that a failure in it never
 * reaches play: it is reported (throttled, one fixed-text Sentry warning per
 * game per app session) and swallowed.
 */
export function guardRecording(game: string, call: () => void): void {
  try {
    call();
  } catch (e) {
    captureThrottledMessage(`cardReplay.${game}`, "card replay: recording failed, play continues", {
      level: "warning",
      tags: { subsystem: "cardReplay", game_type: game },
      extra: { error: e instanceof Error ? e.name : typeof e },
    });
  }
}
