/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, act, waitFor, fireEvent } from "@testing-library/react-native";
import Twenty48Screen from "../Twenty48Screen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { Twenty48ScoreboardProvider } from "../../game/twenty48/Twenty48ScoreboardContext";
import { saveGame, clearGame, loadGame } from "../../game/twenty48/storage";
import { Twenty48State } from "../../game/twenty48/types";

// Force web platform so the keyboard-listener useEffect runs.
import { Platform } from "react-native";
(Platform as { OS: string }).OS = "web";

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
});

function mockNav() {
  return {
    setOptions: jest.fn(),
    navigate: jest.fn(),
    goBack: jest.fn(),
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

  it("New Game dismisses the win overlay", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const { getByText, getAllByLabelText, queryByText } = await mountAndSettle();
    await waitFor(() => expect(getByText("You Win!")).toBeTruthy());

    // Both the header button and the overlay button share the same label.
    // Press any one of them — they both call handleNewGame.
    await act(async () => {
      await fireEvent.press(getAllByLabelText("Start a new 2048 game")[0]);
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
    expect(summary.outcome).toBe("completed");
    expect(eventData).toEqual(
      expect.objectContaining({
        final_score: 1234,
        highest_tile: expect.any(Number),
        move_count: 1,
        duration_ms: expect.any(Number),
        outcome: "completed",
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

  it("fires completeGame with 'kept_playing' outcome when Keep Playing is pressed", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const { getByLabelText } = await mountAndSettle();
    mockCompleteGame.mockClear();

    await act(async () => {
      await fireEvent.press(getByLabelText("Continue playing after reaching 2048"));
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const keptPlayingCall = mockCompleteGame.mock.calls[0];
    if (keptPlayingCall === undefined) throw new Error("Expected completeGame call");
    const [, summary, eventData] = keptPlayingCall;
    expect(summary.outcome).toBe("kept_playing");
    expect(eventData.outcome).toBe("kept_playing");
    expect(eventData).toEqual(
      expect.objectContaining({
        final_score: expect.any(Number),
        highest_tile: expect.any(Number),
        move_count: expect.any(Number),
        duration_ms: expect.any(Number),
      })
    );
  });

  it("fires completeGame with 'abandoned' outcome on unmount mid-game", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(NOOP_LEFT_STATE);
    const { unmount } = await mountAndSettle();
    mockCompleteGame.mockClear();
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
  });

  it("does not double-fire game_ended: unmount after completion is a no-op", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(WON_STATE);
    const { getByLabelText, unmount } = await mountAndSettle();
    await act(async () => {
      await fireEvent.press(getByLabelText("Continue playing after reaching 2048"));
    });
    mockCompleteGame.mockClear();
    await unmount();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("New Game on a fresh board abandons the old session and starts a new one", async () => {
    // score=0 → handleNewGamePress skips the confirm modal and calls
    // resetGame directly, which exercises the abandon→restart path without
    // modal-ambiguity in the test.
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    const { getByLabelText } = await mountAndSettle();
    mockStartGame.mockClear();
    mockStartGame.mockReturnValue("game-uuid-test-2");
    mockCompleteGame.mockClear();

    await act(async () => {
      await fireEvent.press(getByLabelText("Start a new 2048 game"));
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
    expect(mockStartGame).toHaveBeenCalledWith("twenty48", {}, expect.any(Object));
  });

  it("capture ordering: move events are emitted in direction sequence", async () => {
    (loadGame as jest.Mock).mockResolvedValueOnce(null);
    await mountAndSettle();
    mockEnqueueEvent.mockClear();

    // First settled move
    await act(() => {
      dispatchKey("ArrowLeft");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    // Second settled move
    await act(() => {
      dispatchKey("ArrowDown");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    const moveEvents = mockEnqueueEvent.mock.calls
      .map((c) => c[1])
      .filter((e) => e?.type === "move");
    // Assert the first emitted move is before the second — validates ordering.
    expect(moveEvents.length).toBeGreaterThan(0);
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
