import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import {
  clearGame,
  loadGame,
  saveGame,
  loadStats,
  saveStats,
  EMPTY_SUDOKU_STATS,
} from "../storage";
import { enterDigit, loadPuzzle, selectCell, toggleNotesMode } from "../engine";
import type { CellValue, NoteDigit, SudokuState } from "../types";

const GAME_KEY = "sudoku_game";

// Deterministic puzzle selection for tests — always pick index 0 of the
// easy bank.  The puzzle is static in `puzzles.json`, so the resumed
// state comparison is meaningful.
function rng0(): number {
  return 0;
}

function findFirstEmpty(state: SudokuState): { row: number; col: number } {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = state.grid[r]?.[c];
      if (cell && !cell.given) return { row: r, col: c };
    }
  }
  throw new Error("no empty cell");
}

describe("sudoku storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("returns null when no save exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("round-trips a fresh puzzle via save → load", async () => {
    const s = loadPuzzle("easy", "classic", rng0);
    await saveGame(s);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.difficulty).toBe("easy");
    expect(loaded!.puzzle).toBe(s.puzzle);
    expect(loaded!.solution).toBe(s.solution);
    expect(loaded!._v).toBe(1);
  });

  it("restores Set<NoteDigit> notes after a JSON round-trip", async () => {
    let s = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findFirstEmpty(s);
    s = toggleNotesMode(s); // enter notes mode
    s = selectCell(s, row, col);
    s = enterDigit(s, 3 as CellValue);
    s = enterDigit(s, 7 as CellValue);

    expect(s.grid[row]![col]!.notes).toBeInstanceOf(Set);
    expect(s.grid[row]![col]!.notes.has(3 as NoteDigit)).toBe(true);

    await saveGame(s);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();

    const restored = loaded!.grid[row]![col]!;
    // The deserialised notes field must be a Set, not an array.
    expect(restored.notes).toBeInstanceOf(Set);
    expect(restored.notes.has(3 as NoteDigit)).toBe(true);
    expect(restored.notes.has(7 as NoteDigit)).toBe(true);
    expect(restored.notes.has(1 as NoteDigit)).toBe(false);
  });

  it("preserves errorCount, selection, and notesMode across reload", async () => {
    let s = loadPuzzle("hard", "classic", rng0);
    const { row, col } = findFirstEmpty(s);
    const correct = s.solution.charCodeAt(row * 9 + col) - 48;
    const wrong = ((correct % 9) + 1) as CellValue;
    s = selectCell(s, row, col);
    s = enterDigit(s, wrong);
    s = toggleNotesMode(s);

    await saveGame(s);
    const loaded = await loadGame();

    expect(loaded!.errorCount).toBe(1);
    expect(loaded!.selectedRow).toBe(row);
    expect(loaded!.selectedCol).toBe(col);
    expect(loaded!.notesMode).toBe(true);
    expect(loaded!.grid[row]![col]!.isError).toBe(true);
    expect(loaded!.grid[row]![col]!.value).toBe(wrong);
  });

  it("strips nested undoStack snapshots at save time", async () => {
    let s = loadPuzzle("easy", "classic", rng0);
    const { row, col } = findFirstEmpty(s);
    s = selectCell(s, row, col);
    s = enterDigit(s, 5 as CellValue);
    expect(s.undoStack.length).toBeGreaterThan(0);

    await saveGame(s);
    const raw = await AsyncStorage.getItem(GAME_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    for (const snap of parsed.undoStack) {
      expect(snap.undoStack).toEqual([]);
    }
  });

  it("returns null and captures a warning on unparseable JSON", async () => {
    await AsyncStorage.setItem(GAME_KEY, "not-json{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureMessage).toHaveBeenCalled();
    // Payload should have been removed after the failed parse.
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("returns null on version mismatch", async () => {
    await AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({
        _v: 2,
        difficulty: "easy",
        puzzle: "0".repeat(81),
        solution: "0".repeat(81),
        grid: [],
        selectedRow: null,
        selectedCol: null,
        notesMode: false,
        errorCount: 0,
        isComplete: false,
        undoStack: [],
      })
    );
    expect(await loadGame()).toBeNull();
  });

  it("returns null on shape-invalid payload", async () => {
    await AsyncStorage.setItem(
      GAME_KEY,
      JSON.stringify({
        _v: 1,
        difficulty: "wizard", // not a valid tier
      })
    );
    expect(await loadGame()).toBeNull();
  });

  it("clearGame removes the persisted state", async () => {
    const s = loadPuzzle("easy", "classic", rng0);
    await saveGame(s);
    expect(await AsyncStorage.getItem(GAME_KEY)).not.toBeNull();
    await clearGame();
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("handles AsyncStorage.getItem rejection by returning null", async () => {
    const orig = AsyncStorage.getItem;
    (AsyncStorage as unknown as { getItem: jest.Mock }).getItem = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"));
    try {
      expect(await loadGame()).toBeNull();
      expect(Sentry.captureException).toHaveBeenCalled();
    } finally {
      (AsyncStorage as unknown as { getItem: typeof orig }).getItem = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Stats storage (#762)
// ---------------------------------------------------------------------------

const STATS_KEY = "sudoku_stats_v1";

describe("sudoku stats storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it("returns EMPTY_SUDOKU_STATS when nothing is stored", async () => {
    const stats = await loadStats();
    expect(stats).toEqual(EMPTY_SUDOKU_STATS);
  });

  it("EMPTY_SUDOKU_STATS has zero values for all difficulties and variants", () => {
    for (const v of ["classic", "mini"] as const) {
      for (const diff of ["easy", "medium", "hard"] as const) {
        expect(EMPTY_SUDOKU_STATS[v][diff].bestTimeS).toBe(0);
      }
    }
  });

  it("round-trips stats via saveStats → loadStats", async () => {
    const stats = {
      classic: {
        easy: { bestTimeS: 120 },
        medium: { bestTimeS: 300 },
        hard: { bestTimeS: 600 },
      },
      mini: {
        easy: { bestTimeS: 0 },
        medium: { bestTimeS: 0 },
        hard: { bestTimeS: 0 },
      },
    };
    await saveStats(stats);
    const loaded = await loadStats();
    expect(loaded).toEqual(stats);
  });

  it("persists to STATS_KEY in AsyncStorage", async () => {
    const stats = {
      classic: {
        easy: { bestTimeS: 90 },
        medium: { bestTimeS: 0 },
        hard: { bestTimeS: 0 },
      },
      mini: {
        easy: { bestTimeS: 0 },
        medium: { bestTimeS: 0 },
        hard: { bestTimeS: 0 },
      },
    };
    await saveStats(stats);
    const raw = await AsyncStorage.getItem(STATS_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(stats);
  });

  it("migrates pre-#748 flat stats as classic variant", async () => {
    // Simulate a payload from before the nested structure was introduced.
    await AsyncStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        easy: { bestTimeS: 60 },
        medium: { bestTimeS: 0 },
        hard: { bestTimeS: 0 },
      })
    );
    const loaded = await loadStats();
    expect(loaded.classic.easy).toEqual({ bestTimeS: 60 });
    expect(loaded.classic.medium).toEqual({ bestTimeS: 0 });
    expect(loaded.classic.hard).toEqual({ bestTimeS: 0 });
    expect(loaded.mini.easy).toEqual({ bestTimeS: 0 });
  });

  it("recovers partial DifficultyStats fields as zeros (old flat format migration)", async () => {
    await AsyncStorage.setItem(
      STATS_KEY,
      JSON.stringify({ easy: { gamesSolved: 4 }, medium: {}, hard: null })
    );
    const loaded = await loadStats();
    expect(loaded.classic.easy).toEqual({ bestTimeS: 0 });
    expect(loaded.classic.medium).toEqual({ bestTimeS: 0 });
    expect(loaded.classic.hard).toEqual({ bestTimeS: 0 });
  });

  // #2636: only the best time is kept; an older build's record still loads.
  it("loads the best times from a record with the old gamesSolved counters", async () => {
    await AsyncStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        classic: {
          easy: { bestTimeS: 95, gamesSolved: 12 },
          medium: { bestTimeS: 0, gamesSolved: 0 },
          hard: { bestTimeS: 400, gamesSolved: 2 },
        },
        mini: { easy: { bestTimeS: 30, gamesSolved: 1 } },
      })
    );
    const loaded = await loadStats();
    expect(loaded.classic).toEqual({
      easy: { bestTimeS: 95 },
      medium: { bestTimeS: 0 },
      hard: { bestTimeS: 400 },
    });
    expect(loaded.mini.easy).toEqual({ bestTimeS: 30 });
    await saveStats(loaded);
    expect(JSON.parse((await AsyncStorage.getItem(STATS_KEY))!).classic.easy).toEqual({
      bestTimeS: 95,
    });
  });

  it("returns empty stats and captures exception on AsyncStorage failure", async () => {
    const orig = AsyncStorage.getItem;
    (AsyncStorage as unknown as { getItem: jest.Mock }).getItem = jest
      .fn()
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      const loaded = await loadStats();
      expect(loaded).toEqual(EMPTY_SUDOKU_STATS);
      expect(Sentry.captureException).toHaveBeenCalled();
    } finally {
      (AsyncStorage as unknown as { getItem: typeof orig }).getItem = orig;
    }
  });

  it("returns empty stats on unparseable JSON", async () => {
    await AsyncStorage.setItem(STATS_KEY, "{{bad json");
    const loaded = await loadStats();
    expect(loaded).toEqual(EMPTY_SUDOKU_STATS);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("saveStats handles AsyncStorage.setItem rejection silently", async () => {
    const orig = AsyncStorage.setItem;
    (AsyncStorage as unknown as { setItem: jest.Mock }).setItem = jest
      .fn()
      .mockRejectedValueOnce(new Error("quota exceeded"));
    try {
      await expect(saveStats(EMPTY_SUDOKU_STATS)).resolves.toBeUndefined();
      expect(Sentry.captureException).toHaveBeenCalled();
    } finally {
      (AsyncStorage as unknown as { setItem: typeof orig }).setItem = orig;
    }
  });
});
