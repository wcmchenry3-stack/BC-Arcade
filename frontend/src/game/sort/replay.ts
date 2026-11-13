/**
 * Sort replay recording (#3384, epic #3383).
 *
 * A step log, not a visual replay. `game_started` carries `{ level, catalog,
 * engine_version }` (`SORT_REPLAY_ENGINE_VERSION`): the opening board is always
 * `(catalog, level)` from the shipped catalog (`levels.catalog.json`), with no
 * fallback board in the event, so a catalog bump keeps the old catalog file.
 * What the player did after it is recorded as `moves` events: the opening board
 * plus the `moves` rows in `event_index` order rebuild the final board, move
 * count and undo count. One action is an entry of `m`, a number tuple:
 *
 *     [0, from, to]   a committed pour (recorded when it lands; the engine
 *                     decides the colour and how much moves)
 *     [1]             an undo that changed the board
 *     [2, from, to]   a hint shown (changes nothing; for difficulty analysis)
 *     [3, n]          "back to last good move", rewinding n moves (each one
 *                     counts as an undo: `undosUsed += n`, as the screen's
 *                     handler calls the engine's `undo` n times)
 *
 * What is not recorded: bottle selections, refused pours, cancelled pour
 * animations, a hint that found nothing, an undo with empty history (the engine
 * treats it as a no-op), the clock (`t_ms` of the recorder's envelope gives the
 * pace), and any state the engine derives (colours, completion).
 *
 * Cost -> performance -> data:
 *  - Actions are pushed to an in-memory array, `ACTIONS_PER_CHUNK` at a time (a
 *    chunk is one `moves` event and one recorder unit), so a level of 40 pours is
 *    two events and two storage writes, not 40.
 *  - Building an entry is an array of two or three small integers. No
 *    `JSON.stringify`, no storage, no clock reads, no board copy. The recorder
 *    measures and saves a chunk at an idle moment, never inside the tap handler.
 *  - `flush` hands the chunk in progress over and to the queue now: the screen
 *    calls it when it leaves the foreground, so a kill loses nothing more.
 *  - Whether the game records at all (the kill switch, the sample) is the
 *    recorder's to decide, once per session: with recording off it holds,
 *    schedules and saves nothing. This module does not read the dial.
 *  - Isolation: recording never breaks play. Every call is wrapped; a throw
 *    (from the recorder or the sink) is reported once through the Sentry
 *    throttle and the game carries on.
 *
 * Unit numbers count the chunks handed over (`unit`). The screen saves the count
 * with the game and a resumed game passes it to `resumeAt`, so its next chunk
 * carries on from it (GAME-CONTRACT 2.10). It also saves the actions not yet
 * handed over (`pending`): above 0 on a load, a kill lost them and the replay
 * stops (`block`) rather than carry on past a hole. A chunk the recorder throws
 * on blocks it too: its unit number is spent and its chunk may be missing.
 *
 * `rebuild` and `isAction` are the reader's side: they apply and validate the
 * log with the real engine, with the same rules as the backend's validator.
 */

import { SORT_MAX_UNITS } from "../_shared/eventQueueConfig";
import { captureThrottledMessage } from "../_shared/sentryThrottle";
import { applyPour, isValidPour, undo as undoState } from "./engine";
import type { SortState } from "./types";

/** Actions per `moves` event (and recorder unit). Sized in docs/games/sort.md. */
export const ACTIONS_PER_CHUNK = 25;

/** `engine_version` in `game_started`: the pour rules `rebuild` applies. */
export const SORT_REPLAY_ENGINE_VERSION = 1;

/** Most bottles a level has (bottle indices are 0..MAX_BOTTLES-1). */
export const MAX_BOTTLES = 16;

/** Most moves one "back to last good move" may rewind. */
export const MAX_REWIND = 1000;

/** Action codes (the first number of a tuple). */
export const POUR = 0;
export const UNDO = 1;
export const HINT = 2;
export const REWIND = 3;

/** One recorded action; see the file comment. */
export type Action =
  | readonly [typeof POUR, number, number]
  | readonly [typeof UNDO]
  | readonly [typeof HINT, number, number]
  | readonly [typeof REWIND, number];

export function pourEntry(from: number, to: number): Action {
  return [POUR, from, to];
}

export function undoEntry(): Action {
  return [UNDO];
}

export function hintEntry(from: number, to: number): Action {
  return [HINT, from, to];
}

export function rewindEntry(n: number): Action {
  return [REWIND, n];
}

