import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider } from "../../theme/ThemeContext";
import SortScreen from "../SortScreen";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { initState } from "../../game/sort/engine";
import type { Color } from "../../game/sort/types";
import type { ForegroundClockMock } from "../../game/_shared/__mocks__/foregroundClock";

// ---------------------------------------------------------------------------
// Mocks — factories must be self-contained (jest.mock is hoisted)
// ---------------------------------------------------------------------------

// The shared play clock (#2684) is pinned for every test by jest.setup.ts
// (#2710), so exact completion summaries don't pick up real test time; the
// duration tests move it forward.
const clock = jest.requireMock<ForegroundClockMock>("../../game/_shared/foregroundClock");

// Pass-through mock that stores the latest SortBoard props in global so tests
// can call onPourComplete directly (v14: composite components unavailable in
// host tree, so UNSAFE_getByType is gone).
// Pass-through to the real solver; one test swaps in a held promise.
const mockGetNextHint = jest.fn();
jest.mock("../../game/sort/solver", () => {
  const actual = jest.requireActual("../../game/sort/solver");
  return {
    ...actual,
    getNextHintAsync: (...args: unknown[]) =>
      mockGetNextHint.getMockImplementation()
        ? mockGetNextHint(...args)
        : actual.getNextHintAsync(...args),
  };
});

jest.mock("../../game/sort/components/SortBoard", () => {
  const mod = jest.requireActual("../../game/sort/components/SortBoard");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockSortBoard(props: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__sortBoardLastProps = props;
    return React.createElement(mod.default, props);
  }
  MockSortBoard.displayName = "SortBoard";
  return { __esModule: true, default: MockSortBoard, POUR_PER_UNIT_MS: mod.POUR_PER_UNIT_MS };
});

const mockGoBack = jest.fn();
const mockPopToTop = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ goBack: mockGoBack, popToTop: mockPopToTop }),
}));

// Per-session game sync (#2512): assert start/complete without the real client.
const mockStartGame = jest.fn(() => "sort-game-id");
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as jest.Mock)(...args),
    enqueueEvent: jest.fn(),
    completeGame: (...args: unknown[]) => (mockCompleteGame as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => ({ isOnline: true, isInitialized: true }),
}));

jest.mock("../../game/sort/api", () => ({
  sortApi: {
    getLevels: jest.fn(),
  },
}));

// The inline Leaderboard tab reads the generic board (#2625).
jest.mock("../../api/stats", () => ({
  statsApi: { getLeaderboard: jest.fn() },
}));

// The card's rank lookup (#2677): the real adapter's HTTP is covered by its own
// tests; here we check Sort hands it the finished game.
const mockRankSubmit = jest.fn();
jest.mock("../../game/_shared/sessionBoardAdapter", () => ({
  sessionBoardAdapter: jest.fn((gameType: string) => ({
    gameType,
    refetchOnReconnect: true,
    submit: (...args: unknown[]) => mockRankSubmit(...args),
  })),
}));

jest.mock("../../game/sort/storage", () => {
  const actual = jest.requireActual("../../game/sort/storage");
  return {
    loadProgress: jest.fn(),
    saveProgress: jest.fn(),
    clearGame: jest.fn(),
    saveLevelsCache: jest.fn().mockResolvedValue(undefined),
    loadLevelsCache: jest.fn().mockResolvedValue(null), // cold cache by default
    loadBestMoves: jest.fn(),
    saveBestMoves: jest.fn(),
    // Pure helpers: the real ones.
    applyLevelSolve: actual.applyLevelSolve,
    highestSolvedLevel: actual.highestSolvedLevel,
    mergeBestMoves: actual.mergeBestMoves,
    totalBestMoves: actual.totalBestMoves,
  };
});

// ---------------------------------------------------------------------------
// Typed accessors for the mocked modules
// ---------------------------------------------------------------------------

const { sortApi } = jest.requireMock("../../game/sort/api") as {
  sortApi: {
    getLevels: jest.Mock;
  };
};

const { statsApi } = jest.requireMock("../../api/stats") as {
  statsApi: { getLeaderboard: jest.Mock };
};

