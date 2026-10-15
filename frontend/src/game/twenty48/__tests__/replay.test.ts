/**
 * 2048 replay recording (#3286): the move tuple, the chunking, and the golden
 * replay — a seeded game played through the real engine and the real
 * GameRecorder is rebuilt from the opening board plus the recorded events
 * alone, and must come out with the same board and score.
 */

import type { EnqueueEventInput } from "../../_shared/gameEventClient";
import {
  TWENTY48_MOVES_MAX_BYTES,
  gameRecordingConfigs,
  recordingConfigFor,
} from "../../_shared/eventQueueConfig";
import { GameRecorder } from "../../_shared/gameRecorder";
import {
  SIZE,
  createSeededRng,
  move,
  newGame,
  setRng,
  slideAndMerge,
  type Direction,
} from "../engine";
import { captureThrottledMessage } from "../../_shared/sentryThrottle";
import {
  DIRECTION_ORDER,
  MAX_RECORDED_MOVES,
  MAX_RECORDED_ROWS,
  MOVES_PER_CHUNK,
  createMoveLog,
  guardRecording,
  moveTuple,
  savedPosition,
  withRecorded,
  type MoveTuple,
} from "../replay";
import type { Twenty48State } from "../types";

jest.mock("../../_shared/sentryThrottle", () => ({
  ...jest.requireActual("../../_shared/sentryThrottle"),
  captureThrottledMessage: jest.fn(() => true),
}));

const NO_LIMITS = { moves: Infinity, rows: Infinity };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORDER_TRIED: readonly Direction[] = ["left", "up", "right", "down"];

/** Plays `moves` swipes (or to the game over) cycling directions, skipping no-ops. */
function play(
  seed: number,
  moves: number
): { opening: number[][]; moves: { direction: Direction; after: Twenty48State }[] } {
  setRng(createSeededRng(seed));
  let state = newGame();
  const opening = state.board.map((r) => [...r]);
  const out: { direction: Direction; after: Twenty48State }[] = [];
  let turn = 0;
  while (out.length < moves && !state.game_over) {
    let moved = false;
    for (let k = 0; k < ORDER_TRIED.length && !moved; k += 1) {
      const direction = ORDER_TRIED[(turn + k) % ORDER_TRIED.length]!;
      try {
        state = move(state, direction);
        out.push({ direction, after: state });
        moved = true;
      } catch {
        // no effect in that direction
      }
    }
    turn += 1;
    if (!moved) break;
  }
  return { opening, moves: out };
}

/** The reference slide: one move's board, by the same line rule the engine uses. */
function slide(board: number[][], direction: Direction): { board: number[][]; gained: number } {
  const out = board.map((r) => [...r]);
  let gained = 0;
  for (let i = 0; i < SIZE; i += 1) {
    const vertical = direction === "up" || direction === "down";
    const reverse = direction === "right" || direction === "down";
    const line = Array.from({ length: SIZE }, (_, k) => (vertical ? out[k]![i]! : out[i]![k]!));
    if (reverse) line.reverse();
    const result = slideAndMerge(line);
    gained += result.score;
    if (reverse) result.line.reverse();
    for (let k = 0; k < SIZE; k += 1) {
      if (vertical) out[k]![i] = result.line[k]!;
      else out[i]![k] = result.line[k]!;
    }
  }
  return { board: out, gained };
}

/**
 * Rebuilds a game from its opening board and the saved `moves` events alone.
 * `keepSpawn: false` drops the spawned tile, to show the test would notice.
 */
function rebuild(
  opening: number[][],
  events: readonly EnqueueEventInput[],
  keepSpawn = true
): { board: number[][]; score: number; consistent: boolean } {
  let board = opening.map((r) => [...r]);
  let score = 0;
  let consistent = true;
  for (const event of events) {
    if (event.type !== "moves") continue;
    const m = (event.data as { m: MoveTuple[] }).m;
    for (const [dir, cell, value, gained, total] of m) {
      const direction = DIRECTION_ORDER[dir]!;
      const slid = slide(board, direction);
      board = slid.board;
      if (keepSpawn) board[Math.floor(cell / SIZE)]![cell % SIZE] = value;
      score += slid.gained;
      if (slid.gained !== gained || score !== total) consistent = false;
    }
  }
  return { board, score, consistent };
}

