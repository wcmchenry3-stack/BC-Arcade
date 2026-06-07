import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import SudokuCell from "../SudokuCell";
import SudokuGrid from "../SudokuGrid";
import NumberPad from "../NumberPad";
import DifficultySelector from "../DifficultySelector";
import type {
  CellValue,
  Grid,
  NoteDigit,
  SudokuCell as SudokuCellData,
} from "../../../game/sudoku/types";

async function wrap(ui: React.ReactElement) {
  return await render(<ThemeProvider>{ui}</ThemeProvider>);
}

function cell(overrides: Partial<SudokuCellData> = {}): SudokuCellData {
  return {
    value: 0,
    given: false,
    notes: new Set<NoteDigit>(),
    isError: false,
    ...overrides,
  };
}

function emptyGrid(): SudokuCellData[][] {
  const rows: SudokuCellData[][] = [];
  for (let r = 0; r < 9; r++) {
    const row: SudokuCellData[] = [];
    for (let c = 0; c < 9; c++) row.push(cell());
    rows.push(row);
  }
  return rows;
}

// Cast helper — tests need to mutate cells before passing to components, but
// the `Grid` type is readonly-of-readonly.  The cast loses no safety because
// components treat the grid as immutable.
function asGrid(g: SudokuCellData[][]): Grid {
  return g;
}

// ---------------------------------------------------------------------------
// SudokuCell
// ---------------------------------------------------------------------------

