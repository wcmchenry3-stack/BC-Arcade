/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, act, waitFor, fireEvent, within } from "@testing-library/react-native";
import Twenty48Screen from "../Twenty48Screen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { Twenty48ScoreboardProvider } from "../../game/twenty48/Twenty48ScoreboardContext";
import { saveGame, clearGame, loadGame, loadBestScore } from "../../game/twenty48/storage";
import { Twenty48State } from "../../game/twenty48/types";

// Force web platform so the keyboard-listener useEffect runs.
import { Platform } from "react-native";
(Platform as { OS: string }).OS = "web";

// GameShell's Stats item (#2635) navigates through useNavigation; these
// screens take their navigation as a prop, so the hook gets its own mock.
const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockShellNavigate }),
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// Mock storage — no saved game, no-op persistence.
jest.mock("../../game/twenty48/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  loadGame: jest.fn().mockResolvedValue(null),
  saveBestScore: jest.fn(),
  loadBestScore: jest.fn().mockResolvedValue(0),
  loadStats: jest.fn().mockResolvedValue({ bestTile: 0, gamesPlayed: 0, gamesWon: 0 }),
  saveStats: jest.fn(),
}));

// Mock the engine so individual tests can force a game_over transition.
jest.mock("../../game/twenty48/engine", () => {
  const actual = jest.requireActual("../../game/twenty48/engine");
  return {
    __esModule: true,
    ...actual,
    move: jest.fn((...args: unknown[]) => (actual.move as (...a: unknown[]) => unknown)(...args)),
  };
});
import { move as engineMoveMocked } from "../../game/twenty48/engine";
const mockedEngineMove = engineMoveMocked as unknown as jest.Mock;

// Mock gameEventClient — record every call for instrumentation tests.
type EnqueueArgs = [string, { type: string; data: Record<string, unknown> }];
type CompleteArgs = [string, Record<string, unknown>, Record<string, unknown>];
type StartArgs = [string, Record<string, unknown>?, Record<string, unknown>?];
const mockStartGame = jest.fn() as unknown as jest.Mock<string, StartArgs>;
const mockEnqueueEvent = jest.fn() as unknown as jest.Mock<undefined, EnqueueArgs>;
const mockCompleteGame = jest.fn() as unknown as jest.Mock<undefined, CompleteArgs>;
// A killed process's session to continue (#2654) — none unless a test says so.
const mockResumeGame = jest.fn() as unknown as jest.Mock<string | null, [string, unknown?]>;
const mockMarkStarted = jest.fn() as unknown as jest.Mock<undefined, [string]>;
const mockDiscardGame = jest.fn() as unknown as jest.Mock<undefined, [string]>;
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as unknown as jest.Mock)(...args),
    resumeGame: (...args: unknown[]) => (mockResumeGame as unknown as jest.Mock)(...args),
    markStarted: (...args: unknown[]) => (mockMarkStarted as unknown as jest.Mock)(...args),
    discardGame: (...args: unknown[]) => (mockDiscardGame as unknown as jest.Mock)(...args),
    enqueueEvent: (...args: unknown[]) => (mockEnqueueEvent as unknown as jest.Mock)(...args),
    completeGame: (...args: unknown[]) => (mockCompleteGame as unknown as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));
// useGameSync's app-wide foreground clock (#2684) is held still by the shared
// mock jest.setup.ts pins (#2710): Twenty48 sends its own timer, and where that
// reads 0 (a fresh board) the hook's window would otherwise fill in real
// elapsed test time.
// The result card's rank lookup (#2631, #2677): GET /games/{id}/rank.
const mockGetRank = jest.fn<Promise<GameRankResponse>, [string]>();
jest.mock("../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetRank(gameId) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../game/_shared/displayNameSync", () => ({
  ...jest.requireActual("../../game/_shared/displayNameSync"),
  flushDisplayNameSync: jest.fn(() => Promise.resolve(true)),
}));
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GameRankResponse } from "../../api/types";
import { resetDisplayNameCacheForTests, saveDisplayName } from "../../game/_shared/displayName";

beforeEach(async () => {
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-uuid-test");
  mockEnqueueEvent.mockReset();
  mockCompleteGame.mockReset();
  mockResumeGame.mockReset();
  mockResumeGame.mockReturnValue(null);
  mockMarkStarted.mockReset();
  mockDiscardGame.mockReset();
  mockGetRank.mockReset();
  mockGetRank.mockResolvedValue({ rank: 3, is_best: true, ranked: true, reason: null });
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
});

function mockNav() {
  return {
    setOptions: jest.fn(),
    navigate: jest.fn(),
    goBack: jest.fn(),
    popToTop: jest.fn(),
  } as unknown as Parameters<typeof Twenty48Screen>[0]["navigation"];
}

async function renderScreen(nav = mockNav()) {
  return await render(
    <ThemeProvider>
      <Twenty48ScoreboardProvider>
        <Twenty48Screen navigation={nav} />
      </Twenty48ScoreboardProvider>
    </ThemeProvider>
  );
}

