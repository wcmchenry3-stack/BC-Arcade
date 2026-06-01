/**
 * SudokuScreen — screen-level interaction, lifecycle, and leaderboard tests.
 *
 * #618 introduced the pre-game flow, input wiring, timer, and win modal.
 * #619 adds persistence via AsyncStorage, useGameSync instrumentation,
 * and the POST /sudoku/score call — this file covers the full surface.
 */

import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import SudokuScreen from "../SudokuScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { SudokuScoreboardProvider } from "../../game/sudoku/SudokuScoreboardContext";
import { enterDigit, loadPuzzle, selectCell } from "../../game/sudoku/engine";
import { saveGame } from "../../game/sudoku/storage";
import type { CellValue, SudokuState } from "../../game/sudoku/types";

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => () => {}),
  }),
}));

const mockStartGame = jest.fn<string, [string, Record<string, unknown>, Record<string, unknown>]>();
const mockEnqueueEvent = jest.fn();
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as unknown as jest.Mock)(...args),
    enqueueEvent: (...args: unknown[]) => (mockEnqueueEvent as unknown as jest.Mock)(...args),
    completeGame: (...args: unknown[]) => (mockCompleteGame as unknown as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../game/sudoku/api", () => ({
  sudokuApi: {
    submitPlayerName: jest.fn(),
    getLeaderboard: jest.fn(),
  },
}));

jest.mock("../../game/_shared/scoreQueue", () => ({
  scoreQueue: {
    enqueue: jest.fn().mockResolvedValue({ id: "q-1" }),
    flush: jest.fn().mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0, remaining: 0 }),
    registerHandler: jest.fn(),
  },
}));
// Import after mocks so the test file gets the jest.fn() flavour.
// eslint-disable-next-line import/order
import { scoreQueue } from "../../game/_shared/scoreQueue";

function fillAllExcept(state: SudokuState, skip: { row: number; col: number }): SudokuState {
  let s = state;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (r === skip.row && c === skip.col) continue;
      const cell = s.grid[r]![c]!;
      if (cell.given) continue;
      const correct = s.solution.charCodeAt(r * 9 + c) - 48;
      s = selectCell(s, r, c);
      s = enterDigit(s, correct as CellValue);
    }
  }
  return s;
}

function renderScreen() {
  return render(
    <ThemeProvider>
      <SudokuScoreboardProvider>
        <SudokuScreen />
      </SudokuScoreboardProvider>
    </ThemeProvider>
  );
}

async function renderAndAwaitLoad() {
  const rendered = renderScreen();
  // The pre-game card only mounts after loadGame() resolves.  Waiting
  // on the Start label gives us a deterministic post-load checkpoint.
  await waitFor(() => rendered.getByLabelText(/start/i));
  return rendered;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockStartGame.mockClear();
  mockStartGame.mockReturnValue("game-123");
  mockCompleteGame.mockClear();
  (scoreQueue.enqueue as jest.Mock).mockReset();
  (scoreQueue.enqueue as jest.Mock).mockResolvedValue({ id: "q-1" });
  (scoreQueue.flush as jest.Mock).mockReset();
  (scoreQueue.flush as jest.Mock).mockResolvedValue({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    remaining: 0,
  });
});

describe("SudokuScreen — pre-game (after load)", () => {
  it("shows the pre-game picker when no save exists", async () => {
    const { getByLabelText, getByRole } = await renderAndAwaitLoad();
    expect(getByLabelText(/easy/i)).toBeTruthy();
    expect(getByLabelText(/hard/i)).toBeTruthy();
    expect(getByRole("button", { name: /start/i })).toBeTruthy();
  });
});

describe("SudokuScreen — mount resume", () => {
  it("resumes a previously-saved game silently", async () => {
    const saved = loadPuzzle("medium", "classic", () => 0);
    await saveGame(saved);

    const { queryByLabelText, getAllByRole } = renderScreen();
    // After load, the pre-game "Start" button should no longer exist —
    // the board replaces it.
    await waitFor(() => {
      expect(queryByLabelText(/start/i)).toBeNull();
    });
    const buttons = getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(81);
  });
});

