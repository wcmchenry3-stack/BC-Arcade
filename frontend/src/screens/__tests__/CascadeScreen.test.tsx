/**
 * Tests for CascadeGame tap/cooldown/restart logic.
 *
 * CascadeEngine is mocked out entirely. We focus on the state and ref logic:
 *   - score starts at 0
 *   - handleTap cooldown blocks double-drops within 200ms
 *   - handleTap is blocked when game is over
 *   - handleRestart resets score and recreates the engine
 */

import { detectedGesture, type DetectorRender } from "../../test-utils/mockScreenDeps";
import React from "react";
import { act, create } from "react-test-renderer";
import CascadeScreen from "../CascadeScreen";
import { Modal } from "react-native";
import CascadeCelebration from "../../components/cascade/CascadeCelebration";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import {
  CELEBRATION_CARD_MS,
  CELEBRATION_CARD_MS_REDUCED,
  MAX_FRAME_STEP_MS,
} from "../../game/cascade/celebration";
import { formatMs } from "../../game/_shared/formatMs";
import * as pen from "../../game/cascade/art/pen";
import { __resetArtCachesForTests } from "../../game/cascade/art/sprites";
import * as celebrationStyles from "../../game/cascade/render/celebrationStyle";
import { __resetCelebrationStylesForTests } from "../../game/cascade/render/celebrationStyle";
import * as celebrationHook from "../../components/cascade/useCelebrationStyle";
import { CELEBRATION_MAX_MS } from "../../components/shared/GameResultModal";
import { HEADER_FIELD } from "../../game/cascade/render/frame";
import { CASCADE_TUNING_ID, GROW_IN_STEPS } from "../../game/cascade/constants";
import { APP_VERSION } from "../../config/appVersion";
import { CAPSTONE_TIER } from "../../game/cascade/tiers";
import { timeBonus } from "../../game/cascade/timeBonus";
import i18n from "i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getBest, storageKey } from "../../game/_shared/personalBest";
import { AccessibilityInfo, AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import {
  resetDisplayNameCacheForTests,
  storeAssignedDisplayName,
} from "../../game/_shared/displayName";

const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();
// Captured so tests can fire "blur"/"focus" (a pushed Stats/Leaderboard/
// Scoreboard screen, #2735).
const mockNavListeners = new Map<string, Array<() => void>>();
const mockSetOptions = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: mockPopToTop,
    goBack: jest.fn(),
    navigate: mockNavigate,
    setOptions: (o: unknown) => mockSetOptions(o),
    addListener: jest.fn((event: string, handler: () => void) => {
      mockNavListeners.set(event, [...(mockNavListeners.get(event) ?? []), handler]);
      return () => {
        mockNavListeners.set(
          event,
          (mockNavListeners.get(event) ?? []).filter((h) => h !== handler)
        );
      };
    }),
  }))
);

// The result card reads the synced game's rank (#2632, lookupGameRank).
const mockGetGameRank = jest.fn();
jest.mock("../../api/stats", () =>
  mockScreenDeps().mockStatsApi({ getGameRank: (gameId: string) => mockGetGameRank(gameId) })
);
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn(() => Promise.resolve({ display_name: "Brave Otter 4821" })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
// #3928: the board's press-drag-release gesture, recorded so a test can fire it.
const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

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

// The Skia API (`Skia.*`): none, unless a test installs a fake (#3699: the capstone's raster).
let mockSkiaApi: unknown = undefined;
// Skia requires a native module — mock the whole package in Jest.
// Canvas/Group/Picture are stubbed as no-ops for CascadeBoard.
jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    useImage: jest.fn().mockReturnValue({ width: 1, height: 1 }),
    // Forwards accessibilityLabel (#2222) so the board label is observable.
    Canvas: ({
      children,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      accessibilityLabel?: string;
    }) => React.createElement("View", { accessibilityLabel }, children),
    Group: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, {}, children),
    Image: () => null,
    Circle: () => null,
    Line: () => null,
    // The board's Picture (#2960).
    Picture: () => null,
    createPicture: jest.fn(() => null),
    // The lid's drawing (#3694).
    Path: () => null,
    DashPathEffect: () => null,
    BlurMask: () => null,
    get Skia() {
      return mockSkiaApi;
    },
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
// The replay recorder's saves (#3858): one call per unit (or per idle save).
type EnqueueManyArgs = [string, { type: string; data: Record<string, unknown> }[]];
const mockEnqueueEvents = jest.fn() as unknown as jest.Mock<undefined, EnqueueManyArgs>;
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: lazy(() => mockStartGame),
    enqueueEvent: lazy(() => mockEnqueueEvent),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
  });
});

// ---------------------------------------------------------------------------
// Mock CascadeEngine — lets tests inject events and inspect drop calls
// ---------------------------------------------------------------------------

type MockEngineEvent =
  | { type: "merge"; result: number; x: number; y: number; tierA: number; step: number }
  | { type: "score"; delta: number; total: number }
  | { type: "gameOver" }
  | { type: "win"; x: number; y: number; id: number }
  | { type: "guardRailFired"; reason: string; bodyId: number };

let pendingEngineEvents: MockEngineEvent[] = [];
let mockEngineScore = 0;

const mockEngineDrop = jest.fn();
const mockEngineDestroy = jest.fn();
const mockEngineRestore = jest.fn();
// The lid's drop gate (#3694): open unless a test closes it.
const mockEngineCanDrop = jest.fn(() => true);
// #3904: the win ends play; a test sets it when it injects the win event.
const mockEngineHasWon = jest.fn(() => false);
const mockEngineStep = jest.fn().mockImplementation(() => {
  const events = [...pendingEngineEvents];
  pendingEngineEvents = [];
  return { events };
});
// The board the mock engine reports (#3920: the win tail reads the capstone's grow-in scale).
let mockEnginePieces: {
  id: number;
  tier: number;
  x: number;
  y: number;
  angle: number;
  scale?: number;
}[] = [];
const mockEngineGetState = jest.fn().mockImplementation(() => ({
  pieces: mockEnginePieces,
  score: mockEngineScore,
  gameOver: false,
}));

