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
import * as sudokuEngine from "../../game/sudoku/engine";
import { enterDigit, loadPuzzle, selectCell } from "../../game/sudoku/engine";
import { saveGame, saveStats, EMPTY_SUDOKU_STATS } from "../../game/sudoku/storage";
import type { CellValue, SudokuState } from "../../game/sudoku/types";

const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();
// Captured so tests can fire `beforeRemove` (back-navigation).
const mockNavListeners = new Map<string, Array<() => void>>();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: mockPopToTop,
    goBack: jest.fn(),
    navigate: mockNavigate,
    addListener: jest.fn((event: string, handler: () => void) => {
      mockNavListeners.set(event, [...(mockNavListeners.get(event) ?? []), handler]);
      return () => {
        mockNavListeners.set(
          event,
          (mockNavListeners.get(event) ?? []).filter((h) => h !== handler)
        );
      };
    }),
  }),
}));

const mockStartGame = jest.fn<string, [string, Record<string, unknown>, Record<string, unknown>]>();
const mockEnqueueEvent = jest.fn();
const mockCompleteGame = jest.fn();
const mockMarkStarted = jest.fn();
const mockDiscardGame = jest.fn();
const mockResumeGame = jest.fn<string | null, [string, Record<string, unknown> | undefined]>();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as unknown as jest.Mock)(...args),
    enqueueEvent: (...args: unknown[]) => (mockEnqueueEvent as unknown as jest.Mock)(...args),
    completeGame: (...args: unknown[]) => (mockCompleteGame as unknown as jest.Mock)(...args),
    markStarted: (...args: unknown[]) => (mockMarkStarted as unknown as jest.Mock)(...args),
    discardGame: (...args: unknown[]) => (mockDiscardGame as unknown as jest.Mock)(...args),
    resumeGame: (...args: unknown[]) => (mockResumeGame as unknown as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// The result card reads the synced game's rank (#2632, sessionBoardAdapter).
const mockGetGameRank = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetGameRank(gameId) },
}));
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn((name: string) => Promise.resolve({ display_name: name })) },
}));

