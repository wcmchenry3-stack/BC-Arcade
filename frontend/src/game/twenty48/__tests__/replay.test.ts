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
import {
  DIRECTION_ORDER,
  MOVES_PER_CHUNK,
  createMoveLog,
  moveTuple,
  type MoveTuple,
} from "../replay";
import type { Twenty48State } from "../types";

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
// Size against the caps
// ---------------------------------------------------------------------------

describe("size", () => {
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
    const log = createMoveLog((m) => {
      recorder.beginUnit();
      recorder.record("moves", { m });
      recorder.closeUnit();
    });
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
