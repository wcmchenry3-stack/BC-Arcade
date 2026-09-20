import { StyleSheet } from "react-native";
import React from "react";
import { Alert } from "react-native";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HomeScreen from "../HomeScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { __forceStoreBuildForTests } from "../../entitlements/gameVisibility";
import i18n from "i18next";
import mahjongEn from "../../i18n/locales/en/mahjong.json";

// ---------------------------------------------------------------------------
// Mock entitlements — default: all games entitled (canPlay always true)
// ---------------------------------------------------------------------------
const mockCanPlay = jest.fn().mockReturnValue(true);

jest.mock("../../entitlements/EntitlementContext", () => ({
  ...jest.requireActual("../../entitlements/EntitlementContext"),
  useEntitlements: () => ({
    canPlay: mockCanPlay,
    isLoading: false,
    lastRefreshed: null,
  }),
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockPrefetch = jest.fn();
jest.mock("../../utils/lazyScreens", () => ({
  prefetchLobbyGameScreens: (canPlay: (slug: string) => boolean) => mockPrefetch(canPlay),
}));

// ---------------------------------------------------------------------------
// Mock yacht storage — no saved game by default
// ---------------------------------------------------------------------------
jest.mock("../../game/yacht/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Mock navigation
// ---------------------------------------------------------------------------
const mockNavigate = jest.fn();

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    dispatch: jest.fn(),
    reset: jest.fn(),
    isFocused: jest.fn().mockReturnValue(true),
    canGoBack: jest.fn().mockReturnValue(false),
    addListener: jest.fn(() => jest.fn()),
    removeListener: jest.fn(),
    setParams: jest.fn(),
    getParent: jest.fn(),
    getState: jest.fn(),
    setOptions: jest.fn(),
    getId: jest.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testInsets = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

async function renderScreen(windowWidth = 390) {
  jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue({
    width: windowWidth,
    height: 844,
    scale: 2,
    fontScale: 1,
  });
  return await render(
    <SafeAreaProvider initialMetrics={testInsets}>
      <ThemeProvider>
        <HomeScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockCanPlay.mockReturnValue(true);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("HomeScreen — game cards", () => {
  it("renders active game cards (Pachisi disabled)", async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();
    expect(getByLabelText("Play Yacht")).toBeTruthy();
    expect(getByLabelText("Play Cascade")).toBeTruthy();
    expect(getByLabelText("Play Blackjack")).toBeTruthy();
    expect(getByLabelText("Play Solitaire")).toBeTruthy();
    expect(getByLabelText("Play Sudoku")).toBeTruthy();
    expect(getByLabelText("Play Sort Puzzle")).toBeTruthy();
    expect(getByLabelText("Play Daily Word")).toBeTruthy();
    // Pachisi is disabled — should not appear
    expect(queryByLabelText("Play Pachisi")).toBeNull();
  });

  it("colours tile icons from the theme so text-presentation glyphs stay visible", async () => {
    // Solitaire's "♠" and FreeCell's "🂡" are not colour emoji; without an explicit
    // colour iOS draws them black, which disappeared on the dark theme.
    const { getByTestId } = await renderScreen();
    for (const slug of ["solitaire", "freecell"]) {
      const style = StyleSheet.flatten(getByTestId(`game-icon-${slug}`).props.style);
      expect(style.color).toBeTruthy();
      expect(style.color).not.toBe("#000");
      expect(style.color).not.toBe("#000000");
      expect(style.color).not.toBe("black");
    }
  });

  describe("store build — premium games hidden (#2390)", () => {
    beforeAll(() => {
      // jest.setup.ts's i18n fixtures omit the mahjong namespace (other suites
      // assert on its raw keys), so load it here to match the card by label.
      i18n.addResourceBundle("en", "mahjong", mahjongEn, true, true);
    });
    afterAll(() => {
      i18n.removeResourceBundle("en", "mahjong");
    });
    beforeEach(() => {
      // Real isGameVisible, answering as a store build (Jest itself is a dev build).
      __forceStoreBuildForTests(true);
    });
    afterEach(() => {
      __forceStoreBuildForTests(false);
    });

    it("renders exactly the six free games", async () => {
      const { getByLabelText, getAllByRole } = await renderScreen();
      expect(getByLabelText("Play Blackjack")).toBeTruthy();
      expect(getByLabelText("Play 2048")).toBeTruthy();
      expect(getByLabelText("Play Solitaire")).toBeTruthy();
      expect(getByLabelText("Play FreeCell")).toBeTruthy();
      expect(getByLabelText("Play Mahjong Solitaire")).toBeTruthy();
      expect(getByLabelText("Play Daily Word")).toBeTruthy();
      expect(
        getAllByRole("button").filter((b) => /^Play /.test(b.props.accessibilityLabel))
      ).toHaveLength(6);
    });

    it("renders none of the six premium games — not even as locked cards", async () => {
      // Unentitled is the realistic store-build state: a locked card would
      // still be a rendered card.
      mockCanPlay.mockReturnValue(false);
      const { queryByLabelText, queryByText } = await renderScreen();
      for (const title of ["Yacht", "Cascade", "Hearts", "Sudoku", "Star Swarm", "Sort Puzzle"]) {
        expect(queryByLabelText(`Play ${title}`)).toBeNull();
        expect(queryByText(title)).toBeNull();
      }
    });

    it("never prefetches a hidden game's chunk, even for an entitled session", async () => {
      await renderScreen();
      await waitFor(() => expect(mockPrefetch).toHaveBeenCalledTimes(1));
      const predicate = mockPrefetch.mock.calls[0][0] as (slug: string) => boolean;
      expect(predicate("yacht")).toBe(false);
      expect(predicate("starswarm")).toBe(false);
    });
  });

  it("navigates to DailyWord when Daily Word card pressed", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Daily Word"));
    expect(mockNavigate).toHaveBeenCalledWith("DailyWord");
  });

  it("navigates to Sort when Sort Puzzle card pressed", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Sort Puzzle"));
    expect(mockNavigate).toHaveBeenCalledWith("Sort");
  });

  it("navigates to Blackjack when Blackjack card pressed", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Blackjack"));
    expect(mockNavigate).toHaveBeenCalledWith("BlackjackBetting");
  });

  it("navigates to Cascade when Cascade card pressed", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Cascade"));
    expect(mockNavigate).toHaveBeenCalledWith("Cascade");
  });

  it("navigates to Solitaire when Solitaire card pressed", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Solitaire"));
    expect(mockNavigate).toHaveBeenCalledWith("Solitaire");
  });

  it("navigates to Sudoku when Sudoku card pressed", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Sudoku"));
    expect(mockNavigate).toHaveBeenCalledWith("Sudoku");
  });

  it("navigates to Game with a new state when Yacht card pressed (no saved game)", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Yacht"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        "Game",
        expect.objectContaining({
          initialState: expect.objectContaining({
            round: 1,
            rolls_used: 0,
            game_over: false,
          }),
        })
      )
    );
  });
});

