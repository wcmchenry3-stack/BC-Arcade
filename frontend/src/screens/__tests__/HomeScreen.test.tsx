import { AppState, StyleSheet } from "react-native";
import React from "react";
import { Alert } from "react-native";
import { act, render, fireEvent, waitFor } from "@testing-library/react-native";
import * as ReactNative from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HomeScreen from "../HomeScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { __forceStoreBuildForTests } from "../../entitlements/gameVisibility";
import type { StatsResponse } from "../../api/types";

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
// Mock the stats API — the header's level pill reads /stats/me (#2391)
// ---------------------------------------------------------------------------
const mockGetMyStats = jest.fn() as jest.Mock<Promise<StatsResponse>, []>;
jest.mock("../../api/stats", () => ({
  statsApi: { getMyStats: () => mockGetMyStats() },
}));

function statsAtLevel(level: number, streakDays = 0): StatsResponse {
  return {
    total_games: 0,
    by_game: {},
    favorite_game: null,
    arcade_xp: 0,
    arcade_level: level,
    xp_into_level: 0,
    xp_for_next_level: 100,
    streak_days: streakDays,
  };
}

// The daily-challenge card at the top of Home fetches on mount; it has its own suite.
jest.mock("../../game/daily_challenge/api", () => ({
  dailyChallengeApi: {
    getDailyChallenge: jest.fn().mockResolvedValue({ challengeId: "c1", goals: [] }),
  },
}));

// The pill uploads queued games before asking for the level.
const mockFlush = jest.fn();
jest.mock("../../game/_shared/syncWorker", () => ({
  syncWorker: { flush: () => mockFlush() },
}));

// Connectivity — online by default; tests flip `isOnline`.
const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

// ---------------------------------------------------------------------------
// Mock navigation
// ---------------------------------------------------------------------------
const mockNavigate = jest.fn();
const mockAddListener = jest.fn((_event: string, _cb: () => void) => jest.fn());

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    dispatch: jest.fn(),
    reset: jest.fn(),
    isFocused: jest.fn().mockReturnValue(true),
    canGoBack: jest.fn().mockReturnValue(false),
    addListener: (event: string, cb: () => void) => mockAddListener(event, cb),
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
  mockGetMyStats.mockResolvedValue(statsAtLevel(1));
  mockNetwork.isOnline = true;
  mockFlush.mockResolvedValue({});
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
    beforeEach(() => {
      // Real isGameVisible, answering as a store build (Jest itself is a dev build).
      __forceStoreBuildForTests(true);
    });
    afterEach(() => {
      __forceStoreBuildForTests(false);
    });

    it("renders exactly the seven free games", async () => {
      const { getByLabelText, getAllByRole } = await renderScreen();
      expect(getByLabelText("Play Yacht")).toBeTruthy();
      expect(getByLabelText("Play 2048")).toBeTruthy();
      expect(getByLabelText("Play Solitaire")).toBeTruthy();
      expect(getByLabelText("Play FreeCell")).toBeTruthy();
      expect(getByLabelText("Play Sort Puzzle")).toBeTruthy();
      expect(getByLabelText("Play Sudoku")).toBeTruthy();
      expect(getByLabelText("Play Daily Word")).toBeTruthy();
      expect(
        getAllByRole("button").filter((b) => /^Play /.test(b.props.accessibilityLabel))
      ).toHaveLength(7);
    });

    it("renders none of the five premium games — not even as locked cards", async () => {
      // Unentitled is the realistic store-build state: a locked card would
      // still be a rendered card.
      mockCanPlay.mockReturnValue(false);
      const { queryByLabelText, queryByText } = await renderScreen();
      for (const title of ["Blackjack", "Cascade", "Hearts", "Star Swarm", "Mahjong Solitaire"]) {
        expect(queryByLabelText(`Play ${title}`)).toBeNull();
        expect(queryByText(title)).toBeNull();
      }
    });

    it("never prefetches a hidden game's chunk, even for an entitled session", async () => {
      await renderScreen();
      await waitFor(() => expect(mockPrefetch).toHaveBeenCalledTimes(1));
      const predicate = mockPrefetch.mock.calls[0][0] as (slug: string) => boolean;
      expect(predicate("blackjack")).toBe(false);
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

describe("HomeScreen — resuming a saved Yacht game (#2203)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the jest.mock above
  const storage = require("../../game/yacht/storage") as { loadGame: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- real engine
  const { newGame } = require("../../game/yacht/engine");

  afterEach(() => storage.loadGame.mockResolvedValue(null));

  it("resumes a VS game where only the computer's final turn is left", async () => {
    const human = { ...newGame(), round: 13, game_over: true };
    const ai = { ...newGame(), round: 13, rolls_used: 2 };
    storage.loadGame.mockResolvedValue({ state: human, aiDifficulty: "hard", aiState: ai });

    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Yacht"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Game", {
        initialState: human,
        aiDifficulty: "hard",
        aiState: ai,
      })
    );
  });

  it("passes the finished game's id on for its rank lookup (#2630)", async () => {
    const human = { ...newGame(), round: 13, game_over: true };
    const ai = { ...newGame(), round: 13, rolls_used: 2 };
    storage.loadGame.mockResolvedValue({
      state: human,
      aiDifficulty: "hard",
      aiState: ai,
      finishedGameId: "game-1",
    });

    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Yacht"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        "Game",
        expect.objectContaining({ initialState: human, finishedGameId: "game-1" })
      )
    );
  });

  it("starts a new game once both VS games are over", async () => {
    const over = { ...newGame(), round: 13, game_over: true };
    storage.loadGame.mockResolvedValue({ state: over, aiDifficulty: "hard", aiState: over });

    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Play Yacht"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("Game", {
        initialState: expect.objectContaining({ round: 1, game_over: false }),
      })
    );
  });
});

