/**
 * The Sudoku board's look (#3773): the highlights (row, column and box, and the selected digit),
 * the two error styles, the cell labels, the digit keys' two rows and counts, and the New Game
 * picker's Cancel. Colours are the live theme's, never re-typed hex.
 */
import React from "react";
import { act, render, fireEvent } from "@testing-library/react-native";
import { dark as darkColors, ThemeProvider } from "../../../theme/ThemeContext";
import { SUDOKU_WASHES } from "../../../theme/theme.sudoku";
import { typography } from "../../../theme/typography";
import SudokuGrid from "../SudokuGrid";
import SudokuCell from "../SudokuCell";
import NumberPad from "../NumberPad";
import NewGameModal from "../NewGameModal";
import { composite } from "../cellStyle";
import type {
  CellValue,
  Grid,
  NoteDigit,
  SudokuCell as CellData,
} from "../../../game/sudoku/types";

const wrap = async (ui: React.ReactElement) => await render(<ThemeProvider>{ui}</ThemeProvider>);

function cell(o: Partial<CellData> = {}): CellData {
  return { value: 0, given: false, notes: new Set<NoteDigit>(), isError: false, ...o };
}
function emptyGrid(size = 9): CellData[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => cell()));
}
const asGrid = (g: CellData[][]): Grid => g;

const PEER = composite(darkColors.surface, SUDOKU_WASHES.dark.peer);
const SAME = composite(darkColors.surface, SUDOKU_WASHES.dark.same);
const CONFLICT = composite(darkColors.surface, SUDOKU_WASHES.dark.conflict);

const bg = (el: { props: { style?: unknown } }) =>
  (el.props.style as Array<{ backgroundColor?: string }>).find((s) => s.backgroundColor)
    ?.backgroundColor;

