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
        expect.arrayContaining([expect.objectContaining({ color: "#0e0e13" })])
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
        expect.arrayContaining([expect.objectContaining({ color: "#a0a0ac" })])
      );
    });

    // WCAG 2.2 contrast ratio (relative luminance per 1.4.3), computed against
    // each cell background's *composited* color (accent alpha-blended over the
    // surface) rather than the flat surface token — that composite is what was
    // missed when `textMuted` was originally tuned, causing this bug.
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

    // Alpha-blend `fgHex` (with a two-hex-digit alpha suffix, e.g. "AA") over
    // `bgHex`, matching the `colors.accent + "<alpha>"` composition used for
    // selected/highlighted/peer cell backgrounds in SudokuCell.
    function compositeOver(fgHex: string, alphaHex: string, bgHex: string): string {
      const alpha = parseInt(alphaHex, 16) / 255;
      const [fn, bn] = [parseInt(fgHex.slice(1), 16), parseInt(bgHex.slice(1), 16)];
      const mix = (shift: number) => {
        const fc = (fn >> shift) & 255;
        const bc = (bn >> shift) & 255;
        return Math.round(alpha * fc + (1 - alpha) * bc);
      };
      const [r, g, b] = [mix(16), mix(8), mix(0)];
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
    }

    const DARK_ACCENT = "#8ff5ff";
    const DARK_SURFACE = "#19191f";
    const DARK_TEXT_MUTED = "#a0a0ac";
    const DARK_TEXT_ON_ACCENT = "#0e0e13";

    it("meets WCAG AA (4.5:1) for note text on the selected-cell background", () => {
      const bg = compositeOver(DARK_ACCENT, "AA", DARK_SURFACE);
      expect(contrastRatio(DARK_TEXT_ON_ACCENT, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it("meets WCAG AA (4.5:1) for note text on the peer-cell background", () => {
      const bg = compositeOver(DARK_ACCENT, "22", DARK_SURFACE);
      expect(contrastRatio(DARK_TEXT_MUTED, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it("meets WCAG AA (4.5:1) for note text on the plain (unselected, non-peer) background", () => {
      expect(contrastRatio(DARK_TEXT_MUTED, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
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