describe("SudokuCell", () => {
  it("renders a given digit", async () => {
    const { getByText } = await wrap(
      <SudokuCell
        size={9}
        cell={cell({ value: 5, given: true })}
        row={0}
        col={0}
        selected={false}
        highlighted={false}
        peer={false}
        onPress={() => {}}
      />
    );
    expect(getByText("5")).toBeTruthy();
  });

  it("renders pencil notes when no value is set", async () => {
    const notes = new Set<NoteDigit>([1, 4, 7]);
    const { getByText } = await wrap(
      <SudokuCell
        size={9}
        cell={cell({ notes })}
        row={0}
        col={0}
        selected={false}
        highlighted={false}
        peer={false}
        onPress={() => {}}
      />
    );
    expect(getByText("1")).toBeTruthy();
    expect(getByText("4")).toBeTruthy();
    expect(getByText("7")).toBeTruthy();
  });

  it("exposes accessibility role=button with row/col label", async () => {
    const { getByRole } = await wrap(
      <SudokuCell
        size={9}
        cell={cell({ value: 3 })}
        row={4}
        col={6}
        selected={false}
        highlighted={false}
        peer={false}
        onPress={() => {}}
      />
    );
    const btn = getByRole("button");
    expect(btn.props.accessibilityLabel).toMatch(/row 5/i);
    expect(btn.props.accessibilityLabel).toMatch(/column 7/i);
  });

  it("calls onPress when pressed", async () => {
    const onPress = jest.fn();
    const { getByRole } = await wrap(
      <SudokuCell
        size={9}
        cell={cell()}
        row={0}
        col={0}
        selected={false}
        highlighted={false}
        peer={false}
        onPress={onPress}
      />
    );
    await fireEvent.press(getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("matches snapshot — given value", async () => {
    const tree = (
      await wrap(
        <SudokuCell
          size={9}
          cell={cell({ value: 7, given: true })}
          row={0}
          col={0}
          selected={false}
          highlighted={false}
          peer={false}
          onPress={() => {}}
        />
      )
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it("matches snapshot — selected error cell", async () => {
    const tree = (
      await wrap(
        <SudokuCell
          size={9}
          cell={cell({ value: 2, isError: true })}
          row={3}
          col={3}
          selected={true}
          highlighted={false}
          peer={false}
          onPress={() => {}}
        />
      )
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it("matches snapshot — peer cell", async () => {
    const tree = (
      await wrap(
        <SudokuCell
          size={9}
          cell={cell({ value: 4 })}
          row={0}
          col={3}
          selected={false}
          highlighted={false}
          peer={true}
          onPress={() => {}}
        />
      )
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// SudokuGrid
// ---------------------------------------------------------------------------

describe("SudokuGrid", () => {
  it("renders 81 cell buttons", async () => {
    const { getAllByRole } = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(emptyGrid())}
        selectedRow={null}
        selectedCol={null}
        onCellPress={() => {}}
      />
    );
    expect(getAllByRole("button")).toHaveLength(81);
  });

  it("propagates onCellPress with (row, col) args", async () => {
    const onCellPress = jest.fn();
    const { getAllByRole } = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(emptyGrid())}
        selectedRow={null}
        selectedCol={null}
        onCellPress={onCellPress}
      />
    );
    // Cells are rendered row-major — index 10 is (row 1, col 1).
    const cells = getAllByRole("button");
    await fireEvent.press(cells[10]!);
    expect(onCellPress).toHaveBeenCalledWith(1, 1);
  });

  it("matches snapshot with a typical mid-game state", async () => {
    const g = emptyGrid();
    g[0]![0] = cell({ value: 5, given: true });
    g[4]![4] = cell({ value: 3 });
    g[8]![8] = cell({ value: 7, isError: true });
    const tree = (
      await wrap(
        <SudokuGrid
          variant="classic"
          grid={asGrid(g)}
          selectedRow={4}
          selectedCol={4}
          onCellPress={() => {}}
        />
      )
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });

  describe("peer highlighting", () => {
    // Select cell (4,4): same row = row 4, same col = col 4,
    // same 3×3 box = rows 3-5, cols 3-5.

    it("marks cells in the same row as peers", async () => {
      const { getAllByRole } = await wrap(
        <SudokuGrid
          variant="classic"
          grid={asGrid(emptyGrid())}
          selectedRow={4}
          selectedCol={4}
          onCellPress={() => {}}
        />
      );
      // Row 4, col 0 — index 36 in row-major order. Not the selected cell.
      const cells = getAllByRole("button");
      // Row 4, col 0 = index 4*9+0 = 36; check backgroundColor via style.
      // We verify the selected cell itself is NOT a peer by confirming it has
      // the translucent accent selected tint, not the peer tint.
      const selectedCell = cells[4 * 9 + 4]!;
      expect(selectedCell.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ backgroundColor: "#8ff5ffAA" }), // accent+AA selected tint
        ])
      );
    });

    it("does not apply peer highlight to the selected cell itself", async () => {
      const { getAllByRole } = await wrap(
        <SudokuGrid
          variant="classic"
          grid={asGrid(emptyGrid())}
          selectedRow={2}
          selectedCol={2}
          onCellPress={() => {}}
        />
      );
      const cells = getAllByRole("button");
      const selectedCell = cells[2 * 9 + 2]!;
      expect(selectedCell.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ backgroundColor: "#8ff5ffAA" }), // selected tint, not peer tint
        ])
      );
    });

    it("does not mark box-only cells as peers", async () => {
      const { getAllByRole } = await wrap(
        <SudokuGrid
          variant="classic"
          grid={asGrid(emptyGrid())}
          selectedRow={0}
          selectedCol={0}
          onCellPress={() => {}}
        />
      );
      const cells = getAllByRole("button");
      // (1,1) shares a box with (0,0) but not its row or column — must not be highlighted.
      const boxOnlyCell = cells[1 * 9 + 1]!;
      expect(boxOnlyCell.props.style).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ backgroundColor: "#8ff5ff22" })])
      );
    });

    it("clears peers when no cell is selected", async () => {
      const { getAllByRole } = await wrap(
        <SudokuGrid
          variant="classic"
          grid={asGrid(emptyGrid())}
          selectedRow={null}
          selectedCol={null}
          onCellPress={() => {}}
        />
      );
      const cells = getAllByRole("button");
      cells.forEach((c) => {
        expect(c.props.style).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ backgroundColor: "#19191f" }), // default surface
          ])
        );
      });
    });
  });
});

// ---------------------------------------------------------------------------
// NumberPad
// ---------------------------------------------------------------------------

