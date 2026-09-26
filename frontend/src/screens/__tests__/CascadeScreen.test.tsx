/**
 * Tests for CascadeGame tap/cooldown/restart logic.
 *
 * CascadeEngine is mocked out entirely. We focus on the state and ref logic:
 *   - score starts at 0
 *   - handleTap cooldown blocks double-drops within 200ms
 *   - handleTap is blocked when game is over
 *   - handleRestart resets score and recreates the engine
 */

import React from "react";
import { act, create } from "react-test-renderer";
import CascadeScreen from "../CascadeScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { resetDisplayNameCacheForTests, saveDisplayName } from "../../game/_shared/displayName";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();
// Captured so tests can fire "blur"/"focus" (a pushed Stats/Leaderboard/
// Scoreboard screen, #2735).
const mockNavListeners = new Map<string, Array<() => void>>();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: mockPopToTop,
    goBack: jest.fn(),
    navigate: mockNavigate,
    addListener: jest.fn((event: string, handler: () => void) => {
      mockNavListeners.set(event, [...(mockNavListeners.get(event) ?? []), handler]);
      return () => {
        mockNavListeners.set(
          event,
          (mockNavListeners.get(event) ?? []).filter((h) => h !== handler)
        );
      };
    }),
  }),
}));

// The result card reads the synced game's rank (#2632, sessionBoardAdapter).
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

jest.mock("../../components/cascade/FruitGlyph", () => "FruitGlyph");
jest.mock("../../components/cascade/NextFruitPreview", () => "NextFruitPreview");
// Captures the fruit-set setter so tests can switch sets like the selector does.
let mockSetFruitSetById: ((id: string) => void) | null = null;
jest.mock("../../components/cascade/ThemeSelector", () => {
  const { useFruitSet } = jest.requireActual("../../theme/FruitSetContext");
  return function MockThemeSelector() {
    mockSetFruitSetById = useFruitSet().setFruitSetById;
    return null;
  };
});

// Skia requires a native module — mock the whole package in Jest.
// useImage returns a non-null stub so useFruitImages resolves immediately
// and useAssetsReady returns true, allowing CascadeGame to render.
// Canvas/Group/Image/Circle/Line are stubbed as no-ops for PieceRenderer.
jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    useImage: jest.fn().mockReturnValue({ width: 1, height: 1 }),
    Canvas: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, {}, children),
    Group: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, {}, children),
    Image: () => null,
    Circle: () => null,
    Line: () => null,
  };
});

// ---------------------------------------------------------------------------
// Mock gameEventClient — record every call for #371 instrumentation tests
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Mock CascadeEngine — lets tests inject events and inspect drop calls
// ---------------------------------------------------------------------------

type MockEngineEvent =
  | { type: "merge"; result: number; x: number; y: number }
  | { type: "score"; delta: number; total: number }
  | { type: "gameOver" }
  | { type: "guardRailFired"; reason: string; bodyId: number };

let pendingEngineEvents: MockEngineEvent[] = [];
let mockEngineScore = 0;

const mockEngineDrop = jest.fn();
const mockEngineDestroy = jest.fn();
const mockEngineStep = jest.fn().mockImplementation(() => {
  const events = [...pendingEngineEvents];
  pendingEngineEvents = [];
  return { events };
});
const mockEngineGetState = jest.fn().mockImplementation(() => ({
  pieces: [],
  score: mockEngineScore,
  gameOver: false,
}));

