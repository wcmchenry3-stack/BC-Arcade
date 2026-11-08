/**
 * SolitaireScreen felt table (#3606): the felt, the stat line, the card size and
 * overlap for the screen's real chrome, the selection's glow and its legal targets.
 * Each test resumes a hand-built board (helpers/solitaireFixtures).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Dimensions, StyleSheet } from "react-native";
import { act, fireEvent, within } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import { APP_HEADER_HEIGHT } from "../../components/shared/AppHeader";
import { TABLE_STAT_LINE_HEIGHT } from "../../components/shared/TableStatLine";
import {
  TABLE_FELT_MARGIN_BOTTOM,
  TABLE_FELT_MARGIN_TOP,
  TABLE_BOTTOM_BAND,
  TABLE_PADDING,
  TABLE_ROW_GAP,
  computeTableGeometry,
} from "../../game/_shared/cards/tableLayout";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import {
  boardState,
  faceDown,
  faceUp,
  mountOn,
  pressLabel,
  tableauOf,
} from "./helpers/solitaireFixtures";

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

const originalWindow = Dimensions.get("window");

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  resetReduceMotionForTests();
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  mockTabBarHeight = 72;
});

afterEach(() => {
  Dimensions.set({ window: originalWindow });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function setWindow(width: number, height: number) {
  Dimensions.set({ window: { width, height, scale: 2, fontScale: 1 } });
}

/** King down to Ace, alternating colours: the longest run a column can hold. */
const KING_TO_ACE = [
  faceUp("spades", 13),
  faceUp("hearts", 12),
  faceUp("clubs", 11),
  faceUp("diamonds", 10),
  faceUp("spades", 9),
  faceUp("hearts", 8),
  faceUp("clubs", 7),
  faceUp("diamonds", 6),
  faceUp("spades", 5),
  faceUp("hearts", 4),
  faceUp("clubs", 3),
  faceUp("diamonds", 2),
  faceUp("spades", 1),
];
const SIX_FACE_DOWN = [
  faceDown("clubs", 13),
  faceDown("diamonds", 13),
  faceDown("hearts", 13),
  faceDown("clubs", 12),
  faceDown("diamonds", 12),
  faceDown("spades", 12),
];

type Api = Awaited<ReturnType<typeof mountOn>>;

/** The flattened style of the element with this testID. */
function styleOf(api: Api, testID: string) {
  return StyleSheet.flatten(api.getByTestId(testID).props.style) as Record<string, number>;
}