const isBottleIndex = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= 0 && x < MAX_BOTTLES;

/**
 * Strict shape check, mirroring the backend's rules: a tuple of integers of the
 * right arity, bottle indices in range, `from !== to`, a rewind of 1..MAX_REWIND.
 * It does not know the board, so it cannot tell a legal pour from an illegal one
 * (`rebuild` does).
 */
export function isAction(x: unknown): x is Action {
  if (!Array.isArray(x)) return false;
  switch (x[0]) {
    case POUR:
    case HINT:
      return x.length === 3 && isBottleIndex(x[1]) && isBottleIndex(x[2]) && x[1] !== x[2];
    case UNDO:
      return x.length === 1;
    case REWIND:
      return (
        x.length === 2 &&
        typeof x[1] === "number" &&
        Number.isInteger(x[1]) &&
        x[1] >= 1 &&
        x[1] <= MAX_REWIND
      );
    default:
      return false;
  }
}

export interface RebuildError {
  /** Index in `actions` of the first action that does not apply. */
  readonly index: number;
  readonly reason: string;
}

export interface RebuildResult {
  /** The board after the last action that applied. */
  readonly state: SortState;
  /** The boards before each pour still standing (what undo returns to). */
  readonly history: readonly SortState[];
  /** The first illegal action, when there is one; the replay stops there. */
  readonly error?: RebuildError;
}

/**
 * Applies `actions` to `opening` with the real engine and reports the first one
 * that does not apply: a malformed tuple, a bottle index off the board, a pour
 * the engine refuses, or an undo or rewind with not enough history. Pure.
 * @internal The reader's side: tests (and the reader, #3388) call it; the app does
 * not (knip --production, #3126).
 */
export function rebuild(opening: SortState, actions: readonly Action[]): RebuildResult {
  let state = opening;
  let history: readonly SortState[] = [];
  for (let i = 0; i < actions.length; i += 1) {
    const action: unknown = actions[i];
    const fail = (reason: string): RebuildResult => ({
      state,
      history,
      error: { index: i, reason },
    });
    if (!isAction(action)) return fail("malformed action");
    const n = state.bottles.length;
    switch (action[0]) {
      case POUR: {
        const [, from, to] = action;
        if (from >= n || to >= n) return fail("bottle index off the board");
        if (!isValidPour(state.bottles[from]!, state.bottles[to]!)) return fail("illegal pour");
        history = [...history, state];
        state = applyPour(state, from, to);
        break;
      }
      case UNDO: {
        if (history.length === 0) return fail("undo with no history");
        ({ state, history } = undoState(state, history));
        break;
      }
      case HINT: {
        if (action[1] >= n || action[2] >= n) return fail("bottle index off the board");
        break;
      }
      case REWIND: {
        if (action[1] > history.length) return fail("rewind past the start");
        for (let k = 0; k < action[1]; k += 1) ({ state, history } = undoState(state, history));
        break;
      }
    }
  }
  return { state, history };
}

/** Collects actions and hands them over `size` at a time. */
export interface ActionLog {
  /** Add one action; hands the chunk over when it reaches `size`. */
  push(entry: Action): void;
  /** Hand over what is collected, if anything. */
  flush(): void;
  /** Forget what is collected, handing nothing over. */
  clear(): void;
  /** How many actions are collected and not yet handed over. */
  readonly size: number;
}

/**
 * An action log (a copy of Mahjong's, typed for Sort's actions). `emit` receives
 * each chunk as a fresh array the log never touches again (the recorder takes
 * `data` by ownership).
 */
export function createActionLog(
  emit: (actions: Action[]) => void,
  size: number = ACTIONS_PER_CHUNK
): ActionLog {
  let chunk: Action[] = [];
  const flush = (): void => {
    if (chunk.length === 0) return;
    const out = chunk;
    chunk = [];
    emit(out);
  };
  return {
    push(entry) {
      chunk.push(entry);
      if (chunk.length >= size) flush();
    },
    flush,
    clear() {
      chunk = [];
    },
    get size() {
      return chunk.length;
    },
  };
}

/** What `SortReplay` records into: `useGameRecorder("sort")` plus whether a game session is open. */
export interface ReplaySink {
  /** Whether a game session is open to take units now. */
  isOpen(): boolean;
  beginUnit(n: number): number;
  record(type: "moves", data: { m: Action[] }): void;
  closeUnit(): void;
  /** Hand everything the recorder holds to the queue now. */
  flush(): void;
  /** Whether the recorder's session reached its byte cap and stores nothing more. */
  isFull(): boolean;
}

