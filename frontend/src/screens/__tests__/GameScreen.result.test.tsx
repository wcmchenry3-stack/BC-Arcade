import React from "react";
import { render, fireEvent, act, within } from "@testing-library/react-native";
import { AppState, StyleSheet } from "react-native";
import GameScreen from "../GameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { YachtScorecardProvider } from "../../game/yacht/ScorecardContext";
import type { GameState } from "../../game/yacht/types";
import { newGame } from "../../game/yacht/engine";
import { gameEventClient } from "../../game/_shared/gameEventClient";
import { resetDisplayNameCacheForTests, saveDisplayName } from "../../game/_shared/displayName";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GameRankResponse } from "../../api/types";

// Shared result card for Yacht (#2505): vs outcomes, and the game-sync
// session completing only once the CPU has finished its last turn.

// Every roll shows five 6s, so the CPU's last category scores predictably.
jest.mock("../../game/yacht/engine", () => {
  const actual = jest.requireActual("../../game/yacht/engine");
  return {
    ...actual,
    roll: (state: GameState) => ({
      ...state,
      dice: [6, 6, 6, 6, 6],
      rolls_used: state.rolls_used + 1,
    }),
  };
});

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../../game/yacht/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadGame: jest.fn().mockResolvedValue(null),
  loadLastMode: jest.fn().mockResolvedValue(null),
  saveLastMode: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: jest.fn().mockReturnValue("yacht-game-id"),
    enqueueEvent: jest.fn(),
    completeGame: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// The card's leaderboard line (#2630) reads the rank from the session board.
const mockGetRank = jest.fn<Promise<GameRankResponse>, [string]>();
jest.mock("../../api/stats", () => ({
  statsApi: { getGameRank: (gameId: string) => mockGetRank(gameId) },
}));
jest.mock("../../game/_shared/flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../game/_shared/displayNameSync", () => ({
  ...jest.requireActual("../../game/_shared/displayNameSync"),
  flushDisplayNameSync: jest.fn(() => Promise.resolve(true)),
}));

const completeGame = gameEventClient.completeGame as jest.Mock;
const startGame = gameEventClient.startGame as jest.Mock;

const CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
] as const;

/** A final-round state: every category scored 0 except `open`, left to play. */
function lastRound(open: string, dice: number[], rollsUsed: number): GameState {
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, c === open ? null : 0]));
  return {
    dice,
    held: [false, false, false, false, false],
    rolls_used: rollsUsed,
    round: 13,
    scores,
    game_over: false,
    upper_subtotal: 0,
    upper_bonus: 0,
    yacht_bonus_count: 0,
    yacht_bonus_total: 0,
    total_score: 0,
  } as unknown as GameState;
}

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), popToTop: jest.fn() };

async function renderGame(params: Record<string, unknown>) {
  return await render(
    <ThemeProvider>
      <YachtScorecardProvider>
        <GameScreen
          navigation={mockNav as unknown as Parameters<typeof GameScreen>[0]["navigation"]}
          route={{ params } as unknown as Parameters<typeof GameScreen>[0]["route"]}
        />
      </YachtScorecardProvider>
    </ThemeProvider>
  );
}

/** A restored vs game on its last round. */
async function renderVs(playerOpen: string, playerDice: number[], cpuOpen: string) {
  return await renderGame({
    initialState: lastRound(playerOpen, playerDice, 1),
    aiDifficulty: "easy" as const,
    aiState: lastRound(cpuOpen, [0, 0, 0, 0, 0], 0),
  });
}

/** A restored solo game on its last round. */
async function renderSolo(open: string) {
  return await renderGame({ initialState: lastRound(open, [6, 6, 6, 6, 6], 0) });
}

type Rendered = Awaited<ReturnType<typeof renderVs>>;

/** Rolls once (marks the session started) and scores the last category. */
async function playLastTurn(r: Rendered, categoryLabel: RegExp) {
  await act(async () => {
    await fireEvent.press(r.getByRole("button", { name: /^Roll/i }));
  });
  await act(async () => {
    await fireEvent.press(r.getAllByRole("button", { name: categoryLabel })[0]!);
  });
}

