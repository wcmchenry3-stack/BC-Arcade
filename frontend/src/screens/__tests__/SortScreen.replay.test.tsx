/**
 * SortScreen — replay recording (#3385, #3386, epic #3383).
 *
 * What the screen hands the shared recorder as a level is played: landed pours,
 * undos that changed the board, hints shown and "back to last good move", in
 * `moves` chunks after the level's `game_started`; flushed before the session
 * ends, on leaving the board, on background, blur and unmount; the unit count
 * saved with the board and carried on (or blocked) when it is restored. The
 * builders, the chunking and `rebuild` are tested in
 * game/sort/__tests__/replay.test.ts.
 */

import fs from "fs";
import path from "path";
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import SortScreen from "../SortScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { GameRecorder } from "../../game/_shared/gameRecorder";
import { SORT_MAX_UNITS } from "../../game/_shared/eventQueueConfig";
import { applyPour, initState } from "../../game/sort/engine";
import { rebuild, SORT_REPLAY_ENGINE_VERSION, type Action } from "../../game/sort/replay";
import type { CatalogLevel } from "../../game/sort/catalog";
import type { SortProgress } from "../../game/sort/storage";
import type { Color, SortState } from "../../game/sort/types";

// ---------------------------------------------------------------------------
// Module mocks (as SortScreen.test.tsx)
// ---------------------------------------------------------------------------

// Pass-through to the real solver unless a test sets an implementation.
const mockSolveBoard = jest.fn();
// The real action bar, with its latest actions kept so a test can call a
// handler the bar's `disabled` would otherwise swallow.
const mockActionBar = {
  actions: [] as readonly { key: string; onPress: () => void }[],
  press(key: string) {
    const action = mockActionBar.actions.find((a) => a.key === key);
    if (!action) throw new Error(`no action ${key}`);
    action.onPress();
  },
};
jest.mock("../../components/shared/GameActionBar", () => {
  const actual = jest.requireActual("../../components/shared/GameActionBar");
  const R = jest.requireActual("react");
  return {
    __esModule: true,
    ...actual,
    default: (props: { actions: typeof mockActionBar.actions }) => {
      mockActionBar.actions = props.actions;
      return R.createElement(actual.default, props);
    },
  };
});

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

// Keeps SortBoard's latest props, so a test lands a pour (`onPourComplete`).
// With no layout in tests SortBoard finishes a pour as soon as it starts; while
// `mockHoldPours.on` it can't, so the pour stays in flight until `land()`.
const mockHoldPours = { on: false };
jest.mock("../../components/sort/SortBoard", () => {
  const mod = jest.requireActual("../../components/sort/SortBoard");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockSortBoard(props: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__sortBoardLastProps = props;
    const onPourComplete = () => {
      if (!mockHoldPours.on) props.onPourComplete?.();
    };
    return React.createElement(mod.default, { ...props, onPourComplete });
  }
  MockSortBoard.displayName = "SortBoard";
  return { __esModule: true, default: MockSortBoard };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

jest.mock("../../game/sort/useSortAudio", () => {
  const audio = {
    playSelect: jest.fn(),
    playPour: jest.fn(),
    cancelPour: jest.fn(),
    playRefused: jest.fn(),
    playComplete: jest.fn(),
    playUndo: jest.fn(),
    playHint: jest.fn(),
    playWin: jest.fn(),
  };
  return { useSortAudio: () => audio };
});

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
      goBack: jest.fn(),
      popToTop: jest.fn(),
      navigate: jest.fn(),
      addListener: mockAddListener,
    }),
    { actual: true }
  )
);

type SavedEvent = { type: string; data: Record<string, unknown> };
const mockStartGame = jest.fn<string, [string, Record<string, unknown>, Record<string, unknown>]>();
// The recorder saves a unit's events in one call (#3274): [gameId, events].
const mockEnqueueEvents = jest.fn<undefined, [string, SavedEvent[]]>();
const mockCompleteGame = jest.fn();
const mockResumeGame = jest.fn<string | null, [string, unknown?]>();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
    resumeGame: lazy(() => mockResumeGame),
  });
});

jest.mock("../../game/_shared/NetworkContext", () => mockScreenDeps().mockNetwork());

jest.mock("../../game/sort/catalog", () => ({
  ...jest.requireActual("../../game/sort/catalog"),
  SORT_LEVELS: [],
}));
const catalogMock = jest.requireMock("../../game/sort/catalog") as { SORT_LEVELS: unknown[] };
const realCatalog = jest.requireActual("../../game/sort/catalog") as {
  SORT_LEVELS: readonly CatalogLevel[];
  SORT_CATALOG_VERSION: number;
};
function playOnLevels(levels: readonly unknown[]) {
  catalogMock.SORT_LEVELS.splice(0, catalogMock.SORT_LEVELS.length, ...levels);
}

jest.mock("../../game/sort/catalogMigration", () => ({
  migrateToCatalog: () => Promise.resolve("current"),
}));

jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getLeaderboard: jest.fn() }));
jest.mock("../../game/_shared/lookupGameRank", () => ({
  ...jest.requireActual("../../game/_shared/lookupGameRank"),
  lookupGameRank: () => Promise.resolve({ kind: "ranked", rank: 1 }),
}));

