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
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import MahjongScreen from "../MahjongScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import * as mahjongEngine from "../../game/mahjong/engine";
import { DEADLOCK_OVERLAY_DELAY_MS } from "../../game/mahjong/engine";
import { SAVE_DEBOUNCE_MS } from "../../game/mahjong/useMahjongPersistence";

// How long to wait for the deadlock card. Only an upper bound: generous so a
// loaded parallel run (the card shows after DEADLOCK_OVERLAY_DELAY_MS) isn't flaky.
const DEADLOCK_CARD_WAIT_MS = DEADLOCK_OVERLAY_DELAY_MS + 3000;
import type { MahjongState } from "../../game/mahjong/types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Counts the board's renders: the HUD clock's tick must not re-render it (#2747).
const mockCanvasRenders = { count: 0 };
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
    mockCanvasRenders.count += 1;
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

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      popToTop: jest.fn(),
      goBack: jest.fn(),
      navigate: mockNavigate,
      setOptions: jest.fn(),
      addListener: mockAddListener,
    }),
    {
      useFocusEffect: (cb: () => () => void) => {
        // Run the effect once synchronously in tests (simulates screen focus).
        const cleanup = cb();
        return cleanup;
      },
    }
  )
);

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
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvent: lazy(() => mockEnqueueEvent),
    completeGame: lazy(() => mockCompleteGame),
  });
});

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

// The result card's rank lookup (lookupGameRank, #2677).
const mockGetGameRank = jest.fn();
jest.mock("../../api/stats", () =>
  mockScreenDeps().mockStatsApi({ getGameRank: (gameId: string) => mockGetGameRank(gameId) })
);
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () =>
  mockScreenDeps().mockDisplayNameSync({ flushDisplayNameSync: () => Promise.resolve(true) })
);

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
    _v: 2,
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

/**
 * An undo entry for a match (#2961): the two tiles it removed, at their
 * indices in the board before it, and the counters before it.
 */
function matchUndo(
  before: { shufflesLeft: number; pairsRemoved: number; score: number },
  removedTiles: { index: number; tile: MahjongState["tiles"][number] }[]
): MahjongState["undoStack"][number] {
  return {
    kind: "match",
    removedTiles: removedTiles as unknown as [never, never],
    scoreBefore: before.score,
    pairsRemovedBefore: before.pairsRemoved,
    shufflesLeftBefore: before.shufflesLeft,
    selectedBefore: null,
    isCompleteBefore: false,
    isDeadlockedBefore: false,
  };
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
});

// ---------------------------------------------------------------------------
// Mount / HUD
// ---------------------------------------------------------------------------

