import React from "react";
import { PixelRatio } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import { dark as darkColors, ThemeProvider } from "../../../theme/ThemeContext";
import { typography } from "../../../theme/typography";
import { SUDOKU_WASHES } from "../../../theme/theme.sudoku";
import { composite } from "../cellStyle";
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

// WCAG 2.2 contrast ratio (relative luminance per 1.4.3), computed against
// each cell background's *composited* color (the wash alpha-blended over the
// surface) rather than the flat surface token — that composite is what was
// missed when the note/value colors were originally tuned, causing #2298.
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [chan(r), chan(g), chan(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA: string, hexB: string): number {
  const [la, lb] = [relativeLuminance(hexA), relativeLuminance(hexB)];
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
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

  it("given value: bold text-colored digit on the plain surface", async () => {
    const { getByRole, getByText } = await wrap(
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
    );
    const btn = getByRole("button", { name: /^Cell row 1, column 1, 7, given/ });
    expect(btn.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    expect(btn).toHaveStyle({ backgroundColor: darkColors.surface });
    // The digit is the registered Space Grotesk Bold, sized from the cell (#3773).
    expect(getByText("7")).toHaveStyle({
      color: darkColors.text,
      fontFamily: typography.heading,
      fontSize: 19,
      fontVariant: ["tabular-nums"],
    });
  });

  it("selected error cell: errorOnAccent digit on the selected tint", async () => {
    const { getByRole, getByText } = await wrap(
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
    );
    const btn = getByRole("button", { name: /^Cell row 4, column 4, 2, entered/ });
    expect(btn.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(btn).toHaveStyle({ backgroundColor: darkColors.accent });
    expect(getByText("2")).toHaveStyle({ color: darkColors.errorOnAccent });
  });

  it("peer cell: accentText user digit on the peer wash (#3773)", async () => {
    const { getByRole, getByText } = await wrap(
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
    );
    const btn = getByRole("button", { name: /^Cell row 1, column 4, 4, entered/ });
    expect(btn).toHaveStyle({
      backgroundColor: composite(darkColors.surface, SUDOKU_WASHES.dark.peer),
    });
    expect(getByText("4")).toHaveStyle({ color: darkColors.accentText });
  });

  // Regression test for the notes-invisible-when-selected bug: the selected
  // cell's background is the accent color blended over the surface, which in
  // dark theme composites close in luminance to `textMuted` — notes rendered
  // in that color become nearly invisible (~1:1 contrast, see issue #2298).
  describe("note color contrast", () => {
    const notes = new Set<NoteDigit>([2, 8]);

    it("uses textOnAccent for notes in the selected cell", async () => {
      const { getByText } = await wrap(
        <SudokuCell
          size={9}
          cell={cell({ notes })}
          row={0}
          col={0}
          selected={true}
          highlighted={false}
          peer={false}
          onPress={() => {}}
        />
      );
      expect(getByText("2").props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: darkColors.textOnAccent })])
      );
    });

    it("uses textMuted for notes in an unselected/peer cell", async () => {
      const { getByText } = await wrap(
        <SudokuCell
          size={9}
          cell={cell({ notes })}
          row={0}
          col={3}
          selected={false}
          highlighted={false}
          peer={true}
          onPress={() => {}}
        />
      );
      expect(getByText("2").props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: darkColors.textMuted })])
      );
    });

    // Derived from the live theme (not re-typed hex literals) so a future
    // palette retune that reintroduces a low-contrast pairing fails these
    // tests instead of silently checking stale, no-longer-shipped values.
    const DARK_ACCENT = darkColors.accent;
    const DARK_SURFACE = darkColors.surface;
    const DARK_TEXT_MUTED = darkColors.textMuted;
    const DARK_TEXT_ON_ACCENT = darkColors.textOnAccent;

    it("meets WCAG AA (4.5:1) for note text on the selected-cell background", () => {
      expect(contrastRatio(DARK_TEXT_ON_ACCENT, DARK_ACCENT)).toBeGreaterThanOrEqual(4.5);
    });

    it("meets WCAG AA (4.5:1) for note text on the peer-cell background", () => {
      const bg = composite(DARK_SURFACE, SUDOKU_WASHES.dark.peer);
      expect(contrastRatio(DARK_TEXT_MUTED, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it("meets WCAG AA (4.5:1) for note text on the plain (unselected, non-peer) background", () => {
      expect(contrastRatio(DARK_TEXT_MUTED, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
    });
  });

  // Regression test for the same contrast bug in cell *values* (as opposed to
  // notes, covered above): `valueColor` wasn't updated alongside `noteColor`,
  // so given digits (~2.1:1), user-entered digits (~2.0:1), and error digits
  // (~1.0:1) were all still nearly invisible against the selected-cell
  // background. See issue #2298.
  describe("value color contrast", () => {
    it("uses textOnAccent for a given digit in the selected cell", async () => {
      const { getByText } = await wrap(
        <SudokuCell
          size={9}
          cell={cell({ value: 5, given: true })}
          row={0}
          col={0}
          selected={true}
          highlighted={false}
          peer={false}
          onPress={() => {}}
        />
      );
      expect(getByText("5").props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: darkColors.textOnAccent })])
      );
    });

    it("uses textOnAccent for a user-entered digit in the selected cell", async () => {
      const { getByText } = await wrap(
        <SudokuCell
          size={9}
          cell={cell({ value: 5 })}
          row={0}
          col={0}
          selected={true}
          highlighted={false}
          peer={false}
          onPress={() => {}}
        />
      );
      expect(getByText("5").props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: darkColors.textOnAccent })])
      );
    });

    it("uses errorOnAccent for an error digit in the selected cell", async () => {
      const { getByText } = await wrap(
        <SudokuCell
          size={9}
          cell={cell({ value: 5, isError: true })}
          row={0}
          col={0}
          selected={true}
          highlighted={false}
          peer={false}
          onPress={() => {}}
        />
      );
      expect(getByText("5").props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: darkColors.errorOnAccent })])
      );
    });

    it("uses accent (not errorOnAccent) for an error digit in an unselected cell", async () => {
      const { getByText } = await wrap(
        <SudokuCell
          size={9}
          cell={cell({ value: 5, isError: true })}
          row={0}
          col={0}
          selected={false}
          highlighted={false}
          peer={false}
          onPress={() => {}}
        />
      );
      expect(getByText("5").props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: darkColors.error })])
      );
    });

    const DARK_ACCENT = darkColors.accent;
    const DARK_TEXT_ON_ACCENT = darkColors.textOnAccent;
    const DARK_ERROR_ON_ACCENT = darkColors.errorOnAccent;

    it("meets WCAG AA (4.5:1) for a given/user-entered digit on the selected-cell background", () => {
      expect(contrastRatio(DARK_TEXT_ON_ACCENT, DARK_ACCENT)).toBeGreaterThanOrEqual(4.5);
    });

    it("meets WCAG AA (4.5:1) for an error digit on the selected-cell background", () => {
      expect(contrastRatio(DARK_ERROR_ON_ACCENT, DARK_ACCENT)).toBeGreaterThanOrEqual(4.5);
    });
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

  it("typical mid-game state: tints, digit colors and box separators", async () => {
    const g = emptyGrid();
    g[0]![0] = cell({ value: 5, given: true });
    g[4]![4] = cell({ value: 3 });
    g[8]![8] = cell({ value: 7, isError: true });
    const { getAllByRole, getByLabelText, getByText } = await wrap(
      <SudokuGrid
        variant="classic"
        grid={asGrid(g)}
        selectedRow={4}
        selectedCol={4}
        onCellPress={() => {}}
      />
    );
    expect(getByLabelText("Sudoku board")).toHaveStyle({
      borderWidth: 2,
      borderColor: darkColors.boxBorder,
    });
    const cells = getAllByRole("button");
    expect(cells).toHaveLength(81);
    const at = (r: number, c: number) => cells[r * 9 + c]!;
    // Selected (4,4), its row/column peers, and a box-only neighbour, which is a peer too (#3773).
    const peerWash = composite(darkColors.surface, SUDOKU_WASHES.dark.peer);
    expect(at(4, 4)).toHaveStyle({ backgroundColor: darkColors.accent });
    expect(at(4, 0)).toHaveStyle({ backgroundColor: peerWash });
    expect(at(0, 4)).toHaveStyle({ backgroundColor: peerWash });
    expect(at(3, 3)).toHaveStyle({ backgroundColor: peerWash });
    expect(at(0, 0)).toHaveStyle({ backgroundColor: darkColors.surface }); // no relation to (4,4)
    // Digits: given (text), selected user entry (textOnAccent), unselected error (error).
    expect(getByText("5")).toHaveStyle({ color: darkColors.text });
    expect(getByText("3")).toHaveStyle({ color: darkColors.textOnAccent });
    expect(getByText("7")).toHaveStyle({ color: darkColors.error });
    // Box separators are 2px boxBorder; inner separators are hairline border.
    const wrapperOf = (r: number, c: number) => at(r, c).parent!;
    expect(wrapperOf(0, 3)).toHaveStyle({
      backgroundColor: darkColors.surface,
      borderLeftWidth: 2,
      borderLeftColor: darkColors.boxBorder,
      borderTopWidth: 0,
    });
    expect(wrapperOf(0, 1)).toHaveStyle({
      borderLeftWidth: 1 / PixelRatio.get(),
      borderLeftColor: darkColors.border,
    });
    expect(wrapperOf(8, 8)).toHaveStyle({ borderRightWidth: 0, borderBottomWidth: 0 });
  });

  describe("peer highlighting", () => {
    const PEER_DARK = composite(darkColors.surface, SUDOKU_WASHES.dark.peer);
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
      const cells = getAllByRole("button");
      // Row 4, col 0 = index 4*9+0 = 36: washed. The selected cell itself is solid accent.
      expect(cells[4 * 9 + 0]!.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ backgroundColor: PEER_DARK })])
      );
      expect(cells[4 * 9 + 4]!.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ backgroundColor: darkColors.accent })])
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
          expect.objectContaining({ backgroundColor: darkColors.accent }), // selected fill, not the peer wash
        ])
      );
    });

    it("marks box-only cells as peers (#3773)", async () => {
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
      // (1,1) shares a box with (0,0) but not its row or column: washed like the row and column.
      const boxOnlyCell = cells[1 * 9 + 1]!;
      expect(boxOnlyCell.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ backgroundColor: PEER_DARK })])
      );
      // (4,4) is in no shared row, column or box with (0,0).
      expect(cells[4 * 9 + 4]!.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ backgroundColor: darkColors.surface })])
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
            expect.objectContaining({ backgroundColor: darkColors.surface }), // default surface
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
  it("renders the 9 digit keys and nothing else (the tools are the action bar's, #3773)", async () => {
    const { getAllByRole } = await wrap(
      <NumberPad
        variant="classic"
        grid={asGrid(emptyGrid())}
        notesMode={false}
        onDigit={() => {}}
      />
    );
    expect(getAllByRole("button")).toHaveLength(9);
  });

  it("fires onDigit with the placed digit", async () => {
    const onDigit = jest.fn();
    const { getByLabelText } = await wrap(
      <NumberPad variant="classic" grid={asGrid(emptyGrid())} notesMode={false} onDigit={onDigit} />
    );
    await fireEvent.press(getByLabelText(/enter digit 5/i));
    expect(onDigit).toHaveBeenCalledWith(5);
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
      <NumberPad variant="classic" grid={asGrid(g)} notesMode={false} onDigit={onDigit} />
    );
    const btn = getByLabelText(/enter digit 4/i);
    expect(btn.props.accessibilityState?.disabled).toBe(true);
    expect(btn).toHaveStyle({ opacity: 0.32 });
    await fireEvent.press(btn);
    // Disabled Pressable shouldn't fire onPress.
    expect(onDigit).not.toHaveBeenCalled();
  });

  it("notes mode active: dashed accent keys, full remaining counts", async () => {
    const { getByTestId, getAllByText } = await wrap(
      <NumberPad variant="classic" grid={asGrid(emptyGrid())} notesMode={true} onDigit={() => {}} />
    );
    for (let d = 1; d <= 9; d++) {
      const btn = getByTestId(`sudoku-digit-${d}`);
      expect(btn.props.accessibilityLabel).toBe(`Enter digit ${d}. Remaining: 9`);
      expect(btn.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
      expect(btn).toHaveStyle({
        backgroundColor: darkColors.surfaceHigh,
        borderColor: darkColors.accentText,
        borderStyle: "dashed",
        opacity: 1,
      });
    }
    // Empty grid: every digit has 9 left. "9" is also the digit-9 label, hence 10.
    expect(getAllByText("9")).toHaveLength(10);
    expect(getAllByText("9")[0]).toHaveStyle({ color: darkColors.textMuted }); // a remaining count
    expect(getAllByText("9")[8]).toHaveStyle({ color: darkColors.accentText }); // the 9 key's digit
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
    expect(getByLabelText(/hard/i).props.accessibilityState?.checked).toBe(true);
    expect(getByLabelText(/easy/i).props.accessibilityState?.checked).toBe(false);
  });

  it("fires onChange with the new difficulty", async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await wrap(<DifficultySelector value="easy" onChange={onChange} />);
    await fireEvent.press(getByLabelText(/hard/i));
    expect(onChange).toHaveBeenCalledWith("hard");
  });

  it("medium selected: radiogroup with a filled Medium chip", async () => {
    const { getByLabelText, getAllByRole, getByText } = await wrap(
      <DifficultySelector value="medium" onChange={() => {}} />
    );
    expect(getByLabelText("Difficulty")).toHaveStyle({
      borderColor: darkColors.border,
    });
    const radios = getAllByRole("radio");
    expect(radios.map((r) => r.props.accessibilityLabel)).toEqual(["Easy", "Medium", "Hard"]);
    expect(radios.map((r) => r.props.accessibilityState?.checked)).toEqual([false, true, false]);
    expect(radios.map((r) => r.props.testID)).toEqual([
      "sudoku-difficulty-easy",
      "sudoku-difficulty-medium",
      "sudoku-difficulty-hard",
    ]);
    expect(radios[1]).toHaveStyle({ backgroundColor: darkColors.accent });
    expect(radios[0]).toHaveStyle({ backgroundColor: darkColors.surface });
    expect(getByText("Medium")).toHaveStyle({ color: darkColors.textOnAccent });
    expect(getByText("Easy")).toHaveStyle({ color: darkColors.text });
  });
});

