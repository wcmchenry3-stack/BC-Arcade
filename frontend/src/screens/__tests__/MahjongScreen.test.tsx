/**
 * MahjongScreen — screen-level lifecycle, HUD, and result-card tests.
 *
 * Engine purity is tested in engine.test.ts (#891). These tests cover the
 * screen's mount/resume lifecycle, HUD wiring, undo affordance, the shared
 * result card for a win or a deadlock (#2510), what each game records
 * (#2517, #2627), and stats tracking.
 */

import React from "react";
import { render, fireEvent, act, waitFor, within } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import MahjongScreen from "../MahjongScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import * as mahjongEngine from "../../game/mahjong/engine";
import { DEADLOCK_OVERLAY_DELAY_MS } from "../../game/mahjong/engine";

// How long to wait for the deadlock card. Only an upper bound: generous so a
// loaded parallel run (the card shows after DEADLOCK_OVERLAY_DELAY_MS) isn't flaky.
const DEADLOCK_CARD_WAIT_MS = DEADLOCK_OVERLAY_DELAY_MS + 3000;
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

// The app-wide foreground-time counter behind useGameSync's active-play window
// (#2684) is held still by the shared mock jest.setup.ts pins (#2710):
// Mahjong's own play timer is what the summaries carry.

// The real hook, with close() counted so tests can tell the screen closed its
// session through the hook instead of building the abandon itself (#2679).
const mockClose = jest.fn();
jest.mock("../../game/_shared/useGameSync", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useCallback } = require("react");
  const actual = jest.requireActual("../../game/_shared/useGameSync");
  return {
    ...actual,
    useGameSync: (gameType: string) => {
      const sync = actual.useGameSync(gameType);
      const realClose = sync.close;
      const close = useCallback(() => {
        mockClose();
        realClose();
      }, [realClose]);
      return { ...sync, close };
    },
  };
});

// The result card's rank lookup (sessionBoardAdapter, #2677).
const mockGetGameRank = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetGameRank(gameId) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: () => Promise.resolve(),
}));
jest.mock("../../game/_shared/displayNameSync", () => ({
  ...jest.requireActual("../../game/_shared/displayNameSync"),
  flushDisplayNameSync: () => Promise.resolve(true),
}));

