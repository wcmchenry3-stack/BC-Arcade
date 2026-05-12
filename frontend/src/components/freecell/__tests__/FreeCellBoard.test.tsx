/**
 * Interaction tests for FreeCellBoard — tap-to-move state machine (#990).
 *
 * Controlled state layout:
 *   Col 0: [2♣]   Col 1: [3♥]   Col 2: [K♦]   Cols 3–7: empty
 *   freeCells[0]: A♠   freeCells[1]: K♠   freeCells[2–3]: null
 *   All foundations empty
 *
 * Engine rule: only Kings may move to an empty tableau column.
 * (canStackOnTableau returns false for non-kings on an empty destination.)
 *
 * Valid tap-to-move paths exercised:
 *   2♣ → 3♥               (tableau-to-tableau, black rank 2 onto red rank 3)
 *   K♦ → empty col        (tableau-to-tableau, king onto empty column)
 *   2♣ → empty freecell   (tableau-to-freecell)
 *   A♠ → spades foundation (freecell-to-foundation, ace starts a foundation)
 *   K♠ → empty col        (freecell-to-tableau, king onto empty column)
 *
 * Drag-and-drop coverage: the drop handlers in FreeCellBoard exercise
 * the same validateMove paths as tap-to-move. Full gesture simulation
 * (pan → overlay → drop) requires a device-level harness (Maestro E2E, #990).
 */

import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import FreeCellBoard from "../FreeCellBoard";
import type { FreeCellState } from "../../../game/freecell/types";
import { DragProvider } from "../../../game/_shared/drag/DragContext";
import { DraggableCard } from "../../../game/_shared/drag/DraggableCard";

