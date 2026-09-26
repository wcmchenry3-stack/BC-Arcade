/**
 * FreeCellScreen — hint and no-moves-banner integration tests (#1295),
 * per-session game sync (#2452, scored since #2632), and the shared result
 * card (#2508), which reads the synced game's rank (#2632).
 *
 * Engine correctness is covered by engine.test.ts. These tests focus on
 * the screen's hint handler: when getHintMoves returns [] (all moves are
 * non-productive reversible swaps), pressing Hint must surface the
 * "No moves left" banner rather than oscillating between two equivalent squares.
 */

import React from "react";
import { render, fireEvent, act, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo } from "react-native";
import FreeCellScreen from "../FreeCellScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import type { FreeCellState } from "../../game/freecell/types";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import type { ForegroundClockMock } from "../../game/_shared/__mocks__/foregroundClock";

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
  loadStats: jest.fn().mockResolvedValue({ bestMoves: 0, gamesPlayed: 0, gamesWon: 0 }),
  saveStats: jest.fn().mockResolvedValue(undefined),
}));

import { loadGame, loadStats } from "../../game/freecell/storage";

// The real engine; one test swaps in a fixed deal for New Game / Play Again.
const mockDealGame = jest.fn();
jest.mock("../../game/freecell/engine", () => {
  const actual = jest.requireActual("../../game/freecell/engine");
  return {
    ...actual,
    dealGame: (...args: unknown[]) =>
      mockDealGame.getMockImplementation() ? mockDealGame(...args) : actual.dealGame(...args),
  };
});

// useGameSync's play clock (#2684) is pinned for every test by jest.setup.ts
// (#2710); the duration tests move it forward.
const clock = jest.requireMock<ForegroundClockMock>("../../game/_shared/foregroundClock");

// The result card reads the synced game's rank (#2632, sessionBoardAdapter).
const mockGetGameRank = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetGameRank(gameId) },
}));
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn((name: string) => Promise.resolve({ display_name: name })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));

// Mock gameEventClient so the useGameSync wiring (#2452) can be asserted without the
// real client, which would otherwise start a session on the first move.
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

beforeEach(() => {
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-uuid-test");
  mockEnqueueEvent.mockReset();
  mockCompleteGame.mockReset();
  mockDealGame.mockReset();
});

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

