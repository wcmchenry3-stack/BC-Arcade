/**
 * FreeCellScreen felt table (#3607): the felt, the MOVES · TIME stat line, the card
 * size and overlap for the screen's real chrome, the selection's legal targets and
 * their screen-reader hints, Reduce Motion, and Large cards on the felt. Each test
 * resumes a hand-built board saved under the game's real storage key.
 */

import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Dimensions, StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import FreeCellScreen from "../FreeCellScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import type { Card, FreeCellState, Rank, Suit } from "../../game/freecell/types";
import { APP_HEADER_HEIGHT } from "../../components/shared/AppHeader";
import { TABLE_STAT_LINE_HEIGHT } from "../../components/shared/TableStatLine";
import {
  MIN_FACE_UP_STEP,
  TABLE_FELT_MARGIN_BOTTOM,
  TABLE_FELT_MARGIN_TOP,
  TABLE_PADDING,
  TABLE_ROW_GAP,
} from "../../game/_shared/cards/tableLayout";
import { FREECELL_TOP_ROW_SCALE, freeCellGeometry } from "../../game/freecell/layout";
import { LARGE_CARD_WIDTH } from "../../game/freecell/largeCards";
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

// The screen's chrome: safe-area insets and the tab bar's height are set per test.
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
let mockTabBarHeight = 72;
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
  SafeAreaView: jest.fn(({ children }: { children: unknown }) => children),
  SafeAreaProvider: jest.fn(({ children }: { children: unknown }) => children),
}));
jest.mock("../../hooks/useSafeBottomTabBarHeight", () => ({
  useSafeBottomTabBarHeight: () => mockTabBarHeight,
}));

const mockSelectable: Array<{ selected?: boolean; reduceMotion?: boolean }> = [];
jest.mock("../../game/_shared/SelectableCard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactMod = require("react");
  const actual = jest.requireActual("../../game/_shared/SelectableCard");
  return {
    __esModule: true,
    default: (props: { selected?: boolean; reduceMotion?: boolean }) => {
      mockSelectable.push({ selected: props.selected, reduceMotion: props.reduceMotion });
      return ReactMod.createElement(actual.default, props);
    },
  };
});

jest.useFakeTimers();

const originalWindow = Dimensions.get("window");

