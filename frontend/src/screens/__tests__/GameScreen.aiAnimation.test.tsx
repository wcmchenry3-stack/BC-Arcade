import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { AppState } from "react-native";
import GameScreen from "../GameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { YachtScorecardProvider } from "../../game/yacht/ScorecardContext";
import type { GameState } from "../../game/yacht/types";

// Replace only `roll`; keep every other engine export (score, newGame, …) real.
const mockRoll = jest.fn();
jest.mock("../../game/yacht/engine", () => {
  const actual = jest.requireActual("../../game/yacht/engine");
  return { ...actual, roll: (...args: unknown[]) => mockRoll(...args) };
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
    startGame: jest.fn().mockReturnValue("test-game-id"),
    enqueueEvent: jest.fn(),
    completeGame: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// useGameSync's app-wide foreground clock (#2684) would subscribe to AppState
// once, on first use — whichever test that lands in. The shared mock
// jest.setup.ts pins (#2710) never subscribes, so the listener counts below see
// only the screen's own listener, in any test order.

const ALL_NULL_SCORES = {
  ones: null,
  twos: null,
  threes: null,
  fours: null,
  fives: null,
  sixes: null,
  three_of_a_kind: null,
  four_of_a_kind: null,
  full_house: null,
  small_straight: null,
  large_straight: null,
  yacht: null,
  chance: null,
};

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rolls_used: 0,
    round: 1,
    scores: { ...ALL_NULL_SCORES },
    game_over: false,
    upper_subtotal: 0,
    upper_bonus: 0,
    yacht_bonus_count: 0,
    yacht_bonus_total: 0,
    total_score: 0,
    ...overrides,
  };
}

const mockNav = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as Parameters<typeof GameScreen>[0]["navigation"];

// Recognisable rolled value — easy to assert against "showing blank" (value 0).
const ROLLED_DICE: [number, number, number, number, number] = [6, 6, 6, 6, 6];

// ---------------------------------------------------------------------------
// Shared VS-game render helper used by both describe blocks below.
// ---------------------------------------------------------------------------

async function renderVsGame(
  playerOverrides: Partial<GameState> = {},
  aiOverrides: Partial<GameState> = {}
) {
  const playerState = makeGameState({ dice: [1, 1, 1, 1, 1], rolls_used: 1, ...playerOverrides });
  const aiState = makeGameState(aiOverrides);
  return await render(
    <ThemeProvider>
      <YachtScorecardProvider>
        <GameScreen
          navigation={mockNav}
          route={
            {
              params: {
                initialState: playerState,
                aiDifficulty: "easy" as const,
                aiState,
              },
            } as unknown as Parameters<typeof GameScreen>[0]["route"]
          }
        />
      </YachtScorecardProvider>
    </ThemeProvider>
  );
}

describe("GameScreen VS mode — CPU animation ordering", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // Every call to engineRoll returns state with dice [6,6,6,6,6].
    mockRoll.mockImplementation((state: GameState) => ({
      ...state,
      dice: [...ROLLED_DICE],
      rolls_used: state.rolls_used + 1,
      held: [false, false, false, false, false],
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("CPU dice already show rolled values when rolling animation starts", async () => {
    // Player: already rolled once so they can score without another roll.
    const playerState = makeGameState({ dice: [1, 1, 1, 1, 1], rolls_used: 1 });
    // AI: blank dice, not yet rolled.
    const aiState = makeGameState();

    const { getByRole, getAllByTestId } = await render(
      <ThemeProvider>
        <YachtScorecardProvider>
          <GameScreen
            navigation={mockNav}
            route={
              {
                params: {
                  initialState: playerState,
                  aiDifficulty: "easy" as const,
                  aiState,
                },
              } as unknown as Parameters<typeof GameScreen>[0]["route"]
            }
          />
        </YachtScorecardProvider>
      </ThemeProvider>
    );

    // Score "Ones" → handleScore → setIsAiTurn(true) → runAiTurn() fires.
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });

    // Loop suspends at the first await; engineRoll ran synchronously before setAiRollingIndices.
    const diceButtons = getAllByTestId(/^yacht-die-[0-4]$/);
    expect(diceButtons).toHaveLength(5);
    for (const die of diceButtons) {
      expect(die.props.accessibilityLabel).toMatch(/showing 6/);
    }
  });
});

// ---------------------------------------------------------------------------
// AppState interruption + replay (GH #1850 / PR #1851)
// ---------------------------------------------------------------------------

