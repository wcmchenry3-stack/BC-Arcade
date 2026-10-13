/**
 * SudokuScreen — screen-level interaction, lifecycle, and leaderboard tests.
 *
 * #618 introduced the pre-game flow, input wiring, timer, and win modal.
 * #619 adds persistence via AsyncStorage and useGameSync instrumentation;
 * since #2632 the card reads the synced game's rank — this file covers the
 * full surface.
 */

import React from "react";
import { render, fireEvent, act, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Animated, AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import SudokuScreen from "../SudokuScreen";
import { dark as darkColors, ThemeProvider } from "../../theme/ThemeContext";
import * as sudokuEngine from "../../game/sudoku/engine";
import { enterDigit, loadPuzzle, selectCell } from "../../game/sudoku/engine";
import { saveGame, saveStats, EMPTY_SUDOKU_STATS } from "../../game/sudoku/storage";
import type { CellValue, SudokuState } from "../../game/sudoku/types";

const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();
// Captured so tests can fire `beforeRemove` (back-navigation).
const mockNavListeners = new Map<string, Array<() => void>>();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
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
  }))
);

const mockStartGame = jest.fn<string, [string, Record<string, unknown>, Record<string, unknown>]>();
const mockEnqueueEvent = jest.fn();
const mockCompleteGame = jest.fn();
const mockMarkStarted = jest.fn();
const mockDiscardGame = jest.fn();
const mockResumeGame = jest.fn<string | null, [string, Record<string, unknown> | undefined]>();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvent: lazy(() => mockEnqueueEvent),
    completeGame: lazy(() => mockCompleteGame),
    markStarted: lazy(() => mockMarkStarted),
    discardGame: lazy(() => mockDiscardGame),
    resumeGame: lazy(() => mockResumeGame),
  });
});

// The result card reads the synced game's rank (#2632, lookupGameRank).
const mockGetGameRank = jest.fn();
jest.mock("../../api/stats", () =>
  mockScreenDeps().mockStatsApi({ getGameRank: (gameId: string) => mockGetGameRank(gameId) })
);
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn(() => Promise.resolve({ display_name: "Brave Otter 4821" })) },
}));

// The hook's foreground clock (#2684) is held still by the shared mock
// jest.setup.ts pins (#2710), so the summaries below carry only what the
// screen sends: its own play timer.
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

// Counts the grid's renders (#2964): the real grid, behind a counting wrapper.
let mockGridRenders = 0;
jest.mock("../../components/sudoku/SudokuGrid", () => {
  const actual = jest.requireActual("../../components/sudoku/SudokuGrid");
  const ReactActual = jest.requireActual("react");
  return {
    __esModule: true,
    default: (props: unknown) => {
      mockGridRenders += 1;
      return ReactActual.createElement(actual.default, props);
    },
  };
});

// Import after mocks so the test file gets the jest.fn() flavour.

