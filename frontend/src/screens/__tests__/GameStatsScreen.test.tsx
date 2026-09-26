import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import GameStatsScreen from "../GameStatsScreen";
import type { GameTypeStats, StatsResponse } from "../../api/types";
import type { GameType } from "../../api/vocab";
import { ApiError } from "../../game/_shared/httpClient";
import { __forceStoreBuildForTests } from "../../entitlements/gameVisibility";
import {
  clearMyStatsCache,
  fetchAndRememberMyStats,
  myStatsToken,
  rememberMyStats,
} from "../../hooks/useMyStats";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockGetMyStats = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getMyStats: () => mockGetMyStats() },
}));

const mockFlushQueuedGames = jest.fn(() => Promise.resolve());
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: () => mockFlushQueuedGames(),
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

const navigate = jest.fn();
const goBack = jest.fn();
const navigation = { navigate, goBack } as unknown as React.ComponentProps<
  typeof GameStatsScreen
>["navigation"];

function gameStats(overrides: Partial<GameTypeStats> = {}): GameTypeStats {
  return {
    played: 10,
    best: null,
    avg: null,
    last_played_at: "2026-09-20T12:00:00Z",
    best_chips: null,
    current_chips: null,
    sessions: 10,
    completed: 8,
    won: null,
    lost: null,
    tied: null,
    current_win_streak: null,
    best_win_streak: null,
    time_played_ms: 0,
    best_value: null,
    best_label_key: "score",
    extras: {},
    ...overrides,
  };
}

function response(byGame: Record<string, GameTypeStats>): StatsResponse {
  return {
    total_games: 0,
    by_game: byGame,
    favorite_game: null,
    arcade_xp: 0,
    arcade_level: 1,
    xp_into_level: 0,
    xp_for_next_level: 100,
    streak_days: 0,
  };
}

const HEARTS = gameStats({
  sessions: 12,
  completed: 9,
  won: 6,
  lost: 2,
  tied: 0,
  current_win_streak: 2,
  best_win_streak: 4,
  // 1 h 5 m
  time_played_ms: 65 * 60_000,
  best_value: 26,
  best_label_key: "score",
});

async function renderStats(gameType: GameType) {
  const result = await render(
    <ThemeProvider>
      <GameStatsScreen route={{ params: { gameType } }} navigation={navigation} />
    </ThemeProvider>
  );
  await act(async () => {});
  return result;
}

/** A tile's value, read from its accessibility label ("Wins: 6"). */
function tile(key: string): string {
  const label = screen.getByTestId(`game-stats-tile-${key}`).props.accessibilityLabel as string;
  return label.slice(label.indexOf(": ") + 2);
}

/** The install's `X-Session-ID` (game/_shared/session.ts). */
const SESSION_KEY = "game_session_id";

async function rerenderStats(rerender: (ui: React.ReactElement) => Promise<void>) {
  await rerender(
    <ThemeProvider>
      <GameStatsScreen route={{ params: { gameType: "hearts" } }} navigation={navigation} />
    </ThemeProvider>
  );
  await act(async () => {});
}

beforeEach(async () => {
  jest.clearAllMocks();
  clearMyStatsCache();
  await AsyncStorage.setItem(SESSION_KEY, "session-a");
  mockGetMyStats.mockReset();
  mockGetMyStats.mockResolvedValue(response({ hearts: HEARTS }));
  mockNetwork.isOnline = true;
  mockNetwork.isInitialized = true;
});

afterEach(() => __forceStoreBuildForTests(false));

