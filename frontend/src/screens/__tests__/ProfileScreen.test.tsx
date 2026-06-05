import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import ProfileScreen from "../ProfileScreen";
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

function renderScreen() {
  return render(
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
    renderScreen();
    await waitFor(() => {
      expect(screen.getByRole("header")).toBeTruthy();
    });
  });

  it("shows a loading spinner while fetching", async () => {
    // Leave the mocks unresolved to keep loading state visible.
    mockGetMyStats.mockImplementation(() => new Promise(() => {}));
    mockGetMyGames.mockImplementation(() => new Promise(() => {}));
    renderScreen();
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });

  it("renders stats bento tiles after loading", async () => {
    renderScreen();
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
    renderScreen();
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
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    const row = screen.getByLabelText(/Yacht 280/);
    fireEvent.press(row);
    expect(mockNavigate).toHaveBeenCalledWith("GameDetail", { gameId: "g1" });
  });

  it("shows an empty state when the recent games list is empty", async () => {
    mockGetMyGames.mockResolvedValue({ items: [], next_cursor: null });
    mockGetMyStats.mockResolvedValue({ total_games: 0, by_game: {}, favorite_game: null });
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Play a game to see it here")).toBeTruthy();
    });
  });

  it("shows full-screen error with Retry when both requests fail", async () => {
    mockGetMyStats.mockRejectedValue(new Error("Network down"));
    mockGetMyGames.mockRejectedValue(new Error("Network down"));
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Couldn't load recent games")).toBeTruthy();
      expect(screen.getByText("Retry")).toBeTruthy();
    });
    // Retry re-triggers the fetch; stats resolves, games still fails → inline error.
    mockGetMyStats.mockResolvedValue(SAMPLE_STATS);
    await act(async () => {
      fireEvent.press(screen.getByText("Retry"));
    });
    await waitFor(() => {
      expect(screen.getByText("Games Played")).toBeTruthy();
    });
  });

  it("shows game history without bento tiles when only stats fails", async () => {
    mockGetMyStats.mockRejectedValue(new Error("500 server error"));
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(screen.queryByText("Games Played")).toBeNull();
    expect(screen.getAllByText("Yacht").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("shows bento tiles and inline games error when only games fails", async () => {
    mockGetMyGames.mockRejectedValue(new Error("500 server error"));
    renderScreen();
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

    renderScreen();

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
    renderScreen();
    await waitFor(() => {
      expect(mockGetMyStats).toHaveBeenCalledTimes(1);
    });
    expect(mockGetMyGames).toHaveBeenCalledWith(20);
  });
});