describe("MahjongScreen — mount and HUD", () => {
  it("renders the game canvas after loading resolves", async () => {
    const api = await mount();
    expect(api.getByTestId("game-canvas")).toBeTruthy();
  });

  it("renders the play clock and pairs HUD on a fresh game (#2747)", async () => {
    const api = await mount();
    expect(api.getByTestId("mahjong-clock")).toHaveTextContent("TIME 0:00");
    expect(api.getByTestId("mahjong-clock").props.accessibilityLabel).toBe("Elapsed time 0:00");
    expect(api.getByText(/PAIRS/)).toBeTruthy();
    // The clock replaces the score readout: during play the score is 10 per
    // pair, which PAIRS already shows. The result card still has it.
    expect(api.queryByText(/SCORE/)).toBeNull();
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
      expect(card.queryByText("New best")).toBeNull(); // a first clear is no new best (#2977)
      const urls = fetchSpy.mock.calls.map(([url]) => String(url));
      expect(urls.filter((u) => u.includes("/mahjong/score"))).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  /**
   * Clears the last pair in one sitting 90 s after the first tap: the board
   * loads with nothing banked, so the running segment is all its play.
   */
  async function winInOneSitting() {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify({ ...makeLastPairState(), accumulatedMs: 0, startedAt: null })
    );
    const api = await mount();
    const start = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(start);
    try {
      await act(async () => {
        await fireEvent.press(api.getByLabelText("mock-tile-0")); // starts the clock
      });
      nowSpy.mockReturnValue(start + 90_000);
      await act(async () => {
        await fireEvent.press(api.getByLabelText("mock-tile-1"));
      });
    } finally {
      nowSpy.mockRestore();
    }
    return api;
  }

  // #2627 review: the engine banks the running clock only on pause, so
  // accumulatedMs is still 0 on a board cleared in one sitting.
  it("records the best time from the play timer, not the banked time", async () => {
    const api = await winInOneSitting();
    await api.findByTestId("mahjong-result");
    await waitFor(async () => {
      const stats = JSON.parse((await AsyncStorage.getItem("mahjong_stats_v1")) ?? "{}");
      expect(stats.gamesWon).toBe(1);
      // Per layout (#2747): the last-pair board is a Pyramid deal.
      expect(stats.bestTimeMsByLayout.pyramid).toBeGreaterThanOrEqual(90_000);
      expect(stats.bestTimeMsByLayout.pyramid).toBeLessThan(100_000);
    });
  });

  // #2704: the card's Time is the real play time, not the banked-on-pause 0.
  // #2747: a clear ranks by it, so it is the card's hero, with the score and
  // the best time (this first clear) below it.
  it("shows the real play time for a board cleared in one sitting", async () => {
    const api = await winInOneSitting();
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.getAllByText("1:30")).toHaveLength(2); // the hero (Time) and Best
    expect(card.getByText("Time")).toBeTruthy();
    expect(card.getByText("Score")).toBeTruthy();
    expect(card.queryByText("New best")).toBeNull(); // a first clear is no new best (#2977)
  });

  // Codex review on #2917: an old save resumed with no time banked finishes
  // under the 36 s ranking floor. It is no best, and doesn't block real ones.
  it("never records a clear under the ranking floor as the best time (#2747)", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify({ ...makeLastPairState(), accumulatedMs: 0, startedAt: null })
    );
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-0"));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-1")); // cleared in ~0 s
    });
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.queryByText("New best")).toBeNull();
    expect(card.queryByText("Best")).toBeNull();
    await waitFor(async () => {
      const stats = JSON.parse((await AsyncStorage.getItem("mahjong_stats_v1")) ?? "{}");
      expect(stats.gamesWon).toBe(1);
      expect(stats.bestTimeMsByLayout).toEqual({});
    });
  });

  it("lets a real clear beat a stored best under the floor (#2747)", async () => {
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({
        bestScore: 1220,
        bestTimeMsByLayout: { pyramid: 3_000 },
        gamesPlayed: 3,
        gamesWon: 1,
      })
    );
    const api = await winInOneSitting(); // 1:30
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.queryByText("New best")).toBeNull(); // a first clear is no new best (#2977)
    expect(card.getAllByText("1:30")).toHaveLength(2); // the hero and Best
    await waitFor(async () => {
      const stats = JSON.parse((await AsyncStorage.getItem("mahjong_stats_v1")) ?? "{}");
      expect(stats.bestTimeMsByLayout.pyramid).toBeGreaterThanOrEqual(90_000);
    });
  });

  it("is a new best only when faster than the best clear so far (#2747)", async () => {
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({
        bestScore: 1220,
        bestTimeMsByLayout: { pyramid: 60_000 },
        gamesPlayed: 3,
        gamesWon: 1,
      })
    );
    const api = await winInOneSitting(); // 1:30 on Pyramid, slower than 1:00
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.getByText("1:30")).toBeTruthy();
    expect(card.getByText("1:00")).toBeTruthy(); // Best
    expect(card.queryByText("New best")).toBeNull();
  });

  it("flags a clear faster than an earlier best on this layout as a new best (#2977)", async () => {
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({
        bestScore: 1220,
        bestTimeMsByLayout: { pyramid: 120_000 },
        gamesPlayed: 3,
        gamesWon: 1,
      })
    );
    const api = await winInOneSitting(); // 1:30 on Pyramid, faster than 2:00
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.getByText("New best")).toBeTruthy();
    await waitFor(async () => {
      const stats = JSON.parse((await AsyncStorage.getItem("mahjong_stats_v1")) ?? "{}");
      expect(stats.bestTimeMsByLayout.pyramid).toBeGreaterThanOrEqual(90_000);
      expect(stats.bestTimeMsByLayout.pyramid).toBeLessThan(120_000);
    });
  });

  // Owner decision on #2747: the device best is per layout, like the boards.
  it("a fast clear on another layout doesn't count as this layout's best", async () => {
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({
        bestScore: 1220,
        bestTimeMsByLayout: { turtle: 40_000 },
        gamesPlayed: 3,
        gamesWon: 1,
      })
    );
    const api = await winInOneSitting(); // 1:30 on Pyramid
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.queryByText("New best")).toBeNull(); // a first clear is no new best (#2977)
    expect(card.getAllByText("1:30")).toHaveLength(2); // the hero and Best
    expect(card.queryByText("0:40")).toBeNull();
    await waitFor(async () => {
      const stats = JSON.parse((await AsyncStorage.getItem("mahjong_stats_v1")) ?? "{}");
      expect(stats.bestTimeMsByLayout.turtle).toBe(40_000);
      expect(stats.bestTimeMsByLayout.pyramid).toBeGreaterThanOrEqual(90_000);
    });
  });

  it("doesn't show the old cross-layout best as this layout's", async () => {
    await AsyncStorage.setItem(
      "mahjong_stats_v1",
      JSON.stringify({ bestScore: 1220, bestTimeMs: 40_000, gamesPlayed: 3, gamesWon: 1 })
    );
    const api = await winInOneSitting();
    const card = within(await api.findByTestId("mahjong-result"));
    expect(card.queryByText("New best")).toBeNull(); // a first clear is no new best (#2977)
    expect(card.queryByText("0:40")).toBeNull();
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
      _v: 2,
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
      _v: 2,
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
      _v: 2,
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

  it("hides the shuffle CTA while deadlocked, even with shuffles left (#3090)", async () => {
    jest.useFakeTimers();
    try {
      await AsyncStorage.setItem(
        "mahjong_game",
        JSON.stringify(makeNoMovesState({ shufflesLeft: 2, isDeadlocked: true }))
      );
      const api = await mount();
      expect(api.queryByText(/Shuffle \(\d+\)/)).toBeNull();
      expect(api.queryByText("NO MOVES")).toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(DEADLOCK_OVERLAY_DELAY_MS + 50);
      });
      expect(api.getByTestId("mahjong-result")).toBeTruthy();
      expect(api.queryByText(/Shuffle \(\d+\)/)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
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
    const beforeLastMatch = matchUndo({ shufflesLeft: 0, pairsRemoved: 39, score: 600 }, [
      { index: 0, tile: { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 } },
      {
        index: 1,
        tile: { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
      },
    ]);
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
    // The last match took a free pair from beside the two tiles left.
    const beforeLastMatch = matchUndo({ shufflesLeft: 0, pairsRemoved: 39, score: 600 }, [
      {
        index: 2,
        tile: { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 20, row: 0, layer: 0 },
      },
      {
        index: 3,
        tile: { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 30, row: 0, layer: 0 },
      },
    ]);
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

  // #2633: ⋯ → Leaderboard covers the game; its clock must not run meanwhile.
  it("stops the play clock while another screen covers the game", async () => {
    const { unmount } = await mountMidGameWithSession(); // the tap starts the clock at NOW
    const emit = async (event: string) => {
      await act(async () => {
        mockNavListeners.get(event)?.forEach((h) => h());
      });
    };
    await emit("blur");
    dateNow.mockReturnValue(NOW + 10 * 60_000); // ten minutes on the leaderboard
    await emit("focus");
    dateNow.mockReturnValue(NOW + 10 * 60_000 + 5_000); // five more seconds of play

    await unmount();
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.durationMs).toBe(PLAY_MS + 5_000);
  });

  it("a blur before the first move doesn't start the clock on return", async () => {
    // A board saved before its first move: nothing banked, so the load leaves
    // its clock stopped (#2750).
    const inProgress = makeWinState({
      isComplete: false,
      isDeadlocked: false,
      pairsRemoved: 0,
      accumulatedMs: 0,
      startedAt: null,
    } as Partial<MahjongState>);
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(inProgress));
    await mount();
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    dateNow.mockReturnValue(NOW + 60_000);
    await act(async () => {
      mockNavListeners.get("focus")?.forEach((h) => h());
    });
    await waitFor(async () => {
      const saved = JSON.parse((await AsyncStorage.getItem("mahjong_game"))!);
      expect(saved.startedAt).toBeNull();
    });
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

  it("has no Scorecard (or old Scoreboard) item in the overflow menu", async () => {
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    expect(api.getByText("New Game")).toBeTruthy();
    expect(api.queryByText(/Scoreboard|Scorecard/)).toBeNull();
  });

  it("has a Leaderboard item that opens Mahjong's board (#2633)", async () => {
    const api = await mount();
    mockNavigate.mockClear();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("Leaderboard"));
    });
    // Each layout has its own board (#2747): the menu opens the one on screen.
    expect(mockNavigate).toHaveBeenCalledWith("Leaderboard", {
      gameType: "mahjong",
      partition: { layout: "turtle" },
    });
  });

  it("has a Stats item that opens Mahjong's stats (#2635)", async () => {
    const api = await mount();
    mockNavigate.mockClear();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("Stats"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("GameStats", { gameType: "mahjong" });
  });

  it("the layout picker's menu has the Stats item too (#2635)", async () => {
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("Level Select"));
    });
    expect(api.getByTestId("mahjong-layout-turtle")).toBeTruthy(); // on the layout picker
    mockNavigate.mockClear();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("Stats"));
    });
    expect(mockNavigate).toHaveBeenCalledWith("GameStats", { gameType: "mahjong" });
  });
});

