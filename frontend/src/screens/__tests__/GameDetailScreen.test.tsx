import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import GameDetailScreen from "../GameDetailScreen";
import type { GameDetailResponse } from "../../api/types";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockGetGameDetail = jest.fn() as jest.Mock<Promise<GameDetailResponse>, [string, boolean?]>;
jest.mock("../../api/stats", () => ({
  statsApi: {
    getGameDetail: (gameId: string, include?: boolean) => mockGetGameDetail(gameId, include),
    getMyStats: jest.fn(),
    getMyGames: jest.fn(),
  },
}));

const SAMPLE_DETAIL: GameDetailResponse = {
  id: "abc-123",
  game_type: "yacht",
  started_at: "2026-04-12T12:00:00Z",
  completed_at: "2026-04-12T12:10:00Z",
  final_score: 280,
  outcome: "completed",
  duration_ms: 600000,
  metadata: {},
  events: null,
  players: [],
};

const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
} as unknown as Parameters<typeof GameDetailScreen>[0]["navigation"];

async function renderScreen(gameId = "abc-123"): ReturnType<typeof render> {
  const route = {
    key: "GameDetail-1",
    name: "GameDetail" as const,
    params: { gameId },
  } as unknown as Parameters<typeof GameDetailScreen>[0]["route"];
  return await render(
    <ThemeProvider>
      <GameDetailScreen navigation={mockNavigation} route={route} />
    </ThemeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetGameDetail.mockResolvedValue(SAMPLE_DETAIL);
});

describe("GameDetailScreen", () => {
  it("shows a loading spinner while fetching", async () => {
    mockGetGameDetail.mockImplementation(() => new Promise(() => {}));
    await renderScreen();
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });

  it("fetches the game detail with the route gameId", async () => {
    await renderScreen("abc-123");
    await waitFor(() => {
      expect(mockGetGameDetail).toHaveBeenCalledWith("abc-123", false);
    });
  });

  it("renders formatted detail rows on success", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Yacht")).toBeTruthy();
    });
    expect(screen.getByText("280 pts")).toBeTruthy();
    // The outcome's label, and the "Completed" (completed at) row's.
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    expect(screen.queryByText("completed")).toBeNull();
    // 600000 ms → 10m 0s
    expect(screen.getByText("10m 0s")).toBeTruthy();
  });

  it.each([
    ["win", "Win"],
    ["loss", "Loss"],
    ["push", "Tie"],
  ] as const)("shows the localised outcome for %s (#2637)", async (outcome, label) => {
    mockGetGameDetail.mockResolvedValue({ ...SAMPLE_DETAIL, outcome });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText(label)).toBeTruthy();
    });
    expect(screen.queryByText(outcome)).toBeNull();
  });

  it.each([
    ["sort", 0, { level_reached: 19 }, "Level 19"],
    ["daily_word", null, { guesses_used: 4 }, "4 guesses"],
    ["freecell", 87, {}, "87 moves"],
  ] as const)(
    "shows %s's board metric with its label, as Recent Games does (#2637)",
    async (game_type, final_score, metadata, expected) => {
      mockGetGameDetail.mockResolvedValue({ ...SAMPLE_DETAIL, game_type, final_score, metadata });
      await renderScreen();
      await waitFor(() => {
        expect(screen.getByText(expected)).toBeTruthy();
      });
    }
  );

  it("shows a dash when the game lacks its board metric", async () => {
    mockGetGameDetail.mockResolvedValue({
      ...SAMPLE_DETAIL,
      game_type: "sort",
      final_score: 3,
      metadata: {},
    });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Final Score")).toBeTruthy();
    });
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("3")).toBeNull();
  });

  it("shows a dash for a game with no outcome yet", async () => {
    mockGetGameDetail.mockResolvedValue({ ...SAMPLE_DETAIL, outcome: null });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Outcome")).toBeTruthy();
    });
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders an error state when the fetch fails", async () => {
    mockGetGameDetail.mockRejectedValue(new Error("boom"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Couldn't load this game")).toBeTruthy();
    });
  });
});