describe("SudokuGrid highlights (#3773)", () => {
  it("washes the selected cell's row, column AND box, and nothing else", async () => {
    const r = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(emptyGrid())}
        selectedRow={4}
        selectedCol={4}
        onCellPress={() => {}}
      />
    );
    const at = (row: number, col: number) => r.getByTestId(`sudoku-cell-${row}-${col}`);
    expect(bg(at(4, 4))).toBe(darkColors.accent); // selected: solid
    expect(bg(at(4, 0))).toBe(PEER); // row
    expect(bg(at(0, 4))).toBe(PEER); // column
    expect(bg(at(3, 3))).toBe(PEER); // box only
    expect(bg(at(5, 5))).toBe(PEER); // box only
    expect(bg(at(2, 2))).toBe(darkColors.surface); // other box, other row and column
    // 8 in the row + 8 in the column + 4 box-only cells (the box has 8 others, 4 of them on the axes)
    const washed = r.getAllByRole("button").filter((b) => bg(b) === PEER);
    expect(washed).toHaveLength(20);
  });

  it("washes the box on a mini 6×6 board (2 rows by 3 columns)", async () => {
    const r = await wrap(
      <SudokuGrid
        variant="mini"
        grid={asGrid(emptyGrid(6))}
        selectedRow={0}
        selectedCol={0}
        onCellPress={() => {}}
      />
    );
    const at = (row: number, col: number) => r.getByTestId(`sudoku-cell-${row}-${col}`);
    expect(bg(at(1, 1))).toBe(PEER); // box-only
    expect(bg(at(1, 2))).toBe(PEER); // box-only
    expect(bg(at(2, 1))).toBe(darkColors.surface); // the box below
    expect(bg(at(1, 3))).toBe(darkColors.surface); // the box beside
  });

  it("tints every other cell with the selected digit, wherever it is", async () => {
    const g = emptyGrid();
    g[4]![4] = cell({ value: 5, given: true });
    g[0]![8] = cell({ value: 5, given: true }); // far from the selection
    g[8]![0] = cell({ value: 5 });
    g[2]![2] = cell({ value: 6, given: true });
    const r = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(g)}
        selectedRow={4}
        selectedCol={4}
        onCellPress={() => {}}
      />
    );
    const at = (row: number, col: number) => r.getByTestId(`sudoku-cell-${row}-${col}`);
    expect(bg(at(0, 8))).toBe(SAME);
    expect(bg(at(8, 0))).toBe(SAME);
    expect(bg(at(2, 2))).toBe(darkColors.surface);
    expect(bg(at(4, 4))).toBe(darkColors.accent);
  });

  it("highlights nothing for an empty selected cell's digit, and nothing with no selection", async () => {
    const g = emptyGrid();
    g[0]![0] = cell({ value: 3, given: true });
    const r = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(g)}
        selectedRow={null}
        selectedCol={null}
        onCellPress={() => {}}
      />
    );
    r.getAllByRole("button").forEach((b) => expect(bg(b)).toBe(darkColors.surface));
  });

  it("is a labelled grid, and sizes itself when given a board size", async () => {
    const r = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(emptyGrid())}
        selectedRow={null}
        selectedCol={null}
        boardSize={289}
        onCellPress={() => {}}
      />
    );
    const board = r.getByTestId("sudoku-board");
    expect(board.props.accessibilityLabel).toBe("Sudoku board");
    expect(board.props.role).toBe("grid");
    expect(board).toHaveStyle({ width: 289, height: 289 });
  });

  it("scales digits with the board: bigger on a 6×6 than a 9×9 of the same size", async () => {
    const g9 = emptyGrid();
    g9[0]![0] = cell({ value: 4, given: true });
    const g6 = emptyGrid(6);
    g6[0]![0] = cell({ value: 4, given: true });
    const nine = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(g9)}
        selectedRow={null}
        selectedCol={null}
        boardSize={300}
        onCellPress={() => {}}
      />
    );
    const size9 = (nine.getByText("4").props.style as Array<{ fontSize?: number }>).find(
      (s) => s.fontSize
    )!.fontSize!;
    await nine.unmount();
    const six = await wrap(
      <SudokuGrid
        variant="mini"
        grid={asGrid(g6)}
        selectedRow={null}
        selectedCol={null}
        boardSize={300}
        onCellPress={() => {}}
      />
    );
    const size6 = (six.getByText("4").props.style as Array<{ fontSize?: number }>).find(
      (s) => s.fontSize
    )!.fontSize!;
    expect(size6).toBeGreaterThan(size9);
  });
});