jest.mock("../../game/sort/storage", () => {
  const actual = jest.requireActual("../../game/sort/storage");
  return {
    ...actual,
    loadProgress: jest.fn(),
    saveProgress: jest.fn(),
    clearGame: jest.fn(),
    loadBestMoves: jest.fn(),
    saveBestMoves: jest.fn(),
  };
});
const storage = jest.requireMock("../../game/sort/storage") as {
  loadProgress: jest.Mock;
  saveProgress: jest.Mock;
  loadBestMoves: jest.Mock;
  saveBestMoves: jest.Mock;
};

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** Two empty bottles: one ball can go back and forth (2 -> 3, 3 -> 2) as long as a test needs. */
const PING = { id: 1, bottles: [["red", "blue"], ["blue", "red"], [], []] };
/** Solved by one pour, bottle 1 -> 0. */
const ONE_POUR = { id: 1, bottles: [["red", "red", "red"], ["red"]] };
/** Dead after 1->3, 0->1, 2->1 (as SortScreen.test.tsx's Hint tests). */
const DEAD = {
  id: 1,
  bottles: [
    ["red", "red", "red", "green"],
    ["red", "green", "blue", "blue"],
    ["blue", "blue", "green", "green"],
    [],
  ],
};

const board = (bottles: readonly (readonly string[])[]): SortState =>
  initState(bottles.map((b) => [...b]) as (Color | "")[][]);

type Rendered = Awaited<ReturnType<typeof renderScreen>>;

async function renderScreen() {
  const r = await render(
    <ThemeProvider>
      <SortScreen />
    </ThemeProvider>
  );
  await r.findByText("Choose a Level");
  return r;
}

async function openLevel(r: Rendered, id = 1) {
  await act(async () => {
    await fireEvent.press(await r.findByLabelText(`Level ${id}`));
  });
}

async function continueLevel(r: Rendered, id = 1) {
  await act(async () => {
    await fireEvent.press(await r.findByLabelText(`Continue Level ${id}`));
  });
}

/** Taps `from` then `to` (0-based): the pour starts but does not land. */
async function tapPour(r: Rendered, from: number, to: number) {
  await act(async () => {
    await fireEvent.press(await r.findByLabelText(new RegExp(`^Bottle ${from + 1},`)));
  });
  await act(async () => {
    await fireEvent.press(await r.findByLabelText(new RegExp(`^Bottle ${to + 1},`)));
  });
}

/** SortBoard's animation ends: the pour in flight lands. */
async function land() {
  await act(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__sortBoardLastProps?.onPourComplete?.();
  });
}

async function pour(r: Rendered, from: number, to: number) {
  await tapPour(r, from, to);
  await land();
}

async function press(r: Rendered, name: string) {
  await act(async () => {
    await fireEvent.press(r.getByRole("button", { name }));
  });
}

async function newGameFromMenu(r: Rendered) {
  await press(r, "More options");
  await act(async () => {
    await fireEvent.press(r.getByText("New Game"));
  });
  await press(r, "Start New");
}

/** Every `moves` event the recorder saved, in order, with the game it went to. */
function savedMoves(): { gameId: string; data: Record<string, unknown> }[] {
  return mockEnqueueEvents.mock.calls.flatMap(([gameId, events]) =>
    events.filter((e) => e.type === "moves").map((e) => ({ gameId, data: e.data }))
  );
}
const entries = (): Action[] => savedMoves().flatMap((e) => e.data.m as Action[]);

let appStateListeners: Set<(s: AppStateStatus) => void>;
const setAppState = (s: AppStateStatus) =>
  act(async () => appStateListeners.forEach((cb) => cb(s)));
const blur = () => act(async () => mockNavListeners.get("blur")?.forEach((cb) => cb()));

const lastSave = (): SortProgress => storage.saveProgress.mock.calls.at(-1)![0] as SortProgress;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockNavListeners.clear();
  mockSolveBoard.mockReset();
  mockHoldPours.on = false;
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-1");
  mockEnqueueEvents.mockReset();
  mockCompleteGame.mockReset();
  mockResumeGame.mockReset();
  mockResumeGame.mockReturnValue(null);
  playOnLevels([PING]);
  storage.loadBestMoves.mockResolvedValue({});
  storage.loadProgress.mockResolvedValue({
    unlockedLevel: 1,
    currentLevelId: null,
    currentState: null,
  });
  storage.saveProgress.mockResolvedValue(undefined);
  storage.saveBestMoves.mockResolvedValue(true);
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

// ---------------------------------------------------------------------------
// What is recorded
// ---------------------------------------------------------------------------