describe("HomeScreen — AppHeader", () => {
  it("renders AppHeader with app title", async () => {
    const { getByRole } = await renderScreen();
    expect(getByRole("header")).toBeTruthy();
  });
});

describe("HomeScreen — Arcade level pill (#2391)", () => {
  it("shows the player's level in the header", async () => {
    mockGetMyStats.mockResolvedValue(statsAtLevel(4));
    const { findByText, getByLabelText } = await renderScreen();
    expect(await findByText("Lv 4")).toBeTruthy();
    expect(getByLabelText("Arcade level 4")).toBeTruthy();
  });

  it("renders the grid straight away, before /stats/me answers", async () => {
    mockGetMyStats.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText, queryByText } = await renderScreen();
    expect(getByLabelText("Play Daily Word")).toBeTruthy();
    expect(queryByText(/^Lv /)).toBeNull();
  });

  it("omits the pill and still renders every card when /stats/me fails", async () => {
    mockGetMyStats.mockRejectedValue(new Error("500 server error"));
    const { getByLabelText, queryByText, queryByLabelText } = await renderScreen();
    await waitFor(() => expect(mockGetMyStats).toHaveBeenCalledTimes(1));
    expect(queryByText(/^Lv /)).toBeNull();
    expect(queryByLabelText(/^Arcade level/)).toBeNull();
    expect(getByLabelText("Play Daily Word")).toBeTruthy();
    expect(getByLabelText("Play Sudoku")).toBeTruthy();
  });

  it("refetches when Home regains focus, so a level-up shows after a game", async () => {
    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(1));
    const { findByText } = await renderScreen();
    expect(await findByText("Lv 1")).toBeTruthy();

    const focusCalls = mockAddListener.mock.calls.filter(([event]) => event === "focus");
    expect(focusCalls.length).toBeGreaterThan(0);
    const onFocus = focusCalls[focusCalls.length - 1][1];

    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(2));
    await act(async () => {
      onFocus();
    });
    expect(await findByText("Lv 2")).toBeTruthy();
  });

  it("uploads queued games before asking for the level, so a just-finished game counts", async () => {
    const order: string[] = [];
    mockFlush.mockImplementation(async () => {
      order.push("flush");
      return {};
    });
    mockGetMyStats.mockImplementation(async () => {
      order.push("stats");
      return statsAtLevel(2);
    });
    const { findByText } = await renderScreen();
    expect(await findByText("Lv 2")).toBeTruthy();
    expect(order).toEqual(["flush", "stats"]);
  });

  it("still shows the pill when the upload fails", async () => {
    mockFlush.mockRejectedValue(new Error("flush blew up"));
    mockGetMyStats.mockResolvedValue(statsAtLevel(5));
    const { findByText } = await renderScreen();
    expect(await findByText("Lv 5")).toBeTruthy();
  });

  it("does not call /stats/me while the device is known to be offline", async () => {
    mockNetwork.isOnline = false;
    const { getByLabelText, queryByText } = await renderScreen();
    expect(getByLabelText("Play Daily Word")).toBeTruthy();

    const focusCalls = mockAddListener.mock.calls.filter(([event]) => event === "focus");
    await act(async () => {
      focusCalls[focusCalls.length - 1][1]();
    });
    expect(mockGetMyStats).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
    expect(queryByText(/^Lv /)).toBeNull();
  });

  it("keeps the last known level when a refetch fails", async () => {
    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(3));
    const { findByText, getByText } = await renderScreen();
    expect(await findByText("Lv 3")).toBeTruthy();

    const focusCalls = mockAddListener.mock.calls.filter(([event]) => event === "focus");
    const onFocus = focusCalls[focusCalls.length - 1][1];
    mockGetMyStats.mockRejectedValueOnce(new Error("500 server error"));
    await act(async () => {
      onFocus();
    });
    await waitFor(() => expect(mockGetMyStats).toHaveBeenCalledTimes(2));
    expect(getByText("Lv 3")).toBeTruthy();
  });
});

