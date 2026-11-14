/**
 * The 2048 events the app really builds, pinned as a golden replay (#3910,
 * epic #3273).
 *
 * `backend/tests/fixtures/twenty48_replay_v1.json` holds, for one seeded game
 * played through the real engine and GameRecorder, the `game_started` data
 * (as the screen sends it), the saved `moves` events (envelope included) and
 * the final board and score. The backend test
 * (`tests/test_twenty48_replay_events.py`) feeds every event to
 * `validate_event` and rebuilds the game in Python.
 *
 * The expected final board and score below are written out by hand (they are
 * NOT read from the fixture or the recorder), so the engine and the recorder
 * cannot drift together: a change to tile spawn, merge or scoring moves what
 * the seeded game produces and fails this test.
 *
 * To regenerate after an intended change (a re-record is a behaviour change:
 * say why in the PR, bump `v` if the event shape broke), then copy the new
 * final board and score into the constants below:
 * `UPDATE_TWENTY48_REPLAY_FIXTURE=1 npx jest src/game/twenty48/__tests__/replay.fixture.test.ts`
 */

import fs from "fs";
import path from "path";

import type { EnqueueEventInput } from "../../_shared/gameEventClient";
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
import { DIRECTION_ORDER, createMoveLog, moveTuple, type MoveTuple } from "../replay";

const FIXTURE = path.resolve(
  __dirname,
  "../../../../../backend/tests/fixtures/twenty48_replay_v1.json"
);

const SEED = 2048;
const MOVES = 130; // a cap: this seeded game has no move left after 99

// Hand-written expectations for SEED: the engine's spawn, merge and scoring
// rules decide them. The game ends (no move left) at the final board below.
const EXPECTED_MOVES = 99;
const EXPECTED_SCORE = 768;
const EXPECTED_BOARD: number[][] = [
  [4, 2, 32, 4],
  [32, 64, 4, 8],
  [4, 16, 2, 4],
  [2, 32, 8, 2],
];

const ORDER_TRIED: readonly Direction[] = ["left", "up", "right", "down"];

interface Golden {
  game_started: { initial_board: number[] };
  events: { type: string; data: unknown }[];
  final: { board: number[]; score: number; moves: number };
}

/** The same flat row-major board the screen sends in `game_started`. */
const flatten = (board: readonly number[][]): number[] => board.flat();

/** Plays the seeded game through the real engine and recorder, as the screen does. */
function playGolden(): Golden {
  const saved: EnqueueEventInput[] = [];
  let t = 0;
  const recorder = new GameRecorder<"twenty48">({
    gameType: "twenty48",
    sink: {
      canAccept: () => true,
      enqueueMany: (batch) => {
        saved.push(...batch);
        return true;
      },
    },
    now: () => (t += 10),
    schedule: () => undefined, // saved at endSession
  });
  recorder.startSession();
  const log = createMoveLog((m) => {
    recorder.beginUnit();
    recorder.record("moves", { m });
    recorder.closeUnit();
  });

  setRng(createSeededRng(SEED));
  let state = newGame();
  const initial_board = flatten(state.board);
  let moves = 0;
  let turn = 0;
  while (moves < MOVES && !state.game_over) {
    let moved = false;
    for (let k = 0; k < ORDER_TRIED.length && !moved; k += 1) {
      const direction = ORDER_TRIED[(turn + k) % ORDER_TRIED.length]!;
      try {
        state = move(state, direction);
      } catch {
        continue; // no effect in that direction
      }
      const tuple = moveTuple(direction, state);
      if (tuple) log.push(tuple);
      moves += 1;
      moved = true;
    }
    turn += 1;
    if (!moved) break;
  }
  log.flush();
  recorder.endSession();

  return {
    game_started: { initial_board },
    events: saved.map((e) => ({ type: e.type, data: e.data })),
    final: { board: flatten(state.board), score: state.score, moves },
  };
}

/** The reference slide, by the engine's line rule (as in replay.test.ts). */
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

/** Rebuilds the game from the opening board and the `moves` events alone. */
function rebuild(golden: Golden): { board: number[]; score: number; moves: number } {
  let board = Array.from({ length: SIZE }, (_, r) =>
    golden.game_started.initial_board.slice(r * SIZE, (r + 1) * SIZE)
  );
  let score = 0;
  let moves = 0;
  for (const event of golden.events) {
    if (event.type !== "moves") continue;
    for (const [dir, cell, value, gained, total] of (event.data as { m: MoveTuple[] }).m) {
      const slid = slide(board, DIRECTION_ORDER[dir]!);
      board = slid.board;
      board[Math.floor(cell / SIZE)]![cell % SIZE] = value;
      score += slid.gained;
      expect(slid.gained).toBe(gained);
      expect(score).toBe(total);
      moves += 1;
    }
  }
  return { board: flatten(board), score, moves };
}

describe("twenty48_replay_v1.json", () => {
  it("is what the app records today", () => {
    const fresh = playGolden();
    if (process.env.UPDATE_TWENTY48_REPLAY_FIXTURE === "1") {
      // one event per line: a readable diff, a small file
      fs.writeFileSync(
        FIXTURE,
        `{\n "game_started": ${JSON.stringify(fresh.game_started)},\n "events": [\n${fresh.events
          .map((e) => `  ${JSON.stringify(e)}`)
          .join(",\n")}\n ],\n "final": ${JSON.stringify(fresh.final)}\n}\n`
      );
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it("replays to the hard-coded final board and score", () => {
    const golden = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Golden;
    const rebuilt = rebuild(golden);
    expect(rebuilt.moves).toBe(EXPECTED_MOVES);
    expect(rebuilt.score).toBe(EXPECTED_SCORE);
    expect(rebuilt.board).toEqual(EXPECTED_BOARD.flat());
  });

  it("plays the seeded game to the hard-coded final board and score", () => {
    const fresh = playGolden();
    expect(fresh.final.moves).toBe(EXPECTED_MOVES);
    expect(fresh.final.score).toBe(EXPECTED_SCORE);
    expect(fresh.final.board).toEqual(EXPECTED_BOARD.flat());
  });

  it("is three whole chunks and a partial one", () => {
    const golden = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Golden;
    const sizes = golden.events.map((e) => (e.data as { m: unknown[] }).m.length);
    expect(sizes).toEqual([25, 25, 25, 24]);
  });
});