// ---------------------------------------------------------------------------
// #2750 — the clock stops in the background, and a relaunch counts neither
// the time the app was closed nor loses the play before it
// ---------------------------------------------------------------------------

describe("MahjongScreen — app background and relaunch (#2750)", () => {
  const PLAY_MS = 60_000;
  let appStateSpy: jest.SpyInstance;
  // AppState.addEventListener may already be a shared mock whose calls
  // outlive a test: only listeners added from this test on are emitted to.
  let appStateBase: number;
  let now: number;
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    appStateSpy = jest.spyOn(AppState, "addEventListener");
    appStateBase = appStateSpy.mock.calls.length;
    now = 1_800_000_000_000;
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    nowSpy.mockRestore();
    appStateSpy.mockRestore();
  });

  /** The app moves to `status`, as the OS reports it to every listener. */
  async function setAppState(status: AppStateStatus) {
    await act(async () => {
      for (const [type, listener] of appStateSpy.mock.calls.slice(appStateBase)) {
        if (type === "change") (listener as (s: AppStateStatus) => void)(status);
      }
    });
  }

  /** The last pair on the board, with a minute of play banked. */
  function lastPairState(): MahjongState {
    return makeWinState({
      isComplete: false,
      pairsRemoved: 71,
      score: 3550,
      accumulatedMs: PLAY_MS,
      startedAt: null,
      tiles: [
        { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
        { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
      ],
    } as Partial<MahjongState>);
  }

  async function tap(api: Awaited<ReturnType<typeof mount>>, id: number) {
    await act(async () => {
      await fireEvent.press(api.getByLabelText(`mock-tile-${id}`));
    });
  }

  function lastSummary(): Record<string, unknown> {
    return mockCompleteGame.mock.calls.at(-1)![1] as Record<string, unknown>;
  }

  it("doesn't count the time the app spends in the background", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(lastPairState()));
    const api = await mount();
    await tap(api, 0); // selects the first tile
    now += 20_000;
    await setAppState("background");
    now += 2 * 60 * 60_000; // two hours away
    await setAppState("active");
    now += 5_000;
    await tap(api, 1); // clears the board
    await api.findByTestId("mahjong-result");

    expect(lastSummary()).toEqual(
      expect.objectContaining({ outcome: "win", durationMs: PLAY_MS + 25_000 })
    );
  });

  it("returning to the foreground while the leaderboard still covers the game doesn't resume", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(lastPairState()));
    const api = await mount();
    await tap(api, 0);
    now += 20_000;
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    await setAppState("background");
    now += 60 * 60_000;
    await setAppState("active"); // back in the app, the leaderboard still on top
    now += 10 * 60_000;
    await act(async () => {
      mockNavListeners.get("focus")?.forEach((h) => h());
    });
    now += 5_000;
    await tap(api, 1);
    await api.findByTestId("mahjong-result");

    expect(lastSummary()).toEqual(
      expect.objectContaining({ outcome: "win", durationMs: PLAY_MS + 25_000 })
    );
  });

  // #2747: the HUD clock is the same play clock the win reports.
  it("the HUD clock freezes in the background and stops at the win", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(lastPairState()));
    const api = await mount();
    // The result card hides the board from screen readers; the clock is still there.
    const clock = () => api.getByTestId("mahjong-clock", { includeHiddenElements: true });
    expect(clock()).toHaveTextContent("TIME 1:00"); // banked, not running yet
    await tap(api, 0); // the clock runs
    now += 20_000;
    await setAppState("background");
    expect(clock()).toHaveTextContent("TIME 1:20");
    now += 2 * 60 * 60_000; // two hours away
    await setAppState("active");
    expect(clock()).toHaveTextContent("TIME 1:20");
    now += 5_000;
    await tap(api, 1); // clears the board
    await api.findByTestId("mahjong-result");
    expect(clock()).toHaveTextContent("TIME 1:25");
    expect(lastSummary()).toEqual(expect.objectContaining({ durationMs: PLAY_MS + 25_000 }));

    now += 10 * 60_000; // the card stays up: the clock doesn't move
    await setAppState("background");
    await setAppState("active");
    expect(clock()).toHaveTextContent("TIME 1:25");
  });

  it("the HUD clock ticks each second without re-rendering the board", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(lastPairState()));
    // Date stays the suite's mock; only the clock's timeout is faked.
    jest.useFakeTimers({ doNotFake: ["Date", "nextTick", "queueMicrotask", "setImmediate"] });
    try {
      // A board under way: loading it runs its clock from now.
      const api = await mount();
      await tap(api, 0);
      const rendersBefore = mockCanvasRenders.count;
      for (let s = 1; s <= 5; s++) {
        now += 1_000;
        await act(async () => {
          jest.advanceTimersByTime(1_000);
        });
      }
      expect(api.getByTestId("mahjong-clock")).toHaveTextContent("TIME 1:05");
      expect(mockCanvasRenders.count).toBe(rendersBefore);
    } finally {
      jest.useRealTimers();
    }
  });

  // The issue's example: a move, a two-day break, then the win.
  it("a relaunch keeps the play before the kill and drops the time the app was closed", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(lastPairState()));
    const first = await mount();
    await tap(first, 0); // selects the first tile; the clock runs
    now += 30_000;
    await setAppState("background"); // the OS kills the app from here
    await first.unmount();
    mockCompleteGame.mockClear();

    now += 2 * 24 * 60 * 60_000; // two days later, a fresh launch
    const second = await mount();
    now += 5_000;
    await tap(second, 1); // the saved selection plus this tile clear the board
    await second.findByTestId("mahjong-result");

    expect(lastSummary()).toEqual(
      expect.objectContaining({ outcome: "win", durationMs: PLAY_MS + 35_000 })
    );
  });

  // A first tap that lands while the player is away mustn't start the clock
  // running: it starts paused, and the return starts it.
  it("a first tap while away leaves the clock paused until the return", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify({ ...lastPairState(), accumulatedMs: 0, startedAt: null })
    );
    const api = await mount(); // nothing played yet: the clock waits
    await setAppState("background");
    await tap(api, 0); // lands while away, and opens the session
    now += 60 * 60_000; // an hour away
    await setAppState("active");
    now += 5_000;
    mockCompleteGame.mockClear();
    await api.unmount();
    expect(lastSummary()).toEqual(
      expect.objectContaining({ outcome: "abandoned", durationMs: 5_000 })
    );
  });

  // CONTINUE from Level Select carries on from the board still in memory: the
  // play since the last save is kept, and the time on Level Select isn't play.
  it("CONTINUE from Level Select keeps the unsaved play and skips the time on Level Select", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify(
        makeWinState({
          isComplete: false,
          pairsRemoved: 70,
          score: 700,
          accumulatedMs: PLAY_MS,
          startedAt: null,
          tiles: [
            { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
            { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
            { id: 2, suit: "bamboos", rank: 2, faceId: 27, col: 20, row: 0, layer: 0 },
            { id: 3, suit: "bamboos", rank: 2, faceId: 27, col: 30, row: 0, layer: 0 },
          ],
        } as Partial<MahjongState>)
      )
    );
    const api = await mount();
    await tap(api, 0); // selects a tile and opens the session; the save is written
    now += 20_000; // play not yet saved
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    await act(async () => {
      await fireEvent.press(api.getByText("Level Select"));
    });
    now += 10 * 60_000; // ten minutes browsing layouts
    await act(async () => {
      await fireEvent.press(api.getByLabelText(/continue/i));
    });
    now += 5_000;
    mockCompleteGame.mockClear();
    await api.unmount();
    expect(lastSummary()).toEqual(
      expect.objectContaining({ outcome: "abandoned", durationMs: PLAY_MS + 25_000 })
    );
  });

  // #2750 review: CONTINUE resumes only a clock Level Select paused. A new
  // layout played to a deadlock, then Level Select and CONTINUE, must leave
  // the deadlocked board's clock stopped.
  it("CONTINUE doesn't start a deadlocked board's clock after a layout switch", async () => {
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify(
        makeWinState({
          isComplete: false,
          pairsRemoved: 70,
          accumulatedMs: PLAY_MS,
          startedAt: null,
          tiles: [
            { id: 0, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
            { id: 1, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
            { id: 2, suit: "bamboos", rank: 2, faceId: 27, col: 20, row: 0, layer: 0 },
            { id: 3, suit: "bamboos", rank: 2, faceId: 27, col: 30, row: 0, layer: 0 },
          ],
        } as Partial<MahjongState>)
      )
    );
    // The next deal: one matching pair, then two tiles that don't match and
    // no shuffles left, so clearing the pair deadlocks the board.
    const nearDeadlock = makeWinState({
      isComplete: false,
      pairsRemoved: 70,
      shufflesLeft: 0,
      startedAt: null,
      accumulatedMs: 0,
      tiles: [
        { id: 10, suit: "bamboos", rank: 1, faceId: 26, col: 0, row: 0, layer: 0 },
        { id: 11, suit: "bamboos", rank: 1, faceId: 26, col: 10, row: 0, layer: 0 },
        { id: 12, suit: "bamboos", rank: 2, faceId: 27, col: 20, row: 0, layer: 0 },
        { id: 13, suit: "bamboos", rank: 3, faceId: 28, col: 30, row: 0, layer: 0 },
      ],
    } as Partial<MahjongState>);
    const createGame = jest.spyOn(mahjongEngine, "createGame").mockReturnValue(nearDeadlock);
    const openLevelSelect = async (api: Awaited<ReturnType<typeof mount>>) => {
      await act(async () => {
        await fireEvent.press(api.getByLabelText("More options"));
      });
      await act(async () => {
        await fireEvent.press(api.getByText("Level Select"));
      });
    };
    try {
      const api = await mount();
      await tap(api, 0); // the first board's clock runs
      now += 10_000;
      await openLevelSelect(api); // …and pauses
      await act(async () => {
        await fireEvent.press(api.getByLabelText("Turtle")); // a new deal
      });
      await tap(api, 10);
      now += 30_000;
      await tap(api, 11); // the pair: the board deadlocks, its clock stops at 30 s
      await openLevelSelect(api);
      await act(async () => {
        await fireEvent.press(api.getByLabelText(/continue/i));
      });
      now += 10 * 60_000; // ten more minutes on the deadlocked board
      mockCompleteGame.mockClear();
      await act(async () => {
        mockNavListeners.get("beforeRemove")?.forEach((h) => h()); // leaving records the loss
      });
      expect(lastSummary()).toEqual(
        expect.objectContaining({ outcome: "loss", durationMs: 30_000 })
      );
    } finally {
      createGame.mockRestore();
    }
  });

  // A save from an older build: a raw running startedAt and, in the oldest,
  // no accumulatedMs. When the app was closed is unknown, so the game counts
  // from the load. It must load, not crash or discard the game.
  it("loads an older build's save with a running startedAt, counting from the load", async () => {
    const old = { ...lastPairState(), startedAt: now - 2 * 24 * 60 * 60_000 } as Record<
      string,
      unknown
    >;
    delete old["accumulatedMs"];
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(old));
    const api = await mount();
    now += 4_000;
    await tap(api, 0);
    await tap(api, 1);
    await api.findByTestId("mahjong-result");
    expect(lastSummary()).toEqual(expect.objectContaining({ outcome: "win", durationMs: 4_000 }));
  });
});

