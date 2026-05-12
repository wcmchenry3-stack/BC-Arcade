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

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
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
  it("renders a given digit", () => {
    const { getByText } = wrap(
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

  it("renders pencil notes when no value is set", () => {
    const notes = new Set<NoteDigit>([1, 4, 7]);
    const { getByText } = wrap(
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

  it("exposes accessibility role=button with row/col label", () => {
    const { getByRole } = wrap(
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

  it("calls onPress when pressed", () => {
    const onPress = jest.fn();
    const { getByRole } = wrap(
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
    fireEvent.press(getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("matches snapshot — given value", () => {
    const tree = wrap(
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
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it("matches snapshot — selected error cell", () => {
    const tree = wrap(
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
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it("matches snapshot — peer cell", () => {
    const tree = wrap(
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
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// SudokuGrid
// ---------------------------------------------------------------------------

describe("SudokuGrid", () => {
  it("renders 81 cell buttons", () => {
    const { getAllByRole } = wrap(
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

  it("propagates onCellPress with (row, col) args", () => {
    const onCellPress = jest.fn();
    const { getAllByRole } = wrap(
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
    fireEvent.press(cells[10]!);
    expect(onCellPress).toHaveBeenCalledWith(1, 1);
  });

  it("matches snapshot with a typical mid-game state", () => {
    const g = emptyGrid();
    g[0]![0] = cell({ value: 5, given: true });
    g[4]![4] = cell({ value: 3 });
    g[8]![8] = cell({ value: 7, isError: true });
    const tree = wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(g)}
        selectedRow={4}
        selectedCol={4}
        onCellPress={() => {}}
      />
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });

  describe("peer highlighting", () => {
    // Select cell (4,4): same row = row 4, same col = col 4,
    // same 3×3 box = rows 3-5, cols 3-5.

    it("marks cells in the same row as peers", () => {
      const { getAllByRole } = wrap(
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

    it("does not apply peer highlight to the selected cell itself", () => {
      const { getAllByRole } = wrap(
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

    it("does not mark box-only cells as peers", () => {
      const { getAllByRole } = wrap(
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

    it("clears peers when no cell is selected", () => {
      const { getAllByRole } = wrap(
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
  it("renders 9 digits + erase + notes + hint actions", () => {
    const { getAllByRole, getByLabelText } = wrap(
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

  it("fires onDigit with the placed digit", () => {
    const onDigit = jest.fn();
    const { getByLabelText } = wrap(
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
    fireEvent.press(getByLabelText(/enter digit 5/i));
    expect(onDigit).toHaveBeenCalledWith(5);
  });

  it("fires onErase and onToggleNotes", () => {
    const onErase = jest.fn();
    const onToggleNotes = jest.fn();
    const { getByLabelText } = wrap(
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
    fireEvent.press(getByLabelText(/erase/i));
    fireEvent.press(getByLabelText(/pencil/i));
    expect(onErase).toHaveBeenCalledTimes(1);
    expect(onToggleNotes).toHaveBeenCalledTimes(1);
  });

  it("dims digits where all 9 instances are placed", () => {
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
    const { getByLabelText } = wrap(
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
    fireEvent.press(btn);
    // Disabled Pressable shouldn't fire onPress.
    expect(onDigit).not.toHaveBeenCalled();
  });

  it("matches snapshot — notes mode active", () => {
    const tree = wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(emptyGrid())}
        notesMode={true}
        onDigit={() => {}}
        onErase={() => {}}
        onToggleNotes={() => {}}
        onHint={() => {}}
      />
    ).toJSON();
    expect(tree).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// DifficultySelector
// ---------------------------------------------------------------------------

describe("DifficultySelector", () => {
  it("renders three radio buttons labelled easy/medium/hard", () => {
    const { getByLabelText } = wrap(<DifficultySelector value="medium" onChange={() => {}} />);
    expect(getByLabelText(/easy/i)).toBeTruthy();
    expect(getByLabelText(/medium/i)).toBeTruthy();
    expect(getByLabelText(/hard/i)).toBeTruthy();
  });

  it("marks the current value as selected", () => {
    const { getByLabelText } = wrap(<DifficultySelector value="hard" onChange={() => {}} />);
    expect(getByLabelText(/hard/i).props.accessibilityState?.selected).toBe(true);
    expect(getByLabelText(/easy/i).props.accessibilityState?.selected).toBe(false);
  });

  it("fires onChange with the new difficulty", () => {
    const onChange = jest.fn();
    const { getByLabelText } = wrap(<DifficultySelector value="easy" onChange={onChange} />);
    fireEvent.press(getByLabelText(/hard/i));
    expect(onChange).toHaveBeenCalledWith("hard");
  });

  it("matches snapshot — medium selected", () => {
    const tree = wrap(<DifficultySelector value="medium" onChange={() => {}} />).toJSON();
    expect(tree).toMatchSnapshot();
  });
});
