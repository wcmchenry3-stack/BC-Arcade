import { AccessibilityInfo, AppState, Platform, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import React from "react";
import { Alert } from "react-native";
import { act, render, renderHook, fireEvent, waitFor, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HomeScreen from "../HomeScreen";
import { ThemeProvider, dark } from "../../theme/ThemeContext";
import { __forceStoreBuildForTests } from "../../entitlements/gameVisibility";
import type { StatsResponse } from "../../api/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearMyStatsCache, useMyStats } from "../../hooks/useMyStats";
import i18n from "../../i18n/i18n";
import { LOBBY_MAX_FONT_SCALE, lobbyTileTextSizing } from "../../components/home/lobbyColumns";
import type { TileStatus } from "../../game/_shared/lobbyStatus";
import { __resetPersonalBestForTests, recordResult } from "../../game/_shared/personalBest";
import { newGame as newTwenty48 } from "../../game/twenty48/engine";
import { saveGame as saveTwenty48 } from "../../game/twenty48/storage";
import { SORT_CATALOG_VERSION } from "../../game/sort/catalog";
import { dealGame as dealFreeCell } from "../../game/freecell/engine";
import { saveGame as saveFreeCell } from "../../game/freecell/storage";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light" },
}));

// Render gradients as a host element so tests can read their colours and style (#4005).
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

// The window the screen sees. react-native's useWindowDimensions reads this module; a
// jest.spyOn on the `react-native` namespace never reached HomeScreen (width stayed at
// jest's 750 default), so the width-based tests were not exercising their widths (#4005).
const mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// ---------------------------------------------------------------------------
// Mock entitlements — default: all games entitled (canPlay always true)
// ---------------------------------------------------------------------------
const mockCanPlay = jest.fn().mockReturnValue(true);