// ---------------------------------------------------------------------------
// #2961 — saves only when the board, undo history or banked clock change,
// debounced, and flushed when the player leaves
// ---------------------------------------------------------------------------

describe("MahjongScreen — debounced saves (#2961)", () => {
  /** Five free pairs in a row: (0, 1), (2, 3), … (8, 9), each its own face. */
  function fivePairs(): MahjongState {
    return makeWinState({
      isComplete: false,
      pairsRemoved: 67,
      score: 670,
      accumulatedMs: 0,
      startedAt: null,
      dealId: "TEST",
      currentLayoutId: "turtle",
      tiles: Array.from({ length: 10 }, (_, id) => {
        const rank = Math.floor(id / 2) + 1;
        return { id, suit: "bamboos", rank, faceId: 25 + rank, col: id * 4, row: 0, layer: 0 };
      }),
    } as Partial<MahjongState>);
  }

  // AsyncStorage.setItem is the shared mock's jest.fn (jest.setup.ts): its
  // calls from before the board was loaded are skipped, not cleared.
  const setItem = AsyncStorage.setItem as jest.Mock;
  let callsBefore = 0;
  /** The game saves written since the board was loaded, each parsed. */
  function gameSaves(): MahjongState[] {
    return setItem.mock.calls
      .slice(callsBefore)
      .filter(([key]) => key === "mahjong_game")
      .map(([, value]) => JSON.parse(value as string) as MahjongState);
  }

  /** Loads the board; the load itself writes nothing, and is counted. */
  async function mountOnFivePairs(overrides: Partial<MahjongState> = {}) {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify({ ...fivePairs(), ...overrides }));
    callsBefore = setItem.mock.calls.length;
    const api = await mount();
    jest.useFakeTimers({ doNotFake: ["Date", "nextTick", "queueMicrotask", "setImmediate"] });
    return api;
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  async function tap(api: Awaited<ReturnType<typeof mount>>, id: number) {
    await act(async () => {
      await fireEvent.press(api.getByLabelText(`mock-tile-${id}`));
    });
  }

  async function wait(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }

  it("writes twice over ten taps of selections and matches", async () => {
    const api = await mountOnFivePairs();
    // Select, switch, match, select, match, select, deselect, select, match, select.
    for (const id of [0, 2, 3, 0, 1, 4, 4, 4, 5, 6]) {
      await tap(api, id);
      await wait(200);
    }
    await wait(SAVE_DEBOUNCE_MS);
    const saves = gameSaves();
    // One write for the first two matches (400 ms apart), one for the third.
    expect(saves.length).toBe(2);
    // The last write has all three matches and their undo history.
    const last = saves.at(-1)!;
    expect(last.tiles.map((t) => t.id)).toEqual([6, 7, 8, 9]);
    expect(last.pairsRemoved).toBe(70);
    expect(last.undoStack).toHaveLength(3);
  });

  it("doesn't write for a tap that only selects or deselects a tile", async () => {
    const api = await mountOnFivePairs();
    await tap(api, 0); // also starts the clock
    await tap(api, 0);
    await tap(api, 2);
    await wait(5 * SAVE_DEBOUNCE_MS);
    expect(gameSaves()).toHaveLength(0);
  });

  it("writes a match once the taps settle, not on the tap", async () => {
    const api = await mountOnFivePairs();
    await tap(api, 0);
    await tap(api, 1);
    expect(gameSaves()).toHaveLength(0);
    await wait(SAVE_DEBOUNCE_MS);
    expect(gameSaves()).toHaveLength(1);
    expect(gameSaves()[0]!.tiles).toHaveLength(8);
  });

  it("writes a pending match at once when another screen covers the game", async () => {
    const api = await mountOnFivePairs();
    await tap(api, 0);
    await tap(api, 1);
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    expect(gameSaves()).toHaveLength(1);
    expect(gameSaves()[0]!.tiles).toHaveLength(8);
    expect(gameSaves()[0]!.paused).toBe(true);
    await wait(5 * SAVE_DEBOUNCE_MS); // nothing left to write
    expect(gameSaves()).toHaveLength(1);
  });

  it("writes a pending match on unmount, and nothing once the screen is gone", async () => {
    const api = await mountOnFivePairs();
    await tap(api, 0);
    await tap(api, 1);
    await api.unmount();
    expect(gameSaves()).toHaveLength(1);
    expect(gameSaves()[0]!.tiles).toHaveLength(8);
    // Another game takes the slot; no timer of the gone screen may overwrite it.
    const other = { ...fivePairs(), dealId: "NEXT" };
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(other));
    await wait(5 * SAVE_DEBOUNCE_MS);
    expect(JSON.parse((await AsyncStorage.getItem("mahjong_game"))!).dealId).toBe("NEXT");
  });

  it("costs no write to load a game, under way or not, or to CONTINUE one", async () => {
    const api = await mountOnFivePairs({ accumulatedMs: 60_000 }); // its clock runs from the load
    await wait(5 * SAVE_DEBOUNCE_MS);
    expect(gameSaves()).toHaveLength(0);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("More options"));
    });
    // The ⋯ menu is an app overlay (#2944): it pauses the clock, and a pause is written at
    // once, with the play banked. That is the one write here.
    expect(gameSaves()).toHaveLength(1);
    expect(gameSaves()[0]).toEqual(expect.objectContaining({ paused: true, startedAt: null }));
    await act(async () => {
      await fireEvent.press(api.getByText("New Game"));
    });
    const confirm = api.queryByLabelText("Start New");
    if (confirm) {
      await act(async () => {
        await fireEvent.press(confirm);
      });
    }
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Continue"));
    });
    expect(api.getByLabelText("mock-tile-0")).toBeTruthy();
    await wait(5 * SAVE_DEBOUNCE_MS);
    expect(gameSaves()).toHaveLength(1);
  });

  it("rewrites a saved selection the player cleared, so a relaunch restores none", async () => {
    const api = await mountOnFivePairs();
    await tap(api, 0);
    await tap(api, 1); // a match
    await wait(SAVE_DEBOUNCE_MS - 200);
    await tap(api, 2); // selected while the match's write is pending
    await wait(200);
    expect(gameSaves().at(-1)!.selected).toEqual(expect.objectContaining({ id: 2 }));
    await tap(api, 2); // deselected
    await wait(SAVE_DEBOUNCE_MS);
    expect(gameSaves().at(-1)!.selected).toBeNull();
    await api.unmount();

    const relaunched = await mount();
    await tap(relaunched, 3); // with tile 2 still selected, this would match it
    expect(relaunched.getByLabelText("mock-tile-2")).toBeTruthy();
    expect(relaunched.getByLabelText("mock-tile-3")).toBeTruthy();
  });

  it("writes the pause on leaving, and nothing on the return", async () => {
    const api = await mountOnFivePairs();
    await tap(api, 0);
    await tap(api, 1);
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    expect(gameSaves()).toHaveLength(1);
    await act(async () => {
      mockNavListeners.get("focus")?.forEach((h) => h());
    });
    await wait(5 * SAVE_DEBOUNCE_MS);
    expect(gameSaves()).toHaveLength(1);
  });

  it("drops the hint on an undo or a shuffle, which can renumber its tiles", async () => {
    const api = await mountOnFivePairs();
    const hint = () =>
      act(async () => {
        await fireEvent.press(
          api.getByLabelText("Show a hint — highlights one valid pair for 2 seconds")
        );
      });
    const hinted = () => api.getByTestId("hint-ids-size").props.children;
    await tap(api, 0);
    await tap(api, 1);
    await hint();
    expect(hinted()).toBe(2);
    await act(async () => {
      await fireEvent.press(api.getByLabelText("Undo last matched pair"));
    });
    expect(hinted()).toBe(0);
    await hint();
    expect(hinted()).toBe(2);
    await act(async () => {
      await fireEvent.press(
        api.getByLabelText("Shuffle remaining tiles into a new solvable arrangement")
      );
    });
    expect(hinted()).toBe(0);
    await wait(5 * SAVE_DEBOUNCE_MS); // no stale timer brings it back either
    expect(hinted()).toBe(0);
  });

  it("a tap that changes nothing, with no hint showing, doesn't re-render the board", async () => {
    // Tile 0 is covered by tile 1, so tapping it is no move.
    const tiles = fivePairs().tiles.map((t) => (t.id === 1 ? { ...t, col: 0, layer: 1 } : t));
    const api = await mountOnFivePairs({ tiles } as Partial<MahjongState>);
    const renders = mockCanvasRenders.count;
    await tap(api, 0);
    expect(mockCanvasRenders.count).toBe(renders);
  });

  it("never brings a cleared board's save back", async () => {
    // A board under way: loading it runs the clock, so its write is pending.
    await AsyncStorage.setItem(
      "mahjong_game",
      JSON.stringify({
        ...fivePairs(),
        accumulatedMs: 60_000,
        tiles: fivePairs().tiles.slice(0, 2),
      })
    );
    const api = await mount();
    jest.useFakeTimers({ doNotFake: ["Date", "nextTick", "queueMicrotask", "setImmediate"] });
    await tap(api, 0);
    await tap(api, 1);
    await wait(5 * SAVE_DEBOUNCE_MS);
    expect(api.getByTestId("mahjong-result")).toBeTruthy();
    expect(await AsyncStorage.getItem("mahjong_game")).toBeNull();
  });
});

