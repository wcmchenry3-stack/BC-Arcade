import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import ProfileScreen from "../ProfileScreen";
import { __forceStoreBuildForTests } from "../../entitlements/gameVisibility";
import type { StatsResponse, GameHistoryResponse } from "../../api/types";

jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => ({ isOnline: true, isInitialized: true }),
}));

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// Mock the stats API — each test sets the resolved values.
const mockGetMyStats = jest.fn() as jest.Mock<Promise<StatsResponse>, []>;
const mockGetMyGames = jest.fn() as jest.Mock<Promise<GameHistoryResponse>, [number?]>;
const mockGetGameDetail = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: {
    getMyStats: () => mockGetMyStats(),
    getMyGames: (limit?: number) => mockGetMyGames(limit),
    getGameDetail: (...args: unknown[]) => (mockGetGameDetail as unknown as jest.Mock)(...args),
  },
}));

const SAMPLE_STATS: StatsResponse = {
  total_games: 7,
  by_game: {
    yacht: {
      played: 3,
      best: 280,
      avg: 240,
      last_played_at: "2026-04-12T12:00:00Z",
      best_chips: null,
      current_chips: null,
    },
    twenty48: {
      played: 2,
      best: 15240,
      avg: 12000,
      last_played_at: "2026-04-10T08:00:00Z",
      best_chips: null,
      current_chips: null,
    },
    blackjack: {
      played: 2,
      best: null,
      avg: null,
      last_played_at: "2026-04-09T20:00:00Z",
      best_chips: 1450,
      current_chips: 1450,
    },
  },
  favorite_game: "yacht",
  // 7 games × 10 + 3 game types × 50 = 220 XP → level 2 (from 100), 30 short of level 3 (250).
  arcade_xp: 220,
  arcade_level: 2,
  xp_into_level: 120,
  xp_for_next_level: 30,
  streak_days: 0,
};

const SAMPLE_GAMES: GameHistoryResponse = {
  items: [
    {
      id: "g1",
      game_type: "yacht",
      started_at: "2026-04-12T12:00:00Z",
      completed_at: "2026-04-12T12:10:00Z",
      final_score: 280,
      outcome: "completed",
      duration_ms: 600000,
      metadata: {},
      players: [],
    },
    {
      id: "g2",
      game_type: "twenty48",
      started_at: "2026-04-10T08:00:00Z",
      completed_at: "2026-04-10T08:05:00Z",
      final_score: 15240,
      outcome: "completed",
      duration_ms: 300000,
      metadata: {},
      players: [],
    },
    {
      id: "g3",
      game_type: "blackjack",
      started_at: "2026-04-09T20:00:00Z",
      completed_at: "2026-04-09T20:15:00Z",
      final_score: 1450,
      outcome: "abandoned",
      duration_ms: 900000,
      metadata: {},
      players: [],
    },
  ],
  next_cursor: null,
};

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <ProfileScreen />
    </ThemeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMyStats.mockResolvedValue(SAMPLE_STATS);
  mockGetMyGames.mockResolvedValue(SAMPLE_GAMES);
});

