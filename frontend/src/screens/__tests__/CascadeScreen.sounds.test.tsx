/**
 * #3702: the screen feeds the engine's drop / land / merge / chain / danger moments, the win and
 * the game over to the sound pacer (`soundPacer.ts`, tested on its own), with the same quiet flag
 * as the haptics: nothing for a test fast-forward or while a restored game settles. The danger
 * tick's clock is the board's blink: its onsets reach the pacer's `dangerOnset`.
 */
import React from "react";
import { Platform } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { createAudioPlayer } from "expo-audio";
import CascadeScreen from "../CascadeScreen";
import { CHAIN_WARM_DELAY_MS, useCascadeSounds } from "../../game/cascade/useCascadeSounds";
import { CASCADE_SOUND_NAMES } from "../../game/cascade/sounds";

const mockSounds = {
  drop: jest.fn(),
  land: jest.fn(),
  merge: jest.fn(),
  danger: jest.fn(),
  dangerOnset: jest.fn(),
  setCalm: jest.fn(),
  setAway: jest.fn(),
  win: jest.fn(),
  gameOver: jest.fn(),
  reset: jest.fn(),
};
jest.mock("../../game/cascade/useCascadeSounds", () => ({
  ...jest.requireActual("../../game/cascade/useCascadeSounds"),
  useCascadeSounds: jest.fn(() => mockSounds),
}));
// Jest maps every .ogg to one stub: give each file its own id (fruits 100+, cosmos 200+), so the
// real players (#4082's test below) are one per file, as on a device.
jest.mock("../../game/cascade/sounds", () => {
  const actual = jest.requireActual("../../game/cascade/sounds");
  const ids = (base: number) =>
    Object.fromEntries((actual.CASCADE_SOUND_NAMES as string[]).map((name, i) => [name, base + i]));
  return { ...actual, CASCADE_SOUNDS: { fruits: ids(100), cosmos: ids(200) } };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
// Captured so a test can fire "blur"/"focus" (a pushed Stats screen covers the board).
const mockNavListeners = new Map<string, (() => void)[]>();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn((event: string, handler: () => void) => {
      mockNavListeners.set(event, [...(mockNavListeners.get(event) ?? []), handler]);
      return jest.fn();
    }),
  }))
);
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../api/players", () => ({
  playersApi: { putMe: jest.fn(() => Promise.resolve({ display_name: "Brave Otter 4821" })) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../components/cascade/FruitGlyph", () => "FruitGlyph");
jest.mock("../../components/cascade/NextFruitPreview", () => "NextFruitPreview");
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
    // The board's Picture (#2960).
    Picture: () => null,
    createPicture: jest.fn(() => null),
    // The lid's drawing (#3694).
    Path: () => null,
    DashPathEffect: () => null,
    BlurMask: () => null,
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
  canDrop: jest.fn(() => true),
  hasWon: jest.fn(() => false),
  seed: jest.fn(),
};
jest.mock("../../game/cascade/engine", () => ({
  CascadeEngine: jest.fn().mockImplementation(() => mockEngine),
}));

async function mount() {
  const view = await render(<CascadeScreen />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

/** Lets the loop run `ms` of frames (fake timers drive requestAnimationFrame). */
const frames = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

const merge = (result: number, id: number) => ({ type: "merge", result, x: 200, y: 400, id });
const land = (tier: number, id: number) => ({ type: "land", tier, x: 200, y: 400, id, speed: 18 });

const os = Platform.OS;
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Platform.OS = "ios";
  mockPendingEvents = [];
  mockEngineState = { pieces: [], score: 0, gameOver: false };
  mockNavListeners.clear();
  await AsyncStorage.clear();
});

afterEach(() => {
  Platform.OS = os;
  jest.useRealTimers();
});