beforeEach(async () => {
  await AsyncStorage.clear();
  resetReduceMotionForTests();
  mockSelectable.length = 0;
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  mockTabBarHeight = 72;
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

function boardState(tableau: Card[][], overrides: Partial<FreeCellState> = {}): FreeCellState {
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
    ...overrides,
  };
}

/**
 * The tallest legal FreeCell column (19 cards): the 6 cards dealt under a dealt King,
 * and the Queen-to-Ace run built on the King. No Ace of Hearts on the board, so the
 * game can never auto-complete.
 */
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

async function press(api: Api, label: string) {
  await act(async () => {
    await fireEvent.press(api.getByLabelText(label));
  });
}

/** The flattened style of the element with this testID. */
function styleOf(api: Api, testID: string) {
  return StyleSheet.flatten(api.getByTestId(testID).props.style) as Record<string, number>;
}

describe("the felt and the tallest column fit the real screen (#3607)", () => {
  // The phones the layout is for, with the insets and the tab bar they have.
  const PHONES = [
    { name: "375x667", width: 375, height: 667, insets: { top: 20, bottom: 0 }, tabBar: 72 },
    { name: "390x844", width: 390, height: 844, insets: { top: 47, bottom: 34 }, tabBar: 72 + 34 },
    { name: "430x932", width: 430, height: 932, insets: { top: 59, bottom: 34 }, tabBar: 72 + 34 },
  ] as const;

  /** What the chrome leaves for the felt, as the felt itself reports it. */
  function feltOf(phone: (typeof PHONES)[number]) {
    return {
      width: phone.width - 2 * 6,
      height:
        phone.height -
        (APP_HEADER_HEIGHT + phone.insets.top) -
        TABLE_STAT_LINE_HEIGHT -
        TABLE_FELT_MARGIN_TOP -
        TABLE_FELT_MARGIN_BOTTOM -
        // Since #3624 the tab bar sits in flow below the screen (60 plus `insets.bottom || 8`)
        // and the screen pads only its 16 dp gap.
        (60 + (phone.insets.bottom || 8) + 16),
    };
  }

  // What each phone gets, pinned: card width, compression, and the stripe of a covered
  // card in the 19-card column.
  const PINNED = {
    "375x667": { cardWidth: 38, compression: "faceUp", step: 15 },
    "390x844": { cardWidth: 40, compression: "faceUp", step: 22 },
    "430x932": { cardWidth: 45, compression: "none", step: 25 },
  } as const;

  it.each(PHONES)("$name: a 19-card column fits inside the felt", async (phone) => {
    setWindow(phone.width, phone.height);
    mockInsets = { ...phone.insets, left: 0, right: 0 };
    mockTabBarHeight = phone.tabBar;
    const api = await mountOn(boardState([TALLEST, [c("hearts", 9)]]));
    // The first frame is the estimate from the chrome; the felt's onLayout agrees with it.
    const felt = feltOf(phone);
    const estimated = styleOf(api, "freecell-tableau-0").width;
    await act(async () => {
      fireEvent(api.getByTestId("freecell-felt"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, ...felt } },
      });
    });
    const column = styleOf(api, "freecell-tableau-0");
    expect(column.width).toBe(estimated);

    // The board sits inside the felt's 1 dp rim.
    const g = freeCellGeometry({ width: felt.width - 2, height: felt.height - 2 });
    expect(column.width).toBe(g.cardWidth);
    expect(g.topCardWidth).toBe(Math.floor(g.cardWidth * FREECELL_TOP_ROW_SCALE));
    expect(styleOf(api, "freecell-slot-0").width ?? g.topCardWidth).toBe(g.topCardWidth);
    // 8 columns and 7 gaps of 4 dp fit inside the felt's 12 dp padding.
    expect(8 * g.cardWidth + 7 * 4 + 2 * TABLE_PADDING).toBeLessThanOrEqual(felt.width - 2);
    // The column's bottom edge from the felt's top: rim, padding, the top row, the row gap,
    // then the column. It ends above the band kept for the no-moves banner.
    const bottom = 1 + TABLE_PADDING + g.topCardHeight + TABLE_ROW_GAP + column.height!;
    expect(bottom).toBeLessThanOrEqual(felt.height - 1 - g.bottomBand);
    // No scroll view: it would fight the drag.
    expect(api.queryByTestId("freecell-board-scroll")).toBeNull();

    const step =
      styleOf(api, "freecell-col-0-card-8").top! - styleOf(api, "freecell-col-0-card-7").top!;
    const pinned = PINNED[phone.name];
    expect({ cardWidth: column.width, compression: g.compression, step }).toEqual(pinned);
    if (pinned.compression === "none") expect(step).toBeGreaterThanOrEqual(MIN_FACE_UP_STEP);
  });

  it("short columns are airy: 0.72 of the card height", async () => {
    setWindow(390, 844);
    mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
    mockTabBarHeight = 106;
    const api = await mountOn(boardState([[c("spades", 9), c("hearts", 8), c("clubs", 7)]]));
    const column = styleOf(api, "freecell-tableau-0");
    const step = styleOf(api, "freecell-col-0-card-1").top!;
    const cardHeight = column.height! - 2 * step;
    expect(step).toBe(Math.floor(cardHeight * 0.72));
  });
});

describe("the stat line (#3607)", () => {
  it("reads MOVES · TIME, replaces the old FreeCell / Moves row, and the clock starts at the first move", async () => {
    setWindow(390, 844);
    const api = await mountOn(boardState([[c("diamonds", 9)], [c("clubs", 10)], [c("spades", 4)]]));
    expect(api.getByTestId("freecell-stat-line")).toBeTruthy();
    expect(api.getByText("Moves")).toBeTruthy();
    expect(api.getByText("Time")).toBeTruthy();
    expect(api.getByTestId("freecell-stat-moves").props.accessibilityLabel).toBe("Moves: 0");
    expect(api.getByTestId("freecell-stat-time").props.children).toBe("0:00");
    // The title is in the header only: no second "FreeCell" row on the board.
    expect(api.getAllByText("FreeCell")).toHaveLength(1);
    // The stat line wraps at a large font scale, measured like Solitaire's.
    expect(styleOf(api, "freecell-stat-line").minHeight).toBe(TABLE_STAT_LINE_HEIGHT);
    expect(styleOf(api, "freecell-stat-line").flexWrap).toBe("wrap");

    // No move yet: the clock waits.
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(api.getByTestId("freecell-stat-time").props.children).toBe("0:00");

    await press(api, "9 of Diamonds");
    await press(api, "10 of Clubs");
    expect(api.getByTestId("freecell-stat-moves").props.accessibilityLabel).toBe("Moves: 1");
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });
    expect(api.getByTestId("freecell-stat-time").props.children).toBe("0:03");
    expect(api.getByTestId("freecell-stat-time").props.accessibilityLabel).toBe("Time: 0:03");

    // An undo restores the board, not the clock.
    await press(api, "Undo");
    expect(api.getByTestId("freecell-stat-moves").props.accessibilityLabel).toBe("Moves: 0");
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(api.getByTestId("freecell-stat-time").props.children).toBe("0:04");
  });
});

