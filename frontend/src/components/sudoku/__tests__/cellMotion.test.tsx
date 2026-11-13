/**
 * The board's motion props (#3774): a move's effects reach only the cells they touch, so the
 * memoised cells that are not affected skip their render (the render of a cell is counted by
 * `cellBackground`, as in cellRender.test.tsx); Reduce Motion mounts none of them; each effect
 * is keyed by the move, so a new move replays and the same one does not.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import SudokuGrid from "../SudokuGrid";
import { cellBackground } from "../cellStyle";
import type { SudokuMotion } from "../../../game/sudoku/motion";
import type { Grid, NoteDigit, SudokuCell as CellData } from "../../../game/sudoku/types";

jest.mock("../cellStyle", () => {
  const actual = jest.requireActual("../cellStyle");
  return { ...actual, cellBackground: jest.fn(actual.cellBackground) };
});
const renders = cellBackground as jest.Mock;

const cell = (o: Partial<CellData> = {}): CellData => ({
  value: 0,
  given: false,
  notes: new Set<NoteDigit>(),
  isError: false,
  ...o,
});
// Cells are shared between the two boards, as the engine does: a move replaces only its own cell.
const CELLS = Array.from({ length: 9 }, (_, r) =>
  Array.from({ length: 9 }, (_, c) =>
    r === 2 && c === 7 ? cell({ value: 5, given: true }) : cell()
  )
);
const PLACED_CELL = cell({ value: 5, isError: true });
function board(placed: boolean): Grid {
  return CELLS.map((row, r) => row.map((c, i) => (placed && r === 2 && i === 3 ? PLACED_CELL : c)));
}
const PLACED = 2 * 9 + 3;

interface Opts {
  grid: Grid;
  motion?: SudokuMotion | null;
  wave?: boolean;
  reduceMotion?: boolean;
  selected?: [number, number];
}
const onCellPress = () => {};
function ui({ grid, motion = null, wave = false, reduceMotion = false, selected = [2, 3] }: Opts) {
  return (
    <ThemeProvider>
      <SudokuGrid
        variant="classic"
        grid={grid}
        selectedRow={selected[0]}
        selectedCol={selected[1]}
        motion={motion}
        wave={wave}
        reduceMotion={reduceMotion}
        onCellPress={onCellPress}
      />
    </ThemeProvider>
  );
}
const ids = (r: ReturnType<typeof render> extends Promise<infer R> ? R : never, suffix: string) =>
  r.queryAllByTestId(new RegExp(`^sudoku-cell-\\d+-\\d+-${suffix}$`)).map((n) => n.props.testID);

const errorMove: SudokuMotion = { id: 1, placed: PLACED, error: true, units: [] };

describe("SudokuGrid motion (#3774)", () => {
  beforeEach(() => renders.mockClear());

  it("an illegal digit re-renders only its cell and the cell it clashes with", async () => {
    const r = await render(ui({ grid: board(false) }));
    renders.mockClear();
    await r.rerender(ui({ grid: board(true), motion: errorMove }));
    // The placed cell and the given it clashes with (and the cells sharing the digit's wash).
    expect(renders.mock.calls.length).toBeLessThanOrEqual(4);
    expect(ids(r, "error")).toEqual(["sudoku-cell-2-3-error"]);
    expect(ids(r, "clash")).toEqual(["sudoku-cell-2-7-clash"]);
  });

  it("an illegal digit blinks only the rings that clash with it, not an older conflict (Codex)", async () => {
    // An older conflict: a 7 at (6,0) (entered, illegal) and a given 7 at (6,8).
    const old7 = cell({ value: 7, isError: true });
    const given7 = cell({ value: 7, given: true });
    const grid = board(true).map((row, r) =>
      row.map((c, i) => (r === 6 && i === 0 ? old7 : r === 6 && i === 8 ? given7 : c))
    );
    const r = await render(ui({ grid, motion: errorMove }));
    // Both conflicts keep their static rings (on the cell each clashes with)...
    expect(ids(r, "clash").sort()).toEqual(["sudoku-cell-2-7-clash", "sudoku-cell-6-8-clash"]);
    // ...but only the new move's clash blinks.
    const blinking = r
      .queryAllByTestId(/^sudoku-cell-\d+-\d+-clash$/)
      .filter((n) => n.props.nativeID === "sudoku-clash-blink")
      .map((n) => n.props.testID);
    expect(blinking).toEqual(["sudoku-cell-2-7-clash"]);
  });

  it("a later render with the same move re-renders none of the cells (nothing replays)", async () => {
    const g = board(true);
    const r = await render(ui({ grid: g, motion: errorMove }));
    renders.mockClear();
    await r.rerender(ui({ grid: g, motion: errorMove }));
    expect(renders).not.toHaveBeenCalled();
  });

  it("a unit's sweep reaches only its cells,", async () => {
    const move: SudokuMotion = {
      id: 2,
      placed: 0,
      error: false,
      units: [{ unit: "row", index: 4 }],
    };
    const r = await render(ui({ grid: board(false), motion: move }));
    expect(ids(r, "sweep")).toEqual(
      Array.from({ length: 9 }, (_, c) => `sudoku-cell-4-${c}-sweep`)
    );
    expect(ids(r, "error")).toEqual([]);
  });

  it("the wave reaches every cell and its mark is there while it runs", async () => {
    const r = await render(ui({ grid: board(false), wave: true }));
    expect(ids(r, "wave")).toHaveLength(81);
    expect(r.getByTestId("sudoku-solved-wave")).toBeTruthy();
    await r.rerender(ui({ grid: board(false), wave: false }));
    expect(ids(r, "wave")).toHaveLength(0);
    expect(r.queryByTestId("sudoku-solved-wave")).toBeNull();
  });

  it("Reduce Motion mounts no effect, and turning it on mid-effect removes them", async () => {
    const move: SudokuMotion = {
      id: 3,
      placed: PLACED,
      error: true,
      units: [{ unit: "col", index: 3 }],
    };
    const r = await render(ui({ grid: board(true), motion: move, wave: true }));
    expect(ids(r, "error")).toHaveLength(1);
    expect(ids(r, "sweep")).toHaveLength(9);
    expect(ids(r, "wave")).toHaveLength(81);
    await r.rerender(ui({ grid: board(true), motion: move, wave: true, reduceMotion: true }));
    expect(ids(r, "error")).toEqual([]);
    expect(ids(r, "sweep")).toEqual([]);
    expect(ids(r, "wave")).toEqual([]);
    expect(r.queryByTestId("sudoku-solved-wave")).toBeNull();
    // The static clash ring is still there: it is style, not motion.
    expect(ids(r, "clash")).toEqual(["sudoku-cell-2-7-clash"]);
  });
});
