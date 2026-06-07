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
    expect(screen.getByText("280")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
    // 600000 ms → 10m 0s
    expect(screen.getByText("10m 0s")).toBeTruthy();
  });

  it("renders an error state when the fetch fails", async () => {
    mockGetGameDetail.mockRejectedValue(new Error("boom"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Couldn't load this game")).toBeTruthy();
    });
  });
});
