import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, AppState, StyleSheet } from "react-native";
import type { AppStateStatus } from "react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import SortScreen from "../SortScreen";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { applyPour, initState } from "../../game/sort/engine";
import type { Color } from "../../game/sort/types";
import type { SortProgress } from "../../game/sort/storage";
import type { ForegroundClockMock } from "../../game/_shared/__mocks__/foregroundClock";
import * as Haptics from "expo-haptics";
import { WIN_CASCADE_MS } from "../../game/sort/motion";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";

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
const mockSolveBoard = jest.fn();
jest.mock("../../game/sort/solver", () => {
  const actual = jest.requireActual("../../game/sort/solver");
  return {
    ...actual,
    solveBoardAsync: (...args: unknown[]) =>
      mockSolveBoard.getMockImplementation()
        ? mockSolveBoard(...args)
        : actual.solveBoardAsync(...args),
  };
});

jest.mock("../../components/sort/SortBoard", () => {
  const mod = jest.requireActual("../../components/sort/SortBoard");
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

// Haptics (#3660): the card's own pulse and Sort's per-event ones all come through here.
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

const mockGoBack = jest.fn();
const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();
// usePauseWhileAway's focus listeners (#3087), live so a test can blur the screen.
const mockNavListeners = new Map<string, Set<() => void>>();
const mockAddListener = jest.fn((event: string, cb: () => void) => {
  const set = mockNavListeners.get(event) ?? new Set();
  set.add(cb);
  mockNavListeners.set(event, set);
  return () => set.delete(cb);
});
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      goBack: mockGoBack,
      popToTop: mockPopToTop,
      navigate: mockNavigate,
      addListener: mockAddListener,
    }),
    { actual: true }
  )
);

// Per-session game sync (#2512): assert start/complete without the real client.
const mockStartGame = jest.fn(() => "sort-game-id");
const mockCompleteGame = jest.fn();
// No killed session to resume unless a test says so (#2654).
const mockResumeGame = jest.fn((): string | null => null);
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    resumeGame: lazy(() => mockResumeGame),
    completeGame: lazy(() => mockCompleteGame),
  });
});

jest.mock("../../game/_shared/NetworkContext", () => mockScreenDeps().mockNetwork());

// The level catalog (#2761): each test sets the levels it plays on (`playOnLevels`).
jest.mock("../../game/sort/catalog", () => ({
  ...jest.requireActual("../../game/sort/catalog"),
  SORT_LEVELS: [],
}));
const catalogMock = jest.requireMock("../../game/sort/catalog") as { SORT_LEVELS: unknown[] };
/** Plays on `levels` instead of the shipped catalog (the array is swapped in place). */
function playOnLevels(levels: readonly unknown[]) {
  catalogMock.SORT_LEVELS.splice(0, catalogMock.SORT_LEVELS.length, ...levels);
}

// The save is already on the catalog unless a test says otherwise.
const mockMigrateToCatalog = jest.fn();
jest.mock("../../game/sort/catalogMigration", () => ({
  migrateToCatalog: () => mockMigrateToCatalog(),
}));

// The board is the shared leaderboard screen (#2633): Sort never reads it itself.
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getLeaderboard: jest.fn() }));

// The card's rank lookup (#2677): the real lookup's HTTP is covered by its own
// tests; here we check Sort hands it the finished game.
const mockRankSubmit = jest.fn();
jest.mock("../../game/_shared/lookupGameRank", () => ({
  ...jest.requireActual("../../game/_shared/lookupGameRank"),
  lookupGameRank: (...args: unknown[]) => mockRankSubmit(...args),
}));

