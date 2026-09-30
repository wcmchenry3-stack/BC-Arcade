import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ApiError } from "../../game/_shared/httpClient";
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

  it("retries a failed load", async () => {
    mockGetGameDetail.mockRejectedValueOnce(new Error("boom"));
    await renderScreen();
    const retry = await screen.findByText("Retry");
    await fireEvent.press(retry);
    await waitFor(() => {
      expect(screen.getByText("280 pts")).toBeTruthy();
    });
    expect(mockGetGameDetail).toHaveBeenCalledTimes(2);
  });

  it("says so when offline, with Retry", async () => {
    mockGetGameDetail.mockRejectedValue(new TypeError("Failed to fetch"));
    await renderScreen();
    expect(await screen.findByText("You're offline. Connect to load this game.")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  // Owner-only (#2840): the server's 403 for another session's game shows an
  // error and nothing about the game, and Retry wouldn't change that.
  it.each([403, 404])("shows only an error, no data, for a %s", async (status) => {
    mockGetGameDetail.mockRejectedValue(
      new ApiError("Game belongs to a different session.", status)
    );
    await renderScreen();
    expect(await screen.findByText("Couldn't load this game")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
    expect(screen.queryByText("Game")).toBeNull();
    expect(screen.queryByText("Final Score")).toBeNull();
    expect(screen.queryByTestId("detail-facts")).toBeNull();
  });
});

// ─── Saved breakdowns (#2840) ────────────────────────────────────────────────

async function renderGame(overrides: Partial<GameDetailResponse>) {
  mockGetGameDetail.mockResolvedValue({ ...SAMPLE_DETAIL, ...overrides });
  await renderScreen();
  await screen.findByText("Final Score");
}

describe("GameDetailScreen — Hearts hand table", () => {
  const HANDS = [
    [3, 13, 5, 5],
    [0, 26, 26, 26], // the human shot the moon
    [10, 2, 14, 0],
  ];
  const HEARTS = {
    game_type: "hearts" as const,
    final_score: 87,
    outcome: "win" as const,
    metadata: {
      final_score: 87,
      vs_result: "win",
      hand_scores: HANDS,
      final_scores: [13, 41, 45, 31],
      human_seat: 0,
    },
  };

  it("shows each hand for You and three numbered opponents, then totals", async () => {
    await renderGame(HEARTS);
    expect(screen.getByText("Hand by Hand")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Opp. 1")).toBeTruthy();
    expect(screen.getByText("Opp. 3")).toBeTruthy();
    const totals = screen.getByTestId("hearts-totals");
    expect(totals.props.accessibilityLabel).toBe(
      "Totals: You: 13, Opponent 1: 41, Opponent 2: 45, Opponent 3: 31"
    );
    expect(screen.getByTestId("hearts-hand-1").props.accessibilityLabel).toBe(
      "Hand 1: You: 3, Opponent 1: 13, Opponent 2: 5, Opponent 3: 5"
    );
    expect(screen.queryByTestId("detail-no-breakdown")).toBeNull();
    expect(screen.queryByText(/may not fully explain/)).toBeNull();
  });

  it("marks the column-header row as a header", async () => {
    await renderGame(HEARTS);
    expect(
      screen.getByRole("header", { name: "Hand, You, Opponent 1, Opponent 2, Opponent 3" })
    ).toBeTruthy();
  });

  it("marks a moon hand and explains the mark", async () => {
    await renderGame(HEARTS);
    expect(screen.getByTestId("hearts-moon-2")).toHaveTextContent("★ 0");
    expect(screen.getByTestId("hearts-hand-2").props.accessibilityLabel).toMatch(
      /You shot the moon!$/
    );
    expect(screen.queryByTestId("hearts-moon-1")).toBeNull();
    expect(screen.getByText(/shooter zeroes/)).toBeTruthy();
  });

  it("puts the human first when they aren't seat 0", async () => {
    await renderGame({
      ...HEARTS,
      metadata: { ...HEARTS.metadata, human_seat: 2 },
    });
    expect(screen.getByTestId("hearts-totals").props.accessibilityLabel).toBe(
      "Totals: You: 45, Opponent 1: 13, Opponent 2: 41, Opponent 3: 31"
    );
  });

  it("shows a note, not a zeroed table, when the server dropped the breakdown", async () => {
    await renderGame({ ...HEARTS, metadata: { final_score: 87, vs_result: "win" } });
    expect(screen.getByText("No score breakdown was saved for this game.")).toBeTruthy();
    expect(screen.queryByText("Hand by Hand")).toBeNull();
    // The total is still shown.
    expect(screen.getByText("87 pts")).toBeTruthy();
  });

  it("shows an abandoned game's hands played as a fact", async () => {
    await renderGame({ ...HEARTS, outcome: "abandoned", metadata: { hands_played: 4 } });
    expect(screen.getByTestId("fact-hands_played").props.accessibilityLabel).toBe(
      "Hands played: 4"
    );
  });
});

describe("GameDetailScreen — Yacht scorecard", () => {
  const FULL = {
    categories: {
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 12,
      three_of_a_kind: 22,
      four_of_a_kind: 0,
      full_house: 25,
      small_straight: 30,
      large_straight: 40,
      yacht: 50,
      chance: 20,
    },
    upper_bonus: 0,
    yacht_bonus_count: 1,
    yacht_bonus_total: 100,
  };
  // 57 upper (no bonus) + 187 lower + 100 = 344
  const SOLO = {
    game_type: "yacht" as const,
    final_score: 344,
    metadata: { scorecard: FULL, scorecard_reconciled: true, upper_bonus: 0 },
  };

  it("shows a solo card: categories, subtotals, bonuses and total", async () => {
    await renderGame(SOLO);
    expect(screen.getByText("Scorecard")).toBeTruthy();
    expect(screen.getByText("Upper Section")).toBeTruthy();
    expect(screen.getByText("Lower Section")).toBeTruthy();
    expect(screen.getByTestId("yacht-cat-sixes").props.accessibilityLabel).toBe("Sixes, You: 12");
    expect(screen.getByTestId("yacht-upper-subtotal").props.accessibilityLabel).toBe(
      "Upper subtotal, You: 57"
    );
    expect(screen.getByTestId("yacht-yacht-bonus").props.accessibilityLabel).toBe(
      "Yacht Bonus, You: 100"
    );
    expect(screen.getByTestId("yacht-total").props.accessibilityLabel).toBe("Total, You: 344");
    expect(screen.queryByText("CPU")).toBeNull();
    expect(screen.queryByText(/may not fully explain/)).toBeNull();
    // The card covers the bonuses: no legacy facts.
    expect(screen.queryByTestId("detail-facts")).toBeNull();
  });

  it("shows the computer's card beside the player's in a vs game", async () => {
    const cpu = { ...FULL, yacht_bonus_count: 0, yacht_bonus_total: 0 };
    await renderGame({
      ...SOLO,
      outcome: "win",
      metadata: { ...SOLO.metadata, opponent_scorecard: cpu, opponent_score: 244 },
    });
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByTestId("yacht-total").props.accessibilityLabel).toBe(
      "Total, You: 344, CPU: 244"
    );
  });

  it("shows a partial card's unfilled categories as a dash, not 0", async () => {
    await renderGame({
      ...SOLO,
      outcome: "abandoned",
      final_score: 9,
      metadata: { scorecard: { categories: { ones: 3, twos: 6 } }, scorecard_reconciled: true },
    });
    expect(screen.getByTestId("yacht-cat-chance").props.accessibilityLabel).toBe(
      "Chance, You: not available"
    );
    expect(screen.getByTestId("yacht-cat-twos").props.accessibilityLabel).toBe("Twos, You: 6");
    expect(screen.getByText(/A dash marks a category/)).toBeTruthy();
  });

  it("notes a card that doesn't add up to the final score, and still shows it", async () => {
    await renderGame({ ...SOLO, final_score: 400 });
    expect(screen.getByTestId("yacht-total")).toBeTruthy();
    expect(screen.getByText("This breakdown may not fully explain the final score.")).toBeTruthy();
  });

  it("checks the card itself, not the server's flag, when it has a score to check against", async () => {
    await renderGame({ ...SOLO, metadata: { ...SOLO.metadata, scorecard_reconciled: false } });
    expect(screen.queryByText(/may not fully explain/)).toBeNull();
  });

  it("falls back to the server's flag with no final score to check against", async () => {
    await renderGame({
      ...SOLO,
      final_score: null,
      metadata: { ...SOLO.metadata, scorecard_reconciled: false },
    });
    expect(screen.getByText("This breakdown may not fully explain the final score.")).toBeTruthy();
  });

  it("notes an upper bonus the card doesn't earn", async () => {
    await renderGame({
      ...SOLO,
      final_score: 379,
      metadata: { ...SOLO.metadata, scorecard: { ...FULL, upper_bonus: 35 } },
    });
    expect(screen.getByText("This breakdown may not fully explain the final score.")).toBeTruthy();
  });

  it("notes only the vs card that doesn't reconcile", async () => {
    const cpu = { ...FULL, yacht_bonus_count: 0, yacht_bonus_total: 0 };
    await renderGame({
      ...SOLO,
      outcome: "win",
      metadata: { ...SOLO.metadata, opponent_scorecard: cpu, opponent_score: 300 },
    });
    expect(screen.getByText("The computer's card may not fully explain its score.")).toBeTruthy();
    expect(screen.queryByText("Your card may not fully explain your score.")).toBeNull();
    expect(screen.queryByText(/This breakdown may not/)).toBeNull();
  });

  it("keeps the computer's score as a fact when its card wasn't saved", async () => {
    await renderGame({
      ...SOLO,
      outcome: "win",
      metadata: { ...SOLO.metadata, opponent_scorecard: "junk", opponent_score: 244 },
    });
    expect(screen.queryByText("CPU")).toBeNull();
    expect(screen.getByTestId("fact-opponent_score").props.accessibilityLabel).toBe(
      "Computer's score: 244"
    );
    expect(screen.queryByTestId("fact-upper_bonus")).toBeNull();
  });

  it("shows a legacy game's total and saved bonus, with no invented card", async () => {
    await renderGame({
      ...SOLO,
      metadata: { upper_bonus: 35, yacht_bonus_total: 0, scorecard_reconciled: false },
    });
    expect(screen.getByText("344 pts")).toBeTruthy();
    expect(screen.getByText("No score breakdown was saved for this game.")).toBeTruthy();
    expect(screen.queryByTestId("detail-yacht")).toBeNull();
    expect(screen.getByTestId("fact-upper_bonus").props.accessibilityLabel).toBe("Upper bonus: 35");
  });
});

describe("GameDetailScreen — Star Swarm points by wave", () => {
  const BREAKDOWN = {
    v: 1,
    earlier: { first: 1, last: 12, total: 30000, pts: { Grunt: 20000, clear: 10000 } },
    waves: [
      {
        wave: 13,
        start: 30000,
        end: 33400,
        total: 3400,
        pts: { "Elite:dive": 800, Carrier: 2000, "Warden:zap": 600 },
      },
    ],
  };
  const RUN = {
    game_type: "starswarm" as const,
    final_score: 33400,
    metadata: { difficulty_tier: "Captain", wave_reached: 14, score_breakdown: BREAKDOWN },
  };

  it("folds earlier waves into one row and lists each wave's sources", async () => {
    await renderGame(RUN);
    expect(screen.getByText("Points by Wave")).toBeTruthy();
    expect(screen.getByText("Waves 1–12")).toBeTruthy();
    expect(screen.getByText("Wave 13")).toBeTruthy();
    expect(screen.getByTestId("starswarm-row-1-12").props.accessibilityLabel).toBe(
      "Waves 1–12: 30,000 pts, Grunt: 20,000, Wave clear: 10,000"
    );
    expect(screen.getByText("Elite · dive 800")).toBeTruthy();
    expect(screen.getByText("Carrier 2,000")).toBeTruthy();
    expect(screen.queryByText(/may not fully explain/)).toBeNull();
    expect(screen.getByTestId("fact-wave_reached").props.accessibilityLabel).toBe(
      "Wave reached: 14"
    );
  });

  it("shows a source it doesn't know by its id rather than hiding it", async () => {
    await renderGame(RUN);
    expect(screen.getByText("Warden · zap 600")).toBeTruthy();
  });

  it("shows unattributed points as their own row and notes a mismatch", async () => {
    await renderGame({
      ...RUN,
      final_score: 34000,
      metadata: { ...RUN.metadata, score_breakdown: { ...BREAKDOWN, unattributed: 100 } },
    });
    expect(screen.getByTestId("starswarm-row-other").props.accessibilityLabel).toBe(
      "Other points: 100 pts"
    );
    // 30,000 + 3,400 + 100 ≠ 34,000
    expect(screen.getByText("This breakdown may not fully explain the final score.")).toBeTruthy();
  });

  it("shows a note for a run with a null (dropped) breakdown", async () => {
    await renderGame({ ...RUN, metadata: { ...RUN.metadata, score_breakdown: null } });
    expect(screen.getByText("No score breakdown was saved for this game.")).toBeTruthy();
    expect(screen.queryByTestId("detail-starswarm")).toBeNull();
    expect(screen.getByText("33,400 pts")).toBeTruthy();
  });

  it("shows a run that scored nothing as such, not as a missing breakdown", async () => {
    await renderGame({
      ...RUN,
      final_score: 0,
      metadata: { ...RUN.metadata, score_breakdown: { v: 1, waves: [] } },
    });
    expect(screen.getByText("No points scored")).toBeTruthy();
    expect(screen.queryByTestId("detail-no-breakdown")).toBeNull();
    expect(screen.queryByText(/may not fully explain/)).toBeNull();
  });

  it("says nothing about a missing breakdown for an unfinished run", async () => {
    await renderGame({ ...RUN, completed_at: null, outcome: null, metadata: {} });
    expect(screen.queryByTestId("detail-no-breakdown")).toBeNull();
  });
});

describe("GameDetailScreen — facts for other games", () => {
  it.each([
    ["sort", { level_reached: 12, level: 12, moves: 31, undos: 2 }, ["Moves: 31", "Undos: 2"]],
    ["twenty48", { highest_tile: 2048, move_count: 900 }, ["Highest Tile: 2,048", "Moves: 900"]],
    ["cascade", { total_drops: 55, total_merges: 40 }, ["Drops: 55", "Merges: 40"]],
  ] as const)("shows %s's saved numbers", async (game_type, metadata, labels) => {
    await renderGame({ game_type, final_score: 100, metadata });
    for (const label of labels) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.queryByTestId("detail-no-breakdown")).toBeNull();
  });

  it("never shows keys it doesn't know, or non-numbers", async () => {
    await renderGame({
      game_type: "cascade",
      final_score: 100,
      metadata: { total_drops: "55", theme: "fruits", secret_blob: { a: 1 }, total_merges: 3 },
    });
    expect(screen.getByLabelText("Merges: 3")).toBeTruthy();
    expect(screen.queryByTestId("fact-total_drops")).toBeNull();
    expect(screen.queryByText(/fruits|secret_blob/)).toBeNull();
  });

  it("shows FreeCell's moves", async () => {
    await renderGame({
      game_type: "freecell",
      final_score: 87,
      metadata: { won: true, moves: 87 },
    });
    expect(screen.getByLabelText("Moves: 87")).toBeTruthy();
  });

  it("shows no facts card or breakdown note for a game with neither", async () => {
    await renderGame({ game_type: "daily_word", final_score: null, metadata: { guesses_used: 4 } });
    expect(screen.queryByTestId("detail-facts")).toBeNull();
    expect(screen.queryByTestId("detail-no-breakdown")).toBeNull();
  });
});
