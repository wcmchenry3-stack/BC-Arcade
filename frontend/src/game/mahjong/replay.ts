/**
 * Mahjong replay recording (#3285, epic #3273).
 *
 * `game_started` carries the layout and the deal seed (#3281), so the opening
 * board is `createGame(getLayout(layout), seed)`. What the player did after it
 * is recorded as `moves` events: the opening board plus the `moves` rows in
 * `event_index` order rebuild the final board. One action is an entry of `m`:
 *
 *     [a, b]            a matched pair: the two tile ids (`SlotTile.id`)
 *     "u"               an undo (of whatever the engine's undo stack holds)
 *     "h"               a hint was shown (it changes nothing; for difficulty analysis)
 *     {s: [...], f: [...]}   a shuffle, with the order it produced (below)
 *     "s"               a shuffle that left the board as it was (a geometric deadlock)
 *
 * A shuffle is the one action the seed cannot rebuild: `shuffleBoard` draws from
 * the engine's global RNG, not from the deal's seed. So the result is recorded.
 * The shuffle renumbers the tiles 0..n-1 in a new order, so for each new tile
 * `i` (its id is its index): `s[i]` is the index, in the board just before the
 * shuffle, of the tile whose position (col, row, layer) the new tile takes, and
 * `f[i]` is its `faceId` (1..42, which gives its suit and rank). The shuffle
 * only redistributes the faces and positions the board already has, so a
 * replay needs nothing else. See docs/games/mahjong.md ("Replay recording").
 *
 * What is not recorded: tile selections that did not match (no board change),
 * the clock (`t_ms` of the recorder's envelope gives the pace), and any state
 * the engine derives (score, pairs removed, shuffles left, deadlock).
 *
 * Cost -> performance -> data:
 *  - Actions are pushed to an in-memory array, `ACTIONS_PER_CHUNK` at a time
 *    (a chunk is one `moves` event and one recorder unit), so a game of 72
 *    matches is about three events and three storage writes, not 72.
 *  - Building an entry is two ids, or (a shuffle, at most a few per game) one
 *    pass over the board. No `JSON.stringify`, no storage, no clock reads. The
 *    recorder measures and saves a chunk at an idle moment, never inside the
 *    tap's handler, and the screen records from the effect that answers the
 *    engine's events, after the tap has rendered.
 *  - `flush` hands the chunk in progress over and to the queue now (the
 *    AsyncStorage write that follows is still async): the screen calls it when
 *    it leaves the foreground, so a kill loses nothing more.
 *  - Whether the game records at all (the kill switch, the sample) is the
 *    recorder's to decide, once per session: with recording off it holds,
 *    schedules and saves nothing. This module does not read the dial.
 *  - Isolation: recording never breaks play. Every call is wrapped; a throw
 *    (from the recorder or the sink) is reported once through the Sentry
 *    throttle and the game carries on.
 *
 * Unit numbers count the chunks handed over (`unit`). The screen saves the
 * count with the game (`replayUnit`) and a resumed game passes it to
 * `resumeAt`, so its next chunk carries on from it (GAME-CONTRACT 2.10).
 */

import { captureThrottledMessage } from "../_shared/sentryThrottle";
import type { MahjongState, SlotTile } from "./types";

/** Actions per `moves` event (and recorder unit). Sized in docs/games/mahjong.md. */
export const ACTIONS_PER_CHUNK = 25;

/** The order a shuffle produced: see the file comment. */
export interface ShuffleEntry {
  readonly s: readonly number[];
  readonly f: readonly number[];
}

/** One recorded action. */
export type MoveEntry = readonly [number, number] | "u" | "h" | "s" | ShuffleEntry;

/** A matched pair's entry: the ids in the order the engine reports them (board order). */
export function matchEntry(tiles: readonly [SlotTile, SlotTile]): MoveEntry {
  return [tiles[0].id, tiles[1].id];
}

/**
 * The entry for the shuffle that produced `after`, or "s" when it left the board
 * as it was. `after.undoStack` ends with the shuffle's own undo entry, which
 * holds the board before it.
 */