async function renderScreen() {
  return await render(
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
    const { getByLabelText, queryByText, getAllByLabelText } = await renderScreen();

    // Wait for loadGame to resolve and state to mount
    await waitFor(() => getByLabelText("Hint"));

    // Before pressing Hint, no banner
    expect(queryByText(/no moves left/i)).toBeNull();

    await act(async () => {
      await fireEvent.press(getByLabelText("Hint"));
    });

    await waitFor(() => {
      // Banner message is visible
      expect(queryByText(/no moves left/i)).not.toBeNull();
      // Banner adds a second Undo button (header already has one, banner adds another)
      expect(getAllByLabelText("Undo").length).toBe(2);
    });
  });

  it("banner does not appear before Hint is pressed", async () => {
    const { getByLabelText, queryByText } = await renderScreen();

    await waitFor(() => getByLabelText("Hint"));
    expect(queryByText(/no moves left/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #2452 — FreeCell records a per-session game
//
// Positions are built so auto-complete (which runs on load) plays the moves:
// every foundation is full except spades, and the rest of the spades sit in
// column 0 in order, so each auto-step is one move.
// ---------------------------------------------------------------------------

const AUTO_STEP_MS = 120;

function upTo(suit: "spades" | "hearts" | "diamonds" | "clubs", rank: number) {
  return Array.from({ length: rank }, (_, i) => ({ suit, rank: (i + 1) as never }));
}

/** Spades foundation A..`spadesDone`; the remaining spades stacked K-first in column 0. */
function nearlyWon(spadesDone: number): FreeCellState {
  const rest = Array.from({ length: 13 - spadesDone }, (_, i) => ({
    suit: "spades" as const,
    rank: (13 - i) as never,
  }));
  return {
    _v: 1,
    tableau: [rest, [], [], [], [], [], [], []],
    freeCells: [null, null, null, null] as unknown as FreeCellState["freeCells"],
    foundations: {
      spades: upTo("spades", spadesDone),
      hearts: upTo("hearts", 13),
      diamonds: upTo("diamonds", 13),
      clubs: upTo("clubs", 13),
    },
    undoStack: [],
    isComplete: false,
    moveCount: 0,
  };
}

describe("FreeCellScreen — records a per-session game (#2452)", () => {
  afterEach(async () => {
    // Auto-complete steps run on timers and set state — flush them inside act.
    await act(async () => {
      jest.runAllTimers();
    });
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("opens no session just because a game was loaded and looked at", async () => {
    (loadGame as jest.Mock).mockResolvedValue(REVERSIBLE_ONLY_STATE);
    const { getByLabelText, unmount } = await renderScreen();
    await waitFor(() => getByLabelText("Hint"));
    await unmount();
    expect(mockStartGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("opens a 'freecell' session on the first move and abandons it on unmount with the moves so far", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(11)); // Q♠ then K♠ still to go
    const { getByLabelText, unmount } = await renderScreen();
    await waitFor(() => getByLabelText("Hint"));

    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS); // one move
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockStartGame.mock.calls[0]![0]).toBe("freecell");
    expect(mockCompleteGame).not.toHaveBeenCalled(); // not won yet

    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    expect(summary["outcome"]).toBe("abandoned");
    // Backend FreeCellResult needs both fields; moves feeds the "make N moves" goal.
    expect(summary["result"]).toEqual({ won: false, moves: 1 });
    // Fewer moves ranks higher — an abandon must never carry a score.
    expect(summary).not.toHaveProperty("finalScore");
  });

  // #2632: the win's move count is its score (the board ranks it ascending).
  it("completes on a win with won:true and the move count as finalScore", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(12)); // only K♠ to go
    const { getByLabelText } = await renderScreen();
    await waitFor(() => getByLabelText("Hint"));

    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS);
    });

    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(1));
    expect(mockStartGame).toHaveBeenCalledTimes(1); // opened and closed in one commit
    const [gameId, summary, eventData] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("game-uuid-test");
    expect(summary["outcome"]).toBe("completed");
    expect(summary["result"]).toEqual(expect.objectContaining({ won: true, moves: 1 }));
    expect(eventData).toEqual(expect.objectContaining({ won: true, moves: 1 }));
    expect(summary["finalScore"]).toBe(1);
  });

  // #2684 — FreeCell has no timer of its own: useGameSync's active-play window
  // (foreground time on the screen, thinking time included) supplies it.
  it("completes with the active play time on the screen", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(11)); // two auto-steps to go
    const { getByLabelText } = await renderScreen();
    await waitFor(() => getByLabelText("Hint"));
    clock.advanceForegroundNow(7_000);
    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS); // first move opens the session
    });
    clock.advanceForegroundNow(2_000);
    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS); // second move wins
    });

    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(1));
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    expect(summary["outcome"]).toBe("completed");
    expect(summary["durationMs"]).toBe(9_000);
  });

  it("New Game after a move abandons the session with the moves so far, and no score", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(11));
    const { getByLabelText, getByText } = await renderScreen();
    await waitFor(() => getByLabelText("Hint"));
    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS); // first move opens the session
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);

    await act(async () => {
      await fireEvent.press(getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(getByLabelText("Start New")); // confirm the abandon dialog
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const summary = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    expect(summary["outcome"]).toBe("abandoned");
    expect(summary["result"]).toEqual(expect.objectContaining({ won: false, moves: 1 }));
    expect(summary).not.toHaveProperty("finalScore");
  });

  it("New Game during auto-complete stops it — the old game must not open a second session (#2452)", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(9)); // four auto-steps to go
    const { getByLabelText, getByText } = await renderScreen();
    await waitFor(() => getByLabelText("Hint"));
    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS); // step 1 opens the session
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);

    await act(async () => {
      await fireEvent.press(getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(getByLabelText("Start New"));
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1); // the abandon

    // The old game's scheduled steps must not run: left alone they would overwrite the
    // new deal with the old game's state, the first-move effect would open a phantom
    // session for it, and finishing it would record a win next to the abandon.
    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS * 10);
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1]["outcome"]).toBe("abandoned");
  });

  it("a win does not also fire an abandon on unmount", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(12));
    const { getByLabelText, unmount } = await renderScreen();
    await waitFor(() => getByLabelText("Hint"));
    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS);
    });
    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(1));
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// #2508 — the shared result card and leaderboard auto-submit
// ---------------------------------------------------------------------------