import { flushQueuedGames } from "../../game/_shared/flushQueuedGames";
import { ApiError } from "../../game/_shared/httpClient";
import {
  resetDisplayNameCacheForTests,
  storeAssignedDisplayName,
} from "../../game/_shared/displayName";
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
      <SudokuScreen />
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
    // The clock starts at the cell selection (#2942), so freeze Date.now first.
    let now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await act(async () => {
        await fireEvent.press(emptyCells[0]!);
      });
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

  // #2735: ⋯ → Stats/Leaderboard/Scoreboard covers the puzzle; its clock
  // must not run meanwhile.
  it("stops the play clock while another screen covers the puzzle", async () => {
    const rendered = await startEasy();
    const { getAllByRole, unmount } = rendered;
    const emptyCells = getAllByRole("button").filter((n) =>
      /empty/.test(String(n.props.accessibilityLabel ?? ""))
    );
    // The clock starts at the cell selection (#2942), so freeze Date.now first.
    let now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await act(async () => {
        await fireEvent.press(emptyCells[0]!);
      });
      await act(async () => {
        await fireEvent.press(enabledDigitButton(rendered)); // the puzzle's timer starts
      });
      await waitFor(() => expect(mockStartGame).toHaveBeenCalledTimes(1));
      mockCompleteGame.mockClear();

      await act(async () => {
        mockNavListeners.get("blur")?.forEach((h) => h());
      });
      now += 10 * 60_000; // ten minutes reading Stats
      await act(async () => {
        mockNavListeners.get("focus")?.forEach((h) => h());
      });
      now += 5_000; // five more seconds of play
      await unmount();
    } finally {
      nowSpy.mockRestore();
    }

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    expect(summary["durationMs"]).toBe(5_000);
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
        easy: { bestTimeS: 120 },
      },
    });
    const r = await solvePuzzle({ elapsedMs: 65_000 });
    const card = within(r.getByTestId("sudoku-result"));
    expect(card.getByText("New best")).toBeTruthy();
  });

  // #2636: the device keeps only each puzzle kind's best time, for the card.
  it("caches a better time as the best, without the old counters", async () => {
    await AsyncStorage.setItem(
      "sudoku_stats_v1",
      JSON.stringify({ classic: { easy: { bestTimeS: 120, gamesSolved: 4 } } })
    );
    await solvePuzzle({ elapsedMs: 65_000 });
    await waitFor(async () => {
      const stored = JSON.parse((await AsyncStorage.getItem("sudoku_stats_v1")) ?? "{}");
      expect(stored.classic.easy).toEqual({ bestTimeS: 65 });
    });
  });

  it("writes nothing when the solve is slower than the best", async () => {
    // An older build's record, counters and all: it must be left as it is.
    const stored = JSON.stringify({ classic: { easy: { bestTimeS: 30, gamesSolved: 4 } } });
    await AsyncStorage.setItem("sudoku_stats_v1", stored);
    const r = await solvePuzzle({ elapsedMs: 65_000 });
    const card = within(r.getByTestId("sudoku-result"));
    expect(card.queryByText("New best")).toBeNull();
    expect(card.getByText("00:30")).toBeTruthy(); // the best, read from the old record
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(await AsyncStorage.getItem("sudoku_stats_v1")).toBe(stored);
  });

  it("reports the real play time to game sync instead of 0", async () => {
    await solvePuzzle({ elapsedMs: 65_000 });
    const completed = mockCompleteGame.mock.calls.find(
      ([, summary]) => (summary as { outcome?: string }).outcome === "completed"
    );
    expect(completed).toBeTruthy();
    expect((completed![1] as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(65_000);
  });

  it("records no time, no new best and keeps the real best when the device clock steps back (#2964)", async () => {
    const stored = JSON.stringify({ classic: { easy: { bestTimeS: 30, gamesSolved: 4 } } });
    await AsyncStorage.setItem("sudoku_stats_v1", stored);
    const r = await solvePuzzle({ elapsedMs: -5_000 });
    const card = within(r.getByTestId("sudoku-result"));
    // The card shows no time, no "New best", and the real best it already had.
    expect(card.queryByText("Time")).toBeNull();
    expect(card.queryByText("New best")).toBeNull();
    expect(card.getByText("00:30")).toBeTruthy();
    // The game reports no duration of its own (never a negative one), so sync
    // falls back to its foreground window.
    const completed = mockCompleteGame.mock.calls.find(
      ([, summary]) => (summary as { outcome?: string }).outcome === "completed"
    );
    expect(completed).toBeDefined();
    expect((completed![1] as { durationMs?: number }).durationMs ?? null).toBeNull();
    // The cached best is untouched: it is not replaced by 0, the "no best" mark.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(await AsyncStorage.getItem("sudoku_stats_v1")).toBe(stored);
  });

  // #2632: the card reads the synced game's rank (GET /games/{id}/rank)
  // instead of PATCH /sudoku/score/{id}.
  it("shows the synced game's rank under the display name automatically", async () => {
    await storeAssignedDisplayName("Riley");
    const r = await solvePuzzle();
    await waitFor(() => expect(mockGetGameRank).toHaveBeenCalledWith("game-123"));
    // The completion is uploaded before its rank is read.
    expect(flushQueuedGames).toHaveBeenCalled();
    await r.findByText("Saved as Riley · #3 on the leaderboard");
    expect(r.queryByLabelText(/your name/i)).toBeNull();
  });

  it("asks the player to join once when not on the boards, then shows the rank", async () => {
    const r = await solvePuzzle();
    const join = await r.findByRole("button", { name: "Join leaderboards" });
    expect(mockGetGameRank).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.press(join);
    });

    await waitFor(() => expect(mockGetGameRank).toHaveBeenCalledWith("game-123"));
    await r.findByText("Saved as Brave Otter 4821 · #3 on the leaderboard");
  });

  it("offers a retry when the rank lookup fails, and queues nothing", async () => {
    await storeAssignedDisplayName("Riley");
    mockGetGameRank.mockRejectedValue(new ApiError("boom", 500));
    const r = await solvePuzzle();
    await r.findByText("Couldn't save your score.");

    mockGetGameRank.mockResolvedValue({ ranked: true, rank: 3, is_best: true, reason: null });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Retry" }));
    });
    await r.findByText("Saved as Riley · #3 on the leaderboard");
  });

  it("Change Difficulty returns to the picker", async () => {
    await storeAssignedDisplayName("Riley");
    const r = await solvePuzzle();
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Change Difficulty" }));
    });
    await waitFor(() => expect(r.getByRole("button", { name: /start/i })).toBeTruthy());
    expect(r.queryByTestId("sudoku-result-title")).toBeNull();
  });

  it("Play Again starts a new puzzle and closes the card", async () => {
    await storeAssignedDisplayName("Riley");
    const r = await solvePuzzle();
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    await waitFor(() => expect(r.queryByTestId("sudoku-result-title")).toBeNull());
    expect(r.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("Home returns to the lobby", async () => {
    await storeAssignedDisplayName("Riley");
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

describe("SudokuScreen — stats (#2635)", () => {
  it("the ⋯ menu's Stats item opens Sudoku's stats", async () => {
    await saveGame(loadPuzzle("hard", "mini", () => 0));
    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    mockNavigate.mockClear();
    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("Stats"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("GameStats", { gameType: "sudoku" });
  });

  it("the ⋯ menu has no Scorecard: Stats replaced the old Scoreboard (#2636)", async () => {
    await saveGame(loadPuzzle("hard", "mini", () => 0));
    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    expect(r.getByText("Stats")).toBeTruthy();
    expect(r.queryByText(/Scoreboard|Scorecard/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #2750 review: a saved puzzle that loads while the app isn't active
// ---------------------------------------------------------------------------

describe("SudokuScreen — load while away (#2750)", () => {
  it("a puzzle loaded while the app is in the background stays paused until it returns", async () => {
    const fresh = loadPuzzle("easy", "classic", () => 0);
    let skip = { row: 0, col: 0 };
    outer: for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (!fresh.grid[r]![c]!.given) {
          skip = { row: r, col: c };
          break outer;
        }
      }
    }
    await saveGame(fillAllExcept(fresh, skip)); // under way: its timer runs on load
    mockResumeGame.mockReturnValue("orphan-easy");

    const original = Object.getOwnPropertyDescriptor(AppState, "currentState");
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
    const appStateSpy = jest.spyOn(AppState, "addEventListener");
    const appStateBase = appStateSpy.mock.calls.length;
    let now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const r = await renderScreen();
      await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
      now += 60 * 60_000; // an hour before the player opens the app
      await act(async () => {
        for (const [type, listener] of appStateSpy.mock.calls.slice(appStateBase)) {
          if (type === "change") (listener as (s: AppStateStatus) => void)("active");
        }
      });
      now += 5_000;
      await r.unmount();
    } finally {
      nowSpy.mockRestore();
      appStateSpy.mockRestore();
      if (original) Object.defineProperty(AppState, "currentState", original);
      else delete (AppState as { currentState?: unknown }).currentState;
    }

    const abandon = mockCompleteGame.mock.calls.at(-1)!;
    expect(abandon[0]).toBe("orphan-easy");
    expect((abandon[1] as Record<string, unknown>)["durationMs"]).toBe(5_000);
  });
});

describe("SudokuScreen — HUD clock (#2964)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("advances the clock every second without re-rendering the grid", async () => {
    jest.useFakeTimers();
    const fresh = loadPuzzle("easy", "classic", () => 0);
    const open = fresh.grid
      .flatMap((cells, row) => cells.map((cell, col) => ({ cell, row, col })))
      .find(({ cell }) => !cell.given)!;
    await saveGame(fillAllExcept(fresh, open)); // under way: its clock runs on load

    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    expect(r.getByLabelText("Elapsed time 00:00")).toBeTruthy();

    const rendersBeforeTicks = mockGridRenders;
    expect(rendersBeforeTicks).toBeGreaterThan(0);
    for (let second = 1; second <= 5; second++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(r.getByLabelText(`Elapsed time 00:0${second}`)).toBeTruthy();
    }
    expect(mockGridRenders).toBe(rendersBeforeTicks);
  });

  it("holds the clock while paused and resumes on the clock's own second", async () => {
    jest.useFakeTimers();
    const fresh = loadPuzzle("easy", "classic", () => 0);
    const open = fresh.grid
      .flatMap((cells, row) => cells.map((cell, col) => ({ cell, row, col })))
      .find(({ cell }) => !cell.given)!;
    await saveGame(fillAllExcept(fresh, open));

    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();

    const rendersBeforePause = mockGridRenders;

    // Another screen covers the puzzle for five seconds: the HUD does not move.
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();

    // Back again: the paused five seconds stay out, and the next second lands
    // exactly one second after the resume.
    await act(async () => {
      mockNavListeners.get("focus")?.forEach((h) => h());
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(r.getByLabelText("Elapsed time 00:03")).toBeTruthy();
    // Pausing and resuming never re-rendered the grid.
    expect(mockGridRenders).toBe(rendersBeforePause);
  });

  async function startAndGetEmptyCells(r: Awaited<ReturnType<typeof renderAndAwaitLoad>>) {
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: /start/i }));
    });
    return r
      .getAllByRole("button")
      .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
  }

  it("holds the clock at 0:00 before any interaction, however long the player waits (#2942)", async () => {
    jest.useFakeTimers();
    const r = await renderAndAwaitLoad();
    await startAndGetEmptyCells(r);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(r.getByLabelText("Elapsed time 00:00")).toBeTruthy();
  });

  it("starts the clock on the first cell selection, before any digit (#2942)", async () => {
    jest.useFakeTimers();
    const r = await renderAndAwaitLoad();
    const emptyCells = await startAndGetEmptyCells(r);
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(r.getByLabelText("Elapsed time 00:00")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(r.getByLabelText("Elapsed time 00:01")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(r.getByLabelText("Elapsed time 00:03")).toBeTruthy();
  });

  it("a digit after the selection does not restart the clock (#2942)", async () => {
    jest.useFakeTimers();
    const r = await renderAndAwaitLoad();
    const emptyCells = await startAndGetEmptyCells(r);
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    const digit = r
      .getAllByLabelText(/enter digit \d/i)
      .find((b) => !b.props.accessibilityState?.disabled)!;
    await act(async () => {
      await fireEvent.press(digit);
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();
  });

  it("holds a selection-started clock while away and resumes it on return (#2942)", async () => {
    jest.useFakeTimers();
    const r = await renderAndAwaitLoad();
    const emptyCells = await startAndGetEmptyCells(r);
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();
    await act(async () => {
      mockNavListeners.get("focus")?.forEach((h) => h());
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(r.getByLabelText("Elapsed time 00:03")).toBeTruthy();
  });

  it("selecting a cell alone starts no sync session and abandons nothing on leave (#2942)", async () => {
    const r = await renderAndAwaitLoad();
    const emptyCells = await startAndGetEmptyCells(r);
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    expect(mockMarkStarted).not.toHaveBeenCalled();
    mockCompleteGame.mockClear();
    await r.unmount();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("a number pad press with no cell selected starts the clock but no session (#2942)", async () => {
    jest.useFakeTimers();
    const r = await renderAndAwaitLoad();
    await startAndGetEmptyCells(r);
    const digit = r
      .getAllByLabelText(/enter digit \d/i)
      .find((b) => !b.props.accessibilityState?.disabled)!;
    await act(async () => {
      await fireEvent.press(digit);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();
    expect(mockMarkStarted).not.toHaveBeenCalled();
  });

  it("a hint pressed first, from a restored select-only save, starts the clock and the session (#2942)", async () => {
    jest.useFakeTimers();
    const fresh = loadPuzzle("easy", "classic", () => 0);
    const open = fresh.grid
      .flatMap((cells, row) => cells.map((cell, col) => ({ cell, row, col })))
      .find(({ cell }) => !cell.given)!;
    await saveGame(selectCell(fresh, open.row, open.col));

    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(r.getByLabelText("Elapsed time 00:00")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(r.getByLabelText("Hint"));
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(r.getByLabelText("Elapsed time 00:01")).toBeTruthy();
    expect(mockMarkStarted).toHaveBeenCalledTimes(1);
  });

  it("a hint pressed with no cell selected starts the clock but no session (#2942)", async () => {
    jest.useFakeTimers();
    const r = await renderAndAwaitLoad();
    await startAndGetEmptyCells(r);
    await act(async () => {
      await fireEvent.press(r.getByLabelText("Hint"));
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(r.getByLabelText("Elapsed time 00:02")).toBeTruthy();
    expect(mockMarkStarted).not.toHaveBeenCalled();
  });

  it("a restored save with a selection but no moves does not run the clock until the first digit (#2942)", async () => {
    jest.useFakeTimers();
    const fresh = loadPuzzle("easy", "classic", () => 0);
    const open = fresh.grid
      .flatMap((cells, row) => cells.map((cell, col) => ({ cell, row, col })))
      .find(({ cell }) => !cell.given)!;
    await saveGame(selectCell(fresh, open.row, open.col));

    const r = await renderScreen();
    await waitFor(() => expect(r.queryByLabelText(/^start$/i)).toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(r.getByLabelText("Elapsed time 00:00")).toBeTruthy();

    const digit = r
      .getAllByLabelText(/enter digit \d/i)
      .find((b) => !b.props.accessibilityState?.disabled)!;
    await act(async () => {
      await fireEvent.press(digit);
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(r.getByLabelText("Elapsed time 00:01")).toBeTruthy();
  });

  it("a first cell press while away starts the clock paused; it advances only after return (#2942)", async () => {
    jest.useFakeTimers();
    const r = await renderAndAwaitLoad();
    const emptyCells = await startAndGetEmptyCells(r);
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(r.getByLabelText("Elapsed time 00:00")).toBeTruthy();
    await act(async () => {
      mockNavListeners.get("focus")?.forEach((h) => h());
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(r.getByLabelText("Elapsed time 00:01")).toBeTruthy();
  });

  it("New Game after a select-only start resets the HUD to 00:00 until the next interaction (#2942)", async () => {
    jest.useFakeTimers();
    const r = await renderAndAwaitLoad();
    const emptyCells = await startAndGetEmptyCells(r);
    await act(async () => {
      await fireEvent.press(emptyCells[0]!);
    });
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(r.getByLabelText("Elapsed time 00:03")).toBeTruthy();

    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText("Start New"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("Quick Restart"));
    });
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(r.getByLabelText("Elapsed time 00:00")).toBeTruthy();

    const fresh = r
      .getAllByRole("button")
      .filter((n) => /empty/.test(String(n.props.accessibilityLabel ?? "")));
    await act(async () => {
      await fireEvent.press(fresh[0]!);
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(r.getByLabelText("Elapsed time 00:01")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// #2943 — only rule conflicts are errors; "Show mistakes"; full-but-wrong grid
// ---------------------------------------------------------------------------

describe("SudokuScreen — illegal vs incorrect digits (#2943)", () => {
  const SHOW_MISTAKES_KEY = "sudoku_show_mistakes";

  /** An empty cell of `difficulty`'s first puzzle, with a legal-wrong and an illegal digit for it. */
  function scenario(difficulty: "easy" | "medium" | "hard") {
    const base = loadPuzzle(difficulty, "classic", () => 0);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (base.grid[r]![c]!.given) continue;
        const correct = base.solution.charCodeAt(r * 9 + c) - 48;
        let legalWrong = 0;
        let illegal = 0;
        for (let d = 1; d <= 9; d++) {
          if (d === correct) continue;
          const conflicts = sudokuEngine.getConflicts(base.grid, r, c, d).length;
          if (conflicts === 0 && legalWrong === 0) legalWrong = d;
          if (conflicts > 0 && illegal === 0) illegal = d;
        }
        if (legalWrong !== 0 && illegal !== 0) {
          // A cell in another row and column, pressed to deselect this one.
          const other = r === 0 ? 1 : 0;
          return { state: selectCell(base, r, c), row: r, col: c, legalWrong, illegal, other };
        }
      }
    }
    throw new Error("no suitable cell");
  }

  const cellLabel = (r: number, c: number) => new RegExp(`^Cell row ${r + 1}, column ${c + 1},`);

  async function resume(state: SudokuState) {
    await saveGame(state);
    const rendered = await renderScreen();
    await waitFor(() => expect(rendered.queryByLabelText(/^start$/i)).toBeNull());
    return rendered;
  }

  async function play(rendered: Awaited<ReturnType<typeof resume>>, digit: number, other: number) {
    await act(async () => {
      await fireEvent.press(rendered.getByLabelText(new RegExp(`enter digit ${digit}`, "i")));
    });
    // Deselect the cell: a selected cell uses the on-accent colours.
    await act(async () => {
      await fireEvent.press(rendered.getByLabelText(cellLabel(other, 8)));
    });
  }

  /** Opens the ⋯ menu and returns the Show mistakes item. */
  async function showMistakesItem(rendered: Awaited<ReturnType<typeof resume>>) {
    if (!rendered.queryByTestId("sudoku-show-mistakes")) {
      await act(async () => {
        await fireEvent.press(rendered.getByLabelText("More options"));
      });
    }
    return rendered.getByTestId("sudoku-show-mistakes");
  }
  const isChecked = (item: { props: { accessibilityState?: { checked?: boolean } } }) =>
    item.props.accessibilityState?.checked;

  let timing: jest.SpyInstance;
  beforeEach(() => {
    timing = jest.spyOn(Animated, "timing");
  });
  afterEach(() => {
    timing.mockRestore();
  });
  const errorFlashes = () => timing.mock.calls.filter(([, cfg]) => cfg.toValue === 0.3).length;

  it("a legal but wrong digit: no flash, no error count, no colour (Show mistakes off)", async () => {
    const s = scenario("medium");
    const r = await resume(s.state);
    await play(r, s.legalWrong, s.other);
    expect(errorFlashes()).toBe(0);
    expect(r.getByText("0 errors")).toBeTruthy();
    expect(
      within(r.getByLabelText(cellLabel(s.row, s.col))).getByText(String(s.legalWrong))
    ).toHaveStyle({ color: darkColors.accent });
  });

  it("an illegal digit: flashes, counts the error and is always coloured", async () => {
    const s = scenario("medium");
    const r = await resume(s.state);
    await play(r, s.illegal, s.other);
    expect(errorFlashes()).toBe(1);
    expect(r.getByText("1 error")).toBeTruthy();
    expect(
      within(r.getByLabelText(cellLabel(s.row, s.col))).getByText(String(s.illegal))
    ).toHaveStyle({ color: darkColors.error });
  });

  it("Show mistakes defaults to on for easy and off for medium and hard", async () => {
    for (const [difficulty, expected] of [
      ["easy", true],
      ["medium", false],
      ["hard", false],
    ] as const) {
      const r = await resume(scenario(difficulty).state);
      expect(isChecked(await showMistakesItem(r))).toBe(expected);
      await r.unmount();
    }
  });

  it("colours a legal but wrong digit when Show mistakes is on, with no flash and no count", async () => {
    const s = scenario("easy");
    const r = await resume(s.state);
    await play(r, s.legalWrong, s.other);
    expect(
      within(r.getByLabelText(cellLabel(s.row, s.col))).getByText(String(s.legalWrong))
    ).toHaveStyle({ color: darkColors.error });
    expect(errorFlashes()).toBe(0);
    expect(r.getByText("0 errors")).toBeTruthy();
  });

  it("the menu item turns the colouring on and off, and the choice is kept", async () => {
    const s = scenario("medium");
    const r = await resume(s.state);
    await play(r, s.legalWrong, s.other);
    const digitText = () =>
      within(r.getByLabelText(cellLabel(s.row, s.col))).getByText(String(s.legalWrong));
    expect(digitText()).toHaveStyle({ color: darkColors.accent });

    const item = await showMistakesItem(r);
    await act(async () => {
      await fireEvent.press(item);
    });
    expect(digitText()).toHaveStyle({ color: darkColors.error });
    expect(await AsyncStorage.getItem(SHOW_MISTAKES_KEY)).toBe("1");

    const item2 = await showMistakesItem(r);
    await act(async () => {
      await fireEvent.press(item2);
    });
    expect(digitText()).toHaveStyle({ color: darkColors.accent });
    expect(await AsyncStorage.getItem(SHOW_MISTAKES_KEY)).toBe("0");
  });

  it("a stored choice overrides the difficulty default on a later visit", async () => {
    await AsyncStorage.setItem(SHOW_MISTAKES_KEY, "0");
    const r = await resume(scenario("easy").state);
    await waitFor(async () => expect(isChecked(await showMistakesItem(r))).toBe(false));

    await r.unmount();
    await AsyncStorage.setItem(SHOW_MISTAKES_KEY, "1");
    const r2 = await resume(scenario("hard").state);
    await waitFor(async () => expect(isChecked(await showMistakesItem(r2))).toBe(true));
  });

  it("an old save's flags follow the new rule: a legal-wrong flag is dropped, a duplicate is shown", async () => {
    const s = scenario("medium");
    const withDigit = (d: number, isError: boolean): SudokuState["grid"] =>
      s.state.grid.map((rowCells, r) =>
        rowCells.map((cell, c) =>
          r === s.row && c === s.col ? { ...cell, value: d as CellValue, isError } : cell
        )
      );
    // The old rule flagged the legal-but-wrong digit.
    const oldLegalWrong: SudokuState = {
      ...s.state,
      grid: withDigit(s.legalWrong, true),
      errorCount: 1,
      selectedRow: null,
      selectedCol: null,
    };
    const r = await resume(oldLegalWrong);
    expect(
      within(r.getByLabelText(cellLabel(s.row, s.col))).getByText(String(s.legalWrong))
    ).toHaveStyle({ color: darkColors.accent });
    await r.unmount();

    // The old rule did not flag a duplicate that happened to match the solution... or not.
    const oldDuplicate: SudokuState = {
      ...s.state,
      grid: withDigit(s.illegal, false),
      selectedRow: null,
      selectedCol: null,
    };
    const r2 = await resume(oldDuplicate);
    expect(
      within(r2.getByLabelText(cellLabel(s.row, s.col))).getByText(String(s.illegal))
    ).toHaveStyle({ color: darkColors.error });
  });

  describe("a full grid that is not the solution", () => {
    function fullButWrong() {
      const s = scenario("medium");
      const grid = s.state.grid.map((rowCells, r) =>
        rowCells.map((cell, c) => {
          if (cell.given) return cell;
          const correct = s.state.solution.charCodeAt(r * 9 + c) - 48;
          const value = r === s.row && c === s.col ? s.legalWrong : correct;
          return { ...cell, value: value as CellValue };
        })
      );
      return { ...s, state: { ...s.state, grid, selectedRow: null, selectedCol: null } };
    }

    it("shows the message with a Hint action, and not before it is full", async () => {
      const r0 = await resume(scenario("medium").state);
      expect(r0.queryByTestId("sudoku-full-wrong")).toBeNull();
      await r0.unmount();

      const r = await resume(fullButWrong().state);
      expect(r.getByTestId("sudoku-full-wrong")).toBeTruthy();
      expect(r.getByText(/something is off/i)).toBeTruthy();
      expect(r.getByTestId("sudoku-full-wrong-hint")).toBeTruthy();
    });

    it("the Hint action corrects a wrong cell, which completes the puzzle", async () => {
      const f = fullButWrong();
      const r = await resume(f.state);
      await act(async () => {
        await fireEvent.press(r.getByTestId("sudoku-full-wrong-hint"));
      });
      await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(1));
      expect(r.queryByTestId("sudoku-full-wrong")).toBeNull();
      const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
      expect(summary["result"]).toEqual({ won: true, errors: 0 });
    });
  });
});