// Wait for the initial loadGame() promise to resolve so the pending setState
// doesn't race with the test body.
async function mountAndSettle() {
  const r = await renderScreen();
  await act(async () => {
    await Promise.resolve();
  });
  return r;
}

function dispatchKey(key: string, target?: EventTarget) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true });
  if (target) {
    Object.defineProperty(event, "target", { value: target, writable: false });
  }
  window.dispatchEvent(event);
}

describe("Twenty48Screen — keyboard controls (web)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Flush any pending move-lock timeouts (120 ms) so they don't fire
  // during subsequent tests and pollute the saveGame mock call count.
  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    jest.clearAllMocks();
  });

  it("arrow keys advance the game", async () => {
    const { queryByText } = await mountAndSettle();
    // Wait for loadGame() promise to resolve + initial state to render.
    await waitFor(() => expect(queryByText("Score: 0")).toBeNull(), { timeout: 5000 });

    // Try each of the 4 arrow keys. At least one should produce a valid move
    // (the new-game board with 2 spawned tiles has at least one direction
    // that compacts the board).
    await act(() => {
      dispatchKey("ArrowLeft");
      dispatchKey("ArrowRight");
      dispatchKey("ArrowUp");
      dispatchKey("ArrowDown");
    });

    // After any valid move, a new tile is spawned → 3+ non-zero cells.
    // We can't reliably assert specific tile positions due to Math.random
    // in spawns, so this is a smoke test that the handler fires without error.
    // The real guarantee comes from "removes listener on unmount" below.
  });

  it("WASD keys also work", async () => {
    await mountAndSettle();
    // Dispatch lowercase + uppercase to confirm both are mapped.
    await act(() => {
      dispatchKey("w");
      dispatchKey("W");
      dispatchKey("a");
      dispatchKey("A");
      dispatchKey("s");
      dispatchKey("S");
      dispatchKey("d");
      dispatchKey("D");
    });
    // No throw = pass.
  });

  it("ignores non-direction keys", async () => {
    await mountAndSettle();
    await act(() => {
      dispatchKey(" "); // space
      dispatchKey("Enter");
      dispatchKey("Escape");
      dispatchKey("q");
      dispatchKey("x");
    });
    // No throw and no crash = pass.
  });

  it("ignores arrow keys when an input is focused", async () => {
    await mountAndSettle();
    const input = document.createElement("input");
    document.body.appendChild(input);
    await act(() => {
      dispatchKey("ArrowLeft", input);
    });
    document.body.removeChild(input);
    // The handler early-returns; no crash. We can't easily observe "didn't
    // move" from the outside without exposing state, so this test's value
    // is crash-safety + documenting the guard's existence.
  });

  it("removes the keydown listener on unmount", async () => {
    const add = jest.spyOn(window, "addEventListener");
    const remove = jest.spyOn(window, "removeEventListener");
    const { unmount } = await mountAndSettle();
    expect(add).toHaveBeenCalledWith("keydown", expect.any(Function));
    await unmount();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    add.mockRestore();
    remove.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Shared fixture states
// ---------------------------------------------------------------------------

import { TileData } from "../../game/twenty48/types";

function tilesFor(board: number[][]): TileData[] {
  const tiles: TileData[] = [];
  let id = 100;
  for (let r = 0; r < board.length; r++) {
    const row = board[r];
    if (row === undefined) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell !== undefined && cell !== 0)
        tiles.push({
          id: id++,
          value: cell,
          row: r,
          col: c,
          prevRow: r,
          prevCol: c,
          isNew: false,
          isMerge: false,
        });
    }
  }
  return tiles;
}

// All tiles packed left, no equal adjacent pairs → ArrowLeft is a no-op.
const NOOP_LEFT_BOARD = [
  [2, 4, 0, 0],
  [8, 16, 0, 0],
  [32, 64, 0, 0],
  [128, 256, 0, 0],
];
const NOOP_LEFT_STATE: Twenty48State = {
  board: NOOP_LEFT_BOARD,
  tiles: tilesFor(NOOP_LEFT_BOARD),
  score: 0,
  scoreDelta: 0,
  game_over: false,
  has_won: false,
  startedAt: null,
  accumulatedMs: 0,
};

const WON_BOARD = [
  [2048, 4, 0, 0],
  [8, 16, 0, 0],
  [32, 64, 0, 0],
  [128, 256, 0, 0],
];
const WON_STATE: Twenty48State = {
  board: WON_BOARD,
  tiles: tilesFor(WON_BOARD),
  score: 2048,
  scoreDelta: 0,
  game_over: false,
  has_won: true,
  startedAt: null,
  accumulatedMs: 0,
};

// A filled board with no possible merges — game is over.
const GAME_OVER_BOARD = [
  [2, 4, 2, 4],
  [4, 2, 4, 2],
  [2, 4, 2, 4],
  [4, 2, 4, 2],
];
const GAME_OVER_STATE: Twenty48State = {
  board: GAME_OVER_BOARD,
  tiles: tilesFor(GAME_OVER_BOARD),
  score: 0,
  scoreDelta: 0,
  game_over: true,
  has_won: false,
  startedAt: null,
  accumulatedMs: 0,
};