const calls = (fn: jest.Mock) => fn.mock.calls;
/** The quiet flags the loop passed with each danger step. */
const dangerQuiet = () => calls(mockSounds.danger).map(([, quiet]) => quiet as boolean);
const withTestHooks = async (run: () => Promise<void>) => {
  const original = process.env.EXPO_PUBLIC_TEST_HOOKS;
  process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = original;
  }
};

it("plays the Fruits set by default", async () => {
  await mount();
  expect(useCascadeSounds).toHaveBeenLastCalledWith("fruits", false, false);
});

it("a landing and a chain go to the pacer with their tier and chain link", async () => {
  await mount();
  mockPendingEvents.push(land(6, 5));
  await frames(100);
  mockPendingEvents.push(merge(1, 1), merge(2, 2), merge(3, 3));
  await frames(100);
  expect(calls(mockSounds.land)).toEqual([[6]]);
  expect(calls(mockSounds.merge)).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);
});

it("every frame passes the lid count; the tick comes from the board's blink onsets", async () => {
  await mount();
  mockEngineState = { pieces: [], score: 0, gameOver: false, dangerRatio: 0.7 } as never;
  await frames(200);
  const steps = calls(mockSounds.danger);
  expect(steps.length).toBeGreaterThan(3);
  expect(steps.at(-1)).toEqual([0.7, false]);
  // The blink at 0.7 has a period of about 540 ms and starts on an off-beat.
  await frames(2000);
  expect(mockSounds.dangerOnset.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(mockSounds.dangerOnset.mock.calls.length).toBeLessThanOrEqual(7);
});

it("a drop plays the drop sound", async () => {
  await withTestHooks(async () => {
    await mount();
    await act(async () => {
      (globalThis as { __cascade_dropAt?: (x: number) => void }).__cascade_dropAt?.(200);
    });
    expect(mockSounds.drop).toHaveBeenCalledTimes(1);
  });
});

it("a switch to the Cosmos pieces plays the Cosmos set and resets the pacer", async () => {
  const view = await mount();
  mockSounds.reset.mockClear();
  await fireEvent.press(view.getByRole("radio", { name: "Cosmos theme" }));
  await frames(50);
  expect(useCascadeSounds).toHaveBeenLastCalledWith("cosmos", false, false);
  expect(mockSounds.reset).toHaveBeenCalled();
});

it("the winning merge plays the win (no merge sound); a loss plays the game over", async () => {
  await mount();
  mockPendingEvents.push(merge(11, 9), { type: "win" });
  await frames(100);
  expect(mockSounds.win).toHaveBeenCalledTimes(1);
  expect(mockSounds.merge).not.toHaveBeenCalled();
  expect(mockSounds.gameOver).not.toHaveBeenCalled();
});

it("a game over at the lid plays the game-over sound once", async () => {
  await mount();
  mockPendingEvents.push({ type: "gameOver" });
  await frames(100);
  expect(mockSounds.gameOver).toHaveBeenCalledTimes(1);
  expect(mockSounds.win).not.toHaveBeenCalled();
});

it("the game-over sound plays once a game, even when the test hook ends an ended game", async () => {
  const original = process.env.EXPO_PUBLIC_TEST_HOOKS;
  process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
  try {
    await mount();
    mockPendingEvents.push({ type: "gameOver" });
    await frames(100);
    await act(async () => {
      (globalThis as { __cascade_triggerGameOver?: () => void }).__cascade_triggerGameOver?.();
    });
    await frames(100);
    expect(mockSounds.gameOver).toHaveBeenCalledTimes(1);
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = original;
  }
});

it("a test fast-forward plays no landing or merge", async () => {
  const original = process.env.EXPO_PUBLIC_TEST_HOOKS;
  process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
  try {
    await mount();
    mockPendingEvents.push(land(3, 5), merge(5, 6), merge(6, 7));
    await act(async () => {
      (globalThis as { __cascade_fastForward?: (ms: number) => void }).__cascade_fastForward?.(50);
    });
    await frames(500);
    expect(mockSounds.land).not.toHaveBeenCalled();
    expect(mockSounds.merge).not.toHaveBeenCalled();
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    else process.env.EXPO_PUBLIC_TEST_HOOKS = original;
  }
});

it("a restored game settling is quiet (the danger phase still steps); play after it is not", async () => {
  await AsyncStorage.setItem(
    "cascade_game_v8",
    JSON.stringify({
      version: 8,
      pieces: [{ tier: 4, x: 120, y: 500 }],
      score: 40,
      savedAt: Date.now(),
      queue: { current: 0, next: 1 },
      playedMs: 10_000,
    })
  );
  await mount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockEngine.restore).toHaveBeenCalledTimes(1);
  mockPendingEvents.push(land(4, 1), merge(5, 2));
  await frames(300); // inside the restore's settle
  expect(mockSounds.land).not.toHaveBeenCalled();
  expect(mockSounds.merge).not.toHaveBeenCalled();
  expect(dangerQuiet()).toContain(true);
  await frames(2000);
  mockPendingEvents.push(merge(2, 3));
  await frames(200);
  expect(calls(mockSounds.merge)).toEqual([[2, 1]]);
  expect(dangerQuiet().at(-1)).toBe(false);
});