describe("ProfileScreen", () => {
  it("renders the AppHeader", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByRole("header")).toBeTruthy();
    });
  });

  it("shows a loading spinner while fetching", async () => {
    // Leave the mocks unresolved to keep loading state visible.
    mockGetMyStats.mockImplementation(() => new Promise(() => {}));
    mockGetMyGames.mockImplementation(() => new Promise(() => {}));
    await renderScreen();
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });

  it("renders stats bento tiles after loading", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Games Played")).toBeTruthy();
    });
    // Total games
    expect(screen.getByText("7")).toBeTruthy();
    // Favorite game — formatted (appears in both the bento tile and the row list)
    expect(screen.getByText("Favorite Game")).toBeTruthy();
    expect(screen.getAllByText("Yacht").length).toBeGreaterThanOrEqual(1);
    // Top score derived as max over by_game[x].best (or best_chips)
    // 15240 (twenty48) > 280 (yacht) > 1450 (blackjack chips)
    expect(screen.getAllByText("15,240").length).toBeGreaterThanOrEqual(1);
    // Game types tried = 3
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("renders the recent games list with formatted rows", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    // Rows render formatted game types and scores
    expect(screen.getAllByText("Yacht").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("2048").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Blackjack")).toBeTruthy();
    expect(screen.getByText("280")).toBeTruthy();
    expect(screen.getByText("1,450")).toBeTruthy();
  });

  it("navigates to GameDetail when a row is pressed", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    const row = screen.getByLabelText(/Yacht 280/);
    await fireEvent.press(row);
    expect(mockNavigate).toHaveBeenCalledWith("GameDetail", { gameId: "g1" });
  });

  it("shows an empty state when the recent games list is empty", async () => {
    mockGetMyGames.mockResolvedValue({ items: [], next_cursor: null });
    mockGetMyStats.mockResolvedValue({
      total_games: 0,
      by_game: {},
      favorite_game: null,
      arcade_xp: 0,
      arcade_level: 1,
      xp_into_level: 0,
      xp_for_next_level: 100,
      streak_days: 0,
    });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Play a game to see it here")).toBeTruthy();
    });
  });

  it("shows full-screen error with Retry when both requests fail", async () => {
    mockGetMyStats.mockRejectedValue(new Error("Network down"));
    mockGetMyGames.mockRejectedValue(new Error("Network down"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Couldn't load recent games")).toBeTruthy();
      expect(screen.getByText("Retry")).toBeTruthy();
    });
    // Retry re-triggers the fetch; stats resolves, games still fails → inline error.
    mockGetMyStats.mockResolvedValue(SAMPLE_STATS);
    await act(async () => {
      await fireEvent.press(screen.getByText("Retry"));
    });
    await waitFor(() => {
      expect(screen.getByText("Games Played")).toBeTruthy();
    });
  });

  it("shows game history without bento tiles when only stats fails", async () => {
    mockGetMyStats.mockRejectedValue(new Error("500 server error"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(screen.queryByText("Games Played")).toBeNull();
    expect(screen.getAllByText("Yacht").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("renders the Arcade level header from /stats/me (#2391)", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Level 2")).toBeTruthy();
    });
    expect(screen.getByText("220 XP")).toBeTruthy();
    expect(screen.getByText("30 XP to level 3")).toBeTruthy();
    // 120 of the 150 XP between level 2 and level 3.
    expect(screen.getByRole("progressbar").props.accessibilityValue.now).toBe(80);
  });

  it("renders without the level header when the API predates the XP fields (#2391)", async () => {
    const legacy = {
      total_games: SAMPLE_STATS.total_games,
      by_game: SAMPLE_STATS.by_game,
      favorite_game: SAMPLE_STATS.favorite_game,
    };
    mockGetMyStats.mockResolvedValue(legacy as StatsResponse);
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Games Played")).toBeTruthy();
    });
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("omits the level header when only stats fails (#2391)", async () => {
    mockGetMyStats.mockRejectedValue(new Error("500 server error"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/^Level \d+$/)).toBeNull();
  });

  it("shows bento tiles and inline games error when only games fails", async () => {
    mockGetMyGames.mockRejectedValue(new Error("500 server error"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Games Played")).toBeTruthy();
    });
    expect(screen.getByText("Couldn't load recent games")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
    // Game rows absent — Blackjack only appears in rows, never in the bento tiles.
    expect(screen.queryByText("Blackjack")).toBeNull();
  });

  it("retries on TypeError and shows data after backoff", async () => {
    jest.useFakeTimers();
    mockGetMyStats
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(SAMPLE_STATS);
    mockGetMyGames.mockResolvedValue(SAMPLE_GAMES);

    await renderScreen();

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await waitFor(() => {
      expect(screen.getByText("Games Played")).toBeTruthy();
    });
    expect(mockGetMyStats).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it("calls the API with the correct limit on mount", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(mockGetMyStats).toHaveBeenCalledTimes(1);
    });
    expect(mockGetMyGames).toHaveBeenCalledWith(20);
  });
});

describe("ProfileScreen — store build hides premium-game history (#2390)", () => {
  beforeEach(() => {
    __forceStoreBuildForTests(true);
  });
  afterEach(() => {
    __forceStoreBuildForTests(false);
  });

  it("derives the bento tiles from visible games only", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Games Played")).toBeTruthy();
    });
    // 2 twenty48 + 2 blackjack; the 3 Yacht games are not counted.
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.queryByText("7")).toBeNull();
    // Game types tried = 2, not 3.
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("3")).toBeNull();
    // Top score is still 2048's.
    expect(screen.getAllByText("15,240").length).toBeGreaterThanOrEqual(1);
  });

  it("never names a hidden game, even when the server says it is the favourite", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Favorite Game")).toBeTruthy();
    });
    expect(screen.queryByText("Yacht")).toBeNull();
    expect(screen.queryByText("280")).toBeNull();
    // Falls back to the most-played visible game (first of the tied pair).
    expect(screen.getAllByText("2048").length).toBeGreaterThanOrEqual(2);
  });

  it("drops hidden-game rows from the recent games list", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(screen.getByText("Blackjack")).toBeTruthy();
    expect(screen.queryByLabelText(/^Yacht/)).toBeNull();
  });

  it("shows the empty state when every recent game is hidden", async () => {
    mockGetMyGames.mockResolvedValue({
      items: SAMPLE_GAMES.items.filter((g) => g.game_type === "yacht"),
      next_cursor: null,
    });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(screen.queryByLabelText(/^Yacht/)).toBeNull();
  });
});