jest.mock("../../game/sort/storage", () => {
  const actual = jest.requireActual("../../game/sort/storage");
  return {
    loadProgress: jest.fn(),
    saveProgress: jest.fn(),
    clearGame: jest.fn(),
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

const { statsApi } = jest.requireMock("../../api/stats") as {
  statsApi: { getLeaderboard: jest.Mock };
};

const storage = jest.requireMock("../../game/sort/storage") as {
  loadProgress: jest.Mock;
  saveProgress: jest.Mock;
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
  playOnLevels(MOCK_LEVELS);
  mockMigrateToCatalog.mockResolvedValue("current");
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

  // #2761: the levels ship in the app; only the save is read, once it is on the catalog.
  it("moves the save onto the catalog before reading it", async () => {
    let finishMigration: (result: string) => void = () => {};
    mockMigrateToCatalog.mockReturnValue(new Promise((r) => (finishMigration = r)));
    const { findByText } = await renderScreen();
    expect(storage.loadProgress).not.toHaveBeenCalled();
    expect(storage.loadBestMoves).not.toHaveBeenCalled();
    await act(async () => finishMigration("current"));
    expect(await findByText("Choose a Level")).toBeTruthy();
    expect(storage.loadProgress).toHaveBeenCalledTimes(1);
    expect(storage.loadBestMoves).toHaveBeenCalledTimes(1);
  });

  it("drops an unfinished board when the save couldn't be moved onto the catalog", async () => {
    mockMigrateToCatalog.mockResolvedValue("failed");
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 3,
      currentLevelId: 2,
      currentState: initState(MOCK_LEVELS[1]!.bottles as Color[][]),
    });
    const { findByLabelText, queryByText } = await renderScreen();
    expect(await findByLabelText("Level 3")).toBeTruthy();
    expect(queryByText(/Continue/)).toBeNull();
  });

  it("plays from level 1 without reading a save of a catalog it doesn't know", async () => {
    mockMigrateToCatalog.mockResolvedValue("foreign");
    storage.loadProgress.mockResolvedValue(DEFAULT_PROGRESS);
    storage.loadBestMoves.mockResolvedValue({ "1": 2 });
    const { findByLabelText } = await renderScreen();
    expect(await findByLabelText("Level 2, locked")).toBeTruthy();
    expect(storage.loadProgress).not.toHaveBeenCalled();
    expect(storage.loadBestMoves).not.toHaveBeenCalled();
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
    let resolveHint: (v: {
      verdict: "solvable";
      moves: { from: number; to: number }[];
    }) => void = () => {};
    mockSolveBoard.mockImplementation(() => new Promise((resolve) => (resolveHint = resolve)));
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
        resolveHint({ verdict: "solvable", moves: [{ from: 0, to: 2 }] });
      });
      expect(r.queryByLabelText(/selected — tap another bottle/)).toBeNull();
    } finally {
      mockSolveBoard.mockReset();
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

describe("SortScreen — save on leaving the app", () => {
  let appStateListeners: Set<(s: AppStateStatus) => void>;
  beforeEach(() => {
    appStateListeners = new Set();
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      cb: (s: AppStateStatus) => void
    ) => {
      appStateListeners.add(cb);
      return { remove: () => appStateListeners.delete(cb) };
    }) as unknown as typeof AppState.addEventListener);
  });
  afterEach(() => jest.restoreAllMocks());

  const setAppState = (s: AppStateStatus) =>
    act(async () => appStateListeners.forEach((cb) => cb(s)));
  const blur = () => act(async () => mockNavListeners.get("blur")?.forEach((cb) => cb()));

  it("saves the board in play on each move to inactive or background, and not on a blur", async () => {
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    await r.findByLabelText("Back to levels");
    storage.saveProgress.mockClear();

    await setAppState("inactive");
    await setAppState("background");
    expect(storage.saveProgress).toHaveBeenCalledTimes(2);
    expect(storage.saveProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentLevelId: 1, currentState: expect.any(Object) })
    );

    await setAppState("active");
    await blur();
    expect(storage.saveProgress).toHaveBeenCalledTimes(2);
  });

  it("saves the latest board: the one after the last pour", async () => {
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1, 2 of/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Bottle 3, empty"));
    });
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });
    expect(await r.findByLabelText(/^Bottle 3, 1 of/)).toBeTruthy();
    storage.saveProgress.mockClear();

    await setAppState("background");
    const afterPour = applyPour(initState(MOCK_LEVELS[0]!.bottles as (Color | "")[][]), 0, 2);
    expect(storage.saveProgress).toHaveBeenCalledTimes(1);
    expect(storage.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentLevelId: 1, currentState: afterPour })
    );
  });

  it("saves nothing at the level select", async () => {
    const r = await renderScreen();
    await r.findByLabelText("Level 1");
    storage.saveProgress.mockClear();
    await setAppState("background");
    expect(storage.saveProgress).not.toHaveBeenCalled();
  });
});

