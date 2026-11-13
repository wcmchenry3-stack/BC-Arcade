/**
 * SudokuScreen sounds (#3775, "crisp graphite"): one sound per move from the engine's events. A digit
 * (or a hint, which places one) plays the place tick, three alternating variations; an illegal digit
 * plays the scratch-out; a completed row, column or box plays the unit taps INSTEAD of the tick; the
 * solving move plays only the win, which starts at the solving render. Notes, Erase, Undo and the
 * Hint button are silent, a restored solved game and a remount are silent, and the win is cut off by
 * Play Again, Change Difficulty, a new game and unmount.
 */

import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import SudokuScreen from "../SudokuScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { enterDigit, getConflicts, loadPuzzle, selectCell } from "../../game/sudoku/engine";
import { saveGame } from "../../game/sudoku/storage";
import { unitCells, type UnitKind } from "../../game/sudoku/motion";
import type { CellValue, SudokuState } from "../../game/sudoku/types";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => () => {}),
  }))
);
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => jest.fn(() => "game-1")),
    resumeGame: lazy(() => jest.fn(() => null)),
  });
});
jest.mock("../../api/stats", () =>
  mockScreenDeps().mockStatsApi({
    getGameRank: () => Promise.resolve({ ranked: true, rank: 3, is_best: true, reason: null }),
  })
);
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn(() => Promise.resolve({ display_name: "Brave Otter 4821" })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

let mockReduceMotion = false;
jest.mock("../../components/shared/useReduceMotion", () => ({
  ...jest.requireActual("../../components/shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

// Every sound records its plays and stops by registry key; the variations by their key list.
const mockPlays: string[] = [];
const mockStops: string[] = [];
const mockVariantKeys: (readonly string[])[] = [];
jest.mock("../../game/_shared/useSound", () => ({
  useSound: (key: string) => ({
    play: () => (mockPlays.push(key), true),
    stop: () => void mockStops.push(key),
  }),
}));
jest.mock("../../game/_shared/useSoundVariants", () => ({
  useSoundVariants: (keys: readonly string[]) => {
    if (!mockVariantKeys.includes(keys)) mockVariantKeys.push(keys);
    return { play: () => (mockPlays.push(keys[0]!), true) };
  },
}));

beforeEach(async () => {
  mockReduceMotion = false;
  mockPlays.length = 0;
  mockStops.length = 0;
  mockVariantKeys.length = 0;
  await AsyncStorage.clear();
});

const ui = () => (
  <ThemeProvider>
    <SudokuScreen />
  </ThemeProvider>
);

type Rendered = Awaited<ReturnType<typeof render>>;

async function resume(state: SudokuState): Promise<Rendered> {
  await saveGame(state);
  const r = await render(ui());
  await waitFor(() =>
    expect(r.queryByTestId("sudoku-undo") ?? r.queryByTestId("sudoku-result-title")).toBeTruthy()
  );
  return r;
}

const digitAt = (s: SudokuState, i: number) => (s.solution.charCodeAt(i) - 48) as CellValue;

function fill(state: SudokuState, cells: readonly number[]): SudokuState {
  let s = state;
  for (const i of cells) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    if (s.grid[r]![c]!.given || s.grid[r]![c]!.value !== 0) continue;
    s = enterDigit(selectCell(s, r, c), digitAt(s, i));
  }
  return s;
}

async function pressDigit(r: Rendered, digit: number) {
  await act(async () => {
    await fireEvent.press(r.getByLabelText(new RegExp(`enter digit ${digit}\\.`, "i")));
  });
}
async function pressId(r: Rendered, id: string) {
  await act(async () => {
    await fireEvent.press(r.getByTestId(id));
  });
}

/** An easy puzzle with a selected empty cell whose solution digit completes nothing. */
function plainPlace() {
  const base = loadPuzzle("easy", "classic", () => 0);
  for (let i = 0; i < 81; i++) {
    if (base.grid[Math.floor(i / 9)]![i % 9]!.given) continue;
    const s = selectCell(base, Math.floor(i / 9), i % 9);
    const ev = enterDigit(s, digitAt(s, i)).events ?? [];
    if (ev.length === 1 && ev[0]!.type === "digitPlace") return { state: s, digit: digitAt(s, i) };
  }
  throw new Error("no plain place");
}

function illegalScenario() {
  const base = loadPuzzle("medium", "classic", () => 0);
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    if (base.grid[r]![c]!.given) continue;
    for (let d = 1; d <= 9; d++) {
      if (d !== digitAt(base, i) && getConflicts(base.grid, r, c, d).length > 0) {
        return { state: selectCell(base, r, c), digit: d };
      }
    }
  }
  throw new Error("no illegal digit");
}

/** The move before a row completes, the last cell selected. */
function readyToCompleteRow() {
  const base = loadPuzzle("easy", "classic", () => 0);
  for (let target = 0; target < 81; target++) {
    const r = Math.floor(target / 9);
    const c = target % 9;
    if (base.grid[r]![c]!.given) continue;
    const others = unitCells("row" as UnitKind, r, "classic").filter((i) => i !== target);
    const prepared = selectCell(fill(base, others), r, c);
    const ev = enterDigit(prepared, digitAt(prepared, target)).events ?? [];
    if (ev.some((e) => e.type === "puzzleComplete")) continue;
    if (ev.some((e) => e.type === "unitComplete")) {
      return { state: prepared, digit: digitAt(prepared, target) };
    }
  }
  throw new Error("no row to complete");
}

function almostSolved() {
  const base = loadPuzzle("easy", "classic", () => 0);
  const cells = Array.from({ length: 81 }, (_, i) => i);
  const last = cells.find((i) => !base.grid[Math.floor(i / 9)]![i % 9]!.given)!;
  const state = selectCell(
    fill(
      base,
      cells.filter((i) => i !== last)
    ),
    Math.floor(last / 9),
    last % 9
  );
  return { state, digit: digitAt(base, last) };
}

describe("SudokuScreen sounds (#3775)", () => {
  it("a digit plays the place tick, through three variations", async () => {
    const { state, digit } = plainPlace();
    const r = await resume(state);
    expect(mockPlays).toEqual([]);
    await pressDigit(r, digit);
    expect(mockPlays).toEqual(["sudoku.digitPlace"]);
    expect(mockVariantKeys).toEqual([
      ["sudoku.digitPlace", "sudoku.digitPlace2", "sudoku.digitPlace3"],
    ]);
  });

  it("a hint places a digit, so it plays the place tick; the Hint button itself is silent", async () => {
    const { state } = plainPlace();
    // No cell selected: the Hint press does nothing and makes no sound.
    const none = await resume({ ...state, selectedRow: null, selectedCol: null });
    await pressId(none, "sudoku-hint");
    expect(mockPlays).toEqual([]);
    await none.unmount();

    const r = await resume(state);
    await pressId(r, "sudoku-hint");
    expect(mockPlays).toEqual(["sudoku.digitPlace"]);
  });

  it("an illegal digit plays the scratch-out, and only that", async () => {
    const { state, digit } = illegalScenario();
    const r = await resume(state);
    await pressDigit(r, digit);
    expect(mockPlays).toEqual(["sudoku.errorEntered"]);
  });

  it("a completed row plays the unit taps in place of the place tick: one sound for the move", async () => {
    const { state, digit } = readyToCompleteRow();
    const r = await resume(state);
    await pressDigit(r, digit);
    expect(mockPlays).toEqual(["sudoku.unitComplete"]);
  });

  it("the solving move plays only the win, at its render, and nothing again once the card shows", async () => {
    const { state, digit } = almostSolved();
    const r = await resume(state);
    await pressDigit(r, digit);
    // At the solving render: the wave is up, the card is not, and the win has started.
    expect(r.getByTestId("sudoku-solved-wave")).toBeTruthy();
    expect(r.queryByTestId("sudoku-result-title")).toBeNull();
    expect(mockPlays).toEqual(["sudoku.puzzleComplete"]);
    await waitFor(() => expect(r.getByTestId("sudoku-result-title")).toBeTruthy());
    expect(mockPlays).toEqual(["sudoku.puzzleComplete"]);
  });

  it("under Reduce Motion the solving move still plays the win once", async () => {
    mockReduceMotion = true;
    const { state, digit } = almostSolved();
    const r = await resume(state);
    await pressDigit(r, digit);
    expect(mockPlays).toEqual(["sudoku.puzzleComplete"]);
  });

  it("a game restored already solved is silent, and so is a remount", async () => {
    const { state, digit } = almostSolved();
    const solved = enterDigit(state, digit);
    const r = await resume(solved);
    expect(r.getByTestId("sudoku-result-title")).toBeTruthy();
    expect(mockPlays).toEqual([]);
    await r.unmount();
    await render(ui());
    expect(mockPlays).toEqual([]);

    // A mid-game restore is silent too.
    const mid = await resume(plainPlace().state);
    expect(mid.queryByTestId("sudoku-result-title")).toBeNull();
    expect(mockPlays).toEqual([]);
  });

  it("Notes, Erase and Undo are silent; so is selecting a cell and a pause-style re-render", async () => {
    const { state, digit } = plainPlace();
    const r = await resume(state);
    await pressDigit(r, digit);
    mockPlays.length = 0;
    await pressId(r, "sudoku-undo");
    await pressId(r, "sudoku-notes");
    await pressId(r, "sudoku-cell-0-0");
    await pressDigit(r, 5); // a note, in notes mode
    await pressId(r, "sudoku-notes");
    await pressId(r, "sudoku-erase");
    await r.rerender(ui());
    expect(mockPlays).toEqual([]);
  });

  it("a second digit plays again: once per move", async () => {
    const { state, digit } = plainPlace();
    const r = await resume(state);
    await pressDigit(r, digit);
    await pressId(r, "sudoku-undo");
    await pressDigit(r, digit);
    expect(mockPlays).toEqual(["sudoku.digitPlace", "sudoku.digitPlace"]);
  });

  describe("the win is cut off", () => {
    const solvedCard = async () => {
      const { state, digit } = almostSolved();
      const r = await resume(state);
      await pressDigit(r, digit);
      await waitFor(() => expect(r.getByTestId("sudoku-result-title")).toBeTruthy());
      mockStops.length = 0;
      return r;
    };

    it("on Play Again", async () => {
      const r = await solvedCard();
      await act(async () => {
        await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
      });
      expect(mockStops).toContain("sudoku.puzzleComplete");
    });

    it("on Change Difficulty", async () => {
      const r = await solvedCard();
      await act(async () => {
        await fireEvent.press(r.getByRole("button", { name: "Change Difficulty" }));
      });
      expect(mockStops).toContain("sudoku.puzzleComplete");
    });

    it("on a new game from the bar, during the solved beat", async () => {
      const { state, digit } = almostSolved();
      const r = await resume(state);
      await pressDigit(r, digit);
      expect(r.queryByTestId("sudoku-result-title")).toBeNull();
      mockStops.length = 0;
      await pressId(r, "sudoku-new-game");
      await act(async () => {
        await fireEvent.press(r.getByLabelText("Start new game"));
      });
      await act(async () => {
        await fireEvent.press(r.getByText("Quick Restart"));
      });
      expect(mockStops).toContain("sudoku.puzzleComplete");
    });

    it("on unmount", async () => {
      const { state, digit } = almostSolved();
      const r = await resume(state);
      await pressDigit(r, digit);
      mockStops.length = 0;
      await r.unmount();
      expect(mockStops).toContain("sudoku.puzzleComplete");
    });
  });
});