let mockEngineInstanceCount = 0;
jest.mock("../../game/cascade/engine2", () => ({
  CascadeEngine: jest.fn().mockImplementation(() => {
    mockEngineInstanceCount++;
    return {
      start: jest.fn(),
      step: mockEngineStep,
      drop: mockEngineDrop,
      getState: mockEngineGetState,
      destroy: mockEngineDestroy,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Mock requestAnimationFrame so tests can drive the RAF loop
// ---------------------------------------------------------------------------

let rafCallbacks: FrameRequestCallback[] = [];

beforeEach(() => {
  rafCallbacks = [];
  jest.spyOn(global, "requestAnimationFrame").mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  jest.spyOn(global, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Flush all pending RAF callbacks (drives one physics tick). */
function advanceOneFrame() {
  const cbs = rafCallbacks.splice(0);
  cbs.forEach((cb) => cb(performance.now()));
}

/** Inject an engine merge event and drive one tick. */
async function injectMerge(tier: number, x: number, y: number) {
  pendingEngineEvents.push({ type: "merge", result: tier, x, y });
  await act(() => {
    advanceOneFrame();
  });
}

/** Inject an engine gameOver event and drive one tick. */
async function injectGameOver() {
  pendingEngineEvents.push({ type: "gameOver" });
  await act(() => {
    advanceOneFrame();
  });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  mockNavListeners.clear();
  pendingEngineEvents = [];
  mockEngineScore = 0;
  mockEngineInstanceCount = 0;
  mockEngineDrop.mockClear();
  mockEngineDestroy.mockClear();
  mockEngineStep.mockClear();
  mockEngineGetState.mockClear();
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-uuid-test");
  mockEnqueueEvent.mockReset();
  mockCompleteGame.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderScreen() {
  let renderer!: ReturnType<typeof create>;
  await act(() => {
    renderer = create(<CascadeScreen />);
  });

  // Trigger onLayout so scale > 0 and the game area renders
  // containerWidth=300, containerHeight=600 → scale=min(300/400,600/600)=0.75
  await act(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outer = renderer.root.findAll((node: any) => node.props.onLayout !== undefined)[0];
    outer?.props.onLayout({
      nativeEvent: { layout: { width: 300, height: 600 } },
    });
  });

  // Advance one RAF frame so the engine effect fires and engineRef is set
  await act(() => {
    advanceOneFrame();
  });

  return renderer;
}

/** Find the tappable game area Pressable. */
function findGameArea(renderer: ReturnType<typeof create>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderer.root.findAll((node: any) => node.props.testID === "cascade-game-area")[0];
}

/**
 * Simulate a tap on the game area at the given world x-coordinate.
 * scale = 0.75 with the mock layout (width=300, height=600).
 */
async function triggerTap(renderer: ReturnType<typeof create>, worldX = 150) {
  const area = findGameArea(renderer);
  await act(() => {
    area?.props.onPress({ nativeEvent: { locationX: worldX * 0.75 } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CascadeGame", () => {
  it("score starts at 0", async () => {
    const renderer = await renderScreen();
    expect(JSON.stringify(renderer.toJSON())).toContain('"0"');
  });

  it("handleTap calls engine.drop once", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer);
    expect(mockEngineDrop).toHaveBeenCalledTimes(1);
  });

  it("second tap within 200ms cooldown is ignored", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer);
    await triggerTap(renderer); // immediate second tap
    expect(mockEngineDrop).toHaveBeenCalledTimes(1);
  });

  it("tap succeeds again after the 200ms cooldown expires", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer);
    await act(() => {
      jest.advanceTimersByTime(201);
    });
    await triggerTap(renderer);
    expect(mockEngineDrop).toHaveBeenCalledTimes(2);
  });

  it("tap after game over is ignored", async () => {
    const renderer = await renderScreen();
    await injectGameOver();
    await triggerTap(renderer);
    expect(mockEngineDrop).not.toHaveBeenCalled();
  });

  it("handleRestart resets score and recreates the engine", async () => {
    const renderer = await renderScreen();
    const instancesBefore = mockEngineInstanceCount;

    // Inject merge + game over to put the screen in a post-game state
    await injectMerge(2, 150, 300);
    await injectGameOver();

    const overlay = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) => typeof node.props.onPlayAgain === "function"
    )[0];
    await act(() => {
      overlay?.props.onPlayAgain();
    });
    // Advance frame so the new engine's RAF loop fires
    await act(() => {
      advanceOneFrame();
    });

    // A new engine was created on restart
    expect(mockEngineInstanceCount).toBeGreaterThan(instancesBefore);
    // Score resets to 0
    expect(JSON.stringify(renderer.toJSON())).toContain('"0"');
  });
});

// ---------------------------------------------------------------------------
// #371 — gameEventClient instrumentation
// ---------------------------------------------------------------------------

const RESERVED_KEYS = ["game_id", "event_index", "event_type"];

describe("CascadeScreen — gameEventClient instrumentation (#371)", () => {
  it("calls startGame('cascade') with fruit_set/theme on mount", async () => {
    await renderScreen();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    const startCall = mockStartGame.mock.calls[0];
    if (startCall === undefined) throw new Error("Expected startGame call");
    const [gameType, meta, eventData] = startCall;
    expect(gameType).toBe("cascade");
    expect(meta).toEqual({});
    expect(eventData).toEqual(
      expect.objectContaining({
        fruit_set: expect.any(String),
        theme: expect.any(String),
        seed: null,
      })
    );
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }
  });

  it("emits a 'drop' event with expected payload shape on each tap", async () => {
    const renderer = await renderScreen();
    mockEnqueueEvent.mockClear();
    await triggerTap(renderer, 123);
    const dropCall = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "drop");
    expect(dropCall).toBeDefined();
    const [gameId, event] = dropCall!;
    expect(gameId).toBe("game-uuid-test");
    expect(event.data).toEqual(
      expect.objectContaining({
        drop_index: 1,
        fruit_tier: expect.any(Number),
        x: 123,
        score_before: 0,
      })
    );
    for (const key of RESERVED_KEYS) {
      expect(event.data).not.toHaveProperty(key);
    }
  });

  it("emits a 'merge' event with from_tier/to_tier and x/y", async () => {
    const _renderer = await renderScreen();
    // Make sure game area is rendered (it is after renderScreen)
    mockEnqueueEvent.mockClear();
    await injectMerge(4, 200, 300);
    const mergeCall = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "merge");
    expect(mergeCall).toBeDefined();
    expect(mergeCall![1].data).toEqual(
      expect.objectContaining({
        from_tier: 3,
        to_tier: 4,
        x: 200,
        y: 300,
        score_after: expect.any(Number),
      })
    );
    for (const key of RESERVED_KEYS) {
      expect(mergeCall![1].data).not.toHaveProperty(key);
    }
  });

  it("capture ordering: drops emit in tap order", async () => {
    const renderer = await renderScreen();
    mockEnqueueEvent.mockClear();
    await triggerTap(renderer, 50);
    await act(() => {
      jest.advanceTimersByTime(201);
    });
    await triggerTap(renderer, 250);
    const drops = mockEnqueueEvent.mock.calls.map((c) => c[1]).filter((e) => e?.type === "drop");
    expect(drops.length).toBe(2);
    expect(drops[0]?.data.drop_index).toBe(1);
    expect(drops[1]?.data.drop_index).toBe(2);
    expect(drops[0]?.data.x).toBe(50);
    expect(drops[1]?.data.x).toBe(250);
  });

  it("fires completeGame with snake_case payload on handleGameOver", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    await act(() => {
      jest.advanceTimersByTime(201);
    });
    await injectMerge(3, 100, 200);
    mockCompleteGame.mockClear();
    await injectGameOver();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const completeCall = mockCompleteGame.mock.calls[0];
    if (completeCall === undefined) throw new Error("Expected completeGame call");
    const [, summary, eventData] = completeCall;
    expect(summary.outcome).toBe("completed");
    expect(eventData).toEqual(
      expect.objectContaining({
        final_score: expect.any(Number),
        duration_ms: expect.any(Number),
        theme: expect.any(String),
        total_drops: 1,
        total_merges: 1,
        outcome: "completed",
      })
    );
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }
  });

  it("does not emit drop or merge events after game_over", async () => {
    const renderer = await renderScreen();
    await injectGameOver();
    mockEnqueueEvent.mockClear();

    // Tap is blocked by gameOver state
    await triggerTap(renderer, 100);
    // Merge event from engine (engine would be in gameOver, but mock still emits)
    await injectMerge(2, 50, 50);

    const postDrops = mockEnqueueEvent.mock.calls.filter((c) => c[1]?.type === "drop");
    const postMerges = mockEnqueueEvent.mock.calls.filter((c) => c[1]?.type === "merge");
    expect(postDrops).toHaveLength(0);
    expect(postMerges).toHaveLength(0);
  });

  it("does not double-fire game_ended when handleGameOver runs after completion", async () => {
    const _renderer = await renderScreen();
    await injectGameOver();
    mockCompleteGame.mockClear();
    await injectGameOver(); // second game-over event
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("Restart abandons/completes the old session and starts a new one", async () => {
    const renderer = await renderScreen();
    await injectMerge(2, 150, 300);
    await injectGameOver();
    mockStartGame.mockClear();
    mockStartGame.mockReturnValue("game-uuid-test-2");
    mockCompleteGame.mockClear();
    const overlay = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) => typeof node.props.onPlayAgain === "function"
    )[0];
    await act(() => {
      overlay?.props.onPlayAgain();
    });
    await act(() => {
      advanceOneFrame();
    });
    // The previous session already completed on handleGameOver, so restart
    // should NOT re-fire completeGame for it.
    expect(mockCompleteGame).not.toHaveBeenCalled();
    // But a fresh session must be opened.
    expect(mockStartGame).toHaveBeenCalledWith(
      "cascade",
      {},
      expect.objectContaining({ fruit_set: expect.any(String) })
    );
  });

  it("fires abandoned on unmount mid-game", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    mockCompleteGame.mockClear();
    await act(() => {
      renderer.unmount();
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
  });

  // #2469 item 3 / #2619 — the registered progress snapshot.
  it("an unmount abandon carries the progress snapshot result and no score", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    await act(() => {
      jest.advanceTimersByTime(201);
    });
    await injectMerge(3, 100, 200);
    mockCompleteGame.mockClear();
    await act(() => {
      renderer.unmount();
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary, eventData] = mockCompleteGame.mock.calls[0]!;
    expect(summary.outcome).toBe("abandoned");
    expect(summary).not.toHaveProperty("finalScore");
    // #2619 review: same keys as a completed row's result, minus `outcome`.
    expect(summary.result).toEqual({
      final_score: expect.any(Number),
      duration_ms: expect.any(Number),
      theme: "fruits",
      total_drops: 1,
      total_merges: 1,
    });
    expect(eventData).toEqual({ ...summary.result, outcome: "abandoned" });
  });

  // #2735: ⋯ → Stats/Leaderboard/Scoreboard covers the board; the loop and
  // the reported duration must not advance meanwhile.
  it("stops the loop and the play clock while another screen covers the board", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    mockCompleteGame.mockClear();
    mockEngineStep.mockClear();

    await act(() => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    await act(() => {
      jest.advanceTimersByTime(10 * 60_000); // ten minutes on the Stats screen
    });
    // A frame already queued before the blur may still be flushed, but it
    // no-ops instead of stepping the engine or rescheduling itself.
    await act(() => {
      advanceOneFrame();
    });
    expect(mockEngineStep).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(0);

    await act(() => {
      mockNavListeners.get("focus")?.forEach((h) => h());
    });
    await act(() => {
      jest.advanceTimersByTime(5_000); // five more seconds of play
    });
    await act(() => {
      renderer.unmount();
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.result.duration_ms).toBeLessThan(10_000);
  });

  it("a mid-game New Game abandon keeps theme and final_score, but no outcome, in its result", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    await act(() => {
      jest.advanceTimersByTime(201);
    });
    mockCompleteGame.mockClear();
    const shell = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) => typeof node.props.onNewGame === "function"
    )[0];
    await act(() => {
      shell?.props.onNewGame();
    });

    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const [, summary, eventData] = mockCompleteGame.mock.calls[0]!;
    expect(summary.outcome).toBe("abandoned");
    expect(summary.result).toEqual({
      final_score: expect.any(Number),
      duration_ms: expect.any(Number),
      theme: "fruits",
      total_drops: 1,
      total_merges: 0,
    });
    expect(summary.result).not.toHaveProperty("outcome");
    expect(summary.durationMs).toBe(summary.result.duration_ms);
    expect(eventData).toEqual({ ...summary.result, outcome: "abandoned" });
  });

  it("game over still sends the full result block (#2619: explicit, unchanged)", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    mockCompleteGame.mockClear();
    await injectGameOver();

    const [, summary, eventData] = mockCompleteGame.mock.calls[0]!;
    expect(summary.result).toEqual(eventData);
    expect(summary.result).toEqual(
      expect.objectContaining({ total_drops: 1, outcome: "completed" })
    );
  });

  it("client failures do not block gameplay (enqueueEvent throws)", async () => {
    const renderer = await renderScreen();
    mockEnqueueEvent.mockImplementation(() => {
      throw new Error("boom");
    });
    await triggerTap(renderer, 150);
    // engine.drop still called despite the throw
    expect(mockEngineDrop).toHaveBeenCalled();
    mockEnqueueEvent.mockReset();
  });
});