describe("SortScreen — leaderboard (#2633)", () => {
  it("has no inline Leaderboard tab: the level select is the whole screen", async () => {
    const { findByText, queryByRole, queryByText } = await renderScreen();
    await findByText("Choose a Level");
    expect(queryByRole("tab")).toBeNull();
    expect(queryByText("Leaderboard")).toBeNull();
    expect(statsApi.getLeaderboard).not.toHaveBeenCalled();
  });

  it("the ⋯ menu's Leaderboard item opens the shared Sort board", async () => {
    const { findByText, getByTestId } = await renderScreen();
    await findByText("Choose a Level");
    await act(async () => {
      await fireEvent.press(getByTestId("nav-menu"));
    });
    await act(async () => {
      await fireEvent.press(getByTestId("nav-menu-leaderboard"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("Leaderboard", { gameType: "sort" });
  });

  it("the ⋯ menu's Stats item opens Sort's stats (#2635)", async () => {
    const { findByText, getByTestId } = await renderScreen();
    await findByText("Choose a Level");
    await act(async () => {
      await fireEvent.press(getByTestId("nav-menu"));
    });
    await act(async () => {
      await fireEvent.press(getByTestId("nav-menu-stats"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("GameStats", { gameType: "sort" });
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
    playOnLevels(levels);

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

describe("SortScreen — board sizing (#2207)", () => {
  it("sizes the board to the container's height inside its padding", async () => {
    playOnLevels([{ id: 1, bottles: [["red", "red", "red"], ["red"]] }]);
    const { findByLabelText, getByTestId } = await renderScreen();
    await act(async () => {
      await fireEvent.press(await findByLabelText("Level 1"));
    });
    await act(async () => {
      await fireEvent(getByTestId("sort-board"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 500 } },
      });
    });
    // 500 tall minus 8 of padding top and bottom (#3658): the grid must fit in 484,
    // not overflow into the padding (and out of the board's touch bounds).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((global as any).__sortBoardLastProps.availableHeight).toBe(484);
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
    playOnLevels(LEVELS);
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
    // Straight from memory: no wait on storage. A first solve is no new best (#2977).
    expect(card.queryByText("New best")).toBeNull();
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
      result: {
        won: true,
        level: 1,
        moves: 1,
        undos: 0,
        level_reached: 1,
        total_moves: 1,
        catalog_version: 1,
      },
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

  it("counts a resumed level's session from Continue, not from the level grid", async () => {
    mockResumeGame.mockReturnValueOnce("killed-sort-id");
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
    expect(mockStartGame).not.toHaveBeenCalled();
    const { gameId, summary } = completion();
    expect(gameId).toBe("killed-sort-id");
    expect(summary.durationMs).toBe(12_000);
  });

  it("New Game starts the level's play time over with the fresh board", async () => {
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    clock.advanceForegroundNow(40_000); // on the first board, no pour made
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "More options" }));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Start New" }));
    });
    clock.advanceForegroundNow(8_000);
    await solveShownLevel(r);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(completion().summary.durationMs).toBe(8_000);
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
      catalog_version: 1,
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
    expect(summary.result).toEqual({
      won: true,
      level: 2,
      moves: 1,
      undos: 0,
      level_reached: 2,
      catalog_version: 1,
    });
  });

  // #2761: a save moved from the random levels unlocks far ahead, but the
  // board only sees levels solved on the catalog.
  it("scores a migrated player's first solve by what they solved here, not their unlock", async () => {
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 103,
      currentLevelId: null,
      currentState: null,
    });
    storage.loadBestMoves.mockResolvedValue({});
    const r = await renderScreen();
    await solveLevel(r, 1);
    const { summary } = completion();
    expect(summary.finalScore).toBe(1);
    expect(summary.result).toEqual({
      won: true,
      level: 1,
      moves: 1,
      undos: 0,
      level_reached: 1,
      total_moves: 1,
      catalog_version: 1,
    });
  });

  it("scores a catalog player's replay with their highest solved level", async () => {
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 3,
      currentLevelId: null,
      currentState: null,
    });
    storage.loadBestMoves.mockResolvedValue({ "1": 4, "2": 6 });
    const r = await renderScreen();
    await solveLevel(r, 1);
    expect(completion().summary.result).toMatchObject({ level_reached: 2, total_moves: 7 });
  });

  it("asks for the rank of the finished game", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockRankSubmit.mockResolvedValue({ kind: "ranked", rank: 2 });
    const r = await renderScreen();
    const card = await solveLevel(r, 1);
    await waitFor(() =>
      expect(card.getByText("Saved as Riley · #2 on the leaderboard")).toBeTruthy()
    );
    expect(mockRankSubmit).toHaveBeenCalledTimes(1);
    expect(mockRankSubmit).toHaveBeenCalledWith("sort-game-id");
  });

  it("shows the best entry's rank when this solve isn't it, and links to the board (#2633)", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockRankSubmit.mockResolvedValue({ kind: "ranked", rank: 4, isBest: false });
    const r = await renderScreen();
    const card = await solveLevel(r, 1);
    await waitFor(() => expect(card.getByText("Saved as Riley · Your best: #4")).toBeTruthy());
    await act(async () => {
      await fireEvent.press(card.getByText("View leaderboard"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("Leaderboard", { gameType: "sort" });
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
      result: {
        won: true,
        level: 1,
        moves: 1,
        undos: 0,
        level_reached: 2,
        total_moves: 7,
        catalog_version: 1,
      },
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
      result: {
        won: true,
        level: 2,
        moves: 1,
        undos: 0,
        level_reached: 2,
        total_moves: 5,
        catalog_version: 1,
      },
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
    expect(card.queryByText("New best")).toBeNull();
    expect(completion().summary.result.total_moves).toBe(1);
    await act(async () => {});
    expect(storage.saveBestMoves).not.toHaveBeenCalled();
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

  // useCompletionTransition (#3109): the solve edge keeps the screen's timing.
  it("handles a solve once, and Change Level after it records nothing new", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    mockRankSubmit.mockResolvedValue({ kind: "ranked", rank: 2 });
    const r = await renderScreen();
    const card = await solveLevel(r, 1);
    await waitFor(() =>
      expect(card.getByText("Saved as Riley · #2 on the leaderboard")).toBeTruthy()
    );
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockRankSubmit).toHaveBeenCalledTimes(1);
    // The solved board is never saved as the level in progress.
    const saved = storage.saveProgress.mock.calls.map((c) => c[0] as SortProgress);
    expect(saved.at(-1)).toEqual(
      expect.objectContaining({ unlockedLevel: 2, currentLevelId: null, currentState: null })
    );
    expect(saved.some((p) => p.currentState?.isComplete)).toBe(false);

    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Change Level" }));
    });
    expect(await r.findByLabelText("Level 1")).toBeTruthy();
    // Closing the card over the solved board fires the edge again, as it always
    // has, but the session is closed and no rank is asked for twice.
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockRankSubmit).toHaveBeenCalledTimes(1);
    expect(storage.saveProgress.mock.calls.at(-1)![0]).toEqual(
      expect.objectContaining({ unlockedLevel: 2, currentLevelId: null, currentState: null })
    );
  });

  it("shows each level's own best on its card", async () => {
    storage.loadBestMoves.mockResolvedValue({ "2": 1 });
    const r = await renderScreen();
    let card = await solveLevel(r, 1);
    expect(card.queryByText("New best")).toBeNull();
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

  it("flags a solve that beats an earlier best as a new best, and saves it (#2977)", async () => {
    storage.loadBestMoves.mockResolvedValue({ "1": 5 });
    const r = await renderScreen();
    const card = await solveLevel(r, 1); // 1 move, was 5
    expect(card.getByText("New best")).toBeTruthy();
    expect(storage.saveBestMoves).toHaveBeenCalledWith({ "1": 1 });
  });

  it("saves a first solve as the level's best without calling it a new best (#2977)", async () => {
    const r = await renderScreen();
    const card = await solveLevel(r, 1);
    expect(card.queryByText("New best")).toBeNull();
    expect(storage.saveBestMoves).toHaveBeenCalledWith({ "1": 1 });
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
    playOnLevels(MOCK_LEVELS);
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
    playOnLevels(MOCK_LEVELS);
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
    // The pour lands: the board isn't laid out under jest, so SortBoard skips
    // the animation and completes it at once (#2297).
    expect(summary.result).toEqual({ won: false, level: 1, moves: 1 });
    expect(summary.durationMs).toBe(40_000);
  });
});

// ---------------------------------------------------------------------------
// Hint on a board that can't be won (#2768)
//
// DEAD_LEVEL is solvable from the start; the pours 2 -> 4, 1 -> 2, 3 -> 2
// (bottle numbers, 1-based) leave a board the solver proves dead after the
// second pour, while the board after the first pour is still solvable.
// ---------------------------------------------------------------------------

describe("SortScreen — Hint on a dead board (#2768)", () => {
  const DEAD_LEVEL = [
    ["red", "red", "red", "green"],
    ["red", "green", "blue", "blue"],
    ["blue", "blue", "green", "green"],
    [],
  ];

  type Rendered = Awaited<ReturnType<typeof renderScreen>>;

  async function openDeadLevel() {
    playOnLevels([{ id: 1, bottles: DEAD_LEVEL }]);
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    return r;
  }

  async function pour(r: Rendered, from: number, to: number) {
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(new RegExp(`^Bottle ${from},`)));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(new RegExp(`^Bottle ${to},`)));
    });
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });
  }

  async function playIntoDeadEnd(r: Rendered) {
    await pour(r, 2, 4); // still solvable
    await pour(r, 1, 2); // dead from here
    await pour(r, 3, 2);
  }

  async function tapHint(r: Rendered) {
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Hint" }));
    });
  }

  it("says there is no way to win, with both actions, when the board is dead", async () => {
    const r = await openDeadLevel();
    await playIntoDeadEnd(r);
    expect(r.queryByText("No way to win from here")).toBeNull();
    await tapHint(r);
    expect(await r.findByText("No way to win from here")).toBeTruthy();
    expect(r.getByRole("button", { name: "Back to last good move" })).toBeTruthy();
    expect(r.getByRole("button", { name: "Restart level" })).toBeTruthy();
  });

  it("does not run the solver until Hint is tapped", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "unknown" });
    try {
      const r = await openDeadLevel();
      await playIntoDeadEnd(r);
      expect(mockSolveBoard).not.toHaveBeenCalled();
    } finally {
      mockSolveBoard.mockReset();
    }
  });

  it("Back to last good move lands on the newest solvable state, one undo per step", async () => {
    const r = await openDeadLevel();
    await playIntoDeadEnd(r);
    expect(r.getByText("Moves: 3")).toBeTruthy();
    await tapHint(r);
    await act(async () => {
      await fireEvent.press(await r.findByRole("button", { name: "Back to last good move" }));
    });
    // Back to the board after the first pour: the second and third are undone.
    await waitFor(() => expect(r.getByText("Moves: 1")).toBeTruthy());
    expect(r.getByText("Undos: 2")).toBeTruthy();
    expect(r.queryByText("No way to win from here")).toBeNull();
    // A hint from here finds a pour: the board is winnable.
    await tapHint(r);
    expect(await r.findByLabelText(/selected — tap another bottle/)).toBeTruthy();
    expect(r.queryByText("No way to win from here")).toBeNull();
  });

  it("Restart level resets the board and abandons the session", async () => {
    const r = await openDeadLevel();
    await playIntoDeadEnd(r);
    await tapHint(r);
    await act(async () => {
      await fireEvent.press(await r.findByRole("button", { name: "Restart level" }));
    });
    expect(r.getByText("Moves: 0")).toBeTruthy();
    expect(r.getByText("Undos: 0")).toBeTruthy();
    expect(r.queryByText("No way to win from here")).toBeNull();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1].outcome).toBe("abandoned");
  });

  it("says it couldn't find a hint when the verdict is unknown", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "unknown" });
    try {
      const r = await openDeadLevel();
      await tapHint(r);
      expect(await r.findByText("Couldn't find a hint")).toBeTruthy();
      expect(r.queryByRole("button", { name: "Restart level" })).toBeNull();
    } finally {
      mockSolveBoard.mockReset();
    }
  });

  it("can be dismissed", async () => {
    const r = await openDeadLevel();
    await playIntoDeadEnd(r);
    await tapHint(r);
    await act(async () => {
      await fireEvent.press(await r.findByRole("button", { name: "Dismiss" }));
    });
    expect(r.queryByText("No way to win from here")).toBeNull();
  });

  it("keys the notice apart from the board, so level 1's first notice is not a duplicate key", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await openDeadLevel();
      await playIntoDeadEnd(r);
      await tapHint(r);
      expect(r.getByText("No way to win from here")).toBeTruthy();
      const dupKey = errorSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes("same key"))
      );
      expect(dupKey).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("drops a verdict that arrives after the player poured again", async () => {
    let resolveSolve: (v: { verdict: "unsolvable" }) => void = () => {};
    mockSolveBoard.mockImplementation(() => new Promise((resolve) => (resolveSolve = resolve)));
    try {
      const r = await openDeadLevel();
      await act(async () => {
        void fireEvent.press(r.getByRole("button", { name: "Hint" }));
      });
      await pour(r, 2, 4);
      await act(async () => {
        resolveSolve({ verdict: "unsolvable" });
      });
      expect(r.queryByText("No way to win from here")).toBeNull();
    } finally {
      mockSolveBoard.mockReset();
    }
  });

  it("behaves the same on a dead board restored with Continue", async () => {
    const start = initState(DEAD_LEVEL as (Color | "")[][]);
    const dead = applyPour(applyPour(applyPour(start, 1, 3), 0, 1), 2, 1);
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 1,
      currentLevelId: 1,
      currentState: dead,
    });
    playOnLevels([{ id: 1, bottles: DEAD_LEVEL }]);
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Continue Level 1"));
    });
    await tapHint(r);
    expect(await r.findByText("No way to win from here")).toBeTruthy();
    // No history to step back through; Restart is the way out.
    expect(r.queryByRole("button", { name: "Back to last good move" })).toBeNull();
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Restart level" }));
    });
    expect(r.getByText("Moves: 0")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Hint notice: search cost, stale answers and layout (#2768 review)
//
// PING_LEVEL has two empty bottles, so one ball can be poured back and forth
// (3 -> 4, 4 -> 3, ...) for as many moves as a test needs. The solver is
// mocked by moveCount, to build a long history cheaply.
// ---------------------------------------------------------------------------

describe("SortScreen — Hint notice search and layout (#2768)", () => {
  const PING_LEVEL = [["red", "blue"], ["blue", "red"], [], []];
  type Rendered = Awaited<ReturnType<typeof renderScreen>>;
  type Verdict =
    { verdict: "solvable"; moves: [] } | { verdict: "unsolvable" } | { verdict: "unknown" };

  afterEach(() => mockSolveBoard.mockReset());

  async function openPing() {
    playOnLevels([{ id: 1, bottles: PING_LEVEL }]);
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    return r;
  }

  async function pour(r: Rendered, from: number, to: number) {
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(new RegExp(`^Bottle ${from},`)));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(new RegExp(`^Bottle ${to},`)));
    });
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__sortBoardLastProps?.onPourComplete?.();
    });
  }

  /** `n` pours: blue to bottle 3, then back and forth between 3 and 4. */
  async function pourTimes(r: Rendered, n: number) {
    await pour(r, 1, 3);
    for (let i = 1; i < n; i++) await pour(r, i % 2 === 1 ? 3 : 4, i % 2 === 1 ? 4 : 3);
  }

  const tapHint = (r: Rendered) =>
    act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Hint" }));
    });

  it("binary-searches a long history: O(log n) solves", async () => {
    // Boards with moveCount <= 5 are winnable; later ones are dead.
    mockSolveBoard.mockImplementation(async (s: { moveCount: number }): Promise<Verdict> =>
      s.moveCount <= 5 ? { verdict: "solvable", moves: [] } : { verdict: "unsolvable" }
    );
    const r = await openPing();
    await pourTimes(r, 21);
    expect(r.getByText("Moves: 21")).toBeTruthy();
    await tapHint(r);
    mockSolveBoard.mockClear();
    await act(async () => {
      await fireEvent.press(await r.findByRole("button", { name: "Back to last good move" }));
    });
    await waitFor(() => expect(r.getByText("Moves: 5")).toBeTruthy());
    expect(r.getByText("Undos: 16")).toBeTruthy();
    // 21 history states: about log2(21) + 1 solves, nowhere near 21.
    expect(mockSolveBoard.mock.calls.length).toBeLessThanOrEqual(7);
  });

  it("treats an unknown verdict mid-history as not winnable", async () => {
    mockSolveBoard.mockImplementation(async (s: { moveCount: number }): Promise<Verdict> => {
      if (s.moveCount <= 2) return { verdict: "solvable", moves: [] };
      return s.moveCount <= 4 ? { verdict: "unknown" } : { verdict: "unsolvable" };
    });
    const r = await openPing();
    await pourTimes(r, 8);
    await tapHint(r);
    await act(async () => {
      await fireEvent.press(await r.findByRole("button", { name: "Back to last good move" }));
    });
    await waitFor(() => expect(r.getByText("Moves: 2")).toBeTruthy());
    expect(r.getByText("Undos: 6")).toBeTruthy();
  });

  it("offers Restart only when no history board is proven winnable (restored dead board)", async () => {
    const start = initState(PING_LEVEL as (Color | "")[][]);
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 1,
      currentLevelId: 1,
      currentState: applyPour(start, 0, 2),
    });
    // Everything is dead, as for a restored dead board.
    mockSolveBoard.mockResolvedValue({ verdict: "unsolvable" });
    playOnLevels([{ id: 1, bottles: PING_LEVEL }]);
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Continue Level 1"));
    });
    await pour(r, 3, 4); // history is now [the restored, dead board]
    await tapHint(r);
    expect(await r.findByText("No way to win from here")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Back to last good move" }));
    });
    // Nothing proven winnable: the board is left alone, Restart is what's left.
    expect(r.getByText("Moves: 2")).toBeTruthy();
    expect(r.getByText("Undos: 0")).toBeTruthy();
    expect(r.queryByRole("button", { name: "Back to last good move" })).toBeNull();
    expect(r.getByRole("button", { name: "Restart level" })).toBeTruthy();
  });

  it("drops a search that finishes after the player poured, and leaves Hint usable", async () => {
    const pending: ((v: Verdict) => void)[] = [];
    let first = true;
    mockSolveBoard.mockImplementation((): Promise<Verdict> => {
      if (first) {
        first = false;
        return Promise.resolve({ verdict: "unsolvable" });
      }
      return new Promise((res) => pending.push(res));
    });
    const r = await openPing();
    await pourTimes(r, 2);
    await tapHint(r);
    await act(async () => {
      await fireEvent.press(await r.findByRole("button", { name: "Back to last good move" }));
    });
    await pour(r, 4, 3); // while the search runs
    await act(async () => {
      pending.splice(0).forEach((res) => res({ verdict: "solvable", moves: [] }));
    });
    expect(r.getByText("Moves: 3")).toBeTruthy();
    expect(r.getByText("Undos: 0")).toBeTruthy();
    expect(r.getByRole("button", { name: "Hint" }).props.accessibilityState.busy).toBe(false);
  });

  it("runs one search when Back to last good move is tapped twice", async () => {
    const pending: ((v: Verdict) => void)[] = [];
    let first = true;
    mockSolveBoard.mockImplementation((): Promise<Verdict> => {
      if (first) {
        first = false;
        return Promise.resolve({ verdict: "unsolvable" });
      }
      return new Promise((res) => pending.push(res));
    });
    const r = await openPing();
    await pourTimes(r, 2);
    await tapHint(r);
    const undoBtn = await r.findByRole("button", { name: "Back to last good move" });
    await act(async () => {
      await fireEvent.press(undoBtn);
    });
    await act(async () => {
      await fireEvent.press(undoBtn);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        pending.splice(0).forEach((res) => res({ verdict: "solvable", moves: [] }));
      });
    }
    // The hint, then history states 0 and 1 once: three solves, one undo.
    expect(mockSolveBoard).toHaveBeenCalledTimes(3);
    expect(r.getByText("Moves: 1")).toBeTruthy();
    expect(r.getByText("Undos: 1")).toBeTruthy();
  });

  it("announces a repeated Hint on the same notice again", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    mockSolveBoard.mockResolvedValue({ verdict: "unknown" });
    const r = await openPing();
    await tapHint(r);
    await r.findByText("Couldn't find a hint");
    await tapHint(r);
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(2));
    announce.mockRestore();
  });

  it("shows the notice without changing the board's size", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "unsolvable" });
    const r = await openPing();
    await act(async () => {
      fireEvent(r.getByTestId("sort-board"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 600 } },
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heightBefore = (global as any).__sortBoardLastProps.availableHeight;
    expect(heightBefore).toBe(600 - 16);
    await tapHint(r);
    const notice = await r.findByTestId("sort-hint-notice");
    expect(StyleSheet.flatten(notice.props.style).position).toBe("absolute");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((global as any).__sortBoardLastProps.availableHeight).toBe(heightBefore);
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Dismiss" }));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((global as any).__sortBoardLastProps.availableHeight).toBe(heightBefore);
  });
});