/** A recorder over a fake sink that collects every saved event, saved on `endSession`. */
function recorderWithSink(): { recorder: GameRecorder<"twenty48">; saved: EnqueueEventInput[] } {
  const saved: EnqueueEventInput[] = [];
  const recorder = new GameRecorder<"twenty48">({
    gameType: "twenty48",
    sink: {
      canAccept: () => true,
      enqueueMany: (events) => {
        saved.push(...events);
        return true;
      },
    },
    schedule: () => undefined, // saved at endSession, not during the test's loop
  });
  return { recorder, saved };
}

function recordGame(moves: number, seed: number) {
  const game = play(seed, moves);
  const { recorder, saved } = recorderWithSink();
  recorder.startSession();
  const log = createMoveLog((m) => {
    recorder.beginUnit();
    recorder.record("moves", { m });
    recorder.closeUnit();
  });
  for (const { direction, after } of game.moves) {
    const tuple = moveTuple(direction, after);
    if (tuple) log.push(tuple);
  }
  log.flush();
  recorder.endSession();
  return { game, saved };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

describe("moveTuple", () => {
  it("is [direction code, spawned cell, spawned value, gained, total]", () => {
    const { moves } = play(7, 12);
    expect(moves.length).toBeGreaterThan(5);
    for (const { direction, after } of moves) {
      const spawned = after.tiles.filter((t) => t.isNew);
      expect(spawned).toHaveLength(1);
      const tile = spawned[0]!;
      expect(moveTuple(direction, after)).toEqual([
        DIRECTION_ORDER.indexOf(direction),
        tile.row * SIZE + tile.col,
        tile.value,
        after.scoreDelta,
        after.score,
      ]);
    }
  });

  it("numbers the directions up, down, left, right as 0..3", () => {
    expect(DIRECTION_ORDER).toEqual(["up", "down", "left", "right"]);
  });

  it("has only small integers: cell 0..15, value 2 or 4", () => {
    const { moves } = play(11, 200);
    for (const { direction, after } of moves) {
      const [dir, cell, value, gained, total] = moveTuple(direction, after)!;
      expect(dir).toBeGreaterThanOrEqual(0);
      expect(dir).toBeLessThanOrEqual(3);
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(SIZE * SIZE);
      expect([2, 4]).toContain(value);
      expect(Number.isInteger(gained) && Number.isInteger(total)).toBe(true);
    }
  });

  it("is null when no tile spawned", () => {
    const { moves } = play(3, 1);
    const after = moves[0]!.after;
    const none = { ...after, tiles: after.tiles.map((t) => ({ ...t, isNew: false })) };
    expect(moveTuple("left", none)).toBeNull();
  });

  it("is a bare 5-number array with no per-move JSON work", () => {
    const { moves } = play(5, 1);
    const tuple = moveTuple(moves[0]!.direction, moves[0]!.after)!;
    expect(Array.isArray(tuple)).toBe(true);
    expect(tuple).toHaveLength(5);
    expect(tuple.every((n) => typeof n === "number")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

describe("createMoveLog", () => {
  const tuple = (n: number): MoveTuple => [n % 4, n % 16, 2, 0, n];

  it("hands a chunk over at exactly MOVES_PER_CHUNK moves", () => {
    const emitted: MoveTuple[][] = [];
    const log = createMoveLog((m) => emitted.push(m));
    for (let i = 0; i < MOVES_PER_CHUNK - 1; i += 1) log.push(tuple(i));
    expect(emitted).toHaveLength(0);
    log.push(tuple(MOVES_PER_CHUNK - 1));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(MOVES_PER_CHUNK);
    log.push(tuple(MOVES_PER_CHUNK));
    expect(emitted).toHaveLength(1);
  });

  it("flush hands over the partial chunk, once, and nothing when empty", () => {
    const emitted: MoveTuple[][] = [];
    const log = createMoveLog((m) => emitted.push(m));
    log.flush();
    expect(emitted).toHaveLength(0);
    for (let i = 0; i < 7; i += 1) log.push(tuple(i));
    log.flush();
    log.flush();
    expect(emitted.map((c) => c.length)).toEqual([7]);
  });

  it("keeps order, loses nothing, and never reuses an emitted array", () => {
    const emitted: MoveTuple[][] = [];
    const log = createMoveLog((m) => emitted.push(m));
    for (let i = 0; i < 2 * MOVES_PER_CHUNK + 3; i += 1) log.push(tuple(i));
    log.flush();
    expect(emitted.map((c) => c.length)).toEqual([MOVES_PER_CHUNK, MOVES_PER_CHUNK, 3]);
    expect(emitted.flat().map((t) => t[4])).toEqual(
      Array.from({ length: 2 * MOVES_PER_CHUNK + 3 }, (_, i) => i)
    );
    expect(new Set(emitted).size).toBe(3);
  });

  it("honours a chunk size argument", () => {
    const emitted: MoveTuple[][] = [];
    const log = createMoveLog((m) => emitted.push(m), 2);
    for (let i = 0; i < 5; i += 1) log.push(tuple(i));
    expect(emitted.map((c) => c.length)).toEqual([2, 2]);
  });
});

// ---------------------------------------------------------------------------
// Per-game limits and resume (the counts saved with the game)
// ---------------------------------------------------------------------------

describe("per-game limits and resume", () => {
  const tuple = (n: number): MoveTuple => [n % 4, n % 16, 2, 0, n];

  it("numbers each chunk by its row in the game, partial chunks included", () => {
    const units: number[] = [];
    const log = createMoveLog((_m, unit) => units.push(unit));
    for (let i = 0; i < 3; i += 1) log.push(tuple(i));
    log.flush(); // the app went to the background
    for (let i = 0; i < MOVES_PER_CHUNK + 1; i += 1) log.push(tuple(i));
    log.flush();
    expect(units).toEqual([1, 2, 3]);
  });

  it("counts the chunk in progress as a row, so a flush leaves the saved count right", () => {
    const log = createMoveLog(() => undefined);
    expect([log.moves, log.rows]).toEqual([0, 0]);
    log.push(tuple(0));
    expect([log.moves, log.rows]).toEqual([1, 1]);
    log.flush();
    expect([log.moves, log.rows]).toEqual([1, 1]);
    log.push(tuple(1));
    expect([log.moves, log.rows]).toEqual([2, 2]);
    for (let i = 2; i < MOVES_PER_CHUNK + 1; i += 1) log.push(tuple(i));
    expect([log.moves, log.rows]).toEqual([MOVES_PER_CHUNK + 1, 2]);
  });

  it("reset carries the unit numbers and counts on from a save", () => {
    const units: number[] = [];
    const log = createMoveLog((_m, unit) => units.push(unit));
    log.push(tuple(0)); // a chunk in progress the kill lost: forgotten
    log.reset(30, 2);
    expect([log.moves, log.rows]).toEqual([30, 2]);
    log.push(tuple(1));
    log.flush();
    expect(units).toEqual([3]);
    expect([log.moves, log.rows]).toEqual([31, 3]);
    log.reset();
    expect([log.moves, log.rows]).toEqual([0, 0]);
  });

  it("stops at the move limit, and a resumed game at it records nothing", () => {
    const emitted: MoveTuple[][] = [];
    const log = createMoveLog((m) => emitted.push(m));
    for (let i = 0; i < MAX_RECORDED_MOVES + 40; i += 1) log.push(tuple(i));
    log.flush();
    expect(emitted.flat()).toHaveLength(MAX_RECORDED_MOVES);
    expect(log.capped).toBe(true);
    const resumed = createMoveLog((m) => emitted.push(m));
    resumed.reset(MAX_RECORDED_MOVES, 10);
    expect(resumed.capped).toBe(true);
    resumed.push(tuple(0));
    resumed.flush();
    expect(emitted.flat()).toHaveLength(MAX_RECORDED_MOVES);
  });

  it("stops at the row limit, after filling the chunk in progress", () => {
    const emitted: MoveTuple[][] = [];
    const log = createMoveLog((m) => emitted.push(m));
    log.reset(0, MAX_RECORDED_ROWS - 1);
    expect(log.capped).toBe(false);
    for (let i = 0; i < MOVES_PER_CHUNK + 5; i += 1) log.push(tuple(i));
    log.flush();
    // The last free row took one full chunk; nothing after it.
    expect(emitted.map((c) => c.length)).toEqual([MOVES_PER_CHUNK]);
    expect(log.capped).toBe(true);
    expect(log.rows).toBe(MAX_RECORDED_ROWS);
  });

  it("flush-spam stops at the row limit too", () => {
    const emitted: MoveTuple[][] = [];
    const log = createMoveLog((m) => emitted.push(m));
    for (let i = 0; i < 200; i += 1) {
      log.push(tuple(i));
      log.flush();
    }
    expect(emitted).toHaveLength(MAX_RECORDED_ROWS);
  });

  const base = { board: [], tiles: [], score: 0, scoreDelta: 0 } as unknown as Twenty48State;

  it("reads a save's counts: absent is 0, corrupt is the limit", () => {
    expect(savedPosition(base)).toEqual([0, 0]);
    expect(savedPosition({ ...base, recordedMoves: 30, recordedRows: 2 })).toEqual([30, 2]);
    for (const bad of [-1, 1.5, "3", null, Number.NaN]) {
      expect(
        savedPosition({
          ...base,
          recordedMoves: bad,
          recordedRows: bad,
        } as unknown as Twenty48State)
      ).toEqual([MAX_RECORDED_MOVES, MAX_RECORDED_ROWS]);
    }
  });

  it("stamps the counts on the state, and keeps the same object when they did not change", () => {
    const log = createMoveLog(() => undefined);
    log.push(tuple(0));
    const stamped = withRecorded(base, log);
    expect(stamped).toEqual({ ...base, recordedMoves: 1, recordedRows: 1 });
    expect(withRecorded(stamped, log)).toBe(stamped);
  });

  it("guardRecording swallows a failure and reports it, throttled, without its message", () => {
    const report = captureThrottledMessage as jest.Mock;
    report.mockClear();
    expect(() =>
      guardRecording(() => {
        throw new TypeError("secret 1234");
      })
    ).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1);
    const [key, message, opts] = report.mock.calls[0]!;
    expect(key).toBe("twenty48Replay");
    expect(message).toBe("twenty48 replay: recording failed, play continues");
    expect(opts).toEqual({
      level: "warning",
      tags: { subsystem: "twenty48Replay", game_type: "twenty48" },
      extra: { error: "TypeError" },
    });
  });
});

// ---------------------------------------------------------------------------
// Size against the caps
// ---------------------------------------------------------------------------

/** A row's stored cost: its JSON as `jsonb::text` prints it (`", "`, `": "`), plus the server's 200 B a row. */
function storedRowBytes(data: unknown): number {
  return JSON.stringify(data).replace(/[,:]/g, "$& ").length + 200;
}

describe("size", () => {
  it("the worst game the per-game limits allow is under the epic's 40 KB, stored", () => {
    // Every limit at once: all MAX_RECORDED_MOVES moves spread over all
    // MAX_RECORDED_ROWS rows (flushes cutting chunks short), each move the widest
    // a recorded game can hold. In MAX_RECORDED_MOVES moves the board sums at
    // most 4 + 4 x 1,100, so no tile passes 4,096, the score stays under
    // 4,404 x 11 (5 digits) and one move gains under 4,404 (4 digits). A
    // 10-digit t_ms is 115 days.
    const widest: MoveTuple = [3, 15, 4, 9999, 99999];
    let left = MAX_RECORDED_MOVES;
    let total = 0;
    for (let row = 1; row <= MAX_RECORDED_ROWS; row += 1) {
      const size = Math.ceil(left / (MAX_RECORDED_ROWS - row + 1));
      left -= size;
      total += storedRowBytes({
        v: 1,
        unit: row,
        t_ms: 9_999_999_999,
        m: Array.from({ length: size }, () => widest),
      });
    }
    expect(left).toBe(0);
    process.stdout.write(`[size #3286] twenty48 worst game at the limits: ${total} B stored\n`);
    expect(total).toBeLessThanOrEqual(40 * 1024);
  });

  it("real games, recorded as the screen does, are a fraction of the 40 KB per game", () => {
    // Seeded games of a corner player (down, left, right, then up), to the
    // game over: what the screen's log and the recorder store for each.
    const corner: readonly Direction[] = ["down", "left", "right", "up"];
    const sizes: { moves: number; score: number; stored: number }[] = [];
    for (const seed of [11, 12, 13, 14, 15]) {
      setRng(createSeededRng(seed));
      let state = newGame();
      const { recorder, saved } = recorderWithSink();
      recorder.startSession();
      const log = createMoveLog((m, unit) => {
        recorder.beginUnit(unit);
        recorder.record("moves", { m });
        recorder.closeUnit();
      });
      let moves = 0;
      for (let moved = true; moved && !state.game_over;) {
        moved = false;
        for (const direction of corner) {
          try {
            state = move(state, direction);
          } catch {
            continue; // no effect
          }
          const tuple = moveTuple(direction, state);
          if (tuple) log.push(tuple);
          moves += 1;
          moved = true;
          break;
        }
      }
      log.flush();
      recorder.endSession();
      const stored = saved.reduce((n, e) => n + storedRowBytes(e.data), 0);
      sizes.push({ moves, score: state.score, stored });
    }
    process.stdout.write(`[size #3286] twenty48 corner-player games: ${JSON.stringify(sizes)}\n`);
    for (const { moves, stored } of sizes) {
      // ~31 B a move stored, row overhead included: 1,100 moves would be ~34 KB.
      expect(stored / Math.min(moves, MAX_RECORDED_MOVES)).toBeLessThan(32);
      expect(stored).toBeLessThan(40 * 1024);
    }
  });

  it("registers moves as a chunkable replay event with the 1 KB cap", () => {
    const config = recordingConfigFor("twenty48");
    expect(config).toBe(gameRecordingConfigs.twenty48);
    expect(config.events.moves).toEqual({
      maxBytes: TWENTY48_MOVES_MAX_BYTES,
      chunkField: "m",
    });
    expect(TWENTY48_MOVES_MAX_BYTES).toBe(1024);
  });

  it("a worst-case full chunk, envelope included, is under the event cap", () => {
    const worst: MoveTuple = [3, 15, 4, 131072, 3932156];
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    recorder.beginUnit(9999);
    recorder.record("moves", { m: Array.from({ length: MOVES_PER_CHUNK }, () => worst) });
    recorder.closeUnit();
    recorder.endSession();
    expect(saved).toHaveLength(1);
    const bytes = JSON.stringify(saved[0]!.data).length;
    expect(bytes).toBeLessThan(TWENTY48_MOVES_MAX_BYTES);
    // not split by the safety net
    expect((saved[0]!.data as { parts?: number }).parts).toBeUndefined();
  });

  it("an oversized chunk is split on m, not dropped", () => {
    const worst: MoveTuple = [3, 15, 4, 131072, 3932156];
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    recorder.beginUnit();
    recorder.record("moves", { m: Array.from({ length: 80 }, () => worst) });
    recorder.closeUnit();
    recorder.endSession();
    expect(saved.length).toBeGreaterThan(1);
    for (const e of saved) {
      expect(JSON.stringify(e.data).length).toBeLessThanOrEqual(TWENTY48_MOVES_MAX_BYTES);
    }
    expect(saved.flatMap((e) => (e.data as { m: MoveTuple[] }).m)).toHaveLength(80);
  });

  it("2,000 real moves are 80 events, each under the cap, well under the session cap", () => {
    // Real moves from seeded games, enough games to make 2,000 (one game over ends a game early).
    const tuples: MoveTuple[] = [];
    for (let seed = 100; tuples.length < 2000; seed += 1) {
      for (const { direction, after } of play(seed, 2000).moves) {
        const tuple = moveTuple(direction, after);
        if (tuple && tuples.length < 2000) tuples.push(tuple);
      }
    }
    const { recorder, saved } = recorderWithSink();
    recorder.startSession();
    // A stream of many games' moves, not one game: without the per-game limits.
    const log = createMoveLog(
      (m) => {
        recorder.beginUnit();
        recorder.record("moves", { m });
        recorder.closeUnit();
      },
      MOVES_PER_CHUNK,
      NO_LIMITS
    );
    for (const t of tuples) log.push(t);
    log.flush();
    recorder.endSession();
    expect(saved).toHaveLength(2000 / MOVES_PER_CHUNK);
    let total = 0;
    for (const e of saved) {
      const bytes = JSON.stringify(e.data).length;
      expect(bytes).toBeLessThanOrEqual(TWENTY48_MOVES_MAX_BYTES);
      total += bytes;
    }
    expect(total).toBeLessThan(recordingConfigFor("twenty48").sessionMaxBytes);
  });
});

// ---------------------------------------------------------------------------
// Golden replay
// ---------------------------------------------------------------------------

describe("golden replay", () => {
  it.each([1, 2, 3])(
    "seed %i: the opening board plus the recorded moves rebuild the final board and score",
    (seed) => {
      const { game, saved } = recordGame(300, seed);
      expect(game.moves.length).toBeGreaterThan(50);
      const final = game.moves[game.moves.length - 1]!.after;
      const rebuilt = rebuild(game.opening, saved);
      expect(rebuilt.board).toEqual(final.board);
      expect(rebuilt.score).toBe(final.score);
      expect(rebuilt.consistent).toBe(true);
    }
  );

  it("chunks arrive in order across event boundaries (more than one event)", () => {
    const { game, saved } = recordGame(120, 4);
    expect(saved.length).toBeGreaterThan(2);
    const totals = saved.flatMap((e) => (e.data as { m: MoveTuple[] }).m).map((t) => t[4]);
    expect(totals).toEqual(game.moves.map((m) => m.after.score));
    const units = saved.map((e) => (e.data as { unit: number }).unit);
    expect(units).toEqual(units.map((_, i) => i + 1));
  });

  it("fails when the spawned tile is dropped (the test can tell)", () => {
    const { game, saved } = recordGame(120, 1);
    const final = game.moves[game.moves.length - 1]!.after;
    const withoutSpawn = rebuild(game.opening, saved, false);
    expect(withoutSpawn.board).not.toEqual(final.board);
  });

  it("fails when a chunk is missing: the running total no longer follows", () => {
    const { game, saved } = recordGame(120, 1);
    const holed = saved.filter((_, i) => i !== 1);
    expect(rebuild(game.opening, holed).consistent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

describe("kill switch (isRecordingEnabled false)", () => {
  /** The same wiring as the screen, over spies, with recording on or off. */
  function wired(enabled: boolean) {
    const enqueueMany = jest.fn(() => true);
    const canAccept = jest.fn(() => true);
    const schedule = jest.fn();
    const report = jest.fn();
    const recorder = new GameRecorder<"twenty48">({
      gameType: "twenty48",
      sink: { canAccept, enqueueMany },
      schedule,
      report,
      enabled: () => enabled,
    });
    const log = createMoveLog((m) => {
      recorder.beginUnit();
      recorder.record("moves", { m });
      recorder.closeUnit();
    });
    return { recorder, log, enqueueMany, canAccept, schedule, report };
  }

  function playInto(log: ReturnType<typeof createMoveLog>, n: number): void {
    for (const { direction, after } of play(9, n).moves) {
      const tuple = moveTuple(direction, after);
      if (tuple) log.push(tuple);
    }
    log.flush();
  }

  it("with recording off the recorder holds, schedules, measures and saves nothing", () => {
    const { recorder, log, enqueueMany, canAccept, schedule, report } = wired(false);
    recorder.startSession();
    playInto(log, 120);
    expect(recorder.held).toBe(0);
    expect(schedule).not.toHaveBeenCalled();
    recorder.endSession();
    expect(enqueueMany).not.toHaveBeenCalled();
    expect(canAccept).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("with recording on, the same play is scheduled and saved (the spies can tell)", () => {
    const { recorder, log, enqueueMany, schedule } = wired(true);
    recorder.startSession();
    playInto(log, 120);
    expect(schedule).toHaveBeenCalled();
    recorder.endSession();
    expect(enqueueMany).toHaveBeenCalledTimes(1);
  });
});