const { sessionBoardAdapter } = jest.requireMock("../../game/_shared/sessionBoardAdapter") as {
  sessionBoardAdapter: jest.Mock;
};
// SortScreen builds its adapter once, at import (before any clearAllMocks).
const adapterGameTypes = sessionBoardAdapter.mock.calls.map((call) => call[0]);

const storage = jest.requireMock("../../game/sort/storage") as {
  loadProgress: jest.Mock;
  saveProgress: jest.Mock;
  saveLevelsCache: jest.Mock;
  loadLevelsCache: jest.Mock;
  loadBestMoves: jest.Mock;
  saveBestMoves: jest.Mock;
};

// ---------------------------------------------------------------------------
// Fixtures — levels must NOT be immediately solved so the play view renders
// normally without the win modal.  isBottleSolved() requires length === 0 OR
// (length === BOTTLE_DEPTH && single color), so mixed or partial fills work.
// ---------------------------------------------------------------------------

const MOCK_LEVELS = [
  // 4 bottles, 2 partially filled with mixed colours — requires actual sorting
  { id: 1, bottles: [["red", "blue"], ["blue", "red"], [], []] },
  { id: 2, bottles: [["green", "yellow"], ["yellow", "green"], [], []] },
  { id: 3, bottles: [["orange", "purple"], ["purple", "orange"], [], []] },
];

const DEFAULT_PROGRESS = { unlockedLevel: 3, currentLevelId: null, currentState: null };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <SortScreen />
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockStartGame.mockReturnValue("sort-game-id");
  sortApi.getLevels.mockResolvedValue({ levels: MOCK_LEVELS });
  statsApi.getLeaderboard.mockResolvedValue({
    game_type: "sort",
    partition: {},
    label_key: "level",
    entries: [],
  });
  mockRankSubmit.mockResolvedValue({ kind: "ranked", rank: 1 });
  storage.loadBestMoves.mockResolvedValue({});
  storage.loadProgress.mockResolvedValue(DEFAULT_PROGRESS);
  storage.saveProgress.mockResolvedValue(undefined);
  storage.saveLevelsCache.mockResolvedValue(undefined);
  storage.loadLevelsCache.mockResolvedValue(null); // cold cache by default
  storage.saveBestMoves.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SortScreen — loading and level select", () => {
  it("shows the level select screen after levels load", async () => {
    const { findByText } = await renderScreen();
    expect(await findByText("Choose a Level")).toBeTruthy();
  });

  it("renders a card for each level after load", async () => {
    const { findByLabelText } = await renderScreen();
    expect(await findByLabelText("Level 1")).toBeTruthy();
    expect(await findByLabelText("Level 2")).toBeTruthy();
    expect(await findByLabelText("Level 3")).toBeTruthy();
  });

  it("shows error and retry when API fails", async () => {
    sortApi.getLevels.mockRejectedValue(new Error("network"));
    const { findByText } = await renderScreen();
    expect(await findByText("Could not load this level.")).toBeTruthy();
    expect(await findByText("Retry")).toBeTruthy();
  });

  it("retries loading when Retry is pressed", async () => {
    sortApi.getLevels.mockRejectedValueOnce(new Error("network"));
    const { findByText } = await renderScreen();
    // Wait for the error to appear, then press Retry
    const retryBtn = await findByText("Retry");
    await act(async () => {
      await fireEvent.press(retryBtn);
    });
    expect(sortApi.getLevels).toHaveBeenCalledTimes(2);
  });
});

