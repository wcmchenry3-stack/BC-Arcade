import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import ProfileScreen from "../ProfileScreen";
import GameStatsScreen from "../GameStatsScreen";
import { clearMyStatsCache } from "../../hooks/useMyStats";
import { __forceStoreBuildForTests } from "../../entitlements/gameVisibility";
import {
  resetDisplayNameCacheForTests,
  setDisplayNameSaveHook,
} from "../../game/_shared/displayName";
import {
  flushDisplayNameSync,
  registerDisplayNameSync,
  removeDisplayName,
  resetDisplayNameSyncForTests,
} from "../../game/_shared/displayNameSync";
import type { StatsResponse, GameHistoryResponse, GameOutcome } from "../../api/types";

const mockNetwork = { isOnline: true };
jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => ({ isOnline: mockNetwork.isOnline, isInitialized: true }),
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

// The name sync runs for real (its one-slot queue is under test); only the HTTP calls are mocked.
const mockPutMe = jest.fn();
const mockDeleteMe = jest.fn();
const mockGetMe = jest.fn();
jest.mock("../../api/players", () => ({
  playersApi: {
    getMe: (...args: unknown[]) => mockGetMe(...args),
    putMe: (...args: unknown[]) => mockPutMe(...args),
    deleteMe: (...args: unknown[]) => mockDeleteMe(...args),
  },
}));

const NAME_KEY = "player_display_name";
const PENDING_KEY = "player_display_name_pending_sync";

// Chosen so the old and new rules disagree: Yacht has the most sessions (the
// server's favourite) but FreeCell the most completed games; 2048's raw score
// dwarfs every other game's.
const SAMPLE_STATS: StatsResponse = {
  total_games: 19,
  by_game: {
    yacht: {
      played: 7,
      best: 280,
      avg: 240,
      last_played_at: "2026-04-12T12:00:00Z",
      best_chips: null,
      current_chips: null,
      sessions: 7,
      completed: 2,
      won: null,
      lost: null,
      tied: null,
      time_played_ms: 1_800_000,
      best_value: 280,
      best_label_key: "score",
    },
    twenty48: {
      played: 2,
      best: 15240,
      avg: 12000,
      last_played_at: "2026-04-10T08:00:00Z",
      best_chips: null,
      current_chips: null,
      sessions: 2,
      completed: 2,
      won: 1,
      lost: 1,
      tied: 0,
      time_played_ms: 300_000,
      best_value: 15240,
      best_label_key: "score",
    },
    blackjack: {
      played: 4,
      best: null,
      avg: null,
      last_played_at: "2026-04-09T20:00:00Z",
      best_chips: 1450,
      current_chips: 1450,
      sessions: 4,
      completed: 4,
      won: 3,
      lost: 0,
      tied: 1,
      time_played_ms: 900_000,
      best_value: 1450,
      best_label_key: "chips",
    },
    freecell: {
      played: 6,
      best: 87,
      avg: 110,
      last_played_at: "2026-04-11T09:00:00Z",
      best_chips: null,
      current_chips: null,
      sessions: 6,
      completed: 5,
      won: null,
      lost: null,
      tied: null,
      time_played_ms: 3_600_000,
      best_value: 87,
      best_label_key: "moves",
    },
  },
  favorite_game: "yacht",
  arcade_xp: 220,
  arcade_level: 2,
  xp_into_level: 120,
  xp_for_next_level: 30,
  streak_days: 0,
};

function game(
  id: string,
  game_type: GameHistoryResponse["items"][number]["game_type"],
  final_score: number | null,
  outcome: GameOutcome | null
): GameHistoryResponse["items"][number] {
  return {
    id,
    game_type,
    started_at: "2026-04-12T12:00:00Z",
    completed_at: "2026-04-12T12:10:00Z",
    final_score,
    outcome,
    duration_ms: 600000,
    metadata: {},
    players: [],
  };
}

