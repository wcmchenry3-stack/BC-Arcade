import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import LeaderboardScreen from "../LeaderboardScreen";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockGetLeaderboard = jest.fn() as jest.Mock<Promise<{ scores: unknown[] }>>;
jest.mock("../../game/starswarm/api", () => ({
  starSwarmApi: {
    getLeaderboard: () => mockGetLeaderboard(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLeaderboard.mockResolvedValue({ scores: [] });
});

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <LeaderboardScreen />
    </ThemeProvider>
  );
}

describe("LeaderboardScreen", () => {
  it("renders the AppHeader", async () => {
    await renderScreen();
    expect(screen.getByRole("header")).toBeTruthy();
  });

  it("shows a loading indicator before the API resolves", async () => {
    mockGetLeaderboard.mockImplementation(() => new Promise(() => {}));
    await renderScreen();
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });

  it("shows empty-state text when there are no scores", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("leaderboard.empty")).toBeTruthy();
    });
  });
});

describe("LeaderboardScreen — TypeError auto-retry (#1874)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("auto-retries a transient TypeError and displays data without showing an error", async () => {
    jest.useFakeTimers();
    mockGetLeaderboard
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({ scores: [] });

    await renderScreen();
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(screen.queryByText("leaderboard.error")).toBeNull();
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(2);
  });

  it("shows error UI only after all retries are exhausted", async () => {
    jest.useFakeTimers();
    mockGetLeaderboard.mockRejectedValue(new TypeError("Network request failed"));

    await renderScreen();
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await screen.findByText("leaderboard.error");
    // 1 initial + 3 retries = 4 total calls
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(4);
  });
});
