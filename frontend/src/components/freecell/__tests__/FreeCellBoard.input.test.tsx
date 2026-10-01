/**
 * #2225 — FreeCell input at the wrong moment:
 *  1. taps and drops during Auto-Complete are rejected with feedback, not
 *     silently swallowed;
 *  2. a double-tap to the foundation on card B works while card A is selected.
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import FreeCellBoard from "../FreeCellBoard";
import type { FreeCellState } from "../../../game/freecell/types";

const mockPlay = jest.fn(() => true);
jest.mock("../../../game/_shared/useSound", () => ({
  useSound: () => ({ play: mockPlay, stop: jest.fn() }),
}));

// 3♥ (col 0) has two black-4 destinations (cols 1, 2) → a tap selects it.
// A♦ (col 3) can go to the foundation; it is not a destination for 3♥.
const STATE: FreeCellState = {
  _v: 1,
  tableau: [
    [{ suit: "hearts", rank: 3 }],
    [{ suit: "clubs", rank: 4 }],
    [{ suit: "spades", rank: 4 }],
    [{ suit: "diamonds", rank: 1 }],
    [],
    [],
    [],
    [],
  ],
  freeCells: [{ suit: "spades", rank: 1 }, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

async function renderBoard(inputLocked: boolean, onMove = jest.fn()) {
  const utils = await render(
    <ThemeProvider>
      <FreeCellBoard state={STATE} onMove={onMove} inputLocked={inputLocked} />
    </ThemeProvider>
  );
  return { ...utils, onMove };
}

beforeEach(() => mockPlay.mockClear());

describe("FreeCellBoard — input during Auto-Complete (#2225)", () => {
  it("rejects a tableau tap with the invalid-move sound and leaves no selection", async () => {
    const { getByLabelText, queryByLabelText, onMove } = await renderBoard(true);
    await fireEvent.press(getByLabelText("3 of Hearts"));
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
    expect(queryByLabelText(/\(selected\)/)).toBeNull();
  });

  it("rejects free-cell and empty-column taps the same way", async () => {
    const { getByLabelText, onMove } = await renderBoard(true);
    await fireEvent.press(getByLabelText("A of Spades"));
    await fireEvent.press(getByLabelText("Empty tableau column 5"));
    expect(mockPlay).toHaveBeenCalledTimes(2);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a double-tap during Auto-Complete does not move anything", async () => {
    const { getByLabelText, onMove } = await renderBoard(true);
    await fireEvent.press(getByLabelText("A of Diamonds"));
    await fireEvent.press(getByLabelText("A of Diamonds"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("accepts taps again once unlocked", async () => {
    const { getByLabelText, rerender, onMove } = await renderBoard(true);
    await rerender(
      <ThemeProvider>
        <FreeCellBoard state={STATE} onMove={onMove} inputLocked={false} />
      </ThemeProvider>
    );
    await fireEvent.press(getByLabelText("3 of Hearts"));
    expect(getByLabelText("3 of Hearts (selected)")).toBeTruthy();
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe("FreeCellBoard — double-tap with another card selected (#2225)", () => {
  it("double-tapping B sends B to the foundation while A is selected", async () => {
    const { getByLabelText, onMove } = await renderBoard(false);
    await fireEvent.press(getByLabelText("3 of Hearts")); // select A
    expect(getByLabelText("3 of Hearts (selected)")).toBeTruthy();
    await fireEvent.press(getByLabelText("A of Diamonds")); // tap 1 on B
    // 3♥ can't go on A♦: rejected with feedback, A stays selected…
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(getByLabelText("3 of Hearts (selected)")).toBeTruthy();
    expect(onMove).not.toHaveBeenCalled();
    // …but the tap still starts a double-tap on B.
    await fireEvent.press(getByLabelText("A of Diamonds")); // tap 2 on B
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ type: "tableau-to-foundation", fromCol: 3 });
  });

  it("a slow second tap on B is a second (rejected) move attempt, not a double-tap", async () => {
    jest.useFakeTimers();
    try {
      const { getByLabelText, onMove } = await renderBoard(false);
      await fireEvent.press(getByLabelText("3 of Hearts"));
      await fireEvent.press(getByLabelText("A of Diamonds"));
      jest.advanceTimersByTime(301);
      await fireEvent.press(getByLabelText("A of Diamonds"));
      expect(onMove).not.toHaveBeenCalled();
      expect(getByLabelText("3 of Hearts (selected)")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  // Mirrors e2e/tests/freecell-errors.spec.ts "board is usable after an
  // invalid move attempt" (#1563).
  it("an invalid destination keeps the selection, so the next legal tap moves it", async () => {
    const { getByLabelText, onMove } = await renderBoard(false);
    await fireEvent.press(getByLabelText("3 of Hearts")); // ambiguous → selects
    await fireEvent.press(getByLabelText("A of Diamonds")); // invalid destination
    expect(onMove).not.toHaveBeenCalled();
    expect(getByLabelText("3 of Hearts (selected)")).toBeTruthy();
    await fireEvent.press(getByLabelText("4 of Spades")); // legal destination
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 2,
    });
  });

  it("double-tapping an occupied free cell sends it to the foundation while a tableau card is selected", async () => {
    const { getByLabelText, onMove } = await renderBoard(false);
    await fireEvent.press(getByLabelText("3 of Hearts")); // select A
    await fireEvent.press(getByLabelText("A of Spades")); // tap 1 on occupied cell
    await fireEvent.press(getByLabelText(/A of Spades/)); // tap 2
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ type: "freecell-to-foundation", fromCell: 0 });
  });

  it("a legal destination tap still moves the selected card", async () => {
    const { getByLabelText, onMove } = await renderBoard(false);
    await fireEvent.press(getByLabelText("3 of Hearts"));
    await fireEvent.press(getByLabelText("4 of Clubs"));
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
  });
});