// One recent game per outcome.
const SAMPLE_GAMES: GameHistoryResponse = {
  items: [
    game("g1", "yacht", 280, "completed"),
    game("g2", "twenty48", 15240, "win"),
    game("g3", "blackjack", 1450, "push"),
    game("g4", "hearts", 45, "loss"),
    game("g5", "twenty48", 20480, "kept_playing"),
    game("g6", "freecell", 87, "abandoned"),
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

function tileValue(key: string) {
  return within(screen.getByTestId(`profile-tile-${key}`));
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockGetMyStats.mockResolvedValue(SAMPLE_STATS);
  mockGetMyGames.mockResolvedValue(SAMPLE_GAMES);
  mockPutMe.mockImplementation((name: string) => Promise.resolve({ display_name: name }));
  mockDeleteMe.mockResolvedValue(undefined);
  mockGetMe.mockResolvedValue({ display_name: null });
  mockNetwork.isOnline = true;
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  resetDisplayNameSyncForTests();
  setDisplayNameSaveHook(null);
});

afterAll(() => setDisplayNameSaveHook(null));

describe("ProfileScreen", () => {
  it("renders the AppHeader", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByRole("header", { name: "Profile" })).toBeTruthy();
    });
  });

  it("shows the display name field, even while stats fail to load (#2502)", async () => {
    mockGetMyStats.mockRejectedValue(new Error("Network down"));
    mockGetMyGames.mockRejectedValue(new Error("Network down"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Couldn't load recent games")).toBeTruthy();
    });
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(
      screen.getByText("Shown on leaderboards when your scores are submitted. 1–32 characters.")
    ).toBeTruthy();
  });

  it("shows a loading spinner while fetching", async () => {
    // Leave the mocks unresolved to keep loading state visible.
    mockGetMyStats.mockImplementation(() => new Promise(() => {}));
    mockGetMyGames.mockImplementation(() => new Promise(() => {}));
    await renderScreen();
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });

  it("shows only comparable tiles: sessions, completed, rate, time, games tried, favourite (#2637)", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-sessions")).toBeTruthy();
    });
    expect(tileValue("sessions").getByText("Sessions")).toBeTruthy();
    expect(tileValue("sessions").getByText("19")).toBeTruthy();
    expect(tileValue("completed").getByText("13")).toBeTruthy();
    // 13 of 19 sessions completed.
    expect(tileValue("completionRate").getByText("Completion Rate")).toBeTruthy();
    expect(tileValue("completionRate").getByText("68%")).toBeTruthy();
    // 30 + 5 + 15 + 60 minutes.
    expect(tileValue("timePlayed").getByText("1h 50m")).toBeTruthy();
    expect(tileValue("gamesTried").getByText("4")).toBeTruthy();
  });

  it("drops the cross-game Top score tile (#2637)", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-sessions")).toBeTruthy();
    });
    expect(screen.queryByText("Top Score")).toBeNull();
    expect(screen.queryByTestId("profile-tile-topScore")).toBeNull();
    // 2048's 15,240 is never shown bare, as if comparable with other games.
    expect(screen.queryByText("15,240")).toBeNull();
    expect(screen.queryByText("Games Played")).toBeNull();
  });

  it("picks the favourite by games completed, not sessions or the server's pick (#2637)", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-favorite")).toBeTruthy();
    });
    expect(tileValue("favorite").getByText("Favorite Game")).toBeTruthy();
    expect(tileValue("favorite").getByText("FreeCell")).toBeTruthy();
    expect(tileValue("favorite").queryByText("Yacht")).toBeNull();
  });

  it("shows a dash for the completion rate before any session", async () => {
    mockGetMyStats.mockResolvedValue({ ...SAMPLE_STATS, by_game: {}, favorite_game: null });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-completionRate")).toBeTruthy();
    });
    expect(tileValue("completionRate").getByText("—")).toBeTruthy();
    expect(tileValue("timePlayed").getByText("0m")).toBeTruthy();
    expect(tileValue("favorite").getByText("None yet")).toBeTruthy();
  });

  it("lists each game's own best with its label (#2637)", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeTruthy();
    });
    expect(within(screen.getByTestId("profile-game-freecell")).getByText("87 moves")).toBeTruthy();
    expect(within(screen.getByTestId("profile-game-yacht")).getByText("280 pts")).toBeTruthy();
    expect(
      within(screen.getByTestId("profile-game-twenty48")).getByText("15,240 pts")
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("profile-game-blackjack")).getByText("1,450 chips")
    ).toBeTruthy();
  });

  it("shows each game's win rate, or a dash for a score-only game (#2637)", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeTruthy();
    });
    // won / (won + lost + tied): 1/2 and 3/4.
    expect(within(screen.getByTestId("profile-game-twenty48")).getByText("50%")).toBeTruthy();
    expect(within(screen.getByTestId("profile-game-blackjack")).getByText("75%")).toBeTruthy();
    // Solo Yacht and FreeCell record no win/loss: "—", never 0%.
    expect(within(screen.getByTestId("profile-game-yacht")).getByText("—")).toBeTruthy();
    expect(within(screen.getByTestId("profile-game-freecell")).getByText("—")).toBeTruthy();
    expect(screen.getByLabelText("Yacht: best 280 pts, no win rate")).toBeTruthy();
    expect(screen.getByLabelText("Blackjack: best 1,450 chips, win rate 75%")).toBeTruthy();
  });

  it("renders a glyph and a localised label for every outcome (#2637)", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    const expected: [string, GameOutcome, string][] = [
      ["g1", "completed", "Completed"],
      ["g2", "win", "Win"],
      ["g3", "push", "Tie"],
      ["g4", "loss", "Loss"],
      ["g5", "kept_playing", "Kept Playing"],
      ["g6", "abandoned", "Abandoned"],
    ];
    for (const [id, outcome, label] of expected) {
      const row = within(screen.getByTestId(`recent-game-${id}`));
      expect(row.getByTestId(`outcome-glyph-${outcome}`)).toBeTruthy();
      expect(row.getByText(label)).toBeTruthy();
    }
    // The raw outcome strings never show.
    expect(screen.queryByText("push")).toBeNull();
    expect(screen.queryByText("kept_playing")).toBeNull();
  });

  it("shows each recent game's metric with its label", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(within(screen.getByTestId("recent-game-g1")).getByText("280 pts")).toBeTruthy();
    expect(within(screen.getByTestId("recent-game-g6")).getByText("87 moves")).toBeTruthy();
    expect(within(screen.getByTestId("recent-game-g3")).getByText("1,450 chips")).toBeTruthy();
  });

  it("labels a recent-game row by board metric from metadata (Bottle Sort's level)", async () => {
    mockGetMyGames.mockResolvedValue({
      items: [{ ...game("s1", "sort", 0, "completed"), metadata: { level_reached: 19 } }],
      next_cursor: null,
    });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("recent-game-s1")).toBeTruthy();
    });
    expect(within(screen.getByTestId("recent-game-s1")).getByText("Level 19")).toBeTruthy();
  });

  it("navigates to GameDetail when a row is pressed", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    const row = screen.getByLabelText(/^Yacht, 280 pts, Completed/);
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
    expect(screen.queryByText("Your Games")).toBeNull();
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
      expect(screen.getByText("Sessions")).toBeTruthy();
    });
  });

  it("shows game history without tiles when only stats fails", async () => {
    mockGetMyStats.mockRejectedValue(new Error("500 server error"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(screen.queryByText("Sessions")).toBeNull();
    expect(screen.queryByText("Your Games")).toBeNull();
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

  it("renders from a server that predates the XP and comparable fields (#2391, #2620)", async () => {
    const legacy = {
      total_games: 3,
      by_game: {
        yacht: {
          played: 3,
          best: 280,
          avg: 240,
          last_played_at: "2026-04-12T12:00:00Z",
          best_chips: null,
          current_chips: null,
        },
      },
      favorite_game: "yacht",
    };
    mockGetMyStats.mockResolvedValue(legacy as unknown as StatsResponse);
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-sessions")).toBeTruthy();
    });
    expect(screen.queryByRole("progressbar")).toBeNull();
    // `played` is an honest session count…
    expect(tileValue("sessions").getByText("3")).toBeTruthy();
    // …but includes abandons, so it never stands in for `completed`.
    expect(tileValue("completed").getByText("—")).toBeTruthy();
    expect(tileValue("completionRate").getByText("—")).toBeTruthy();
    expect(tileValue("completionRate").queryByText("100%")).toBeNull();
    expect(tileValue("favorite").getByText("—")).toBeTruthy();
    expect(tileValue("favorite").queryByText("Yacht")).toBeNull();
    expect(within(screen.getByTestId("profile-game-yacht")).getAllByText("—")).toHaveLength(2);
  });

  it("breaks a favourite tie like the Your Games list: completed, sessions, then slug", async () => {
    const base = SAMPLE_STATS.by_game.yacht;
    mockGetMyStats.mockResolvedValue({
      ...SAMPLE_STATS,
      by_game: {
        yacht: { ...base, sessions: 5, completed: 3 },
        freecell: { ...base, sessions: 4, completed: 3 },
        twenty48: { ...base, sessions: 5, completed: 3 },
      },
      favorite_game: "yacht",
    });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-favorite")).toBeTruthy();
    });
    // 2048 and Yacht tie on completed and sessions; "twenty48" sorts before "yacht".
    expect(tileValue("favorite").getByText("2048")).toBeTruthy();
    const order = screen.getAllByTestId(/^profile-game-/).map((row) => row.props.testID as string);
    expect(order).toEqual(["profile-game-twenty48", "profile-game-yacht", "profile-game-freecell"]);
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

  it("shows tiles and an inline games error when only games fails", async () => {
    mockGetMyGames.mockRejectedValue(new Error("500 server error"));
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Sessions")).toBeTruthy();
    });
    expect(screen.getByText("Couldn't load recent games")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
    expect(screen.queryByTestId("recent-game-g1")).toBeNull();
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
      expect(screen.getByText("Sessions")).toBeTruthy();
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

  it("reloads on pull-to-refresh", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Sessions")).toBeTruthy();
    });
    // The RefreshControl itself doesn't render under Jest; its handler rides on the list.
    const { refreshControl } = screen.getByTestId("profile-list").props;
    await act(async () => {
      await refreshControl.props.onRefresh();
    });
    expect(mockGetMyStats).toHaveBeenCalledTimes(2);
    expect(mockGetMyGames).toHaveBeenCalledTimes(2);
  });
});