describe("the felt, the stat line and the tallest column fit the real screen (#3606)", () => {
  // The phones the layout is for, with the insets and the tab bar they have.
  const PHONES = [
    { name: "375x667", width: 375, height: 667, insets: { top: 20, bottom: 0 }, tabBar: 72 },
    { name: "390x844", width: 390, height: 844, insets: { top: 47, bottom: 34 }, tabBar: 72 + 34 },
    { name: "430x932", width: 430, height: 932, insets: { top: 59, bottom: 34 }, tabBar: 72 + 34 },
  ] as const;

  /** What the chrome leaves for the felt, as the felt itself would report it. */
  function feltOf(phone: (typeof PHONES)[number], statLine = TABLE_STAT_LINE_HEIGHT) {
    return {
      width: phone.width - 2 * 6,
      height:
        phone.height -
        (APP_HEADER_HEIGHT + phone.insets.top) -
        statLine -
        TABLE_FELT_MARGIN_TOP -
        TABLE_FELT_MARGIN_BOTTOM -
        Math.max(phone.tabBar, Math.max(phone.insets.bottom, 16)),
    };
  }

  it.each(PHONES)("$name: 6 face-down + 13 face-up fit inside the felt", async (phone) => {
    setWindow(phone.width, phone.height);
    mockInsets = { ...phone.insets, left: 0, right: 0 };
    mockTabBarHeight = phone.tabBar;
    const api = await mountOn(
      boardState({ tableau: tableauOf([], [], [], [], [], [], [...SIX_FACE_DOWN, ...KING_TO_ACE]) })
    );
    // The felt's real size, reported through onLayout.
    const felt = feltOf(phone);
    await act(async () => {
      fireEvent(api.getByTestId("solitaire-felt"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, ...felt } },
      });
    });

    const column = styleOf(api, "solitaire-tableau-6");
    // The board sits inside the felt's 1 dp rim.
    const geometry = computeTableGeometry({ width: felt.width - 2, height: felt.height - 2 });
    // The cards drawn are the helper's, as wide as the 7 columns allow.
    expect(column.width).toBe(geometry.cardWidth);
    // The column's bottom edge, measured from the felt's top: rim, padding, the top
    // row, the row gap, then the column. It ends above the band for the selection
    // label and the Auto-Complete pill.
    const bottom = 1 + TABLE_PADDING + geometry.cardHeight + TABLE_ROW_GAP + column.height!;
    expect(bottom).toBeLessThanOrEqual(felt.height - 1 - geometry.bottomBand);
    // No scroll view: it would fight the drag.
    expect(api.queryByTestId("solitaire-tableau-scroll")).toBeNull();
    // The stripe of a covered card: the outcome pinned per phone.
    const step =
      styleOf(api, "solitaire-tableau-6-card-8").top! -
      styleOf(api, "solitaire-tableau-6-card-7").top!;
    if (phone.name === "375x667") {
      // Compressed: 36 dp cards, 8 dp face-down steps, a stripe under 24 and over 18.
      expect(geometry.compression).toBe("faceUp");
      expect(column.width).toBe(36);
      expect(styleOf(api, "solitaire-tableau-6-card-1").top!).toBe(8);
      expect(step).toBeLessThan(24);
      expect(step).toBeGreaterThanOrEqual(18);
    } else {
      expect(geometry.compression).toBe("none");
      expect(step).toBeGreaterThanOrEqual(24);
    }
  });

  it("keeps the band for the selection label and the Auto-Complete pill below the tableau", async () => {
    setWindow(390, 844);
    const api = await mountOn(
      boardState({ tableau: tableauOf([faceUp("spades", 6)], [faceUp("hearts", 7)]) })
    );
    await pressLabel(api, "6 of Spades");
    const band = styleOf(api, "solitaire-bottom-band");
    expect(band.minHeight).toBe(TABLE_BOTTOM_BAND);
    expect(band.bottom).toBe(0);
    expect(band.flexWrap).toBe("wrap");
    expect(
      within(api.getByTestId("solitaire-bottom-band")).getByText("6 of Spades (selected)")
    ).toBeTruthy();
  });

  it("sizes the cards from the band's measured height when it wraps", async () => {
    // A window where the card width depends on the room below the tableau.
    const phone = PHONES[0];
    let height = 0;
    for (let h = 450; h < 900; h++) {
      const wide = computeTableGeometry({ width: 361, height: h, bottomBand: TABLE_BOTTOM_BAND });
      const narrow = computeTableGeometry({
        width: 361,
        height: h,
        bottomBand: TABLE_BOTTOM_BAND + 40,
      });
      if (narrow.cardWidth < wide.cardWidth) {
        height = h;
        break;
      }
    }
    expect(height).toBeGreaterThan(0);
    const felt = { width: 363, height: height + 2 };
    setWindow(phone.width, 400); // irrelevant: the felt's own size wins once measured
    const api = await mountOn(
      boardState({ tableau: tableauOf([], [], [], [], [], [], [...SIX_FACE_DOWN, ...KING_TO_ACE]) })
    );
    await act(async () => {
      fireEvent(api.getByTestId("solitaire-felt"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, ...felt } },
      });
    });
    const before = styleOf(api, "solitaire-tableau-6").width!;
    expect(before).toBe(
      computeTableGeometry({ width: felt.width - 2, height: felt.height - 2 }).cardWidth
    );
    // A large font scale wraps the band onto a second row.
    await act(async () => {
      fireEvent(api.getByTestId("solitaire-bottom-band"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 361, height: TABLE_BOTTOM_BAND + 40 } },
      });
    });
    const after = styleOf(api, "solitaire-tableau-6").width!;
    expect(after).toBeLessThan(before);
    expect(after).toBe(
      computeTableGeometry({
        width: felt.width - 2,
        height: felt.height - 2,
        bottomBand: TABLE_BOTTOM_BAND + 40,
      }).cardWidth
    );
    // The band only grows: shrinking again (the label going away) must not re-lay the board out.
    await act(async () => {
      fireEvent(api.getByTestId("solitaire-bottom-band"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 361, height: TABLE_BOTTOM_BAND } },
      });
    });
    expect(styleOf(api, "solitaire-tableau-6").width).toBe(after);
  });

  it("sizes the felt from the stat line's measured height", async () => {
    // Before the felt reports its own size the screen estimates it from the chrome, and a
    // stat line that wraps onto a second row (a large font scale) takes room from it.
    const phone = PHONES[0];
    const base = feltOf(phone);
    let height = 0;
    for (let h = 600; h < 760; h++) {
      const p = { ...phone, height: h };
      const wide = computeTableGeometry({
        width: feltOf(p).width - 2,
        height: feltOf(p).height - 2,
      });
      const narrow = computeTableGeometry({
        width: feltOf(p, 68).width - 2,
        height: feltOf(p, 68).height - 2,
      });
      if (narrow.cardWidth < wide.cardWidth) {
        height = h;
        break;
      }
    }
    expect(height).toBeGreaterThan(0);
    expect(base.width).toBe(363);
    const tall = { ...phone, height };
    setWindow(tall.width, tall.height);
    mockInsets = { ...tall.insets, left: 0, right: 0 };
    mockTabBarHeight = tall.tabBar;
    const api = await mountOn(
      boardState({ tableau: tableauOf([], [], [], [], [], [], [...SIX_FACE_DOWN, ...KING_TO_ACE]) })
    );
    const before = styleOf(api, "solitaire-tableau-6").width!;
    const f28 = feltOf(tall);
    expect(before).toBe(
      computeTableGeometry({ width: f28.width - 2, height: f28.height - 2 }).cardWidth
    );
    await act(async () => {
      fireEvent(api.getByTestId("solitaire-stat-line"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 363, height: 68 } },
      });
    });
    const after = styleOf(api, "solitaire-tableau-6").width!;
    // Without the stat line's onLayout the cards would not change.
    expect(after).toBeLessThan(before);
    const f68 = feltOf(tall, 68);
    expect(after).toBe(
      computeTableGeometry({ width: f68.width - 2, height: f68.height - 2 }).cardWidth
    );
    expect(styleOf(api, "solitaire-stat-line").minHeight).toBe(TABLE_STAT_LINE_HEIGHT);
    expect(styleOf(api, "solitaire-stat-line").flexWrap).toBe("wrap");
  });

  it("draws the felt between the stat line and the tab bar", async () => {
    setWindow(390, 844);
    const api = await mountOn(boardState());
    expect(api.getByTestId("solitaire-felt")).toBeTruthy();
    expect(api.getByTestId("solitaire-stat-line")).toBeTruthy();
  });

  it("short columns step the face-up cards up to 0.72 of the card height", async () => {
    setWindow(390, 844);
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceDown("clubs", 9), faceUp("hearts", 8), faceUp("spades", 7)]),
      })
    );
    const cardHeight = Math.round(styleOf(api, "solitaire-tableau-0").width! * (74 / 52));
    const up = styleOf(api, "solitaire-tableau-0-card-1").top!;
    const upNext = styleOf(api, "solitaire-tableau-0-card-2").top!;
    expect(up).toBe(Math.round(cardHeight * 0.2));
    expect(upNext - up).toBe(Math.floor(cardHeight * 0.72));
  });
});

