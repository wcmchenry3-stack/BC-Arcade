/**
 * Reporting rules, played on one screen (#2642, epic #2519 decisions 11 and 12).
 *
 * `game/_shared/__tests__/reportingInvariants.test.ts` checks every game's
 * reporting from its source. This is its sanity check on a real screen, one
 * check per path: FreeCell, a game with no winner, is played to a win, and
 * restarted and left (unmounted) mid-game.
 *
 *   - A game with no winner records only `completed` / `kept_playing` /
 *     `abandoned`, and a win is never `abandoned`.
 *   - Restart and unmount record `abandoned`.
 *   - The result card asks for a rank (`GET /games/{id}/rank`, #2677) after
 *     the win, and never after an abandon.
 */

import * as fs from "fs";
import * as path from "path";
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import FreeCellScreen from "../FreeCellScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";
import type { FreeCellState } from "../../game/freecell/types";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children,
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

import { loadGame } from "../../game/freecell/storage";

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

// useGameSync is real; the client it records through is not.
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

/** What a game with no winner may record (backend `vocab.GameOutcome`). */
const NO_WINNER_OUTCOMES = ["completed", "kept_playing", "abandoned"];

const GAME_ID = "freecell-game";
/** FreeCell's auto-complete plays one move per step. */
const AUTO_STEP_MS = 120;

function upTo(suit: "spades" | "hearts" | "diamonds" | "clubs", rank: number) {
  return Array.from({ length: rank }, (_, i) => ({ suit, rank: (i + 1) as never }));
}

/** Every foundation full but spades; the other spades stacked in column 0. */
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

/** Loads a board `steps` auto-complete moves from a win and plays one move. */
async function playFreeCell(steps: number) {
  (loadGame as jest.Mock).mockResolvedValue(nearlyWon(13 - steps));
  const r = await render(
    React.createElement(ThemeProvider, null, React.createElement(FreeCellScreen))
  );
  await waitFor(() => r.getByLabelText("Hint"));
  await act(async () => {
    jest.advanceTimersByTime(AUTO_STEP_MS);
  });
  return r;
}

/** Lets any rank lookup, and every retry it could schedule, run. */
async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(120_000);
  });
}

function recordedOutcomes(): unknown[] {
  return mockCompleteGame.mock.calls.map((call) => (call[1] as { outcome: unknown }).outcome);
}

describe("reporting invariants: FreeCell, played", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });
  afterAll(() => {
    jest.useRealTimers();
  });

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

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    (loadGame as jest.Mock).mockResolvedValue(null);
  });

  it("is a game with no winner (backend freecell module)", () => {
    const module = path.resolve(__dirname, "../../../../backend/freecell/module.py");
    expect(fs.readFileSync(module, "utf8")).toMatch(/^\s*has_winner\s*=\s*False\b/m);
  });

  it("a win records a no-winner outcome, never abandoned, and asks for its rank", async () => {
    await playFreeCell(1);
    await waitFor(() => expect(mockCompleteGame).toHaveBeenCalledTimes(1));
    const [outcome] = recordedOutcomes();
    expect(NO_WINNER_OUTCOMES).toContain(outcome);
    expect(outcome).not.toBe("abandoned");
    await settle();
    expect(mockGetGameRank).toHaveBeenCalledWith(GAME_ID);
  });

  it("a restart mid-game records abandoned and asks for no rank", async () => {
    const r = await playFreeCell(2);
    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("New Game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByLabelText("Start New"));
    });
    expect(recordedOutcomes()).toEqual(["abandoned"]);
    await settle();
    expect(mockGetGameRank).not.toHaveBeenCalled();
  });

  it("leaving mid-game (unmount) records abandoned and asks for no rank", async () => {
    const r = await playFreeCell(2);
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    await r.unmount();
    expect(recordedOutcomes()).toEqual(["abandoned"]);
    await settle();
    expect(mockGetGameRank).not.toHaveBeenCalled();
  });
});
