/**
 * SolitaireScreen's off-table report (#3653): the tallest column against the felt
 * less the band, and the board against the felt's width, checked once the felt is
 * measured. A felt narrower than the narrowest legal board, or a band so tall the
 * tallest column cannot fit above it, is reported; a phone's felt is not, nor is the
 * first-frame estimate.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { Dimensions } from "react-native";
import { act, fireEvent } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import { computeTableGeometry, faceUpStepFor } from "../../game/_shared/cards/tableLayout";
import { resetSentryThrottle } from "../../game/_shared/sentryThrottle";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { boardState, faceDown, faceUp, mountOn, tableauOf } from "./helpers/solitaireFixtures";

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

const mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
  SafeAreaView: jest.fn(({ children }: { children: unknown }) => children),
  SafeAreaProvider: jest.fn(({ children }: { children: unknown }) => children),
}));
jest.mock("../../hooks/useSafeBottomTabBarHeight", () => ({
  useSafeBottomTabBarHeight: () => 72 + 34,
}));

const capture = Sentry.captureMessage as jest.Mock;
const offTableCalls = () => capture.mock.calls.filter((c) => c[0] === "cards.offTable");
const originalWindow = Dimensions.get("window");

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  resetReduceMotionForTests();
  resetSentryThrottle();
  capture.mockClear();
});

afterEach(() => {
  Dimensions.set({ window: originalWindow });
  jest.restoreAllMocks();
});

function setWindow(width: number, height: number) {
  Dimensions.set({ window: { width, height, scale: 2, fontScale: 1 } });
}

const KING_TO_ACE = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((rank, i) =>
  faceUp((["spades", "hearts", "clubs", "diamonds"] as const)[i % 4], rank)
);
const SIX_FACE_DOWN = [13, 13, 13, 12, 12, 12].map((rank, i) =>
  faceDown((["clubs", "diamonds", "hearts"] as const)[i % 3], rank)
);
/** The tallest legal column in the last tableau column. */
const TALLEST = boardState({
  tableau: tableauOf([], [], [], [], [], [], [...SIX_FACE_DOWN, ...KING_TO_ACE]),
});

type Api = Awaited<ReturnType<typeof mountOn>>;

async function layout(api: Api, testID: string, width: number, height: number) {
  await act(async () => {
    fireEvent(api.getByTestId(testID), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width, height } },
    });
  });
}

describe("SolitaireScreen reports cards off the felt (#3653)", () => {
  it("sends nothing for a phone's felt, even with the tallest column", async () => {
    setWindow(390, 844);
    const api = await mountOn(TALLEST);
    await layout(api, "solitaire-felt", 378, 552);
    expect(offTableCalls()).toEqual([]);
  });

  it("never checks the first-frame estimate", async () => {
    // A window so narrow that the estimated felt cannot hold the board.
    setWindow(250, 844);
    await mountOn(TALLEST);
    expect(offTableCalls()).toEqual([]);
  });

  it("reports a measured felt narrower than the board, with the layout's numbers", async () => {
    setWindow(250, 844);
    const api = await mountOn(TALLEST);
    await layout(api, "solitaire-felt", 250, 552);
    expect(offTableCalls()).toHaveLength(1);
    const [, { level, tags, extra }] = offTableCalls()[0];
    // 36 dp cards are the floor: 7 x 36 + 6 x 4 = 276 dp, in a 248 dp felt (1 dp rim each side).
    const g = computeTableGeometry({ width: 248, height: 550 });
    expect(g.cardWidth).toBe(36);
    expect(level).toBe("warning");
    expect(tags).toEqual({
      game: "solitaire",
      edge: "right",
      deck: "minimal",
      largeCards: "false",
      platform: "ios",
    });
    expect(extra).toMatchObject({
      overflow: 14,
      overflowLeft: 14,
      feltWidth: 250,
      feltHeight: 552,
      containerWidth: 248,
      containerHeight: 550 - Math.max(g.padding, g.bottomBand),
      cardWidth: 36,
      cardHeight: g.cardHeight,
      step: faceUpStepFor(g, [{ down: 6, up: 13 }]),
      compression: g.compression,
      columnLengths: [0, 0, 0, 0, 0, 0, 19],
      insetsTop: 47,
      insetsBottom: 34,
    });
    // Once per process: another layout change sends nothing more.
    await layout(api, "solitaire-felt", 240, 552);
    expect(offTableCalls()).toHaveLength(1);
  });

  it("reports the tallest column running under a band too tall to fit it above", async () => {
    setWindow(390, 844);
    const api = await mountOn(TALLEST);
    await layout(api, "solitaire-felt", 378, 552);
    // A huge font scale wraps the band far past the felt's height.
    await layout(api, "solitaire-bottom-band", 378, 500);
    expect(offTableCalls()).toHaveLength(1);
    const [, { tags, extra }] = offTableCalls()[0];
    expect(tags.edge).toBe("bottom");
    expect(extra.containerHeight).toBe(550 - 500);
    expect(extra.overflow).toBeGreaterThan(3);
  });
});