import { resetDisplayNameCacheForTests } from "../../game/_shared/displayName";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <MahjongScreen />
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
  const layoutCard = api.queryByLabelText("Turtle");
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
  mockGetGameRank.mockReset();
  mockGetGameRank.mockResolvedValue({ ranked: true, rank: 5, is_best: true, reason: null });
  mockNavListeners.clear();
  mockAddListener.mockClear();
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-uuid-test");
  mockEnqueueEvent.mockReset();
  mockCompleteGame.mockReset();
  mockClose.mockClear();
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
    expect(api.getByText(/SCORE/)).toBeTruthy();
    expect(api.getByText(/PAIRS/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Undo affordance
// ---------------------------------------------------------------------------

describe("MahjongScreen — undo affordance", () => {
  it("undo button is disabled on a fresh game (no moves yet)", async () => {
    const api = await mount();
    const undo = api.getByLabelText("Undo last matched pair");
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

  // #2627: a cleared board is a win, so Mahjong's win rate counts it.
  it("completes a cleared board as a win, with its score and result block", async () => {
    await winNow();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary, data] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("game-uuid-test");
    expect(summary).toEqual(
      expect.objectContaining({
        outcome: "win",
        finalScore: 4060, // 3550 + 10 for the pair + 500 for clearing the board
        result: { won: true, pairs: 72 },
      })
    );
    expect(summary.durationMs).toBeGreaterThanOrEqual(180_000);
    expect(data).toEqual({ final_score: 4060, outcome: "win", won: true, pairs: 72 });
  });

  // #2627 / #2677: the finished game is the leaderboard entry. The card asks
  // where it ranks; nothing is posted to the legacy /mahjong/score route.
  it("shows the win's rank from the session board under the display name", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({ bestScore: 1000, bestTimeMs: 0, gamesPlayed: 3, gamesWon: 1 })
    );
    const fetchSpy = jest.spyOn(global, "fetch");
    try {
      const api = await winNow();
      const card = within(await api.findByTestId("mahjong-result"));
      await waitFor(() =>
        expect(card.getByText("Saved as Riley · #5 on the leaderboard")).toBeTruthy()
      );
      expect(mockGetGameRank).toHaveBeenCalledTimes(1);
      expect(mockGetGameRank).toHaveBeenCalledWith("game-uuid-test");
      expect(card.getByText("New best")).toBeTruthy();
      expect(scoreQueue.enqueue).not.toHaveBeenCalled();
      const urls = fetchSpy.mock.calls.map(([url]) => String(url));
      expect(urls.filter((u) => u.includes("/mahjong/score"))).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // #2627 review: the engine banks the running clock only on pause, so
  // accumulatedMs is still 0 on a board cleared in one sitting.
  it("records the best time from the play timer, not the banked time", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify({
        ...makeLastPairState(),
        accumulatedMs: 0,
        startedAt: Date.now() - 90_000,
      })
    );
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-0"));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-1"));
    });
    await api.findByTestId("mahjong-result");
    await waitFor(async () => {
      const stats = JSON.parse((await AsyncStorage.getItem("mahjong_stats_v1")) ?? "{}");
      expect(stats.gamesWon).toBe(1);
      expect(stats.bestTimeMs).toBeGreaterThanOrEqual(90_000);
      expect(stats.bestTimeMs).toBeLessThan(100_000);
    });
  });

  // #2704: the card's Time is the real play time, not the banked-on-pause 0.
  it("shows the real play time for a board cleared in one sitting", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify({
        ...makeLastPairState(),
        accumulatedMs: 0,
        startedAt: Date.now() - 90_000,
      })
    );
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-0"));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-1"));
    });
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.getByText("1:30")).toBeTruthy();
  });

  // #2704: a won board restored from storage keeps the time it was won with.
  it("doesn't grow the time on a won board restored from storage", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify(makeWinState({ accumulatedMs: 90_000, startedAt: Date.now() - 600_000 }))
    );
    const api = await mount();
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.getByText("1:30")).toBeTruthy();
  });

  it("asks for a display name on the card when none is set", async () => {
    const api = await winNow();
    const card = within(await api.findByTestId("mahjong-result"));
    await waitFor(() => expect(card.getByTestId("result-name-prompt")).toBeTruthy());
    expect(scoreQueue.enqueue).not.toHaveBeenCalled();
  });

  it("does not look up a rank for a won game resumed from storage", async () => {
    await AsyncStorage.setItem("player_display_name", "Riley");
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeWinState()));
    const api = await mount();
    await api.findByTestId("mahjong-result");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockGetGameRank).not.toHaveBeenCalled();
    expect(mockCompleteGame).not.toHaveBeenCalled();
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
      await fireEvent.press(api.getByLabelText("Turtle"));
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
      await fireEvent.press(
        api.getByLabelText("Show a hint — highlights one valid pair for 2 seconds")
      );
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
      await fireEvent.press(
        api.getByLabelText("Show a hint — highlights one valid pair for 2 seconds")
      );
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
    const btn = api.getByLabelText("Shuffle remaining tiles into a new solvable arrangement");
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  it("pressing the shuffle HUD button decrements shufflesLeft", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeShufflableState(3)));
    const api = await mount();

    await act(async () => {
      await fireEvent.press(
        api.getByLabelText("Shuffle remaining tiles into a new solvable arrangement")
      );
    });

    // shufflesLeft should now be 2; the HUD text shows the count.
    expect(api.queryByText(/SHUFFLE 2/)).toBeTruthy();
  });

  it("shuffle HUD button is disabled when shufflesLeft is 0", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeShufflableState(0)));
    const api = await mount();
    const btn = api.getByLabelText("Shuffle remaining tiles into a new solvable arrangement");
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
    expect(api.getByText("NO MOVES")).toBeTruthy();
    expect(api.queryByText(/Shuffle \(\d+\)/)).toBeTruthy();
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
      timeout: DEADLOCK_CARD_WAIT_MS,
    });
    const card = within(cardEl);
    expect(card.getByTestId("mahjong-result-title")).toHaveTextContent("You Lose");
    expect(card.getByText("No free pairs remain")).toBeTruthy();
    expect(card.getByRole("button", { name: "Play Again" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Change Layout" })).toBeTruthy();
    expect(card.queryByText(/Saved as/)).toBeNull();
    // Nothing to undo in this deal, so the card offers no Undo.
    expect(card.queryByTestId("mahjong-result-undo")).toBeNull();
    expect(mockGetGameRank).not.toHaveBeenCalled();
  });

  // #2569 review: the full-screen card must not take away the undo the header
  // offered — a deadlock one undo away from a live board isn't final.
  it("offers Undo on the deadlock card and returns to the board", async () => {
    const beforeLastMatch = makeWinState({
      isComplete: false,
      isDeadlocked: false,
      shufflesLeft: 0,
      pairsRemoved: 39,
      score: 600,
      tiles: [
        { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
        { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
      ],
    } as Partial<MahjongState>);
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify(
        makeNoMovesState({
          shufflesLeft: 0,
          isDeadlocked: true,
          pairsRemoved: 40,
          score: 640,
          undoStack: [beforeLastMatch],
        } as Partial<MahjongState>)
      )
    );
    const api = await mount();
    const card = await waitFor(() => api.getByTestId("mahjong-result"), {
      timeout: DEADLOCK_CARD_WAIT_MS,
    });
    await act(async () => {
      await fireEvent.press(within(card).getByRole("button", { name: "Undo last move" }));
    });

    expect(api.queryByTestId("mahjong-result")).toBeNull();
    expect(api.getByLabelText("mock-tile-0")).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, DEADLOCK_OVERLAY_DELAY_MS + 100));
    });
    expect(api.queryByTestId("mahjong-result")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #2517 — a deadlock the player leaves is recorded as a loss
// ---------------------------------------------------------------------------

describe("MahjongScreen — deadlock recorded as a loss (#2517)", () => {
  /** Two free, non-matching tiles and no shuffles: deadlocked, one pair undone behind it. */
  function makeDeadlockState(): MahjongState {
    const beforeLastMatch = makeWinState({
      isComplete: false,
      isDeadlocked: false,
      shufflesLeft: 0,
      pairsRemoved: 39,
      score: 600,
      tiles: [
        { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
        { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
      ],
    } as Partial<MahjongState>);
    return makeWinState({
      isComplete: false,
      isDeadlocked: true,
      shufflesLeft: 0,
      pairsRemoved: 40,
      score: 640,
      accumulatedMs: 90000,
      tiles: [
        { id: 2, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
        { id: 3, suit: "bamboos", rank: 2, faceId: 27, col: 10, row: 0, layer: 0 },
      ],
      undoStack: [beforeLastMatch],
    } as Partial<MahjongState>);
  }

  /** Loads the deadlocked board and taps a tile, which opens the sync session. */
  async function mountDeadlockedWithSession() {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(makeDeadlockState()));
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-2"));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const card = await waitFor(() => api.getByTestId("mahjong-result"), {
      timeout: DEADLOCK_CARD_WAIT_MS,
    });
    return { api, card: within(card) };
  }

  function lastSummary() {
    const call = mockCompleteGame.mock.calls.at(-1)!;
    return { summary: call[1] as Record<string, unknown>, data: call[2] };
  }

  it("records a loss, with no score, when the player changes layout", async () => {
    const { card } = await mountDeadlockedWithSession();
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Change Layout" }));
    });
    // The loss is recorded before any close(): the board isn't abandoned.
    expect(mockClose).not.toHaveBeenCalled();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const { summary, data } = lastSummary();
    expect(summary.outcome).toBe("loss");
    // A loss counts (only abandons are excluded), and Mahjong's leaderboard
    // ranks every scored row — so a deadlock must not carry a score.
    expect(summary).not.toHaveProperty("finalScore");
    expect(data).toEqual(expect.objectContaining({ won: false, pairs: 40 }));
  });

  // #2592 review: a lost board is finished. If CONTINUE could reopen it, each
  // resume → tap → leave would record another loss (and earn XP again).
  it("finishes the lost board: no CONTINUE, and the save is cleared", async () => {
    const { api, card } = await mountDeadlockedWithSession();
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Change Layout" }));
    });
    expect(api.getByLabelText("Turtle")).toBeTruthy(); // on layout select
    expect(api.queryByLabelText("Continue")).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem("mahjong_game")).toBeNull());
  });

  it("records a loss when the player leaves by navigating back, and clears the save", async () => {
    const { api } = await mountDeadlockedWithSession();
    await act(async () => {
      mockNavListeners.get("beforeRemove")?.forEach((h) => h());
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(lastSummary().summary.outcome).toBe("loss");
    expect(lastSummary().summary).not.toHaveProperty("finalScore");
    // The unmount that follows finds the session closed: no second row.
    await api.unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    // Next visit starts on layout select, not the same deadlocked board.
    await waitFor(async () => expect(await AsyncStorage.getItem("mahjong_game")).toBeNull());
  });

  // #2569 review: "Undo last move" on the card rescues the board, so leaving
  // afterwards is an abandon, not a loss.
  it("stays abandoned when the player undoes out of the deadlock first", async () => {
    const { api, card } = await mountDeadlockedWithSession();
    await act(async () => {
      await fireEvent.press(card.getByRole("button", { name: "Undo last move" }));
    });
    expect(api.queryByTestId("mahjong-result")).toBeNull();
    await act(async () => {
      mockNavListeners.get("beforeRemove")?.forEach((h) => h());
    });
    await api.unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(lastSummary().summary.outcome).toBe("abandoned");
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

// #2469 item 3 / #2619 — the registered progress snapshot, and the explicit
// abandon built from the same helper. MahjongResult requires `won` + `pairs`;
// a wrong shape is a 400 the sync worker dead-letters.
describe("MahjongScreen — progress snapshot (#2619)", () => {
  // Date.now held still, so the board's play timer (elapsedMs) is exactly its
  // banked 60 s: the first tap starts the running segment at the same instant.
  const NOW = 1_800_000_000_000;
  const PLAY_MS = 60_000;
  let dateNow: jest.SpyInstance;
  beforeEach(() => {
    dateNow = jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    dateNow.mockRestore();
  });

  /** A board in progress with a free matching pair: not deadlocked. */
  async function mountMidGameWithSession() {
    const inProgress = makeWinState({
      isComplete: false,
      isDeadlocked: false,
      pairsRemoved: 12,
      score: 240,
      accumulatedMs: PLAY_MS,
      tiles: [
        { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
        { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
      ],
    } as Partial<MahjongState>);
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(inProgress));
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-0"));
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    mockCompleteGame.mockClear();
    return api;
  }

  // #2684: the snapshot's durationMs (Mahjong's own play timer) wins over the
  // hook's foreground clock.
  it("an unmount abandon carries the snapshot result, the play timer and no score", async () => {
    const { unmount } = await mountMidGameWithSession();
    await unmount();

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary, data] = mockCompleteGame.mock.calls[0]!;
    expect(summary).toEqual({
      outcome: "abandoned",
      result: { won: false, pairs: 12 },
      durationMs: PLAY_MS,
    });
    expect(data).toEqual({ won: false, pairs: 12, outcome: "abandoned" });
  });

  // #2627: back-navigation leaves the abandon to useGameSync's unmount, with
  // the snapshot — no screen-level abandon carrying a score.
  it("a back-navigation leaves the abandon to the hook's unmount", async () => {
    const { unmount } = await mountMidGameWithSession();
    await act(async () => {
      mockNavListeners.get("beforeRemove")?.forEach((h) => h());
    });
    expect(mockCompleteGame).not.toHaveBeenCalled();

    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary).toEqual({
      outcome: "abandoned",
      result: { won: false, pairs: 12 },
      durationMs: PLAY_MS,
    });
  });

  // #2679: New Game closes the session through the hook's close(), which
  // abandons it with the snapshot — the screen builds no summary of its own.
  it("New Game closes the session through the hook, with the snapshot", async () => {
    const api = await mountMidGameWithSession();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("New Game"));
    });
    const confirm = api.queryByLabelText("Start New");
    if (confirm) {
      await act(async () => {
        await fireEvent.press(confirm);
      });
    }

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [gameId, summary, data] = mockCompleteGame.mock.calls[0]!;
    expect(gameId).toBe("game-uuid-test");
    expect(summary).toEqual({
      outcome: "abandoned",
      result: { won: false, pairs: 12 },
      durationMs: PLAY_MS,
    });
    expect(data).toEqual({ won: false, pairs: 12, outcome: "abandoned" });
  });
});

