/**
 * @jest-environment jsdom
 */

/**
 * Reporting rules, played on a game with a winner (#2642): Twenty48. See
 * `reportingInvariants.screen.test.ts` for the rules and the FreeCell half;
 * this one is separate because Twenty48's moves come from the web keyboard
 * handler, which needs the jsdom environment.
 *
 *   - Reaching 2048 records `win`, a game over without it `loss`, each with a
 *     rank lookup; leaving mid-game (unmount) records `abandoned` and the
 *     card never asks for a rank.
 */

import React from "react";
import { Platform } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Twenty48Screen from "../Twenty48Screen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import { HAS_WINNER } from "../../api/vocab";
import type { TileData, Twenty48State } from "../../game/twenty48/types";

// Twenty48's keyboard handler only listens on web.
(Platform as { OS: string }).OS = "web";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }),
}));
jest.mock("../../game/twenty48/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  loadGame: jest.fn().mockResolvedValue(null),
  saveBestScore: jest.fn(),
  loadBestScore: jest.fn().mockResolvedValue(0),
  loadStats: jest.fn().mockResolvedValue({ bestTile: 0, gamesPlayed: 0, gamesWon: 0 }),
  saveStats: jest.fn(),
}));
// Twenty48's real engine, except where a test forces the next move's result.
jest.mock("../../game/twenty48/engine", () => {
  const actual = jest.requireActual("../../game/twenty48/engine");
  return {
    __esModule: true,
    ...actual,
    move: jest.fn((...args: unknown[]) => (actual.move as (...a: unknown[]) => unknown)(...args)),
  };
});

import { loadGame as loadTwenty48 } from "../../game/twenty48/storage";
import { move as twenty48Move } from "../../game/twenty48/engine";

// The result card's rank lookup (sessionBoardAdapter, #2677).
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
jest.mock("../../game/_shared/displayNameSync", () => ({
  ...jest.requireActual("../../game/_shared/displayNameSync"),
  flushDisplayNameSync: jest.fn(() => Promise.resolve(true)),
}));

// useGameSync (and its outcome guard) is real; the client it records through is not.
const mockStartGame = jest.fn();
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => mockStartGame(...args),
    enqueueEvent: jest.fn(),
    completeGame: (...args: unknown[]) => mockCompleteGame(...args),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
    resumeGame: jest.fn(() => null),
    setProgressOutcome: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

const GAME_ID = "session-under-test";

function recordedOutcomes(): unknown[] {
  return mockCompleteGame.mock.calls.map((call) => (call[1] as { outcome: unknown }).outcome);
}

/** The card never asked for this session's rank, nor any other. */
function expectNoRankLookup() {
  expect(mockGetGameRank.mock.calls.map(([id]) => id)).not.toContain(GAME_ID);
  expect(mockGetGameRank).not.toHaveBeenCalled();
}

beforeEach(async () => {
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue(GAME_ID);
  mockCompleteGame.mockReset();
  mockGetGameRank.mockReset();
  mockGetGameRank.mockResolvedValue({ ranked: true, rank: 2, is_best: true, reason: null });
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  // A named player: the card asks for the rank as soon as a game ends.
  await AsyncStorage.setItem("player_display_name", "Riley");
});

// ---------------------------------------------------------------------------
// Twenty48: has a winner
// ---------------------------------------------------------------------------

function tilesFor(board: number[][]): TileData[] {
  let id = 100;
  return board.flatMap((row, r) =>
    row.flatMap((value, c) =>
      value === 0
        ? []
        : [
            {
              id: id++,
              value,
              row: r,
              col: c,
              prevRow: r,
              prevCol: c,
              isNew: false,
              isMerge: false,
            },
          ]
    )
  );
}

function twenty48State(board: number[][], fields: Partial<Twenty48State>): Twenty48State {
  return {
    board,
    tiles: tilesFor(board),
    score: 0,
    scoreDelta: 0,
    game_over: false,
    has_won: false,
    startedAt: null,
    accumulatedMs: 0,
    ...fields,
  };
}

/** Packed left with no equal neighbours: a board in progress. */
const IN_PROGRESS = twenty48State(
  [
    [2, 4, 0, 0],
    [8, 16, 0, 0],
    [32, 64, 0, 0],
    [128, 256, 0, 0],
  ],
  {}
);
const WIN_MOVE = twenty48State(
  [
    [2048, 4, 2, 0],
    [8, 16, 0, 0],
    [32, 64, 0, 0],
    [128, 256, 0, 0],
  ],
  { score: 20_480, scoreDelta: 2048, has_won: true, accumulatedMs: 90_000 }
);
const GAME_OVER = twenty48State(
  [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ],
  { score: 1234, scoreDelta: 16, game_over: true, accumulatedMs: 42_000 }
);

async function openTwenty48(saved: Twenty48State | null) {
  (loadTwenty48 as jest.Mock).mockResolvedValueOnce(saved);
  const navigation = {
    setOptions: jest.fn(),
    navigate: jest.fn(),
    goBack: jest.fn(),
    popToTop: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  } as unknown as React.ComponentProps<typeof Twenty48Screen>["navigation"];
  const r = await render(
    React.createElement(ThemeProvider, null, React.createElement(Twenty48Screen, { navigation }))
  );
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

/** One move (the keyboard handler is web-only) whose result is `next`. */
async function playTwenty48Move(next: Twenty48State) {
  (twenty48Move as jest.Mock).mockImplementationOnce(() => next);
  await act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  // Release the move lock (the slide animation).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

describe("Twenty48 (has a winner)", () => {
  it("is a game with a winner", () => {
    expect(HAS_WINNER.twenty48).toBe(true);
  });

  it("reaching 2048 records win and asks for its rank", async () => {
    await openTwenty48(null);
    await playTwenty48Move(WIN_MOVE);
    expect(recordedOutcomes()).toEqual(["win"]);
    await waitFor(() => expect(mockGetGameRank).toHaveBeenCalledWith(GAME_ID));
  });

  it("a game over without 2048 records loss and asks for its rank", async () => {
    await openTwenty48(null);
    await playTwenty48Move(GAME_OVER);
    expect(recordedOutcomes()).toEqual(["loss"]);
    await waitFor(() => expect(mockGetGameRank).toHaveBeenCalledWith(GAME_ID));
  });

  it("leaving mid-game (unmount) records abandoned and asks for no rank", async () => {
    const r = await openTwenty48(IN_PROGRESS);
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    await r.unmount();
    expect(recordedOutcomes()).toEqual(["abandoned"]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expectNoRankLookup();
  });
});