describe("FreeCellScreen — result card (#2508)", () => {
  let reduceMotion: jest.SpyInstance;

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetDisplayNameCacheForTests();
    mockGetGameRank.mockReset();
    mockGetGameRank.mockResolvedValue({ ranked: true, rank: 2, is_best: true, reason: null });
    reduceMotion = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  });

  afterEach(async () => {
    await act(async () => {
      jest.runAllTimers();
    });
    reduceMotion.mockRestore();
    (loadGame as jest.Mock).mockResolvedValue(null);
    (loadStats as jest.Mock).mockResolvedValue({ bestMoves: 0, gamesPlayed: 0, gamesWon: 0 });
  });

  /** Loads a game one auto-complete step from winning and plays that step. */
  async function winInOneMove() {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(12));
    const r = await renderScreen();
    await waitFor(() => r.getByLabelText("Hint"));
    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS);
    });
    return r;
  }

  it("shows the card with the move count, Play Again and Home", async () => {
    const r = await winInOneMove();
    const card = within(await r.findByTestId("freecell-result"));
    expect(card.getByTestId("freecell-result-title")).toHaveTextContent("You Win!");
    expect(card.getByText("Completed in 1 move")).toBeTruthy();
    expect(card.getByText("Moves")).toBeTruthy();
    expect(card.getByRole("button", { name: "Play Again" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(card.queryByRole("button", { name: /Submit/ })).toBeNull();
  });

  // #2632: the card reads the synced game's rank; nothing goes to /freecell/score.
  it("shows the synced game's rank under the saved display name", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    const r = await winInOneMove();
    await waitFor(() => expect(r.getByText("Saved as Riley · #2 on the leaderboard")).toBeTruthy());
    expect(mockGetGameRank).toHaveBeenCalledTimes(1);
    expect(mockGetGameRank).toHaveBeenCalledWith("game-uuid-test");
  });

  it("asks for a display name once when none is set, then shows the rank", async () => {
    const r = await winInOneMove();
    const input = await r.findByLabelText("Pick a display name for leaderboards");
    expect(mockGetGameRank).not.toHaveBeenCalled();
    await act(async () => {
      await fireEvent.changeText(input, "Riley");
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(r.getByText("Saved as Riley · #2 on the leaderboard")).toBeTruthy());
    expect(mockGetGameRank).toHaveBeenCalledWith("game-uuid-test");
  });

  it("marks a new best and shows it", async () => {
    (loadStats as jest.Mock).mockResolvedValue({ bestMoves: 90, gamesPlayed: 4, gamesWon: 2 });
    const r = await winInOneMove();
    const card = within(await r.findByTestId("freecell-result"));
    expect(card.getByText("New best")).toBeTruthy();
    expect(card.getByText("Best")).toBeTruthy();
  });

  it("plays the win celebration before the card", async () => {
    reduceMotion.mockResolvedValue(false);
    const r = await winInOneMove();
    expect(r.queryByTestId("freecell-result")).toBeNull();
    expect(r.getByTestId("animation-overlay")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(r.getByTestId("freecell-result")).toBeTruthy();
  });

  it("Play Again deals a new game and clears the card", async () => {
    const r = await winInOneMove();
    await r.findByTestId("freecell-result");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    expect(r.queryByTestId("freecell-result")).toBeNull();
    expect(r.getByLabelText("Moves: 0")).toBeTruthy();
  });

  // #2710 — the next deal's session opens at its first move; its play time
  // starts at the deal, not when the last game ended.
  it("leaves time on the win card out of the next deal's duration", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(12));
    const r = await renderScreen();
    await waitFor(() => r.getByLabelText("Hint"));
    clock.advanceForegroundNow(9_000);
    await act(async () => {
      jest.advanceTimersByTime(AUTO_STEP_MS); // the winning move
    });
    await r.findByTestId("freecell-result");
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);

    clock.advanceForegroundNow(3 * 60_000); // on the win card
    mockDealGame.mockImplementation(() => nearlyWon(12));
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    clock.advanceForegroundNow(6_000);
    // Double-tap K♠ to the foundation: the new deal's first move wins it.
    await act(async () => {
      await fireEvent.press(r.getByLabelText("K of Spades"));
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText(/^K of Spades/));
    });

    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(2));
    const first = mockCompleteGame.mock.calls[0]![1] as Record<string, unknown>;
    const second = mockCompleteGame.mock.calls[1]![1] as Record<string, unknown>;
    expect(first["durationMs"]).toBe(9_000);
    expect(second["outcome"]).toBe("completed");
    expect(second["durationMs"]).toBe(6_000);
  });

  // The app closed after a win but before the save was cleared.
  it("does not resubmit or replay the celebration for a resumed, already-won game", async () => {
    reduceMotion.mockResolvedValue(false);
    await AsyncStorage.setItem("player_display_name", "Riley");
    (loadGame as jest.Mock).mockResolvedValue({
      ...nearlyWon(13),
      isComplete: true,
      moveCount: 52,
      events: ["gameWin"],
    });
    const r = await renderScreen();
    // Let the load settle without advancing timers (findBy* would run them past
    // the celebration): the card must be up at once, with no celebration.
    await act(async () => {
      await Promise.resolve();
    });
    expect(r.getByTestId("freecell-result")).toBeTruthy();
    expect(r.queryByTestId("animation-overlay")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockGetGameRank).not.toHaveBeenCalled();
  });
});
