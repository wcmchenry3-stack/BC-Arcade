import React from "react";
import { render, fireEvent, act, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import GameScreen from "../GameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { YachtScorecardProvider } from "../../game/yacht/ScorecardContext";
import type { GameState } from "../../game/yacht/types";
import { gameEventClient } from "../../game/_shared/gameEventClient";

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

const completeGame = gameEventClient.completeGame as jest.Mock;

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

async function renderVs(playerOpen: string, playerDice: number[], cpuOpen: string) {
  return await render(
    <ThemeProvider>
      <YachtScorecardProvider>
        <GameScreen
          navigation={mockNav as unknown as Parameters<typeof GameScreen>[0]["navigation"]}
          route={
            {
              params: {
                initialState: lastRound(playerOpen, playerDice, 1),
                aiDifficulty: "easy" as const,
                aiState: lastRound(cpuOpen, [0, 0, 0, 0, 0], 0),
              },
            } as unknown as Parameters<typeof GameScreen>[0]["route"]
          }
        />
      </YachtScorecardProvider>
    </ThemeProvider>
  );
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

function completedCalls() {
  return completeGame.mock.calls.filter(([, summary]) => summary.outcome === "completed");
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
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
    const [, , payload] = completedCalls()[0]!;
    expect(payload).toEqual(
      expect.objectContaining({
        final_score: 50,
        outcome: "completed",
        opponent_score: 30,
        vs_result: "win",
      })
    );
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
});