describe("GameScreen VS mode — AppState interruption + replay", () => {
  let appStateListeners: Array<(state: string) => void>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateListeners = [];
    (AppState.addEventListener as jest.Mock).mockImplementation(
      (_event: string, handler: (state: string) => void) => {
        appStateListeners.push(handler);
        return { remove: jest.fn() };
      }
    );
    mockRoll.mockImplementation((state: GameState) => ({
      ...state,
      dice: [...ROLLED_DICE],
      rolls_used: state.rolls_used + 1,
      held: [false, false, false, false, false],
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function fireAppState(state: string) {
    appStateListeners.forEach((h) => h(state));
  }

  it("registers exactly one AppState listener on mount (single combined listener)", async () => {
    await renderVsGame();
    expect(appStateListeners).toHaveLength(1);
  });

  it("no additional AppState listener is registered when an AI turn starts", async () => {
    const { getByRole } = await renderVsGame();
    expect(appStateListeners).toHaveLength(1);

    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });

    // Still exactly one listener — no per-turn subscription added.
    expect(appStateListeners).toHaveLength(1);
  });

  it("backgrounding mid-AI-turn stops the animation loop (no further rolls)", async () => {
    const { getByRole } = await renderVsGame();
    mockRoll.mockClear();

    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    // One roll happens synchronously before the first await in the loop.
    const rollsBeforeBackground = mockRoll.mock.calls.length;
    expect(rollsBeforeBackground).toBe(1);

    await act(async () => {
      fireAppState("background");
    });

    // Advance all timers — the cancelled loop should exit without rolling again.
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });

    expect(mockRoll.mock.calls.length).toBe(rollsBeforeBackground);
  });

  it("backgrounding when NOT in an AI turn does not start a spurious replay", async () => {
    const { queryByText } = await renderVsGame();

    // Background and foreground with no AI turn running.
    await act(async () => {
      fireAppState("background");
      fireAppState("active");
    });

    expect(queryByText("Computer's Turn")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resuming a saved game that was killed mid-AI-turn (GH #2203)
// ---------------------------------------------------------------------------

describe("GameScreen VS mode — resuming an interrupted AI turn (#2203)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the global Sentry mock from jest.setup.ts
  const Sentry = require("@sentry/react-native") as { captureException: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRoll.mockImplementation((state: GameState) => ({
      ...state,
      dice: [...ROLLED_DICE],
      rolls_used: state.rolls_used + 1,
      held: [false, false, false, false, false],
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Run the AI turn to completion. Each `await delay()` schedules its timer
   * only after the previous one resolves, so time has to advance in steps
   * with the promise queue flushed in between.
   */
  async function finishAiTurn() {
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
    }
  }

  /** Player has scored round 1 (now on round 2); the AI's round-1 turn is still open. */
  function resumed(ai: Partial<GameState>) {
    return renderVsGame(
      { round: 2, rolls_used: 0, dice: [0, 0, 0, 0, 0], scores: { ...ALL_NULL_SCORES, ones: 3 } },
      { round: 1, ...ai }
    );
  }

  it("resumes the AI's turn on mount instead of handing the player an extra turn", async () => {
    const { getByText } = await resumed({ rolls_used: 0 });
    expect(getByText("Computer's Turn")).toBeTruthy();
  });

  it("with all three rolls used, scores without rolling again and returns control", async () => {
    // The real engine roll, which throws "No rolls remaining" at rolls_used 3 —
    // the exact failure that left isAiTurn stuck true before the fix.
    const actual = jest.requireActual("../../game/yacht/engine");
    mockRoll.mockImplementation((...args: unknown[]) => actual.roll(...args));

    const { getByText } = await resumed({ rolls_used: 3, dice: [2, 2, 3, 3, 3] });
    expect(getByText("Computer's Turn")).toBeTruthy();

    await finishAiTurn();

    expect(mockRoll).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(getByText("Your Turn")).toBeTruthy();
  });

  it("with rolls left, keeps the dice it already rolled", async () => {
    const saved: [number, number, number, number, number] = [2, 3, 4, 5, 1];
    const { getAllByTestId } = await resumed({ rolls_used: 1, dice: saved });

    // Before any timer fires the AI shows its saved dice, not a fresh roll.
    const shown = getAllByTestId(/^yacht-die-[0-4]$/).map((d) => d.props.accessibilityLabel);
    saved.forEach((v, i) => expect(shown[i]).toMatch(new RegExp(`showing ${v}`)));

    await finishAiTurn();
    // Whatever it rerolled, it never re-did the opening roll of all five dice.
    for (const [state] of mockRoll.mock.calls as [GameState][]) {
      expect(state.rolls_used).toBeGreaterThan(0);
    }
  });

  it("does not start an AI turn when the round is the player's", async () => {
    const { getByText } = await renderVsGame(
      { round: 2, rolls_used: 0 },
      { round: 2, rolls_used: 0 }
    );
    await finishAiTurn();
    expect(mockRoll).not.toHaveBeenCalled();
    expect(getByText("Your Turn")).toBeTruthy();
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the jest.mock at the top of this file
  const storage = require("../../game/yacht/storage") as { saveGame: jest.Mock };
  const lastSavedAi = (): GameState =>
    storage.saveGame.mock.calls[storage.saveGame.mock.calls.length - 1]![2] as GameState;

  it("finishes the computer's round with a fallback when its turn fails, so it never falls behind", async () => {
    mockRoll.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { getByText } = await resumed({ rolls_used: 0 });

    await finishAiTurn();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(lastSavedAi().round).toBe(2); // caught up with the player
    expect(getByText("Your Turn")).toBeTruthy();
  });

  it("still ends the game when the computer's final turn fails", async () => {
    mockRoll.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const scores = { ...ALL_NULL_SCORES } as GameState["scores"];
    for (const c of Object.keys(scores)) if (c !== "chance") scores[c] = 0;
    await renderVsGame(
      { round: 13, game_over: true, rolls_used: 0, scores: { ...scores, chance: 20 } },
      { round: 13, rolls_used: 0, scores }
    );

    await finishAiTurn();

    // The VS result screen waits on both games being over.
    expect(lastSavedAi().game_over).toBe(true);
  });

  it("unlocks the board as a last resort when even the fallback fails", async () => {
    mockRoll.mockImplementation(() => {
      throw new Error("No rolls remaining this turn.");
    });
    const { getByText } = await resumed({ rolls_used: 0 });

    await finishAiTurn();

    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: "yacht.ai", op: "runAiTurn" },
    });
    expect(getByText("Your Turn")).toBeTruthy();
  });
});
