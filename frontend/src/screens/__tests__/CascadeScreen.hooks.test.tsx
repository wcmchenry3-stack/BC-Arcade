/**
 * CascadeScreen E2E test hooks and developer panel (#2957).
 *
 * `window.__cascade_*` is the seam Playwright and Maestro drive in test builds
 * (EXPO_PUBLIC_TEST_HOOKS=1); the DEV button and its panel exist in dev builds.
 * CascadeEngine is a stand-in, so a test sees what the screen asks of it.
 */

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import CascadeScreen from "../CascadeScreen";
import { WORLD_WIDTH } from "../../game/cascade/constants";
import { PIECE_DEFS } from "../../game/cascade/pieceDefs";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn(() => Promise.resolve({ display_name: "Brave Otter 4821" })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../components/cascade/FruitGlyph", () => "FruitGlyph");
jest.mock("../../components/cascade/NextFruitPreview", () => "NextFruitPreview");
jest.mock("../../components/cascade/ThemeSelector", () => () => null);
jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const passThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, {}, children);
  return {
    useImage: jest.fn().mockReturnValue({ width: 1, height: 1 }),
    Canvas: passThrough,
    Group: passThrough,
    Image: () => null,
    Circle: () => null,
    Line: () => null,
  };
});

const mockStartGame = jest.fn(() => "cascade-game-id");
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({ startGame: lazy(() => mockStartGame) });
});

// What the stand-in engine reports: events returned by the next step() calls,
// and the board and score getState() shows.
let mockPendingEvents: Array<Record<string, unknown>> = [];
let mockEngineState = { pieces: [] as unknown[], score: 0, gameOver: false };
const mockEngine = {
  start: jest.fn(),
  step: jest.fn(() => ({ events: mockPendingEvents.splice(0) })),
  drop: jest.fn(),
  getState: jest.fn(() => mockEngineState),
  destroy: jest.fn(),
  restore: jest.fn(),
};
jest.mock("../../game/cascade/engine2", () => ({
  CascadeEngine: jest.fn().mockImplementation(() => mockEngine),
}));

type Hooks = {
  __cascade_isReady?: () => boolean;
  __cascade_getState?: () => {
    score: number;
    gameOver: boolean;
    nextFruitTier: number;
    fruitCount: number;
    fruits: Array<{ id: number; tier: number; x: number; y: number; angle: number }>;
  };
  __cascade_setSeed?: (seed: number) => void;
  __cascade_dropAt?: (x: number) => void;
  __cascade_fastForward?: (ms: number) => void;
  __cascade_triggerGameOver?: () => void;
  __cascade_spawnTierAt?: (tier: number, x: number) => void;
};
const hooks = globalThis as typeof globalThis & Hooks;
const HOOK_NAMES = [
  "__cascade_isReady",
  "__cascade_getState",
  "__cascade_setSeed",
  "__cascade_dropAt",
  "__cascade_fastForward",
  "__cascade_triggerGameOver",
  "__cascade_spawnTierAt",
] as const;

