/**
 * FreeCellScreen replay recording (#3289): actions are logged in memory and
 * recorded in chunks; nothing is saved per tap or per Auto Complete step; the
 * app going to the background saves the chunk at once; a resumed game numbers
 * its chunks on from its save; a recording failure never reaches play.
 */

import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

import FreeCellScreen from "../FreeCellScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { AUTO_OFFSET, KIND } from "../../game/freecell/replay";
import type { Card, FreeCellState } from "../../game/freecell/types";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
jest.mock("../../game/freecell/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn().mockResolvedValue(undefined),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadStats: jest.fn().mockResolvedValue({ bestMoves: 0 }),
  saveStats: jest.fn().mockResolvedValue(undefined),
}));
import { loadGame, saveGame } from "../../game/freecell/storage";

const mockStartGame = jest.fn();
const mockResumeGame = jest.fn();
const mockEnqueueEvents = jest.fn();
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    resumeGame: lazy(() => mockResumeGame),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
  });
});
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn(() => Promise.resolve({ display_name: "Brave Otter 4821" })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

const mockRecordChunk = { throwing: false };
jest.mock("../../game/_shared/cards/moveLog", () => {
  const actual = jest.requireActual("../../game/_shared/cards/moveLog");
  return {
    ...actual,
    recordChunk: (...args: unknown[]) => {
      if (mockRecordChunk.throwing) throw new Error("recorder down");
      return actual.recordChunk(...args);
    },
  };
});

// One test makes a fresh deal a hand-built board.
const mockDealGame = jest.fn();
jest.mock("../../game/freecell/engine", () => {
  const actual = jest.requireActual("../../game/freecell/engine");
  return {
    ...actual,
    dealGame: (...args: unknown[]) =>
      mockDealGame.getMockImplementation() ? mockDealGame(...args) : actual.dealGame(...args),
  };
});

jest.useFakeTimers();

let appStateHandlers: ((state: string) => void)[] = [];

beforeEach(() => {
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-1");
  // A killed app's open session is there to continue, unless a test says otherwise.
  mockResumeGame.mockReset();
  mockResumeGame.mockReturnValue("game-1");
  mockDealGame.mockReset();
  mockEnqueueEvents.mockReset();
  mockCompleteGame.mockReset();
  mockRecordChunk.throwing = false;
  appStateHandlers = [];
  (saveGame as jest.Mock).mockClear();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _type: string,
    handler: (state: string) => void
  ) => {
    appStateHandlers.push(handler);
    return { remove: () => undefined };
  }) as never);
});

afterEach(async () => {
  await act(async () => {
    jest.runAllTimers();
  });
  (loadGame as jest.Mock).mockResolvedValue(null);
  jest.restoreAllMocks();
});

const goBackground = () =>
  act(async () => {
    for (const h of appStateHandlers) h("background");
  });

async function renderScreen() {
  const api = await render(
    <ThemeProvider>
      <FreeCellScreen />
    </ThemeProvider>
  );
  await waitFor(() => api.getByLabelText("Hint"));
  return api;
}

/** Every action the recorder handed the queue, in order: [gameId, s, unit, action]. */
function savedActions(): [string, number, number, number[]][] {
  return mockEnqueueEvents.mock.calls.flatMap(([gameId, events]) =>
    (events as { type: string; data: { s: number; unit: number; m: number[][] } }[])
      .filter((e) => e.type === "moves")
      .flatMap((e) =>
        e.data.m.map((a): [string, number, number, number[]] => [
          gameId as string,
          e.data.s,
          e.data.unit,
          a,
        ])
      )
  );
}

const upTo = (suit: Card["suit"], rank: number): Card[] =>
  Array.from({ length: rank }, (_, i) => ({ suit, rank: (i + 1) as Card["rank"] }));

const NO_CELLS = [null, null, null, null] as unknown as FreeCellState["freeCells"];

/** An ace on the board, hint available, one undo to go back to: a game with 2 moves made. */
function playing(extra: Partial<FreeCellState> = {}): FreeCellState {
  const ace: Card = { suit: "spades", rank: 1 };
  const base: FreeCellState = {
    _v: 1,
    tableau: [[ace], [], [], [], [], [], [], []],
    freeCells: NO_CELLS,
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    undoStack: [],
    isComplete: false,
    moveCount: 1,
  };
  return { ...base, undoStack: [base], moveCount: 2, ...extra };
}

