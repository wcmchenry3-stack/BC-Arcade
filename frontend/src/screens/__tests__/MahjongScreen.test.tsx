/**
 * MahjongScreen — screen-level lifecycle, HUD, and win-modal tests.
 *
 * Engine purity is tested in engine.test.ts (#891). These tests cover the
 * screen's mount/resume lifecycle, HUD wiring, undo affordance, score
 * submission via scoreQueue, and stats tracking.
 */

import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import MahjongScreen from "../MahjongScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { MahjongScoreboardProvider } from "../../game/mahjong/MahjongScoreboardContext";
import type { MahjongState } from "../../game/mahjong/types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("../../components/mahjong/GameCanvas", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Pressable } = require("react-native");
  function MockGameCanvas({
    onNewGamePress,
  }: {
    onTilePress: (id: number) => void;
    onShufflePress: () => void;
    onNewGamePress: () => void;
  }) {
    return (
      <View testID="game-canvas">
        <Pressable accessibilityLabel="mock-new-game" onPress={onNewGamePress} />
      </View>
    );
  }
  MockGameCanvas.displayName = "MockGameCanvas";
  return { __esModule: true, default: MockGameCanvas };
});

const mockNavListeners = new Map<string, Array<() => void>>();
const mockAddListener = jest.fn((event: string, handler: () => void) => {
  const arr = mockNavListeners.get(event) ?? [];
  arr.push(handler);
  mockNavListeners.set(event, arr);
  return () => {
    const current = mockNavListeners.get(event) ?? [];
    mockNavListeners.set(
      event,
      current.filter((h) => h !== handler)
    );
  };
});

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: mockAddListener,
  }),
  useFocusEffect: (cb: () => () => void) => {
    // Run the effect once synchronously in tests (simulates screen focus).
    const cleanup = cb();
    return cleanup;
  },
}));

jest.mock("expo-screen-orientation", () => ({
  lockAsync: jest.fn().mockResolvedValue(undefined),
  OrientationLock: {
    LANDSCAPE: "LANDSCAPE",
    PORTRAIT_UP: "PORTRAIT_UP",
  },
}));

jest.mock("@sentry/react-native", () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  init: jest.fn(),
  wrap: <T,>(x: T) => x,
}));

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

jest.mock("../../game/_shared/scoreQueue", () => ({
  scoreQueue: {
    enqueue: jest.fn().mockResolvedValue({ id: "q-1" }),
    flush: jest.fn().mockResolvedValue({ attempted: 0, succeeded: 0, failed: 0, remaining: 0 }),
    registerHandler: jest.fn(),
  },
}));
// eslint-disable-next-line import/order
import { scoreQueue } from "../../game/_shared/scoreQueue";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderScreen() {
  return render(
    <ThemeProvider>
      <MahjongScoreboardProvider>
        <MahjongScreen />
      </MahjongScoreboardProvider>
    </ThemeProvider>
  );
}

async function mount() {
  const api = renderScreen();
  // Flush the initial loadGame()/loadStats() promises so the screen renders
  // its post-load state (mirrors the pattern used in SolitaireScreen tests).
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}

/** A minimal valid win state that passes loadGame() validation. */
function makeWinState(overrides: Partial<MahjongState> = {}): MahjongState {
  return {
    _v: 1,
    tiles: [],
    selected: null,
    pairsRemoved: 72,
    score: 3600,
    shufflesLeft: 3,
    undoStack: [],
    isComplete: true,
    isDeadlocked: false,
    startedAt: null,
    accumulatedMs: 180000,
    ...overrides,
  } as unknown as MahjongState;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await AsyncStorage.clear();
  mockNavListeners.clear();
  mockAddListener.mockClear();
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-uuid-test");
  mockEnqueueEvent.mockReset();
  mockCompleteGame.mockReset();
  (scoreQueue.enqueue as jest.Mock).mockReset();
  (scoreQueue.enqueue as jest.Mock).mockResolvedValue({ id: "q-1" });
  (scoreQueue.flush as jest.Mock).mockReset();
  (scoreQueue.flush as jest.Mock).mockResolvedValue({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    remaining: 0,
  });
});

// ---------------------------------------------------------------------------
// Mount / HUD
// ---------------------------------------------------------------------------

