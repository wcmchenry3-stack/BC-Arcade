/**
 * #3701: the screen feeds the engine's land / merge / chain / danger moments to the board's
 * motion and to the paced haptics (B's map plus C's danger warning): fired from timers, never on
 * web, never for a test fast-forward.
 */
import React from "react";
import { Platform } from "react-native";
import { act, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";

import CascadeScreen from "../CascadeScreen";
import { MOTION } from "../../game/cascade/motion";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
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

const impacts = () => (Haptics.impactAsync as jest.Mock).mock.calls.map(([k]) => k);
const notices = () => (Haptics.notificationAsync as jest.Mock).mock.calls.map(([k]) => k);
const merge = (result: number, id: number) => ({ type: "merge", result, x: 200, y: 400, id });
const land = (tier: number, id: number) => ({ type: "land", tier, x: 200, y: 400, id, speed: 18 });

const os = Platform.OS;
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Platform.OS = "ios";
  mockPendingEvents = [];
  mockEngineState = { pieces: [], score: 0, gameOver: false };
  await AsyncStorage.clear();
});

afterEach(() => {
  Platform.OS = os;
  jest.useRealTimers();
});

it("a landing and a plain merge pulse Light, then Medium", async () => {
  await mount();
  mockPendingEvents.push(land(2, 5));
  await frames(100);
  mockPendingEvents.push(merge(2, 6));
  await frames(200);
  expect(impacts()).toEqual(["light", "medium"]);
});

it("a 4-chain in one step pulses Medium, then a rising run on the counter's 80 ms steps", async () => {
  await mount();
  mockPendingEvents.push(merge(1, 1), merge(2, 2), merge(3, 3), merge(4, 4));
  await frames(1000);
  expect(impacts()).toEqual(["medium", "light", "medium", "heavy"]);
  expect(MOTION.chain.stepMs).toBe(80);
});

it("the danger count passing 0.5 gives one Warning", async () => {
  await mount();
  mockEngineState = { pieces: [], score: 0, gameOver: false, dangerRatio: 0.6 } as never;
  await frames(500);
  expect(notices()).toEqual(["warning"]);
});

it("no haptics on web", async () => {
  Platform.OS = "web";
  await mount();
  mockPendingEvents.push(land(2, 5), merge(5, 6));
  mockEngineState = { pieces: [], score: 0, gameOver: false, dangerRatio: 0.9 } as never;
  await frames(500);
  expect(impacts()).toEqual([]);
  expect(notices()).toEqual([]);
});

it("the winning merge fires no merge pulse (the win card's Success covers it)", async () => {
  await mount();
  mockPendingEvents.push(merge(10, 9));
  await frames(300);
  expect(impacts()).toEqual([]);
});
