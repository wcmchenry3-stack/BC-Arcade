import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import i18n from "i18next";
import mahjong from "../../../i18n/locales/en/mahjong.json";
import DailyChallengeCard from "../DailyChallengeCard";
import { ThemeProvider } from "../../../theme/ThemeContext";
import type { ChallengeGoal, DailyChallenge } from "../../../game/daily_challenge/api";
import { __forceStoreBuildForTests } from "../../../entitlements/gameVisibility";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGetDailyChallenge = jest.fn();
jest.mock("../../../game/daily_challenge/api", () => ({
  dailyChallengeApi: {
    getDailyChallenge: (tz: number) => mockGetDailyChallenge(tz),
  },
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../../../game/_shared/NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

const mockFlush = jest.fn();
jest.mock("../../../game/_shared/syncWorker", () => ({
  syncWorker: { flush: () => mockFlush() },
}));

// The real withRetry backs off for seconds on a network error.
jest.mock("../../../game/_shared/withRetry", () => ({
  withRetry: <T,>(fn: () => Promise<T>) => fn(),
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// A stable object — useNavigation is called on every render.
const focusListeners = new Set<() => void>();
const mockNavigation = {
  addListener: (event: string, cb: () => void) => {
    if (event === "focus") focusListeners.add(cb);
    return () => focusListeners.delete(cb);
  },
};
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
}));

let appStateListener: ((state: AppStateStatus) => void) | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function challenge(completedIds: string[] = []): DailyChallenge {
  const done = (id: string) => completedIds.includes(id);
  return {
    challengeId: "2026-09-27",
    goals: [
      {
        id: "g1",
        gameSlug: "solitaire",
        kind: "moves_at_least",
        target: 10,
        completed: done("g1"),
      },
      {
        id: "g2",
        gameSlug: "twenty48",
        kind: "final_score_at_least",
        target: 2500,
        completed: done("g2"),
      },
      {
        id: "g3",
        gameSlug: "daily_word",
        kind: "completed",
        target: null,
        completed: done("g3"),
      },
    ],
  };
}

async function renderCard() {
  return await render(
    <ThemeProvider>
      <DailyChallengeCard />
    </ThemeProvider>
  );
}

const networkError = () => new TypeError("Failed to fetch");

// The shared Jest i18n fixture has no `mahjong` namespace (MahjongScreen's suites rely on
// that), so register it here for the goals that name the game.
beforeAll(() => {
  i18n.addResourceBundle("en", "mahjong", mahjong, true, true);
});

afterAll(() => {
  i18n.removeResourceBundle("en", "mahjong");
});

afterEach(() => {
  __forceStoreBuildForTests(false);
});

beforeEach(() => {
  jest.clearAllMocks();
  focusListeners.clear();
  appStateListener = undefined;
  mockNetwork.isOnline = true;
  mockFlush.mockResolvedValue({});
  mockGetDailyChallenge.mockResolvedValue(challenge());
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DailyChallengeCard — goals", () => {
  it("shows one chip per goal with localised game names and the score target", async () => {
    const { findByLabelText } = await renderCard();
    expect(await findByLabelText("Make 10+ moves in Solitaire, not completed yet")).toBeTruthy();
    expect(await findByLabelText("Score 2500+ in 2048, not completed yet")).toBeTruthy();
    expect(await findByLabelText("Finish today's Daily Word, not completed yet")).toBeTruthy();
  });

  it("words each goal in its own game's terms, with its target", async () => {
    const goal = (gameSlug: string, kind: string, target: number | null): ChallengeGoal => ({
      id: `${gameSlug}:${kind}`,
      gameSlug,
      kind,
      target,
      completed: false,
    });
    mockGetDailyChallenge.mockResolvedValue({
      challengeId: "2026-09-27",
      goals: [
        goal("daily_word", "won_guesses_used_at_most", 4),
        goal("twenty48", "highest_tile_at_least", 512),
        goal("mahjong", "won_duration_ms_at_most", 480_000),
        goal("blackjack", "hands_won_at_least", 3),
        goal("freecell", "won_moves_at_most", 100),
        goal("blackjack", "chips_gained", null),
      ],
    });
    const { findByLabelText } = await renderCard();
    expect(
      await findByLabelText("Solve Daily Word in 4 guesses or fewer, not completed yet")
    ).toBeTruthy();
    expect(await findByLabelText("Reach the 512 tile in 2048, not completed yet")).toBeTruthy();
    // The backend sends milliseconds; the player reads minutes.
    expect(
      await findByLabelText("Clear Mahjong Solitaire in 8 minutes or less, not completed yet")
    ).toBeTruthy();
    expect(await findByLabelText("Win 3 hands of Blackjack, not completed yet")).toBeTruthy();
    expect(
      await findByLabelText("Win FreeCell in 100 moves or fewer, not completed yet")
    ).toBeTruthy();
    expect(
      await findByLabelText("Finish a Blackjack session up on chips, not completed yet")
    ).toBeTruthy();
  });

  // Mirrors FREE_GOAL_POOL in backend/daily_challenge/definitions.py — a kind added there
  // needs copy here, or its goal shows as the generic "Play <game>".
  it.each([
    ["daily_word", ["completed", "won", "won_guesses_used_at_most"]],
    ["twenty48", ["final_score_at_least", "highest_tile_at_least"]],
    ["solitaire", ["moves_at_least", "won", "won_moves_at_most"]],
    ["mahjong", ["pairs_at_least", "won", "won_duration_ms_at_most"]],
    ["freecell", ["moves_at_least", "won", "won_moves_at_most"]],
    ["blackjack", ["hands_played_at_least", "chips_gained", "hands_won_at_least"]],
  ])("has wording for every %s goal the backend can send", (slug, kinds) => {
    for (const kind of kinds) {
      expect(i18n.exists(`daily_challenge:goal.${slug}.${kind}`, { count: 5 })).toBe(true);
    }
  });

  it("uses the singular wording when a target is 1", async () => {
    mockGetDailyChallenge.mockResolvedValue({
      challengeId: "2026-09-27",
      goals: [
        {
          id: "a",
          gameSlug: "daily_word",
          kind: "won_guesses_used_at_most",
          target: 1,
          completed: false,
        },
      ],
    });
    const { findByLabelText } = await renderCard();
    expect(await findByLabelText("Solve Daily Word in 1 guess, not completed yet")).toBeTruthy();
  });

  it("falls back to a plain 'Play <game>' for a goal kind this build has no wording for", async () => {
    mockGetDailyChallenge.mockResolvedValue({
      challengeId: "2026-09-27",
      goals: [
        { id: "a", gameSlug: "solitaire", kind: "brand_new_kind", target: 7, completed: false },
      ],
    });
    const { findByLabelText, queryByText } = await renderCard();
    expect(await findByLabelText("Play Solitaire, not completed yet")).toBeTruthy();
    expect(queryByText(/brand_new_kind/)).toBeNull();
  });

  it("drops a goal for a game this build hides, and counts progress over what is shown", async () => {
    __forceStoreBuildForTests(true);
    mockGetDailyChallenge.mockResolvedValue({
      challengeId: "2026-09-27",
      goals: [
        { id: "v", gameSlug: "solitaire", kind: "won", target: null, completed: true },
        { id: "h", gameSlug: "yacht", kind: "won", target: null, completed: false },
      ],
    });
    const { findByText, queryByTestId, getByTestId } = await renderCard();
    expect(await findByText("1 of 1 complete")).toBeTruthy();
    expect(getByTestId("daily-challenge-goal-v")).toBeTruthy();
    expect(queryByTestId("daily-challenge-goal-h")).toBeNull();
  });

  it("marks finished goals with a check and open goals with an empty circle", async () => {
    mockGetDailyChallenge.mockResolvedValue(challenge(["g2"]));
    const { findByLabelText, getByTestId } = await renderCard();
    expect(await findByLabelText("Score 2500+ in 2048, completed")).toBeTruthy();
    // The glyphs are hidden from screen readers (the chip's label carries the state).
    const hidden = { includeHiddenElements: true };
    expect(getByTestId("daily-challenge-mark-g2", hidden).props.children).toBe("✓");
    expect(getByTestId("daily-challenge-mark-g1", hidden).props.children).toBe("○");
  });

  it("gives the glyph an explicit colour so it stays visible on the dark theme", async () => {
    const { findByLabelText, getByTestId } = await renderCard();
    await findByLabelText("Make 10+ moves in Solitaire, not completed yet");
    const style = getByTestId("daily-challenge-mark-g1", { includeHiddenElements: true }).props
      .style;
    expect(JSON.stringify(style)).toMatch(/"color":"[^"]+"/);
  });

  it("shows progress out of the total", async () => {
    mockGetDailyChallenge.mockResolvedValue(challenge(["g1"]));
    const { findByText, queryByText } = await renderCard();
    expect(await findByText("1 of 3 complete")).toBeTruthy();
    expect(queryByText(/A new challenge arrives tomorrow/)).toBeNull();
  });

  it("celebrates once every goal is done", async () => {
    mockGetDailyChallenge.mockResolvedValue(challenge(["g1", "g2", "g3"]));
    const { findByText } = await renderCard();
    expect(await findByText("3 of 3 complete")).toBeTruthy();
    expect(await findByText("All done! A new challenge arrives tomorrow.")).toBeTruthy();
  });

  it("does not claim victory for a challenge with no goals", async () => {
    mockGetDailyChallenge.mockResolvedValue({ challengeId: "empty", goals: [] });
    const { findByText, queryByText } = await renderCard();
    expect(await findByText("0 of 0 complete")).toBeTruthy();
    expect(queryByText(/A new challenge arrives tomorrow/)).toBeNull();
  });

  it("asks for the day in the device's timezone", async () => {
    const spy = jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-330);
    try {
      const { findByText } = await renderCard();
      await findByText("0 of 3 complete");
      // getTimezoneOffset is minutes *behind* UTC; the API wants minutes east.
      expect(mockGetDailyChallenge).toHaveBeenCalledWith(330);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("DailyChallengeCard — loading, offline and failure", () => {
  it("holds its space with a skeleton while the first fetch is in flight", async () => {
    mockGetDailyChallenge.mockReturnValue(new Promise(() => {}));
    const { getByTestId, getByLabelText } = await renderCard();
    expect(getByTestId("daily-challenge-loading")).toBeTruthy();
    expect(getByLabelText("Loading the daily challenge")).toBeTruthy();
  });

  it("shows the check-connection state, without fetching, when known offline", async () => {
    mockNetwork.isOnline = false;
    const { getByText, getByTestId } = await renderCard();
    expect(getByTestId("daily-challenge-offline")).toBeTruthy();
    expect(getByText("Check your connection")).toBeTruthy();
    expect(mockGetDailyChallenge).not.toHaveBeenCalled();
  });

  it("shows the check-connection state when the request fails for network reasons", async () => {
    mockGetDailyChallenge.mockRejectedValue(networkError());
    const { findByText } = await renderCard();
    expect(await findByText("Check your connection")).toBeTruthy();
  });

  it("recognises Expo's native FetchError as a network failure (#2428)", async () => {
    mockGetDailyChallenge.mockRejectedValue(
      new Error("fetch failed: The Internet connection appears to be offline.")
    );
    const { findByText } = await renderCard();
    expect(await findByText("Check your connection")).toBeTruthy();
  });

  it("retries when the check-connection card is tapped", async () => {
    mockGetDailyChallenge.mockRejectedValueOnce(networkError());
    const { findByLabelText, findByText } = await renderCard();
    await fireEvent.press(await findByLabelText("Retry loading the daily challenge"));
    expect(await findByText("0 of 3 complete")).toBeTruthy();
    expect(mockGetDailyChallenge).toHaveBeenCalledTimes(2);
  });

  it("renders nothing for a server-side failure the player can't fix", async () => {
    mockGetDailyChallenge.mockRejectedValue(new Error("HTTP 500"));
    const { queryByTestId } = await renderCard();
    await waitFor(() => expect(mockGetDailyChallenge).toHaveBeenCalled());
    await waitFor(() => expect(queryByTestId("daily-challenge-card")).toBeNull());
  });

  it("keeps showing the last known challenge when a refetch fails", async () => {
    mockGetDailyChallenge.mockResolvedValueOnce(challenge(["g1"]));
    const { findByText, queryByText } = await renderCard();
    await findByText("1 of 3 complete");

    mockGetDailyChallenge.mockRejectedValueOnce(networkError());
    await act(async () => {
      appStateListener?.("active");
    });
    await waitFor(() => expect(mockGetDailyChallenge).toHaveBeenCalledTimes(2));

    expect(queryByText("1 of 3 complete")).toBeTruthy();
    expect(queryByText("Check your connection")).toBeNull();
  });

  it("keeps showing the last known challenge if the device then goes offline", async () => {
    const { findByText, rerender, queryByText } = await renderCard();
    await findByText("0 of 3 complete");

    mockNetwork.isOnline = false;
    await rerender(
      <ThemeProvider>
        <DailyChallengeCard />
      </ThemeProvider>
    );
    expect(queryByText("0 of 3 complete")).toBeTruthy();
    expect(queryByText("Check your connection")).toBeNull();
  });
});

describe("DailyChallengeCard — refetching", () => {
  it("uploads queued games before asking for progress", async () => {
    const order: string[] = [];
    mockFlush.mockImplementation(async () => {
      order.push("flush");
    });
    mockGetDailyChallenge.mockImplementation(async () => {
      order.push("fetch");
      return challenge();
    });
    const { findByText } = await renderCard();
    await findByText("0 of 3 complete");
    expect(order).toEqual(["flush", "fetch"]);
  });

  it("still loads when the queue flush fails", async () => {
    mockFlush.mockRejectedValue(new Error("flush failed"));
    const { findByText } = await renderCard();
    expect(await findByText("0 of 3 complete")).toBeTruthy();
  });

  it("refetches when the app returns to the foreground", async () => {
    const { findByText } = await renderCard();
    await findByText("0 of 3 complete");

    mockGetDailyChallenge.mockResolvedValue(challenge(["g3"]));
    await act(async () => {
      appStateListener?.("active");
    });
    expect(await findByText("1 of 3 complete")).toBeTruthy();
  });

  it("does not refetch when the app goes to the background", async () => {
    const { findByText } = await renderCard();
    await findByText("0 of 3 complete");
    await act(async () => {
      appStateListener?.("background");
    });
    expect(mockGetDailyChallenge).toHaveBeenCalledTimes(1);
  });

  it("refetches when connectivity returns", async () => {
    mockNetwork.isOnline = false;
    const { findByText, getByText, rerender } = await renderCard();
    expect(getByText("Check your connection")).toBeTruthy();

    mockNetwork.isOnline = true;
    await rerender(
      <ThemeProvider>
        <DailyChallengeCard />
      </ThemeProvider>
    );
    expect(await findByText("0 of 3 complete")).toBeTruthy();
    expect(mockGetDailyChallenge).toHaveBeenCalledTimes(1);
  });

  it("refetches when Home regains focus, so a finished game's checkmark appears", async () => {
    const { findByText } = await renderCard();
    await findByText("0 of 3 complete");

    mockGetDailyChallenge.mockResolvedValue(challenge(["g1", "g2"]));
    await act(async () => {
      focusListeners.forEach((listener) => listener());
    });
    expect(await findByText("2 of 3 complete")).toBeTruthy();
  });

  it("never runs two fetches at once", async () => {
    let release: (value: DailyChallenge) => void = () => {};
    mockGetDailyChallenge.mockReturnValue(
      new Promise<DailyChallenge>((resolve) => {
        release = resolve;
      })
    );
    const { findByText } = await renderCard();
    await waitFor(() => expect(mockGetDailyChallenge).toHaveBeenCalledTimes(1));

    await act(async () => {
      appStateListener?.("active");
      focusListeners.forEach((listener) => listener());
    });
    expect(mockGetDailyChallenge).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(challenge());
    });
    expect(await findByText("0 of 3 complete")).toBeTruthy();
  });

  it("unsubscribes from focus events on unmount", async () => {
    const { findByText, unmount } = await renderCard();
    await findByText("0 of 3 complete");
    expect(focusListeners.size).toBeGreaterThan(0);
    await unmount();
    expect(focusListeners.size).toBe(0);
  });
});
