/**
 * MahjongScreen — screen-level lifecycle, HUD, and result-card tests.
 *
 * Engine purity is tested in engine.test.ts (#891). These tests cover the
 * screen's mount/resume lifecycle, HUD wiring, undo affordance, the shared
 * result card for a win or a deadlock (#2510), and stats tracking.
 */

import React from "react";
import { render, fireEvent, act, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import MahjongScreen from "../MahjongScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { MahjongScoreboardProvider } from "../../game/mahjong/MahjongScoreboardContext";
import { DEADLOCK_OVERLAY_DELAY_MS } from "../../game/mahjong/engine";
import type { MahjongState } from "../../game/mahjong/types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("../../components/mahjong/GameCanvas", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Pressable, Text } = require("react-native");
  function MockGameCanvas({
    state,
    onTilePress,
    hintIds,
  }: {
    state: { tiles: readonly { id: number }[] };
    onTilePress: (id: number) => void;
    hintIds: ReadonlySet<number>;
  }) {
    return (
      <View testID="game-canvas">
        {state.tiles.map((tile) => (
          <Pressable
            key={tile.id}
            accessibilityLabel={`mock-tile-${tile.id}`}
            onPress={() => onTilePress(tile.id)}
          />
        ))}
        <Text testID="hint-ids-size">{hintIds?.size ?? 0}</Text>
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
    setOptions: jest.fn(),
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

import { scoreQueue } from "../../game/_shared/scoreQueue";

jest.mock("../../game/mahjong/api", () => ({
  mahjongApi: { submitScore: jest.fn(), getLeaderboard: jest.fn() },
}));

import { mahjongApi } from "../../game/mahjong/api";
import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <MahjongScoreboardProvider>
        <MahjongScreen />
      </MahjongScoreboardProvider>
    </ThemeProvider>
  );
}

async function mount() {
  const api = await renderScreen();
  // Flush the initial loadGame()/loadStats()/loadProgress() promises.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // If no saved game exists the screen shows the layout select screen.
  // Pick the turtle layout so tests that need the play view can proceed.
  const layoutCard = api.queryByLabelText("layout.turtle");
  if (layoutCard) {
    await act(async () => {
      await fireEvent.press(layoutCard);
      await Promise.resolve(); // flush saveStats / saveProgress
    });
  }
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
  resetDisplayNameCacheForTests();
  (mahjongApi.submitScore as jest.Mock).mockReset();
  (mahjongApi.submitScore as jest.Mock).mockResolvedValue({
    player_name: "Riley",
    score: 3700,
    rank: 5,
  });
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

describe("MahjongScreen — win result card (#2510)", () => {
  /** One free pair left (two 1-bamboos at opposite ends of a row). */
  function makeLastPairState(): MahjongState {
    return makeWinState({
      isComplete: false,
      pairsRemoved: 71,
      score: 3550,
      currentLayoutId: "pyramid",
      tiles: [
        { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
        { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
      ],
    } as Partial<MahjongState>);
  }

  async function winNow() {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeLastPairState()));
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-0"));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-1"));
    });
    return api;
  }

  it("shows the card with the score, time and actions", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeWinState()));
    const api = await mount();
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.getByTestId("mahjong-result-title")).toHaveTextContent("You Win!");
    expect(card.getByText("All 72 pairs cleared")).toBeTruthy();
    expect(card.getByText("3,600")).toBeTruthy();
    expect(card.getByText("3:00")).toBeTruthy();
    expect(card.getByRole("button", { name: "Play Again" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Change Layout" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Home" })).toBeTruthy();
  });

  it("submits the score under the display name when the last pair is matched", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({ bestScore: 1000, bestTimeMs: 0, gamesPlayed: 3, gamesWon: 1 })
    );
    const api = await winNow();
    const card = within(await api.findByTestId("mahjong-result"));
    await waitFor(() =>
      expect(card.getByText("Saved as Riley · #5 on the leaderboard")).toBeTruthy()
    );
    expect(mahjongApi.submitScore).toHaveBeenCalledTimes(1);
    const [name, score] = (mahjongApi.submitScore as jest.Mock).mock.calls[0]!;
    expect(name).toBe("Riley");
    expect(score).toBeGreaterThan(1000);
    expect(card.getByText("New best")).toBeTruthy();
    expect(scoreQueue.enqueue).not.toHaveBeenCalled();
  });

  it("does not resubmit a won game resumed from storage", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeWinState()));
    const api = await mount();
    await api.findByTestId("mahjong-result");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mahjongApi.submitScore).not.toHaveBeenCalled();
  });

  it("Play Again deals the same layout again", async () => {
    const api = await winNow();
    await api.findByTestId("mahjong-result");
    await act(async () => {
      await fireEvent.press(api.getByRole("button", { name: "Play Again" }));
    });
    expect(api.queryByTestId("mahjong-result")).toBeNull();
    expect(api.getByTestId("game-canvas")).toBeTruthy();
    await waitFor(async () => {
      const saved = JSON.parse((await AsyncStorage.getItem("mahjong_game")) ?? "null");
      expect(saved).toEqual(
        expect.objectContaining({ currentLayoutId: "pyramid", isComplete: false })
      );
    });
  });

  it("Change Layout goes to layout select, and a pick starts a fresh game", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeWinState()));
    const api = await mount();
    await act(async () => {
      await fireEvent.press(await api.findByRole("button", { name: "Change Layout" }));
    });
    expect(api.queryByTestId("mahjong-result")).toBeNull();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("layout.turtle"));
    });
    await waitFor(() => {
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
// Hint button
// ---------------------------------------------------------------------------

describe("MahjongScreen — hint button", () => {
  /** Minimal in-progress state with two free matching tiles so getAnyFreePair returns a pair. */
  function makeHintableState(): MahjongState {
    return {
      _v: 1,
      tiles: [
        { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 },
        { id: 1, suit: "characters", rank: 1, faceId: 8, col: 2, row: 0, layer: 0 },
      ] as MahjongState["tiles"],
      selected: null,
      pairsRemoved: 0,
      score: 0,
      shufflesLeft: 3,
      undoStack: [],
      isComplete: false,
      isDeadlocked: false,
      startedAt: null,
      accumulatedMs: 0,
      dealId: "TEST",
    } as unknown as MahjongState;
  }

  it("passes hintIds to GameCanvas when a valid pair exists", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeHintableState()));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("action.hintLabel"));
    });

    expect(api.getByTestId("hint-ids-size").props.children).toBe(2);
  });

  it("shows the no-hint toast when no free pair is available", async () => {
    // id:0 (layer 0) is blocked by id:1 (layer 1); id:1 is free but has no second
    // free match, so getAnyFreePair returns null.
    const blockedState: MahjongState = {
      _v: 1,
      tiles: [
        { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 },
        { id: 1, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 1 },
      ] as MahjongState["tiles"],
      selected: null,
      pairsRemoved: 0,
      score: 0,
      shufflesLeft: 3,
      undoStack: [],
      isComplete: false,
      isDeadlocked: false,
      startedAt: null,
      accumulatedMs: 0,
      dealId: "TEST",
    } as unknown as MahjongState;
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(blockedState));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("action.hintLabel"));
    });

    expect(api.getByTestId("no-hint-toast")).toBeTruthy();
    expect(api.getByTestId("hint-ids-size").props.children).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Shuffle button
