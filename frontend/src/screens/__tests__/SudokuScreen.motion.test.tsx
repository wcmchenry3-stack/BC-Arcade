/**
 * SudokuScreen motion (#3774, "Calm"): the full-screen red and glow overlays are gone; an illegal
 * digit marks its cell and the cells it clashes with; a completed row, column or box sweeps its own
 * cells (Mini's 2 x 3 boxes too); the solving move runs a wave and the card follows 1.0 s later,
 * never early; under Reduce Motion nothing moves and the card shows at once.
 */

import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import SudokuScreen from "../SudokuScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { enterDigit, getConflicts, loadPuzzle, selectCell } from "../../game/sudoku/engine";
import { saveGame } from "../../game/sudoku/storage";
import { SOLVED_BEAT_MS, unitCells, type UnitKind } from "../../game/sudoku/motion";
import type { CellValue, SudokuState, Variant } from "../../game/sudoku/types";
import { variantConfig } from "../../game/sudoku/types";

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

beforeEach(async () => {
  mockReduceMotion = false;
  await AsyncStorage.clear();
});

// A fresh element each time: the same one would let React skip the re-render.
const ui = () => (
  <ThemeProvider>
    <SudokuScreen />
  </ThemeProvider>
);

async function resume(state: SudokuState) {
  await saveGame(state);
  const r = await render(ui());
  await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
  return r;
}

/** Fills each of `cells` (indices) that is empty with its solution digit. */
function fill(state: SudokuState, cells: readonly number[]): SudokuState {
  const { size } = variantConfig(state.variant);
  let s = state;
  for (const i of cells) {
    const r = Math.floor(i / size);
    const c = i % size;
    if (s.grid[r]![c]!.given || s.grid[r]![c]!.value !== 0) continue;
    s = enterDigit(selectCell(s, r, c), (s.solution.charCodeAt(i) - 48) as CellValue);
  }
  return s;
}

const digitAt = (s: SudokuState, i: number) => (s.solution.charCodeAt(i) - 48) as CellValue;

async function pressDigit(r: Awaited<ReturnType<typeof resume>>, digit: number) {
  await act(async () => {
    await fireEvent.press(r.getByLabelText(new RegExp(`enter digit ${digit}\\.`, "i")));
  });
}

const testIds = (r: Awaited<ReturnType<typeof resume>>, suffix: string) =>
  r
    .queryAllByTestId(new RegExp(`^sudoku-cell-\\d+-\\d+-${suffix}$`))
    .map((n) => String(n.props.testID))
    .map((id) => {
      const [, , row, col] = id.split("-");
      return Number(row) * 100 + Number(col);
    })
    .sort((a, b) => a - b);
const asIds = (cells: number[], size: number) =>
  cells.map((i) => Math.floor(i / size) * 100 + (i % size)).sort((a, b) => a - b);

/**
 * A puzzle ready for the move that completes `unit`: every other empty cell of its unit filled,
 * the last one selected. Returns what the engine says that move completes.
 */
function readyToComplete(variant: Variant, unit: UnitKind, only: boolean) {
  const base = loadPuzzle("easy", variant, () => 0);
  const { size } = variantConfig(variant);
  for (let target = 0; target < size * size; target++) {
    if (base.grid[Math.floor(target / size)]![target % size]!.given) continue;
    const r = Math.floor(target / size);
    const c = target % size;
    const { boxRows, boxCols } = variantConfig(variant);
    const index =
      unit === "row"
        ? r
        : unit === "col"
          ? c
          : Math.floor(r / boxRows) * boxRows * size + Math.floor(c / boxCols) * boxCols;
    const others = unitCells(unit, index, variant).filter((i) => i !== target);
    const prepared = selectCell(fill(base, others), r, c);
    const events = enterDigit(prepared, digitAt(prepared, target)).events ?? [];
    const completed = events.filter((e) => e.type === "unitComplete");
    if (events.some((e) => e.type === "puzzleComplete")) continue;
    if (!completed.some((e) => e.unit === unit && e.index === index)) continue;
    // `only`: just this unit completes, so the sweep is exactly its cells.
    if (only && completed.length !== 1) continue;
    return { state: prepared, target, index, digit: digitAt(prepared, target), completed };
  }
  throw new Error(`no ${variant} ${unit} to complete`);
}