/** Spades A..`done` on the foundation; the rest of the spades in column 0, K first. */
function nearlyWon(done: number): FreeCellState {
  const rest: Card[] = Array.from({ length: 13 - done }, (_, i) => ({
    suit: "spades",
    rank: (13 - i) as Card["rank"],
  }));
  return {
    _v: 1,
    tableau: [rest, [], [], [], [], [], [], []],
    freeCells: NO_CELLS,
    foundations: {
      spades: upTo("spades", done),
      hearts: upTo("hearts", 13),
      diamonds: upTo("diamonds", 13),
      clubs: upTo("clubs", 13),
    },
    undoStack: [],
    isComplete: false,
    moveCount: 0,
  };
}

const press = async (api: Awaited<ReturnType<typeof renderScreen>>, label: string) => {
  await act(async () => {
    await fireEvent.press(api.getByLabelText(label));
  });
};

/** A fresh deal: K♠ and Q♠ on top of two columns, nothing to auto-complete. */
function twoKings(): FreeCellState {
  return {
    _v: 1,
    tableau: [
      [{ suit: "spades", rank: 13 }],
      [{ suit: "spades", rank: 12 }],
      [{ suit: "hearts", rank: 9 }],
      [],
      [],
      [],
      [],
      [],
    ],
    freeCells: NO_CELLS,
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    undoStack: [],
    isComplete: false,
    moveCount: 0,
  };
}

/** Park Q♠ in free cell 1: a legal move on `twoKings`, recorded as [1, 1, 0]. */
async function parkQueen(api: Awaited<ReturnType<typeof renderScreen>>) {
  await press(api, "Q of Spades");
  await press(api, "Empty free cell 1");
}

const menuNewGame = async (api: Awaited<ReturnType<typeof renderScreen>>) => {
  await press(api, "More options");
  await act(async () => {
    await fireEvent.press(api.getByText("New Game"));
  });
  await press(api, "Start New");
};