async function finishCpuTurn() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
  }
}

/** Sessions closed as a finished game — any outcome but "abandoned" (#2517). */
function completedCalls() {
  return completeGame.mock.calls.filter(([, summary]) => summary.outcome !== "abandoned");
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockGetRank.mockReset();
  mockGetRank.mockResolvedValue({ ranked: true, rank: 3, is_best: true, reason: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Yacht result card — vs outcomes (#2505)", () => {
  it("shows You Win with the margin when the player finishes ahead", async () => {
    // Player: Yacht with 6s = 50. CPU: Chance with 6s = 30.
    const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Yacht/i);
    await finishCpuTurn();

    const card = within(r.getByTestId("yacht-result"));
    expect(card.getByTestId("yacht-result-title")).toHaveTextContent("You Win!");
    expect(card.getByText("Won by 20 points")).toBeTruthy();
    expect(card.getByTestId("yacht-final-scorecard")).toBeTruthy();
  });

  it("shows Computer Wins when the CPU finishes ahead", async () => {
    // Player: Ones with 6s = 0. CPU: Chance with 6s = 30.
    const r = await renderVs("ones", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Ones/i);
    await finishCpuTurn();

    const card = within(r.getByTestId("yacht-result"));
    expect(card.getByTestId("yacht-result-title")).toHaveTextContent("Computer Wins");
    expect(card.getByText("Lost by 30 points")).toBeTruthy();
  });

  it("shows It's a Tie when both finish level", async () => {
    // Both score 0 in their last category.
    const r = await renderVs("ones", [6, 6, 6, 6, 6], "ones");
    await playLastTurn(r, /^Ones/i);
    await finishCpuTurn();

    const card = within(r.getByTestId("yacht-result"));
    expect(card.getByTestId("yacht-result-title")).toHaveTextContent("It's a Tie!");
    expect(card.getByText("You both finished on 0")).toBeTruthy();
  });
});

describe("Yacht vs mode — game sync timing (#2505)", () => {
  it("completes only after the CPU's last turn, reporting the result", async () => {
    const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Yacht/i);

    // The player is done but the CPU is still playing: nothing reported yet.
    expect(completedCalls()).toHaveLength(0);

    await finishCpuTurn();

    expect(completedCalls()).toHaveLength(1);
    const [, summary, payload] = completedCalls()[0]!;
    // #2517: the row records who won.
    expect(summary).toEqual(expect.objectContaining({ finalScore: 50, outcome: "win" }));
    expect(payload).toEqual(
      expect.objectContaining({
        final_score: 50,
        outcome: "win",
        opponent_score: 30,
        vs_result: "win",
      })
    );
  });

  it.each([
    // Player: Ones with 6s = 0; CPU: Chance with 6s = 30.
    ["loss", "ones", "chance"],
    // Both score 0 in their last category: a tie is recorded as push.
    ["push", "ones", "ones"],
  ])("records a %s on the games row", async (recorded, playerOpen, cpuOpen) => {
    const r = await renderVs(playerOpen, [6, 6, 6, 6, 6], cpuOpen);
    await playLastTurn(r, playerOpen === "ones" ? /^Ones/i : /^Yacht/i);
    await finishCpuTurn();

    expect(completedCalls()).toHaveLength(1);
    const [, summary] = completedCalls()[0]!;
    expect(summary.outcome).toBe(recorded);
  });

  it("records a finished game as completed if the player leaves during the CPU's last turn", async () => {
    const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Yacht/i);

    await act(async () => {
      await r.unmount();
    });

    const calls = completeGame.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].outcome).toBe("completed");
    expect(calls[0]![2]).toEqual(expect.objectContaining({ final_score: 50 }));
  });
});