describe("HomeScreen — AppHeader", () => {
  it("renders AppHeader with app title", async () => {
    const { getByRole } = await renderScreen();
    expect(getByRole("header")).toBeTruthy();
  });
});

describe("HomeScreen — lobby prefetch (issue #706, #1055)", () => {
  it("warms lobby game chunks after interactions settle", async () => {
    await renderScreen();
    await waitFor(() => expect(mockPrefetch).toHaveBeenCalledTimes(1));
  });

  it("passes a predicate backed by canPlay from useEntitlements to prefetchLobbyGameScreens", async () => {
    await renderScreen();
    await waitFor(() => expect(mockPrefetch).toHaveBeenCalledTimes(1));
    const predicate = mockPrefetch.mock.calls[0][0] as (slug: string) => boolean;

    // Jest is a dev build (every game visible — see gameVisibility.test.ts), so
    // the predicate's answer is exactly canPlay's.
    mockCanPlay.mockImplementation((slug: string) => slug !== "cascade");
    expect(predicate("yacht")).toBe(true);
    expect(predicate("cascade")).toBe(false);
    expect(mockCanPlay).toHaveBeenCalledWith("cascade");
  });
});

describe("HomeScreen — responsive layout (Galaxy Fold fix, #356)", () => {
  it("renders all game cards at 280 px viewport width", async () => {
    const { getByLabelText } = await renderScreen(280);
    expect(getByLabelText("Play Yacht")).toBeTruthy();
    expect(getByLabelText("Play Cascade")).toBeTruthy();
    expect(getByLabelText("Play Blackjack")).toBeTruthy();
    expect(getByLabelText("Play 2048")).toBeTruthy();
    expect(getByLabelText("Play Solitaire")).toBeTruthy();
  });

  it("renders all game cards at 360 px viewport width", async () => {
    const { getByLabelText } = await renderScreen(360);
    expect(getByLabelText("Play Yacht")).toBeTruthy();
    expect(getByLabelText("Play Cascade")).toBeTruthy();
    expect(getByLabelText("Play Blackjack")).toBeTruthy();
    expect(getByLabelText("Play 2048")).toBeTruthy();
    expect(getByLabelText("Play Solitaire")).toBeTruthy();
  });
});

describe("HomeScreen — locked game UI (#1054)", () => {
  beforeEach(() => {
    // Cascade is locked, all others entitled
    mockCanPlay.mockImplementation((slug: string) => slug !== "cascade");
  });

  it("renders locked card with 'Coming soon' label for unentitled premium game", async () => {
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText("Cascade — Coming soon")).toBeTruthy();
  });

  it("does not show play label for locked card", async () => {
    const { queryByLabelText } = await renderScreen();
    expect(queryByLabelText("Play Cascade")).toBeNull();
  });

  it("tapping locked card shows coming soon alert, not navigation", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Cascade — Coming soon"));
    expect(Alert.alert).toHaveBeenCalledWith("This game is coming soon");
    expect(mockNavigate).not.toHaveBeenCalledWith("Cascade");
  });

  it("free games render and navigate normally when a premium game is locked", async () => {
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText("Play Blackjack")).toBeTruthy();
    await fireEvent.press(getByLabelText("Play Blackjack"));
    expect(mockNavigate).toHaveBeenCalledWith("BlackjackBetting");
  });

  it("entitled premium games render and navigate normally", async () => {
    // Yacht is entitled (mockCanPlay returns true for non-cascade)
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText("Play Yacht")).toBeTruthy();
  });

  it("all games show play label when all entitled", async () => {
    mockCanPlay.mockReturnValue(true);
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText("Play Yacht")).toBeTruthy();
    expect(getByLabelText("Play Cascade")).toBeTruthy();
    expect(getByLabelText("Play Sudoku")).toBeTruthy();
  });
});