describe("SortScreen — entering and playing a level", () => {
  // Await the element BEFORE act() — mixing findBy* inside act() breaks polling.
  it("transitions to the play view when a level card is tapped", async () => {
    const { findByLabelText, findByText } = await renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      await fireEvent.press(levelCard);
    });
    expect(await findByText("Level 1")).toBeTruthy(); // HUD text
  });

  it("back button in play view returns to level select", async () => {
    const { findByLabelText, findByText } = await renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      await fireEvent.press(levelCard);
    });
    const backBtn = await findByLabelText("Back to levels");
    await act(async () => {
      await fireEvent.press(backBtn);
    });
    expect(await findByText("Choose a Level")).toBeTruthy();
  });

  it("New Game in the menu restarts the level after confirmation", async () => {
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 3,/));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "More options" }));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Start New" }));
    });
    // Restarting abandons the open session and leaves the player on the board.
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1].outcome).toBe("abandoned");
    expect(r.getByTestId("sort-board")).toBeTruthy();
    expect(r.getByText("Moves: 0")).toBeTruthy();
  });

  it("drops a hint that finishes after the level was restarted", async () => {
    let resolveHint: (h: { from: number; to: number }) => void = () => {};
    mockGetNextHint.mockImplementation(() => new Promise((resolve) => (resolveHint = resolve)));
    try {
      const r = await renderScreen();
      await act(async () => {
        await fireEvent.press(await r.findByLabelText("Level 1"));
      });
      // Not awaited: the hint promise is held open on purpose.
      await act(async () => {
        void fireEvent.press(r.getByRole("button", { name: "Hint" }));
      });
      await act(async () => {
        await fireEvent.press(r.getByRole("button", { name: "More options" }));
      });
      await act(async () => {
        await fireEvent.press(r.getByText("New Game"));
      });
      await act(async () => {
        await fireEvent.press(r.getByRole("button", { name: "Start New" }));
      });
      // The solver answers for the old board after the restart.
      await act(async () => {
        resolveHint({ from: 0, to: 2 });
      });
      expect(r.queryByLabelText(/selected — tap another bottle/)).toBeNull();
    } finally {
      mockGetNextHint.mockReset();
    }
  });

  it("undo button is disabled initially (no history)", async () => {
    const { findByLabelText } = await renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      await fireEvent.press(levelCard);
    });
    const undoBtn = await findByLabelText("Undo");
    expect(undoBtn.props.accessibilityState?.disabled).toBe(true);
  });

  it("selecting a bottle updates its accessibility label", async () => {
    const { findByLabelText } = await renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      await fireEvent.press(levelCard);
    });
    // Bottle 1 has balls — tapping it selects it
    const bottle = await findByLabelText(/^Bottle 1,/);
    await act(async () => {
      await fireEvent.press(bottle);
    });
    expect(await findByLabelText(/Bottle 1 selected/)).toBeTruthy();
  });

  it("undo button becomes enabled after a valid pour", async () => {
    const { findByLabelText } = await renderScreen();
    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      await fireEvent.press(levelCard);
    });
    // Bottle 1 = ["red","blue"] (top: blue), Bottle 3 = [] (empty) — valid pour
    const bottle1 = await findByLabelText(/^Bottle 1,/);
    await act(async () => {
      await fireEvent.press(bottle1);
    });
    const bottle3 = await findByLabelText(/^Bottle 3,/);
    await act(async () => {
      await fireEvent.press(bottle3);
    });
    const undoBtn = await findByLabelText("Undo");
    expect(undoBtn.props.accessibilityState?.disabled).toBeFalsy();
  });
});