describe("recording a game", () => {
  it("a hint and an undo are actions, saved at once when the app goes to the background", async () => {
    (loadGame as jest.Mock).mockResolvedValue(playing({ recorded: 5 }));
    const api = await renderScreen();
    await press(api, "Hint");
    await press(api, "Undo");
    expect(mockEnqueueEvents).not.toHaveBeenCalled(); // nothing per tap
    await goBackground();
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    expect(savedActions()).toEqual([
      ["game-1", 5, 1, [KIND.hint]],
      ["game-1", 5, 1, [KIND.undo]],
    ]);
  });

  it("opens the game's session before it records, so nothing is saved to no game", async () => {
    mockDealGame.mockImplementation(twoKings);
    const api = await renderScreen();
    expect(mockStartGame).not.toHaveBeenCalled();
    await parkQueen(api);
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    await goBackground();
    expect(savedActions()).toEqual([["game-1", 0, 1, [KIND.tableauToFreeCell, 1, 0]]]);
    expect(Math.min(...mockStartGame.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mockEnqueueEvents.mock.invocationCallOrder)
    );
  });

  it("does not record a move the engine refuses", async () => {
    mockDealGame.mockImplementation(twoKings);
    const api = await renderScreen();
    await press(api, "K of Spades");
    await press(api, "Q of Spades"); // a King cannot go onto a Queen: refused, nothing logged
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    // the King is still selected: the next, legal move is the first action recorded
    await press(api, "Empty free cell 1");
    await goBackground();
    expect(savedActions().map((a) => a[3])).toEqual([[KIND.tableauToFreeCell, 0, 0]]);
  });

  it("a hint before the first action is not recorded", async () => {
    (loadGame as jest.Mock).mockResolvedValue(playing({ undoStack: [], moveCount: 0 }));
    const api = await renderScreen();
    await press(api, "Hint");
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("a resumed game numbers its chunks on from the count its save carried, and stamps it back", async () => {
    (loadGame as jest.Mock).mockResolvedValue(playing({ recorded: 60 }));
    const api = await renderScreen();
    await press(api, "Hint");
    await goBackground();
    expect(savedActions()).toEqual([["game-1", 60, 3, [KIND.hint]]]);
    const lastSaved = (saveGame as jest.Mock).mock.calls.at(-1)?.[0] as FreeCellState;
    expect(lastSaved.recorded).toBe(61);
  });

  it("leaving the game saves the chunk in progress before the abandon", async () => {
    (loadGame as jest.Mock).mockResolvedValue(playing({ recorded: 5 }));
    const api = await renderScreen();
    await press(api, "Hint");
    await api.unmount();
    expect(savedActions()).toEqual([["game-1", 5, 1, [KIND.hint]]]);
    expect(Math.min(...mockEnqueueEvents.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mockCompleteGame.mock.invocationCallOrder)
    );
  });

  it("New Game mid-chunk saves the old game's chunk to it, and the new game counts from 0", async () => {
    mockDealGame.mockImplementation(twoKings);
    mockStartGame.mockReturnValueOnce("game-1").mockReturnValueOnce("game-2");
    const api = await renderScreen();
    await parkQueen(api);
    await menuNewGame(api);
    // the old game's one action is saved to the old game, before its abandon
    expect(savedActions()).toEqual([["game-1", 0, 1, [KIND.tableauToFreeCell, 1, 0]]]);
    expect(Math.min(...mockEnqueueEvents.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mockCompleteGame.mock.invocationCallOrder)
    );
    await parkQueen(api);
    await goBackground();
    expect(savedActions().slice(1)).toEqual([["game-2", 0, 1, [KIND.tableauToFreeCell, 1, 0]]]);
  });
});

describe("a restored game that cannot be replayed is not recorded", () => {
  it("its original session was not resumed: the new session has no seed", async () => {
    mockResumeGame.mockReturnValue(null);
    (loadGame as jest.Mock).mockResolvedValue(playing({ recorded: 5 }));
    const api = await renderScreen();
    await press(api, "Hint");
    await press(api, "Undo");
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    // play itself is unchanged: the undo went through
    const lastSaved = (saveGame as jest.Mock).mock.calls.at(-1)?.[0] as FreeCellState;
    expect(lastSaved.moveCount).toBe(1);
    // and a hint or undo opened no session of its own
    expect(mockStartGame).not.toHaveBeenCalled();
    await api.unmount();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("an old save with no count and some history, even when its session resumes", async () => {
    (loadGame as jest.Mock).mockResolvedValue(playing());
    const api = await renderScreen();
    await press(api, "Hint");
    await press(api, "Undo");
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    const lastSaved = (saveGame as jest.Mock).mock.calls.at(-1)?.[0] as FreeCellState;
    expect(lastSaved.recorded).toBeUndefined();
  });

  it.each([-1, 2.5, "7"])("a corrupt count (%p) is treated like a missing one", async (bad) => {
    (loadGame as jest.Mock).mockResolvedValue({ ...playing(), recorded: bad });
    const api = await renderScreen();
    await press(api, "Hint");
    await goBackground();
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
  });

  it("an old save with no count and no history is recorded from 0", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(11));
    await renderScreen();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(savedActions().map((a) => a[1])).toEqual([0, 0]);
  });
});

describe("Auto Complete", () => {
  it("records each step as an auto action with no save per card, and the win saves them once", async () => {
    (loadGame as jest.Mock).mockResolvedValue(nearlyWon(11)); // Q♠ then K♠ still to go
    await renderScreen();
    await act(async () => {
      jest.advanceTimersByTime(120); // one step
    });
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    expect(savedActions().map((a) => a[3])).toEqual([
      [AUTO_OFFSET + KIND.tableauToFoundation, 0],
      [AUTO_OFFSET + KIND.tableauToFoundation, 0],
    ]);
    expect(Math.min(...mockEnqueueEvents.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mockCompleteGame.mock.invocationCallOrder)
    );
  });
});

describe("a recording failure", () => {
  it("never reaches play: the undo is made, the app can go to the background", async () => {
    mockRecordChunk.throwing = true;
    (loadGame as jest.Mock).mockResolvedValue(playing({ recorded: 5 }));
    const api = await renderScreen();
    await press(api, "Hint");
    await expect(goBackground()).resolves.toBeUndefined();
    await press(api, "Undo");
    const lastSaved = (saveGame as jest.Mock).mock.calls.at(-1)?.[0] as FreeCellState;
    expect(lastSaved.moveCount).toBe(1); // the undo went through
  });
});