// Col 0: 2♣   Col 1: 3♥   Col 2: K♦   Cols 3–7: empty
// freeCells[0]: A♠   [1]: K♠   [2–3]: null
// All foundations empty
const BASE_STATE: FreeCellState = {
  _v: 1,
  tableau: [
    [{ suit: "clubs", rank: 2 }],
    [{ suit: "hearts", rank: 3 }],
    [{ suit: "diamonds", rank: 13 }],
    [],
    [],
    [],
    [],
    [],
  ],
  freeCells: [{ suit: "spades", rank: 1 }, { suit: "spades", rank: 13 }, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

// State with two non-empty foundations for Story 9 re-select test.
const STATE_WITH_TWO_FOUNDATIONS: FreeCellState = {
  _v: 1,
  tableau: [[], [], [], [], [], [], [], []],
  freeCells: [null, null, null, null],
  foundations: {
    spades: [{ suit: "spades", rank: 1 }],
    hearts: [{ suit: "hearts", rank: 1 }],
    diamonds: [],
    clubs: [],
  },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

// State with an Ace in tableau col 0 for Story 10 double-tap test.
const STATE_WITH_ACE_TABLEAU: FreeCellState = {
  _v: 1,
  tableau: [[{ suit: "diamonds", rank: 1 }], [], [], [], [], [], [], []],
  freeCells: [null, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

function renderBoard(state = BASE_STATE, onMove = jest.fn()) {
  const utils = render(
    <ThemeProvider>
      <FreeCellBoard state={state} onMove={onMove} />
    </ThemeProvider>
  );
  return { ...utils, onMove };
}

afterEach(() => jest.useRealTimers());

// ── Selection ────────────────────────────────────────────────────────────────

describe("FreeCellBoard — selection", () => {
  it("selects a tableau card on first tap", () => {
    const { getByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("2 of Clubs"));
    expect(getByLabelText("2 of Clubs (selected)")).toBeTruthy();
  });

  it("deselects a tableau card when tapped after the double-tap window", () => {
    jest.useFakeTimers();
    const { getByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("2 of Clubs"));
    jest.advanceTimersByTime(301); // past DOUBLE_TAP_MS=300
    fireEvent.press(getByLabelText("2 of Clubs (selected)"));
    expect(getByLabelText("2 of Clubs")).toBeTruthy();
  });

  it("selects a freecell card on first tap", () => {
    const { getByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("A of Spades"));
    expect(getByLabelText("A of Spades (selected)")).toBeTruthy();
  });

  it("deselects a freecell card when tapped after the double-tap window", () => {
    jest.useFakeTimers();
    const { getByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("A of Spades"));
    jest.advanceTimersByTime(301); // past DOUBLE_TAP_MS=300 — prevents freecell-to-foundation double-tap
    fireEvent.press(getByLabelText("A of Spades (selected)"));
    expect(getByLabelText("A of Spades")).toBeTruthy();
  });

  it("does not select an empty freecell slot", () => {
    const { getByLabelText, queryByLabelText } = renderBoard();
    // freeCells[2] is null → "Empty free cell 3" (1-indexed)
    fireEvent.press(getByLabelText("Empty free cell 3"));
    expect(queryByLabelText(/\(selected\)/)).toBeNull();
  });

  it("clears selection after a valid move", () => {
    const { getByLabelText, queryByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("2 of Clubs")); // select
    fireEvent.press(getByLabelText("3 of Hearts")); // valid move → clears selection
    expect(queryByLabelText(/\(selected\)/)).toBeNull();
  });

  it("preserves selection after an invalid move attempt", () => {
    jest.useFakeTimers();
    const { getByLabelText, queryByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("3 of Hearts")); // select col 1
    jest.advanceTimersByTime(301); // past double-tap window so second tap is not a double-tap
    fireEvent.press(getByLabelText("2 of Clubs")); // invalid destination → re-select col 0
    expect(queryByLabelText(/\(selected\)/)).toBeTruthy();
  });
});

// ── Valid moves ──────────────────────────────────────────────────────────────

describe("FreeCellBoard — valid moves", () => {
  it("tableau-to-tableau: moves a card onto a valid destination", () => {
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("2 of Clubs")); // select col 0
    fireEvent.press(getByLabelText("3 of Hearts")); // col 1
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
  });

  it("tableau-to-tableau: moves a King onto an empty column", () => {
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("K of Diamonds")); // select col 2 (K♦)
    // col index 3 → "Empty tableau column 4" (1-indexed)
    fireEvent.press(getByLabelText("Empty tableau column 4"));
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 2,
      fromIndex: 0,
      toCol: 3,
    });
  });

  it("tableau-to-freecell: parks a card in an empty freecell slot", () => {
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("2 of Clubs")); // select col 0
    // freeCells[2] → "Empty free cell 3" (1-indexed)
    fireEvent.press(getByLabelText("Empty free cell 3"));
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-freecell",
      fromCol: 0,
      toCell: 2,
    });
  });

  it("freecell-to-foundation: moves an ace to the matching foundation", () => {
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("A of Spades")); // select freecell 0
    fireEvent.press(getByLabelText("Empty Spades foundation"));
    expect(onMove).toHaveBeenCalledWith({
      type: "freecell-to-foundation",
      fromCell: 0,
    });
  });

  it("freecell-to-tableau: moves a King freecell card onto an empty column", () => {
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("K of Spades")); // select freecell 1 (K♠)
    // col index 3 → "Empty tableau column 4" (1-indexed)
    fireEvent.press(getByLabelText("Empty tableau column 4"));
    expect(onMove).toHaveBeenCalledWith({
      type: "freecell-to-tableau",
      fromCell: 1,
      toCol: 3,
    });
  });
});

// ── Invalid moves ────────────────────────────────────────────────────────────

describe("FreeCellBoard — invalid moves", () => {
  it("does not call onMove when a higher-rank card is placed on a lower-rank card", () => {
    // 3♥ (rank 3) cannot go on top of 2♣ (rank 2).
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("3 of Hearts")); // select col 1
    fireEvent.press(getByLabelText("2 of Clubs")); // invalid destination
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not call onMove when a non-king is placed on an empty column", () => {
    // Engine rule: only Kings may go to empty tableau columns.
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("2 of Clubs")); // rank 2 — not a king
    fireEvent.press(getByLabelText("Empty tableau column 4"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not call onMove when no card is selected and an empty column is tapped", () => {
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("Empty tableau column 4")); // no prior selection
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not call onMove when no card is selected and a foundation is tapped", () => {
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("Empty Spades foundation")); // no prior selection
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not call onMove when no card is selected and an empty freecell is tapped", () => {
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("Empty free cell 3")); // no prior selection
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not call onMove when a second occupied freecell is tapped while another is selected", () => {
    // freecell-to-freecell is not a legal move; board just deselects.
    // A♠ (cell 0) selected, then tap K♠ (cell 1) → deselect only.
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("A of Spades")); // select freecell 0
    fireEvent.press(getByLabelText("K of Spades")); // tap freecell 1 → deselect
    expect(onMove).not.toHaveBeenCalled();
  });
});

