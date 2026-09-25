/**
 * SudokuScreen — screen-level interaction, lifecycle, and leaderboard tests.
 *
 * #618 introduced the pre-game flow, input wiring, timer, and win modal.
 * #619 adds persistence via AsyncStorage, useGameSync instrumentation,
 * and the POST /sudoku/score call — this file covers the full surface.
 */

import React from "react";
import { render, fireEvent, act, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import SudokuScreen from "../SudokuScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { SudokuScoreboardProvider } from "../../game/sudoku/SudokuScoreboardContext";
import { enterDigit, loadPuzzle, selectCell } from "../../game/sudoku/engine";
import { saveGame, saveStats, EMPTY_SUDOKU_STATS } from "../../game/sudoku/storage";
import type { CellValue, SudokuState } from "../../game/sudoku/types";

const mockPopToTop = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: mockPopToTop,
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

jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));

jest.mock("../../game/_shared/scoreQueue", () => ({
  scoreQueue: {
    enqueue: jest.fn().mockResolvedValue({ id: "q-1" }),
    flush: jest.fn().mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0, remaining: 0 }),
    registerHandler: jest.fn(),
  },
}));
// Import after mocks so the test file gets the jest.fn() flavour.

import { scoreQueue } from "../../game/_shared/scoreQueue";
import { sudokuApi } from "../../game/sudoku/api";
import { flushQueuedGames } from "../../game/_shared/flushQueuedGames";
import { ApiError } from "../../game/_shared/httpClient";
import { resetDisplayNameCacheForTests, saveDisplayName } from "../../game/_shared/displayName";

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

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <SudokuScoreboardProvider>
        <SudokuScreen />
      </SudokuScoreboardProvider>
    </ThemeProvider>
  );
}

async function renderAndAwaitLoad() {
  const rendered = await renderScreen();
  // The pre-game card only mounts after loadGame() resolves.  Waiting
  // on the Start label gives us a deterministic post-load checkpoint.
  await waitFor(() => rendered.getByLabelText(/start/i));
  return rendered;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockPopToTop.mockClear();
  (sudokuApi.submitPlayerName as jest.Mock).mockReset();
  (sudokuApi.submitPlayerName as jest.Mock).mockImplementation((_id: string, name: string) =>
    Promise.resolve({ player_name: name, score: 100, rank: 3 })
  );
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

    const { queryByLabelText, getAllByRole } = await renderScreen();
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
  // These tests press a digit the number pad has left enabled (#2584). The
  // screen picks an Easy puzzle with Math.random and the pad disables a digit
  // once all nine are placed; 2 of the 1000 Easy puzzles give all nine 1s, so
  // a hardcoded "enter digit 1" was a disabled no-op there, no session ever
  // started, and the waitFor for it ran the test out — the "Exceeded timeout"
  // these tests threw in CI about once in every few hundred runs. Choosing an
  // enabled digit holds for any puzzle, however Start comes to pick it.
  async function startEasy() {
    const rendered = await renderAndAwaitLoad();
    await fireEvent.press(rendered.getByLabelText(/start/i));
    return rendered;
  }

  function enabledDigitButton(rendered: Awaited<ReturnType<typeof startEasy>>) {
    for (let d = 1; d <= 9; d++) {
      const button = rendered.getByLabelText(new RegExp(`enter digit ${d}`, "i"));
      if (!button.props.accessibilityState?.disabled) return button;
    }
    throw new Error("every digit on the number pad is disabled");
  }

  it("disables Undo until a move is made", async () => {
    const { getByLabelText } = await startEasy();
    expect(getByLabelText(/undo/i).props.accessibilityState?.disabled).toBe(true);
  });

  it("toggles notes mode via the header action", async () => {
    const { getAllByLabelText } = await startEasy();
    const toggles = getAllByLabelText(/pencil/i);
    expect(toggles[0]!.props.accessibilityState?.selected).toBe(false);
    await fireEvent.press(toggles[0]!);
    const after = getAllByLabelText(/pencil/i);
    expect(after[0]!.props.accessibilityState?.selected).toBe(true);
  });

  it("opens a useGameSync session on first digit placement", async () => {
    const rendered = await startEasy();
    const { getAllByRole } = rendered;
    const emptyCells = getAllByRole("button").filter((n) =>
      /empty/.test(String(n.props.accessibilityLabel ?? ""))
    );
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      await fireEvent.press(enabledDigitButton(rendered));
    });
    // ensureSyncStarted runs inside a setState updater; waitFor lets React 18
    // flush the batch before asserting.
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
    expect(mockStartGame.mock.calls[0]![0]).toBe("sudoku");
  });

  it("unmount after a digit abandons with a result block that satisfies SudokuResult, and no score (#2450)", async () => {
    const rendered = await startEasy();
    const { getAllByRole, unmount } = rendered;
    const emptyCells = getAllByRole("button").filter((n) =>
      /empty/.test(String(n.props.accessibilityLabel ?? ""))
    );
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      await fireEvent.press(enabledDigitButton(rendered));
    });
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
    mockCompleteGame.mockClear();
    await unmount();

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    // Backend SudokuResult requires both `won` and `errors` — a missing one is a 400
    // that the sync worker dead-letters.
    expect(summary["result"]).toEqual({ won: false, errors: expect.any(Number) });
    expect(summary).not.toHaveProperty("finalScore");
  });

  it("persists state after digit input", async () => {
    const rendered = await startEasy();
    const { getAllByRole } = rendered;
    const emptyCells = getAllByRole("button").filter((n) =>
      /empty/.test(String(n.props.accessibilityLabel ?? ""))
    );
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      await fireEvent.press(enabledDigitButton(rendered));
    });
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem("sudoku_game");
      expect(raw).not.toBeNull();
    });
  });
});

