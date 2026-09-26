import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import LeaderboardScreen from "../LeaderboardScreen";
import type { GameLeaderboardEntry, GameLeaderboardResponse } from "../../api/types";
import type { GameType } from "../../api/vocab";
import { ApiError } from "../../game/_shared/httpClient";
import { __forceStoreBuildForTests } from "../../entitlements/gameVisibility";
import type { LeaderboardParams } from "../../types/navigation";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const mockGetLeaderboard = jest.fn();
jest.mock("../../api/stats", () => ({
  statsApi: { getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args) },
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../../game/_shared/NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

function entry(
  rank: number,
  player_name: string,
  value: number,
  extra: Partial<GameLeaderboardEntry> = {}
): GameLeaderboardEntry {
  return { rank, player_name, value, completed_at: "2026-09-01T12:00:00Z", is_me: false, ...extra };
}

function board(
  entries: GameLeaderboardEntry[],
  me: GameLeaderboardEntry | null = null
): GameLeaderboardResponse {
  return { game_type: "x", partition: {}, label_key: "score", entries, me };
}

// The card's sync before a post-sync refetch (#2633): held open by tests.
const mockFlushQueuedGames = jest.fn(() => Promise.resolve());
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: () => mockFlushQueuedGames(),
}));
jest.mock("../../game/_shared/displayNameSync", () => ({
  flushDisplayNameSync: () => Promise.resolve(true),
}));

const goBack = jest.fn();
// Live navigation listeners, so a test can leave and come back.
const navListeners = new Map<string, Set<() => void>>();
const navigation = {
  goBack,
  addListener: (event: "focus" | "blur", cb: () => void) => {
    const set = navListeners.get(event) ?? new Set();
    set.add(cb);
    navListeners.set(event, set);
    return () => {
      set.delete(cb);
    };
  },
};

async function emitNav(event: "focus" | "blur") {
  await act(async () => {
    for (const cb of [...(navListeners.get(event) ?? [])]) cb();
  });
}

async function renderScreen(params: LeaderboardParams) {
  const result = await render(
    <ThemeProvider>
      <LeaderboardScreen route={{ params }} navigation={navigation} />
    </ThemeProvider>
  );
  await act(async () => {});
  return result;
}

async function renderBoard(gameType: GameType, partition?: Record<string, string>) {
  return renderScreen({ gameType, ...(partition ? { partition } : {}) });
}

beforeEach(() => {
  jest.clearAllMocks();
  navListeners.clear();
  mockGetLeaderboard.mockReset();
  mockGetLeaderboard.mockResolvedValue(board([]));
  mockNetwork.isOnline = true;
  mockNetwork.isInitialized = true;
});

afterEach(() => __forceStoreBuildForTests(false));