jest.mock("../../entitlements/EntitlementContext", () => ({
  ...jest.requireActual("../../entitlements/EntitlementContext"),
  useEntitlementGate: () => ({
    canPlay: mockCanPlay,
    isLoading: false,
    lastRefreshed: null,
  }),
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
jest.mock("../../api/stats", () =>
  mockScreenDeps().mockStatsApi({ getMyStats: () => mockGetMyStats() })
);

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

// Home warms today's Daily Word metadata (#2925); its own suite covers the cache.
const mockWarmTodayMeta = jest.fn().mockResolvedValue(undefined);
jest.mock("../../game/daily_word/todayMeta", () => ({
  warmTodayMeta: () => mockWarmTodayMeta(),
}));

// The tile statuses (#4008) are read from local storage by the real hook. The status-display tests
// set `mockTileStatuses` to put exact statuses on tiles instead; unset (the default), the real
// hook and readers run.
let mockTileStatuses: Record<string, TileStatus | undefined> | null = null;
jest.mock("../../hooks/useLobbyTileStatus", () => {
  const actual = jest.requireActual("../../hooks/useLobbyTileStatus");
  return {
    ...actual,
    useLobbyTileStatus: (...args: unknown[]) =>
      mockTileStatuses ?? actual.useLobbyTileStatus(...args),
  };
});

// Connectivity — online by default; tests flip `isOnline`.
const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../../game/_shared/NetworkContext", () =>
  mockScreenDeps().mockNetwork({ state: () => mockNetwork })
);

// ---------------------------------------------------------------------------
// Mock navigation
// ---------------------------------------------------------------------------
const mockNavigate = jest.fn();
const mockAddListener = jest.fn((_event: string, _cb: () => void) => jest.fn());

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
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
    { actual: true }
  )
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testInsets = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

async function renderScreen(windowWidth = 390) {
  mockWindow.width = windowWidth;
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

beforeEach(async () => {
  jest.clearAllMocks();
  // The last-known streak (#3226) persists; start each test without one.
  await AsyncStorage.clear();
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

  describe("Star Swarm tile icon (#3599)", () => {
    it("shows the generated scene at cardArt (64 pt) instead of the 👾 emoji (#4013)", async () => {
      const { getByTestId, queryByText } = await renderScreen();
      const icon = getByTestId("game-icon-starswarm");
      expect(icon.type).not.toBe("Text");
      expect(icon.props.source).toBeTruthy();
      const style = StyleSheet.flatten(icon.props.style);
      expect([style.width, style.height]).toEqual([64, 64]); // fits the 68 pt icon zone
      expect(queryByText("👾")).toBeNull();
    });

    it("keeps the tile's accessibility label and hint, and hides the image from readers", async () => {
      const { getByTestId } = await renderScreen();
      const tile = getByTestId("game-tile-starswarm");
      expect(tile.props.accessibilityLabel).toBe("Play Star Swarm");
      expect(tile.props.accessibilityHint).toBeTruthy();
      expect(getByTestId("game-icon-starswarm").props.accessible).toBe(false);
    });

    it("labels a locked Star Swarm tile as before", async () => {
      mockCanPlay.mockReturnValue(false);
      const { getByTestId } = await renderScreen();
      expect(getByTestId("game-tile-starswarm").props.accessibilityLabel).toMatch(/Star Swarm/);
      expect(getByTestId("game-icon-starswarm").props.source).toBeTruthy();
    });
  });

  describe("gameplay tile art (#4011)", () => {
    const ART: Record<string, { label: string; emoji: string }> = {
      yacht: { label: "Play Yacht", emoji: "🎲" },
      twenty48: { label: "Play 2048", emoji: "🔢" },
      sudoku: { label: "Play Sudoku", emoji: "🧩" },
      sort: { label: "Play Sort Puzzle", emoji: "🍾" },
    };

    it("draws Yacht, 2048, Sudoku and Sort as a 64 pt image, not the emoji", async () => {
      const { getByTestId, queryByText } = await renderScreen();
      for (const [slug, { emoji }] of Object.entries(ART)) {
        const icon = getByTestId(`game-icon-${slug}`);
        expect(icon.type).not.toBe("Text");
        expect(icon.props.source).toBeTruthy();
        expect(icon.props.resizeMode).toBe("contain");
        const style = StyleSheet.flatten(icon.props.style);
        expect([style.width, style.height]).toEqual([64, 64]);
        expect(queryByText(emoji)).toBeNull();
      }
      // Each tile has its own picture.
      const sources = Object.keys(ART).map((slug) => getByTestId(`game-icon-${slug}`).props.source);
      expect(new Set(sources.map((s) => JSON.stringify(s))).size).toBe(4);
    });

    it("keeps the tiles' labels and hides the images from screen readers", async () => {
      const { getByTestId } = await renderScreen();
      for (const [slug, { label }] of Object.entries(ART)) {
        expect(getByTestId(`game-tile-${slug}`).props.accessibilityLabel).toBe(label);
        expect(getByTestId(`game-icon-${slug}`).props.accessible).toBe(false);
      }
    });
  });

  describe("gameplay tile art, batch 2 (#4012)", () => {
    const ART: Record<string, { label: string; emoji: string }> = {
      solitaire: { label: "Play Solitaire", emoji: "♠" },
      freecell: { label: "Play FreeCell", emoji: "🂡" },
      daily_word: { label: "Play Daily Word", emoji: "📝" },
    };

    it("draws Solitaire, FreeCell and Daily Word as a 64 pt image, not the glyph or emoji", async () => {
      const { getByTestId, queryByText } = await renderScreen();
      for (const [slug, { emoji }] of Object.entries(ART)) {
        const icon = getByTestId(`game-icon-${slug}`);
        expect(icon.type).not.toBe("Text");
        expect(icon.props.children).toBeUndefined();
        expect(icon.props.source).toBeTruthy();
        expect(icon.props.resizeMode).toBe("contain");
        const style = StyleSheet.flatten(icon.props.style);
        expect([style.width, style.height]).toEqual([64, 64]);
        expect(queryByText(emoji)).toBeNull();
      }
    });

    it("gives every art tile its own picture", async () => {
      const { getByTestId } = await renderScreen();
      const slugs = ["yacht", "twenty48", "sudoku", "sort", ...Object.keys(ART)];
      const sources = slugs.map((slug) => getByTestId(`game-icon-${slug}`).props.source);
      expect(new Set(sources.map((s) => JSON.stringify(s))).size).toBe(slugs.length);
    });

    it("keeps the tiles' labels and hides the images from screen readers", async () => {
      const { getByTestId } = await renderScreen();
      for (const [slug, { label }] of Object.entries(ART)) {
        expect(getByTestId(`game-tile-${slug}`).props.accessibilityLabel).toBe(label);
        expect(getByTestId(`game-icon-${slug}`).props.accessible).toBe(false);
      }
    });
  });

  describe("hidden games' tile art (#4013)", () => {
    const ART: Record<string, { label: string; emoji: string }> = {
      blackjack: { label: "Play Blackjack", emoji: "🃏" },
      hearts: { label: "Play Hearts", emoji: "♥" },
      mahjong: { label: "Play Mahjong Solitaire", emoji: "🀄" },
      starswarm: { label: "Play Star Swarm", emoji: "👾" },
      cascade: { label: "Play Cascade", emoji: "🍉" },
    };

    it("a dev build draws all five as a 64 pt image, not the emoji or glyph", async () => {
      const { getByTestId, queryByText } = await renderScreen();
      for (const [slug, { emoji }] of Object.entries(ART)) {
        const icon = getByTestId(`game-icon-${slug}`);
        expect(icon.type).not.toBe("Text");
        expect(icon.props.children).toBeUndefined();
        expect(icon.props.source).toBeTruthy();
        expect(icon.props.resizeMode).toBe("contain");
        const style = StyleSheet.flatten(icon.props.style);
        expect([style.width, style.height]).toEqual([64, 64]);
        expect(queryByText(emoji)).toBeNull();
      }
    });

    it("Cascade's tile is the image, not the Skia-drawn CascadeTileIcon", async () => {
      const { getByTestId, queryByTestId } = await renderScreen();
      expect(queryByTestId("game-art-cascade")).toBeNull();
      expect(getByTestId("game-icon-cascade").props.source).toBeTruthy();
    });

    it("keeps the labels and hides the images from screen readers", async () => {
      const { getByTestId } = await renderScreen();
      for (const [slug, { label }] of Object.entries(ART)) {
        expect(getByTestId(`game-tile-${slug}`).props.accessibilityLabel).toBe(label);
        expect(getByTestId(`game-icon-${slug}`).props.accessible).toBe(false);
      }
    });

    it("every tile in the lobby shows its own picture and no tile shows an emoji or glyph", async () => {
      const { getAllByTestId } = await renderScreen();
      const icons = getAllByTestId(/^game-icon-/);
      expect(icons).toHaveLength(12);
      for (const icon of icons) {
        expect(icon.type).not.toBe("Text");
        expect(icon.props.source).toBeTruthy();
      }
      const sources = icons.map((icon) => JSON.stringify(icon.props.source));
      expect(new Set(sources).size).toBe(icons.length);
    });
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
  it("remembers /stats/me for the stats screen opened offline later (#2635)", async () => {
    clearMyStatsCache();
    await AsyncStorage.setItem("game_session_id", "session-a");
    mockGetMyStats.mockResolvedValue(statsAtLevel(4));
    const { findByText, unmount } = await renderScreen();
    await findByText("Lv 4");
    await unmount();

    mockNetwork.isOnline = false;
    const { result } = await renderHook(() => useMyStats());
    await act(async () => {});
    expect(result.current.status).toBe("ready");
    expect(result.current.stats?.arcade_level).toBe(4);
    expect(result.current.stale).toBe(true);
  });

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

  it("warms Daily Word's cache once on mount while online, not on focus (#2925)", async () => {
    await renderScreen();
    expect(mockWarmTodayMeta).toHaveBeenCalledTimes(1);

    const focusCalls = mockAddListener.mock.calls.filter(([event]) => event === "focus");
    await act(async () => {
      focusCalls[focusCalls.length - 1][1]();
    });
    expect(mockWarmTodayMeta).toHaveBeenCalledTimes(1);
  });

  it("does not warm Daily Word's cache while offline (#2925)", async () => {
    mockNetwork.isOnline = false;
    await renderScreen();
    expect(mockWarmTodayMeta).not.toHaveBeenCalled();
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

  it("shows the remembered streak while offline, without calling /stats/me (#3226)", async () => {
    await AsyncStorage.setItem("last_known_streak_v1", "6");
    mockNetwork.isOnline = false;
    const { findByText } = await renderScreen();
    expect(await findByText("🔥 6")).toBeTruthy();
    expect(mockGetMyStats).not.toHaveBeenCalled();
  });

  it("replaces the remembered streak with the server's and saves it (#3226)", async () => {
    await AsyncStorage.setItem("last_known_streak_v1", "6");
    mockGetMyStats.mockResolvedValue(statsAtLevel(2, 9));
    const { findByText, queryByText } = await renderScreen();
    expect(await findByText("🔥 9")).toBeTruthy();
    expect(queryByText("🔥 6")).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem("last_known_streak_v1")).toBe("9"));
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

  it("renders locked card with 'Locked' label for unentitled premium game", async () => {
    const { getByLabelText } = await renderScreen();
    expect(getByLabelText("Cascade — Locked, tap to unlock")).toBeTruthy();
  });

  it("does not show play label for locked card", async () => {
    const { queryByLabelText } = await renderScreen();
    expect(queryByLabelText("Play Cascade")).toBeNull();
  });

  it("tapping locked card opens the paywall modal for that game, not the game (#841)", async () => {
    const { getByLabelText } = await renderScreen();
    await fireEvent.press(getByLabelText("Cascade — Locked, tap to unlock"));
    expect(mockNavigate).toHaveBeenCalledWith("Paywall", { gameSlug: "cascade" });
    expect(mockNavigate).not.toHaveBeenCalledWith("Cascade");
    expect(Alert.alert).not.toHaveBeenCalled();
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

describe("HomeScreen — equal tiles, spacers and columns (#4005)", () => {
  afterEach(() => {
    __forceStoreBuildForTests(false);
  });

  const hidden = { includeHiddenElements: true };

  it("pads a one-tile last row with a spacer at 2 columns (7 store games)", async () => {
    __forceStoreBuildForTests(true);
    const { getAllByTestId } = await renderScreen(390);
    const spacers = getAllByTestId("lobby-spacer", hidden);
    expect(spacers).toHaveLength(1);
    const spacer = spacers[0] as unknown as {
      props: Record<string, unknown>;
      parent: { children: { props: { testID?: string } }[] };
    };
    expect(spacer.props.accessible).toBe(false);
    expect(spacer.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(spacer.props.accessibilityElementsHidden).toBe(true);
    expect(spacer.props.pointerEvents).toBe("none");
    // Its row holds one real tile plus the spacer.
    const kids = spacer.parent.children;
    expect(kids).toHaveLength(2);
  });

  it("gives every tile the column width: the spacer uses the same wrapper style", async () => {
    __forceStoreBuildForTests(true);
    const { getAllByTestId, getByTestId } = await renderScreen(390);
    const spacer = getAllByTestId("lobby-spacer", hidden)[0];
    const tileWrapper = getByTestId("game-tile-daily_word").parent;
    expect(StyleSheet.flatten(spacer.props.style)).toEqual(expect.objectContaining({ flex: 1 }));
    expect(StyleSheet.flatten(tileWrapper?.props.style)).toEqual(
      expect.objectContaining({ flex: 1 })
    );
  });

  it("pads with two spacers at 3 columns (7 games)", async () => {
    __forceStoreBuildForTests(true);
    const { getAllByTestId } = await renderScreen(834);
    expect(getAllByTestId("lobby-spacer", hidden)).toHaveLength(2);
  });

  it("pads with one spacer at 4 columns (7 games)", async () => {
    __forceStoreBuildForTests(true);
    const { getAllByTestId } = await renderScreen(1024);
    expect(getAllByTestId("lobby-spacer", hidden)).toHaveLength(1);
  });

  it("renders no spacer when the grid is full (12 games at 4 columns)", async () => {
    const { queryAllByTestId, getAllByTestId } = await renderScreen(1024);
    expect(getAllByTestId(/^game-tile-/)).toHaveLength(12);
    expect(queryAllByTestId("lobby-spacer", hidden)).toHaveLength(0);
  });

  it("renders no spacer in the single-column path", async () => {
    __forceStoreBuildForTests(true);
    const { queryAllByTestId } = await renderScreen(320);
    expect(queryAllByTestId("lobby-spacer", hidden)).toHaveLength(0);
  });

  it("spacers carry no game-tile testID and are not buttons", async () => {
    __forceStoreBuildForTests(true);
    const { getAllByTestId, getAllByRole } = await renderScreen(390);
    expect(getAllByTestId(/^game-tile-/)).toHaveLength(7);
    expect(
      getAllByRole("button").filter((b) => /^Play /.test(b.props.accessibilityLabel))
    ).toHaveLength(7);
  });

  it("a tile's gradient belongs to its game, not to its position (#4007)", async () => {
    __forceStoreBuildForTests(true);
    const { toJSON } = await renderScreen(390);
    // The Play button of each tile wears the same gradient as its top border.
    type Json = {
      type: string;
      props: { colors?: string[]; testID?: string };
      children?: (Json | string)[] | null;
    };
    const grads: Record<string, string[]> = {};
    const walk = (n: Json | string | null | (Json | string)[]) => {
      if (n == null || typeof n === "string") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.type === "LinearGradient" && n.props.testID?.startsWith("game-btn-"))
        grads[n.props.testID.slice("game-btn-".length)] = n.props.colors as string[];
      n.children?.forEach(walk);
    };
    walk(toJSON() as Json | Json[] | null);
    expect(Object.keys(grads)).toHaveLength(7);
    // Sudoku and Sort sit 6th and 7th here; they keep their own pair, not the 2nd and 3rd of
    // the old 4-colour cycle.
    expect(grads.sudoku).toEqual([dark.tertiary, dark.secondary]);
    expect(grads.yacht).toEqual([dark.secondary, dark.accent]);
    expect(grads.solitaire).toEqual([dark.accent, dark.accentBright]);
    expect(grads.sort).toEqual([dark.accentBright, dark.tertiary]);
  });

  it("every game keeps the same stops in the store build and in the all-games build (#4007)", async () => {
    type Json = {
      type: string;
      props: { colors?: string[]; testID?: string };
      children?: (Json | string)[] | null;
    };
    const stopsBySlug = async (store: boolean) => {
      __forceStoreBuildForTests(store);
      const { toJSON, unmount } = await renderScreen(390);
      const out: Record<string, string[]> = {};
      const walk = (n: Json | string | null | (Json | string)[]) => {
        if (n == null || typeof n === "string") return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n.type === "LinearGradient" && n.props.testID?.startsWith("game-btn-"))
          out[n.props.testID.slice("game-btn-".length)] = n.props.colors as string[];
        n.children?.forEach(walk);
      };
      walk(toJSON() as Json | Json[] | null);
      await unmount();
      return out;
    };
    const store = await stopsBySlug(true);
    const all = await stopsBySlug(false);
    expect(Object.keys(store)).toHaveLength(7);
    expect(Object.keys(all)).toHaveLength(12);
    for (const slug of Object.keys(store)) expect(all[slug]).toEqual(store[slug]);
  });

  it("locked and unlocked play buttons resolve to the same border width and padding", async () => {
    mockCanPlay.mockImplementation((slug: string) => slug !== "cascade");
    const { getByTestId } = await renderScreen(390);
    const locked = StyleSheet.flatten(getByTestId("game-btn-cascade").props.style);
    const unlocked = StyleSheet.flatten(getByTestId("game-btn-yacht").props.style);
    expect(locked.borderWidth).toBe(1);
    expect(unlocked.borderWidth).toBe(1);
    expect(unlocked.borderColor).toBe("transparent");
    expect(locked.paddingVertical).toBe(unlocked.paddingVertical);
  });

  it("compacts the icon zone to TILE_ICON_ZONE (68) around the 64 pt art", async () => {
    const { getByTestId } = await renderScreen(390);
    // Every tile is art since #4013, so the zone is checked around Hearts' scene.
    const icon = getByTestId("game-icon-hearts");
    const art = StyleSheet.flatten(icon.props.style);
    expect([art.width, art.height]).toEqual([64, 64]);
    const zone = icon.parent;
    expect(StyleSheet.flatten(zone?.props.style).height).toBe(68);
  });

  it("keeps the Star Swarm image inside the icon zone", async () => {
    const { getByTestId } = await renderScreen(390);
    const style = StyleSheet.flatten(getByTestId("game-icon-starswarm").props.style);
    expect(style.height).toBeLessThanOrEqual(68);
  });

  it("uses 3 columns at 834 pt: first row holds three tiles", async () => {
    const { getByTestId } = await renderScreen(834);
    expect(getByTestId("game-tile-yacht").parent?.parent?.children).toHaveLength(3);
  });

  it("reserves the same title and description room on every tile, in scalable minimums (#431, #4006)", async () => {
    const { getByText } = await renderScreen(390);
    const short = getByText("Guess the five-letter word in six tries.");
    const long = getByText("Pour colors bottle to bottle — sort them all to win.");
    const flat = [short, long].map((el) => StyleSheet.flatten(el.props.style));
    // 16 pt line height x 3 lines at the default font scale.
    expect(flat[0].minHeight).toBe(flat[1].minHeight);
    expect(flat[0].minHeight).toBe(48);
    for (const el of [short, long]) expect(el.props.numberOfLines).toBe(3);
  });
});

describe("HomeScreen — tile type (#4006)", () => {
  /** A tile's title, description and button label, in that order. */
  function tileTexts(r: Awaited<ReturnType<typeof renderScreen>>, slug: string, button: string) {
    const tile = within(r.getByTestId(`game-tile-${slug}`));
    return [
      tile.getByText(i18n.t(`${slug}:game.title`)),
      tile.getByText(i18n.t(`${slug}:game.description`)),
      tile.getByText(button),
    ];
  }

  beforeEach(() => {
    mockWindow.fontScale = 1;
  });
  afterEach(() => {
    mockWindow.fontScale = 1;
  });

  it("sets the description to 12 pt, the button label to 13 pt, and nothing in a tile below 11 pt", async () => {
    const r = await renderScreen(390);
    const desc = StyleSheet.flatten(
      r.getByText("Guess the five-letter word in six tries.").props.style
    );
    expect(desc.fontSize).toBe(12);
    expect(desc.lineHeight).toBe(16);
    const title = StyleSheet.flatten(r.getByText("Yacht").props.style);
    expect([title.fontSize, title.lineHeight]).toEqual([16, 20]);
    const btn = StyleSheet.flatten(r.getAllByText("Play")[0].props.style);
    expect(btn.fontSize).toBe(13);
    expect(btn.textTransform).toBeUndefined();
    expect(btn.letterSpacing).toBe(0.2);
    for (const slug of ["yacht", "sort", "daily_word"]) {
      for (const el of tileTexts(r, slug, "Play")) {
        expect(StyleSheet.flatten(el.props.style).fontSize).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it("caps every tile text at LOBBY_MAX_FONT_SCALE", async () => {
    mockCanPlay.mockImplementation((slug: string) => slug !== "cascade");
    const r = await renderScreen(390);
    expect(LOBBY_MAX_FONT_SCALE).toBe(1.5);
    for (const [slug, button] of [
      ["yacht", "Play"],
      ["cascade", "Unlock"],
    ]) {
      for (const el of tileTexts(r, slug, button)) {
        expect(el.props.maxFontSizeMultiplier).toBe(LOBBY_MAX_FONT_SCALE);
      }
    }
  });

  it("gives title and description no fixed height", async () => {
    const r = await renderScreen(390);
    for (const el of [
      r.getByText("Yacht"),
      r.getByText("Guess the five-letter word in six tries."),
    ]) {
      expect(StyleSheet.flatten(el.props.style).height).toBeUndefined();
    }
  });

  it("shows the short Play label as button text with the game's playLabel as accessibility label", async () => {
    mockCanPlay.mockImplementation((slug: string) => slug !== "cascade");
    const r = await renderScreen(390);
    expect(r.getByTestId("game-tile-yacht").props.accessibilityLabel).toBe("Play Yacht");
    expect(within(r.getByTestId("game-btn-yacht")).getByText("Play")).toBeTruthy();
    expect(r.queryByText("Play Yacht")).toBeNull();
    // Locked tiles keep Unlock and their card label.
    expect(within(r.getByTestId("game-btn-cascade")).getByText("Unlock")).toBeTruthy();
    expect(r.getByTestId("game-tile-cascade").props.accessibilityLabel).toBe(
      i18n.t("common:home.locked.cardLabel", { title: "Cascade" })
    );
  });

  it("keys play labels by slug: two tiles with the same translated title keep their own labels", async () => {
    i18n.addResource("en", "sort", "game.title", "Daily Word");
    try {
      const r = await renderScreen(390);
      expect(r.getByTestId("game-tile-sort").props.accessibilityLabel).toBe("Play Sort Puzzle");
      expect(r.getByTestId("game-tile-daily_word").props.accessibilityLabel).toBe(
        "Play Daily Word"
      );
    } finally {
      i18n.addResource("en", "sort", "game.title", "Sort Puzzle");
    }
  });

  it.each([
    // [system font scale, title lines, title min height, description lines, description min height]
    [1, 1, 20, 3, 48],
    // At 1.5x the title may wrap to two lines and descriptions reserve five lines.
    [1.5, 2, 60, 5, 120],
    // The cap holds: a 3x system scale reserves no more than 1.5x.
    [3, 2, 60, 5, 120],
  ])(
    "reserves title and description room that grows with font scale %s, up to the cap",
    async (fontScale, titleLines, titleMin, descLines, descMin) => {
      mockWindow.fontScale = fontScale;
      const r = await renderScreen(390);
      const t = r.getByText("Yacht");
      const d = r.getByText("Guess the five-letter word in six tries.");
      expect(t.props.numberOfLines).toBe(titleLines);
      expect(d.props.numberOfLines).toBe(descLines);
      expect(StyleSheet.flatten(t.props.style).minHeight).toBe(titleMin);
      expect(StyleSheet.flatten(d.props.style).minHeight).toBe(descMin);
    }
  );

  it("rounds reserved heights up to whole points", () => {
    const s = lobbyTileTextSizing(1.15);
    expect(Number.isInteger(s.titleMinHeight)).toBe(true);
    expect(s.descriptionMinHeight).toBe(Math.ceil(16 * 5 * 1.15));
  });
});

describe("HomeScreen — tile status from local data (#4008)", () => {
  const TWENTY48_DESC = "Slide and merge tiles to reach 2048.";

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  beforeEach(() => {
    mockTileStatuses = null;
    __resetPersonalBestForTests();
  });
  afterEach(() => {
    mockTileStatuses = null;
    mockWindow.fontScale = 1;
    __forceStoreBuildForTests(false);
  });

  it("shows Resume for a saved game: the button, the label, the status in place of the description", async () => {
    await saveTwenty48({ ...newTwenty48(), score: 44 });
    const r = await renderScreen();
    // Screen readers hear the status in the label, which still starts with the Play label.
    const tile = await r.findByLabelText("Play 2048 — in progress, tap to resume");
    expect(r.getByTestId("game-status-twenty48").props.children).toBe("In progress");
    expect(r.queryByText(TWENTY48_DESC)).toBeNull();
    expect(within(r.getByTestId("game-btn-twenty48")).getByText("Resume")).toBeTruthy();

    // Tapping opens the game, which restores the save exactly as it always did.
    fireEvent.press(tile);
    expect(mockNavigate).toHaveBeenCalledWith("Twenty48");
  });

  it("shows Resume for a Sort save, and a tap opens Sort on that level (not the level grid)", async () => {
    await AsyncStorage.setItem("@sort/catalog_version", String(SORT_CATALOG_VERSION));
    await AsyncStorage.setItem(
      "@sort/progress",
      JSON.stringify({
        unlockedLevel: 3,
        currentLevelId: 3,
        currentState: {
          bottles: [["red", "blue"], ["blue", "red"], []],
          moveCount: 2,
          undosUsed: 0,
          isComplete: false,
          selectedBottleIndex: null,
        },
      })
    );
    const r = await renderScreen();
    const tile = await r.findByLabelText("Play Sort Puzzle — in progress, tap to resume");
    expect(r.getByTestId("game-status-sort").props.children).toBe("In progress");
    expect(within(r.getByTestId("game-btn-sort")).getByText("Resume")).toBeTruthy();

    fireEvent.press(tile);
    expect(mockNavigate).toHaveBeenCalledWith("Sort", { resume: true });
  });

  it("shows Play and opens Sort plainly when there is no Sort board to continue", async () => {
    await AsyncStorage.setItem("@sort/catalog_version", String(SORT_CATALOG_VERSION));
    await AsyncStorage.setItem(
      "@sort/progress",
      JSON.stringify({ unlockedLevel: 3, currentLevelId: null })
    );
    const r = await renderScreen();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(r.queryByTestId("game-status-sort")).toBeNull();
    fireEvent.press(r.getByLabelText("Play Sort Puzzle"));
    expect(mockNavigate).toHaveBeenCalledWith("Sort");
  });

  it("renders the grid with the normal description while a read has not landed", async () => {
    const getItem = AsyncStorage.getItem as jest.Mock;
    getItem.mockImplementation((key: string) =>
      key === "twenty48_game_v2" ? new Promise(() => undefined) : Promise.resolve(null)
    );
    try {
      const r = await renderScreen();
      await settle();
      expect(r.getByLabelText("Play 2048")).toBeTruthy();
      expect(r.getByText(TWENTY48_DESC)).toBeTruthy();
      expect(r.getByLabelText("Play Yacht")).toBeTruthy();
    } finally {
      // Put the in-memory store back (jest.setup.ts): mockReset drops this implementation.
      getItem.mockReset();
      (AsyncStorage as unknown as { __restoreDefaults: () => void }).__restoreDefaults();
    }
  });

  it("keeps Play and the description on a tile with no save, and a tap starts a new game", async () => {
    const r = await renderScreen();
    await settle();
    expect(r.queryByTestId("game-status-twenty48")).toBeNull();
    expect(r.getByText(TWENTY48_DESC)).toBeTruthy();
    expect(within(r.getByTestId("game-btn-twenty48")).getByText("Play")).toBeTruthy();
    fireEvent.press(r.getByLabelText("Play 2048"));
    expect(mockNavigate).toHaveBeenCalledWith("Twenty48");
  });

  it("shows the best moves of a FreeCell with a best and no game in progress", async () => {
    await recordResult("freecell", 1234);
    await saveFreeCell(dealFreeCell(5));
    const r = await renderScreen();
    const status = await r.findByTestId("game-status-freecell");
    expect(status.props.children).toBe("Best moves: 1,234");
    expect(r.getByLabelText("Play FreeCell").props.accessibilityValue).toEqual({
      text: "Best moves: 1,234",
    });
  });

  it("formats each best in its game's unit for the locale, in the muted colour", async () => {
    mockTileStatuses = {
      twenty48: { kind: "best", value: 12345, unit: "score" },
      solitaire: { kind: "best", value: 754_000, unit: "time" },
      freecell: { kind: "best", value: 88, unit: "moves" },
    };
    const { getByTestId } = await renderScreen();
    expect(getByTestId("game-status-twenty48").props.children).toBe("Best 12,345");
    expect(getByTestId("game-status-solitaire").props.children).toBe("Best 12:34");
    expect(getByTestId("game-status-freecell").props.children).toBe("Best moves: 88");
    const muted = StyleSheet.flatten(getByTestId("game-status-twenty48").props.style).color;
    expect(muted).toBe(StyleSheet.flatten(getByTestId("game-status-freecell").props.style).color);
  });

  it("shows Done today for Daily Word in the tertiary colour, and Resume in the accent colour", async () => {
    mockTileStatuses = { daily_word: { kind: "doneToday" }, yacht: { kind: "resume" } };
    const { getByTestId, getByLabelText } = await renderScreen();
    const done = getByTestId("game-status-daily_word");
    expect(done.props.children).toBe("Done today");
    expect(getByLabelText("Play Daily Word").props.accessibilityValue).toEqual({
      text: "Done today",
    });
    const resume = getByTestId("game-status-yacht");
    expect(StyleSheet.flatten(resume.props.style).color).not.toBe(
      StyleSheet.flatten(done.props.style).color
    );
    expect(getByLabelText("Play Yacht — in progress, tap to resume")).toBeTruthy();
    // Daily Word has no Resume: its button still says Play.
    expect(within(getByTestId("game-btn-daily_word")).getByText("Play")).toBeTruthy();
  });

  it("the status takes the description's reserved lines: the tile height is unchanged", async () => {
    mockWindow.fontScale = 1.5;
    const plain = await renderScreen();
    const without = plain.getByText(TWENTY48_DESC);
    const reserved = [
      without.props.numberOfLines,
      StyleSheet.flatten(without.props.style).minHeight,
    ];
    await plain.unmount();

    mockTileStatuses = { twenty48: { kind: "resume" } };
    const withStatus = (await renderScreen()).getByTestId("game-status-twenty48");
    expect([
      withStatus.props.numberOfLines,
      StyleSheet.flatten(withStatus.props.style).minHeight,
    ]).toEqual(reserved);
    expect(reserved).toEqual([
      lobbyTileTextSizing(1.5).descriptionLines,
      lobbyTileTextSizing(1.5).descriptionMinHeight,
    ]);
    expect(withStatus.props.maxFontSizeMultiplier).toBe(LOBBY_MAX_FONT_SCALE);
  });

  it("gives a locked tile no status", async () => {
    mockTileStatuses = { twenty48: { kind: "resume" } };
    mockCanPlay.mockImplementation((slug: string) => slug !== "twenty48");
    const r = await renderScreen();
    expect(r.queryByTestId("game-status-twenty48")).toBeNull();
    expect(r.queryByLabelText(/in progress/)).toBeNull();
    expect(r.getByText(TWENTY48_DESC)).toBeTruthy();
  });

  it("in a store build reads no hidden game's storage", async () => {
    __forceStoreBuildForTests(true);
    const r = await renderScreen();
    await settle();
    expect(r.queryByTestId("game-tile-cascade")).toBeNull();
    const keys = (AsyncStorage.getItem as jest.Mock).mock.calls.map(([key]) => String(key));
    expect(keys.filter((k) => /cascade|starswarm|mahjong|hearts|blackjack/.test(k))).toEqual([]);
    // It did read a visible game's save.
    expect(keys).toContain("twenty48_game_v2");
  });

  it("reads again when Home regains focus, and writes nothing", async () => {
    await renderScreen();
    await settle();
    const focus = mockAddListener.mock.calls.filter(([event]) => event === "focus");
    expect(focus.length).toBeGreaterThan(0);
    await saveTwenty48({ ...newTwenty48(), score: 8 });
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    await act(async () => {
      focus.forEach(([, cb]) => cb());
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // It read the save again, and wrote no game, best or board key (Home's own keys aside).
    const read = (AsyncStorage.getItem as jest.Mock).mock.calls.map(([key]) => String(key));
    expect(read).toContain("twenty48_game_v2");
    const written = (AsyncStorage.setItem as jest.Mock).mock.calls.map(([key]) => String(key));
    expect(
      written.filter((k) =>
        /twenty48|solitaire|freecell|sudoku|yacht|personal_best|daily_word/.test(k)
      )
    ).toEqual([]);
  });
});

describe("HomeScreen — tile press feedback and haptic (#4007)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // A real touch: Pressable shows its pressed state from the responder grant, after
  // Pressability's short highlight delay, not from the onPressIn prop alone.
  const touch = { nativeEvent: { touches: [], changedTouches: [], target: 1 }, persist: () => {} };
  const holdDown = async (el: Parameters<typeof fireEvent>[0]) => {
    await fireEvent(el, "responderGrant", touch);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
  };

  const tileStyle = (el: { props: { style?: unknown } }) =>
    StyleSheet.flatten(el.props.style as never) as { opacity?: number; transform?: unknown[] };

  it("dims to 0.85 and scales to 0.97 while pressed", async () => {
    const { getByTestId } = await renderScreen(390);
    expect(tileStyle(getByTestId("game-tile-yacht")).opacity).toBeUndefined();
    await holdDown(getByTestId("game-tile-yacht"));
    const pressed = tileStyle(getByTestId("game-tile-yacht"));
    expect(pressed.opacity).toBe(0.85);
    expect(pressed.transform).toEqual([{ scale: 0.97 }]);
  });

  it("gives a locked tile the same feedback", async () => {
    mockCanPlay.mockImplementation((slug: string) => slug !== "cascade");
    const { getByTestId } = await renderScreen(390);
    await holdDown(getByTestId("game-tile-cascade"));
    const style = tileStyle(getByTestId("game-tile-cascade"));
    expect(style.opacity).toBe(0.85);
    expect(style.transform).toEqual([{ scale: 0.97 }]);
  });

  it("under Reduce Motion dims but does not scale", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const { getByTestId } = await renderScreen(390);
    await act(async () => {});
    await holdDown(getByTestId("game-tile-yacht"));
    const style = tileStyle(getByTestId("game-tile-yacht"));
    expect(style.opacity).toBe(0.85);
    expect(style.transform).toBeUndefined();
  });

  it.each(["ios", "android"] as const)("taps a light haptic once on a tap on %s", async (os) => {
    jest.replaceProperty(Platform, "OS", os);
    const { getByTestId } = await renderScreen(390);
    await fireEvent(getByTestId("game-tile-yacht"), "pressIn");
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    await fireEvent.press(getByTestId("game-tile-yacht"));
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
  });

  it("taps no haptic when a touch-down is taken over by a scroll", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const { getByTestId } = await renderScreen(390);
    await holdDown(getByTestId("game-tile-yacht"));
    await fireEvent(getByTestId("game-tile-yacht"), "responderTerminate", touch);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("taps no haptic on web", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    const { getByTestId } = await renderScreen(390);
    await fireEvent.press(getByTestId("game-tile-yacht"));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalled();
  });

  it("taps no haptic when sound effects are muted", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await AsyncStorage.setItem("settings.soundMuted", "true");
    const { SoundProvider } = jest.requireActual("../../game/_shared/SoundContext");
    const { getByTestId } = await render(
      <SafeAreaProvider initialMetrics={testInsets}>
        <SoundProvider>
          <ThemeProvider>
            <HomeScreen />
          </ThemeProvider>
        </SoundProvider>
      </SafeAreaProvider>
    );
    await act(async () => {});
    await fireEvent.press(getByTestId("game-tile-yacht"));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("a rejected haptic never breaks the tile", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error("no engine"));
    const { getByLabelText } = await renderScreen(390);
    await fireEvent.press(getByLabelText("Play Solitaire"));
    expect(mockNavigate).toHaveBeenCalledWith("Solitaire");
  });

  it("a haptic that throws synchronously never blocks navigation", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    (Haptics.impactAsync as jest.Mock).mockImplementationOnce(() => {
      throw new Error("native module missing");
    });
    const { getByLabelText } = await renderScreen(390);
    await fireEvent.press(getByLabelText("Play Solitaire"));
    expect(mockNavigate).toHaveBeenCalledWith("Solitaire");
  });

  it("still runs the tile action and opens the paywall on a locked tile", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    mockCanPlay.mockImplementation((slug: string) => slug !== "cascade");
    const { getByTestId } = await renderScreen(390);
    await fireEvent.press(getByTestId("game-tile-sudoku"));
    expect(mockNavigate).toHaveBeenCalledWith("Sudoku");
    await fireEvent.press(getByTestId("game-tile-cascade"));
    expect(mockNavigate).toHaveBeenCalledWith("Paywall", { gameSlug: "cascade" });
  });
});

describe("HomeScreen — fixed tile order, Daily Word first (#4009)", () => {
  afterEach(() => __forceStoreBuildForTests(false));

  const tileOrder = (getAllByTestId: (id: RegExp) => { props: { testID: string } }[]) =>
    getAllByTestId(/^game-tile-/).map((el) => el.props.testID.replace("game-tile-", ""));

  it("store build: Daily Word first, the rest in their existing order", async () => {
    __forceStoreBuildForTests(true);
    const { getAllByTestId } = await renderScreen(390);
    expect(tileOrder(getAllByTestId)).toEqual([
      "daily_word",
      "yacht",
      "twenty48",
      "solitaire",
      "freecell",
      "sudoku",
      "sort",
    ]);
  });

  it("all games: Daily Word first, hidden games keep their relative slots", async () => {
    const { getAllByTestId } = await renderScreen(390);
    expect(tileOrder(getAllByTestId)).toEqual([
      "daily_word",
      "yacht",
      "cascade",
      "blackjack",
      "twenty48",
      "solitaire",
      "freecell",
      "hearts",
      "sudoku",
      "starswarm",
      "mahjong",
      "sort",
    ]);
  });

  it("the single-column path uses the same order", async () => {
    __forceStoreBuildForTests(true);
    const { getAllByTestId } = await renderScreen(300);
    expect(tileOrder(getAllByTestId)[0]).toBe("daily_word");
  });
});
