/**
 * Tests for the client-side 2048 engine.
 *
 * Ports backend/tests/test_twenty48_game.py so the two engines are
 * behaviorally identical.
 */

import {
  newGame,
  move,
  pauseGame,
  resumeGame,
  slideAndMerge,
  isGameOver,
  setRng,
  getRng,
  createSeededRng,
  SIZE,
  Direction,
} from "../engine";
import { Twenty48State, TileData, GameEvent } from "../types";

/**
 * Build a Twenty48State from a board, synthesising a tiles[] array by
 * scanning the board for non-zero cells and assigning sequential IDs.
 * This lets existing tests stay board-focused without worrying about tile
 * identity details.
 */
function stateWith(board: number[][], overrides: Partial<Twenty48State> = {}): Twenty48State {
  const tiles: TileData[] = [];
  let id = 1000; // use high IDs to avoid collisions with engine-generated IDs
  for (let r = 0; r < board.length; r++) {
    const row = board[r];
    if (row === undefined) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell !== undefined && cell !== 0) {
        tiles.push({
          id: id++,
          value: cell,
          row: r,
          col: c,
          prevRow: r,
          prevCol: c,
          isNew: false,
          isMerge: false,
        });
      }
    }
  }
  return {
    board: board.map((r) => [...r]),
    tiles,
    score: 0,
    scoreDelta: 0,
    game_over: false,
    has_won: false,
    startedAt: null,
    accumulatedMs: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// slideAndMerge — pure, no randomness
// ---------------------------------------------------------------------------

describe("slideAndMerge", () => {
  it("no merge when single tile", () => {
    const { line, score } = slideAndMerge([2, 0, 0, 0]);
    expect(line).toEqual([2, 0, 0, 0]);
    expect(score).toBe(0);
  });

  it("simple merge", () => {
    const { line, score } = slideAndMerge([2, 2, 0, 0]);
    expect(line).toEqual([4, 0, 0, 0]);
    expect(score).toBe(4);
  });

  it("slide then merge", () => {
    const { line, score } = slideAndMerge([0, 2, 0, 2]);
    expect(line).toEqual([4, 0, 0, 0]);
    expect(score).toBe(4);
  });

  it("no double merge — [2,2,2,2] → [4,4,0,0]", () => {
    const { line, score } = slideAndMerge([2, 2, 2, 2]);
    expect(line).toEqual([4, 4, 0, 0]);
    expect(score).toBe(8);
  });

  it("triple merges the left pair — [2,2,2,0] → [4,2,0,0]", () => {
    const { line, score } = slideAndMerge([2, 2, 2, 0]);
    expect(line).toEqual([4, 2, 0, 0]);
    expect(score).toBe(4);
  });

  it("mixed values no merge", () => {
    const { line, score } = slideAndMerge([2, 4, 2, 4]);
    expect(line).toEqual([2, 4, 2, 4]);
    expect(score).toBe(0);
  });

  it("large values — 1024+1024 = 2048", () => {
    const { line, score } = slideAndMerge([1024, 1024, 0, 0]);
    expect(line).toEqual([2048, 0, 0, 0]);
    expect(score).toBe(2048);
  });

  it("all zeros", () => {
    const { line, score } = slideAndMerge([0, 0, 0, 0]);
    expect(line).toEqual([0, 0, 0, 0]);
    expect(score).toBe(0);
  });

  it("slide-only compact", () => {
    const { line, score } = slideAndMerge([0, 0, 0, 4]);
    expect(line).toEqual([4, 0, 0, 0]);
    expect(score).toBe(0);
  });

  it("merges only first pair — [4,4,8,0] → [8,8,0,0]", () => {
    const { line, score } = slideAndMerge([4, 4, 8, 0]);
    expect(line).toEqual([8, 8, 0, 0]);
    expect(score).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// newGame
// ---------------------------------------------------------------------------

describe("newGame", () => {
  it("spawns exactly two initial tiles", () => {
    const s = newGame();
    const nonZero = s.board.flat().filter((c) => c !== 0).length;
    expect(nonZero).toBe(2);
  });

  it("initial tiles are 2 or 4", () => {
    const s = newGame();
    for (const row of s.board) {
      for (const cell of row) {
        if (cell !== 0) expect([2, 4]).toContain(cell);
      }
    }
  });

  it("initial score is zero", () => {
    expect(newGame().score).toBe(0);
  });

  it("initial not game-over", () => {
    expect(newGame().game_over).toBe(false);
  });

  it("initial not won", () => {
    expect(newGame().has_won).toBe(false);
  });

  it("board is 4x4", () => {
    const s = newGame();
    expect(s.board).toHaveLength(SIZE);
    for (const row of s.board) expect(row).toHaveLength(SIZE);
  });
});

// ---------------------------------------------------------------------------
// move — controlled boards
// ---------------------------------------------------------------------------

describe("move", () => {
  it("left merges same-row tiles", () => {
    const s = stateWith([
      [0, 0, 0, 0],
      [2, 0, 2, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = move(s, "left");
    expect(next.board[1]?.[0]).toBe(4);
    expect(next.score).toBe(4);
  });

  it("right merges same-row tiles to the right edge", () => {
    const s = stateWith([
      [0, 0, 0, 0],
      [0, 2, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = move(s, "right");
    expect(next.board[1]?.[3]).toBe(4);
    expect(next.score).toBe(4);
  });

  it("up merges same-column tiles toward row 0", () => {
    const s = stateWith([
      [0, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 2, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = move(s, "up");
    expect(next.board[0]?.[1]).toBe(4);
    expect(next.score).toBe(4);
  });

  it("down merges same-column tiles toward row 3", () => {
    const s = stateWith([
      [0, 0, 0, 0],
      [0, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 2, 0, 0],
    ]);
    const next = move(s, "down");
    expect(next.board[3]?.[1]).toBe(4);
    expect(next.score).toBe(4);
  });

  it("throws when move has no effect", () => {
    const s = stateWith([
      [2, 0, 0, 0],
      [4, 0, 0, 0],
      [2, 0, 0, 0],
      [4, 0, 0, 0],
    ]);
    expect(() => move(s, "left")).toThrow(/no effect/);
  });

  it("throws on invalid direction", () => {
    const s = newGame();
    expect(() => move(s, "diagonal" as unknown as Direction)).toThrow(/Invalid direction/);
  });

  it("spawns a new tile after a successful move", () => {
    const s = stateWith([
      [0, 0, 0, 0],
      [2, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = move(s, "left");
    // 2+2 merges to 4, spawn adds one more → 2 non-zero
    const nonZero = next.board.flat().filter((c) => c !== 0).length;
    expect(nonZero).toBe(2);
  });

  it("accumulates score across multiple merges in one move", () => {
    const s = stateWith([
      [2, 2, 4, 4],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = move(s, "left");
    // 2+2=4, 4+4=8 → gained 12
    expect(next.score).toBe(12);
  });

  it("throws when called on a game-over state", () => {
    const s = stateWith(
      [
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 2],
      ],
      { game_over: true }
    );
    expect(() => move(s, "left")).toThrow(/Game is over/);
  });

  it("returns a new state object (does not mutate input)", () => {
    const s = stateWith([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const snapshot = JSON.stringify(s);
    move(s, "left");
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// isGameOver
// ---------------------------------------------------------------------------

describe("isGameOver", () => {
  it("not over when an empty cell exists", () => {
    expect(
      isGameOver([
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 0],
      ])
    ).toBe(false);
  });

  it("not over when adjacent matches exist", () => {
    expect(
      isGameOver([
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 4], // last two match
      ])
    ).toBe(false);
  });

  it("over when full and no matches", () => {
    expect(
      isGameOver([
        [2, 4, 2, 4],
        [4, 2, 4, 2],
        [2, 4, 2, 4],
        [4, 2, 4, 2],
      ])
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// has_won
// ---------------------------------------------------------------------------

describe("has_won", () => {
  it("sets has_won when 2048 is produced", () => {
    const s = stateWith([
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = move(s, "left");
    expect(next.has_won).toBe(true);
    expect(next.board[0]?.[0]).toBe(2048);
  });

  it("has_won stays true after more moves (keep playing)", () => {
    const s = stateWith([
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const afterWin = move(s, "left");
    expect(afterWin.has_won).toBe(true);
    expect(afterWin.game_over).toBe(false);
    // Should be able to keep playing
    const afterDown = move(afterWin, "down");
    expect(afterDown.has_won).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spawn probability (~90% twos)
// ---------------------------------------------------------------------------

describe("spawn probability", () => {
  it("spawns a 2 roughly 90% of the time", () => {
    const counts: Record<number, number> = { 2: 0, 4: 0 };
    for (let i = 0; i < 1000; i++) {
      const s = newGame();
      // count both spawned tiles
      for (const row of s.board) {
        for (const cell of row) {
          if (cell !== 0) counts[cell] = (counts[cell] ?? 0) + 1;
        }
      }
    }
    const ratio2 = (counts[2] ?? 0) / ((counts[2] ?? 0) + (counts[4] ?? 0));
    expect(ratio2).toBeGreaterThanOrEqual(0.85);
    expect(ratio2).toBeLessThanOrEqual(0.95);
  });
});

// ---------------------------------------------------------------------------
// Seedable RNG
// ---------------------------------------------------------------------------

describe("seedable RNG (setRng + createSeededRng)", () => {
  afterEach(() => {
    // Restore default RNG so subsequent tests aren't affected.
    setRng(Math.random);
  });

  it("same seed produces identical initial boards", () => {
    setRng(createSeededRng(42));
    const a = newGame();
    setRng(createSeededRng(42));
    const b = newGame();
    expect(a.board).toEqual(b.board);
  });

  it("different seeds usually produce different boards", () => {
    setRng(createSeededRng(1));
    const a = newGame();
    setRng(createSeededRng(999));
    const b = newGame();
    // Two different seeds should diverge on at least one cell.
    const flatA = a.board.flat();
    const flatB = b.board.flat();
    const anyDiff = flatA.some((v, i) => v !== flatB[i]);
    expect(anyDiff).toBe(true);
  });

  it("same seed replays the exact tile sequence over 10 moves", () => {
    // Run A
    setRng(createSeededRng(7));
    let a = newGame();
    const sequenceA: number[][][] = [a.board.map((r) => [...r])];
    const directions: Direction[] = ["left", "down", "right", "up", "left"];
    for (const d of directions) {
      try {
        a = move(a, d);
        sequenceA.push(a.board.map((r) => [...r]));
      } catch {
        // "no effect" — try the next direction
      }
    }

    // Run B with same seed
    setRng(createSeededRng(7));
    let b = newGame();
    const sequenceB: number[][][] = [b.board.map((r) => [...r])];
    for (const d of directions) {
      try {
        b = move(b, d);
        sequenceB.push(b.board.map((r) => [...r]));
      } catch {
        // same skip
      }
    }

    expect(sequenceA).toEqual(sequenceB);
  });

  it("rng returning 0.5 spawns a 2 (not 4) — probability gate at 0.9", () => {
    // 0.5 < 0.9 → spawns 2. First call picks the cell index (floor(0.5 * N)),
    // second call decides 2 vs 4.
    setRng(() => 0.5);
    const s = newGame();
    const nonZero = s.board.flat().filter((v) => v !== 0);
    // newGame spawns 2 tiles; both should be 2s.
    expect(nonZero).toEqual([2, 2]);
  });

  it("rng returning 0.95 spawns a 4 — probability gate at 0.9", () => {
    setRng(() => 0.95);
    const s = newGame();
    const nonZero = s.board.flat().filter((v) => v !== 0);
    // 0.95 >= 0.9 → spawns 4s.
    expect(nonZero).toEqual([4, 4]);
  });

  it("setRng(Math.random) after afterEach restores non-determinism", () => {
    expect(getRng()).toBe(Math.random);
  });
});

// ---------------------------------------------------------------------------
// Timer tracking
// ---------------------------------------------------------------------------

describe("timer — newGame", () => {
  it("initialises startedAt to null", () => {
    expect(newGame().startedAt).toBeNull();
  });

  it("initialises accumulatedMs to 0", () => {
    expect(newGame().accumulatedMs).toBe(0);
  });
});

describe("timer — first move starts the clock", () => {
  beforeEach(() => setRng(createSeededRng(1)));
  afterEach(() => setRng(Math.random));

  it("sets startedAt to a recent timestamp on the first move", () => {
    const before = Date.now();
    const s = move(
      stateWith([
        [2, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "left"
    );
    const after = Date.now();
    expect(s.startedAt).not.toBeNull();
    expect(s.startedAt).toBeGreaterThanOrEqual(before);
    expect(s.startedAt).toBeLessThanOrEqual(after);
  });

  it("preserves accumulatedMs on non-terminal moves", () => {
    const s = move(
      stateWith(
        [
          [2, 2, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        {
          accumulatedMs: 5000,
        }
      ),
      "left"
    );
    expect(s.accumulatedMs).toBe(5000);
  });

  it("resumes from existing startedAt on subsequent moves", () => {
    const t0 = Date.now() - 3000;
    const s1 = move(
      stateWith(
        [
          [2, 2, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        {
          startedAt: t0,
        }
      ),
      "left"
    );
    // startedAt should remain the same value (clock ticking from t0).
    expect(s1.startedAt).toBe(t0);
  });
});

describe("timer — game over freezes the clock", () => {
  afterEach(() => setRng(Math.random));

  it("sets startedAt to null and adds elapsed time to accumulatedMs when game ends", () => {
    // Board: fully filled, one merge available (row 3 cols 2-3: 8+8).
    // Moving right merges them → 16, leaving empty cell at [3,0].
    // setRng(() => 0) spawns value 2 (rng < 0.9) at first empty in row-major
    // order → [3,0]. Result board has no adjacent equal pairs → game_over.
    //
    // Verify result board is locked:
    //   [4, 2, 4, 2]
    //   [2, 4, 2, 4]
    //   [4, 2, 4, 2]
    //   [2, 4, 2, 16]   ← spawned 2 at [3,0]; no col/row adjacent equals.
    const almostDoneBoard = [
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [4, 2, 8, 8], // merge 8+8→16 on right; spawn 2 at [3,0]
    ];
    setRng(() => 0);

    const t0 = Date.now() - 2000;
    const before = Date.now();
    const result = move(stateWith(almostDoneBoard, { startedAt: t0, accumulatedMs: 500 }), "right");
    const after = Date.now();

    expect(result.game_over).toBe(true);
    expect(result.startedAt).toBeNull();
    // accumulatedMs = prior 500 ms + elapsed since t0 (≥ 2000 ms).
    expect(result.accumulatedMs).toBeGreaterThanOrEqual(500 + (before - t0));
    expect(result.accumulatedMs).toBeLessThanOrEqual(500 + (after - t0));
  });
});

// ---------------------------------------------------------------------------
// Game events
// ---------------------------------------------------------------------------

describe("game events", () => {
  afterEach(() => setRng(Math.random));

  it("emits win2048 exactly once when has_won first becomes true", () => {
    setRng(() => 0);
    // Board one merge away from 2048.
    const preWin = stateWith([
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = move(preWin, "left");
    expect(next.has_won).toBe(true);
    expect(next.events).toContain<GameEvent>("win2048");
  });

  it("does not emit win2048 on subsequent moves after already won", () => {
    setRng(() => 0);
    // Board has already won; a valid left merge exists (row 1: 2+2→4).
    const alreadyWon = stateWith(
      [
        [2048, 0, 0, 0],
        [2, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      { has_won: true }
    );
    const next = move(alreadyWon, "left");
    expect(next.has_won).toBe(true);
    expect(next.events ?? []).not.toContain<GameEvent>("win2048");
  });

  it("emits gameOver when no valid moves remain after a move", () => {
    setRng(() => 0);
    // Board: one merge available; after the merge the spawned tile fills the
    // last empty cell and creates a game-over position.
    const almostDoneBoard = [
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [4, 2, 8, 8],
    ];
    const result = move(stateWith(almostDoneBoard), "right");
    expect(result.game_over).toBe(true);
    expect(result.events).toContain<GameEvent>("gameOver");
  });

  it("does not emit events on a regular non-terminal move", () => {
    setRng(() => 0);
    const s = stateWith([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const next = move(s, "left");
    expect(next.game_over).toBe(false);
    expect(next.has_won).toBe(false);
    expect(next.events).toBeUndefined();
  });

  it("newGame returns state with no events", () => {
    const s = newGame();
    expect(s.events).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pauseGame, resumeGame (#2735)
// ---------------------------------------------------------------------------

describe("pauseGame / resumeGame", () => {
  const emptyBoard = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  it("pauseGame accumulates time and clears startedAt", () => {
    const s = stateWith(emptyBoard, { startedAt: 1000, accumulatedMs: 200 });
    const paused = pauseGame(s, 1600);
    expect(paused.startedAt).toBeNull();
    expect(paused.accumulatedMs).toBe(800);
  });

  it("pauseGame is a no-op before the first move", () => {
    const s = stateWith(emptyBoard, { startedAt: null, accumulatedMs: 0 });
    expect(pauseGame(s, 5000)).toBe(s);
  });

  it("resumeGame sets startedAt", () => {
    const s = stateWith(emptyBoard, { startedAt: null, accumulatedMs: 200 });
    const resumed = resumeGame(s, 5000);
    expect(resumed.startedAt).toBe(5000);
  });

  it("resumeGame is a no-op when already running", () => {
    const s = stateWith(emptyBoard, { startedAt: 1000 });
    expect(resumeGame(s, 2000).startedAt).toBe(1000);
  });

  it("resumeGame is a no-op on a finished game", () => {
    const s = stateWith(emptyBoard, { startedAt: null, game_over: true });
    expect(resumeGame(s, 2000).startedAt).toBeNull();
  });
});