// ---------------------------------------------------------------------------
// #3658 — the bottom action bar, Colorblind Mode in the ⋯ menu, the hint's destination
// ---------------------------------------------------------------------------

describe("SortScreen — action bar, menu toggle and hint destination (#3658)", () => {
  const LEVEL = [{ id: 1, bottles: [["blue", "red"], ["red"], []] }];
  type Rendered = Awaited<ReturnType<typeof renderScreen>>;

  async function openLevel() {
    playOnLevels(LEVEL);
    const r = await renderScreen();
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Level 1"));
    });
    return r;
  }
  const tapHint = (r: Rendered) =>
    act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Hint" }));
    });
  const lastProps = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__sortBoardLastProps;

  afterEach(() => mockSolveBoard.mockReset());

  it("puts Hint and Undo in the bar under the board, not in the header", async () => {
    const r = await openLevel();
    const bar = r.getByTestId("sort-action-bar");
    expect(within(bar).getByRole("button", { name: "Hint" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(r.getByTestId("sort-hint-button")).toBeTruthy();
    expect(r.getByTestId("sort-undo-button")).toBeTruthy();
    expect(StyleSheet.flatten(bar.props.style).height).toBe(54);
  });

  it("keeps the bar after the board in reading order", async () => {
    const r = await openLevel();
    const flat = JSON.stringify(r.toJSON());
    const at = (id: string) => flat.indexOf(`"testID":"${id}"`);
    expect(at("sort-board")).toBeGreaterThan(-1);
    expect(at("sort-action-bar")).toBeGreaterThan(at("sort-board"));
  });

  it("Undo is off with no history and on after a pour; Hint is on", async () => {
    const r = await openLevel();
    expect(r.getByRole("button", { name: "Undo" }).props.accessibilityState.disabled).toBe(true);
    expect(r.getByRole("button", { name: "Hint" }).props.accessibilityState.disabled).toBe(false);
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 2,/));
    });
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(/^Bottle 1,/));
    });
    await act(async () => {
      lastProps().onPourComplete();
    });
    expect(r.getByRole("button", { name: "Undo" }).props.accessibilityState.disabled).toBe(false);
  });

  it("shows Hint's busy state in the bar while the solver runs", async () => {
    mockSolveBoard.mockImplementation(() => new Promise(() => {}));
    const r = await openLevel();
    // Not awaited: the solver promise is held open on purpose.
    await act(async () => {
      void fireEvent.press(r.getByRole("button", { name: "Hint" }));
    });
    const hint = r.getByRole("button", { name: "Hint" });
    expect(hint.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(r.getByTestId("sort-hint-button-busy")).toBeTruthy();
  });

  it("has no Colorblind row on the screen; the menu item toggles the mode and is checked", async () => {
    const r = await openLevel();
    expect(r.queryByRole("switch")).toBeNull();
    expect(lastProps().colorblindMode).toBe(false);
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "More options" }));
    });
    const item = r.getByTestId("sort-colorblind-toggle");
    expect(item.props.accessibilityState).toEqual({ checked: false });
    expect(within(item).getByText("Colorblind Mode")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(item);
    });
    expect(lastProps().colorblindMode).toBe(true);
    expect(r.getByTestId("sort-colorblind-toggle").props.accessibilityState).toEqual({
      checked: true,
    });
  });

  it("a hint selects the source and rings the destination", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "solvable", moves: [{ from: 1, to: 0 }] });
    const r = await openLevel();
    expect(r.queryByTestId("hint-dst-ring", { includeHiddenElements: true })).toBeNull();
    await tapHint(r);
    expect(await r.findByLabelText(/Bottle 2 selected/)).toBeTruthy();
    expect(lastProps().hintTo).toBe(0);
    // Screen readers learn the destination from its label (the ring is hidden from them).
    expect(r.getByLabelText(/^Bottle 1,.*Hint: pour here$/)).toBeTruthy();
    expect(
      within(r.getByTestId("bottle-cell-0")).getByTestId("hint-dst-ring", {
        includeHiddenElements: true,
      })
    ).toBeTruthy();
  });

  it("clears the destination ring when the selection changes", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "solvable", moves: [{ from: 1, to: 0 }] });
    const r = await openLevel();
    await tapHint(r);
    await r.findByTestId("hint-dst-ring", { includeHiddenElements: true });
    await act(async () => {
      await fireEvent.press(r.getByLabelText(/Bottle 2 selected/));
    });
    expect(r.queryByTestId("hint-dst-ring", { includeHiddenElements: true })).toBeNull();
  });

  it("clears the destination ring when a pour starts, and on undo", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "solvable", moves: [{ from: 1, to: 0 }] });
    const r = await openLevel();
    await tapHint(r);
    await r.findByTestId("hint-dst-ring", { includeHiddenElements: true });
    await act(async () => {
      await fireEvent.press(r.getByLabelText(/^Bottle 1,/));
    });
    expect(r.queryByTestId("hint-dst-ring", { includeHiddenElements: true })).toBeNull();
    expect(lastProps().hintTo).toBeNull();
    await act(async () => {
      lastProps().onPourComplete();
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Undo" }));
    });
    expect(r.queryByTestId("hint-dst-ring", { includeHiddenElements: true })).toBeNull();
  });

  it("clears the destination ring on restart", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "solvable", moves: [{ from: 1, to: 0 }] });
    const r = await openLevel();
    await tapHint(r);
    await r.findByTestId("hint-dst-ring", { includeHiddenElements: true });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "More options" }));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Start New" }));
    });
    expect(r.queryByTestId("hint-dst-ring", { includeHiddenElements: true })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #3660 — motion events and haptics, and the win cascade the result card waits for
// ---------------------------------------------------------------------------

describe("SortScreen — motion events, haptics and the win cascade (#3660)", () => {
  // Level 1 solves in one pour (bottle 2 -> bottle 1). Level 2 completes a bottle without a win.
  const WIN_LEVEL = { id: 1, bottles: [["red", "red", "red"], ["red"]] };
  const BOTTLE_LEVEL = {
    id: 2,
    bottles: [["red", "red", "red"], ["blue", "red"], ["blue"], []],
  };
  const lastProps = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__sortBoardLastProps;
  const impact = Haptics.impactAsync as jest.Mock;
  const notify = Haptics.notificationAsync as jest.Mock;
  type Rendered = Awaited<ReturnType<typeof renderScreen>>;
  const press = (r: Rendered, label: RegExp | string) =>
    act(async () => {
      await fireEvent.press(await r.findByLabelText(label));
    });
  const land = () =>
    act(async () => {
      lastProps().onPourComplete();
    });
  /** Reports a layout for every row and cell, so a pour is drawn and lands on its callback. */
  async function layOutBoard(r: Rendered) {
    await act(async () => {
      await fireEvent(r.getByTestId("sort-grid"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 300 } },
      });
      for (const [i, row] of r.getAllByTestId(/^sort-row-\d+$/).entries()) {
        await fireEvent(row, "layout", {
          nativeEvent: { layout: { x: 0, y: i * 160, width: 300, height: 150 } },
        });
      }
      for (const [i, cell] of r.getAllByTestId(/^bottle-cell-\d+$/).entries()) {
        await fireEvent(cell, "layout", {
          nativeEvent: { layout: { x: (i % 2) * 100, y: 0, width: 90, height: 150 } },
        });
      }
    });
  }
  async function openLevel(level: { id: number }, levels = [WIN_LEVEL, BOTTLE_LEVEL]) {
    playOnLevels(levels);
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 2,
      currentLevelId: null,
      currentState: null,
    });
    const r = await renderScreen();
    await press(r, `Level ${level.id}`);
    await layOutBoard(r);
    return r;
  }
  async function winLevelOne(r: Rendered) {
    await press(r, /^Bottle 2,/);
    await press(r, /^Bottle 1,/);
    await land();
  }

  beforeEach(() => {
    resetReduceMotionForTests();
    impact.mockReset().mockResolvedValue(undefined);
    notify.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    resetReduceMotionForTests();
  });

  describe("win cascade", () => {
    it("holds the result card until the cascade ends, while the score is recorded at once", async () => {
      const r = await openLevel(WIN_LEVEL);
      await winLevelOne(r);
      expect(lastProps().winCascade).toBe(true);
      expect(r.queryByTestId("sort-result")).toBeNull();
      // The data is not held back by the cascade: moves, undos and the outcome go out now.
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      expect(mockCompleteGame.mock.calls[0]![2]).toEqual(
        expect.objectContaining({ outcome: "completed", won: true, moves: 1, undos: 0 })
      );
      await act(async () => {
        lastProps().onWinCascadeDone();
      });
      expect(await r.findByTestId("sort-result")).toBeTruthy();
      expect(lastProps().winCascade).toBe(false);
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    });

    it("opens the card when the cascade's own timer ends, not before", async () => {
      const r = await openLevel(WIN_LEVEL);
      await press(r, /^Bottle 2,/);
      await press(r, /^Bottle 1,/);
      jest.useFakeTimers();
      await land();
      await act(async () => {
        jest.advanceTimersByTime(WIN_CASCADE_MS - 1);
      });
      expect(r.queryByTestId("sort-result")).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(r.getByTestId("sort-result")).toBeTruthy();
    });

    it("a tap skips the cascade and the card opens", async () => {
      const r = await openLevel(WIN_LEVEL);
      await winLevelOne(r);
      expect(r.queryByTestId("sort-result")).toBeNull();
      await act(async () => {
        await fireEvent.press(
          r.getByTestId("sort-win-cascade-skip", { includeHiddenElements: true })
        );
      });
      expect(await r.findByTestId("sort-result")).toBeTruthy();
    });

    it("Reduce Motion opens the card at once, with no cascade", async () => {
      const query = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
      try {
        const r = await openLevel(WIN_LEVEL);
        await winLevelOne(r);
        expect(lastProps().winCascade).toBe(false);
        expect(await r.findByTestId("sort-result")).toBeTruthy();
      } finally {
        query.mockRestore();
      }
    });

    it("Undo is ignored while the cascade plays", async () => {
      const r = await openLevel(WIN_LEVEL);
      await winLevelOne(r);
      expect(r.getByRole("button", { name: "Undo" }).props.accessibilityState.disabled).toBe(true);
      expect(lastProps().undoSeq).toBe(0);
    });

    it("leaving the board mid-cascade never opens the card", async () => {
      const r = await openLevel(WIN_LEVEL);
      await winLevelOne(r);
      await press(r, "Back to levels");
      expect(await r.findByText("Choose a Level")).toBeTruthy();
      expect(r.queryByTestId("sort-result")).toBeNull();
    });

    it("plays the cascade again for a replay of the level, not for closing the card", async () => {
      const r = await openLevel(WIN_LEVEL, [WIN_LEVEL]); // the last level replays
      await winLevelOne(r);
      await act(async () => {
        lastProps().onWinCascadeDone();
      });
      await act(async () => {
        await fireEvent.press(
          within(await r.findByTestId("sort-result")).getByRole("button", { name: "Play Again" })
        );
      });
      expect(lastProps().winCascade).toBe(false);
      await winLevelOne(r);
      expect(lastProps().winCascade).toBe(true);
    });
  });

  describe("level in, undo and refused pour", () => {
    it("a new level drops in; a restored game plays nothing", async () => {
      const r = await openLevel(WIN_LEVEL);
      expect(lastProps().levelIn).toBe(true);
      await r.unmount();

      playOnLevels([WIN_LEVEL, BOTTLE_LEVEL]);
      storage.loadProgress.mockResolvedValue({
        unlockedLevel: 2,
        currentLevelId: 2,
        currentState: initState(BOTTLE_LEVEL.bottles as Color[][]),
      });
      const restored = await renderScreen();
      await press(restored, "Continue Level 2");
      expect(lastProps().levelIn).toBe(false);
      expect(lastProps().winCascade).toBe(false);
      expect(lastProps().refused).toBeNull();
      expect(lastProps().undoSeq).toBe(0);
      expect(impact).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("bumps the undo clock once per undo", async () => {
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 2,/);
      await press(r, /^Bottle 1,/);
      await land();
      expect(lastProps().undoSeq).toBe(0);
      await act(async () => {
        await fireEvent.press(r.getByRole("button", { name: "Undo" }));
      });
      expect(lastProps().undoSeq).toBe(1);
    });

    it("a refused pour shakes the tapped destination once and clears the selection", async () => {
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 3,/); // ["blue"]
      await press(r, /^Bottle 1,/); // red on top: refused
      expect(lastProps().refused).toEqual({ index: 0, seq: 1 });
      expect(lastProps().state.selectedBottleIndex).toBeNull();
      // Taps are never blocked by the shake: the next select is taken at once.
      await press(r, /^Bottle 3,/);
      expect(lastProps().state.selectedBottleIndex).toBe(2);
      await press(r, /^Bottle 1,/);
      expect(lastProps().refused).toEqual({ index: 0, seq: 2 });
    });
  });

  describe("haptics", () => {
    it("select: one light impact; deselecting fires none", async () => {
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 2,/);
      expect(impact).toHaveBeenCalledTimes(1);
      expect(impact).toHaveBeenCalledWith("light");
      await press(r, /^Bottle 2 selected/);
      expect(impact).toHaveBeenCalledTimes(1);
      expect(notify).not.toHaveBeenCalled();
    });

    it("an empty bottle with nothing selected fires nothing", async () => {
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 4,/);
      expect(impact).not.toHaveBeenCalled();
    });

    it("refused pour: one warning notification", async () => {
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 3,/);
      impact.mockClear();
      await press(r, /^Bottle 1,/);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith("warning");
      expect(impact).not.toHaveBeenCalled();
    });

    it("pour: a medium impact when it lands, not when it starts", async () => {
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 3,/);
      impact.mockClear();
      await press(r, /^Bottle 4,/); // blue into the empty bottle: a pour in flight
      expect(impact).toHaveBeenCalledTimes(0);
      await land();
      expect(impact).toHaveBeenCalledTimes(1);
      expect(impact).toHaveBeenCalledWith("medium");
    });

    it("a pour that completes a bottle adds one success; the winning pour adds none of its own", async () => {
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 2,/);
      await press(r, /^Bottle 1,/);
      notify.mockClear();
      impact.mockClear();
      await land();
      expect(impact).toHaveBeenCalledWith("medium");
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith("success");
      await r.unmount();

      // The winning pour: medium on landing; the success pulse is the card's, once, after the cascade.
      const w = await openLevel(WIN_LEVEL);
      notify.mockClear();
      await winLevelOne(w);
      expect(notify).not.toHaveBeenCalled();
      await act(async () => {
        lastProps().onWinCascadeDone();
      });
      await w.findByTestId("sort-result");
      expect(notify.mock.calls.filter(([kind]) => kind === "success")).toHaveLength(1);
    });

    it("a cancelled pour fires nothing", async () => {
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 2,/);
      await press(r, /^Bottle 1,/);
      impact.mockClear();
      notify.mockClear();
      await act(async () => {
        await fireEvent.press(r.getByRole("button", { name: "More options" }));
      });
      await act(async () => {
        await fireEvent.press(r.getByText("New Game"));
      });
      await act(async () => {
        await fireEvent.press(r.getByRole("button", { name: "Start New" }));
      });
      await land();
      expect(impact).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("a haptic that rejects or throws never breaks play", async () => {
      impact.mockRejectedValue(new Error("no haptics"));
      notify.mockImplementation(() => {
        throw new Error("no module");
      });
      const r = await openLevel(BOTTLE_LEVEL);
      await press(r, /^Bottle 3,/);
      await press(r, /^Bottle 1,/); // refused: the warning throws
      expect(lastProps().state.selectedBottleIndex).toBeNull();
      await press(r, /^Bottle 2,/); // select: the impact rejects
      await press(r, /^Bottle 1,/);
      await land(); // the landing impact rejects, the move still lands
      expect(lastProps().state.moveCount).toBe(1);
    });
  });
});