describe("SortScreen — replay recording (#3385)", () => {
  it("opens the session with the level's identity before the first pour's action", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    await setAppState("background");

    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockStartGame.mock.calls[0]![2]).toEqual({
      level: 1,
      catalog: realCatalog.SORT_CATALOG_VERSION,
      engine_version: SORT_REPLAY_ENGINE_VERSION,
    });
    expect(entries()).toEqual([[0, 0, 2]]);
    expect(mockStartGame.mock.invocationCallOrder[0]!).toBeLessThan(
      mockEnqueueEvents.mock.invocationCallOrder[0]!
    );
    await r.unmount();
  });

  it("records a pour when it lands, never at the tap", async () => {
    const r = await renderScreen();
    await openLevel(r);
    mockHoldPours.on = true;
    await tapPour(r, 0, 2);
    await setAppState("background"); // flushes: the pour has not landed
    expect(entries()).toEqual([]);
    await setAppState("active");
    await land();
    await setAppState("background");
    expect(entries()).toEqual([[0, 0, 2]]);
    await r.unmount();
  });

  it("records nothing for a pour cancelled by New Game mid-animation", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    mockHoldPours.on = true;
    await tapPour(r, 1, 3); // in flight
    await newGameFromMenu(r);
    await land(); // nothing pending: a no-op
    expect(r.getByText("Moves: 0")).toBeTruthy();
    // The abandon flushed the level's actions to its own session before its end.
    expect(entries()).toEqual([[0, 0, 2]]);
    expect(mockEnqueueEvents.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );
    expect(mockCompleteGame.mock.calls[0]![1].outcome).toBe("abandoned");
    await r.unmount();
    expect(entries()).toEqual([[0, 0, 2]]);
  });

  it("records nothing for a pour cancelled by going back to the level grid", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    mockHoldPours.on = true;
    await tapPour(r, 1, 3);
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Back to levels"));
    });
    await land();
    await r.unmount();
    expect(entries()).toEqual([[0, 0, 2]]);
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]!).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );
  });

  it("records an undo only when there was a move to take back", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    await press(r, "Undo");
    await press(r, "Undo"); // nothing left to take back
    // The button is disabled without history; call its handler anyway (a stray
    // press racing the disable), so the screen's own guard is covered.
    await act(async () => {
      mockActionBar.press("undo");
    });
    await setAppState("background");
    expect(entries()).toEqual([[0, 0, 2], [1]]);
    expect(r.getByText("Undos: 1")).toBeTruthy();
    await r.unmount();
  });

  it("records a hint that is shown, with its pour", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "solvable", moves: [{ from: 1, to: 3 }] });
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    await press(r, "Hint");
    await setAppState("background");
    expect(entries()).toEqual([
      [0, 0, 2],
      [2, 1, 3],
    ]);
    await r.unmount();
  });

  it("records no hint for a dead or unknown verdict, nor for a solvable one with no move", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    mockSolveBoard.mockResolvedValue({ verdict: "unsolvable" });
    await press(r, "Hint");
    await waitFor(() => expect(r.getByText("No way to win from here")).toBeTruthy());
    await press(r, "Dismiss");
    mockSolveBoard.mockResolvedValue({ verdict: "unknown" });
    await press(r, "Hint");
    mockSolveBoard.mockResolvedValue({ verdict: "solvable", moves: [] });
    await press(r, "Hint");
    await setAppState("background");
    expect(entries()).toEqual([[0, 0, 2]]);
    await r.unmount();
  });

  it("records no hint whose answer arrives after the board changed", async () => {
    let resolveHint: (v: unknown) => void = () => undefined;
    mockSolveBoard.mockImplementation(() => new Promise((resolve) => (resolveHint = resolve)));
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    await act(async () => {
      void fireEvent.press(r.getByRole("button", { name: "Hint" }));
    });
    await pour(r, 2, 3); // the board changes while the solver runs
    await act(async () => {
      resolveHint({ verdict: "solvable", moves: [{ from: 1, to: 2 }] });
    });
    await setAppState("background");
    expect(entries()).toEqual([
      [0, 0, 2],
      [0, 2, 3],
    ]);
    await r.unmount();
  });

  it("records back to last good move as one rewind of the moves it undid", async () => {
    playOnLevels([DEAD]);
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 1, 3); // still solvable
    await pour(r, 0, 1); // dead from here
    await pour(r, 2, 1);
    await press(r, "Hint");
    await act(async () => {
      await fireEvent.press(await r.findByRole("button", { name: "Back to last good move" }));
    });
    await waitFor(() => expect(r.getByText("Moves: 1")).toBeTruthy());
    expect(r.getByText("Undos: 2")).toBeTruthy();
    await setAppState("background");
    expect(entries()).toEqual([
      [0, 1, 3],
      [0, 0, 1],
      [0, 2, 1],
      [3, 2],
    ]);
    await r.unmount();
  });

  it("a win saves the level's actions before its game_ended", async () => {
    playOnLevels([ONE_POUR, { ...ONE_POUR, id: 2 }]);
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 1, 0);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1].outcome).toBe("completed");
    expect(entries()).toEqual([[0, 1, 0]]);
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]!).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );
    // The solved level leaves no board, and no replay count, in the save.
    expect(lastSave()).not.toHaveProperty("replayUnit");
    await r.unmount();
  });

  it("a recorded level rebuilds to the board, moves and undos played (the shipped catalog's level 1)", async () => {
    const level = realCatalog.SORT_LEVELS[0]!;
    playOnLevels([level]);
    const opening = board(level.bottles);
    const { solve } = jest.requireActual(
      "../../game/sort/solver"
    ) as typeof import("../../game/sort/solver");
    const solution = solve(opening)!;
    expect(solution.length).toBeGreaterThan(1);

    const r = await renderScreen();
    await openLevel(r);
    // A detour first: a pour, taken back.
    await pour(r, solution[0]!.from, solution[0]!.to);
    await press(r, "Undo");
    mockSolveBoard.mockResolvedValue({ verdict: "solvable", moves: [solution[0]!] });
    await press(r, "Hint");
    // The hint selected the first pour's source: one tap on its destination pours.
    await act(async () => {
      await fireEvent.press(await r.findByLabelText(new RegExp(`^Bottle ${solution[0]!.to + 1},`)));
    });
    await land();
    for (const m of solution.slice(1)) await pour(r, m.from, m.to);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);

    const actions = entries();
    expect(actions[0]).toEqual([0, solution[0]!.from, solution[0]!.to]);
    expect(actions[1]).toEqual([1]);
    expect(actions[2]).toEqual([2, solution[0]!.from, solution[0]!.to]);
    const rebuilt = rebuild(opening, actions);
    expect(rebuilt.error).toBeUndefined();
    expect(rebuilt.state.isComplete).toBe(true);
    const payload = mockCompleteGame.mock.calls[0]![2] as { moves: number; undos: number };
    expect(rebuilt.state.moveCount).toBe(payload.moves);
    expect(rebuilt.state.undosUsed).toBe(payload.undos);
    expect(rebuilt.state.undosUsed).toBe(1);
    await r.unmount();
  });
});