describe("the stat line (#3606)", () => {
  it("shows moves, score and time in one line, replacing the old row", async () => {
    setWindow(390, 844);
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceUp("hearts", 7)]),
        score: 45,
        moves: 12,
        accumulatedMs: 134_000,
      })
    );
    const line = api.getByTestId("solitaire-stat-line");
    expect(within(line).getByText("Moves")).toBeTruthy();
    expect(within(line).getByText("12")).toBeTruthy();
    expect(within(line).getByText("Score")).toBeTruthy();
    expect(within(line).getByText("45")).toBeTruthy();
    expect(within(line).getByText("Time")).toBeTruthy();
    expect(api.getByTestId("solitaire-stat-time").props.children).toBe("2:14");
    // Screen readers still hear the whole item.
    expect(api.getByLabelText("Moves: 12")).toBeTruthy();
    expect(api.getByLabelText("Score: 45")).toBeTruthy();
    expect(api.getByLabelText("Time: 2:14")).toBeTruthy();
  });

  it("updates moves and score after a move", async () => {
    setWindow(390, 844);
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceUp("hearts", 7)], [faceUp("spades", 6)]),
      })
    );
    expect(within(api.getByTestId("solitaire-stat-moves")).getByText("0")).toBeTruthy();
    await pressLabel(api, "6 of Spades");
    await pressLabel(api, "7 of Hearts");
    expect(within(api.getByTestId("solitaire-stat-moves")).getByText("1")).toBeTruthy();
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
  });

  it("ticks the time while the clock runs", async () => {
    jest.useFakeTimers({ now: 1_700_000_000_000, doNotFake: ["nextTick", "setImmediate"] });
    setWindow(390, 844);
    const api = await mountOn(
      boardState({ tableau: tableauOf([faceUp("hearts", 7)], [faceUp("spades", 6)]) })
    );
    expect(api.getByTestId("solitaire-stat-time").props.children).toBe("0:00");
    // The first move starts the clock.
    await pressLabel(api, "6 of Spades");
    await pressLabel(api, "7 of Hearts");
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(api.getByTestId("solitaire-stat-time").props.children).toBe("0:03");
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(api.getByTestId("solitaire-stat-time").props.children).toBe("0:05");
  });
});