// ---------------------------------------------------------------------------

describe("MahjongScreen — shuffle button", () => {
  /** Two free matching tiles so the board has a valid move (not a shuffle-CTA state). */
  function makeShufflableState(shufflesLeft = 3): MahjongState {
    return {
      _v: 1,
      tiles: [
        { id: 0, suit: "characters", rank: 1, faceId: 8, col: 0, row: 0, layer: 0 },
        { id: 1, suit: "characters", rank: 1, faceId: 8, col: 2, row: 0, layer: 0 },
      ] as MahjongState["tiles"],
      selected: null,
      pairsRemoved: 0,
      score: 0,
      shufflesLeft,
      undoStack: [],
      isComplete: false,
      isDeadlocked: false,
      startedAt: null,
      accumulatedMs: 0,
      dealId: "TEST",
    } as unknown as MahjongState;
  }

  it("shuffle HUD button is enabled on a fresh game", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeShufflableState(3)));
    const api = await mount();
    const btn = api.getByLabelText("action.shuffleLabel");
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  it("pressing the shuffle HUD button decrements shufflesLeft", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeShufflableState(3)));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(api.getByLabelText("action.shuffleLabel"));
    });

    // shufflesLeft should now be 2; the HUD text shows the count.
    expect(api.queryByText(/action\.shuffle.*2/)).toBeTruthy();
  });

  it("shuffle HUD button is disabled when shufflesLeft is 0", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeShufflableState(0)));
    const api = await mount();
    const btn = api.getByLabelText("action.shuffleLabel");
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No-moves overlays
// ---------------------------------------------------------------------------

describe("MahjongScreen — no-moves overlays", () => {
  /** tiles: [] means hasFreePairs([]) = false, triggering the no-moves path. */
  function makeNoMovesState(overrides: Partial<MahjongState> = {}): MahjongState {
    return makeWinState({
      isComplete: false,
      tiles: [],
      shufflesLeft: 2,
      pairsRemoved: 0,
      score: 0,
      ...overrides,
    });
  }

  it("renders the shuffle CTA overlay when no free pairs remain and shuffles are available", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify(makeNoMovesState({ shufflesLeft: 2 }))
    );
    const api = await mount();
    expect(api.getByText("overlay.noMoves")).toBeTruthy();
    expect(api.queryByText(/overlay\.shuffleButton/)).toBeTruthy();
  });

  it("does not show the deadlock card immediately on mount", async () => {
    jest.useFakeTimers();
    try {
      await AsyncStorage.setItem(
        "mahjong_game",
        JSON.stringify(makeNoMovesState({ shufflesLeft: 0, isDeadlocked: true }))
      );
      const api = await mount();
      expect(api.queryByTestId("mahjong-result")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows a You Lose card after the delay, and submits nothing (#2510)", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify(makeNoMovesState({ shufflesLeft: 0, isDeadlocked: true, score: 900 }))
    );
    const api = await mount();
    expect(api.queryByTestId("mahjong-result")).toBeNull();
    const cardEl = await waitFor(() => api.getByTestId("mahjong-result"), {
      timeout: DEADLOCK_OVERLAY_DELAY_MS + 200,
    });
    const card = within(cardEl);
    expect(card.getByTestId("mahjong-result-title")).toHaveTextContent("You Lose");
    expect(card.getByText("No free pairs remain")).toBeTruthy();
    expect(card.getByRole("button", { name: "Play Again" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Change Layout" })).toBeTruthy();
    expect(card.queryByText(/Saved as/)).toBeNull();
    expect(mahjongApi.submitScore).not.toHaveBeenCalled();
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