describe("SudokuScreen — result card (#2511)", () => {
  // Load an almost-complete save (one non-given cell remaining), then enter
  // the last correct digit so a sync session starts and the puzzle completes.
  async function solvePuzzle({ elapsedMs = 0 }: { elapsedMs?: number } = {}) {
    const fresh = loadPuzzle("easy", "classic", () => 0);

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

    // The clock is frozen from before mount until the win (#2584). The resumed
    // game's clock starts at mount, so jumping only the winning press forward
    // made the elapsed time `elapsedMs` *plus* however long the test really
    // took from mount to that press: under load that crossed a second and the
    // card read 01:06 instead of 01:05. (waitFor runs on setTimeout, not
    // Date.now, so a frozen clock doesn't stall it.)
    const mountedAt = Date.now();
    let now = mountedAt;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const rendered = await renderScreen();
      await waitFor(() => expect(rendered.queryByLabelText(/start/i)).toBeNull());

      const emptyCells = rendered
        .getAllByRole("button")
        .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
      await act(async () => {
        await fireEvent.press(emptyCells[0]!);
      });

      now = mountedAt + elapsedMs;
      const correctDigit = fresh.solution.charCodeAt(lastCell!.row * 9 + lastCell!.col) - 48;
      await act(async () => {
        await fireEvent.press(
          rendered.getByLabelText(new RegExp(`enter digit ${correctDigit}`, "i"))
        );
      });

      await waitFor(() => expect(rendered.getByTestId("sudoku-result-title")).toBeTruthy());
      return rendered;
    } finally {
      nowSpy.mockRestore();
    }
  }

  it("shows the shared win card with time, score and errors", async () => {
    const r = await solvePuzzle({ elapsedMs: 65_000 });
    const card = within(r.getByTestId("sudoku-result"));
    expect(card.getByTestId("sudoku-result-title")).toHaveTextContent("You Win!");
    expect(card.getByText("Sudoku · Easy")).toBeTruthy();
    expect(card.getByText("Classic 9×9")).toBeTruthy();
    expect(card.getByText("Time")).toBeTruthy();
    // Hero time, plus the Best stat — a first solve is its own best.
    expect(card.getAllByText("01:05")).toHaveLength(2);
    expect(card.getByText("Score")).toBeTruthy();
    expect(card.getByText("Errors")).toBeTruthy();
    expect(card.queryByText("New best")).toBeNull();
  });

  it("marks a New Best when the previous best time is beaten", async () => {
    await saveStats({
      ...EMPTY_SUDOKU_STATS,
      classic: {
        ...EMPTY_SUDOKU_STATS.classic,
        easy: { bestTimeS: 120, gamesSolved: 1 },
      },
    });
    const r = await solvePuzzle({ elapsedMs: 65_000 });
    const card = within(r.getByTestId("sudoku-result"));
    expect(card.getByText("New best")).toBeTruthy();
  });

  it("reports the real play time to game sync instead of 0", async () => {
    await solvePuzzle({ elapsedMs: 65_000 });
    const completed = mockCompleteGame.mock.calls.find(
      ([, summary]) => (summary as { outcome?: string }).outcome === "completed"
    );
    expect(completed).toBeTruthy();
    expect((completed![1] as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(65_000);
  });

  it("submits under the display name automatically and shows the rank", async () => {
    await saveDisplayName("Riley");
    const r = await solvePuzzle();
    await waitFor(() =>
      expect(sudokuApi.submitPlayerName).toHaveBeenCalledWith("game-123", "Riley")
    );
    // The completion is uploaded before the name is attached to it.
    expect(flushQueuedGames).toHaveBeenCalled();
    await r.findByText("Saved as Riley · #3 on the leaderboard");
    expect(r.queryByLabelText(/your name/i)).toBeNull();
  });

  it("asks for a display name once when none is set, then submits", async () => {
    const r = await solvePuzzle();
    const input = await r.findByLabelText("Pick a display name for leaderboards");
    expect(sudokuApi.submitPlayerName).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.changeText(input, "Alice");
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Save" }));
    });

    await waitFor(() =>
      expect(sudokuApi.submitPlayerName).toHaveBeenCalledWith("game-123", "Alice")
    );
    await r.findByText("Saved as Alice · #3 on the leaderboard");
  });

  it("queues the name when the server rejects it", async () => {
    await saveDisplayName("Riley");
    (sudokuApi.submitPlayerName as jest.Mock).mockRejectedValue(new ApiError("boom", 500));
    const r = await solvePuzzle();
    await r.findByText("Saved offline · syncs when you're back online");
    expect(scoreQueue.enqueue).toHaveBeenCalledWith("sudoku", {
      game_id: "game-123",
      player_name: "Riley",
    });
  });

  it("Change Difficulty returns to the picker", async () => {
    await saveDisplayName("Riley");
    const r = await solvePuzzle();
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Change Difficulty" }));
    });
    await waitFor(() => expect(r.getByRole("button", { name: /start/i })).toBeTruthy());
    expect(r.queryByTestId("sudoku-result-title")).toBeNull();
  });

  it("Play Again starts a new puzzle and closes the card", async () => {
    await saveDisplayName("Riley");
    const r = await solvePuzzle();
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    await waitFor(() => expect(r.queryByTestId("sudoku-result-title")).toBeNull());
    expect(r.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("Home returns to the lobby", async () => {
    await saveDisplayName("Riley");
    const r = await solvePuzzle();
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Home" }));
    });
    expect(mockPopToTop).toHaveBeenCalled();
  });
});