describe("ProfileScreen — Remove my name from leaderboards (#2637)", () => {
  const REMOVE = "Remove my name from leaderboards";
  const NOT_ON_BOARDS = "You're not on any leaderboard. Save a name to join them.";
  const REMOVING = "Removing your name… It will sync when you're back online.";

  async function renderWithName(name = "Riley") {
    await AsyncStorage.setItem(NAME_KEY, name);
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText(REMOVE)).toBeTruthy();
    });
  }

  async function confirmRemoval() {
    await fireEvent.press(screen.getByTestId("profile-remove-name"));
    expect(screen.getByText("Remove your name?")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId("profile-remove-name-confirm-confirm"));
    });
  }

  it("says the player is on no board when no name is set", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText(NOT_ON_BOARDS)).toBeTruthy();
    });
    expect(screen.queryByText(REMOVE)).toBeNull();
  });

  it("clears the name locally and on the server after confirming", async () => {
    await renderWithName();
    expect(screen.getByLabelText("Display name").props.value).toBe("Riley");

    await confirmRemoval();

    await waitFor(() => expect(mockDeleteMe).toHaveBeenCalledTimes(1));
    expect(screen.getByText(NOT_ON_BOARDS)).toBeTruthy();
    expect(screen.queryByText(REMOVE)).toBeNull();
    expect(screen.getByLabelText("Display name").props.value).toBe("");
    await expect(AsyncStorage.getItem(NAME_KEY)).resolves.toBeNull();
  });

  it("changes nothing when the player cancels", async () => {
    await renderWithName();
    await fireEvent.press(screen.getByTestId("profile-remove-name"));
    await fireEvent.press(screen.getByTestId("profile-remove-name-confirm-cancel"));

    expect(mockDeleteMe).not.toHaveBeenCalled();
    expect(screen.getByText(REMOVE)).toBeTruthy();
    await expect(AsyncStorage.getItem(NAME_KEY)).resolves.toBe("Riley");
  });

  it("sends an offline removal when the device reconnects", async () => {
    mockDeleteMe.mockRejectedValueOnce(new TypeError("Network request failed"));
    await renderWithName();

    await confirmRemoval();

    // The DELETE failed and is pending: Profile says so, not "on no board".
    await waitFor(() => expect(mockDeleteMe).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await AsyncStorage.getItem(PENDING_KEY)).not.toBeNull());
    expect(screen.getByText(REMOVING)).toBeTruthy();
    expect(screen.queryByText(NOT_ON_BOARDS)).toBeNull();
    expect(screen.queryByText(REMOVE)).toBeNull();

    // Reconnect: NetworkContext flushes the name sync.
    await act(async () => {
      await expect(flushDisplayNameSync()).resolves.toBe(true);
    });
    expect(mockDeleteMe).toHaveBeenCalledTimes(2);
    await expect(AsyncStorage.getItem(PENDING_KEY)).resolves.toBeNull();
    await waitFor(() => expect(screen.getByText(NOT_ON_BOARDS)).toBeTruthy());
    expect(screen.queryByText(REMOVING)).toBeNull();
  });

  it("shows the removal as pending when Profile opens with one still queued", async () => {
    await AsyncStorage.setItem(NAME_KEY, "Riley");
    mockDeleteMe.mockRejectedValue(new TypeError("Network request failed"));
    await removeDisplayName();
    await flushDisplayNameSync();
    resetDisplayNameSyncForTests(); // a fresh screen reads the slot from storage

    await renderScreen();

    await waitFor(() => expect(screen.getByText(REMOVING)).toBeTruthy());
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("shows a name the server still has when the device has none, and removes it", async () => {
    mockGetMe.mockResolvedValue({ display_name: "Riley" });
    await renderScreen();

    await waitFor(() => {
      expect(screen.getByText("On leaderboards as “Riley”.")).toBeTruthy();
    });
    expect(screen.getByText(REMOVE)).toBeTruthy();
    expect(screen.queryByText(NOT_ON_BOARDS)).toBeNull();

    mockGetMe.mockResolvedValue({ display_name: null });
    await confirmRemoval();

    await waitFor(() => expect(mockDeleteMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(NOT_ON_BOARDS)).toBeTruthy());
    expect(screen.queryByText("On leaderboards as “Riley”.")).toBeNull();
  });

  it("doesn't ask the server while offline", async () => {
    mockNetwork.isOnline = false;
    mockGetMe.mockResolvedValue({ display_name: "Riley" });
    await renderScreen();
    await waitFor(() => expect(screen.getByText(NOT_ON_BOARDS)).toBeTruthy());
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("doesn't ask the server when the device has a name", async () => {
    await renderWithName();
    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("lets the existing name editor set a name again afterwards", async () => {
    registerDisplayNameSync(); // as NetworkContext does at load
    await renderWithName();
    await confirmRemoval();
    await waitFor(() => expect(mockDeleteMe).toHaveBeenCalledTimes(1));

    await fireEvent.changeText(screen.getByLabelText("Display name"), "Sam");
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Save"));
    });

    await waitFor(() => expect(mockPutMe).toHaveBeenCalledWith("Sam"));
    expect(screen.getByText(REMOVE)).toBeTruthy();
    expect(screen.queryByText(NOT_ON_BOARDS)).toBeNull();
  });

  it("drops a stale 'Saved' confirmation once the name is removed", async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText(NOT_ON_BOARDS)).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText("Display name"), "Riley");
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Save"));
    });
    expect(screen.getByText("Saved. Your scores will use this name.")).toBeTruthy();

    await confirmRemoval();

    await waitFor(() => expect(screen.getByText(NOT_ON_BOARDS)).toBeTruthy());
    expect(screen.queryByText("Saved. Your scores will use this name.")).toBeNull();
    expect(
      screen.getByText("Shown on leaderboards when your scores are submitted. 1–32 characters.")
    ).toBeTruthy();
  });

  it("shows an error and keeps the name when the removal can't be stored", async () => {
    await renderWithName();
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));

    await confirmRemoval();

    await waitFor(() => {
      expect(screen.getByText("Couldn't remove your name. Try again.")).toBeTruthy();
    });
    expect(screen.getByText(REMOVE)).toBeTruthy();
    expect(mockDeleteMe).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(NAME_KEY)).resolves.toBe("Riley");
  });
});

