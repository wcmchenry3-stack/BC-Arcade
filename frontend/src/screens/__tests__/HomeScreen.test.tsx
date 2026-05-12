import React from "react";
import { Alert } from "react-native";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HomeScreen from "../HomeScreen";
import { ThemeProvider } from "../../theme/ThemeContext";

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

function renderScreen(windowWidth = 390) {
  jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue({
    width: windowWidth,
    height: 844,
    scale: 2,
    fontScale: 1,
  });
  return render(
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
  it("renders active game cards (Pachisi disabled)", () => {
    const { getByLabelText, queryByLabelText } = renderScreen();
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

  it("navigates to DailyWord when Daily Word card pressed", () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText("Play Daily Word"));
    expect(mockNavigate).toHaveBeenCalledWith("DailyWord");
  });

  it("navigates to Sort when Sort Puzzle card pressed", () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText("Play Sort Puzzle"));
    expect(mockNavigate).toHaveBeenCalledWith("Sort");
  });

  it("navigates to Blackjack when Blackjack card pressed", () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText("Play Blackjack"));
    expect(mockNavigate).toHaveBeenCalledWith("BlackjackBetting");
  });

  it("navigates to Cascade when Cascade card pressed", () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText("Play Cascade"));
    expect(mockNavigate).toHaveBeenCalledWith("Cascade");
  });

  it("navigates to Solitaire when Solitaire card pressed", () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText("Play Solitaire"));
    expect(mockNavigate).toHaveBeenCalledWith("Solitaire");
  });

  it("navigates to Sudoku when Sudoku card pressed", () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText("Play Sudoku"));
    expect(mockNavigate).toHaveBeenCalledWith("Sudoku");
  });

  it("navigates to Game with a new state when Yacht card pressed (no saved game)", async () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText("Play Yacht"));
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
  it("renders AppHeader with app title", () => {
    const { getByRole } = renderScreen();
    expect(getByRole("header")).toBeTruthy();
  });
});

describe("HomeScreen — lobby prefetch (issue #706, #1055)", () => {
  it("warms lobby game chunks after interactions settle", async () => {
    renderScreen();
    await waitFor(() => expect(mockPrefetch).toHaveBeenCalledTimes(1));
  });

  it("passes canPlay from useEntitlements to prefetchLobbyGameScreens", async () => {
    renderScreen();
    await waitFor(() => expect(mockPrefetch).toHaveBeenCalledWith(mockCanPlay));
  });
});

describe("HomeScreen — responsive layout (Galaxy Fold fix, #356)", () => {
  it("renders all game cards at 280 px viewport width", () => {
    const { getByLabelText } = renderScreen(280);
    expect(getByLabelText("Play Yacht")).toBeTruthy();
    expect(getByLabelText("Play Cascade")).toBeTruthy();
    expect(getByLabelText("Play Blackjack")).toBeTruthy();
    expect(getByLabelText("Play 2048")).toBeTruthy();
    expect(getByLabelText("Play Solitaire")).toBeTruthy();
  });

  it("renders all game cards at 360 px viewport width", () => {
    const { getByLabelText } = renderScreen(360);
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

  it("renders locked card with 'Coming soon' label for unentitled premium game", () => {
    const { getByLabelText } = renderScreen();
    expect(getByLabelText("Cascade — Coming soon")).toBeTruthy();
  });

  it("does not show play label for locked card", () => {
    const { queryByLabelText } = renderScreen();
    expect(queryByLabelText("Play Cascade")).toBeNull();
  });

  it("tapping locked card shows coming soon alert, not navigation", () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText("Cascade — Coming soon"));
    expect(Alert.alert).toHaveBeenCalledWith("This game is coming soon");
    expect(mockNavigate).not.toHaveBeenCalledWith("Cascade");
  });

  it("free games render and navigate normally when a premium game is locked", () => {
    const { getByLabelText } = renderScreen();
    expect(getByLabelText("Play Blackjack")).toBeTruthy();
    fireEvent.press(getByLabelText("Play Blackjack"));
    expect(mockNavigate).toHaveBeenCalledWith("BlackjackBetting");
  });

  it("entitled premium games render and navigate normally", () => {
    // Yacht is entitled (mockCanPlay returns true for non-cascade)
    const { getByLabelText } = renderScreen();
    expect(getByLabelText("Play Yacht")).toBeTruthy();
  });

  it("all games show play label when all entitled", () => {
    mockCanPlay.mockReturnValue(true);
    const { getByLabelText } = renderScreen();
    expect(getByLabelText("Play Yacht")).toBeTruthy();
    expect(getByLabelText("Play Cascade")).toBeTruthy();
    expect(getByLabelText("Play Sudoku")).toBeTruthy();
  });
});