describe("SudokuScreen motion (#3774) — no full-screen overlays", () => {
  it("has neither the red flash nor the glow overlay, at rest or after an error or a unit", async () => {
    const { state, digit } = readyToComplete("classic", "row", false);
    const r = await resume(state);
    expect(r.queryByTestId("sudoku-invalid-flash")).toBeNull();
    expect(r.queryByTestId("sudoku-unit-flash")).toBeNull();
    await pressDigit(r, digit);
    expect(r.queryByTestId("sudoku-invalid-flash")).toBeNull();
    expect(r.queryByTestId("sudoku-unit-flash")).toBeNull();
  });
});

describe("SudokuScreen motion (#3774) — place", () => {
  it("a digit with nothing else to show touches no other cell, and an idle board has no overlays", async () => {
    const base = loadPuzzle("easy", "classic", () => 0);
    const r = await resume(selectCell(base, 0, 0));
    expect(testIds(r, "error")).toEqual([]);
    expect(testIds(r, "sweep")).toEqual([]);
    expect(testIds(r, "wave")).toEqual([]);
    expect(r.queryByTestId("sudoku-solved-wave")).toBeNull();
  });
});

describe("SudokuScreen motion (#3774) — error", () => {
  /** A puzzle with an empty cell and an illegal digit for it. */
  function illegalScenario() {
    const base = loadPuzzle("medium", "classic", () => 0);
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9);
      const c = i % 9;
      if (base.grid[r]![c]!.given) continue;
      for (let d = 1; d <= 9; d++) {
        if (d === digitAt(base, i)) continue;
        if (getConflicts(base.grid, r, c, d).length > 0) {
          return { state: selectCell(base, r, c), row: r, col: c, digit: d };
        }
      }
    }
    throw new Error("no illegal digit");
  }

  it("marks the cell and the cells it clashes with, not the screen", async () => {
    const s = illegalScenario();
    const r = await resume(s.state);
    expect(testIds(r, "clash")).toEqual([]);
    await pressDigit(r, s.digit);

    expect(testIds(r, "error")).toEqual([s.row * 100 + s.col]);
    const clashing = testIds(r, "clash");
    expect(clashing.length).toBeGreaterThan(0);
    expect(clashing).not.toContain(s.row * 100 + s.col);
    expect(r.queryByTestId("sudoku-invalid-flash")).toBeNull();
  });

  it("under Reduce Motion shows only the static clash ring: no pulse, and the ring stays", async () => {
    mockReduceMotion = true;
    const s = illegalScenario();
    const r = await resume(s.state);
    await pressDigit(r, s.digit);
    expect(testIds(r, "error")).toEqual([]);
    expect(testIds(r, "clash").length).toBeGreaterThan(0);
  });

  it("a later legal digit leaves no pulse behind", async () => {
    const s = illegalScenario();
    const r = await resume(s.state);
    await pressDigit(r, s.digit);
    expect(testIds(r, "error")).toHaveLength(1);
    // Erase it, then enter the right digit.
    await act(async () => {
      await fireEvent.press(r.getByTestId("sudoku-erase"));
    });
    await pressDigit(r, digitAt(s.state, s.row * 9 + s.col));
    expect(testIds(r, "error")).toEqual([]);
  });
});