describe("ProfileScreen — store build hides premium-game history (#2390)", () => {
  beforeEach(() => {
    __forceStoreBuildForTests(true);
  });
  afterEach(() => {
    __forceStoreBuildForTests(false);
  });

  it("derives the tiles from visible games only", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-sessions")).toBeTruthy();
    });
    // Yacht 7 + 2048 2 + FreeCell 6; Blackjack's 4 are not counted.
    expect(tileValue("sessions").getByText("15")).toBeTruthy();
    expect(tileValue("completed").getByText("9")).toBeTruthy();
    expect(tileValue("completionRate").getByText("60%")).toBeTruthy();
    expect(tileValue("timePlayed").getByText("1h 35m")).toBeTruthy();
    expect(tileValue("gamesTried").getByText("3")).toBeTruthy();
  });

  it("never names a hidden game as the favourite, even with the most completed games", async () => {
    const blackjack = { ...SAMPLE_STATS.by_game.blackjack, sessions: 9, completed: 9 };
    mockGetMyStats.mockResolvedValue({
      ...SAMPLE_STATS,
      by_game: { ...SAMPLE_STATS.by_game, blackjack },
      favorite_game: "blackjack",
    });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("profile-tile-favorite")).toBeTruthy();
    });
    expect(tileValue("favorite").getByText("FreeCell")).toBeTruthy();
    expect(screen.queryByText("Blackjack")).toBeNull();
  });

  it("leaves hidden games out of the per-game list", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Your Games")).toBeTruthy();
    });
    expect(screen.getByTestId("profile-game-yacht")).toBeTruthy();
    expect(screen.queryByTestId("profile-game-blackjack")).toBeNull();
    expect(screen.queryByText("1,450 chips")).toBeNull();
  });

  it("drops hidden-game rows from the recent games list", async () => {
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(screen.getByLabelText(/^Yacht, /)).toBeTruthy();
    expect(screen.queryByTestId("recent-game-g3")).toBeNull(); // Blackjack
    expect(screen.queryByTestId("recent-game-g4")).toBeNull(); // Hearts
    expect(screen.queryByText("Blackjack")).toBeNull();
  });

  it("shows the empty state when every recent game is hidden", async () => {
    mockGetMyGames.mockResolvedValue({
      items: SAMPLE_GAMES.items.filter((g) => g.game_type === "blackjack"),
      next_cursor: null,
    });
    await renderScreen();
    await waitFor(() => {
      expect(screen.getByText("Recent Games")).toBeTruthy();
    });
    expect(screen.queryByLabelText(/^Blackjack/)).toBeNull();
    expect(screen.getByText("Play a game to see it here")).toBeTruthy();
  });
});