describe("SortScreen — leaderboard tab", () => {
  it("fetches and displays the generic Sort board (#2625)", async () => {
    statsApi.getLeaderboard.mockResolvedValue({
      game_type: "sort",
      partition: {},
      label_key: "level",
      entries: [
        { rank: 1, player_name: "Alice", value: 23, completed_at: "2026-09-01T00:00:00Z" },
        { rank: 1, player_name: "Bob", value: 23, completed_at: "2026-09-01T00:00:00Z" },
        { rank: 3, player_name: "Cara", value: 5, completed_at: "2026-09-02T00:00:00Z" },
      ],
    });
    const { findByText, getAllByText } = await renderScreen();
    await findByText("Choose a Level");
    const leaderboardTab = await findByText("Leaderboard");
    await act(async () => {
      await fireEvent.press(leaderboardTab);
    });
    expect(statsApi.getLeaderboard).toHaveBeenCalledWith("sort");
    expect(await findByText("Alice")).toBeTruthy();
    expect(await findByText("Level 5")).toBeTruthy();
    // The server's rank, so tied players share one.
    expect(getAllByText("#1")).toHaveLength(2);
    expect(await findByText("#3")).toBeTruthy();
  });

  it("shows empty state when leaderboard has no scores", async () => {
    const { findByText } = await renderScreen();
    await findByText("Choose a Level");
    const leaderboardTab = await findByText("Leaderboard");
    await act(async () => {
      await fireEvent.press(leaderboardTab);
    });
    expect(await findByText("No scores yet.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Regression: source bottle flash after pour (issue #1567)
//
// The bug: setGhost(null) fired from the Reanimated animation callback while
// setGameState(nextState) was on a separate setTimeout ~50ms later. Between
// those two calls there was a render where the ghost was gone but the stale
// bottle state was still visible — causing a brief flash of the poured color.
//
// The fix: onPourComplete drives the state update from inside SortBoard's
// animation callback so both calls land in the same render. The test below
// guards that contract: calling onPourComplete immediately produces the
// post-pour state without needing any timer to fire.
// ---------------------------------------------------------------------------

describe("SortScreen — pour completion callback (regression #1567)", () => {
  it("updates bottle state immediately when onPourComplete fires — no timer needed", async () => {
    const { findByLabelText } = await renderScreen();

    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      await fireEvent.press(levelCard);
    });

    // Select bottle 1 (["red","blue"], 2 balls), then pour into bottle 3 (empty).
    // This sets pendingPourRef so onPourComplete can apply the state update.
    const bottle1 = await findByLabelText(/^Bottle 1, 2 of/);
    await act(async () => {
      await fireEvent.press(bottle1);
    });
    const bottle3 = await findByLabelText("Bottle 3, empty");
    await act(async () => {
      await fireEvent.press(bottle3);
    });

    // Simulate the moment SortBoard's return animation finishes and fires
    // onPourComplete (in production this is via runOnJS inside the worklet;
    // here we call it directly because Reanimated's jest mock does not invoke
    // animation callbacks). Props captured via the pass-through SortBoard mock.
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });

    // Bottle 1 should now show 1 ball ("red" remains; "blue" was poured out).
    // If the bug is present (state update only on a setTimeout), this label
    // won't exist yet and the test fails.
    expect(await findByLabelText(/^Bottle 1, 1 of/)).toBeTruthy();
    expect(await findByLabelText(/^Bottle 3, 1 of/)).toBeTruthy();
  });

  it("is a no-op when onPourComplete fires with no pending pour", async () => {
    const { findByLabelText } = await renderScreen();

    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      await fireEvent.press(levelCard);
    });

    // Call onPourComplete without initiating any pour first.
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });

    // Original state should be unchanged.
    expect(await findByLabelText(/^Bottle 1, 2 of/)).toBeTruthy();
  });
});

describe("SortScreen — TypeError auto-retry (#1862)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("auto-retries a transient TypeError and loads levels without showing an error", async () => {
    jest.useFakeTimers();
    sortApi.getLevels
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({ levels: MOCK_LEVELS });

    const { findByText, queryByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByText("Choose a Level");
    expect(queryByText("Could not load this level.")).toBeNull();
    expect(sortApi.getLevels).toHaveBeenCalledTimes(2);
  });

  it("shows error UI only after all retries are exhausted", async () => {
    jest.useFakeTimers();
    sortApi.getLevels.mockRejectedValue(new TypeError("Network request failed"));

    const { findByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByText("Could not load this level.");
    // 1 initial + 3 retries = 4 total calls
    expect(sortApi.getLevels).toHaveBeenCalledTimes(4);
  });
});