it("a New Game resets the pacer (sounds still waiting are dropped)", async () => {
  const view = await mount();
  mockSounds.reset.mockClear();
  await fireEvent.press(view.getByRole("button", { name: "More options" }));
  await fireEvent.press(view.getByText("New Game"));
  await fireEvent.press(view.getByText("Start New")); // the abandon confirmation
  expect(mockSounds.reset).toHaveBeenCalled();
});

it("a covered board (Stats, the menu) stops the danger tick until the board is back", async () => {
  await mount();
  mockSounds.setAway.mockClear();
  await act(async () => {
    mockNavListeners.get("blur")?.forEach((h) => h());
  });
  expect(calls(mockSounds.setAway)).toEqual([[true]]);
  await act(async () => {
    mockNavListeners.get("focus")?.forEach((h) => h());
  });
  expect(calls(mockSounds.setAway)).toEqual([[true], [false]]);
});

// #4082: a big chain must create no audio player as it runs (each `createAudioPlayer` is a
// synchronous native call). The chain's lazy sounds are created in idle time after the mount.
describe("the real sound players during a 12-merge chain (#4082)", () => {
  const actual = jest.requireActual("../../game/cascade/useCascadeSounds") as {
    useCascadeSounds: typeof useCascadeSounds;
  };
  beforeEach(() => {
    (useCascadeSounds as jest.Mock).mockImplementation(actual.useCascadeSounds);
  });
  afterEach(() => {
    (useCascadeSounds as jest.Mock).mockImplementation(() => mockSounds);
  });

  it("creates every player a chain plays before the chain, none during it", async () => {
    const create = createAudioPlayer as jest.Mock;
    create.mockClear();
    const view = await mount();
    const atMount = create.mock.calls.length;
    expect(atMount).toBe(8); // the sounds of every turn
    // The chain's players come in idle time, after the mount.
    await frames(CHAIN_WARM_DELAY_MS + 1000);
    const warmed = create.mock.calls.map(([src]) => CASCADE_SOUND_NAMES[(src as number) - 100]);
    expect(warmed).toEqual(
      expect.arrayContaining(["merge-t4", "merge-t10", "chain-2", "chain-4", "merge-t11", "win"])
    );
    create.mockClear();
    // A 12-merge chain over 12 frames, up to a tier-10 piece (the win's pre-warm trigger).
    for (let i = 0; i < 12; i++) {
      mockPendingEvents.push(merge(Math.min(10, 1 + i), 50 + i));
      await frames(17);
    }
    await frames(2000); // the paced sounds play out
    expect(create).not.toHaveBeenCalled();
    view.unmount();
  });
});