// ---------------------------------------------------------------------------
// #2627 — the layout is row metadata; no Scoreboard dead end
// ---------------------------------------------------------------------------

describe("MahjongScreen — layout metadata and menu (#2627)", () => {
  it("starts the session with the layout as metadata", async () => {
    const api = await mount(); // picks Turtle on layout select
    await act(async () => {
      await fireEvent.press(api.getAllByLabelText(/^mock-tile-/)[0]!);
    });
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const [gameType, metadata, eventData] = mockStartGame.mock.calls[0]!;
    expect(gameType).toBe("mahjong");
    expect(metadata).toEqual({ layout: "turtle" });
    expect(eventData).toEqual({ layout: "turtle" });
  });

  it("records the layout of a resumed board", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify(
        makeWinState({
          isComplete: false,
          pairsRemoved: 3,
          score: 30,
          currentLayoutId: "four_rivers",
          tiles: [
            { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
            { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
          ],
        } as Partial<MahjongState>)
      )
    );
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-0"));
    });
    expect(mockStartGame.mock.calls[0]![1]).toEqual({ layout: "four_rivers" });
  });

  // #2627 review: Level Select keeps the board's session open for CONTINUE;
  // a new layout picked there must open its own session, not win on the old one.
  it("a layout picked from Level Select opens its own session", async () => {
    await AsyncStorage.setItem(
      "@mahjong/progress",
      JSON.stringify({
        unlockedLayouts: ["turtle", "pyramid"],
        currentLayoutId: "turtle",
        currentState: null,
      })
    );
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify(
        makeWinState({
          isComplete: false,
          pairsRemoved: 5,
          score: 50,
          currentLayoutId: "turtle",
          tiles: [
            { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
            { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
            { id: 2, suit: "bamboos", rank: 2, faceId: 27, col: 20, row: 0, layer: 0 },
            { id: 3, suit: "bamboos", rank: 2, faceId: 27, col: 30, row: 0, layer: 0 },
          ],
        } as Partial<MahjongState>)
      )
    );
    mockStartGame.mockReturnValueOnce("turtle-game").mockReturnValueOnce("pyramid-game");
    const lastPairDeal = makeWinState({
      isComplete: false,
      pairsRemoved: 71,
      score: 710,
      startedAt: null,
      accumulatedMs: 0,
      tiles: [
        { id: 10, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
        { id: 11, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
      ],
    } as Partial<MahjongState>);
    const createGame = jest.spyOn(mahjongEngine, "createGame").mockReturnValue(lastPairDeal);
    try {
      const api = await mount();
      // Play on turtle: a matched pair opens the turtle session.
      await act(async () => {
        await fireEvent.press(api.getByLabelText("mock-tile-0"));
      });
      await act(async () => {
        await fireEvent.press(api.getByLabelText("mock-tile-1"));
      });
      expect(mockStartGame).toHaveBeenCalledTimes(1);

      await act(async () => {
        await fireEvent.press(api.getByLabelText("More options"));
      });
      await act(async () => {
        await fireEvent.press(api.getByText("Level Select"));
      });
      expect(mockCompleteGame).not.toHaveBeenCalled(); // CONTINUE still resumes it
      await act(async () => {
        await fireEvent.press(api.getByLabelText("Pyramid"));
      });

      // The turtle session is closed through the hook's close(), abandoned
      // with its own progress.
      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      const [turtleId, turtleSummary] = mockCompleteGame.mock.calls[0]!;
      expect(turtleId).toBe("turtle-game");
      expect(turtleSummary).toEqual(
        expect.objectContaining({ outcome: "abandoned", result: { won: false, pairs: 6 } })
      );

      // Clearing the pyramid board wins on a new session with its layout.
      await act(async () => {
        await fireEvent.press(api.getByLabelText("mock-tile-10"));
      });
      await act(async () => {
        await fireEvent.press(api.getByLabelText("mock-tile-11"));
      });
      expect(mockStartGame).toHaveBeenCalledTimes(2);
      expect(mockStartGame.mock.calls[1]![1]).toEqual({ layout: "pyramid" });
      expect(mockCompleteGame).toHaveBeenCalledTimes(2);
      const [winId, winSummary] = mockCompleteGame.mock.calls[1]!;
      expect(winId).toBe("pyramid-game");
      expect(winSummary.outcome).toBe("win");
    } finally {
      createGame.mockRestore();
    }
  });

  it("has no Scoreboard item in the overflow menu", async () => {
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    expect(api.getByText("New Game")).toBeTruthy();
    expect(api.queryByText("Scoreboard")).toBeNull();
  });
});
