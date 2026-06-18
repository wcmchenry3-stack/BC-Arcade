/**
 * Smart single-tap auto-move tests — supermove pre-check + priority ladder
 * edge cases (#2037).
 *
 * Focused on the supermove-rejected path and `onSupermoveRejected` callback,
 * which FreeCellBoard.test.tsx doesn't cover.
 */

import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import FreeCellBoard from "../FreeCellBoard";
import type { FreeCellState } from "../../../game/freecell/types";

async function renderBoard(
  state: FreeCellState,
  onMove = jest.fn(),
  onSupermoveRejected?: () => void
) {
  const utils = await render(
    <ThemeProvider>
      <FreeCellBoard state={state} onMove={onMove} onSupermoveRejected={onSupermoveRejected} />
    </ThemeProvider>
  );
  return { ...utils, onMove };
}

// ---------------------------------------------------------------------------
// Supermove pre-check
// ---------------------------------------------------------------------------

describe("FreeCellBoard — supermove pre-check (#2037)", () => {
  it("calls onSupermoveRejected and does NOT call onMove when run exceeds capacity", async () => {
    // Run of 3 (5♥→4♠→3♥ from index 0, alternating-color descending).
    // All 4 free cells occupied; 1 empty column (col 7, excluding source col 0).
    // maxCapacity = (1 + 0) × 2^1 = 2  →  run length 3 > 2 → rejected.
    const state: FreeCellState = {
      _v: 1,
      tableau: [
        [
          { suit: "hearts", rank: 5 },
          { suit: "spades", rank: 4 },
          { suit: "hearts", rank: 3 },
        ],
        [{ suit: "clubs", rank: 6 }],
        [{ suit: "spades", rank: 7 }],
        [{ suit: "diamonds", rank: 8 }],
        [{ suit: "clubs", rank: 9 }],
        [{ suit: "spades", rank: 10 }],
        [{ suit: "diamonds", rank: 11 }],
        [],
      ],
      freeCells: [
        { suit: "clubs", rank: 1 },
        { suit: "spades", rank: 1 },
        { suit: "diamonds", rank: 1 },
        { suit: "hearts", rank: 1 },
      ],
      foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
      undoStack: [],
      isComplete: false,
      moveCount: 0,
    };

    const onMove = jest.fn();
    const onSupermoveRejected = jest.fn();
    const { getByLabelText } = await renderBoard(state, onMove, onSupermoveRejected);

    // Tapping the run root (5♥ at index 0 of col 0)
    await fireEvent.press(getByLabelText("5 of Hearts"));

    expect(onMove).not.toHaveBeenCalled();
    expect(onSupermoveRejected).toHaveBeenCalledTimes(1);
  });

  it("does NOT reject when run length equals the supermove capacity", async () => {
    // Run of 2 (5♥→4♠ from index 0).
    // All 4 free cells occupied; 1 empty column.
    // maxCapacity = (1 + 0) × 2^1 = 2  →  run length 2 = 2 → allowed.
    // The 6♣ in col 1 is the valid destination (black, rank 6 → 5♥ red rank 5).
    // Wait: 5♥ is red, 4♠ is black; the run head is 5♥ (red).
    // Destination needs to be black rank 6 for 5♥ to stack.
    // 6♣ (black, rank 6) in col 1 → canStackOnTableau(5♥, 6♣) ✓.
    const state: FreeCellState = {
      _v: 1,
      tableau: [
        [
          { suit: "hearts", rank: 5 },
          { suit: "spades", rank: 4 },
        ],
        [{ suit: "clubs", rank: 6 }],
        [],
        [{ suit: "spades", rank: 7 }],
        [{ suit: "diamonds", rank: 8 }],
        [{ suit: "clubs", rank: 9 }],
        [{ suit: "spades", rank: 10 }],
        [{ suit: "diamonds", rank: 11 }],
      ],
      freeCells: [
        { suit: "clubs", rank: 1 },
        { suit: "spades", rank: 1 },
        { suit: "diamonds", rank: 1 },
        { suit: "hearts", rank: 1 },
      ],
      foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
      undoStack: [],
      isComplete: false,
      moveCount: 0,
    };

    const onMove = jest.fn();
    const onSupermoveRejected = jest.fn();
    const { getByLabelText } = await renderBoard(state, onMove, onSupermoveRejected);

    await fireEvent.press(getByLabelText("5 of Hearts"));

    expect(onSupermoveRejected).not.toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Priority ladder: destination-quality preference
// ---------------------------------------------------------------------------

describe("FreeCellBoard — priority ladder destination preference (#2037)", () => {
  it("prefers the destination with the longer existing run over a shorter one", async () => {
    // Col 0: [2♣] — source.
    // Col 1: [4♠, 3♥] — top is 3♥ (red, rank 3); existing run length = 2.
    // Col 2: [3♦]     — top is 3♦ (red, rank 3); existing run length = 1.
    // 2♣ can go on either 3♥ or 3♦, but col 1's run is longer → execute col 1.
    const state: FreeCellState = {
      _v: 1,
      tableau: [
        [{ suit: "clubs", rank: 2 }],
        [
          { suit: "spades", rank: 4 },
          { suit: "hearts", rank: 3 },
        ],
        [{ suit: "diamonds", rank: 3 }],
        [],
        [],
        [],
        [],
        [],
      ],
      freeCells: [null, null, null, null],
      foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
      undoStack: [],
      isComplete: false,
      moveCount: 0,
    };

    const onMove = jest.fn();
    const { getByLabelText } = await renderBoard(state, onMove);
    await fireEvent.press(getByLabelText("2 of Clubs"));

    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
  });
});