// The hook's foreground clock (#2684) adds nothing, so the summaries below
// carry only what the screen sends: its own play timer.
jest.mock("../../game/_shared/foregroundClock", () => ({ foregroundNow: () => 0 }));
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
import { flushQueuedGames } from "../../game/_shared/flushQueuedGames";
import { ApiError } from "../../game/_shared/httpClient";
import { resetDisplayNameCacheForTests, saveDisplayName } from "../../game/_shared/displayName";
import { __setPremiumLevelsForTests } from "../../entitlements/premiumLevels";

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
  mockNavListeners.clear();
  mockGetGameRank.mockReset();
  mockGetGameRank.mockResolvedValue({ ranked: true, rank: 3, is_best: true, reason: null });
  mockStartGame.mockClear();
  mockStartGame.mockReturnValue("game-123");
  mockCompleteGame.mockClear();
  mockMarkStarted.mockReset();
  mockDiscardGame.mockReset();
  mockResumeGame.mockReset();
  mockResumeGame.mockReturnValue(null);
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

  it("opens on the difficulty of the last puzzle (#1129)", async () => {
    await AsyncStorage.setItem("sudoku.difficulty", "hard");
    const { getByTestId } = await renderAndAwaitLoad();
    await waitFor(() =>
      expect(getByTestId("sudoku-difficulty-hard").props.accessibilityState.checked).toBe(true)
    );
  });

  it("remembers the difficulty a puzzle starts at (#1129)", async () => {
    const { getByTestId } = await renderAndAwaitLoad();
    await fireEvent.press(getByTestId("sudoku-difficulty-medium"));
    expect(await AsyncStorage.getItem("sudoku.difficulty")).toBeNull();
    await fireEvent.press(getByTestId("sudoku-pregame-start"));
    expect(await AsyncStorage.getItem("sudoku.difficulty")).toBe("medium");
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

  it("plays on at a level that became premium, but the next puzzle starts at Easy (#1129)", async () => {
    await saveGame(loadPuzzle("hard", "classic", () => 0));
    __setPremiumLevelsForTests({ sudoku: ["hard"] });
    try {
      const rendered = await renderScreen();
      await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
      expect(rendered.getByText("Hard")).toBeTruthy(); // the resumed puzzle's HUD

      await act(async () => {
        await fireEvent.press(rendered.getByLabelText("More options"));
      });
      await act(async () => {
        await fireEvent.press(rendered.getByText("New Game"));
      });
      await act(async () => {
        await fireEvent.press(rendered.getByLabelText("Start New")); // confirm the abandon dialog
      });
      await act(async () => {
        await fireEvent.press(rendered.getByText("Quick Restart"));
      });
      await waitFor(() => expect(rendered.getByText("Easy")).toBeTruthy());
      expect(rendered.queryByText("Hard")).toBeNull();
      expect(await AsyncStorage.getItem("sudoku.difficulty")).toBe("easy");
    } finally {
      __setPremiumLevelsForTests(null);
    }
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
    let now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await act(async () => {
        await fireEvent.press(enabledDigitButton(rendered)); // the puzzle's timer starts
      });
      await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
      mockCompleteGame.mockClear();
      now += 45_000;
      await unmount();
    } finally {
      nowSpy.mockRestore();
    }

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    // Backend SudokuResult requires both `won` and `errors` — a missing one is a 400
    // that the sync worker dead-letters.
    expect(summary["result"]).toEqual({ won: false, errors: expect.any(Number) });
    expect(summary).not.toHaveProperty("finalScore");
    // #2684: the puzzle's own play timer, not the hook's foreground clock.
    expect(summary["durationMs"]).toBe(45_000);
  });

  // #2632: no screen-level beforeRemove abandon. It sent the full completion
  // formula as finalScore; back-navigation now unmounts and the hook abandons
  // with no score (the test above).
  it("does not complete the session on beforeRemove", async () => {
    const { getAllByRole, getByLabelText } = await startEasy();
    const emptyCells = getAllByRole("button").filter((n) =>
      /empty/.test(String(n.props.accessibilityLabel ?? ""))
    );
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      await fireEvent.press(getByLabelText(/enter digit 1/i));
    });
    await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
    mockCompleteGame.mockClear();

    expect(mockNavListeners.get("beforeRemove") ?? []).toHaveLength(0);
    await act(async () => {
      mockNavListeners.get("beforeRemove")?.forEach((h) => h());
    });
    expect(mockCompleteGame).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// #2690 — a new puzzle never completes on the old puzzle's session
// ---------------------------------------------------------------------------

describe("SudokuScreen — sessions across puzzles (#2690)", () => {
  /** A classic puzzle of `difficulty` with one cell left, and that cell's digit. */
  function almostSolved(difficulty: "easy" | "hard") {
    const fresh = loadPuzzle(difficulty, "classic", () => 0);
    let last: { row: number; col: number } | null = null;
    for (let i = 0; i < 81 && last === null; i++) {
      if (!fresh.grid[Math.floor(i / 9)]![i % 9]!.given)
        last = { row: Math.floor(i / 9), col: i % 9 };
    }
    const state = fillAllExcept(fresh, last!);
    const digit = fresh.solution.charCodeAt(last!.row * 9 + last!.col) - 48;
    return { state, digit };
  }

  async function enterFirstEnabledDigit(r: Awaited<ReturnType<typeof renderScreen>>) {
    const emptyCells = r
      .getAllByRole("button")
      .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    for (let d = 1; d <= 9; d++) {
      const button = r.getByLabelText(new RegExp(`enter digit ${d}`, "i"));
      if (!button.props.accessibilityState?.disabled) {
        await act(async () => {
          await fireEvent.press(button);
        });
        return;
      }
    }
    throw new Error("every digit on the number pad is disabled");
  }

  async function openNewGameModal(r: Awaited<ReturnType<typeof renderScreen>>) {
    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText("Start New"));
    });
  }

  let loadSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    let n = 0;
    mockStartGame.mockImplementation(() => `game-${++n}`);
  });

  afterEach(() => {
    loadSpy?.mockRestore();
    loadSpy = null;
  });

  it("New Game on Hard abandons the Easy session; the win completes a new one with difficulty hard", async () => {
    const hard = almostSolved("hard"); // built before the spy replaces loadPuzzle
    const r = await renderAndAwaitLoad();
    await fireEvent.press(r.getByLabelText(/start/i)); // Easy: game-1
    let now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await enterFirstEnabledDigit(r);
      await waitFor(() => expect(mockMarkStarted).toHaveBeenCalledWith("game-1"));
      now += 20_000;

      await openNewGameModal(r);
      await act(async () => {
        await fireEvent.press(r.getByRole("radio", { name: /hard/i }));
      });
      loadSpy = jest.spyOn(sudokuEngine, "loadPuzzle").mockReturnValue(hard.state);
      await act(async () => {
        await fireEvent.press(r.getByText("Start"));
      });
    } finally {
      nowSpy.mockRestore();
    }

    // The Easy puzzle's session is closed with its own progress and play
    // time, and no score.
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![0]).toBe("game-1");
    expect(mockCompleteGame.mock.calls[0]![1]).toEqual({
      outcome: "abandoned",
      result: { won: false, errors: expect.any(Number) },
      durationMs: 20_000,
    });
    expect(mockStartGame.mock.calls[1]![1]).toEqual({ difficulty: "hard", variant: "classic" });

    // Solve the Hard puzzle: it completes on its own session.
    const emptyCells = r
      .getAllByRole("button")
      .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText(new RegExp(`enter digit ${hard.digit}`, "i")));
    });
    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(2));
    const [gameId, summary, payload] = mockCompleteGame.mock.calls[1]!;
    expect(gameId).toBe("game-2");
    expect(summary).toEqual(expect.objectContaining({ outcome: "completed", finalScore: 300 }));
    expect(payload).toEqual(expect.objectContaining({ difficulty: "hard" }));
  });

  it("New Game before any digit discards the untouched session", async () => {
    const r = await renderAndAwaitLoad();
    await fireEvent.press(r.getByLabelText(/start/i)); // game-1, untouched
    await openNewGameModal(r);
    await act(async () => {
      await fireEvent.press(r.getByText("Quick Restart"));
    });
    expect(mockDiscardGame).toHaveBeenCalledWith("game-1");
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(mockStartGame).toHaveBeenCalledTimes(2);
  });

  it("Change Difficulty after a win, then Start on Hard, opens a Hard session", async () => {
    const easy = almostSolved("easy");
    const hard = almostSolved("hard");
    await saveGame(easy.state);
    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    const emptyCells = r
      .getAllByRole("button")
      .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText(new RegExp(`enter digit ${easy.digit}`, "i")));
    });
    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(1)); // game-1 won
    expect(mockStartGame).toHaveBeenCalledTimes(1);

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Change Difficulty" }));
    });
    // The pre-picker close opens nothing (and the won session is already
    // complete, so there is nothing to abandon or discard).
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockDiscardGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    await act(async () => {
      await fireEvent.press(r.getByRole("radio", { name: /hard/i }));
    });
    loadSpy = jest.spyOn(sudokuEngine, "loadPuzzle").mockReturnValue(hard.state);
    await act(async () => {
      await fireEvent.press(r.getByLabelText(/^start$/i));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(2);
    expect(mockStartGame.mock.calls[1]![1]).toEqual({ difficulty: "hard", variant: "classic" });
    expect(mockDiscardGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
  });

  // Resume scoping: a restore adopts only a killed session of the same settings.
  it("a restored puzzle resumes only a session with its own difficulty and variant", async () => {
    const hard = almostSolved("hard");
    mockResumeGame.mockImplementation((_type, match) =>
      match?.["difficulty"] === "easy" ? "orphan-easy" : null
    );
    await saveGame(hard.state);
    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    expect(mockResumeGame).toHaveBeenCalledWith("sudoku", {
      difficulty: "hard",
      variant: "classic",
    });

    const emptyCells = r
      .getAllByRole("button")
      .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText(new RegExp(`enter digit ${hard.digit}`, "i")));
    });
    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(1));
    // The Easy session was not adopted: the win opened its own Hard one.
    expect(mockCompleteGame.mock.calls[0]![0]).toBe("game-1");
    expect(mockStartGame.mock.calls[0]![1]).toEqual({ difficulty: "hard", variant: "classic" });
  });

  it("a restored puzzle continues a killed session with the same settings", async () => {
    const hard = almostSolved("hard");
    mockResumeGame.mockImplementation((_type, match) =>
      match?.["difficulty"] === "hard" && match?.["variant"] === "classic" ? "orphan-hard" : null
    );
    await saveGame(hard.state);
    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    const emptyCells = r
      .getAllByRole("button")
      .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText(new RegExp(`enter digit ${hard.digit}`, "i")));
    });
    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(1));
    expect(mockCompleteGame.mock.calls[0]![0]).toBe("orphan-hard");
    expect(mockStartGame).not.toHaveBeenCalled();
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

  // #2632: the card reads the synced game's rank (GET /games/{id}/rank)
  // instead of PATCH /sudoku/score/{id}.
  it("shows the synced game's rank under the display name automatically", async () => {
    await saveDisplayName("Riley");
    const r = await solvePuzzle();
    await waitFor(() => expect(mockGetGameRank).toHaveBeenCalledWith("game-123"));
    // The completion is uploaded before its rank is read.
    expect(flushQueuedGames).toHaveBeenCalled();
    await r.findByText("Saved as Riley · #3 on the leaderboard");
    expect(r.queryByLabelText(/your name/i)).toBeNull();
    expect(scoreQueue.enqueue).not.toHaveBeenCalled();
  });

  it("asks for a display name once when none is set, then shows the rank", async () => {
    const r = await solvePuzzle();
    const input = await r.findByLabelText("Pick a display name for leaderboards");
    expect(mockGetGameRank).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.changeText(input, "Alice");
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => expect(mockGetGameRank).toHaveBeenCalledWith("game-123"));
    await r.findByText("Saved as Alice · #3 on the leaderboard");
  });

  it("offers a retry when the rank lookup fails, and queues nothing", async () => {
    await saveDisplayName("Riley");
    mockGetGameRank.mockRejectedValue(new ApiError("boom", 500));
    const r = await solvePuzzle();
    await r.findByText("Couldn't save your score.");
    expect(scoreQueue.enqueue).not.toHaveBeenCalled();

    mockGetGameRank.mockResolvedValue({ ranked: true, rank: 3, is_best: true, reason: null });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Retry" }));
    });
    await r.findByText("Saved as Riley · #3 on the leaderboard");
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

describe("SudokuScreen — leaderboard (#2633)", () => {
  it("the ⋯ menu's Leaderboard item opens the board of the puzzle on screen", async () => {
    await saveGame(loadPuzzle("hard", "mini", () => 0));
    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    mockNavigate.mockClear();
    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("Leaderboard"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("Leaderboard", {
      gameType: "sudoku",
      partition: { difficulty: "hard", variant: "mini" },
    });
  });
});