let mockEngineInstanceCount = 0;
jest.mock("../../game/cascade/engine", () => ({
  ENGINE_VERSION: 1, // #3858: game_started records it
  CascadeEngine: jest.fn().mockImplementation(() => {
    mockEngineInstanceCount++;
    return {
      start: jest.fn(),
      step: mockEngineStep,
      drop: mockEngineDrop,
      getState: mockEngineGetState,
      destroy: mockEngineDestroy,
      restore: mockEngineRestore,
      canDrop: mockEngineCanDrop,
      hasWon: mockEngineHasWon,
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

/** Inject an engine merge event (in fixed step 7) and drive one tick. */
async function injectMerge(tier: number, x: number, y: number) {
  pendingEngineEvents.push({ type: "merge", result: tier, x, y, tierA: tier - 1, step: 7 });
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
  mockEngineRestore.mockClear();
  mockEngineStep.mockClear();
  mockEngineGetState.mockClear();
  mockStartGame.mockReset();
  mockStartGame.mockReturnValue("game-uuid-test");
  mockEnqueueEvent.mockReset();
  mockEnqueueEvents.mockReset();
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

/** Find the board's touch area (`CascadeAimArea`). */
function findGameArea(renderer: ReturnType<typeof create>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderer.root.findAll((node: any) => node.props.testID === "cascade-game-area")[0];
}

/**
 * Simulate a tap on the game area at the given world x-coordinate: the board gesture's press and
 * release (#3928: a quick tap drops at once). scale = 0.75 with the mock layout (300 x 600).
 */
async function triggerTap(_renderer: ReturnType<typeof create>, worldX = 150) {
  const pan = detectedGesture(mockDetected, "pan", { testID: "cascade-game-area" });
  await act(() => {
    // RNGH's order for a still tap (manual activation on touch down, #3928 review B1).
    pan?.onBegin?.({ x: worldX * 0.75, y: 100 });
    pan?.onTouchesDown?.({ numberOfTouches: 1 }, { activate: () => {}, fail: () => {} });
    pan?.onEnd?.({ x: worldX * 0.75, y: 100 }, true);
    pan?.onFinalize?.({ x: worldX * 0.75, y: 100 }, true);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CascadeGame board label (#2222)", () => {
  const labels = (renderer: ReturnType<typeof create>) =>
    renderer.root
      .findAll((n) => Boolean(n.props.accessibilityLabel))
      .map((n) => n.props.accessibilityLabel as string);

  it("is the English label by default", async () => {
    const renderer = await renderScreen();
    expect(labels(renderer)).toContain("Cascade game board");
  });

  it("comes from the active language", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    i18n.addResourceBundle("es", "cascade", require("../../i18n/locales/es/cascade.json"));
    await i18n.changeLanguage("es");
    try {
      const renderer = await renderScreen();
      expect(labels(renderer)).toContain("Tablero de Cascade");
      expect(labels(renderer)).not.toContain("Cascade game board");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("CascadeGame", () => {
  it("score starts at 0", async () => {
    const renderer = await renderScreen();
    expect(JSON.stringify(renderer.toJSON())).toContain('"0"');
  });

  it("the tappable board is the bin: exactly the world rect, bottom-anchored in the area (#3698)", async () => {
    const renderer = await renderScreen();
    // 300 x 600 area: scale 0.75 -> a 300 x 450 board, the 150 spare px above the bin.
    const style = findGameArea(renderer)?.props.style;
    expect(style).toEqual({ position: "absolute", left: 0, top: 150, width: 300, height: 450 });
  });

  it("handleTap calls engine.drop once", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer);
    expect(mockEngineDrop).toHaveBeenCalledTimes(1);
  });

  // #3928: the gesture reports x on every platform; a press elsewhere drops at that x.
  it("a press drops at its own x", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 90);
    expect(mockEngineDrop).toHaveBeenCalledTimes(1);
    expect(mockEngineDrop.mock.calls[0]?.[1]).toBeCloseTo(90);
  });

  // #3928 review S3: a screen reader's double-tap ("activate") drops in the middle.
  it("the board's accessibility action drops the next piece in the middle", async () => {
    const renderer = await renderScreen();
    const board = renderer.root.findAll(
      (n) =>
        Array.isArray(n.props.accessibilityActions) &&
        n.props.accessibilityLabel === "Cascade game board"
    )[0]!;
    expect(board.props.accessibilityActions).toEqual([{ name: "activate", label: "Drop piece" }]);
    expect(board.props.accessibilityHint).toMatch(/Double-tap/);
    await act(() => {
      board.props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } });
    });
    expect(mockEngineDrop).toHaveBeenCalledTimes(1);
    expect(mockEngineDrop.mock.calls[0]?.[1]).toBe(200);
  });

  // #3928 review B2: no swipe-back over the board (a left drag aims), restored on leaving.
  it("turns the stack's swipe-back off while the game is open", async () => {
    mockSetOptions.mockClear();
    await renderScreen();
    expect(mockSetOptions).toHaveBeenCalledWith({ gestureEnabled: false });
  });

  // #3928 review B2 backstop: a gesture that ends as another screen covers the board drops nothing.
  it("drops nothing while another screen covers the board", async () => {
    const renderer = await renderScreen();
    await act(() => {
      for (const h of mockNavListeners.get("blur") ?? []) h();
    });
    await triggerTap(renderer, 120);
    expect(mockEngineDrop).not.toHaveBeenCalled();
  });

  // #3922: a non-finite x never becomes a drop.
  it("a press with no usable x drops nothing", async () => {
    await renderScreen();
    const pan = detectedGesture(mockDetected, "pan", { testID: "cascade-game-area" });
    await act(() => {
      pan?.onBegin?.({ x: Number.NaN, y: 100 });
      pan?.onEnd?.({ x: Number.NaN, y: 100 }, true);
      pan?.onFinalize?.({}, true);
    });
    expect(mockEngineDrop).not.toHaveBeenCalled();
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
    // #3858: the game's seeds, physics tuning and engine version, for replays.
    expect(eventData).toEqual({
      fruit_set: expect.any(String),
      theme: expect.any(String),
      seed: expect.any(Number),
      engine_seed: expect.any(Number),
      tuning: CASCADE_TUNING_ID,
      engine_version: 1,
      app_version: APP_VERSION,
    });
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }
  });

  /** The replay events the recorder saved for the game (#3858), in order. */
  const saved = () => mockEnqueueEvents.mock.calls.flatMap(([, events]) => events);

  it("records each drop in memory and saves it with its unit, at a tenth of a pixel (#3858)", async () => {
    const renderer = await renderScreen();
    mockEnqueueEvent.mockClear();
    await triggerTap(renderer, 123.456);
    // Nothing is queued per drop, and the engine drops at the recorded x.
    expect(mockEnqueueEvent.mock.calls.some((c) => c[1]?.type === "drop")).toBe(false);
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    expect(mockEngineDrop).toHaveBeenLastCalledWith(expect.any(Number), 123.5);
    const tier = mockEngineDrop.mock.calls.at(-1)![0] as number;
    await injectGameOver();
    // The unit goes out before game_ended: step (the stand-in engine reports none: 0), x in tenths, tier.
    const drop = saved().find((e) => e.type === "drop");
    expect(drop?.data).toEqual({ d: [[0, 1235, tier]], v: 1, unit: 1, t_ms: expect.any(Number) });
    for (const key of RESERVED_KEYS) expect(drop?.data).not.toHaveProperty(key);
  });

  it("records a merge as [step, tierFrom, chain] with its unit (#3858)", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 200);
    await injectMerge(4, 200, 300);
    await injectMerge(5, 200, 300);
    expect(mockEnqueueEvent.mock.calls.some((c) => c[1]?.type === "merge")).toBe(false);
    await injectGameOver();
    const merge = saved().find((e) => e.type === "merge");
    expect(merge?.data).toEqual({
      m: [
        [7, 3, 1],
        [7, 4, 2],
      ],
      v: 1,
      unit: 1,
      t_ms: expect.any(Number),
    });
  });

  it("capture ordering: drops are recorded in tap order", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 50);
    await act(() => {
      jest.advanceTimersByTime(201);
    });
    await triggerTap(renderer, 250);
    await injectGameOver();
    const drop = saved().find((e) => e.type === "drop");
    expect((drop?.data.d as number[][]).map((t) => t[1])).toEqual([500, 2500]);
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
    // The lid's game over is a loss (#3699; "completed" before Cascade had a win).
    expect(summary.outcome).toBe("loss");
    expect(eventData).toEqual(
      expect.objectContaining({
        final_score: expect.any(Number),
        duration_ms: expect.any(Number),
        theme: expect.any(String),
        total_drops: 1,
        total_merges: 1,
        outcome: "loss",
        end_step: 0, // #3858: the step the game ended on (the stand-in engine reports none)
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
    // #2619 review: same keys as a completed row's result, minus `outcome` (#3700 keys too).
    expect(summary.result).toEqual({
      final_score: expect.any(Number),
      merge_score: expect.any(Number),
      time_bonus: 0,
      bonus_rule: 1,
      duration_ms: expect.any(Number),
      theme: "fruits",
      total_drops: 1,
      total_merges: 1,
      max_tier: expect.any(Number),
      won: false,
    });
    // #3858 (review S1): the unmount abandon's game_ended carries the end step too (the stand-in
    // engine reports none: 0), never in the PATCH result.
    expect(eventData).toEqual({ ...summary.result, end_step: 0, outcome: "abandoned" });
    expect(summary.result).not.toHaveProperty("end_step");
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

  // #3700: idle time before the first drop costs no time bonus.
  it("starts the play clock at the first drop, not at mount", async () => {
    const renderer = await renderScreen();
    await act(() => {
      jest.advanceTimersByTime(60_000); // a minute looking at the empty board
    });
    await triggerTap(renderer, 100);
    await act(() => {
      jest.advanceTimersByTime(5_000);
    });
    await triggerTap(renderer, 200); // a later drop doesn't restart it
    await act(() => {
      jest.advanceTimersByTime(2_000);
    });
    mockCompleteGame.mockClear();
    await act(() => {
      renderer.unmount();
    });
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.result.duration_ms).toBe(7_000);
  });

  it("a New Game's clock waits for its own first drop", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    await act(() => {
      jest.advanceTimersByTime(30_000);
    });
    const shell = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node: any) => typeof node.props.onNewGame === "function"
    )[0];
    await act(() => {
      shell?.props.onNewGame();
    });
    await act(() => {
      jest.advanceTimersByTime(45_000); // idle on the new game's empty board
    });
    await triggerTap(renderer, 100);
    await act(() => {
      jest.advanceTimersByTime(3_000);
    });
    mockCompleteGame.mockClear();
    await act(() => {
      renderer.unmount();
    });
    const [, summary] = mockCompleteGame.mock.calls[0]!;
    expect(summary.result.duration_ms).toBe(3_000);
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
      merge_score: expect.any(Number),
      time_bonus: 0,
      bonus_rule: 1,
      duration_ms: expect.any(Number),
      theme: "fruits",
      total_drops: 1,
      total_merges: 0,
      max_tier: expect.any(Number),
      won: false,
    });
    expect(summary.result).not.toHaveProperty("outcome");
    expect(summary.durationMs).toBe(summary.result.duration_ms);
    // #3858: a New Game's abandon adds the end step and the recorder's replay summary.
    expect(eventData).toEqual({
      ...summary.result,
      outcome: "abandoned",
      end_step: 0,
      replay: expect.any(Object),
    });
  });

  it("game over still sends the full result block (#2619: explicit, unchanged)", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    mockCompleteGame.mockClear();
    await injectGameOver();

    const [, summary, eventData] = mockCompleteGame.mock.calls[0]!;
    // #3858: game_ended is the result block plus the end step and the replay summary.
    expect(eventData).toEqual({ ...summary.result, end_step: 0, replay: expect.any(Object) });
    expect(summary.result).toEqual(expect.objectContaining({ total_drops: 1, outcome: "loss" }));
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

  it("shows the Game Over card with the score, best, merges and time, and no bonus (#3700)", async () => {
    const renderer = await playToGameOver(1234);
    const card = findCard(renderer);
    expect(card?.props.visible).toBe(true);
    expect(card?.props.outcome).toBe("ended");
    expect(card?.props.hero).toEqual({ kind: "score", label: "Score", value: 1234 });
    // The game ended at the moment its first piece (the merge) started the clock: 0:00.
    expect(card?.props.stats).toEqual([
      { label: "Best", value: 1234 },
      { label: "Merges", value: 1 },
      { label: "Time", value: formatMs(0) },
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
    await expect(getBest("cascade")).resolves.toBe(1234);
  });

  it("reads the best from the shared personal best (#3757)", async () => {
    await AsyncStorage.setItem(storageKey("cascade"), JSON.stringify({ v: 1, b: { _: 1000 } }));
    const renderer = await playToGameOver(1234);
    const card = findCard(renderer);
    expect(card?.props.isNewBest).toBe(true);
    await expect(getBest("cascade")).resolves.toBe(1234);
  });

  it("keeps the stored best when the game scores lower", async () => {
    await AsyncStorage.setItem("cascade_best_score", "5000");
    const renderer = await playToGameOver(1234);
    const card = findCard(renderer);
    expect(card?.props.isNewBest).toBe(false);
    expect(card?.props.stats[0]).toEqual({ label: "Best", value: 5000 });
    await expect(getBest("cascade")).resolves.toBe(5000);
  });

  // #2632: the card reads the synced game's rank instead of PATCH /cascade/score/{id}.
  it("shows the synced game's rank under the display name automatically", async () => {
    await storeAssignedDisplayName("Riley");
    const renderer = await playToGameOver(1234);
    expect(mockGetGameRank).toHaveBeenCalledWith("game-uuid-test");
    expect(findCard(renderer)?.props.submission).toEqual(
      expect.objectContaining({ status: "saved", rank: 2, playerName: "Riley" })
    );
  });

  // #3693: the payload now comes from the shared toSubmission; its shape must not drift.
  it("passes the card exactly the rank fields and the two actions", async () => {
    await storeAssignedDisplayName("Riley");
    const renderer = await playToGameOver(1234);
    const submission = findCard(renderer)?.props.submission;
    expect(Object.keys(submission).sort()).toEqual(
      ["isBest", "onJoinLeaderboards", "onRetry", "playerName", "rank", "status"].sort()
    );
    expect(submission).toMatchObject({
      status: "saved",
      rank: 2,
      isBest: true,
      playerName: "Riley",
    });
    expect(typeof submission.onJoinLeaderboards).toBe("function");
    expect(typeof submission.onRetry).toBe("function");
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
    await storeAssignedDisplayName("Riley");
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
    await storeAssignedDisplayName("Riley");
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
    await storeAssignedDisplayName("Riley");
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

// ---------------------------------------------------------------------------
// #2750 — the clock stops in the background, and a relaunch keeps the play
// before the kill without counting the time the app was closed
// ---------------------------------------------------------------------------

describe("CascadeScreen — app background and relaunch (#2750)", () => {
  const ONE_PIECE = [
    {
      id: 1,
      tier: 0,
      x: 200,
      y: 500,
      vx: 0,
      vy: 0,
      angle: 0,
      shapeKind: "circle" as const,
      isSleeping: true,
    },
  ];
  let appStateSpy: jest.SpyInstance;
  // AppState.addEventListener may already be a shared mock whose calls
  // outlive a test: only listeners added from this test on are emitted to.
  let appStateBase: number;

  beforeEach(async () => {
    await AsyncStorage.clear();
    // Restored by the file's afterEach (jest.restoreAllMocks).
    appStateSpy = jest.spyOn(AppState, "addEventListener");
    appStateBase = appStateSpy.mock.calls.length;
    mockEngineGetState.mockImplementation(() => ({
      pieces: ONE_PIECE,
      score: mockEngineScore,
      gameOver: false,
    }));
  });
  afterEach(() => {
    mockEngineGetState.mockImplementation(() => ({
      pieces: [],
      score: mockEngineScore,
      gameOver: false,
    }));
  });

  /** The app moves to `status`, as the OS reports it to every listener. */
  async function setAppState(status: AppStateStatus) {
    await act(async () => {
      for (const [type, listener] of appStateSpy.mock.calls.slice(appStateBase)) {
        if (type === "change") (listener as (s: AppStateStatus) => void)(status);
      }
    });
  }

  /** A restored board settles for a second (60 frames) before it takes a drop. */
  async function settleRestoredBoard() {
    await act(() => {
      for (let i = 0; i < 61; i++) advanceOneFrame();
    });
  }

  function lastDuration(): unknown {
    const [, summary] = mockCompleteGame.mock.calls.at(-1)!;
    return summary.result.duration_ms;
  }

  it("stops the loop and the play clock while the app is in the background", async () => {
    const renderer = await renderScreen();
    await triggerTap(renderer, 100);
    await act(() => {
      jest.advanceTimersByTime(20_000);
    });
    mockEngineStep.mockClear();

    await setAppState("background");
    await act(() => {
      jest.advanceTimersByTime(10 * 60_000); // ten minutes away
    });
    await act(() => {
      advanceOneFrame(); // a frame queued before the pause no-ops
    });
    expect(mockEngineStep).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(0);

    await setAppState("active");
    expect(rafCallbacks).toHaveLength(1); // the loop runs again
    await act(() => {
      jest.advanceTimersByTime(5_000);
    });
    mockCompleteGame.mockClear();
    await act(() => {
      renderer.unmount();
    });
    expect(lastDuration()).toBe(25_000);
  });

  // iOS and Android hold animation frames while the app is away: the frame
  // queued before a trip to the background is delivered late, next to the
  // resumed loop's. It must not start a second loop, trip after trip, and no
  // frame may run once the screen is gone. (cancelAnimationFrame is a no-op
  // here, so the late frames really are delivered.)
  it("runs one loop after trips to the background, and none after unmount", async () => {
    const renderer = await renderScreen();
    expect(rafCallbacks).toHaveLength(1);
    for (let trip = 0; trip < 2; trip++) {
      await setAppState("background"); // the pending frame isn't delivered
      await setAppState("active");
    }
    mockEngineStep.mockClear();
    await act(() => {
      advanceOneFrame(); // the late frames and the resumed loop's arrive together
    });
    expect(mockEngineStep).toHaveBeenCalledTimes(1);
    expect(rafCallbacks).toHaveLength(1);
    await act(() => {
      advanceOneFrame();
    });
    expect(mockEngineStep).toHaveBeenCalledTimes(2);

    await act(() => {
      renderer.unmount();
    });
    mockEngineStep.mockClear();
    await act(() => {
      advanceOneFrame(); // the frame still queued at unmount
    });
    expect(mockEngineStep).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(0);
  });

  it("a relaunch keeps the play before the kill and drops the time the app was closed", async () => {
    const first = await renderScreen();
    await triggerTap(first, 100);
    await act(() => {
      jest.advanceTimersByTime(20_000);
    });
    await setAppState("background"); // the pause saves the board
    const saved = JSON.parse((await AsyncStorage.getItem("cascade_game_v7"))!);
    expect(saved.playedMs).toBe(20_000);
    await act(() => {
      first.unmount(); // the OS kills the app from here
    });
    mockCompleteGame.mockClear();

    jest.setSystemTime(Date.now() + 2 * 24 * 60 * 60_000); // two days later
    const second = await renderScreen();
    await act(async () => {
      await Promise.resolve(); // the saved game's load
    });
    expect(mockEngineRestore).toHaveBeenCalledTimes(1);
    await settleRestoredBoard();
    await triggerTap(second, 100);
    await act(() => {
      jest.advanceTimersByTime(5_000);
    });
    await act(() => {
      second.unmount();
    });
    expect(lastDuration()).toBe(25_000);
  });

  // #3699: only a game that ended shows a card; a restored game is in progress.
  it("restores an in-progress game with no result card", async () => {
    await AsyncStorage.setItem(
      "cascade_game_v7",
      JSON.stringify({
        version: 7,
        pieces: [{ tier: 9, x: 120, y: 500 }],
        score: 900,
        savedAt: Date.now(),
        queue: { current: 0, next: 1 },
        playedMs: 60_000,
      })
    );
    const renderer = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockEngineRestore).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    const modal = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (n: any) => n.props.testID === "cascade-result" && n.props.visible !== undefined
    )[0]!;
    expect(modal.props.visible).toBe(false);
    expect(modal.props.celebration).toBeUndefined();
    expect(renderer.root.findAllByType(Modal).some((m) => m.props.visible === true)).toBe(false);
  });

  // An older build's save has no playedMs: its earlier play is unknown, so
  // the clock counts from the load. It must still restore the board.
  it("restores an older build's save without playedMs, counting from the load", async () => {
    await AsyncStorage.setItem(
      "cascade_game_v7",
      JSON.stringify({
        version: 7,
        pieces: [{ tier: 0, x: 200, y: 500 }],
        score: 10,
        savedAt: Date.now() - 2 * 24 * 60 * 60_000,
        queue: { current: 0, next: 1 },
      })
    );
    const renderer = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockEngineRestore).toHaveBeenCalledTimes(1);
    await settleRestoredBoard();
    await triggerTap(renderer, 100);
    await act(() => {
      jest.advanceTimersByTime(4_000);
    });
    await act(() => {
      renderer.unmount();
    });
    expect(lastDuration()).toBe(4_000);
  });
  // #3904 interim win handling (the celebration and the result card are #3699).
  describe("after the win", () => {
    beforeEach(() => {
      // The board: the one piece of this block, or the capstone a test sets (#3920).
      mockEngineGetState.mockImplementation(() => ({
        pieces: mockEnginePieces.length > 0 ? mockEnginePieces : ONE_PIECE,
        score: mockEngineScore,
        gameOver: false,
      }));
    });
    afterEach(() => {
      mockEngineHasWon.mockReturnValue(false);
      mockEnginePieces = [];
    });

    /** Drops a piece, plays `playMs` (under the 20 s bonus floor by default), then wins. */
    async function win(renderer: ReturnType<typeof create>, playMs = 5_000) {
      await triggerTap(renderer, 100);
      await act(() => {
        jest.advanceTimersByTime(playMs);
      });
      await setAppState("background"); // a save, before the win
      await setAppState("active");
      expect(await AsyncStorage.getItem("cascade_game_v7")).not.toBeNull();
      pendingEngineEvents.push({ type: "win", x: 200, y: 400, id: 1 });
      mockEngineHasWon.mockReturnValue(true);
      await act(() => {
        advanceOneFrame();
      });
      await act(async () => {
        await Promise.resolve();
      });
    }

    /** The capstone the mock engine reports, at `scale` of its size (#3920: it grows in). */
    const capstone = (scale: number) => [
      { id: 9, tier: CAPSTONE_TIER, x: 200, y: 480, angle: 0, scale },
    ];
    /** Runs one frame at 60 Hz; true if the loop scheduled another. */
    async function frame(): Promise<boolean> {
      jest.advanceTimersByTime(1000 / 60);
      await act(() => {
        advanceOneFrame();
      });
      return rafCallbacks.length > 0;
    }

    // #3920: the capstone is made at its parents' size and grows in over GROW_IN_STEPS steps; the
    // loop runs on until it is full size (plus a short settle), then stops.
    it("keeps stepping until the capstone has grown in, then stops for good", async () => {
      const renderer = await renderScreen();
      mockEnginePieces = capstone(0.8);
      await win(renderer);
      // Still running: the capstone is growing in.
      expect(rafCallbacks).toHaveLength(1);
      let frames = 0;
      for (let i = 1; i < GROW_IN_STEPS; i++) {
        mockEnginePieces = capstone(0.8 + (0.2 * i) / GROW_IN_STEPS);
        expect(await frame()).toBe(true);
        frames++;
      }
      // A trip to the background in the middle pauses it; the resume finishes the same tail.
      await setAppState("background");
      expect(await frame()).toBe(false);
      await setAppState("active");
      expect(rafCallbacks).toHaveLength(1);
      mockEnginePieces = capstone(1);
      while (await frame()) {
        frames++;
        expect(frames).toBeLessThan(GROW_IN_STEPS + 20);
      }
      // About GROW_IN_STEPS frames, plus the settle (100 ms: 6 frames at 60 Hz).
      expect(frames).toBeGreaterThanOrEqual(GROW_IN_STEPS);
      expect(frames).toBeLessThanOrEqual(GROW_IN_STEPS + 8);
      mockEngineStep.mockClear();
      await act(() => {
        advanceOneFrame();
      });
      // Ended for good: a trip to the background and back does not restart the loop.
      await setAppState("background");
      await setAppState("active");
      expect(rafCallbacks).toHaveLength(0);
      expect(mockEngineStep).not.toHaveBeenCalled();
    });

    it("with nothing growing in, stops after the short settle", async () => {
      const renderer = await renderScreen();
      mockEnginePieces = capstone(1);
      await win(renderer);
      let frames = 0;
      while (await frame()) frames++;
      expect(frames).toBeLessThanOrEqual(7);
      expect(rafCallbacks).toHaveLength(0);
    });

    it("completes the session once and keeps a new best (Codex on #3919)", async () => {
      await AsyncStorage.setItem("cascade_best_score", "1000");
      const renderer = await renderScreen();
      mockEngineScore = 9000;
      mockCompleteGame.mockClear();
      await win(renderer);
      expect(mockCompleteGame).toHaveBeenCalledTimes(1);
      // #3699: the win is recorded as a win ("completed" before the win card).
      expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("win");
      await expect(getBest("cascade")).resolves.toBe(9000);
      // Leaving afterwards does not file the won game as abandoned.
      await act(() => {
        renderer.unmount();
      });
      const outcomes = mockCompleteGame.mock.calls.map((c) => c[1]?.outcome);
      expect(outcomes).not.toContain("abandoned");
    });

    // #3699: the celebration, then the win card.
    describe("the celebration and the win card (#3699)", () => {
      let reduceMotionListeners: ((enabled: boolean) => void)[] = [];
      beforeEach(() => {
        resetReduceMotionForTests();
        reduceMotionListeners = [];
        jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
        jest
          .spyOn(AccessibilityInfo, "addEventListener")
          .mockImplementation((event: string, handler: unknown) => {
            if (event === "reduceMotionChanged") {
              reduceMotionListeners.push(handler as (enabled: boolean) => void);
            }
            return { remove: jest.fn() } as unknown as ReturnType<
              typeof AccessibilityInfo.addEventListener
            >;
          });
      });
      afterEach(() => resetReduceMotionForTests());

      /** The RN Modal that holds the card: shown only once the celebration is over. */
      const cardShown = (renderer: ReturnType<typeof create>) =>
        renderer.root.findAllByType(Modal).some((m) => m.props.visible === true);
      const resultModal = (renderer: ReturnType<typeof create>) =>
        renderer.root.findAll(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (n: any) => n.props.testID === "cascade-result" && n.props.visible !== undefined
        )[0]!;
      const board = (renderer: ReturnType<typeof create>) =>
        renderer.root.findAll(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (n: any) => n.props.frame !== undefined && n.props.scale !== undefined
        )[0]!;
      const celebrating = (renderer: ReturnType<typeof create>) =>
        renderer.root.findAllByType(CascadeCelebration).length > 0;
      async function advance(ms: number) {
        await act(async () => {
          jest.advanceTimersByTime(ms);
        });
      }
      async function setReduceMotion(enabled: boolean) {
        await act(async () => {
          for (const l of reduceMotionListeners) l(enabled);
        });
      }

      it("plays the celebration first; the win card only after it, at 2.1 s (#2201)", async () => {
        const renderer = await renderScreen();
        mockEngineScore = 4321;
        await win(renderer);
        // The board celebrates: it knows of the win, and its clock starts at 0 and is stepped
        // frame by frame to the card's time (#3924: never by the wall clock).
        expect(board(renderer).props.won).toBe(true);
        expect(board(renderer).props.celebration.value).toBe(0);
        await advance(1000);
        expect(board(renderer).props.celebration.value).toBe(1000);
        expect(celebrating(renderer)).toBe(true);
        expect(resultModal(renderer).props).toMatchObject({ visible: true, outcome: "win" });
        // No card, not even one render early.
        expect(cardShown(renderer)).toBe(false);
        await advance(CELEBRATION_CARD_MS - 1000 - 1);
        expect(cardShown(renderer)).toBe(false);
        await advance(1);
        expect(cardShown(renderer)).toBe(true);
        expect(celebrating(renderer)).toBe(false);
        expect(board(renderer).props.celebration.value).toBe(CELEBRATION_CARD_MS);
      });

      it("the win card shows the score, the merge score, the time bonus, the play time and Best (#3700)", async () => {
        await AsyncStorage.setItem("cascade_best_score", "1000");
        const renderer = await renderScreen();
        mockEngineScore = 9000;
        mockCompleteGame.mockClear();
        await win(renderer, 200_000);
        await advance(CELEBRATION_CARD_MS);
        const card = resultModal(renderer).props;
        // The time is the play clock at the win: the session's own duration.
        const [, summary] = mockCompleteGame.mock.calls[0]!;
        const playedMs = summary.result.duration_ms as number;
        expect(playedMs).toBe(200_000);
        const bonus = timeBonus("win", playedMs);
        expect(bonus).toBe(8_889);
        expect(card.outcome).toBe("win");
        // The score shown is the server's formula: merge score + time bonus.
        expect(card.hero).toEqual({ kind: "score", label: "Score", value: 9000 + bonus });
        expect(card.isNewBest).toBe(true);
        expect(card.stats).toEqual([
          { label: "Merge score", value: 9000 },
          { label: "Time bonus", value: bonus },
          { label: "Time", value: formatMs(playedMs) },
          { label: "Best", value: 9000 + bonus },
        ]);
        // The session sends the same total, and the result block's new keys (#3700).
        expect(summary.finalScore).toBe(9000 + bonus);
        expect(summary.result).toEqual(
          expect.objectContaining({
            final_score: 9000 + bonus,
            merge_score: 9000,
            time_bonus: bonus,
            bonus_rule: 1,
            max_tier: CAPSTONE_TIER,
            won: true,
            outcome: "win",
          })
        );
      });

      it("a win under the 20 s floor shows a time bonus of 0", async () => {
        const renderer = await renderScreen();
        mockEngineScore = 9000;
        await win(renderer);
        await advance(CELEBRATION_CARD_MS);
        const card = resultModal(renderer).props;
        expect(card.hero.value).toBe(9000);
        expect(card.stats[1]).toEqual({ label: "Time bonus", value: 0 });
      });

      it("drops the merge burst for the winning merge only", async () => {
        const renderer = await renderScreen();
        const bursts = () => renderer.root.findAll((n) => n.props.onDone !== undefined).length;
        await injectMerge(3, 100, 200);
        expect(bursts()).toBe(1);
        await injectMerge(CAPSTONE_TIER, 200, 400);
        expect(bursts()).toBe(1);
      });

      it("Reduce Motion: the calm version, and the card at 1.6 s", async () => {
        jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
        const renderer = await renderScreen();
        await act(async () => {
          await Promise.resolve();
        });
        await win(renderer);
        expect(board(renderer).props.reduceMotion).toBe(true);
        expect(board(renderer).props.celebration.value).toBe(0);
        await advance(CELEBRATION_CARD_MS_REDUCED - 1);
        expect(cardShown(renderer)).toBe(false);
        await advance(1);
        expect(cardShown(renderer)).toBe(true);
      });

      it("Reduce Motion switched on late in the celebration shows the card at once", async () => {
        const renderer = await renderScreen();
        await win(renderer);
        await advance(1_800); // past the calm version's 1.6 s
        expect(cardShown(renderer)).toBe(false);
        await setReduceMotion(true);
        // The next frame ends it (the clock comes back to the calm version's end).
        await advance(MAX_FRAME_STEP_MS);
        expect(cardShown(renderer)).toBe(true);
      });

      it("Reduce Motion switched off mid-way carries on to the full celebration", async () => {
        jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
        const renderer = await renderScreen();
        await act(async () => {
          await Promise.resolve();
        });
        await win(renderer);
        await advance(1_000);
        await setReduceMotion(false);
        // Same clock, the full timeline: the card at 2.1 s, past the calm version's 1.6 s.
        await advance(CELEBRATION_CARD_MS - 1_000 - 1);
        expect(cardShown(renderer)).toBe(false);
        await advance(1);
        expect(cardShown(renderer)).toBe(true);
      });

      it("a trip to the background mid-celebration neither restarts play nor shows the card twice", async () => {
        const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
        announce.mockClear();
        const renderer = await renderScreen();
        await win(renderer);
        // Let the win tail end (the board's loop stops after the capstone's grow-in).
        let frames = 0;
        while (await frame()) expect(++frames).toBeLessThan(20);
        await advance(300);
        await setAppState("background");
        await setAppState("active");
        mockEngineStep.mockClear();
        await act(() => {
          advanceOneFrame();
        });
        expect(mockEngineStep).not.toHaveBeenCalled();
        await advance(CELEBRATION_CARD_MS);
        expect(cardShown(renderer)).toBe(true);
        await setAppState("background");
        await setAppState("active");
        await advance(CELEBRATION_CARD_MS);
        expect(cardShown(renderer)).toBe(true);
        const wins = announce.mock.calls.filter(([text]) => String(text).startsWith("You Win!"));
        expect(wins).toHaveLength(1);
      });

      // Review on #3924: the capstone's cheering-face raster throws at the win.
      it("a throw rasterising the cheering face neither breaks the board nor holds the card", async () => {
        const images: { dispose: jest.Mock }[] = [];
        const noop = new Proxy({}, { get: () => () => undefined });
        mockSkiaApi = {
          Surface: {
            Make: (w: number, h: number) => ({
              getCanvas: () => noop,
              flush: () => undefined,
              dispose: () => undefined,
              makeImageSnapshot: () => {
                const img = { dispose: jest.fn(), width: () => w, height: () => h };
                images.push(img);
                return img;
              },
            }),
          },
        };
        __resetArtCachesForTests();
        __resetCelebrationStylesForTests();
        const drawLayer = jest.spyOn(pen, "drawLayer").mockImplementation((_c, _s, _t, layer) => {
          if (layer === "cheer") throw new Error("cheer");
        });
        try {
          const renderer = await renderScreen();
          images.length = 0; // the board's own sprites, made at mount
          await win(renderer);
          expect(drawLayer.mock.calls.some((c) => c[3] === "cheer")).toBe(true);
          // The three capstone bitmaps made before the throw were released.
          expect(images).toHaveLength(3);
          images.forEach((img) => expect(img.dispose).toHaveBeenCalledTimes(1));
          expect(board(renderer).props.won).toBe(true);
          await advance(CELEBRATION_CARD_MS);
          expect(cardShown(renderer)).toBe(true);
          expect(resultModal(renderer).props.outcome).toBe("win");
        } finally {
          drawLayer.mockRestore();
          mockSkiaApi = undefined;
          __resetArtCachesForTests();
          __resetCelebrationStylesForTests();
        }
      });

      // iOS demo on #3924: the style is built ahead, once the board holds a tier-9 piece.
      it("pre-warms the celebration on the first tier-9 piece, not before, off the render", async () => {
        __resetCelebrationStylesForTests();
        const build = jest.spyOn(celebrationStyles, "celebrationStyleFor");
        jest.spyOn(console, "log").mockImplementation(() => undefined);
        const renderer = await renderScreen();
        await injectMerge(CAPSTONE_TIER - 2, 120, 400);
        await advance(3_000);
        expect(build).not.toHaveBeenCalled();
        expect(board(renderer).props.prepareCelebration).toBe(false);
        await injectMerge(CAPSTONE_TIER - 1, 120, 400);
        expect(board(renderer).props.prepareCelebration).toBe(true);
        expect(build).not.toHaveBeenCalled(); // idle time, not the merge's frame or render
        await advance(2_000);
        expect(build).toHaveBeenCalledTimes(1);
        // The win then needs no build.
        await win(renderer);
        expect(build).toHaveBeenCalledTimes(1);
        __resetCelebrationStylesForTests();
      });

      it("holds the clock until the board is ready; the card still comes at 4 s if it never is", async () => {
        jest.spyOn(celebrationHook, "useCelebrationStyle").mockReturnValue(null);
        const renderer = await renderScreen();
        await win(renderer);
        expect(celebrating(renderer)).toBe(true);
        expect(board(renderer).props.celebration.value).toBe(-1);
        await advance(CELEBRATION_CARD_MS);
        expect(cardShown(renderer)).toBe(false);
        await advance(CELEBRATION_MAX_MS - CELEBRATION_CARD_MS);
        expect(cardShown(renderer)).toBe(true);
        expect(resultModal(renderer).props.outcome).toBe("win");
      });

      it("Play Again after a win starts a fresh game", async () => {
        const renderer = await renderScreen();
        await win(renderer);
        await advance(CELEBRATION_CARD_MS);
        mockEngineHasWon.mockReturnValue(false);
        const engines = mockEngineInstanceCount;
        mockStartGame.mockClear();
        await act(() => {
          resultModal(renderer).props.onPlayAgain();
        });
        expect(resultModal(renderer).props.visible).toBe(false);
        expect(cardShown(renderer)).toBe(false);
        expect(board(renderer).props.won).toBe(false);
        expect(board(renderer).props.celebration.value).toBe(-1);
        await act(() => {
          advanceOneFrame();
        });
        expect(mockEngineInstanceCount).toBe(engines + 1);
        expect(mockStartGame).toHaveBeenCalledTimes(1);
      });
    });

    it("clears the saved game and saves nothing after it, on pause or otherwise", async () => {
      const renderer = await renderScreen();
      await win(renderer);
      expect(await AsyncStorage.getItem("cascade_game_v7")).toBeNull();
      await setAppState("background");
      await act(() => {
        jest.advanceTimersByTime(10_000);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(await AsyncStorage.getItem("cascade_game_v7")).toBeNull();
      await act(() => {
        renderer.unmount();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// The lid (#3694): the engine's gate and danger state reach the tap and the board
// ---------------------------------------------------------------------------

describe("CascadeGame — the lid (#3694)", () => {
  // No saved board: a restore would hold taps for its settle ticks.
  beforeEach(async () => {
    await AsyncStorage.clear();
  });
  afterEach(() => {
    mockEngineGetState.mockImplementation(() => ({
      pieces: [],
      score: mockEngineScore,
      gameOver: false,
    }));
    mockEngineCanDrop.mockImplementation(() => true);
  });

  async function showEngineState(state: { dangerRatio: number; canDrop: boolean }) {
    mockEngineGetState.mockImplementation(() => ({
      pieces: [],
      score: mockEngineScore,
      gameOver: false,
      ...state,
    }));
    await act(() => {
      advanceOneFrame();
    });
  }

  it("a tap while the engine's canDrop() is false does not drop", async () => {
    const renderer = await renderScreen();
    mockEngineCanDrop.mockImplementation(() => false);
    await triggerTap(renderer);
    expect(mockEngineDrop).not.toHaveBeenCalled();
    expect(mockEnqueueEvent.mock.calls.some(([, ev]) => ev.type === "drop")).toBe(false);
  });

  it("the tap drops again once canDrop() is true", async () => {
    const renderer = await renderScreen();
    mockEngineCanDrop.mockImplementation(() => false);
    await triggerTap(renderer);
    mockEngineCanDrop.mockImplementation(() => true);
    await triggerTap(renderer);
    expect(mockEngineDrop).toHaveBeenCalledTimes(1);
  });

  // #2960: the lid's state no longer reaches the board as React props every frame; it is
  // published to the board's frame buffer (a shared value) that the board's Picture draws.
  const lidOf = (renderer: ReturnType<typeof create>) => {
    const board = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (n: any) => n.props.frame !== undefined && n.props.scale !== undefined
    )[0]!;
    const f = board.props.frame.value as Float64Array;
    return {
      dangerRatio: f[HEADER_FIELD.dangerRatio],
      canDrop: f[HEADER_FIELD.canDrop] === 1,
      spawnerTier: f[HEADER_FIELD.spawnerTier],
    };
  };

  it("shows the waiting ghost while the engine reports canDrop false", async () => {
    const renderer = await renderScreen();
    await showEngineState({ dangerRatio: 0, canDrop: false });
    expect(lidOf(renderer).canDrop).toBe(false);
    await showEngineState({ dangerRatio: 0, canDrop: true });
    expect(lidOf(renderer).canDrop).toBe(true);
  });

  it("passes the engine's dangerRatio to the ring and the lid line every frame", async () => {
    const renderer = await renderScreen();
    await showEngineState({ dangerRatio: 0, canDrop: true });
    expect(lidOf(renderer).dangerRatio).toBe(0);
    await showEngineState({ dangerRatio: 0.5, canDrop: true });
    expect(lidOf(renderer).dangerRatio).toBe(0.5);
    await showEngineState({ dangerRatio: 0.9, canDrop: false });
    expect(lidOf(renderer)).toMatchObject({
      dangerRatio: 0.9,
      canDrop: false,
    });
  });

  it("the spawner shows the queue's current piece", async () => {
    const renderer = await renderScreen();
    const preview = renderer.root.findAll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (n: any) => n.type === "NextFruitPreview"
    )[0]!;
    expect(lidOf(renderer).spawnerTier).toBe(preview.props.current.tier);
  });
});