async function mount() {
  const view = await render(<CascadeScreen />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

const original = process.env.EXPO_PUBLIC_TEST_HOOKS;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockPendingEvents = [];
  mockEngineState = { pieces: [], score: 0, gameOver: false };
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  if (original === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = original;
});

describe("E2E test hooks", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
  });

  it("installs nothing in a normal build", async () => {
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    await mount();
    for (const name of HOOK_NAMES) expect(hooks[name]).toBeUndefined();
  });

  it("installs every hook in a test build, and removes them when the screen goes away", async () => {
    const view = await mount();
    for (const name of HOOK_NAMES) expect(hooks[name]).toBeInstanceOf(Function);
    await view.unmount();
    for (const name of HOOK_NAMES) expect(hooks[name]).toBeUndefined();
  });

  it("reports whether the engine is up", async () => {
    await mount();
    expect(hooks.__cascade_isReady!()).toBe(true);
  });

  it("reports the board: score, pieces and the fruit up next", async () => {
    mockEngineState = {
      score: 120,
      gameOver: false,
      pieces: [{ id: 7, tier: 3, x: 150, y: 400, angle: 0.5 }],
    };
    await mount();
    expect(hooks.__cascade_getState!()).toMatchObject({
      score: 0, // the screen's own score, which only the loop updates
      gameOver: false,
      fruitCount: 1,
      fruits: [{ id: 7, tier: 3, x: 150, y: 400, angle: 0.5 }],
    });
    expect(hooks.__cascade_getState!().nextFruitTier).toEqual(expect.any(Number));
  });

  it("a seed makes the drops come in the same order every time", async () => {
    await mount();
    const dropsFor = (seed: number) => {
      mockEngine.drop.mockClear();
      hooks.__cascade_setSeed!(seed);
      for (let i = 0; i < 6; i++) hooks.__cascade_dropAt!(100 + i);
      return mockEngine.drop.mock.calls.map(([tier]) => tier);
    };
    const first = dropsFor(7);
    expect(first).toHaveLength(6);
    expect(dropsFor(7)).toEqual(first);
  });

  it("dropAt drops the fruit that was up next, where it is told", async () => {
    await mount();
    hooks.__cascade_setSeed!(3);
    const next = hooks.__cascade_getState!().nextFruitTier;
    hooks.__cascade_dropAt!(222);
    expect(mockEngine.drop).toHaveBeenCalledWith(next, 222);
  });

  it("spawnTierAt drops a chosen tier without touching the queue", async () => {
    await mount();
    hooks.__cascade_setSeed!(3);
    const next = hooks.__cascade_getState!().nextFruitTier;
    hooks.__cascade_spawnTierAt!(5, 100);
    expect(mockEngine.drop).toHaveBeenCalledWith(5, 100);
    expect(hooks.__cascade_getState!().nextFruitTier).toBe(next);
  });

  it("fastForward steps the engine in frames and applies a merge", async () => {
    mockEngineState = { pieces: [], score: 40, gameOver: false };
    await mount();
    mockPendingEvents.push({ type: "merge", result: 2, x: 150, y: 300 });
    await act(async () => {
      hooks.__cascade_fastForward!(50);
    });
    // 50 ms in 16.67 ms steps.
    expect(mockEngine.step).toHaveBeenCalledTimes(3);
    expect(screen.getByText("40")).toBeTruthy();
  });

  it("fastForward ends the game when the engine reports game over", async () => {
    await mount();
    mockPendingEvents.push({ type: "gameOver" });
    await act(async () => {
      hooks.__cascade_fastForward!(20);
    });
    expect(hooks.__cascade_getState!().gameOver).toBe(true);
    expect(screen.getByTestId("cascade-result")).toBeTruthy();
  });

  it("fastForward does nothing before the engine exists", async () => {
    const view = await mount();
    const fastForward = hooks.__cascade_fastForward!;
    await view.unmount();
    expect(() => fastForward(100)).not.toThrow();
  });

  it("triggerGameOver shows the result card, and later drops are ignored", async () => {
    await mount();
    await act(async () => {
      hooks.__cascade_triggerGameOver!();
    });
    expect(screen.getByTestId("cascade-result")).toBeTruthy();
    expect(hooks.__cascade_getState!().gameOver).toBe(true);

    hooks.__cascade_dropAt!(100);
    hooks.__cascade_spawnTierAt!(2, 100);
    expect(mockEngine.drop).not.toHaveBeenCalled();
  });
});

describe("developer panel", () => {
  it("opens from the DEV button and closes from its own button", async () => {
    await mount();
    expect(screen.queryByText("Cascade Dev Panel")).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByText("DEV"));
    });
    expect(screen.getByText("Cascade Dev Panel")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText("Close"));
    });
    expect(screen.queryByText("Cascade Dev Panel")).toBeNull();
  });

  it("spawns a piece of the chosen tier in the middle of the board", async () => {
    await mount();
    await act(async () => {
      await fireEvent.press(screen.getByText("DEV"));
    });
    const spawn = screen.getAllByText("Spawn");
    expect(spawn).toHaveLength(PIECE_DEFS.length);

    await act(async () => {
      await fireEvent.press(spawn[2]!);
    });
    expect(mockEngine.drop).toHaveBeenCalledWith(PIECE_DEFS[2]!.tier, WORLD_WIDTH / 2);
  });
});