// ── Story 9: foundation re-select ────────────────────────────────────────────

describe("FreeCellBoard — foundation re-select (Story 9)", () => {
  it("re-selects to a different non-empty foundation when one is already selected", () => {
    const { getByLabelText, queryByLabelText } = renderBoard(STATE_WITH_TWO_FOUNDATIONS);
    fireEvent.press(getByLabelText("A of Spades")); // select spades foundation
    expect(getByLabelText("A of Spades (selected)")).toBeTruthy();
    fireEvent.press(getByLabelText("A of Hearts")); // tap hearts foundation → re-select
    expect(getByLabelText("A of Hearts (selected)")).toBeTruthy();
    expect(queryByLabelText("A of Spades (selected)")).toBeNull();
  });
});

// ── Story 10: double-tap ──────────────────────────────────────────────────────

describe("FreeCellBoard — double-tap (Story 10)", () => {
  it("freecell: two taps within 300ms → freecell-to-foundation", () => {
    jest.useFakeTimers();
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("A of Spades")); // first tap: selects
    fireEvent.press(getByLabelText("A of Spades (selected)")); // second tap within 300ms → foundation
    expect(onMove).toHaveBeenCalledWith({ type: "freecell-to-foundation", fromCell: 0 });
  });

  it("tableau: two taps within 300ms on top card → tableau-to-foundation", () => {
    jest.useFakeTimers();
    const { getByLabelText, onMove } = renderBoard(STATE_WITH_ACE_TABLEAU);
    fireEvent.press(getByLabelText("A of Diamonds")); // first tap: selects
    fireEvent.press(getByLabelText("A of Diamonds (selected)")); // second tap within 300ms → foundation
    expect(onMove).toHaveBeenCalledWith({ type: "tableau-to-foundation", fromCol: 0 });
  });

  it("freecell: two taps separated by >300ms do NOT trigger a foundation move", () => {
    jest.useFakeTimers();
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("A of Spades")); // first tap: selects
    jest.advanceTimersByTime(301); // past double-tap window
    fireEvent.press(getByLabelText("A of Spades (selected)")); // second tap: deselects
    expect(onMove).not.toHaveBeenCalled();
  });
});

// ── Tree-shape: DragProvider placement (#1249) ────────────────────────────────

describe("FreeCellBoard — DragProvider tree shape", () => {
  it("all DraggableCard instances have a DragProvider ancestor (no missing provider)", () => {
    // If DragProvider were absent or misplaced, DraggableCard.useDragContext would
    // throw on mount — this render is the implicit assertion. The count check
    // confirms cards actually rendered rather than being silently absent.
    const { UNSAFE_getAllByType } = renderBoard();
    const draggables = UNSAFE_getAllByType(DraggableCard);
    expect(draggables.length).toBeGreaterThan(0);
  });

  it("DragProvider is rendered exactly once in FreeCellBoard", () => {
    const { UNSAFE_getAllByType } = renderBoard();
    const providers = UNSAFE_getAllByType(DragProvider);
    expect(providers).toHaveLength(1);
  });

  it("DragProvider has no ancestor with a transform style", () => {
    const { UNSAFE_root } = renderBoard();
    const dp = UNSAFE_root.findByType(DragProvider);
    let node = dp.parent;
    while (node) {
      const s = node.props?.style;
      const styles = Array.isArray(s) ? s.flat(Infinity) : [s];
      for (const style of styles) {
        if (style && typeof style === "object" && !Array.isArray(style) && "transform" in style) {
          throw new Error(`DragProvider ancestor has transform style: ${JSON.stringify(style)}`);
        }
      }
      node = node.parent;
    }
  });
});