describe("HomeScreen — streak badge (#2457)", () => {
  it("shows the streak next to the level pill, with a plural-aware label", async () => {
    mockGetMyStats.mockResolvedValue(statsAtLevel(4, 5));
    const { findByText, getByLabelText } = await renderScreen();
    expect(await findByText("🔥 5")).toBeTruthy();
    expect(getByLabelText("Current streak: 5 days")).toBeTruthy();
    expect(getByLabelText("Arcade level 4")).toBeTruthy();
  });

  it("uses the singular form for a one-day streak", async () => {
    mockGetMyStats.mockResolvedValue(statsAtLevel(1, 1));
    const { findByLabelText } = await renderScreen();
    expect(await findByLabelText("Current streak: 1 day")).toBeTruthy();
  });

  it("omits the badge for a zero streak, keeping the level pill", async () => {
    mockGetMyStats.mockResolvedValue(statsAtLevel(2, 0));
    const { findByText, queryByText, queryByLabelText } = await renderScreen();
    expect(await findByText("Lv 2")).toBeTruthy();
    expect(queryByText(/🔥/)).toBeNull();
    expect(queryByLabelText(/^Current streak/)).toBeNull();
  });

  it("omits the badge when the server predates the streak (field missing)", async () => {
    const legacy: Partial<StatsResponse> = statsAtLevel(3);
    delete legacy.streak_days;
    mockGetMyStats.mockResolvedValue(legacy as StatsResponse);
    const { findByText, queryByText } = await renderScreen();
    expect(await findByText("Lv 3")).toBeTruthy();
    expect(queryByText(/🔥/)).toBeNull();
  });

  it("omits the badge and still renders every card when /stats/me fails", async () => {
    mockGetMyStats.mockRejectedValue(new Error("500 server error"));
    const { getByLabelText, queryByText, queryByLabelText } = await renderScreen();
    await waitFor(() => expect(mockGetMyStats).toHaveBeenCalledTimes(1));
    expect(queryByText(/🔥/)).toBeNull();
    expect(queryByLabelText(/^Current streak/)).toBeNull();
    expect(getByLabelText("Play Daily Word")).toBeTruthy();
  });

  it("renders no badge before /stats/me answers", async () => {
    mockGetMyStats.mockImplementation(() => new Promise(() => {}));
    const { getByLabelText, queryByText } = await renderScreen();
    expect(getByLabelText("Play Daily Word")).toBeTruthy();
    expect(queryByText(/🔥/)).toBeNull();
  });

  it("updates on focus, and drops the badge when the streak resets", async () => {
    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(1, 3));
    const { findByText, queryByText } = await renderScreen();
    expect(await findByText("🔥 3")).toBeTruthy();

    const focusCalls = mockAddListener.mock.calls.filter(([event]) => event === "focus");
    const onFocus = focusCalls[focusCalls.length - 1][1];

    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(1, 4));
    await act(async () => {
      onFocus();
    });
    expect(await findByText("🔥 4")).toBeTruthy();

    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(1, 0));
    await act(async () => {
      onFocus();
    });
    await waitFor(() => expect(queryByText(/🔥/)).toBeNull());
  });

  it("keeps the last known streak when a refetch fails", async () => {
    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(1, 6));
    const { findByText, getByText } = await renderScreen();
    expect(await findByText("🔥 6")).toBeTruthy();

    const focusCalls = mockAddListener.mock.calls.filter(([event]) => event === "focus");
    const onFocus = focusCalls[focusCalls.length - 1][1];
    mockGetMyStats.mockRejectedValueOnce(new Error("500 server error"));
    await act(async () => {
      onFocus();
    });
    await waitFor(() => expect(mockGetMyStats).toHaveBeenCalledTimes(2));
    expect(getByText("🔥 6")).toBeTruthy();
  });

  it("refetches when the app returns to the foreground, so a lapsed streak clears overnight", async () => {
    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(1, 5));
    const { findByText, queryByText } = await renderScreen();
    expect(await findByText("🔥 5")).toBeTruthy();

    // RN's jest preset already makes AppState.addEventListener a jest.fn: read the
    // callbacks it recorded (Home's and the daily-challenge card's) instead of replacing it.
    const emit = async (state: string) =>
      act(async () => {
        (AppState.addEventListener as jest.Mock).mock.calls
          .filter(([event]) => event === "change")
          .forEach(([, cb]) => cb(state));
      });

    mockGetMyStats.mockResolvedValueOnce(statsAtLevel(1, 0));
    await emit("background");
    expect(mockGetMyStats).toHaveBeenCalledTimes(1);

    await emit("active");
    await waitFor(() => expect(queryByText(/🔥/)).toBeNull());
    expect(mockGetMyStats).toHaveBeenCalledTimes(2);
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
    expect(getByLabelText("Play Yacht")).toBeTruthy();
    await fireEvent.press(getByLabelText("Play Yacht"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("Game", expect.any(Object)));
  });

  it("entitled premium games render and navigate normally", async () => {
    // Hearts is entitled (mockCanPlay returns true for non-cascade)
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText("Play Hearts")).toBeTruthy();
  });

  it("all games show play label when all entitled", async () => {
    mockCanPlay.mockReturnValue(true);
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText("Play Yacht")).toBeTruthy();
    expect(getByLabelText("Play Cascade")).toBeTruthy();
    expect(getByLabelText("Play Sudoku")).toBeTruthy();
  });
});