// A save from a build before #2961 holds its undo history as full board
// snapshots (`_v: 1`). It loads for one release through the legacyUndo shim.
describe("MahjongScreen — a save from before delta undo (#2961)", () => {
  /** Two of four pairs matched: the board before each match kept whole, as that build saved it. */
  function legacySave() {
    const tiles = Array.from({ length: 8 }, (_, id) => {
      const rank = Math.floor(id / 2) + 1;
      return { id, suit: "bamboos", rank, faceId: 25 + rank, col: id * 4, row: 0, layer: 0 };
    });
    const snapshot = (from: number, pairsRemoved: number) => ({
      ...makeWinState({ isComplete: false, accumulatedMs: 0 }),
      _v: 1,
      tiles: tiles.slice(from),
      pairsRemoved,
      score: pairsRemoved * 10,
      undoStack: [],
    });
    return {
      ...snapshot(4, 2),
      accumulatedMs: 30_000,
      undoStack: [snapshot(0, 0), snapshot(2, 1)],
    };
  }

  it("resumes the game and undoes both moves back to the first board", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(legacySave()));
    const api = await mount();
    expect(api.getAllByLabelText(/^mock-tile-/)).toHaveLength(4);
    const undo = () =>
      act(async () => {
        await fireEvent.press(api.getByLabelText("Undo last matched pair"));
      });
    await undo();
    expect(api.getAllByLabelText(/^mock-tile-/).map((t) => t.props.accessibilityLabel)).toEqual([
      "mock-tile-2",
      "mock-tile-3",
      "mock-tile-4",
      "mock-tile-5",
      "mock-tile-6",
      "mock-tile-7",
    ]);
    await undo();
    expect(api.getAllByLabelText(/^mock-tile-/)).toHaveLength(8);
    expect(api.getByLabelText("Undo last matched pair").props.accessibilityState?.disabled).toBe(
      true
    );
  });

  it("is saved as version 2 when opened and left without a move", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(legacySave()));
    const api = await mount();
    await api.unmount();
    const saved = JSON.parse((await AsyncStorage.getItem("mahjong_game"))!);
    expect(saved._v).toBe(2);
    expect(saved.undoStack.map((e: { kind: string }) => e.kind)).toEqual(["match", "match"]);
  });

  it("plays on and saves in the delta format", async () => {
    await AsyncStorage.setItem("mahjong_game", JSON.stringify(legacySave()));
    const api = await mount();
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-4"));
    });
    await act(async () => {
      await fireEvent.press(api.getByLabelText("mock-tile-5"));
    });
    await api.unmount();
    const saved = JSON.parse((await AsyncStorage.getItem("mahjong_game"))!);
    expect(saved._v).toBe(2);
    expect(saved.tiles.map((t: { id: number }) => t.id)).toEqual([6, 7]);
    expect(saved.undoStack.map((e: { kind: string }) => e.kind)).toEqual([
      "match",
      "match",
      "match",
    ]);
  });
});
