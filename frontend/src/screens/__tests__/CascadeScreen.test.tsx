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
import { CascadeScoreboardProvider } from "../../game/cascade/CascadeScoreboardContext";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
  }),
}));

jest.mock("../../components/cascade/FruitGlyph", () => "FruitGlyph");
jest.mock("../../components/cascade/NextFruitPreview", () => "NextFruitPreview");
jest.mock("../../components/cascade/ThemeSelector", () => "ThemeSelector");

// Skia requires a native module — mock the whole package in Jest.
// useImage returns a non-null stub so useFruitImages resolves immediately
// and useAssetsReady returns true, allowing CascadeGame to render.
jest.mock("@shopify/react-native-skia", () => ({
  useImage: jest.fn().mockReturnValue({ width: 1, height: 1 }),
}));

// react-native-svg: stub SVG components so they render as no-ops in JSDOM
jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const SvgMock = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, {}, children);
  const Noop = () => null;
  return {
    __esModule: true,
    default: SvgMock,
    Circle: Noop,
    Line: Noop,
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
    renderer = create(
      <CascadeScoreboardProvider>
        <CascadeScreen />
      </CascadeScoreboardProvider>
    );
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
      (node: any) => typeof node.props.onRestart === "function"
    )[0];
    await act(() => {
      overlay?.props.onRestart();
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
      (node: any) => typeof node.props.onRestart === "function"
    )[0];
    await act(() => {
      overlay?.props.onRestart();
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