describe("LeaderboardScreen — header and states", () => {
  it("titles the screen with the game and gives it a header role", async () => {
    await renderBoard("freecell");
    expect(
      screen.getAllByRole("header").some((h) => h.props.children === "FreeCell Leaderboard")
    ).toBe(true);
  });

  it("goes back from a game's board", async () => {
    await renderBoard("freecell");
    await fireEvent.press(screen.getByRole("button", { name: "Back to FreeCell" }));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  // The Ranks tab is gone (#2634): Star Swarm's board opens from the game like
  // any other, on its default tier, and always has a way back.
  it("opens Star Swarm's board on the default tier, with a back button", async () => {
    mockGetLeaderboard.mockResolvedValue(board([entry(1, "Ace", 15000)]));
    await renderBoard("starswarm");
    expect(await screen.findByText("Ace")).toBeTruthy();
    expect(mockGetLeaderboard).toHaveBeenCalledWith(
      "starswarm",
      { difficulty_tier: "LieutenantJG" },
      { limit: 50 }
    );
    expect(
      screen.getAllByRole("header").some((h) => h.props.children === "Star Swarm Leaderboard")
    ).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Back to Star Swarm" }));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it("shows a loading indicator until the board arrives", async () => {
    mockGetLeaderboard.mockImplementation(() => new Promise(() => {}));
    await renderBoard("freecell");
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });

  it("shows the empty state for a board with no one on it", async () => {
    await renderBoard("solitaire");
    expect(
      await screen.findByText("No one is on this board yet. Finish a game to claim the top spot.")
    ).toBeTruthy();
    expect(screen.queryByTestId("leaderboard-columns")).toBeNull();
  });

  it("shows the error state with Retry, which loads the board again", async () => {
    mockGetLeaderboard.mockRejectedValueOnce(new ApiError("boom", 500));
    await renderBoard("solitaire");
    expect(await screen.findByText("Couldn't load the leaderboard.")).toBeTruthy();

    mockGetLeaderboard.mockResolvedValueOnce(board([entry(1, "Alice", 900)]));
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(2);
  });

  it("shows the offline state and loads the board on reconnect", async () => {
    mockNetwork.isOnline = false;
    mockGetLeaderboard.mockResolvedValue(board([entry(1, "Alice", 900)]));
    const { rerender } = await renderBoard("solitaire");
    expect(
      screen.getByText("You're offline. The leaderboard loads when you reconnect.")
    ).toBeTruthy();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();

    mockNetwork.isOnline = true;
    await rerender(
      <ThemeProvider>
        <LeaderboardScreen route={{ params: { gameType: "solitaire" } }} navigation={navigation} />
      </ThemeProvider>
    );
    expect(await screen.findByText("Alice")).toBeTruthy();
  });

  it.each(["blackjack", "daily_word"] as GameType[])(
    "shows no board for %s, whose board is disabled",
    async (gameType) => {
      await renderBoard(gameType);
      expect(screen.getByText("This game has no leaderboard.")).toBeTruthy();
      expect(mockGetLeaderboard).not.toHaveBeenCalled();
    }
  );

  it("shows no board, and a way back, when opened without params", async () => {
    await render(
      <ThemeProvider>
        <LeaderboardScreen
          route={{} as unknown as { params: LeaderboardParams }}
          navigation={navigation}
        />
      </ThemeProvider>
    );
    expect(screen.getByText("This game has no leaderboard.")).toBeTruthy();
    expect(screen.getAllByRole("header").some((h) => h.props.children === "Leaderboard")).toBe(
      true
    );
    await fireEvent.press(screen.getByRole("button", { name: "Go back to home screen" }));
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
  });

  it("shows no board for a game hidden in a store build", async () => {
    __forceStoreBuildForTests(true);
    await renderBoard("cascade");
    expect(screen.getByText("This game has no leaderboard.")).toBeTruthy();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
  });
});

// The column header row is hidden from screen readers (each row announces its
// own labels), so queries on it must include hidden elements.
const HIDDEN = { includeHiddenElements: true } as const;

/** A partition picker: a radio group named after its key. */
function picker(key: string) {
  const group = screen.getByTestId(`leaderboard-partition-${key}`);
  expect(group.props.accessibilityRole).toBe("radiogroup");
  return group;
}

describe("LeaderboardScreen — columns and labels", () => {
  const ROWS = [entry(1, "Alice", 1200), entry(2, "Bob", 900)];

  it("shows rank, player, the metric labelled by the board and the date", async () => {
    mockGetLeaderboard.mockResolvedValue(board(ROWS));
    await renderBoard("solitaire");
    const columns = await screen.findByTestId("leaderboard-columns", HIDDEN);
    expect(within(columns).getByText("#", HIDDEN)).toBeTruthy();
    expect(within(columns).getByText("Player", HIDDEN)).toBeTruthy();
    expect(within(columns).getByText("Score", HIDDEN)).toBeTruthy();
    expect(within(columns).getByText("Date", HIDDEN)).toBeTruthy();
    expect(screen.getByText((1200).toLocaleString())).toBeTruthy();
    // A desc board says nothing about direction.
    expect(screen.queryByTestId("leaderboard-direction")).toBeNull();
  });

  it("labels FreeCell's metric Moves and says lower is better (asc board)", async () => {
    mockGetLeaderboard.mockResolvedValue(board([entry(1, "Fast", 80), entry(2, "Slow", 140)]));
    await renderBoard("freecell");
    const columns = await screen.findByTestId("leaderboard-columns", HIDDEN);
    expect(within(columns).getByText("Moves", HIDDEN)).toBeTruthy();
    expect(screen.getByTestId("leaderboard-direction")).toHaveTextContent("Lower is better");
  });

  it("labels Sort's metric Level", async () => {
    mockGetLeaderboard.mockResolvedValue(board([entry(1, "Alice", 23)]));
    await renderBoard("sort");
    const columns = await screen.findByTestId("leaderboard-columns", HIDDEN);
    expect(within(columns).getByText("Level", HIDDEN)).toBeTruthy();
    expect(screen.getByText("23")).toBeTruthy();
  });

  it("is a list whose rows announce their rank with the row", async () => {
    mockGetLeaderboard.mockResolvedValue(board(ROWS));
    await renderBoard("solitaire");
    await screen.findByText("Alice");
    expect(screen.getByTestId("leaderboard-list").props.accessibilityRole).toBe("list");
    expect(screen.getByLabelText(/^Rank 1, Alice, Score 1,?200, /)).toBeTruthy();
    expect(screen.getByLabelText(/^Rank 2, Bob, Score 900, /)).toBeTruthy();
  });

  it("uses the server's ranks, so tied players share one", async () => {
    mockGetLeaderboard.mockResolvedValue(
      board([entry(1, "Alice", 500), entry(1, "Bob", 500), entry(3, "Cara", 100)])
    );
    await renderBoard("solitaire");
    await screen.findByText("Cara");
    expect(screen.getAllByText("1")).toHaveLength(2);
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("LeaderboardScreen — partitions", () => {
  it("has no picker for an unpartitioned board and sends no partition", async () => {
    await renderBoard("freecell");
    expect(screen.queryAllByTestId(/^leaderboard-partition-/)).toHaveLength(0);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(mockGetLeaderboard).toHaveBeenCalledWith("freecell", {}, { limit: 50 });
  });

  it("offers Sudoku's difficulty and variant as chips, starting on the board's defaults", async () => {
    await renderBoard("sudoku");
    expect(picker("difficulty").props.accessibilityLabel).toBe("Difficulty");
    expect(picker("variant").props.accessibilityLabel).toBe("Variant");
    for (const label of ["Easy", "Medium", "Hard", "Classic 9×9", "Mini 6×6"]) {
      expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("radio", { name: "Easy" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Classic 9×9" })).toBeChecked();
    expect(mockGetLeaderboard).toHaveBeenCalledWith(
      "sudoku",
      { difficulty: "easy", variant: "classic" },
      { limit: 50 }
    );
  });

  it("opens on the partition it was given, and a chip switches board", async () => {
    await renderBoard("sudoku", { difficulty: "hard", variant: "mini" });
    expect(screen.getByRole("radio", { name: "Hard" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Mini 6×6" })).toBeChecked();
    expect(mockGetLeaderboard).toHaveBeenLastCalledWith(
      "sudoku",
      { difficulty: "hard", variant: "mini" },
      { limit: 50 }
    );

    await fireEvent.press(screen.getByRole("radio", { name: "Medium" }));
    await waitFor(() =>
      expect(mockGetLeaderboard).toHaveBeenLastCalledWith(
        "sudoku",
        { difficulty: "medium", variant: "mini" },
        { limit: 50 }
      )
    );
    expect(screen.getByRole("radio", { name: "Medium" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hard" })).not.toBeChecked();
  });

  it("ignores a partition value the board has no board for", async () => {
    await renderBoard("starswarm", { difficulty_tier: "captain" });
    expect(mockGetLeaderboard).toHaveBeenCalledWith(
      "starswarm",
      { difficulty_tier: "LieutenantJG" },
      { limit: 50 }
    );
  });

  it("offers Star Swarm's ten tiers under Tier", async () => {
    await renderBoard("starswarm", { difficulty_tier: "Captain" });
    const group = picker("difficulty_tier");
    expect(group.props.accessibilityLabel).toBe("Tier");
    expect(within(group).getAllByRole("radio")).toHaveLength(10);
    expect(screen.getByRole("radio", { name: "Captain" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Lieutenant J.G." })).toBeTruthy();
  });
});

describe("LeaderboardScreen — your best", () => {
  it("highlights the player's own row when it is in the list, and pins nothing", async () => {
    const mine = entry(2, "Me", 700, { is_me: true });
    mockGetLeaderboard.mockResolvedValue(board([entry(1, "Alice", 900), mine], mine));
    await renderBoard("solitaire");
    const row = await screen.findByTestId("leaderboard-row-me");
    expect(within(row).getByText("Me")).toBeTruthy();
    expect(within(row).getByText("You")).toBeTruthy();
    expect(row.props.accessibilityLabel).toMatch(/^Rank 2, Me, you, Score 700, /);
    expect(screen.queryByText("Your best")).toBeNull();
    expect(screen.queryByTestId("leaderboard-your-best")).toBeNull();
  });

  it("pins the player's best below the list, with its rank, when outside it", async () => {
    mockGetLeaderboard.mockResolvedValue(
      board([entry(1, "Alice", 900)], entry(57, "Me", 100, { is_me: true }))
    );
    await renderBoard("solitaire");
    const pinned = await screen.findByTestId("leaderboard-your-best");
    expect(within(pinned).getByText("Your best")).toBeTruthy();
    expect(within(pinned).getByText("57")).toBeTruthy();
    expect(within(pinned).getByText("Me")).toBeTruthy();
    expect(screen.getByTestId("leaderboard-row-pinned").props.accessibilityLabel).toMatch(
      /^Your best: rank 57, Score 100, /
    );
    // The list itself has no row of the player's.
    expect(within(screen.getByTestId("leaderboard-list")).queryByText("Me")).toBeNull();
  });

  it("pins the player's best even when the board's top N is empty of them on an asc board", async () => {
    mockGetLeaderboard.mockResolvedValue(
      board([entry(1, "Fast", 80)], entry(12, "Me", 190, { is_me: true }))
    );
    await renderBoard("freecell");
    const pinned = await screen.findByTestId("leaderboard-row-pinned");
    expect(pinned.props.accessibilityLabel).toMatch(/^Your best: rank 12, Moves 190, /);
  });

  it("shows no 'Your best' to a player with no named, scored game", async () => {
    mockGetLeaderboard.mockResolvedValue(board([entry(1, "Alice", 900)], null));
    await renderBoard("solitaire");
    await screen.findByText("Alice");
    expect(screen.queryByText("Your best")).toBeNull();
    expect(screen.queryByTestId("leaderboard-row-me")).toBeNull();
  });

  it("never matches the player's row by name", async () => {
    // Someone else shares the player's display name; only is_me marks a row.
    mockGetLeaderboard.mockResolvedValue(
      board([entry(1, "Me", 900)], entry(40, "Me", 100, { is_me: true }))
    );
    await renderBoard("solitaire");
    await screen.findByTestId("leaderboard-your-best");
    expect(screen.queryByTestId("leaderboard-row-me")).toBeNull();
  });
});

describe("LeaderboardScreen — staying current", () => {
  it("fetches the board again when the player comes back to it", async () => {
    mockGetLeaderboard.mockResolvedValueOnce(board([entry(1, "Alice", 900)]));
    await renderBoard("solitaire");
    await screen.findByText("Alice");
    // The mount's own focus is its first load, not a second one.
    await emitNav("focus");
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(1);

    mockGetLeaderboard.mockResolvedValueOnce(board([entry(1, "Alice", 900), entry(2, "Bob", 800)]));
    await emitNav("blur");
    await emitNav("focus");
    // The rows stay on screen while it refreshes.
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(await screen.findByText("Bob")).toBeTruthy();
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(2);
  });

  it("opened from a card whose rank was pending, fetches again once the game has synced", async () => {
    let synced!: () => void;
    mockFlushQueuedGames.mockReturnValueOnce(new Promise<void>((r) => (synced = r)));
    mockGetLeaderboard.mockResolvedValueOnce(board([entry(1, "Alice", 900)]));
    await renderScreen({ gameType: "solitaire", refreshAfterSync: true });
    await screen.findByText("Alice");
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(1);

    mockGetLeaderboard.mockResolvedValueOnce(
      board([entry(1, "Me", 950, { is_me: true }), entry(2, "Alice", 900)])
    );
    await act(async () => synced());
    expect(await screen.findByTestId("leaderboard-row-me")).toBeTruthy();
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(2);
  });

  it("doesn't wait for a sync when the card's rank had settled", async () => {
    await renderBoard("solitaire");
    await act(async () => {});
    expect(mockFlushQueuedGames).not.toHaveBeenCalled();
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("pull to refresh fetches the board again", async () => {
    mockGetLeaderboard.mockResolvedValue(board([entry(1, "Alice", 900)]));
    await renderBoard("solitaire");
    await screen.findByText("Alice");
    const list = screen.getByTestId("leaderboard-list");
    await act(async () => list.props.refreshControl.props.onRefresh());
    expect(mockGetLeaderboard).toHaveBeenCalledTimes(2);
  });
});