describe("GameStatsScreen — a game with win data", () => {
  it("titles the screen with the game and goes back to it", async () => {
    await renderStats("hearts");
    expect(screen.getAllByRole("header").some((h) => h.props.children === "Hearts Stats")).toBe(
      true
    );
    await fireEvent.press(screen.getByRole("button", { name: "Back to Hearts" }));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it("shows sessions, completed, results, win rate, streaks, best, time and last played", async () => {
    await renderStats("hearts");
    expect(tile("sessions")).toBe("12");
    expect(tile("completed")).toBe("9");
    expect(tile("wins")).toBe("6");
    expect(tile("losses")).toBe("2");
    expect(tile("ties")).toBe("0");
    expect(tile("winRate")).toBe("75%");
    expect(tile("currentStreak")).toBe("2");
    expect(tile("bestStreak")).toBe("4");
    expect(tile("best")).toBe("26 pts");
    expect(tile("timePlayed")).toBe("1h 5m");
    expect(tile("lastPlayed")).not.toBe("—");
    expect(screen.getByText("Win Streak")).toBeTruthy();
    expect(screen.getByText("Best Streak")).toBeTruthy();
  });

  it("uploads queued games before reading the stats, so a just-finished game counts", async () => {
    const order: string[] = [];
    mockFlushQueuedGames.mockImplementation(() => {
      order.push("flush");
      return Promise.resolve();
    });
    mockGetMyStats.mockImplementation(() => {
      order.push("stats");
      return Promise.resolve(response({ hearts: HEARTS }));
    });
    await renderStats("hearts");
    expect(order).toEqual(["flush", "stats"]);
  });

  it("links to the game's leaderboard", async () => {
    await renderStats("hearts");
    await fireEvent.press(screen.getByRole("link", { name: "View leaderboard" }));
    expect(navigate).toHaveBeenCalledWith("Leaderboard", { gameType: "hearts" });
  });

  it("shows no Run history link for a game other than Blackjack", async () => {
    await renderStats("hearts");
    expect(screen.queryByText("Run history")).toBeNull();
  });
});

describe("GameStatsScreen — a score-only game", () => {
  beforeEach(() => {
    mockGetMyStats.mockResolvedValue(
      response({
        twenty48: gameStats({ sessions: 5, completed: 4, best_value: 4096, time_played_ms: 0 }),
      })
    );
  });

  it("shows — for the win figures and no streaks", async () => {
    await renderStats("twenty48");
    expect(tile("wins")).toBe("—");
    expect(tile("losses")).toBe("—");
    expect(tile("ties")).toBe("—");
    expect(tile("winRate")).toBe("—");
    expect(screen.queryByTestId("game-stats-tile-currentStreak")).toBeNull();
    expect(screen.queryByTestId("game-stats-tile-bestStreak")).toBeNull();
    expect(screen.queryByText("Win Streak")).toBeNull();
    expect(tile("best")).toBe("4,096 pts");
    expect(tile("timePlayed")).toBe("0m");
  });
});

describe("GameStatsScreen — win rate", () => {
  it("counts ties in the rate: won / (won + lost + tied)", async () => {
    mockGetMyStats.mockResolvedValue(
      response({ blackjack: gameStats({ won: 3, lost: 4, tied: 1, best_label_key: "chips" }) })
    );
    await renderStats("blackjack");
    // 3 / 8 = 37.5%; without the tie it would be 3 / 7 = 43%.
    expect(tile("winRate")).toBe("38%");
    expect(tile("ties")).toBe("1");
  });

  it("shows — when the game has results but none decided yet", async () => {
    mockGetMyStats.mockResolvedValue(response({ hearts: gameStats({ won: 0, lost: 0, tied: 0 }) }));
    await renderStats("hearts");
    expect(tile("winRate")).toBe("—");
  });
});

describe("GameStatsScreen — best with its label", () => {
  it("labels FreeCell's best in moves", async () => {
    mockGetMyStats.mockResolvedValue(
      response({ freecell: gameStats({ best_value: 87, best_label_key: "moves" }) })
    );
    await renderStats("freecell");
    expect(tile("best")).toBe("87 moves");
  });

  it("labels Sort's best as a level", async () => {
    mockGetMyStats.mockResolvedValue(
      response({ sort: gameStats({ best_value: 19, best_label_key: "level" }) })
    );
    await renderStats("sort");
    expect(tile("best")).toBe("Level 19");
  });

  it("shows — before any qualifying game", async () => {
    mockGetMyStats.mockResolvedValue(response({ freecell: gameStats({ best_value: null }) }));
    await renderStats("freecell");
    expect(tile("best")).toBe("—");
  });
});

describe("GameStatsScreen — links", () => {
  it("links Blackjack's stats to its run history, and to no leaderboard", async () => {
    mockGetMyStats.mockResolvedValue(response({ blackjack: gameStats() }));
    await renderStats("blackjack");
    expect(screen.queryByText("View leaderboard")).toBeNull();
    await fireEvent.press(screen.getByRole("link", { name: "Run history" }));
    expect(navigate).toHaveBeenCalledWith("BlackjackStats");
  });

  it("shows no leaderboard link for a game whose board is disabled", async () => {
    mockGetMyStats.mockResolvedValue(response({ daily_word: gameStats() }));
    await renderStats("daily_word");
    expect(screen.queryByText("View leaderboard")).toBeNull();
    expect(screen.queryByText("Run history")).toBeNull();
  });
});

describe("GameStatsScreen — no games yet", () => {
  it("says so, and still links to the leaderboard", async () => {
    mockGetMyStats.mockResolvedValue(response({ hearts: HEARTS }));
    await renderStats("mahjong");
    expect(
      screen.getByText("No finished games yet. Finish a game to see your stats here.")
    ).toBeTruthy();
    expect(screen.queryByTestId("game-stats-tile-sessions")).toBeNull();
    expect(screen.getByRole("link", { name: "View leaderboard" })).toBeTruthy();
  });
});

describe("GameStatsScreen — a server older than #2620", () => {
  it("falls back to played for sessions and shows — for what it doesn't send", async () => {
    mockGetMyStats.mockResolvedValue(
      response({
        hearts: {
          played: 7,
          best: 40,
          avg: 30,
          last_played_at: null,
          best_chips: null,
          current_chips: null,
        },
      })
    );
    await renderStats("hearts");
    expect(tile("sessions")).toBe("7");
    expect(tile("completed")).toBe("—");
    expect(tile("wins")).toBe("—");
    expect(tile("winRate")).toBe("—");
    expect(tile("best")).toBe("—");
    expect(tile("timePlayed")).toBe("—");
    expect(tile("lastPlayed")).toBe("—");
    expect(screen.queryByTestId("game-stats-tile-currentStreak")).toBeNull();
  });
});

describe("GameStatsScreen — offline and errors", () => {
  it("shows a translated error with Retry when the request fails and nothing was loaded", async () => {
    mockGetMyStats.mockRejectedValue(new ApiError("Internal Server Error", 500));
    await renderStats("hearts");
    const error = within(screen.getByTestId("game-stats-error"));
    expect(error.getByText("Couldn't load your stats.")).toBeTruthy();

    mockGetMyStats.mockResolvedValue(response({ hearts: HEARTS }));
    await fireEvent.press(error.getByText("Retry"));
    await act(async () => {});
    expect(tile("wins")).toBe("6");
  });

  it("shows a translated offline message when offline with nothing loaded", async () => {
    mockNetwork.isOnline = false;
    await renderStats("hearts");
    expect(screen.getByText("You're offline. Your stats load when you reconnect.")).toBeTruthy();
    expect(mockGetMyStats).not.toHaveBeenCalled();
  });

  it("loads once the device reconnects", async () => {
    mockNetwork.isOnline = false;
    const { rerender } = await renderStats("hearts");
    mockNetwork.isOnline = true;
    await rerenderStats(rerender);
    expect(tile("wins")).toBe("6");
  });

  it("asks again from the error state when the device comes back online", async () => {
    mockGetMyStats.mockRejectedValue(new ApiError("Service Unavailable", 503));
    const { rerender } = await renderStats("hearts");
    expect(screen.getByTestId("game-stats-error")).toBeTruthy();
    expect(mockGetMyStats).toHaveBeenCalledTimes(1);

    mockGetMyStats.mockResolvedValue(response({ hearts: HEARTS }));
    mockNetwork.isOnline = false;
    await rerenderStats(rerender);
    expect(mockGetMyStats).toHaveBeenCalledTimes(1);
    mockNetwork.isOnline = true;
    await rerenderStats(rerender);
    expect(mockGetMyStats).toHaveBeenCalledTimes(2);
    expect(tile("wins")).toBe("6");
  });

  it("shows the last response from this session when a later request fails", async () => {
    const first = await renderStats("hearts");
    expect(tile("wins")).toBe("6");
    await first.unmount();

    mockGetMyStats.mockRejectedValue(new ApiError("Service Unavailable", 503));
    await renderStats("hearts");
    expect(tile("wins")).toBe("6");
    expect(screen.getByTestId("game-stats-stale")).toBeTruthy();
    expect(screen.queryByTestId("game-stats-error")).toBeNull();
  });

  it("shows the last response from this session when opened offline", async () => {
    const first = await renderStats("hearts");
    await first.unmount();

    mockNetwork.isOnline = false;
    mockGetMyStats.mockClear();
    await renderStats("hearts");
    expect(tile("wins")).toBe("6");
    expect(screen.getByTestId("game-stats-stale")).toBeTruthy();
    expect(mockGetMyStats).not.toHaveBeenCalled();
  });

  it("marks the remembered figures as updating until the fresh ones land", async () => {
    const first = await renderStats("hearts");
    await first.unmount();

    let answer!: (r: StatsResponse) => void;
    mockGetMyStats.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await renderStats("hearts");
    expect(tile("wins")).toBe("6");
    expect(screen.getByText("Updating…")).toBeTruthy();
    expect(screen.queryByTestId("game-stats-stale")).toBeNull();

    await act(async () => {
      answer(response({ hearts: gameStats({ won: 9, lost: 1, tied: 0 }) }));
    });
    expect(tile("wins")).toBe("9");
    expect(screen.queryByText("Updating…")).toBeNull();
    expect(screen.queryByTestId("game-stats-stale")).toBeNull();
  });

  it("never shows a response remembered for another session", async () => {
    const first = await renderStats("hearts");
    await first.unmount();

    await AsyncStorage.setItem(SESSION_KEY, "session-b");
    mockNetwork.isOnline = false;
    await renderStats("hearts");
    expect(screen.queryByTestId("game-stats-tile-wins")).toBeNull();
    expect(screen.getByText("You're offline. Your stats load when you reconnect.")).toBeTruthy();
  });

  it("shows nothing remembered once the cache is cleared (Delete my data)", async () => {
    const first = await renderStats("hearts");
    await first.unmount();

    clearMyStatsCache();
    mockNetwork.isOnline = false;
    await renderStats("hearts");
    expect(screen.queryByTestId("game-stats-tile-wins")).toBeNull();
    expect(screen.getByText("You're offline. Your stats load when you reconnect.")).toBeTruthy();
  });

  it("doesn't let a request that was in flight when the cache was cleared refill it", async () => {
    let answer!: (r: StatsResponse) => void;
    mockGetMyStats.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const first = await renderStats("hearts");
    clearMyStatsCache();
    await act(async () => {
      answer(response({ hearts: HEARTS }));
    });
    expect(tile("wins")).toBe("6");
    await first.unmount();

    mockNetwork.isOnline = false;
    await renderStats("hearts");
    expect(screen.queryByTestId("game-stats-tile-wins")).toBeNull();
  });

  it("shows a response another screen remembered (fetchAndRememberMyStats)", async () => {
    await fetchAndRememberMyStats(() => Promise.resolve(response({ hearts: HEARTS })));
    mockNetwork.isOnline = false;
    await renderStats("hearts");
    expect(tile("wins")).toBe("6");
    expect(mockGetMyStats).not.toHaveBeenCalled();
  });

  it("drops an answer whose session changed while it was in flight", async () => {
    const token = myStatsToken();
    await AsyncStorage.setItem(SESSION_KEY, "session-b");
    await rememberMyStats(response({ hearts: HEARTS }), token);

    mockNetwork.isOnline = false;
    await renderStats("hearts");
    expect(screen.queryByTestId("game-stats-tile-wins")).toBeNull();
  });

  it("drops an answer whose fetch was in flight when the cache was cleared", async () => {
    let answer!: (r: StatsResponse) => void;
    const pending = fetchAndRememberMyStats(
      () => new Promise<StatsResponse>((resolve) => (answer = resolve))
    );
    clearMyStatsCache();
    answer(response({ hearts: HEARTS }));
    await pending;

    mockNetwork.isOnline = false;
    await renderStats("hearts");
    expect(screen.queryByTestId("game-stats-tile-wins")).toBeNull();
  });

  it("shows fresh figures without the note once a request succeeds", async () => {
    const first = await renderStats("hearts");
    await first.unmount();

    mockGetMyStats.mockResolvedValue(response({ hearts: gameStats({ won: 9, lost: 1, tied: 0 }) }));
    await renderStats("hearts");
    expect(tile("wins")).toBe("9");
    expect(screen.queryByTestId("game-stats-stale")).toBeNull();
    expect(screen.queryByText("Updating…")).toBeNull();
  });
});
