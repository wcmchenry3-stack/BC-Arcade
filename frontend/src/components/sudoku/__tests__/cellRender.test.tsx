/**
 * A tap re-renders only the cells whose props changed (#3773): SudokuCell is memoised and gets a
 * stable onPress(row, col), so the other cells skip their render and their label. A render is
 * counted by `cellBackground`, which every SudokuCell render calls once.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import SudokuGrid from "../SudokuGrid";
import { cellBackground } from "../cellStyle";
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
const grid: Grid = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => cell()));

function ui(selectedRow: number, selectedCol: number, onCellPress = () => {}) {
  return (
    <ThemeProvider>
      <SudokuGrid
        variant="classic"
        grid={grid}
        selectedRow={selectedRow}
        selectedCol={selectedCol}
        onCellPress={onCellPress}
      />
    </ThemeProvider>
  );
}

describe("SudokuCell memoisation (#3773)", () => {
  beforeEach(() => renders.mockClear());

  it("renders all 81 cells once, then only the ones a selection move changes", async () => {
    const onCellPress = jest.fn();
    const r = await render(ui(4, 4, onCellPress));
    expect(renders).toHaveBeenCalledTimes(81);
    renders.mockClear();

    // (4,4) -> (4,5): the two cells, and column 4 and column 5 (they gain or lose the wash). The
    // row and the box (cols 3-5) are washed both before and after.
    await r.rerender(ui(4, 5, onCellPress));
    expect(renders.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(renders.mock.calls.length).toBeLessThanOrEqual(18);
  });

  it("renders nothing again when the same props come back", async () => {
    const onCellPress = jest.fn();
    const r = await render(ui(4, 4, onCellPress));
    renders.mockClear();
    await r.rerender(ui(4, 4, onCellPress));
    expect(renders).not.toHaveBeenCalled();
  });

  it("a tap reports the cell's own row and column through the one shared handler", async () => {
    const onCellPress = jest.fn();
    const r = await render(ui(4, 4, onCellPress));
    await fireEvent.press(r.getByTestId("sudoku-cell-2-7"));
    expect(onCellPress).toHaveBeenCalledWith(2, 7);
  });
});