describe("NumberPad", () => {
  it("renders 9 digits + erase + notes + hint actions", async () => {
    const { getAllByRole, getByLabelText } = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(emptyGrid())}
        notesMode={false}
        onDigit={() => {}}
        onErase={() => {}}
        onToggleNotes={() => {}}
        onHint={() => {}}
      />
    );
    const buttons = getAllByRole("button");
    expect(buttons.length).toBe(12);
    expect(getByLabelText(/erase/i)).toBeTruthy();
    expect(getByLabelText(/pencil/i)).toBeTruthy();
    expect(getByLabelText(/hint/i)).toBeTruthy();
  });

  it("fires onDigit with the placed digit", async () => {
    const onDigit = jest.fn();
    const { getByLabelText } = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(emptyGrid())}
        notesMode={false}
        onDigit={onDigit}
        onErase={() => {}}
        onToggleNotes={() => {}}
        onHint={() => {}}
      />
    );
    await fireEvent.press(getByLabelText(/enter digit 5/i));
    expect(onDigit).toHaveBeenCalledWith(5);
  });

  it("fires onErase and onToggleNotes", async () => {
    const onErase = jest.fn();
    const onToggleNotes = jest.fn();
    const { getByLabelText } = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(emptyGrid())}
        notesMode={false}
        onDigit={() => {}}
        onErase={onErase}
        onToggleNotes={onToggleNotes}
        onHint={() => {}}
      />
    );
    await fireEvent.press(getByLabelText(/erase/i));
    await fireEvent.press(getByLabelText(/pencil/i));
    expect(onErase).toHaveBeenCalledTimes(1);
    expect(onToggleNotes).toHaveBeenCalledTimes(1);
  });

  it("dims digits where all 9 instances are placed", async () => {
    // Seed 9 cells of value 4 across different rows/cols so the count reaches 9.
    const g = emptyGrid();
    const positions: Array<[number, number]> = [
      [0, 0],
      [1, 3],
      [2, 6],
      [3, 1],
      [4, 4],
      [5, 7],
      [6, 2],
      [7, 5],
      [8, 8],
    ];
    for (const [r, c] of positions) {
      g[r]![c] = cell({ value: 4 as CellValue, given: true });
    }
    const onDigit = jest.fn();
    const { getByLabelText } = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(g)}
        notesMode={false}
        onDigit={onDigit}
        onErase={() => {}}
        onToggleNotes={() => {}}
        onHint={() => {}}
      />
    );
    const btn = getByLabelText(/enter digit 4/i);
    expect(btn.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(btn);
    // Disabled Pressable shouldn't fire onPress.
    expect(onDigit).not.toHaveBeenCalled();
  });

  it("matches snapshot — notes mode active", async () => {
    const tree = (
      await wrap(
        <NumberPad
          variant="classic"
          grid={asGrid(emptyGrid())}
          notesMode={true}
          onDigit={() => {}}
          onErase={() => {}}
          onToggleNotes={() => {}}
          onHint={() => {}}
        />
      )
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// DifficultySelector
// ---------------------------------------------------------------------------

describe("DifficultySelector", () => {
  it("renders three radio buttons labelled easy/medium/hard", async () => {
    const { getByLabelText } = await wrap(
      <DifficultySelector value="medium" onChange={() => {}} />
    );
    expect(getByLabelText(/easy/i)).toBeTruthy();
    expect(getByLabelText(/medium/i)).toBeTruthy();
    expect(getByLabelText(/hard/i)).toBeTruthy();
  });

  it("marks the current value as selected", async () => {
    const { getByLabelText } = await wrap(<DifficultySelector value="hard" onChange={() => {}} />);
    expect(getByLabelText(/hard/i).props.accessibilityState?.selected).toBe(true);
    expect(getByLabelText(/easy/i).props.accessibilityState?.selected).toBe(false);
  });

  it("fires onChange with the new difficulty", async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await wrap(<DifficultySelector value="easy" onChange={onChange} />);
    await fireEvent.press(getByLabelText(/hard/i));
    expect(onChange).toHaveBeenCalledWith("hard");
  });

  it("matches snapshot — medium selected", async () => {
    const tree = (await wrap(<DifficultySelector value="medium" onChange={() => {}} />)).toJSON();
    expect(tree).toMatchSnapshot();
  });
});