describe("Yacht result card — actions (#2505)", () => {
  it("Play Again keeps vs mode and skips the mode picker", async () => {
    const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Yacht/i);
    await finishCpuTurn();

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });

    expect(r.queryByTestId("yacht-mode-solo")).toBeNull();
    expect(r.getByText("Round 1 / 13")).toBeTruthy();
    expect(r.getByText("Your Turn")).toBeTruthy();
  });

  it("Change Difficulty reopens the mode picker", async () => {
    const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Yacht/i);
    await finishCpuTurn();

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Change Difficulty" }));
    });

    expect(r.getByTestId("yacht-mode-solo")).toBeTruthy();
    // The picker renders on the shared ModalCard: header title and accent top rule.
    expect(r.getByRole("header", { name: "Choose Mode" })).toBeTruthy();
    const card = StyleSheet.flatten(r.getByTestId("yacht-mode-card").props.style);
    expect(card.borderTopWidth).toBe(3);
  });
});

describe("Yacht vs mode — app backgrounded during the CPU's last turn (#2543 review)", () => {
  let appStateListeners: Array<(state: string) => void>;

  beforeEach(() => {
    appStateListeners = [];
    (AppState.addEventListener as jest.Mock).mockImplementation(
      (_event: string, handler: (state: string) => void) => {
        appStateListeners.push(handler);
        return { remove: jest.fn() };
      }
    );
  });

  async function fireAppState(state: string) {
    await act(async () => {
      appStateListeners.forEach((h) => h(state));
    });
  }

  it.each(["background", "inactive"])(
    "records the finished game when the app goes %s, since a kill runs no cleanup",
    async (state) => {
      const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
      await playLastTurn(r, /^Yacht/i);
      expect(completedCalls()).toHaveLength(0);

      await fireAppState(state);

      expect(completedCalls()).toHaveLength(1);
      expect(completedCalls()[0]![2]).toEqual(
        expect.objectContaining({ final_score: 50, outcome: "completed" })
      );

      // The CPU finishing later doesn't record the game a second time.
      await fireAppState("active");
      await finishCpuTurn();
      expect(completeGame).toHaveBeenCalledTimes(1);
    }
  );

  it("does not complete a game still in progress when backgrounded", async () => {
    await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await fireAppState("background");
    expect(completeGame).not.toHaveBeenCalled();
  });

  it("the card still finds the game recorded on a background once the CPU finishes (#2630)", async () => {
    await saveDisplayName("Riley");
    const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Yacht/i);
    // complete() runs here and clears the hook's game id.
    await fireAppState("background");
    await fireAppState("active");
    await finishCpuTurn();
    await settle();

    expect(mockGetRank).toHaveBeenCalledWith("yacht-game-id");
    expect(r.getByText("Saved as Riley · #3 on the leaderboard")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Reporting (#2630): mode metadata and the leaderboard line
// ---------------------------------------------------------------------------

/** Lets the card's rank lookup (a chain of promises) settle. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
  }
}

describe("Yacht reporting — mode metadata (#2630)", () => {
  it.each([
    ["solo", undefined, { mode: "solo" }],
    ["vs", "hard", { mode: "vs", difficulty: "hard" }],
  ])("a restored %s game starts its session with the mode", async (_mode, diff, expected) => {
    await renderGame({
      initialState: lastRound("yacht", [6, 6, 6, 6, 6], 0),
      aiDifficulty: diff,
      aiState: diff ? lastRound("chance", [0, 0, 0, 0, 0], 0) : undefined,
    });
    expect(startGame).toHaveBeenCalledWith("yacht", expected, {});
  });

  it("the mode picker starts a vs session with the chosen difficulty", async () => {
    const r = await renderGame({ initialState: newGame() });
    expect(startGame).not.toHaveBeenCalled();
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: /^vs computer$/i }));
    });
    expect(startGame).toHaveBeenCalledWith("yacht", { mode: "vs", difficulty: "medium" }, {});
  });

  it("the mode picker starts a solo session", async () => {
    const r = await renderGame({ initialState: newGame() });
    await act(async () => {
      await fireEvent.press(r.getByTestId("yacht-mode-solo"));
    });
    expect(startGame).toHaveBeenCalledWith("yacht", { mode: "solo" }, {});
  });

  it("Play Again in vs mode keeps the mode and difficulty", async () => {
    const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Yacht/i);
    await finishCpuTurn();
    startGame.mockClear();

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    expect(startGame).toHaveBeenCalledWith("yacht", { mode: "vs", difficulty: "easy" }, {});
  });
});

describe("Yacht reporting — result card leaderboard line (#2630)", () => {
  it("a named player's solo game shows its rank", async () => {
    await saveDisplayName("Riley");
    const r = await renderSolo("yacht");
    await playLastTurn(r, /^Yacht/i);
    await settle();

    expect(mockGetRank).toHaveBeenCalledWith("yacht-game-id");
    const card = within(r.getByTestId("yacht-result"));
    expect(card.getByText("Saved as Riley · #3 on the leaderboard")).toBeTruthy();
  });

  it("a vs game shows its rank once the CPU has finished", async () => {
    await saveDisplayName("Riley");
    const r = await renderVs("yacht", [6, 6, 6, 6, 6], "chance");
    await playLastTurn(r, /^Yacht/i);
    await settle();
    // The card isn't up yet: no lookup while the CPU plays its last turn.
    expect(mockGetRank).not.toHaveBeenCalled();

    await finishCpuTurn();
    await settle();

    expect(mockGetRank).toHaveBeenCalledTimes(1);
    expect(mockGetRank).toHaveBeenCalledWith("yacht-game-id");
    const card = within(r.getByTestId("yacht-result"));
    expect(card.getByTestId("yacht-result-title")).toHaveTextContent("You Win!");
    expect(card.getByText("Saved as Riley · #3 on the leaderboard")).toBeTruthy();
  });

  it("without a display name the card asks for one", async () => {
    const r = await renderSolo("yacht");
    await playLastTurn(r, /^Yacht/i);
    await settle();

    expect(mockGetRank).not.toHaveBeenCalled();
    expect(within(r.getByTestId("yacht-result")).getByTestId("result-name-prompt")).toBeTruthy();
  });

  it("an unranked game shows no leaderboard line", async () => {
    await saveDisplayName("Riley");
    mockGetRank.mockResolvedValue({
      ranked: false,
      rank: null,
      is_best: null,
      reason: "board_disabled",
    });
    const r = await renderSolo("yacht");
    await playLastTurn(r, /^Yacht/i);
    await settle();

    expect(mockGetRank).toHaveBeenCalled();
    expect(within(r.getByTestId("yacht-result")).queryByText(/Saved as/)).toBeNull();
  });

  it("never looks up a rank for an abandoned game", async () => {
    await saveDisplayName("Riley");
    const r = await renderSolo("yacht");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: /^Roll/i }));
    });
    // New Game mid-game abandons it.
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: /new game/i }));
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: /start new game/i }));
    });
    await settle();

    expect(completeGame).toHaveBeenCalledTimes(1);
    expect(completeGame.mock.calls[0]![1].outcome).toBe("abandoned");
    expect(mockGetRank).not.toHaveBeenCalled();
  });

  it("never looks up a rank when the player leaves mid-game", async () => {
    await saveDisplayName("Riley");
    const r = await renderSolo("yacht");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: /^Roll/i }));
    });
    await act(async () => {
      await r.unmount();
    });
    await settle();

    expect(completeGame.mock.calls[0]![1].outcome).toBe("abandoned");
    expect(mockGetRank).not.toHaveBeenCalled();
  });

  it("Play Again clears the line for the next game", async () => {
    await saveDisplayName("Riley");
    const r = await renderSolo("yacht");
    await playLastTurn(r, /^Yacht/i);
    await settle();
    expect(r.getByText("Saved as Riley · #3 on the leaderboard")).toBeTruthy();

    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Play Again" }));
    });
    await settle();
    expect(r.queryByText(/Saved as Riley/)).toBeNull();
    expect(mockGetRank).toHaveBeenCalledTimes(1);
  });
});
