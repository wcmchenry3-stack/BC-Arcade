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
  TABLE_GAP,
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

  it.each(PHONES)("$name: 6 face-down + 13 face-up fit inside the felt", async (phone) => {
    setWindow(phone.width, phone.height);
    mockInsets = { ...phone.insets, left: 0, right: 0 };
    mockTabBarHeight = phone.tabBar;
    const api = await mountOn(
      boardState({ tableau: tableauOf([], [], [], [], [], [], [...SIX_FACE_DOWN, ...KING_TO_ACE]) })
    );

    // The felt's real size: what the chrome leaves, reported through onLayout.
    const feltWidth = phone.width - 2 * 6;
    const feltHeight =
      phone.height -
      (APP_HEADER_HEIGHT + phone.insets.top) -
      TABLE_STAT_LINE_HEIGHT -
      TABLE_FELT_MARGIN_TOP -
      TABLE_FELT_MARGIN_BOTTOM -
      Math.max(phone.tabBar, Math.max(phone.insets.bottom, 16));
    await act(async () => {
      fireEvent(api.getByTestId("solitaire-felt"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: feltWidth, height: feltHeight } },
      });
    });

    const column = styleOf(api, "solitaire-tableau-6");
    const cardWidth = column.width!;
    // Cards as wide as the 7 columns allow.
    expect(cardWidth).toBe(Math.floor((feltWidth - 2 * TABLE_PADDING - 6 * TABLE_GAP) / 7));
    const cardHeight = Math.round(cardWidth * (74 / 52));
    // The column's bottom edge, measured from the felt's top: padding, the top
    // row, the row gap, then the column.
    const bottom = TABLE_PADDING + cardHeight + TABLE_ROW_GAP + column.height!;
    expect(bottom + TABLE_PADDING).toBeLessThanOrEqual(feltHeight);
    // And the geometry helper agrees with what was drawn.
    const geometry = computeTableGeometry({ width: feltWidth, height: feltHeight });
    expect(geometry.cardWidth).toBe(cardWidth);
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
    const column = api.getByLabelText("Tableau column 2, 1 cards");
    expect(column.props.accessibilityHint).toBe("Can move here");
    expect(api.getByLabelText("Tableau column 3, 1 cards").props.accessibilityHint).toBeUndefined();
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