export class SortReplay {
  private unitCount = 0;
  private readonly log: ActionLog;

  constructor(
    private readonly sink: ReplaySink,
    chunkSize: number = ACTIONS_PER_CHUNK,
    private readonly maxUnits: number = SORT_MAX_UNITS
  ) {
    this.log = createActionLog((m) => {
      if (this.unitCount >= this.maxUnits) return; // the level's row budget is spent
      if (this.stopIfFull()) return;
      this.unitCount += 1;
      try {
        this.sink.beginUnit(this.unitCount);
        this.sink.record("moves", { m });
        this.sink.closeUnit();
      } catch (error) {
        // The unit number is spent but its chunk may not be stored: a log that
        // carried on would have a hole a reader could not see. Stop for good
        // (the throw is reported by `guarded`).
        try {
          this.sink.closeUnit();
        } catch {
          // best effort: the recorder may have no unit open
        }
        this.block();
        throw error;
      }
    }, chunkSize);
  }

  private onBlocked: () => void = () => undefined;

  /** Called whenever the replay stops for good (`block`): the screen saves the game. */
  setOnBlocked(fn: () => void): void {
    this.onBlocked = fn;
  }

  /** The units handed to the recorder so far, this level: what the screen saves with it. */
  get unit(): number {
    return this.unitCount;
  }

  /**
   * Actions collected and not yet handed to the recorder. The screen saves it
   * with the game: a load that finds it above 0 knows a kill lost them, so the
   * stored log has a hole and the replay must not carry on (`block`).
   */
  get pending(): number {
    return this.log.size;
  }

  /** A pour landed. */
  pour(from: number, to: number): void {
    this.add(() => pourEntry(from, to));
  }

  /** An undo that changed the board. */
  undo(): void {
    this.add(() => undoEntry());
  }

  /** A hint was shown. */
  hint(from: number, to: number): void {
    this.add(() => hintEntry(from, to));
  }

  /** "Back to last good move" rewound `n` moves. */
  rewind(n: number): void {
    this.add(() => rewindEntry(n));
  }

  /**
   * The chunk in progress goes to the recorder and everything it holds is
   * saved now: the app leaves the foreground, the level ends or is left, or the
   * screen unmounts.
   */
  flush(): void {
    this.guarded(() => {
      this.log.flush();
      this.sink.flush();
      this.stopIfFull();
    });
  }

  /**
   * The recorder's session reached its byte cap, so it stores no later unit. A
   * fresh recorder after a kill starts with an empty counter and would store
   * units that no longer follow the stored prefix, so the replay stops for good:
   * `block()` spends the row budget, which the save carries. True when it just did.
   */
  private stopIfFull(): boolean {
    if (this.unitCount >= this.maxUnits || !this.sink.isFull()) return false;
    this.block();
    return true;
  }

  /** A new level: forget what is waiting (flush first to keep it) and start the unit count again. */
  reset(): void {
    this.log.clear();
    this.unitCount = 0;
  }

  /**
   * Stop recording this level: its session has no `game_started` the record can
   * be rebuilt from, so its moves could never be replayed and would only cost
   * storage. It spends the level's row budget (the unit count goes to the cap),
   * which the save carries, so a later load of the same game stays blocked. A
   * new level (`reset`) clears it.
   */
  block(): void {
    this.log.clear();
    this.unitCount = this.maxUnits;
    this.onBlocked(); // the screen saves the game now, not with the next debounced write
  }

  /** A game resumed after a kill: carry on from the unit count it saved. */
  resumeAt(unit: number): void {
    this.log.clear();
    this.unitCount = Number.isInteger(unit) && unit > 0 ? unit : 0;
  }

  private add(build: () => Action): void {
    this.guarded(() => {
      if (this.unitCount >= this.maxUnits || !this.sink.isOpen()) return;
      this.log.push(build());
    });
  }

  /** Runs recording work so that nothing it throws reaches the game. */
  private guarded(work: () => void): void {
    try {
      work();
    } catch (error) {
      try {
        captureThrottledMessage("sort.replay.failed", "sort replay recording failed", {
          level: "warning",
          tags: { subsystem: "sort.replay" },
          extra: { error: error instanceof Error ? error.name : typeof error },
        });
      } catch {
        // reporting is best effort too
      }
    }
  }
}