describe("SudokuCell digits, notes and error styles (#3773)", () => {
  const base = {
    row: 0,
    col: 0,
    size: 9,
    selected: false,
    highlighted: false,
    peer: false,
    onPress: () => {},
  };

  it("an entered digit is accentText, a given is the text colour, both Space Grotesk Bold", async () => {
    const entered = await wrap(<SudokuCell {...base} cell={cell({ value: 4 })} />);
    expect(entered.getByText("4")).toHaveStyle({
      color: darkColors.accentText,
      fontFamily: typography.heading,
    });
    await entered.unmount();
    const given = await wrap(<SudokuCell {...base} cell={cell({ value: 4, given: true })} />);
    expect(given.getByText("4")).toHaveStyle({ color: darkColors.text });
  });

  it("notes are a 3×3 grid sized from the cell, with every digit's slot kept", async () => {
    const notes = new Set<NoteDigit>([1, 5, 9]);
    const r = await wrap(<SudokuCell {...base} cellPx={31} cell={cell({ notes })} />);
    // all nine slots render, absent notes transparent, so a note never moves
    for (let d = 1; d <= 9; d++) expect(r.getByText(String(d))).toBeTruthy();
    expect(r.getByText("5")).toHaveStyle({
      color: darkColors.textMuted,
      fontFamily: typography.label,
    });
    expect(r.getByText("2")).toHaveStyle({ color: "transparent" });
    const fontSize = (r.getByText("5").props.style as Array<{ fontSize?: number }>).find(
      (s) => s.fontSize
    )!.fontSize!;
    expect(fontSize).toBeCloseTo(8.1, 0);
    await r.unmount();
    const big = await wrap(<SudokuCell {...base} cellPx={58} cell={cell({ notes })} />);
    const bigSize = (big.getByText("5").props.style as Array<{ fontSize?: number }>).find(
      (s) => s.fontSize
    )!.fontSize!;
    expect(bigSize).toBeGreaterThan(fontSize);
  });

  it("a mini cell lays six notes in two rows of three", async () => {
    const r = await wrap(
      <SudokuCell {...base} size={6} cell={cell({ notes: new Set<NoteDigit>([6]) })} />
    );
    expect(r.queryByText("7")).toBeNull();
    expect(r.getByText("6")).toBeTruthy();
  });

  it("a conflict is a red digit on a red wash, with no underline", async () => {
    const r = await wrap(<SudokuCell {...base} cell={cell({ value: 7, isError: true })} />);
    expect(r.getByText("7")).toHaveStyle({ color: darkColors.errorText });
    expect(bg(r.getByTestId("sudoku-cell-0-0"))).toBe(CONFLICT);
    expect(r.queryByTestId("sudoku-cell-0-0-mistake")).toBeNull();
    expect(r.queryByTestId("sudoku-cell-0-0-clash")).toBeNull();
  });

  it("a mistake is a red digit with an underline, and no wash", async () => {
    const r = await wrap(<SudokuCell {...base} cell={cell({ value: 2 })} mistake />);
    expect(r.getByText("2")).toHaveStyle({ color: darkColors.errorText });
    expect(r.getByTestId("sudoku-cell-0-0-mistake")).toHaveStyle({
      backgroundColor: darkColors.error,
    });
    expect(bg(r.getByTestId("sudoku-cell-0-0"))).toBe(darkColors.surface);
  });

  it("a conflict that is also not the solution shows the conflict, not the underline", async () => {
    const r = await wrap(<SudokuCell {...base} cell={cell({ value: 7, isError: true })} mistake />);
    expect(r.queryByTestId("sudoku-cell-0-0-mistake")).toBeNull();
    expect(bg(r.getByTestId("sudoku-cell-0-0"))).toBe(CONFLICT);
  });

  it("a clashing cell gets a red ring and keeps its own digit colour", async () => {
    const r = await wrap(<SudokuCell {...base} clash cell={cell({ value: 7, given: true })} />);
    expect(r.getByTestId("sudoku-cell-0-0-clash")).toHaveStyle({
      borderColor: darkColors.error,
      borderWidth: 2,
    });
    expect(r.getByText("7")).toHaveStyle({ color: darkColors.text });
  });

  it("a mistake underline in the selected cell uses the on-accent red", async () => {
    const r = await wrap(<SudokuCell {...base} selected cell={cell({ value: 2 })} mistake />);
    expect(r.getByTestId("sudoku-cell-0-0-mistake")).toHaveStyle({
      backgroundColor: darkColors.errorOnAccent,
    });
  });
});

describe("SudokuGrid conflicts and clashes (#3773)", () => {
  it("rings each cell that holds the conflicting digit in the same row, column or box", async () => {
    const g = emptyGrid();
    g[0]![0] = cell({ value: 7, isError: true }); // the illegal digit
    g[0]![8] = cell({ value: 7, given: true }); // same row: clashes
    g[8]![0] = cell({ value: 7, given: true }); // same column: clashes
    g[1]![1] = cell({ value: 7, given: true }); // same box: clashes
    g[5]![5] = cell({ value: 7, given: true }); // a 7 elsewhere: no clash
    g[0]![1] = cell({ value: 3, given: true }); // a peer with another digit: no clash
    const r = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(g)}
        selectedRow={null}
        selectedCol={null}
        onCellPress={() => {}}
      />
    );
    expect(r.getByTestId("sudoku-cell-0-8-clash")).toBeTruthy();
    expect(r.getByTestId("sudoku-cell-8-0-clash")).toBeTruthy();
    expect(r.getByTestId("sudoku-cell-1-1-clash")).toBeTruthy();
    expect(r.queryByTestId("sudoku-cell-5-5-clash")).toBeNull();
    expect(r.queryByTestId("sudoku-cell-0-1-clash")).toBeNull();
    expect(r.queryByTestId("sudoku-cell-0-0-clash")).toBeNull();
  });

  it("marks mistakes only with Show mistakes on, and says so apart from a conflict", async () => {
    const g = emptyGrid();
    g[0]![0] = cell({ value: 2 }); // legal, wrong
    const solution = "1".repeat(81);
    const off = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(g)}
        selectedRow={null}
        selectedCol={null}
        solution={solution}
        onCellPress={() => {}}
      />
    );
    expect(off.queryByTestId("sudoku-cell-0-0-mistake")).toBeNull();
    await off.unmount();
    const on = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(g)}
        selectedRow={null}
        selectedCol={null}
        solution={solution}
        showMistakes
        onCellPress={() => {}}
      />
    );
    expect(on.getByTestId("sudoku-cell-0-0-mistake")).toBeTruthy();
    expect(on.getByTestId("sudoku-cell-0-0").props.accessibilityLabel).toMatch(
      /mistake, wrong digit/
    );
    expect(on.getByTestId("sudoku-cell-0-0").props.accessibilityLabel).not.toMatch(/conflict/);
  });
});