describe("SudokuCell mistake colouring (#2943)", () => {
  const props = {
    size: 9,
    row: 0,
    col: 0,
    selected: false,
    highlighted: false,
    peer: false,
    onPress: () => {},
  };

  it("colours a legal-but-wrong digit as an error only when flagged as a mistake", async () => {
    const off = await wrap(<SudokuCell {...props} cell={cell({ value: 5 })} />);
    expect(off.getByText("5")).toHaveStyle({ color: darkColors.accentText });
    await off.unmount();
    const on = await wrap(<SudokuCell {...props} cell={cell({ value: 5 })} mistake />);
    expect(on.getByText("5")).toHaveStyle({ color: darkColors.error });
  });

  it("uses the on-accent error colour for a selected mistake", async () => {
    const { getByText } = await wrap(
      <SudokuCell {...props} selected cell={cell({ value: 5 })} mistake />
    );
    expect(getByText("5")).toHaveStyle({ color: darkColors.errorOnAccent });
  });
});

describe("SudokuGrid showMistakes (#2943)", () => {
  const solution = "1".repeat(81);
  const g = emptyGrid();
  g[0]![0] = cell({ value: 2 }); // wrong vs the solution
  g[0]![1] = cell({ value: 1 }); // matches it
  g[0]![2] = cell({ value: 2, given: true }); // a given is never a mistake
  const grid = asGrid(g);

  it("colours only non-given digits that differ from the solution, and only when on", async () => {
    const off = await wrap(
      <SudokuGrid
        grid={grid}
        selectedRow={null}
        selectedCol={null}
        variant="classic"
        solution={solution}
        onCellPress={() => {}}
      />
    );
    expect(off.getAllByText("2")[0]).toHaveStyle({ color: darkColors.accentText });
    await off.unmount();
    const on = await wrap(
      <SudokuGrid
        grid={grid}
        selectedRow={null}
        selectedCol={null}
        variant="classic"
        solution={solution}
        showMistakes
        onCellPress={() => {}}
      />
    );
    const twos = on.getAllByText("2");
    expect(twos[0]).toHaveStyle({ color: darkColors.error }); // the player's wrong digit
    expect(twos[1]).toHaveStyle({ color: darkColors.text }); // the given
    expect(on.getByText("1")).toHaveStyle({ color: darkColors.accentText }); // correct digit
  });
});