// ---------------------------------------------------------------------------
// Initial load
// ---------------------------------------------------------------------------

describe("Twenty48Screen — initial load", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls loadGame on mount", async () => {
    await mountAndSettle();
    expect(loadGame).toHaveBeenCalledTimes(1);
  });

  it("calls saveGame with new state when loadGame returns null", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await mountAndSettle();
    expect(saveGame).toHaveBeenCalledTimes(1);
  });

  it("does not call saveGame when loadGame returns a saved state", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
    await mountAndSettle();
    expect(saveGame).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Move persistence
// ---------------------------------------------------------------------------

describe("Twenty48Screen — move persistence", () => {
  beforeEach(() => jest.clearAllMocks());

  // Flush any pending move-lock timeouts (120 ms) so they don't fire
  // during subsequent tests and pollute the saveGame mock call count.
  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    jest.clearAllMocks();
  });

  it("calls saveGame after a valid move", async () => {
    // Start from null so the engine spawns a real random board.
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await mountAndSettle();
    jest.clearAllMocks(); // reset the initial saveGame call

    // At least one of the four directions will produce a valid move.
    await act(() => {
      dispatchKey("ArrowLeft");
      dispatchKey("ArrowRight");
      dispatchKey("ArrowUp");
      dispatchKey("ArrowDown");
    });

    expect(saveGame).toHaveBeenCalled();
  });

  it("does not call saveGame for a no-op move", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
    await mountAndSettle();

    await act(() => {
      dispatchKey("ArrowLeft"); // no-op on this board
    });

    expect(saveGame).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Game-over
// ---------------------------------------------------------------------------

describe("Twenty48Screen — game-over", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls clearGame when loaded state is game_over", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(GAME_OVER_STATE);
    await mountAndSettle();
    expect(clearGame).toHaveBeenCalledTimes(1);
  });

  it("renders game-over overlay when game_over is true", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(GAME_OVER_STATE);
    const { getByText } = await mountAndSettle();
    await waitFor(() => expect(getByText("Game Over")).toBeTruthy());
  });

  it("does not render game-over overlay for an active game", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
    const { queryByText } = await mountAndSettle();
    expect(queryByText("Game Over")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Win overlay
// ---------------------------------------------------------------------------

describe("Twenty48Screen — win overlay", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows win overlay when has_won is true and game is not over", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const { getByText } = await mountAndSettle();
    await waitFor(() => expect(getByText("You Win!")).toBeTruthy());
  });

  it("dismisses win overlay when Keep Playing is pressed", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const { getByLabelText, queryByText } = await mountAndSettle();
    await waitFor(() =>
      expect(getByLabelText("Continue playing after reaching 2048")).toBeTruthy()
    );
    await act(async () => {
      await fireEvent.press(getByLabelText("Continue playing after reaching 2048"));
    });
    expect(queryByText("You Win!")).toBeNull();
  });

  it("does not show win overlay when game_over is true even if has_won", async () => {
    const wonAndOver: Twenty48State = { ...WON_STATE, game_over: true };
    (loadGame as jest.Mock).mockResolvedValueOnce(wonAndOver);
    const { queryByText } = await mountAndSettle();
    await waitFor(() => expect(queryByText("You Win!")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// New game
// ---------------------------------------------------------------------------

describe("Twenty48Screen — new game", () => {
  beforeEach(() => jest.clearAllMocks());

  it("New Game button calls saveGame with a fresh state", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const { getByLabelText } = await mountAndSettle();
    jest.clearAllMocks();

    await act(async () => {
      await fireEvent.press(getByLabelText("Start a new 2048 game"));
    });

    expect(saveGame).toHaveBeenCalledTimes(1);
    const savedState = (saveGame as jest.Mock).mock.calls[0][0] as Twenty48State;
    expect(savedState.score).toBe(0);
    expect(savedState.game_over).toBe(false);
    expect(savedState.has_won).toBe(false);
  });

  it("Play Again on the win card starts a new game and closes the card", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const { getByText, getByRole, queryByText } = await mountAndSettle();
    await waitFor(() => expect(getByText("You Win!")).toBeTruthy());

    await act(async () => {
      await fireEvent.press(getByRole("button", { name: "Play Again" }));
    });

    // New state has has_won=false so overlay should be gone.
    expect(queryByText("You Win!")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #369 — gameEventClient instrumentation
// ---------------------------------------------------------------------------

const RESERVED_KEYS = ["game_id", "event_index", "event_type"];

describe("Twenty48Screen — gameEventClient instrumentation (#369)", () => {
  it("calls startGame('twenty48') with an initial_board override on mount", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await mountAndSettle();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const startCall = mockStartGame.mock.calls[0];
    if (startCall === undefined) throw new Error("Expected startGame call");
    const [gameType, , eventData] = startCall;
    expect(gameType).toBe("twenty48");
    expect(eventData).toBeDefined();
    const initialBoard = eventData!.initial_board as number[];
    expect(Array.isArray(initialBoard)).toBe(true);
    expect(initialBoard).toHaveLength(16);
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }
  });

  describe("after the app was killed mid-game (#2654)", () => {
    it("a saved mid-game continues the killed process's session: no new session", async () => {
      (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
      mockResumeGame.mockReturnValueOnce("killed-session");
      const { unmount } = await mountAndSettle();

      expect(mockResumeGame).toHaveBeenCalledWith("twenty48", undefined);
      expect(mockStartGame).not.toHaveBeenCalled();
      expect(mockMarkStarted).not.toHaveBeenCalled();

      await act(() => {
        dispatchKey("ArrowRight");
      });
      const moveCall = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "move");
      expect(moveCall?.[0]).toBe("killed-session");

      // Leaving closes that one session — no second game, no extra abandon.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });
      await unmount();
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      expect(mockCompleteGame.mock.calls[0]?.[0]).toBe("killed-session");
    });

    it("a saved mid-game with no session left to continue starts one, already started", async () => {
      (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
      await mountAndSettle();
      expect(mockResumeGame).toHaveBeenCalledTimes(1);
      expect(mockStartGame).toHaveBeenCalledTimes(1);
      expect(mockMarkStarted).toHaveBeenCalledWith("game-uuid-test");
    });

    it("a fresh board never resumes", async () => {
      (loadGame as jest.Mock).mockResolvedValueOnce(null);
      await mountAndSettle();
      expect(mockResumeGame).not.toHaveBeenCalled();
      expect(mockStartGame).toHaveBeenCalledTimes(1);
      expect(mockMarkStarted).not.toHaveBeenCalled();
    });
  });

  it("does not start a session when mounted with a game_over state", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(GAME_OVER_STATE);
    await mountAndSettle();
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("emits a 'move' event after a valid move with expected payload shape", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await mountAndSettle();
    mockEnqueueEvent.mockClear();

    await act(() => {
      dispatchKey("ArrowLeft");
      dispatchKey("ArrowRight");
      dispatchKey("ArrowUp");
      dispatchKey("ArrowDown");
    });

    const moveCall = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "move");
    expect(moveCall).toBeDefined();
    const [gameId, event] = moveCall!;
    expect(gameId).toBe("game-uuid-test");
    expect(event.data).toEqual(
      expect.objectContaining({
        direction: expect.stringMatching(/^(up|down|left|right)$/),
        score_delta: expect.any(Number),
        score_after: expect.any(Number),
        highest_tile_after: expect.any(Number),
        is_game_over: expect.any(Boolean),
        has_won: expect.any(Boolean),
      })
    );
    for (const key of RESERVED_KEYS) {
      expect(event.data).not.toHaveProperty(key);
    }

    // Flush the move lock so it doesn't leak into the next test.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
  });

  it("does not emit a 'move' event for a no-op move", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
    await mountAndSettle();
    mockEnqueueEvent.mockClear();
    await act(() => {
      dispatchKey("ArrowLeft");
    });
    const moveCall = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "move");
    expect(moveCall).toBeUndefined();
  });

  it("fires completeGame with snake_case payload on game_over", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await mountAndSettle();
    mockCompleteGame.mockClear();

    // Force the next move() to return a game_over state regardless of input.
    mockedEngineMove.mockImplementationOnce(() => ({
      board: GAME_OVER_BOARD,
      tiles: tilesFor(GAME_OVER_BOARD),
      score: 1234,
      scoreDelta: 16,
      game_over: true,
      has_won: false,
      startedAt: null,
      accumulatedMs: 42000,
    }));

    await act(() => {
      dispatchKey("ArrowLeft");
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const completeCall = mockCompleteGame.mock.calls[0];
    if (completeCall === undefined) throw new Error("Expected completeGame call");
    const [, summary, eventData] = completeCall;
    // A game over without the 2048 tile is a loss (#2631).
    expect(summary.outcome).toBe("loss");
    expect(summary.finalScore).toBe(1234);
    expect(summary.result).toEqual(eventData);
    expect(eventData).toEqual(
      expect.objectContaining({
        final_score: 1234,
        highest_tile: expect.any(Number),
        move_count: 1,
        duration_ms: expect.any(Number),
        outcome: "loss",
      })
    );
    expect(eventData.highest_tile).toBeGreaterThan(0);
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
  });

  it("fires completeGame with 'abandoned' outcome on unmount mid-game", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
    const { unmount } = await mountAndSettle();
    mockCompleteGame.mockClear();
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
  });

  it("unmount abandon carries final_score in the result, never as the ranked summary score (#2450)", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
    const { unmount } = await mountAndSettle();
    mockCompleteGame.mockClear();
    await unmount();
    const summary = mockCompleteGame.mock.calls[0]?.[1] as Record<string, unknown>;
    // The daily challenge's score goals read result.final_score (games.metadata)…
    expect(summary["result"]).toEqual(
      expect.objectContaining({
        final_score: expect.any(Number),
        highest_tile: expect.any(Number),
        move_count: expect.any(Number),
      })
    );
    // …while summary.finalScore would become games.final_score and rank the game.
    expect(summary).not.toHaveProperty("finalScore");
  });

  it("unmount abandon's durationMs is the game's own timer, not the hook's clock (#2684)", async () => {
    // A saved mid-game with 42 s banked and its timer paused.
    (loadGame as jest.Mock).mockResolvedValueOnce({ ...NOOP_LEFT_STATE, accumulatedMs: 42_000 });
    const { unmount } = await mountAndSettle();
    mockCompleteGame.mockClear();
    await unmount();
    const summary = mockCompleteGame.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(summary["outcome"]).toBe("abandoned");
    expect(summary["durationMs"]).toBe(42_000);
    expect((summary["result"] as Record<string, unknown>)["duration_ms"]).toBe(42_000);
  });

  it("does not double-fire game_ended: unmount after completion is a no-op", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const { unmount } = await mountAndSettle();
    mockedEngineMove.mockImplementationOnce(() => ({ ...GAME_OVER_STATE, score: 1234 }));
    await act(() => {
      dispatchKey("ArrowLeft");
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    mockCompleteGame.mockClear();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    await unmount();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("New Game on an untouched board discards the old session instead of abandoning it", async () => {
    // score=0 → handleNewGamePress skips the confirm modal.
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const { getByLabelText } = await mountAndSettle();
    mockStartGame.mockClear();
    mockStartGame.mockReturnValue("game-uuid-test-2");

    await act(async () => {
      await fireEvent.press(getByLabelText("Start a new 2048 game"));
    });

    // Never started: no abandoned row, just dropped from the device.
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(mockDiscardGame).toHaveBeenCalledWith("game-uuid-test");
    expect(mockStartGame).toHaveBeenCalledWith("twenty48", {}, expect.any(Object));
  });

  it("New Game mid-game abandons the old session once, with its progress snapshot", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();
    mockedEngineMove.mockImplementationOnce(() => ({ ...NOOP_LEFT_STATE, score: 64 }));
    await act(() => {
      dispatchKey("ArrowLeft");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    mockStartGame.mockReturnValue("game-uuid-test-2");

    await act(async () => {
      await fireEvent.press(r.getByLabelText("Start a new 2048 game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Start new game" }));
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary, eventData] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("game-uuid-test");
    expect(summary.outcome).toBe("abandoned");
    // The old game's snapshot, taken before the screen reset its move count.
    expect(summary.result).toEqual(
      expect.objectContaining({ final_score: 64, highest_tile: 256, move_count: 1 })
    );
    // #2468: an abandon never carries the ranked score.
    expect(summary).not.toHaveProperty("finalScore");
    // #2619: the analytics payload is the result plus outcome.
    expect(eventData).toEqual({ ...summary.result, outcome: "abandoned" });
    expect(mockDiscardGame).not.toHaveBeenCalled();
    expect(mockStartGame).toHaveBeenLastCalledWith("twenty48", {}, expect.any(Object));
  });

  it("capture ordering: move events are emitted in direction sequence", async () => {
    // A lone tile in the top-right corner: Left always slides it, and Down is
    // then always a valid move too (a column can't fill with two tiles), so
    // neither key is a no-op that would enqueue nothing.
    const board = [
      [0, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    (loadGame as jest.Mock).mockResolvedValueOnce({
      ...NOOP_LEFT_STATE,
      board,
      tiles: tilesFor(board),
    });
    const r = await mountAndSettle();
    // The grid renders only once the saved state has loaded; a key dispatched
    // before that is dropped by handleMove (no state yet).
    await waitFor(() => expect(r.getByLabelText("Game board")).toBeTruthy());
    mockEnqueueEvent.mockClear();

    const moveEvents = () =>
      mockEnqueueEvent.mock.calls.map((c) => c[1]).filter((e) => e?.type === "move");
    // Waits past the screen's 120 ms MOVE_LOCK_MS. Timers fire in order, so a
    // longer timer started after the move always runs after the lock releases.
    const releaseMoveLock = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

    await act(() => {
      dispatchKey("ArrowLeft");
    });
    await waitFor(() => expect(moveEvents().length).toBeGreaterThanOrEqual(1));
    await releaseMoveLock();

    await act(() => {
      dispatchKey("ArrowDown");
    });
    await waitFor(() => expect(moveEvents().length).toBeGreaterThanOrEqual(2));

    expect(moveEvents().map((e) => e.data.direction)).toEqual(["left", "down"]);

    // Flush the move lock so it doesn't leak into the next test.
    await releaseMoveLock();
  });

  it("client failures do not block gameplay (enqueueEvent throws)", async () => {
    mockEnqueueEvent.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();
    // Dispatch a move — throw must not crash the render tree.
    await act(() => {
      dispatchKey("ArrowLeft");
      dispatchKey("ArrowRight");
    });
    // Screen still renders the new-game button.
    expect(r.getByLabelText("Start a new 2048 game")).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
  });
});

// ---------------------------------------------------------------------------
// #2513 — shared result card
// ---------------------------------------------------------------------------

describe("Twenty48Screen — result card (#2513)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("win card leads with Keep Playing, then Play Again and Home", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const { getByTestId } = await mountAndSettle();
    await waitFor(() => expect(getByTestId("twenty48-result")).toBeTruthy());
    const card = within(getByTestId("twenty48-result"));
    expect(card.getByTestId("game-result-primary")).toHaveTextContent("Keep Playing");
    expect(card.getByRole("button", { name: "Play Again" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(
      card.getByText("You reached 2048! You can keep playing for a higher score.")
    ).toBeTruthy();
  });

  it("game-over card says no more moves and shows best and highest tile", async () => {
    (loadBestScore as jest.Mock).mockResolvedValueOnce(9000);
    (loadGame as jest.Mock).mockResolvedValueOnce({ ...GAME_OVER_STATE, score: 1234 });
    const { getByTestId } = await mountAndSettle();
    await waitFor(() => expect(getByTestId("twenty48-result")).toBeTruthy());
    const card = within(getByTestId("twenty48-result"));
    expect(card.getByText("Game Over")).toBeTruthy();
    expect(card.getByText("No more moves")).toBeTruthy();
    expect(card.getByText("1,234")).toBeTruthy();
    expect(card.getByText("9,000")).toBeTruthy();
    expect(card.getByText("Highest Tile")).toBeTruthy();
    expect(card.queryByText("New best")).toBeNull();
  });

  it("marks New Best against the best from before this game", async () => {
    (loadBestScore as jest.Mock).mockResolvedValueOnce(1000);
    (loadGame as jest.Mock).mockResolvedValueOnce({ ...GAME_OVER_STATE, score: 1234 });
    const { getByTestId } = await mountAndSettle();
    await waitFor(() => expect(getByTestId("twenty48-result")).toBeTruthy());
    expect(within(getByTestId("twenty48-result")).getByText("New best")).toBeTruthy();
  });

  it("Home returns to the lobby", async () => {
    const nav = mockNav();
    (loadGame as jest.Mock).mockResolvedValueOnce(GAME_OVER_STATE);
    const r = await renderScreen(nav);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(r.getByTestId("twenty48-result-home")).toBeTruthy());
    await act(async () => {
      await fireEvent.press(r.getByTestId("twenty48-result-home"));
    });
    expect(nav.popToTop).toHaveBeenCalledTimes(1);
  });

  it("View leaderboard opens 2048's board (#2633)", async () => {
    const nav = mockNav();
    (loadGame as jest.Mock).mockResolvedValueOnce(GAME_OVER_STATE);
    const r = await renderScreen(nav);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(r.getByTestId("twenty48-result")).toBeTruthy());
    await act(async () => {
      await fireEvent.press(r.getByRole("link", { name: "View leaderboard" }));
    });
    // No rank has settled on this card, so the board refetches after the sync.
    expect(nav.navigate).toHaveBeenCalledWith("Leaderboard", {
      gameType: "twenty48",
      refreshAfterSync: true,
    });
  });

  it("the ⋯ menu's Leaderboard opens 2048's board (#2633)", async () => {
    const nav = mockNav();
    const r = await renderScreen(nav);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(r.getByLabelText("More options")).toBeTruthy());
    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("Leaderboard"));
    });
    expect(nav.navigate).toHaveBeenCalledWith("Leaderboard", { gameType: "twenty48" });
  });

  it("the ⋯ menu's Stats opens 2048's stats (#2635)", async () => {
    const nav = mockNav();
    const r = await renderScreen(nav);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(r.getByLabelText("More options")).toBeTruthy());
    await act(async () => {
      await fireEvent.press(r.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(r.getByText("Stats"));
    });
    expect(mockShellNavigate).toHaveBeenCalledWith("GameStats", { gameType: "twenty48" });
  });

  it("ignores moves while the win card is up, then accepts them after Keep Playing (#2550 review)", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const { getByTestId, getByLabelText } = await mountAndSettle();
    await waitFor(() => expect(getByTestId("twenty48-result")).toBeTruthy());
    mockedEngineMove.mockClear();

    await act(() => {
      dispatchKey("ArrowRight");
      dispatchKey("ArrowDown");
    });
    expect(mockedEngineMove).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.press(getByLabelText("Continue playing after reaching 2048"));
    });
    await act(() => {
      dispatchKey("ArrowRight");
    });
    expect(mockedEngineMove).toHaveBeenCalled();

    // Flush the move lock so it doesn't leak into the next test.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
  });
});