// ---------------------------------------------------------------------------
// When it is saved
// ---------------------------------------------------------------------------

describe("SortScreen — replay flush points (#3385)", () => {
  it("hands the chunk over on background, not on inactive, and saves the board with the new count", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    await setAppState("inactive");
    expect(savedMoves()).toEqual([]);
    storage.saveProgress.mockClear();
    await setAppState("background");
    expect(savedMoves()).toHaveLength(1);
    expect(savedMoves()[0]!.data.unit).toBe(1);
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(storage.saveProgress).toHaveBeenCalledTimes(1);
    expect(lastSave()).toEqual(
      expect.objectContaining({ currentLevelId: 1, replayUnit: 1, replayPending: 0 })
    );
    // The level goes on: the next chunk is the next unit.
    await setAppState("active");
    await pour(r, 2, 3);
    await setAppState("background");
    expect(savedMoves().map((e) => e.data.unit)).toEqual([1, 2]);
    await r.unmount();
  });

  it("does not hand the chunk over when another screen covers the game: a blur spends no row", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    await blur();
    expect(savedMoves()).toEqual([]);
    // The board's save already holds the action still waiting.
    expect(lastSave()).toEqual(expect.objectContaining({ replayUnit: 0, replayPending: 1 }));
    await pour(r, 2, 3);
    await setAppState("background");
    // One row for both pours, the one before the blur included.
    expect(savedMoves()).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          unit: 1,
          m: [
            [0, 0, 2],
            [0, 2, 3],
          ],
        }),
      }),
    ]);
    await r.unmount();
  });

  it("saves the actions still waiting with each board, for a later load to check", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    expect(lastSave()).toEqual(expect.objectContaining({ replayUnit: 0, replayPending: 1 }));
    await press(r, "Undo");
    expect(lastSave()).toEqual(expect.objectContaining({ replayUnit: 0, replayPending: 2 }));
    await r.unmount();
  });

  it("hands what is waiting over on unmount, before the abandon's game_ended", async () => {
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    expect(savedMoves()).toEqual([]);
    await r.unmount();
    expect(entries()).toEqual([[0, 0, 2]]);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]!).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0]!
    );
  });

  it("a new level starts its own count: each level's chunks go to its own session from unit 1", async () => {
    mockStartGame.mockReturnValueOnce("game-1").mockReturnValueOnce("game-2");
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    await newGameFromMenu(r);
    await pour(r, 1, 3);
    await r.unmount();
    expect(savedMoves()).toEqual([
      { gameId: "game-1", data: expect.objectContaining({ unit: 1, m: [[0, 0, 2]] }) },
      { gameId: "game-2", data: expect.objectContaining({ unit: 1, m: [[0, 1, 3]] }) },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Restored boards, caps and failures (#3386)
// ---------------------------------------------------------------------------

describe("SortScreen — replay across restarts (#3386)", () => {
  const afterOnePour = applyPour(board(PING.bottles), 0, 2);
  const restore = (extra: Partial<SortProgress>) =>
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: 1,
      currentLevelId: 1,
      currentState: afterOnePour,
      ...extra,
    });

  it("a resumed session carries the saved unit count on", async () => {
    restore({ replayUnit: 3, replayPending: 0, replayGameId: "killed-session" });
    mockResumeGame.mockReturnValue("killed-session");
    const r = await renderScreen();
    await continueLevel(r);
    await pour(r, 2, 3);
    await setAppState("background");
    expect(mockStartGame).not.toHaveBeenCalled();
    expect(savedMoves()).toEqual([
      { gameId: "killed-session", data: expect.objectContaining({ unit: 4, m: [[0, 2, 3]] }) },
    ]);
    expect(lastSave()).toEqual(expect.objectContaining({ replayUnit: 4 }));
    await r.unmount();
  });

  /** The save as it stands now, then the app is "killed" (the screen goes, the save stays). */
  async function killAfter(r: Rendered): Promise<SortProgress> {
    const saved = lastSave();
    await r.unmount();
    mockEnqueueEvents.mockClear();
    storage.loadProgress.mockResolvedValue(saved);
    return saved;
  }

  it("a resume after a background flush continues at the next unit: no unit number repeats", async () => {
    mockStartGame.mockReturnValue("game-1");
    const first = await renderScreen();
    await openLevel(first);
    await pour(first, 0, 2);
    await setAppState("background"); // unit 1 handed over, and saved with the board
    expect(savedMoves().map((e) => e.data.unit)).toEqual([1]);
    const saved = await killAfter(first);
    expect(saved).toEqual(
      expect.objectContaining({ replayUnit: 1, replayPending: 0, replayGameId: "game-1" })
    );

    mockResumeGame.mockReturnValue("game-1");
    const second = await renderScreen();
    await continueLevel(second);
    await pour(second, 2, 3);
    await setAppState("background");
    expect(savedMoves()).toEqual([
      { gameId: "game-1", data: expect.objectContaining({ unit: 2, m: [[0, 2, 3]] }) },
    ]);
    await second.unmount();
  });

  it("a save from before a unit was handed over (a kill before the next save) blocks rather than reuse the unit", async () => {
    const first = await renderScreen();
    await openLevel(first);
    await pour(first, 0, 2);
    // The board's save holds one action waiting; a kill lands before the flush's save.
    const stale = lastSave();
    expect(stale).toEqual(expect.objectContaining({ replayUnit: 0, replayPending: 1 }));
    await setAppState("background"); // unit 1 reaches the recorder
    await first.unmount();
    mockEnqueueEvents.mockClear();
    storage.loadProgress.mockResolvedValue(stale);

    mockResumeGame.mockReturnValue("game-1");
    const second = await renderScreen();
    await continueLevel(second);
    await pour(second, 2, 3);
    await setAppState("background");
    await second.unmount();
    expect(savedMoves()).toEqual([]);
  });

  it("a restored board in a new session records nothing, and saves the block", async () => {
    restore({ replayUnit: 3, replayPending: 0 });
    mockResumeGame.mockReturnValue(null);
    const r = await renderScreen();
    await continueLevel(r);
    await pour(r, 2, 3);
    await press(r, "Undo");
    await setAppState("background");
    // The level is still counted: its session opened with the level's identity.
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(savedMoves()).toEqual([]);
    expect(lastSave()).toEqual(expect.objectContaining({ replayUnit: SORT_MAX_UNITS }));
    await r.unmount();
    expect(savedMoves()).toEqual([]);
  });

  it("stays blocked when that board is resumed after another kill", async () => {
    restore({ replayUnit: SORT_MAX_UNITS, replayPending: 0, replayGameId: "blocked-session" });
    mockResumeGame.mockReturnValue("blocked-session");
    const r = await renderScreen();
    await continueLevel(r);
    await pour(r, 2, 3);
    await r.unmount();
    expect(savedMoves()).toEqual([]);
  });

  it("does not carry on a resumed log with a hole: actions a kill lost before they were handed over", async () => {
    restore({ replayUnit: 1, replayPending: 4, replayGameId: "killed-session" });
    mockResumeGame.mockReturnValue("killed-session");
    const r = await renderScreen();
    await continueLevel(r);
    await pour(r, 2, 3);
    await setAppState("background");
    expect(savedMoves()).toEqual([]);
    expect(lastSave()).toEqual(expect.objectContaining({ replayUnit: SORT_MAX_UNITS }));
    await r.unmount();
  });

  it("does not carry a board's replay on in another level's session that the resume adopted", async () => {
    // Level 5's killed session is still an orphan; the save is a later board whose
    // replay went to another session (or none).
    restore({ replayUnit: 0, replayPending: 0, replayGameId: "level-7-session" });
    mockResumeGame.mockReturnValue("level-5-session");
    const r = await renderScreen();
    await continueLevel(r);
    await pour(r, 2, 3);
    await setAppState("background");
    await r.unmount();
    expect(savedMoves()).toEqual([]);
    expect(lastSave()).toEqual(expect.objectContaining({ replayUnit: SORT_MAX_UNITS }));
  });

  it("does not carry a replay on from a save that names no session (an older build)", async () => {
    restore({ replayUnit: 3, replayPending: 0 });
    mockResumeGame.mockReturnValue("killed-session");
    const r = await renderScreen();
    await continueLevel(r);
    await pour(r, 2, 3);
    await setAppState("background");
    await r.unmount();
    expect(savedMoves()).toEqual([]);
  });

  it("saves no session with a board before the level's first pour, and the id once it opens", async () => {
    mockStartGame.mockReturnValue("game-9");
    const r = await renderScreen();
    await openLevel(r);
    expect(lastSave()).not.toHaveProperty("replayGameId");
    await pour(r, 0, 2);
    expect(lastSave()).toEqual(expect.objectContaining({ replayGameId: "game-9" }));
    await r.unmount();
  });

  it("does not record a resumed board saved before replay recording (no count in the save)", async () => {
    restore({ replayGameId: "old-session" });
    mockResumeGame.mockReturnValue("old-session");
    const r = await renderScreen();
    await continueLevel(r);
    await pour(r, 2, 3);
    await r.unmount();
    expect(savedMoves()).toEqual([]);
  });

  it("a fresh start of the level after a blocked board records again", async () => {
    restore({ replayUnit: 3, replayPending: 0 });
    mockResumeGame.mockReturnValue(null);
    mockStartGame.mockReturnValueOnce("game-restored").mockReturnValueOnce("game-fresh");
    const r = await renderScreen();
    await continueLevel(r);
    await pour(r, 2, 3); // blocked
    await newGameFromMenu(r);
    await pour(r, 0, 2);
    await r.unmount();
    expect(savedMoves()).toEqual([
      { gameId: "game-fresh", data: expect.objectContaining({ unit: 1, m: [[0, 0, 2]] }) },
    ]);
  });

  it("stops at the row cap: no unit past SORT_MAX_UNITS, and play goes on", async () => {
    restore({ replayUnit: SORT_MAX_UNITS - 1, replayPending: 0, replayGameId: "long-session" });
    mockResumeGame.mockReturnValue("long-session");
    const r = await renderScreen();
    await continueLevel(r);
    // 26 pours back and forth between the two bottles: one full chunk, then one more.
    for (let i = 0; i < 26; i += 1) await pour(r, i % 2 === 0 ? 2 : 3, i % 2 === 0 ? 3 : 2);
    await setAppState("background");
    expect(savedMoves().map((e) => e.data.unit)).toEqual([SORT_MAX_UNITS]);
    expect(entries()).toHaveLength(25);
    expect(r.getByText("Moves: 27")).toBeTruthy();
    expect(lastSave()).toEqual(expect.objectContaining({ replayUnit: SORT_MAX_UNITS }));
    await r.unmount();
  });

  it("a recorder that throws on a chunk blocks the level's replay, and play goes on", async () => {
    const record = jest.spyOn(GameRecorder.prototype, "record").mockImplementation(() => {
      throw new Error("recorder broke");
    });
    const r = await renderScreen();
    await openLevel(r);
    await pour(r, 0, 2);
    storage.saveProgress.mockClear();
    await setAppState("background"); // the chunk is handed over: the recorder throws
    expect(record).toHaveBeenCalledTimes(1);
    // The block is saved at once, with the board.
    expect(storage.saveProgress.mock.calls.map((c) => (c[0] as SortProgress).replayUnit)).toContain(
      SORT_MAX_UNITS
    );
    record.mockRestore();
    await setAppState("active");
    await pour(r, 2, 3);
    expect(r.getByText("Moves: 2")).toBeTruthy();
    await setAppState("background");
    await r.unmount();
    expect(savedMoves()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The golden level (#3389): one level played through the real screen, engine,
// solver and recorder, pinned for the backend reader
// ---------------------------------------------------------------------------

/**
 * `backend/tests/fixtures/sort_replay_golden.json` holds the events the app
 * saves for catalog level 8 played to a win (`tests/test_sort_golden.py` rebuilds
 * them). To regenerate after an intended change to what is recorded (bump the
 * events' `v` if it is breaking), from `frontend/`:
 *
 *   UPDATE_SORT_REPLAY_FIXTURE=1 npx jest src/screens/__tests__/SortScreen.replay.test.tsx -t "golden level"
 *
 * then re-run the backend: `cd backend && python -m pytest tests/test_sort_golden.py`.
 */
const GOLDEN_FIXTURE = path.resolve(
  __dirname,
  "../../../../backend/tests/fixtures/sort_replay_golden.json"
);
const GOLDEN_LEVEL = 8;

/** What the screen handed the recorder's sink for the level: lifecycle events and chunks, in order. */
function capturedEvents(): SavedEvent[] {
  const events: SavedEvent[] = [
    { type: "game_started", data: mockStartGame.mock.calls[0]![2] },
    ...mockEnqueueEvents.mock.calls.flatMap(([, saved]) => saved),
  ];
  const payload = mockCompleteGame.mock.calls[0]![2] as Record<string, unknown>;
  events.push({ type: "game_ended", data: payload });
  return events;
}

/**
 * `t_ms` is wall-clock time: pinned to a plausible pace (a minute a chunk) so the
 * file is stable. The recorder's own byte count `replay.b` follows `t_ms`'s width,
 * so it is recomputed from the normalised chunks.
 */
function normalised(events: SavedEvent[]): SavedEvent[] {
  const out = events.map((e) =>
    e.type === "moves"
      ? { type: e.type, data: { ...e.data, t_ms: (e.data.unit as number) * 60_000 } }
      : { type: e.type, data: structuredClone(e.data) }
  );
  const ended = out.at(-1)!.data as { replay: { b: number } };
  ended.replay.b = out
    .filter((e) => e.type === "moves")
    .reduce((n, e) => n + JSON.stringify(e.data).length, 0);
  return out;
}

async function tapBottle(r: Rendered, index: number) {
  await act(async () => {
    await fireEvent.press(await r.findByLabelText(new RegExp(`^Bottle ${index + 1},`)));
  });
}

/** Lets the real (async, time-sliced) solver run a little. */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 30)));

/** Waits until the real solver has answered: the Hint button is no longer busy (a slow CI machine may need several slices). */
async function hintAnswered(r: Rendered) {
  for (let slice = 0; slice < 200; slice += 1) {
    await settle();
    if (r.getByTestId("sort-hint-button").props.accessibilityState?.busy !== true) return;
  }
  throw new Error("the hint never answered");
}

/**
 * A player taking the hint: asks three times (each answer replaces the last, and each shown is recorded), then taps
 * the destination of the pour it shows. The hint selected the source, so one tap pours.
 */
async function takeHint(r: Rendered, from: number, to: number) {
  for (let ask = 0; ask < 3; ask += 1) {
    await press(r, "Hint");
    await hintAnswered(r);
  }
  await tapBottle(r, to);
  await land();
  return [
    [2, from, to],
    [2, from, to],
    [2, from, to],
    [0, from, to],
  ];
}

describe("SortScreen — the golden level (#3389)", () => {
  /**
   * Level 8 (`brrb | bbrg | grgg | _`), played the way a player might:
   * a 2-unit pour taken back and made again, a hint taken, a 3-unit pour that is a mistake,
   * a pour into the empty bottle that leaves the board unwinnable, a partial pour (1 of the
   * 2 units on top: room for one), "back to last good move" (2 pours), a pour taken back
   * with Undo, then the win by hints.
   */
  async function playGolden() {
    const level = realCatalog.SORT_LEVELS.find((l) => l.id === GOLDEN_LEVEL)!;
    playOnLevels([level]);
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: GOLDEN_LEVEL,
      currentLevelId: null,
      currentState: null,
    });
    const r = await renderScreen();
    await openLevel(r, GOLDEN_LEVEL);
    const played: number[][] = [];
    const pourAndKeep = async (from: number, to: number) => {
      await pour(r, from, to);
      played.push([0, from, to]);
    };
    await pourAndKeep(2, 3); // a false start: gg into the empty bottle...
    await press(r, "Undo");
    played.push([1]);
    await pourAndKeep(2, 3); // ...and again: a multi-unit pour
    await pourAndKeep(1, 3);
    played.push(...(await takeHint(r, 2, 1)));
    await pourAndKeep(3, 2); // a mistake, three units at once
    await pourAndKeep(0, 3); // now unwinnable
    await pourAndKeep(1, 0); // a partial pour: two r's on top, room for one
    await press(r, "Hint");
    await act(async () => {
      await fireEvent.press(await r.findByRole("button", { name: "Back to last good move" }));
    });
    await waitFor(() => expect(r.getByText("Moves: 4")).toBeTruthy());
    played.push([3, 2]);
    await pourAndKeep(1, 3); // two units into the empty bottle
    await press(r, "Undo");
    played.push([1]);
    await pourAndKeep(1, 3);
    played.push(...(await takeHint(r, 0, 1)));
    played.push(...(await takeHint(r, 0, 3)));
    played.push(...(await takeHint(r, 0, 1))); // the win
    return { r, played };
  }

  it("records what was played, and the events equal the committed fixture", async () => {
    const { r, played } = await playGolden();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1].outcome).toBe("completed");

    // The actions the test played are what the recorder saved (hints included), in order.
    expect(entries()).toEqual(played);
    expect(entries().length).toBeGreaterThan(25); // two chunks
    const kinds = new Set(entries().map((a) => a[0]));
    expect([...kinds].sort()).toEqual([0, 1, 2, 3]);

    // The recorder's own byte count, before normalising rewrites it: it must equal the
    // JSON length of the chunks it actually handed over.
    const raw = capturedEvents();
    const rawReplay = (raw.at(-1)!.data as { replay: { b: number } }).replay;
    expect(rawReplay.b).toBe(
      raw.filter((e) => e.type === "moves").reduce((n, e) => n + JSON.stringify(e.data).length, 0)
    );

    const events = normalised(raw);
    expect(events.map((e) => e.type)).toEqual(["game_started", "moves", "moves", "game_ended"]);
    if (process.env.UPDATE_SORT_REPLAY_FIXTURE === "1") {
      // one event per line: a readable diff, a small file
      const lines = events.map((e) => `  ${JSON.stringify(e)}`);
      fs.writeFileSync(
        GOLDEN_FIXTURE,
        `{\n "level": ${GOLDEN_LEVEL},\n "events": [\n${lines.join(",\n")}\n ]\n}\n`
      );
    }
    expect(JSON.parse(fs.readFileSync(GOLDEN_FIXTURE, "utf8"))).toEqual({
      level: GOLDEN_LEVEL,
      events,
    });
    await r.unmount();
  });

  it("rebuilds with the app's own rebuild to the level's result", async () => {
    const { r } = await playGolden();
    const level = realCatalog.SORT_LEVELS.find((l) => l.id === GOLDEN_LEVEL)!;
    const rebuilt = rebuild(board(level.bottles), entries());
    expect(rebuilt.error).toBeUndefined();
    expect(rebuilt.state.isComplete).toBe(true);
    const payload = mockCompleteGame.mock.calls[0]![2] as { moves: number; undos: number };
    expect(rebuilt.state.moveCount).toBe(payload.moves);
    expect(rebuilt.state.undosUsed).toBe(payload.undos);
    await r.unmount();
  });
});

// ---------------------------------------------------------------------------
// Every way a level can end or pause: the log rebuilds to what the abandon (or win) reported
// ---------------------------------------------------------------------------

describe("SortScreen — logs rebuild to the result they end with (#3389)", () => {
  const level8 = () => realCatalog.SORT_LEVELS.find((l) => l.id === GOLDEN_LEVEL)!;
  const opening8 = () => board(level8().bottles);
  const solver = jest.requireActual(
    "../../game/sort/solver"
  ) as typeof import("../../game/sort/solver");

  beforeEach(() => {
    playOnLevels([level8()]);
    storage.loadProgress.mockResolvedValue({
      unlockedLevel: GOLDEN_LEVEL,
      currentLevelId: null,
      currentState: null,
    });
  });

  /** The abandon the screen sent (`n`th call): its result block. */
  const abandonResult = (n = 0) => mockCompleteGame.mock.calls[n]![2] as { moves: number };

  /** The log of one session, rebuilt from the opening board. */
  function rebuiltLog(gameId?: string) {
    const log = savedMoves()
      .filter((e) => gameId === undefined || e.gameId === gameId)
      .flatMap((e) => e.data.m as Action[]);
    return rebuild(opening8(), log);
  }

  it("reset mid-level: the abandoned level's log rebuilds to its moves; the fresh start begins at unit 1", async () => {
    mockStartGame.mockReturnValueOnce("game-before").mockReturnValueOnce("game-after");
    const r = await renderScreen();
    await openLevel(r, GOLDEN_LEVEL);
    await pour(r, 2, 3);
    await pour(r, 1, 3);
    await press(r, "Undo");
    await pour(r, 1, 3); // 2 moves on the board, 1 undo used
    await newGameFromMenu(r);

    expect(mockCompleteGame.mock.calls[0]![1].outcome).toBe("abandoned");
    const before = rebuiltLog("game-before");
    expect(before.error).toBeUndefined();
    expect(before.state.moveCount).toBe(abandonResult().moves);
    expect(before.state.moveCount).toBe(2);
    expect(before.state.undosUsed).toBe(1);

    await pour(r, 2, 3); // the level again, from its opening board
    await setAppState("background");
    expect(savedMoves().at(-1)).toEqual({
      gameId: "game-after",
      data: expect.objectContaining({ unit: 1, m: [[0, 2, 3]] }),
    });
    const after = rebuiltLog("game-after");
    expect(after.state.moveCount).toBe(1);
    await r.unmount();
  });

  it("abandon with a pour still in the air: the pour is not in the log, and the log rebuilds to the abandon's moves", async () => {
    const r = await renderScreen();
    await openLevel(r, GOLDEN_LEVEL);
    await pour(r, 2, 3);
    mockHoldPours.on = true;
    await tapPour(r, 1, 3); // in flight, never lands
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Back to levels"));
    });
    await land();
    expect(mockCompleteGame.mock.calls[0]![1].outcome).toBe("abandoned");
    const rebuilt = rebuiltLog();
    expect(rebuilt.error).toBeUndefined();
    expect(entries()).toEqual([[0, 2, 3]]);
    expect(rebuilt.state.moveCount).toBe(abandonResult().moves);
    expect(rebuilt.state.moveCount).toBe(1);
    await r.unmount();
  });

  it("a hint answered after the board changed and the level was left leaves no step: the abandon still matches", async () => {
    let resolveHint: (v: unknown) => void = () => undefined;
    mockSolveBoard.mockImplementation(() => new Promise((resolve) => (resolveHint = resolve)));
    const r = await renderScreen();
    await openLevel(r, GOLDEN_LEVEL);
    await pour(r, 2, 3);
    await act(async () => {
      void fireEvent.press(r.getByRole("button", { name: "Hint" }));
    });
    await pour(r, 1, 3); // the board changes while the solver runs
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Back to levels"));
    });
    await act(async () => {
      resolveHint({ verdict: "solvable", moves: [{ from: 2, to: 1 }] }); // for a board long gone
    });
    await r.unmount();
    expect(entries()).toEqual([
      [0, 2, 3],
      [0, 1, 3],
    ]);
    const rebuilt = rebuiltLog();
    expect(rebuilt.state.moveCount).toBe(abandonResult().moves);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
  });

  it("a hint answered on the same board is a step that changes nothing: the abandon still matches", async () => {
    mockSolveBoard.mockResolvedValue({ verdict: "solvable", moves: [{ from: 1, to: 3 }] });
    const r = await renderScreen();
    await openLevel(r, GOLDEN_LEVEL);
    await pour(r, 2, 3);
    await press(r, "Hint");
    await act(async () => {
      await fireEvent.press(await r.findByLabelText("Back to levels"));
    });
    expect(entries()).toEqual([
      [0, 2, 3],
      [2, 1, 3],
    ]);
    const rebuilt = rebuiltLog();
    expect(rebuilt.state.moveCount).toBe(abandonResult().moves);
    expect(rebuilt.state.bottles).toEqual(applyPour(opening8(), 2, 3).bottles);
    await r.unmount();
  });

  it("background then resume continues the log, and the whole level rebuilds complete to the win", async () => {
    mockStartGame.mockReturnValue("game-1");
    const first = await renderScreen();
    await openLevel(first, GOLDEN_LEVEL);
    await pour(first, 2, 3);
    await pour(first, 1, 3);
    await press(first, "Undo");
    await setAppState("background"); // unit 1 is handed over, and the board saved with it
    const saved = lastSave();
    expect(saved).toEqual(expect.objectContaining({ replayUnit: 1, replayPending: 0 }));
    await first.unmount();

    // A killed process sends no abandon; the one an unmount sends is dropped here.
    mockCompleteGame.mockClear();
    storage.loadProgress.mockResolvedValue(saved);
    mockResumeGame.mockReturnValue("game-1");
    const second = await renderScreen();
    await continueLevel(second, GOLDEN_LEVEL);

    // Play on to the win from wherever the log has the board.
    const log = () => rebuild(opening8(), entries());
    for (const m of solver.solve(log().state)!) {
      await pour(second, m.from, m.to);
    }
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1].outcome).toBe("completed");

    expect(mockStartGame).toHaveBeenCalledTimes(1); // one session across both
    expect(savedMoves().map((e) => [e.gameId, e.data.unit])).toEqual([
      ["game-1", 1],
      ["game-1", 2],
    ]);
    const rebuilt = log();
    expect(rebuilt.error).toBeUndefined();
    expect(rebuilt.state.isComplete).toBe(true);
    const payload = mockCompleteGame.mock.calls[0]![2] as {
      moves: number;
      undos: number;
      replay: { u: number };
    };
    expect(rebuilt.state.moveCount).toBe(payload.moves);
    expect(rebuilt.state.undosUsed).toBe(payload.undos);
    expect(payload.replay.u).toBe(2); // the recorder counts both units
    await second.unmount();
  });
});