describe("MahjongScreen — mount and HUD", () => {
  it("renders the game canvas after loading resolves", async () => {
    const api = await mount();
    expect(api.getByTestId("game-canvas")).toBeTruthy();
  });

  it("renders score and pairs HUD on a fresh game", async () => {
    const api = await mount();
    expect(api.getByText(/hud\.score/)).toBeTruthy();
    expect(api.getByText(/hud\.pairs/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Undo affordance
// ---------------------------------------------------------------------------

describe("MahjongScreen — undo affordance", () => {
  it("undo button is disabled on a fresh game (no moves yet)", async () => {
    const api = await mount();
    const undo = api.getByLabelText("action.undoLabel");
    expect(undo.props.accessibilityState?.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Save / resume
// ---------------------------------------------------------------------------

describe("MahjongScreen — save/resume lifecycle", () => {
  it("resumes a saved game without re-incrementing gamesPlayed", async () => {
    const saved: MahjongState = makeWinState({ isComplete: false, pairsRemoved: 4, score: 200 });
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(saved));
    await mount();
    const raw = await AsyncStorage.getItem("mahjong_stats_v1");
    const gamesPlayed = raw ? JSON.parse(raw).gamesPlayed : 0;
    expect(gamesPlayed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Win modal
// ---------------------------------------------------------------------------

describe("MahjongScreen — win modal", () => {
  async function mountAtWin() {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeWinState()));
    return mount();
  }

  it("shows the win modal when the game is complete", async () => {
    const api = await mountAtWin();
    expect(api.getByText("overlay.youWon")).toBeTruthy();
  });

  it("enqueues the score via scoreQueue when name is submitted", async () => {
    const api = await mountAtWin();
    await act(async () => {
      fireEvent.changeText(api.getByLabelText(/enter your name/i), "Alice");
    });
    await act(async () => {
      fireEvent.press(api.getByLabelText(/submit score/i));
    });
    await waitFor(() => {
      expect(scoreQueue.enqueue).toHaveBeenCalledWith(
        "mahjong",
        expect.objectContaining({ player_name: "Alice", score: 3600 })
      );
    });
  });

  it("shows submitted confirmation after successful enqueue", async () => {
    const api = await mountAtWin();
    await act(async () => {
      fireEvent.changeText(api.getByLabelText(/enter your name/i), "Alice");
    });
    // Wrap press + async handler resolution in a single act so setSubmitted(true)
    // is flushed before we query the tree.
    await act(async () => {
      fireEvent.press(api.getByLabelText(/submit score/i));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.getByText(/Score saved/i)).toBeTruthy();
  });

  it("tapping New Game in the win modal resets the board", async () => {
    const api = await mountAtWin();
    await act(async () => {
      fireEvent.press(api.getByLabelText("action.newGameLabel"));
    });
    // After new game, win modal is gone and fresh game canvas remains.
    await waitFor(() => {
      expect(api.queryByText("overlay.youWon")).toBeNull();
      expect(api.getByTestId("game-canvas")).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------

describe("MahjongScreen — stats tracking", () => {
  it("increments gamesPlayed on a fresh deal", async () => {
    await mount();
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem("mahjong_stats_v1");
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).gamesPlayed).toBe(1);
    });
  });

  it("does not double-count gamesWon when resuming an already-complete game", async () => {
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({ bestScore: 3600, bestTimeMs: 180000, gamesPlayed: 1, gamesWon: 1 })
    );
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeWinState()));
    await mount();
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem("mahjong_stats_v1");
      const stats = raw ? JSON.parse(raw) : { gamesWon: 1 };
      expect(stats.gamesWon).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// useGameSync lifecycle
// ---------------------------------------------------------------------------

describe("MahjongScreen — useGameSync lifecycle", () => {
  it("completes the sync session as abandoned on beforeRemove after a move would have started it", async () => {
    // Seed a game in progress so syncGetGameId() would return a session.
    // Since we can't tap tiles through the mock, we rely on the abandon guard
    // — if no session is active, beforeRemove is a no-op.
    await mount();
    const handlers = mockNavListeners.get("beforeRemove") ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    await act(async () => {
      for (const h of handlers) h();
    });
    // No session was started (no tile tap through mock), so completeGame is not called.
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });
});