describe("SudokuScreen — in-game input", () => {
  async function startEasy() {
    const rendered = await renderAndAwaitLoad();
    fireEvent.press(rendered.getByLabelText(/start/i));
    return rendered;
  }

  it("disables Undo until a move is made", async () => {
    const { getByLabelText } = await startEasy();
    expect(getByLabelText(/undo/i).props.accessibilityState?.disabled).toBe(true);
  });

  it("toggles notes mode via the header action", async () => {
    const { getAllByLabelText } = await startEasy();
    const toggles = getAllByLabelText(/pencil/i);
    expect(toggles[0]!.props.accessibilityState?.selected).toBe(false);
    fireEvent.press(toggles[0]!);
    const after = getAllByLabelText(/pencil/i);
    expect(after[0]!.props.accessibilityState?.selected).toBe(true);
  });

  it("opens a useGameSync session on first digit placement", async () => {
    const { getAllByRole, getByLabelText } = await startEasy();
    const emptyCells = getAllByRole("button").filter((n) =>
      /empty/.test(String(n.props.accessibilityLabel ?? ""))
    );
    act(() => {
      fireEvent.press(emptyCells[0]!);
    });
    act(() => {
      fireEvent.press(getByLabelText(/enter digit 1/i));
    });
    // ensureSyncStarted runs inside a setState updater; waitFor lets React 18
    // flush the batch before asserting.
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
    expect(mockStartGame.mock.calls[0]![0]).toBe("sudoku");
  });

  it("persists state after digit input", async () => {
    const { getAllByRole, getByLabelText } = await startEasy();
    const emptyCells = getAllByRole("button").filter((n) =>
      /empty/.test(String(n.props.accessibilityLabel ?? ""))
    );
    act(() => {
      fireEvent.press(emptyCells[0]!);
    });
    act(() => {
      fireEvent.press(getByLabelText(/enter digit 5/i));
    });
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem("sudoku_game");
      expect(raw).not.toBeNull();
    });
  });
});

describe("SudokuScreen — win flow", () => {
  // Load an almost-complete save (one non-given cell remaining), then enter
  // the last correct digit so ensureSyncStarted fires and completedGameId is
  // captured before syncComplete clears gameIdRef.
  async function renderIntoWinModal(): Promise<ReturnType<typeof renderScreen>> {
    const fresh = loadPuzzle("easy", "classic", () => 0);

    // Find the first non-given cell to leave as the "last move".
    let lastCell: { row: number; col: number } | null = null;
    outer: for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (!fresh.grid[r]![c]!.given) {
          lastCell = { row: r, col: c };
          break outer;
        }
      }
    }
    expect(lastCell).not.toBeNull();

    const almostSolved = fillAllExcept(fresh, lastCell!);
    expect(almostSolved.isComplete).toBe(false);
    await saveGame(almostSolved);

    const rendered = renderScreen();
    // Wait for the board to load (no Start button = in-game).
    await waitFor(() => expect(rendered.queryByLabelText(/start/i)).toBeNull());

    // Select the one remaining empty cell and enter the correct digit.
    const emptyCells = rendered
      .getAllByRole("button")
      .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
    act(() => {
      fireEvent.press(emptyCells[0]!);
    });
    const correctDigit = fresh.solution.charCodeAt(lastCell!.row * 9 + lastCell!.col) - 48;
    act(() => {
      fireEvent.press(rendered.getByLabelText(new RegExp(`enter digit ${correctDigit}`, "i")));
    });

    await waitFor(() => rendered.getByLabelText(/submit score/i));
    return rendered;
  }

  it("enqueues score and shows saved confirmation after submit", async () => {
    const { getByLabelText, findByText } = await renderIntoWinModal();

    act(() => {
      fireEvent.changeText(getByLabelText(/your name/i), "Alice");
    });
    await act(async () => {
      fireEvent.press(getByLabelText(/submit score/i));
    });
    await findByText(/saved/i);
    expect(scoreQueue.enqueue).toHaveBeenCalledWith(
      "sudoku",
      expect.objectContaining({ game_id: "game-123", player_name: "Alice" })
    );
  });

  it("enqueue failure shows retry control; second attempt succeeds", async () => {
    (scoreQueue.enqueue as jest.Mock)
      .mockRejectedValueOnce(new Error("storage full"))
      .mockResolvedValueOnce({ id: "q-2" });

    const { getByLabelText, findByLabelText, findByText } = await renderIntoWinModal();
    act(() => fireEvent.changeText(getByLabelText(/your name/i), "Bob"));
    await act(async () => {
      fireEvent.press(getByLabelText(/submit score/i));
    });

    const retry = await findByLabelText(/retry submit/i);
    await act(async () => {
      fireEvent.press(retry);
    });
    await findByText(/saved/i);
    expect(scoreQueue.enqueue).toHaveBeenCalledTimes(2);
  });
});