// ---------------------------------------------------------------------------
// #2631 — 2048 is a win, a game over before it a loss; the card's leaderboard
// ---------------------------------------------------------------------------

describe("Twenty48Screen — win / loss outcomes and the leaderboard (#2631)", () => {
  // The move that makes the 2048 tile.
  const WIN_BOARD = [
    [2048, 4, 2, 0],
    [8, 16, 0, 0],
    [32, 64, 0, 0],
    [128, 256, 0, 0],
  ];
  const WIN_MOVE: Twenty48State = {
    board: WIN_BOARD,
    tiles: tilesFor(WIN_BOARD),
    score: 20_480,
    scoreDelta: 2048,
    game_over: false,
    has_won: true,
    startedAt: null,
    accumulatedMs: 90_000,
  };
  // A game over on a board that has 2048 (after Keep Playing, or on the win move).
  const OVER_WITH_2048_BOARD = [
    [2048, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ];
  const OVER_WITH_2048: Twenty48State = {
    ...GAME_OVER_STATE,
    board: OVER_WITH_2048_BOARD,
    tiles: tilesFor(OVER_WITH_2048_BOARD),
    score: 30_000,
    has_won: true,
  };
  const SAVED_RANK_3 = "Saved as Riley · #3 on the leaderboard";

  const releaseMoveLock = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

  async function playMove(result: Twenty48State) {
    mockedEngineMove.mockImplementationOnce(() => result);
    await act(() => {
      dispatchKey("ArrowLeft");
    });
    await releaseMoveLock();
  }

  const outcomes = () => mockCompleteGame.mock.calls.map((c) => c[1].outcome);

  const pressKeepPlaying = (r: Awaited<ReturnType<typeof mountAndSettle>>) =>
    act(async () => {
      await fireEvent.press(r.getByLabelText("Continue playing after reaching 2048"));
    });

  beforeEach(() => jest.clearAllMocks());

  it("reaching 2048 completes the session as a win at that moment's score", async () => {
    await saveDisplayName("Riley");
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();

    await playMove(WIN_MOVE);

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary, eventData] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("game-uuid-test");
    expect(summary).toEqual(
      expect.objectContaining({ outcome: "win", finalScore: 20_480, durationMs: 90_000 })
    );
    expect(summary.result).toEqual(
      expect.objectContaining({ final_score: 20_480, highest_tile: 2048, outcome: "win" })
    );
    expect(eventData.outcome).toBe("win");
    // The win card shows, with this game's rank.
    await waitFor(() => expect(r.getByText("You Win!")).toBeTruthy());
    await r.findByText(SAVED_RANK_3);
  });

  it("the submission renders once: one rank lookup for the session, one line on the card", async () => {
    await saveDisplayName("Riley");
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();

    await playMove(WIN_MOVE);
    const card = within(await r.findByTestId("twenty48-result"));
    await waitFor(() => expect(card.getAllByText(SAVED_RANK_3)).toHaveLength(1));
    expect(mockGetRank).toHaveBeenCalledTimes(1);
    expect(mockGetRank).toHaveBeenCalledWith("game-uuid-test");
  });

  it("asks for a display name on the win card when the player has none", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();

    await playMove(WIN_MOVE);
    expect(await r.findByLabelText("Pick a display name for leaderboards")).toBeTruthy();
    // No name yet: nothing to look up.
    expect(mockGetRank).not.toHaveBeenCalled();
  });

  it("Keep Playing sends no completion; a later game over neither completes nor submits", async () => {
    await saveDisplayName("Riley");
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();
    await playMove(WIN_MOVE);
    await r.findByText(SAVED_RANK_3);
    mockCompleteGame.mockClear();

    await pressKeepPlaying(r);
    expect(mockCompleteGame).not.toHaveBeenCalled();

    // Play after 2048 is untracked: no completion, no second rank lookup.
    await playMove(OVER_WITH_2048);
    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(mockGetRank).toHaveBeenCalledTimes(1);
    const card = within(await r.findByTestId("twenty48-result"));
    await waitFor(() => expect(card.getByText("Game Over")).toBeTruthy());
    expect(card.queryByText(SAVED_RANK_3)).toBeNull();

    await r.unmount();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("a game over without 2048 completes as a loss and shows the rank", async () => {
    await saveDisplayName("Riley");
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();

    await playMove({ ...GAME_OVER_STATE, score: 1234 });

    expect(outcomes()).toEqual(["loss"]);
    expect(mockCompleteGame.mock.calls[0]![1].finalScore).toBe(1234);
    await r.findByText(SAVED_RANK_3);
    expect(mockGetRank).toHaveBeenCalledTimes(1);
  });

  it("a game over on the same move that reaches 2048 is a win", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await mountAndSettle();

    await playMove({ ...OVER_WITH_2048, score: 20_480 });

    expect(outcomes()).toEqual(["win"]);
    expect(mockCompleteGame.mock.calls[0]![1].finalScore).toBe(20_480);
  });

  it("new builds never write kept_playing or completed", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();
    await playMove(WIN_MOVE);
    await pressKeepPlaying(r);
    await playMove(OVER_WITH_2048);
    // Play Again after the game over: that session is already finished.
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    await r.unmount();
    expect(outcomes()).toEqual(["win"]);
  });

  it("a resumed game that already won does not complete again", async () => {
    await saveDisplayName("Riley");
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const r = await mountAndSettle();
    await waitFor(() => expect(r.getByText("You Win!")).toBeTruthy());
    // It was finished at the win: nothing left open to adopt, and no new session.
    expect(mockResumeGame).toHaveBeenCalledWith("twenty48", undefined);
    expect(mockStartGame).not.toHaveBeenCalled();

    await pressKeepPlaying(r);
    await playMove(OVER_WITH_2048);
    await r.unmount();

    expect(mockCompleteGame).not.toHaveBeenCalled();
    expect(mockGetRank).not.toHaveBeenCalled();
  });

  it("a won save whose session an older build left open records it as the win", async () => {
    // A pre-#2631 build closed the session only on Keep Playing; the app was
    // killed with the win card up.
    await saveDisplayName("Riley");
    mockResumeGame.mockReturnValueOnce("old-build-session");
    (loadGame as jest.Mock).mockResolvedValueOnce({ ...WON_STATE, accumulatedMs: 60_000 });
    const r = await mountAndSettle();

    expect(mockStartGame).not.toHaveBeenCalled();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("old-build-session");
    expect(summary).toEqual(
      expect.objectContaining({ outcome: "win", finalScore: 2048, durationMs: 60_000 })
    );
    expect(summary.result).toEqual(
      expect.objectContaining({ final_score: 2048, highest_tile: 2048, outcome: "win" })
    );
    await r.findByText(SAVED_RANK_3);
    expect(mockGetRank).toHaveBeenCalledWith("old-build-session");

    // Play after it stays untracked.
    await pressKeepPlaying(r);
    await playMove(OVER_WITH_2048);
    await r.unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockGetRank).toHaveBeenCalledTimes(1);
  });

  it("a move queued during the winning move is dropped, not played behind the win card", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();
    mockedEngineMove.mockClear();
    (saveGame as jest.Mock).mockClear();

    // Two quick swipes: the second lands inside the first's 120 ms move lock.
    mockedEngineMove.mockImplementationOnce(() => WIN_MOVE);
    await act(() => {
      dispatchKey("ArrowLeft");
      dispatchKey("ArrowRight");
    });
    await releaseMoveLock();

    expect(mockedEngineMove).toHaveBeenCalledTimes(1);
    expect((saveGame as jest.Mock).mock.calls.at(-1)?.[0]?.board).toEqual(WIN_BOARD);
    const card = within(await r.findByTestId("twenty48-result"));
    expect(card.getByText("You Win!")).toBeTruthy();
    expect(card.getAllByText("20,480").length).toBeGreaterThan(0);
  });

  it("when the 2048 move also ends the game, the card is the win without Keep Playing", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();

    await playMove({ ...OVER_WITH_2048, score: 20_480 });

    const card = within(await r.findByTestId("twenty48-result"));
    expect(card.getByText("You Win!")).toBeTruthy();
    expect(card.queryByText("Game Over")).toBeNull();
    expect(card.getByText("No more moves")).toBeTruthy();
    expect(card.queryByLabelText("Continue playing after reaching 2048")).toBeNull();
    expect(card.getByTestId("game-result-primary")).toHaveTextContent("Play Again");
  });

  it("New Game after the win starts a new game without asking to abandon", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();
    await playMove(WIN_MOVE);
    await pressKeepPlaying(r);
    mockStartGame.mockClear();

    await act(async () => {
      await fireEvent.press(r.getByLabelText("Start a new 2048 game"));
    });

    expect(r.queryByText("Start new game?")).toBeNull();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(outcomes()).toEqual(["win"]);
  });

  it("no submit on an abandon: leaving mid-game", async () => {
    await saveDisplayName("Riley");
    (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
    const r = await mountAndSettle();
    await playMove({ ...NOOP_LEFT_STATE, score: 64 });

    await r.unmount();
    expect(outcomes()).toEqual(["abandoned"]);
    expect(mockGetRank).not.toHaveBeenCalled();
  });

  it("no submit on an abandon: New Game mid-game; the next game submits afresh", async () => {
    await saveDisplayName("Riley");
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const r = await mountAndSettle();
    await playMove({ ...NOOP_LEFT_STATE, score: 64 });

    await act(async () => {
      await fireEvent.press(r.getByLabelText("Start a new 2048 game"));
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Start new game" }));
    });
    expect(outcomes()).toEqual(["abandoned"]);
    expect(mockGetRank).not.toHaveBeenCalled();

    await playMove({ ...GAME_OVER_STATE, score: 512 });
    await r.findByText(SAVED_RANK_3);
    expect(outcomes()).toEqual(["abandoned", "loss"]);
    expect(mockGetRank).toHaveBeenCalledTimes(1);
  });

  it("a saved game-over board shows no leaderboard line and looks nothing up", async () => {
    await saveDisplayName("Riley");
    (loadGame as jest.Mock).mockResolvedValueOnce(GAME_OVER_STATE);
    const r = await mountAndSettle();
    const card = within(await r.findByTestId("twenty48-result"));
    expect(card.queryByText(/Saved as/)).toBeNull();
    expect(mockGetRank).not.toHaveBeenCalled();
  });
});