describe("legal targets while something is selected (#3607)", () => {
  // 9♦ fits on 10♣ and 10♠; any empty free cell; nothing on a foundation.
  const state = () =>
    boardState(
      [
        [c("diamonds", 9)],
        [c("clubs", 10)],
        [c("spades", 10)],
        [c("hearts", 10)],
        [c("hearts", 2)],
      ],
      { freeCells: [c("clubs", 5), null, null, null] }
    );

  it("outlines the legal columns and free cells, with one 'Can move here' hint each", async () => {
    setWindow(390, 844);
    const api = await mountOn(state());
    expect(api.queryAllByHintText("Can move here")).toHaveLength(0);

    await press(api, "9 of Diamonds");
    for (const id of ["freecell-tableau-1-target", "freecell-tableau-2-target"]) {
      expect(api.getByTestId(id).props.accessible).toBe(false);
    }
    expect(api.queryByTestId("freecell-tableau-3-target")).toBeNull();
    for (const id of [
      "freecell-slot-1-target",
      "freecell-slot-2-target",
      "freecell-slot-3-target",
    ]) {
      expect(api.getByTestId(id)).toBeTruthy();
    }
    expect(api.queryByTestId("freecell-slot-0-target")).toBeNull();
    // Five targets, five hints: the two columns' top cards and the three empty cells.
    const hinted = api.getAllByHintText("Can move here");
    expect(hinted.map((el) => el.props.accessibilityLabel).sort()).toEqual(
      [
        "10 of Clubs",
        "10 of Spades",
        "Empty free cell 2",
        "Empty free cell 3",
        "Empty free cell 4",
      ].sort()
    );

    // Deselecting clears them (after the double-tap window, so it is a single tap).
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await press(api, "9 of Diamonds (selected)");
    expect(api.queryAllByHintText("Can move here")).toHaveLength(0);
  });

  it("an Ace's own foundation is its target", async () => {
    setWindow(390, 844);
    const api = await mountOn(boardState([[c("hearts", 1)], [c("clubs", 10)]]));
    await press(api, "A of Hearts");
    expect(api.getByTestId("freecell-foundation-hearts-target")).toBeTruthy();
    expect(api.queryByTestId("freecell-foundation-spades-target")).toBeNull();
    const hinted = api.getAllByHintText("Can move here").map((el) => el.props.accessibilityLabel);
    expect(hinted).toContain("Empty Hearts foundation");
  });
});

describe("Reduce Motion (#3607)", () => {
  async function selectedProps(reduceMotion: boolean) {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduceMotion);
    setWindow(390, 844);
    const api = await mountOn(boardState([[c("diamonds", 9)], [c("clubs", 10)]]));
    await act(async () => {});
    await press(api, "9 of Diamonds");
    await act(async () => {});
    return mockSelectable.filter((p) => p.selected).pop();
  }

  it("with Reduce Motion on, the selected card is told not to lift", async () => {
    expect((await selectedProps(true))?.reduceMotion).toBe(true);
  });

  it("with Reduce Motion off, it lifts", async () => {
    expect((await selectedProps(false))?.reduceMotion).toBe(false);
  });
});

describe("Large cards on the felt (#3347, #3607)", () => {
  it("draws 64 dp cards, scrolls sideways, and still fits the tallest column without a vertical scroll", async () => {
    setWindow(390, 844);
    mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
    mockTabBarHeight = 106;
    await AsyncStorage.setItem("freecell_large_cards", "1");
    const api = await mountOn(boardState([TALLEST, [c("hearts", 9)]]));
    expect(api.getByTestId("freecell-board-hscroll")).toBeTruthy();
    expect(api.getByTestId("freecell-scroll-right")).toBeTruthy();
    const column = styleOf(api, "freecell-tableau-0");
    expect(column.width).toBe(LARGE_CARD_WIDTH);
    expect(api.queryByTestId("freecell-board-scroll")).toBeNull();
    // The felt's height less its rim, the scroll strip (48) and padding (2 x 4), the top
    // row and the band: the 19-card column ends inside it.
    const felt = 844 - (64 + 47) - 28 - 12 - (60 + 34 + 16);
    const g = freeCellGeometry({
      width: 390 - 12 - 2,
      height: felt - 2,
      largeCardWidth: LARGE_CARD_WIDTH,
    });
    expect(column.height).toBeLessThanOrEqual(g.tableauHeight);
    expect(g.tableauHeight).toBe(felt - 2 - 56 - 12 - g.topCardHeight - 12 - 44);
  });
});