describe("SudokuScreen motion (#3774) — unit complete", () => {
  it.each(["row", "col", "box"] as const)(
    "a completed %s sweeps exactly its own cells (Classic)",
    async (unit) => {
      const { state, digit, completed } = readyToComplete("classic", unit, true);
      const r = await resume(state);
      expect(testIds(r, "sweep")).toEqual([]);
      await pressDigit(r, digit);
      const e = completed[0]!;
      expect(testIds(r, "sweep")).toEqual(asIds(unitCells(e.unit, e.index, "classic"), 9));
      expect(r.queryByTestId("sudoku-unit-flash")).toBeNull();
    }
  );

  it.each(["row", "col", "box"] as const)(
    "a completed %s sweeps exactly its own cells (Mini, 2 x 3 boxes)",
    async (unit) => {
      const { state, digit, completed } = readyToComplete("mini", unit, false);
      const r = await resume(state);
      await pressDigit(r, digit);
      const want = new Set<number>();
      for (const e of completed) for (const i of unitCells(e.unit, e.index, "mini")) want.add(i);
      const mine = completed.find((e) => e.unit === unit)!;
      expect(want.size).toBeGreaterThanOrEqual(unitCells(mine.unit, mine.index, "mini").length);
      expect(testIds(r, "sweep")).toEqual(asIds([...want], 6));
    }
  );

  it("under Reduce Motion there is no sweep", async () => {
    mockReduceMotion = true;
    const { state, digit } = readyToComplete("classic", "row", false);
    const r = await resume(state);
    await pressDigit(r, digit);
    expect(testIds(r, "sweep")).toEqual([]);
  });

  it("selecting another cell afterwards does not replay or clear the sweep", async () => {
    const { state, digit } = readyToComplete("classic", "row", true);
    const r = await resume(state);
    await pressDigit(r, digit);
    const before = testIds(r, "sweep");
    await act(async () => {
      await fireEvent.press(r.getByTestId("sudoku-cell-0-0"));
    });
    expect(testIds(r, "sweep")).toEqual(before);
  });
});

describe("SudokuScreen motion (#3774) — solved", () => {
  /** One empty cell left, selected. */
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

  it("runs the wave from the solving move, holds the card for 1.0 s, then shows it", async () => {
    const { state, digit } = almostSolved();
    const r = await resume(state);
    expect(r.queryByTestId("sudoku-solved-wave")).toBeNull();
    const t0 = Date.now();
    await pressDigit(r, digit);
    // The solving move's own render: the wave is on and the card is not up.
    expect(r.getByTestId("sudoku-solved-wave")).toBeTruthy();
    expect(testIds(r, "wave")).toHaveLength(81);
    expect(r.queryByTestId("sudoku-result-title")).toBeNull();
    // Unit sweeps stand aside for the wave.
    expect(testIds(r, "sweep")).toEqual([]);

    await waitFor(() => expect(r.getByTestId("sudoku-result-title")).toBeTruthy());
    expect(Date.now() - t0).toBeGreaterThanOrEqual(SOLVED_BEAT_MS - 100);
    expect(r.queryByTestId("sudoku-solved-wave")).toBeNull();
  });

  it("under Reduce Motion the card shows at once, with no wave", async () => {
    mockReduceMotion = true;
    const { state, digit } = almostSolved();
    const r = await resume(state);
    await pressDigit(r, digit);
    expect(r.getByTestId("sudoku-result-title")).toBeTruthy();
    expect(r.queryByTestId("sudoku-solved-wave")).toBeNull();
    expect(testIds(r, "wave")).toEqual([]);
  });

  it("turning Reduce Motion on mid-beat cancels the beat and shows the card", async () => {
    const { state, digit } = almostSolved();
    const r = await resume(state);
    await pressDigit(r, digit);
    expect(r.queryByTestId("sudoku-result-title")).toBeNull();
    mockReduceMotion = true;
    await r.rerender(ui());
    expect(r.getByTestId("sudoku-result-title")).toBeTruthy();
    expect(r.queryByTestId("sudoku-solved-wave")).toBeNull();
  });

  it("a game restored already solved shows the card at once, with no wave", async () => {
    const { state, digit } = almostSolved();
    const solved = enterDigit(state, digit);
    expect(solved.isComplete).toBe(true);
    const r = await resume(solved);
    expect(r.getByTestId("sudoku-result-title")).toBeTruthy();
    expect(r.queryByTestId("sudoku-solved-wave")).toBeNull();
  });
});