describe("selection and targets (#3606)", () => {
  // 6 of spades can go on the 7 of hearts only.
  const board = () =>
    boardState({
      tableau: tableauOf(
        [faceUp("spades", 6)],
        [faceUp("hearts", 7)],
        [faceUp("clubs", 7)],
        [faceUp("diamonds", 2)]
      ),
    });

  it("outlines the legal destinations, and only those, while a card is selected", async () => {
    setWindow(390, 844);
    const api = await mountOn(board());
    expect(api.queryByTestId("solitaire-tableau-1-target")).toBeNull();
    await pressLabel(api, "6 of Spades");
    expect(api.getByTestId("solitaire-tableau-1-target")).toBeTruthy();
    expect(api.queryByTestId("solitaire-tableau-2-target")).toBeNull();
    expect(api.queryByTestId("solitaire-tableau-3-target")).toBeNull();
    // The empty columns do not take a 6.
    expect(api.queryByTestId("solitaire-tableau-4-target")).toBeNull();
    expect(api.queryByTestId("solitaire-foundation-spades-target")).toBeNull();
  });

  it("draws the outline in the bonus (green) token", async () => {
    setWindow(390, 844);
    const api = await mountOn(board());
    await pressLabel(api, "6 of Spades");
    const outline = styleOf(api, "solitaire-tableau-1-target") as unknown as Record<string, string>;
    const { dark } = jest.requireActual("../../theme/ThemeContext");
    expect(outline.borderColor).toBe(dark.bonus);
  });

  it("clears the outlines when the selection ends", async () => {
    setWindow(390, 844);
    let now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const api = await mountOn(board());
    await pressLabel(api, "6 of Spades");
    expect(api.getByTestId("solitaire-tableau-1-target")).toBeTruthy();
    // A tap on the same card inside the double-tap window is a double tap; wait it out.
    now += 1000;
    await pressLabel(api, "6 of Spades (selected)");
    expect(api.queryByTestId("solitaire-tableau-1-target")).toBeNull();
  });

  it("tells screen readers a destination can take the selection", async () => {
    setWindow(390, 844);
    const api = await mountOn(board());
    await pressLabel(api, "6 of Spades");
    // On the destination's top card; the other columns carry none.
    expect(api.getByLabelText("7 of Hearts").props.accessibilityHint).toBe("Can move here");
    expect(api.getByLabelText("7 of Clubs").props.accessibilityHint).toBeUndefined();
    expect(api.getAllByHintText("Can move here")).toHaveLength(1);
  });

  it("outlines an empty column for a king, and a foundation for an ace", async () => {
    setWindow(390, 844);
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceUp("hearts", 7)]),
        waste: [faceUp("spades", 13)],
      })
    );
    await pressLabel(api, "K of Spades");
    expect(api.getByTestId("solitaire-tableau-1-target")).toBeTruthy();
    expect(api.getByLabelText("Empty tableau column 2").props.accessibilityHint).toBe(
      "Can move here"
    );
    expect(api.queryByTestId("solitaire-tableau-0-target")).toBeNull();
    expect(api.queryByTestId("solitaire-foundation-spades-target")).toBeNull();
  });

  it("outlines the foundation that takes the selected ace", async () => {
    setWindow(390, 844);
    const api = await mountOn(
      boardState({ tableau: tableauOf([faceUp("hearts", 7)]), waste: [faceUp("spades", 1)] })
    );
    await pressLabel(api, "A of Spades");
    expect(api.getByTestId("solitaire-foundation-spades-target")).toBeTruthy();
    expect(api.getByLabelText("Empty Spades foundation").props.accessibilityHint).toBe(
      "Can move here"
    );
    expect(api.queryByTestId("solitaire-foundation-hearts-target")).toBeNull();
  });

  it("marks every empty tableau column with a faint K", async () => {
    setWindow(390, 844);
    const api = await mountOn(boardState({ tableau: tableauOf([faceUp("hearts", 7)]) }));
    expect(api.queryByTestId("solitaire-tableau-0-marker", { hidden: true })).toBeNull();
    for (let col = 1; col < 7; col++) {
      expect(
        api.getByTestId(`solitaire-tableau-${col}-marker`, { hidden: true }).props.children
      ).toBe("K");
    }
  });
});