describe("SortScreen — offline levels cache (#1887)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("serves cached levels when API fails and cache is warm", async () => {
    jest.useFakeTimers();
    sortApi.getLevels.mockRejectedValue(new TypeError("Network request failed"));
    storage.loadLevelsCache.mockResolvedValue({ levels: MOCK_LEVELS });

    const { findByText, queryByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByText("Choose a Level");
    expect(queryByText("Could not load this level.")).toBeNull();
  });

  it("shows error when API fails and cache is cold", async () => {
    jest.useFakeTimers();
    sortApi.getLevels.mockRejectedValue(new TypeError("Network request failed"));
    storage.loadLevelsCache.mockResolvedValue(null);

    const { findByText } = await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await findByText("Could not load this level.");
  });

  it("writes the cache on a successful fetch", async () => {
    const { findByText } = await renderScreen();
    await findByText("Choose a Level");
    expect(storage.saveLevelsCache).toHaveBeenCalledWith({ levels: MOCK_LEVELS });
  });

  it("does not write the cache when the fetch fails", async () => {
    jest.useFakeTimers();
    sortApi.getLevels.mockRejectedValue(new TypeError("Network request failed"));

    await renderScreen();
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(storage.saveLevelsCache).not.toHaveBeenCalled();
  });

  it("does not serve cache on non-network errors (e.g. 401 entitlement expired)", async () => {
    sortApi.getLevels.mockRejectedValue(new Error("ApiError: 401 Unauthorized"));
    storage.loadLevelsCache.mockResolvedValue({ levels: MOCK_LEVELS });

    const { findByText } = await renderScreen();

    await findByText("Could not load this level.");
    expect(storage.loadLevelsCache).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Regression: level advance to a different grid shape (issue #2297)
//
// The bug: handleNextLevel (via handleSelectLevel) swaps `gameState` in place
// rather than unmounting the play view — SortBoard survives a level change.
// SortBoard's own layout-position cache is now reset whenever the bottle
// count changes (see SortBoard.test.tsx for the direct repro of the stale
// highlight/stream), and SortScreen additionally keys <SortBoard> on
// currentLevelId as defense in depth. This test drives the actual
// win → "Next Level" flow end-to-end across a level pair with
// different bottle counts (and therefore a different grid shape) and confirms
// the new level renders correctly rather than inheriting anything from the
// previous one.
// ---------------------------------------------------------------------------

describe("SortScreen — level advance to a different grid shape (regression #2297)", () => {
  it("renders the new level's own bottles after Next Level, not the previous level's", async () => {
    const levels = [
      // 2 bottles, single row — solves in exactly one pour (bottle 2 → bottle 1).
      { id: 1, bottles: [["red", "red", "red"], ["red"]] },
      // 5 bottles — a different grid shape (3-col/2-row instead of 2-col/1-row).
      { id: 2, bottles: [["red"], ["blue"], ["green"], ["yellow"], []] },
    ];
    sortApi.getLevels.mockResolvedValue({ levels });

    const { findByLabelText, findByText, getAllByLabelText } = await renderScreen();

    const levelCard = await findByLabelText("Level 1");
    await act(async () => {
      await fireEvent.press(levelCard);
    });

    // Solve level 1 in one move: select bottle 2 (["red"]), pour into bottle 1
    // (["red","red","red"]) — both bottles end up solved (full-red / empty).
    const bottle2 = await findByLabelText(/^Bottle 2,/);
    await act(async () => {
      await fireEvent.press(bottle2);
    });
    const bottle1 = await findByLabelText(/^Bottle 1,/);
    await act(async () => {
      await fireEvent.press(bottle1);
    });

    // Land the win state synchronously (mirrors the #1567 regression test —
    // Reanimated's jest mock doesn't invoke animation callbacks).
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });

    // Next Level is on the result card straight away (#2512) — it no longer
    // waits for a leaderboard submission.
    const nextLevelBtn = await findByLabelText("Next Level");
    await act(async () => {
      await fireEvent.press(nextLevelBtn);
    });

    // Level 2's HUD and its own 5-bottle grid should now be showing — not a
    // leftover render of level 1's 2-bottle grid.
    expect(await findByText("Level 2")).toBeTruthy();
    expect(getAllByLabelText(/^Bottle \d/)).toHaveLength(5);
    expect(await findByLabelText(/^Bottle 1, 1 of/)).toBeTruthy(); // ["red"]
    expect(await findByLabelText("Bottle 5, empty")).toBeTruthy(); // []

    // A pour immediately on the new level should behave normally, not crash
    // or reference the previous level's now out-of-range bottle indices.
    const newBottle1 = await findByLabelText(/^Bottle 1, 1 of/);
    await act(async () => {
      await fireEvent.press(newBottle1);
    });
    const newBottle5 = await findByLabelText("Bottle 5, empty");
    await act(async () => {
      await fireEvent.press(newBottle5);
    });
    expect(await findByLabelText("Undo")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// #2512 — the shared result card, leaderboard auto-submit and game sync
// ---------------------------------------------------------------------------

describe("SortScreen — result card (#2512)", () => {
  // Level 1 solves in one pour (bottle 2 → bottle 1); level 2 is the last.
  const LEVELS = [
    { id: 1, bottles: [["red", "red", "red"], ["red"]] },
    { id: 2, bottles: [["blue", "blue", "blue"], ["blue"]] },
  ];

  async function solveLevel(r: Awaited<ReturnType<typeof renderScreen>>, level: number) {
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(`Level ${level}`));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 2,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });
    return within(await r.findByTestId("sort-result"));
  }

  beforeEach(() => {
    sortApi.getLevels.mockResolvedValue({ levels: LEVELS });
    // Level 1 is the player's frontier: solving it raises "level reached".
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 1,
      currentLevelId: null,
      currentState: null,
    });
  });

  it("shows the card with moves, undos, best and Next Level", async () => {
    const r = await renderScreen();
    const card = await solveLevel(r, 1);
    expect(card.getByTestId("sort-result-title")).toHaveTextContent("You Win!");
    expect(card.getByText("Sort Puzzle · Level 1")).toBeTruthy();
    expect(card.getByText("Moves")).toBeTruthy();
    expect(card.getByText("Undos")).toBeTruthy();
    // Straight from memory: no wait on storage.
    expect(card.getByText("New best")).toBeTruthy();
    expect(card.getByText("Best")).toBeTruthy();
    expect(card.getByRole("button", { name: "Next Level" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Change Level" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(card.queryByRole("button", { name: "Submit Score" })).toBeNull();
  });

  function completion(n = 0) {
    const [gameId, summary, payload] = mockCompleteGame.mock.calls[n]!;
    return { gameId, summary, payload };
  }

  async function replay(r: Awaited<ReturnType<typeof renderScreen>>) {
    await act(async () => {
      await fireEvent.press(
        within(r.getByTestId("sort-result")).getByRole("button", { name: "Play Again" })
      );
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 2,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });
    return within(await r.findByTestId("sort-result"));
  }

  it("completes a first solve with the frontier as the score (#2625)", async () => {
    const r = await renderScreen();
    await solveLevel(r, 1);
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockStartGame.mock.calls[0]![0]).toBe("sort");
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const { gameId, summary, payload } = completion();
    expect(gameId).toBe("sort-game-id");
    expect(summary).toEqual({
      outcome: "completed",
      finalScore: 1,
      result: { won: true, level: 1, moves: 1, undos: 0, level_reached: 1, total_moves: 1 },
    });
    expect(payload).toEqual(expect.objectContaining({ outcome: "completed", won: true }));
  });

  it("sends the time played on the level as the duration (#2684)", async () => {
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    // Time passes while the player is on the level, not on the level grid.
    clock.advanceForegroundNow(45_000);
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 2,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });
    await r.findByTestId("sort-result");
    expect(completion().summary.durationMs).toBe(45_000);
  });

  /** Solves the level on screen (level 1 and 2 both solve with bottle 2 → 1). */
  async function solveShownLevel(r: Awaited<ReturnType<typeof renderScreen>>) {
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 2,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });
    return within(await r.findByTestId("sort-result"));
  }

  // #2710 — the session opens at the first pour; the level's play time starts
  // when the level appears, not when the screen mounted.
  it("leaves time on the level grid out of the level's duration", async () => {
    const r = await renderScreen();
    await r.findByLabelText("Level 1");
    clock.advanceForegroundNow(5 * 60_000); // browsing the level grid
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    clock.advanceForegroundNow(20_000); // solving
    await solveShownLevel(r);
    expect(completion().summary.durationMs).toBe(20_000);
  });

  it("leaves time on the result card out of the next level's duration", async () => {
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    clock.advanceForegroundNow(30_000);
    const card = await solveShownLevel(r);
    clock.advanceForegroundNow(4 * 60_000); // reading the result card
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Next Level" }));
    });
    clock.advanceForegroundNow(15_000);
    await solveShownLevel(r);
    expect(mockCompleteGame).toHaveBeenCalledTimes(2);
    expect(completion(0).summary.durationMs).toBe(30_000);
    expect(completion(1).summary.result).toEqual(expect.objectContaining({ level: 2 }));
    expect(completion(1).summary.durationMs).toBe(15_000);
  });

  it("leaves time on the level grid out of a continued level's duration", async () => {
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 1,
      currentLevelId: 1,
      currentState: initState(LEVELS[0]!.bottles as (Color | "")[][]),
    });
    const r = await renderScreen();
    await r.findByLabelText("Continue Level 1");
    clock.advanceForegroundNow(5 * 60_000); // on the level grid
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Continue Level 1"));
    });
    clock.advanceForegroundNow(12_000);
    await solveShownLevel(r);
    expect(completion().summary.durationMs).toBe(12_000);
  });

  it("sends total_moves as the sum of the best moves up to the frontier", async () => {
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    // Level 1's best is 6; level 2 is solved in 1 move.
    storage.loadBestMoves.mockResolvedValue({ "1": 6 });
    const r = await renderScreen();
    await solveLevel(r, 2);
    const { summary } = completion();
    expect(summary.finalScore).toBe(2);
    expect(summary.result).toEqual({
      won: true,
      level: 2,
      moves: 1,
      undos: 0,
      level_reached: 2,
      total_moves: 7,
    });
  });

  it("leaves total_moves out when a lower level has no best on record", async () => {
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    const r = await renderScreen();
    await solveLevel(r, 2);
    const { summary } = completion();
    expect(summary.finalScore).toBe(2);
    expect(summary.result).toEqual({ won: true, level: 2, moves: 1, undos: 0, level_reached: 2 });
  });

  it("asks the generic board adapter for the rank of the finished game", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockRankSubmit.mockResolvedValue({ kind: "ranked", rank: 2 });
    const r = await renderScreen();
    const card = await solveLevel(r, 1);
    await waitFor(() =>
      expect(card.getByText("Saved as Riley · #2 on the leaderboard")).toBeTruthy()
    );
    expect(adapterGameTypes).toEqual(["sort"]);
    expect(mockRankSubmit).toHaveBeenCalledTimes(1);
    expect(mockRankSubmit).toHaveBeenCalledWith("Riley", { gameId: "sort-game-id" });
  });

  it("scores a replay below the frontier with the frontier and an improved total", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    // Both levels solved: level 1 in 4 moves, level 2 in 6.
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    storage.loadBestMoves.mockResolvedValue({ "1": 4, "2": 6 });
    const r = await renderScreen();
    await solveLevel(r, 1); // 1 move: a new best for level 1
    const { summary } = completion();
    expect(summary).toEqual({
      outcome: "completed",
      finalScore: 2,
      // The level played, and the standing after it: 1 + 6 moves, was 4 + 6.
      result: { won: true, level: 1, moves: 1, undos: 0, level_reached: 2, total_moves: 7 },
    });
    await waitFor(() => expect(mockRankSubmit).toHaveBeenCalledTimes(1));
    expect(storage.saveBestMoves).toHaveBeenCalledWith({ "1": 1, "2": 6 });
  });

  it("scores every replay of the last level, with the total as it stands", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    storage.loadBestMoves.mockResolvedValue({ "1": 4 });
    const r = await renderScreen();
    await solveLevel(r, 2);
    const card = await replay(r);
    expect(mockCompleteGame).toHaveBeenCalledTimes(2);
    const expected = {
      outcome: "completed",
      finalScore: 2,
      result: { won: true, level: 2, moves: 1, undos: 0, level_reached: 2, total_moves: 5 },
    };
    expect(completion(0).summary).toEqual(expected);
    expect(completion(1).summary).toEqual(expected);
    // Not a new best: nothing to save, and the card says so.
    expect(storage.saveBestMoves).toHaveBeenCalledTimes(1);
    expect(card.queryByText("New best")).toBeNull();
    await waitFor(() => expect(mockRankSubmit).toHaveBeenCalledTimes(2));
  });

  it("never scores past the last level, whatever the stored bests say", async () => {
    storage.loadBestMoves.mockResolvedValue({ "1": 4, "99": 3 });
    const r = await renderScreen();
    await solveLevel(r, 1);
    expect(completion().summary.finalScore).toBe(2);
    expect(completion().summary.result.level_reached).toBe(2);
  });

  // A failed read must not let the next save replace what storage holds.
  it("doesn't write the bests when storage couldn't be read", async () => {
    storage.loadBestMoves.mockResolvedValue(null);
    const r = await renderScreen();
    const card = await solveLevel(r, 1);
    expect(card.getByText("New best")).toBeTruthy();
    expect(completion().summary.result.total_moves).toBe(1);
    await act(async () => {});
    expect(storage.saveBestMoves).not.toHaveBeenCalled();
  });

  it("merges the stored bests on Retry, keeping the lower in-memory one", async () => {
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    // First load: the levels fail (no cache fallback on a 401); the bests load.
    sortApi.getLevels.mockRejectedValueOnce(new Error("ApiError: 401 Unauthorized"));
    storage.loadBestMoves
      .mockResolvedValueOnce({ "1": 3 })
      .mockResolvedValueOnce({ "1": 9, "2": 5 });
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByText("Retry"));
    });
    // Level 1 keeps 3 (in memory), level 2 comes from storage; storage catches up.
    expect(storage.saveBestMoves).toHaveBeenCalledWith({ "1": 3, "2": 5 });
    await solveLevel(r, 2);
    expect(completion().summary.result.total_moves).toBe(4); // 3 + 1
  });

  // #2576: Next Level is there at once, and the session is already complete.
  it("completes the session before the player can move on", async () => {
    storage.saveBestMoves.mockReturnValue(new Promise(() => {}));
    const r = await renderScreen();
    const card = await solveLevel(r, 1);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(completion().summary.finalScore).toBe(1);
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Next Level" }));
    });
    expect(await r.findByText("Level 2")).toBeTruthy();
    // Moving on doesn't abandon (or re-complete) the solved session.
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
  });

  it("shows each level's own best on its card", async () => {
    storage.loadBestMoves.mockResolvedValue({ "2": 1 });
    const r = await renderScreen();
    let card = await solveLevel(r, 1);
    expect(card.getByText("New best")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Next Level" }));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 2,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });
    card = within(await r.findByTestId("sort-result"));
    expect(card.getByText("Sort Puzzle · Level 2")).toBeTruthy();
    // Level 2's best (1) was already on record: not a new best.
    expect(card.queryByText("New best")).toBeNull();
  });

  it("replays the last level with Play Again", async () => {
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    const r = await renderScreen();
    const card = await solveLevel(r, 2);
    expect(card.queryByRole("button", { name: "Next Level" })).toBeNull();
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Play Again" }));
    });
    expect(r.queryByTestId("sort-result")).toBeNull();
    expect(await r.findByText("Level 2")).toBeTruthy();
    expect(await r.findByLabelText(/^Bottle 2, 1 of/)).toBeTruthy();
  });

  it("Change Level returns to level select; Home leaves the game", async () => {
    const r = await renderScreen();
    let card = await solveLevel(r, 1);
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Change Level" }));
    });
    expect(r.queryByTestId("sort-result")).toBeNull();
    expect(await r.findByLabelText("Level 1")).toBeTruthy();

    card = await solveLevel(r, 1);
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Home" }));
    });
    expect(mockPopToTop).toHaveBeenCalled();
  });

  it("abandons an unfinished session when the player leaves for level select", async () => {
    sortApi.getLevels.mockResolvedValue({ levels: MOCK_LEVELS });
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    // One valid pour (bottle 1's blue onto the empty bottle 3) opens the session.
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 3,/));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Back to levels"));
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.outcome).toBe("abandoned");
    expect(summary).not.toHaveProperty("finalScore");
  });

  // #2710 — the abandon carries the time played on the level, and only that.
  it("abandons with the level's play time, not the time on the level grid", async () => {
    sortApi.getLevels.mockResolvedValue({ levels: MOCK_LEVELS });
    const r = await renderScreen();
    await r.findByLabelText("Level 1");
    clock.advanceForegroundNow(5 * 60_000); // browsing the level grid
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    clock.advanceForegroundNow(30_000); // thinking before the first pour
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 3,/));
    });
    clock.advanceForegroundNow(10_000);
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Back to levels"));
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.outcome).toBe("abandoned");
    expect(summary.result).toEqual({ won: false, level: 1, moves: 0 });
    expect(summary.durationMs).toBe(40_000);
  });
});
