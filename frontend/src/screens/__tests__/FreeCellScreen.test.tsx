/**
 * FreeCellScreen — hint and no-moves-banner integration tests (#1295).
 *
 * Engine correctness is covered by engine.test.ts. These tests focus on
 * the screen's hint handler: when getHintMoves returns [] (all moves are
 * non-productive reversible swaps), pressing Hint must surface the
 * "No moves left" banner rather than oscillating between two equivalent squares.
 */

import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import FreeCellScreen from "../FreeCellScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import type { FreeCellState } from "../../game/freecell/types";

// ---------------------------------------------------------------------------
// Global setup: expo-blur, navigation, storage
// ---------------------------------------------------------------------------

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }),
}));

jest.mock("../../game/freecell/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn().mockResolvedValue(undefined),
  clearGame: jest.fn().mockResolvedValue(undefined),
}));

import { loadGame } from "../../game/freecell/storage";

// ---------------------------------------------------------------------------
// Canonical reversible-only state (#1295):
//   col 0: [8♠, 7♥]   col 1: [8♣]   cols 2–7: empty
//   freeCells: [3♥, 3♦, 3♣, 3♠]  (all filled — no parking available)
//   foundations: empty
//
// Only legal t-t-t move is 7♥ from col 0 to col 1, which isProductiveMove
// classifies as non-productive. getHintMoves returns [].
// ---------------------------------------------------------------------------

const REVERSIBLE_ONLY_STATE: FreeCellState = {
  _v: 1,
  tableau: [
    [
      { suit: "spades", rank: 8 },
      { suit: "hearts", rank: 7 },
    ],
    [{ suit: "clubs", rank: 8 }],
    [],
    [],
    [],
    [],
    [],
    [],
  ],
  freeCells: [
    { suit: "hearts", rank: 3 },
    { suit: "diamonds", rank: 3 },
    { suit: "clubs", rank: 3 },
    { suit: "spades", rank: 3 },
  ],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

jest.useFakeTimers();

function renderScreen() {
  return render(
    <ThemeProvider>
      <FreeCellScreen />
    </ThemeProvider>
  );
}

describe("FreeCellScreen — hint on reversible-only position (#1295)", () => {
  beforeEach(() => {
    (loadGame as jest.Mock).mockResolvedValue(REVERSIBLE_ONLY_STATE);
  });

  afterEach(() => {
    jest.runAllTimers();
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("shows 'No moves left' banner with message and Undo action when Hint is pressed", async () => {
    const { getByLabelText, queryByText, getAllByLabelText } = renderScreen();

    // Wait for loadGame to resolve and state to mount
    await waitFor(() => getByLabelText("Hint"));

    // Before pressing Hint, no banner
    expect(queryByText(/no moves left/i)).toBeNull();

    act(() => {
      fireEvent.press(getByLabelText("Hint"));
    });

    await waitFor(() => {
      // Banner message is visible
      expect(queryByText(/no moves left/i)).not.toBeNull();
      // Banner adds a second Undo button (header already has one, banner adds another)
      expect(getAllByLabelText("Undo").length).toBe(2);
    });
  });

  it("banner does not appear before Hint is pressed", async () => {
    const { getByLabelText, queryByText } = renderScreen();

    await waitFor(() => getByLabelText("Hint"));
    expect(queryByText(/no moves left/i)).toBeNull();
  });
});
