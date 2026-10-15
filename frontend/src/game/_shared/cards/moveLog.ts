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

/**
 * The most actions one game records, across kills and resumes. The device's
 * session cap (`CARD_MOVES_SESSION_MAX_BYTES`) restarts with every resume, so it
 * bounds a process, not a game: this count (saved with the game) bounds the game.
 */
export const MAX_RECORDED_ACTIONS = 1_200;

/**
 * The most rows (`moves` events, partial chunks from background and blur
 * flushes included) one game records. 1,200 actions are 48 full chunks; the
 * rest of the 60 is room for flush-spam partial chunks. The worst mix (60 rows
 * of 20 worst-size actions, ~570 B as `jsonb` text with the server's 200 B per
 * row) is ~34 KB, under the epic's 40 KB (the bench measures it), and 61 events
 * is well under the 500 of `DEFAULT_CAP`.
 */
export const MAX_RECORDED_ROWS = 60;

/** One recorded action: small non-negative integers, the first is the kind (see each game's replay.ts). */
export type Action = readonly number[];

export interface MoveLog {
  /**
   * Add one action; hands the chunk over when it reaches `size`. Ignored once
   * the game is at its limit (`capped`): nothing more is collected or counted.
   */
  push(action: Action): void;
  /** Hand over what is collected, if anything. */
  flush(): void;
  /**
   * Forget what is collected (it was handed over, or belongs to a game that
   * ended) and count on from `start` actions and `rows` rows, as the game's save says.
   */
  reset(start?: number, rows?: number): void;
  /** Actions logged so far in this game, `start` included. */
  readonly count: number;
  /** Rows handed over so far in this game, `rows` at reset included. */
  readonly rows: number;
  /** The game reached `MAX_RECORDED_ACTIONS` or `MAX_RECORDED_ROWS`: nothing more is logged. */
  readonly capped: boolean;
}

/**
 * The rows count a save carries, as a number: absent is 0 (a game saved
 * before the count existed), and a corrupt value is the limit (the game is not
 * recorded further).
 */
export function savedRows(value: unknown): number {
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : MAX_RECORDED_ROWS;
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
  size: number = MOVES_PER_CHUNK,
  limits: { readonly actions: number; readonly rows: number } = {
    actions: MAX_RECORDED_ACTIONS,
    rows: MAX_RECORDED_ROWS,
  }
): MoveLog {
  let chunk: Action[] = [];
  let count = 0;
  let rows = 0;
  const flush = (): void => {
    if (chunk.length === 0) return;
    const out = chunk;
    chunk = [];
    rows += 1;
    emit(out, count - out.length);
  };
  const capped = (): boolean => count >= limits.actions || rows >= limits.rows;
  return {
    push(action) {
      if (capped()) return;
      chunk.push(action);
      count += 1;
      if (chunk.length >= size) flush();
    },
    flush,
    reset(start = 0, savedRowCount = 0) {
      chunk = [];
      count = start;
      rows = savedRowCount;
    },
    get count() {
      return count;
    },
    get rows() {
      return rows;
    },
    get capped() {
      return capped();
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