describe("cell accessibility labels (#3773)", () => {
  const props = {
    row: 4,
    col: 6,
    size: 9,
    selected: false,
    highlighted: false,
    peer: false,
    onPress: () => {},
  };
  const label = async (ui: React.ReactElement) =>
    (await wrap(ui)).getByRole("button").props.accessibilityLabel as string;

  it("keeps the row, column and value first, then says given or entered, and the box", async () => {
    expect(
      await label(<SudokuCell {...props} box={6} cell={cell({ value: 3, given: true })} />)
    ).toBe("Cell row 5, column 7, 3, given, box 6");
    expect(await label(<SudokuCell {...props} box={6} cell={cell({ value: 3 })} />)).toBe(
      "Cell row 5, column 7, 3, entered, box 6"
    );
  });

  it("an empty cell lists its notes", async () => {
    expect(await label(<SudokuCell {...props} box={6} cell={cell()} />)).toBe(
      "Cell row 5, column 7, empty, box 6"
    );
    expect(
      await label(
        <SudokuCell {...props} box={6} cell={cell({ notes: new Set<NoteDigit>([2, 8, 4]) })} />
      )
    ).toBe("Cell row 5, column 7, empty, box 6, notes 2 4 8");
  });

  it("a conflict and a mistake are told apart, and a clash says what it clashes with", async () => {
    expect(await label(<SudokuCell {...props} cell={cell({ value: 3, isError: true })} />)).toMatch(
      /, conflict, repeats a digit in its row, column or box$/
    );
    expect(await label(<SudokuCell {...props} mistake cell={cell({ value: 3 })} />)).toMatch(
      /, mistake, wrong digit$/
    );
    expect(
      await label(<SudokuCell {...props} clash cell={cell({ value: 3, given: true })} />)
    ).toMatch(/, clashes with a conflict$/);
  });
});