export function shuffleEntry(after: MahjongState): MoveEntry {
  const top = after.undoStack[after.undoStack.length - 1];
  const before = top !== undefined && top.kind === "shuffle" ? top.tilesBefore : null;
  if (before === null) return "s";
  const indexAt = new Map<string, number>();
  for (let i = 0; i < before.length; i += 1) {
    const t = before[i]!;
    indexAt.set(`${t.col},${t.row},${t.layer}`, i);
  }
  const s: number[] = [];
  const f: number[] = [];
  for (const t of after.tiles) {
    s.push(indexAt.get(`${t.col},${t.row},${t.layer}`) ?? -1);
    f.push(t.faceId);
  }
  return { s, f };
}

/** Collects actions and hands them over `size` at a time. */
export interface ActionLog {
  /** Add one action; hands the chunk over when it reaches `size`. */
  push(entry: MoveEntry): void;
  /** Hand over what is collected, if anything. */
  flush(): void;
  /** Forget what is collected, handing nothing over. */
  clear(): void;
}

/**
 * An action log. `emit` receives each chunk as a fresh array the log never
 * touches again (the recorder takes `data` by ownership).
 */
export function createActionLog(
  emit: (actions: MoveEntry[]) => void,
  size: number = ACTIONS_PER_CHUNK
): ActionLog {
  let chunk: MoveEntry[] = [];
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
  };
}

/** What `MahjongReplay` records into: `useGameRecorder("mahjong")` plus whether a game session is open. */
export interface ReplaySink {
  /** Whether a game session is open to take units now. */
  isOpen(): boolean;
  beginUnit(n: number): number;
  record(type: "moves", data: { m: MoveEntry[] }): void;
  closeUnit(): void;
  /** Hand everything the recorder holds to the queue now. */
  flush(): void;
}

export class MahjongReplay {
  private unitCount = 0;
  private readonly log: ActionLog;

  constructor(
    private readonly sink: ReplaySink,
    chunkSize: number = ACTIONS_PER_CHUNK
  ) {
    this.log = createActionLog((m) => {
      this.unitCount += 1;
      this.sink.beginUnit(this.unitCount);
      this.sink.record("moves", { m });
      this.sink.closeUnit();
    }, chunkSize);
  }

  /** The units handed to the recorder so far, this game: what the screen saves with it. */
  get unit(): number {
    return this.unitCount;
  }

  /** A pair was matched (the engine's `tileMatch` event). */
  match(tiles: readonly [SlotTile, SlotTile]): void {
    this.add(() => matchEntry(tiles));
  }

  /** An undo that changed the board. */
  undo(): void {
    this.add(() => "u");
  }

  /** A hint was shown. */
  hint(): void {
    this.add(() => "h");
  }

  /** A shuffle was spent; `after` is the state it produced. */
  shuffle(after: MahjongState): void {
    this.add(() => shuffleEntry(after));
  }

  /**
   * The chunk in progress goes to the recorder and everything it holds is
   * saved now: the app leaves the foreground, the game ends or is left, or the
   * screen unmounts.
   */
  flush(): void {
    this.guarded(() => {
      this.log.flush();
      this.sink.flush();
    });
  }

  /** A new game: forget what is waiting (flush first to keep it) and start the unit count again. */
  reset(): void {
    this.log.clear();
    this.unitCount = 0;
  }

  /** A game resumed after a kill: carry on from the unit count it saved. */
  resumeAt(unit: number): void {
    this.log.clear();
    this.unitCount = Number.isInteger(unit) && unit > 0 ? unit : 0;
  }

  private add(build: () => MoveEntry): void {
    this.guarded(() => {
      if (!this.sink.isOpen()) return;
      this.log.push(build());
    });
  }

  /** Runs recording work so that nothing it throws reaches the game. */
  private guarded(work: () => void): void {
    try {
      work();
    } catch (error) {
      try {
        captureThrottledMessage("mahjong.replay.failed", "mahjong replay recording failed", {
          level: "warning",
          tags: { subsystem: "mahjong.replay" },
          extra: { error: error instanceof Error ? error.name : typeof error },
        });
      } catch {
        // reporting is best effort too
      }
    }
  }
}