describe("ProfileScreen — remembers /stats/me for the stats screen (#2635)", () => {
  beforeEach(() => clearMyStatsCache());

  it("a stats screen opened offline after Profile loaded shows Profile's figures", async () => {
    await AsyncStorage.setItem("game_session_id", "session-a");
    const profile = await renderScreen();
    await waitFor(() => expect(screen.getByTestId("profile-game-freecell")).toBeTruthy());
    await profile.unmount();

    mockNetwork.isOnline = false;
    mockGetMyStats.mockClear();
    const navigation = {
      navigate: jest.fn(),
      goBack: jest.fn(),
    } as unknown as React.ComponentProps<typeof GameStatsScreen>["navigation"];
    await render(
      <ThemeProvider>
        <GameStatsScreen route={{ params: { gameType: "freecell" } }} navigation={navigation} />
      </ThemeProvider>
    );
    await act(async () => {});
    expect(screen.getByTestId("game-stats-tile-best").props.accessibilityLabel).toBe(
      "Best: 87 moves"
    );
    expect(screen.getByTestId("game-stats-stale")).toBeTruthy();
    expect(mockGetMyStats).not.toHaveBeenCalled();
  });

  it("doesn't remember a /stats/me that was in flight when the cache was cleared", async () => {
    await AsyncStorage.setItem("game_session_id", "session-a");
    let answer!: (r: StatsResponse) => void;
    mockGetMyStats.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const profile = await renderScreen();
    await waitFor(() => expect(mockGetMyStats).toHaveBeenCalledTimes(1));

    // Delete my data runs while Profile's request is out; its session is
    // replaced as well.
    clearMyStatsCache();
    await AsyncStorage.setItem("game_session_id", "session-b");
    await act(async () => {
      answer(SAMPLE_STATS);
    });
    await waitFor(() => expect(screen.getByTestId("profile-game-freecell")).toBeTruthy());
    await profile.unmount();

    mockNetwork.isOnline = false;
    const navigation = {
      navigate: jest.fn(),
      goBack: jest.fn(),
    } as unknown as React.ComponentProps<typeof GameStatsScreen>["navigation"];
    await render(
      <ThemeProvider>
        <GameStatsScreen route={{ params: { gameType: "freecell" } }} navigation={navigation} />
      </ThemeProvider>
    );
    await act(async () => {});
    expect(screen.queryByTestId("game-stats-tile-best")).toBeNull();
    expect(screen.getByText("You're offline. Your stats load when you reconnect.")).toBeTruthy();
  });
});
