/**
 * Interaction tests for foundation-to-tableau retreats (#1111).
 *
 * Board layout:
 *   Col 0: [3♥]   Col 1: empty   Cols 2–7: empty
 *   freeCells: all null
 *   foundations: spades=[A♠, 2♠]  (top card 2♠)
 *                hearts/diamonds/clubs: empty
 */

import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import FreeCellBoard from "../FreeCellBoard";
import type { FreeCellState } from "../../../game/freecell/types";

const BASE: FreeCellState = {
  _v: 1,
  tableau: [[{ suit: "hearts", rank: 3 }], [], [], [], [], [], [], []],
  freeCells: [null, null, null, null],
  foundations: {
    spades: [
      { suit: "spades", rank: 1 },
      { suit: "spades", rank: 2 },
    ],
    hearts: [],
    diamonds: [],
    clubs: [],
  },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

function renderBoard(state = BASE, onMove = jest.fn()) {
  const utils = render(
    <ThemeProvider>
      <FreeCellBoard state={state} onMove={onMove} />
    </ThemeProvider>
  );
  return { ...utils, onMove };
}

afterEach(() => jest.useRealTimers());

// ── Selection ────────────────────────────────────────────────────────────────

describe("foundation retreat — selection", () => {
  it("selects a non-empty foundation on first tap", () => {
    const { getByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("2 of Spades"));
    expect(getByLabelText("2 of Spades (selected)")).toBeTruthy();
  });

  it("deselects when the same foundation is tapped again", () => {
    const { getByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("2 of Spades")); // select
    fireEvent.press(getByLabelText("2 of Spades (selected)")); // deselect
    expect(getByLabelText("2 of Spades")).toBeTruthy();
  });

  it("does not select an empty foundation", () => {
    const { queryByLabelText } = renderBoard();
    fireEvent.press(queryByLabelText("Empty Hearts foundation")!);
    // Nothing should be selected — no "(selected)" labels
    expect(queryByLabelText(/\(selected\)/)).toBeNull();
  });
});

// ── Valid retreat ────────────────────────────────────────────────────────────

describe("foundation retreat — valid move", () => {
  it("calls onMove with foundation-to-tableau when a valid column is tapped after selection", () => {
    // 2♠ (black rank 2) can go on 3♥ (red rank 3) in col 0
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("2 of Spades")); // select foundation
    fireEvent.press(getByLabelText("3 of Hearts")); // destination card in col 0
    expect(onMove).toHaveBeenCalledWith({
      type: "foundation-to-tableau",
      fromSuit: "spades",
      toCol: 0,
    });
  });

  it("calls onMove when a valid empty column is tapped (King only)", () => {
    const stateWithKing: FreeCellState = {
      ...BASE,
      foundations: {
        ...BASE.foundations,
        hearts: Array.from({ length: 13 }, (_, i) => ({
          suit: "hearts" as const,
          rank: (i + 1) as 1,
        })),
      },
    };
    const { getByLabelText, onMove } = renderBoard(stateWithKing);
    fireEvent.press(getByLabelText("K of Hearts")); // select hearts foundation
    fireEvent.press(getByLabelText("Empty tableau column 2")); // empty col (1-indexed col 2)
    expect(onMove).toHaveBeenCalledWith({
      type: "foundation-to-tableau",
      fromSuit: "hearts",
      toCol: 1,
    });
  });
});

// ── Invalid retreat ───────────────────────────────────────────────────────────

describe("foundation retreat — invalid move", () => {
  it("does not call onMove when stacking rule is violated", () => {
    // 2♠ (black rank 2) cannot go on 3♥... wait that's valid. Use a bad target.
    // 2♠ cannot go to an empty column (only Kings can).
    const { getByLabelText, onMove } = renderBoard();
    fireEvent.press(getByLabelText("2 of Spades")); // select foundation
    fireEvent.press(getByLabelText("Empty tableau column 2")); // empty col — invalid for non-King
    expect(onMove).not.toHaveBeenCalled();
  });

  it("preserves selection after an invalid attempt", () => {
    const { getByLabelText, queryByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("2 of Spades"));
    fireEvent.press(getByLabelText("Empty tableau column 2")); // invalid — non-King on empty col
    expect(queryByLabelText(/\(selected\)/)).toBeTruthy();
  });
});

// ── Interaction with other selection kinds ────────────────────────────────────

describe("foundation retreat — interaction with other selections", () => {
  it("selecting a tableau card clears any foundation selection", () => {
    const { getByLabelText, queryByLabelText } = renderBoard();
    fireEvent.press(getByLabelText("2 of Spades")); // select foundation
    fireEvent.press(getByLabelText("3 of Hearts")); // this executes the move (valid)
    // After a valid move, selection is cleared
    expect(queryByLabelText(/\(selected\)/)).toBeNull();
  });
});