// ---------------------------------------------------------------------------
// #2515 — shared result card
// ---------------------------------------------------------------------------

describe("CascadeScreen — result card (#2515)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetDisplayNameCacheForTests();
    mockPopToTop.mockClear();
    mockGetGameRank.mockReset();
    mockGetGameRank.mockResolvedValue({ ranked: true, rank: 2, is_best: true, reason: null });
  });

  /** Let AsyncStorage reads/writes and the submit chain settle under fake timers. */
  async function settle() {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await jest.runOnlyPendingTimersAsync();
      });
    }
  }

  function findCard(renderer: ReturnType<typeof create>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return renderer.root.findAll((node: any) => node.props.testID === "cascade-result")[0];
  }

  async function playToGameOver(finalScore: number) {
    const renderer = await renderScreen();
    await settle();
    mockEngineScore = finalScore;
    await injectMerge(2, 150, 300);
    await injectGameOver();
    await settle();
    return renderer;
  }

  it("shows the Game Over card with the score, best and merges", async () => {
    const renderer = await playToGameOver(1234);
    const card = findCard(renderer);
    expect(card?.props.visible).toBe(true);
    expect(card?.props.outcome).toBe("ended");
    expect(card?.props.hero).toEqual({ kind: "score", label: "Score", value: 1234 });
    expect(card?.props.stats).toEqual([
      { label: "Best", value: 1234 },
      { label: "Merges", value: 1 },
    ]);
    // A first game is not a "new best".
    expect(card?.props.isNewBest).toBe(false);
  });

  it("persists the best score and marks a beaten one as New Best", async () => {
    await AsyncStorage.setItem("cascade_best_score", "1000");
    const renderer = await playToGameOver(1234);
    const card = findCard(renderer);
    expect(card?.props.isNewBest).toBe(true);
    expect(card?.props.stats[0]).toEqual({ label: "Best", value: 1234 });
    await expect(AsyncStorage.getItem("cascade_best_score")).resolves.toBe("1234");
  });

  it("keeps the stored best when the game scores lower", async () => {
    await AsyncStorage.setItem("cascade_best_score", "5000");
    const renderer = await playToGameOver(1234);
    const card = findCard(renderer);
    expect(card?.props.isNewBest).toBe(false);
    expect(card?.props.stats[0]).toEqual({ label: "Best", value: 5000 });
    await expect(AsyncStorage.getItem("cascade_best_score")).resolves.toBe("5000");
  });

  // #2632: the card reads the synced game's rank instead of PATCH /cascade/score/{id}.
  it("shows the synced game's rank under the display name automatically", async () => {
    await saveDisplayName("Riley");
    const renderer = await playToGameOver(1234);
    expect(mockGetGameRank).toHaveBeenCalledWith("game-uuid-test");
    expect(findCard(renderer)?.props.submission).toEqual(
      expect.objectContaining({ status: "saved", rank: 2, playerName: "Riley" })
    );
  });

  it("links the card to Cascade's board (#2633)", async () => {
    const renderer = await playToGameOver(1234);
    mockNavigate.mockClear();
    await act(async () => findCard(renderer)?.props.onViewLeaderboard());
    expect(mockNavigate).toHaveBeenCalledWith("Leaderboard", { gameType: "cascade" });
  });

  it("asks for a name when none is set", async () => {
    const renderer = await playToGameOver(1234);
    expect(mockGetGameRank).not.toHaveBeenCalled();
    expect(findCard(renderer)?.props.submission.status).toBe("needsName");
  });

  it("Home returns to the lobby", async () => {
    const renderer = await playToGameOver(1234);
    await act(() => {
      findCard(renderer)?.props.onHome();
    });
    expect(mockPopToTop).toHaveBeenCalled();
  });

  it("Play Again clears the card and the submission", async () => {
    await saveDisplayName("Riley");
    const renderer = await playToGameOver(1234);
    await act(() => {
      findCard(renderer)?.props.onPlayAgain();
    });
    await settle();
    const card = findCard(renderer);
    expect(card?.props.visible).toBe(false);
    expect(card?.props.submission.status).toBe("idle");
  });

  it("a fruit-set switch after game over lets the next game submit again", async () => {
    await saveDisplayName("Riley");
    await playToGameOver(1234);
    expect(mockGetGameRank).toHaveBeenCalledTimes(1);

    await act(() => {
      mockSetFruitSetById?.("cosmos");
    });
    await settle();
    await act(() => {
      advanceOneFrame();
    });
    mockEngineScore = 50;
    await injectGameOver();
    await settle();

    expect(mockGetGameRank).toHaveBeenCalledTimes(2);
  });

  it("shows a save error, with no retry, when the game has no sync id", async () => {
    await saveDisplayName("Riley");
    mockStartGame.mockReturnValue(null as unknown as string);
    const renderer = await playToGameOver(1234);
    expect(mockGetGameRank).not.toHaveBeenCalled();
    const submission = findCard(renderer)?.props.submission;
    expect(submission.status).toBe("error");
    expect(submission.onRetry).toBeUndefined();
  });
});

describe("CascadeScreen — ⋯ menu (#2635)", () => {
  it("passes a Stats item that opens Cascade's stats", async () => {
    const renderer = await renderScreen();
    const shell = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) => typeof node.props.onOpenStats === "function"
    )[0];
    mockNavigate.mockClear();
    await act(() => {
      shell?.props.onOpenStats();
    });
    expect(mockNavigate).toHaveBeenCalledWith("GameStats", { gameType: "cascade" });
  });

  it("has no Scorecard item: Stats replaced the old Scoreboard (#2636)", async () => {
    const renderer = await renderScreen();
    const more = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) =>
        node.props.accessibilityLabel === "More options" && typeof node.props.onPress === "function"
    )[0];
    await act(() => {
      more?.props.onPress();
    });
    expect(renderer.root.findAllByProps({ testID: "nav-menu-stats" }).length).toBeGreaterThan(0);
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/Scoreboard|Scorecard/);
  });
});
