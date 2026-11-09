/**
 * FreeCellScreen's off-table report (#3653): the tallest column against the felt
 * less the band, and the board against the felt's width, once the felt is measured.
 * Large cards scroll sideways by design, so only their height is checked.
 */

import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { AccessibilityInfo, Dimensions } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import FreeCellScreen from "../FreeCellScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import type { Card, FreeCellState, Rank, Suit } from "../../game/freecell/types";
import { faceUpStepFor } from "../../game/_shared/cards/tableLayout";
import { freeCellGeometry } from "../../game/freecell/layout";
import { resetSentryThrottle } from "../../game/_shared/sentryThrottle";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/useSound", () => ({
  useSound: () => ({ play: jest.fn(() => true), stop: jest.fn() }),
}));

const mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
  SafeAreaView: jest.fn(({ children }: { children: unknown }) => children),
  SafeAreaProvider: jest.fn(({ children }: { children: unknown }) => children),
}));
jest.mock("../../hooks/useSafeBottomTabBarHeight", () => ({
  useSafeBottomTabBarHeight: () => 72 + 34,
}));

jest.useFakeTimers();

const capture = Sentry.captureMessage as jest.Mock;
const offTableCalls = () => capture.mock.calls.filter((call) => call[0] === "cards.offTable");
const originalWindow = Dimensions.get("window");

beforeEach(async () => {
  await AsyncStorage.clear();
  resetReduceMotionForTests();
  resetSentryThrottle();
  capture.mockClear();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
});

afterEach(async () => {
  // Not runAllTimers: the play clock re-arms its one-second tick while it runs.
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  Dimensions.set({ window: originalWindow });
  jest.restoreAllMocks();
});

function setWindow(width: number, height: number) {
  Dimensions.set({ window: { width, height, scale: 2, fontScale: 1 } });
}

const c = (suit: Suit, rank: number): Card => ({ suit, rank: rank as Rank });

function boardState(tableau: Card[][]): FreeCellState {
  const cols = [...tableau];
  while (cols.length < 8) cols.push([]);
  return {
    _v: 1,
    tableau: cols,
    freeCells: [null, null, null, null],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    undoStack: [],
    isComplete: false,
    moveCount: 0,
  };
}

/** The tallest legal column (19 cards); no Ace of Hearts, so it never auto-completes. */
const KING_TO_ACE = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((rank, i) =>
  c(i % 2 === 0 ? "spades" : "diamonds", rank)
);
const TALLEST = [...[2, 3, 4, 5, 6, 7].map((r) => c("clubs", r)), ...KING_TO_ACE];

async function mountOn(state: FreeCellState) {
  await AsyncStorage.setItem("freecell_game", JSON.stringify(state));
  const api = await render(
    <ThemeProvider>
      <FreeCellScreen />
    </ThemeProvider>
  );
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return api;
}
type Api = Awaited<ReturnType<typeof mountOn>>;

async function layoutFelt(api: Api, width: number, height: number) {
  await act(async () => {
    fireEvent(api.getByTestId("freecell-felt"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width, height } },
    });
  });
}

describe("FreeCellScreen reports cards off the felt (#3653)", () => {
  it("sends nothing for a phone's felt, even with the tallest column", async () => {
    setWindow(390, 844);
    const api = await mountOn(boardState([TALLEST, [c("hearts", 9)]]));
    await layoutFelt(api, 378, 552);
    expect(offTableCalls()).toEqual([]);
  });

  it("never checks the first-frame estimate", async () => {
    setWindow(250, 844);
    await mountOn(boardState([TALLEST, [c("hearts", 9)]]));
    expect(offTableCalls()).toEqual([]);
  });

  it("reports a measured felt narrower than the board, with the layout's numbers", async () => {
    setWindow(250, 844);
    const api = await mountOn(boardState([TALLEST, [c("hearts", 9)]]));
    await layoutFelt(api, 250, 552);
    expect(offTableCalls()).toHaveLength(1);
    const [, { tags, extra }] = offTableCalls()[0];
    // 8 x 36 + 7 x 4 = 316 dp of board in a 248 dp felt: 34 dp past each side.
    const g = freeCellGeometry({ width: 248, height: 550 });
    expect(g.cardWidth).toBe(36);
    expect(tags).toEqual({
      game: "freecell",
      edge: "right",
      deck: "minimal",
      largeCards: "false",
      platform: "ios",
    });
    expect(extra).toMatchObject({
      overflow: 34,
      overflowLeft: 34,
      feltWidth: 250,
      containerWidth: 248,
      containerHeight: 550 - Math.max(g.padding, g.bottomBand),
      cardWidth: 36,
      step: faceUpStepFor(
        g,
        [19, 1, 0, 0, 0, 0, 0, 0].map((up) => ({ down: 0, up }))
      ),
      columnLengths: [19, 1, 0, 0, 0, 0, 0, 0],
    });
  });

  it("Large cards: a board wider than the felt scrolls by design and is not reported", async () => {
    setWindow(390, 844);
    await AsyncStorage.setItem("freecell_large_cards", "1");
    const api = await mountOn(boardState([KING_TO_ACE.slice(0, 6), [c("hearts", 9)]]));
    expect(api.getByTestId("freecell-scroll-right")).toBeTruthy();
    await layoutFelt(api, 378, 552);
    expect(offTableCalls()).toEqual([]);
  });
});