describe("NumberPad layout and counts (#3773)", () => {
  function gridWith(digit: number, count: number): CellData[][] {
    const g = emptyGrid();
    let n = 0;
    for (let r = 0; r < 9 && n < count; r++) {
      g[r]![(r * 2) % 9] = cell({ value: digit as CellValue, given: true });
      n++;
    }
    return g;
  }

  it("lays a 9×9's keys in two rows: 1-5 over 6-9", async () => {
    const r = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(emptyGrid())}
        notesMode={false}
        onDigit={() => {}}
      />
    );
    const row1 = r.getByTestId("sudoku-keys-row-1");
    const row2 = r.getByTestId("sudoku-keys-row-2");
    expect(row1.children).toHaveLength(5);
    expect(row2.children).toHaveLength(4);
    // the shorter row is centred: padded by half the missing key each side
    expect(row2).toHaveStyle({ paddingHorizontal: "10%" });
    expect(row1).toHaveStyle({ paddingHorizontal: 0 });
  });

  it("lays a 6×6's keys 3 + 3, centred", async () => {
    const r = await wrap(
      <NumberPad variant="mini" grid={asGrid(emptyGrid(6))} notesMode={false} onDigit={() => {}} />
    );
    expect(r.getByTestId("sudoku-keys-row-1").children).toHaveLength(3);
    expect(r.getByTestId("sudoku-keys-row-2").children).toHaveLength(3);
    expect(r.getByTestId("sudoku-keys-row-2")).toHaveStyle({ paddingHorizontal: "20%" });
    expect(r.queryByTestId("sudoku-digit-7")).toBeNull();
  });

  it("shows how many of each digit remain, and announces it", async () => {
    const r = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(gridWith(3, 4))}
        notesMode={false}
        onDigit={() => {}}
      />
    );
    const key3 = r.getByTestId("sudoku-digit-3");
    expect(key3.props.accessibilityLabel).toBe("Enter digit 3. Remaining: 5");
    expect(r.getByTestId("sudoku-digit-1").props.accessibilityLabel).toBe(
      "Enter digit 1. Remaining: 9"
    );
    expect(r.getAllByText("5").length).toBeGreaterThan(0);
  });

  it("a used-up digit is dimmed, disabled and announces none remaining", async () => {
    const onDigit = jest.fn();
    const r = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(gridWith(9, 9))}
        notesMode={false}
        onDigit={onDigit}
      />
    );
    const key9 = r.getByTestId("sudoku-digit-9");
    expect(key9).toHaveStyle({ opacity: 0.32 });
    expect(key9.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(key9.props.accessibilityLabel).toBe("Enter digit 9. Remaining: 0");
    await fireEvent.press(key9);
    expect(onDigit).not.toHaveBeenCalled();
  });

  it("keys are at least 44 pt tall, even when asked for less", async () => {
    const r = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(emptyGrid())}
        notesMode={false}
        onDigit={() => {}}
        keyHeight={44}
      />
    );
    for (let d = 1; d <= 9; d++) {
      const style = r.getByTestId(`sudoku-digit-${d}`).props.style as Array<{
        height?: number;
        minHeight?: number;
        minWidth?: number;
      }>;
      expect(Object.assign({}, ...style).height).toBe(44);
      expect(Object.assign({}, ...style).minHeight).toBe(44);
      expect(Object.assign({}, ...style).minWidth).toBe(44);
    }
  });

  it("shows the full-but-wrong message in place of the keys, and keeps their height", async () => {
    const r = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(emptyGrid())}
        notesMode={false}
        onDigit={() => {}}
        message="Something is off"
        keyHeight={50}
        gap={4}
      />
    );
    expect(r.getByText("Something is off")).toBeTruthy();
    expect(r.queryByTestId("sudoku-digit-1")).toBeNull();
    expect(r.getByTestId("sudoku-full-wrong").parent!).toHaveStyle({ minHeight: 104 });
  });
});

describe("NewGameModal (#3773)", () => {
  const props = {
    currentDifficulty: "easy" as const,
    currentVariant: "classic" as const,
    onQuickRestart: jest.fn(),
    onStart: jest.fn(),
  };
  beforeEach(() => jest.clearAllMocks());

  it("has a Cancel that closes it without starting", async () => {
    const onCancel = jest.fn();
    const r = await wrap(<NewGameModal {...props} onCancel={onCancel} />);
    await fireEvent.press(r.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(props.onStart).not.toHaveBeenCalled();
    expect(props.onQuickRestart).not.toHaveBeenCalled();
  });

  it("closes on Android Back / Escape (onRequestClose)", async () => {
    const onCancel = jest.fn();
    const r = await wrap(<NewGameModal {...props} onCancel={onCancel} />);
    // Android's hardware Back / web's Escape call the Modal's onRequestClose: walk up to it.
    let node = r.getByText("New Game").parent;
    while (node && typeof node.props.onRequestClose !== "function") node = node.parent;
    expect(node).toBeTruthy();
    await act(async () => node?.props.onRequestClose());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
