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

function renderVsGame(
  playerOverrides: Partial<GameState> = {},
  aiOverrides: Partial<GameState> = {}
) {
  const playerState = makeGameState({ dice: [1, 1, 1, 1, 1], rolls_used: 1, ...playerOverrides });
  const aiState = makeGameState(aiOverrides);
  return render(
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

    const { getByRole, getAllByTestId } = render(
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
      fireEvent.press(getByRole("button", { name: /ones/i }));
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

  it("registers exactly one AppState listener on mount (single combined listener)", () => {
    renderVsGame();
    expect(appStateListeners).toHaveLength(1);
  });

  it("no additional AppState listener is registered when an AI turn starts", async () => {
    const { getByRole } = renderVsGame();
    expect(appStateListeners).toHaveLength(1);

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /ones/i }));
    });

    // Still exactly one listener — no per-turn subscription added.
    expect(appStateListeners).toHaveLength(1);
  });

  it("backgrounding mid-AI-turn stops the animation loop (no further rolls)", async () => {
    const { getByRole } = renderVsGame();
    mockRoll.mockClear();

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /ones/i }));
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

  it("foregrounding after background replays the AI turn (mockRoll called again)", async () => {
    const { getByRole, getByText } = renderVsGame();

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /ones/i }));
    });

    await act(async () => {
      fireAppState("background");
      jest.advanceTimersByTime(10_000);
    });

    mockRoll.mockClear();

    await act(async () => {
      fireAppState("active");
    });

    // The replay re-fires the AI turn effect: at minimum one roll runs synchronously.
    expect(mockRoll.mock.calls.length).toBeGreaterThan(0);
    expect(getByText("Computer's Turn")).toBeTruthy();
  });

  it("replay restores the pre-turn snapshot (first roll receives rolls_used=0)", async () => {
    const { getByRole } = renderVsGame();

    await act(async () => {
      fireEvent.press(getByRole("button", { name: /ones/i }));
    });

    await act(async () => {
      fireAppState("background");
      jest.advanceTimersByTime(10_000);
    });

    mockRoll.mockClear();

    await act(async () => {
      fireAppState("active");
    });

    // The very first roll on replay must use the pre-turn snapshot (rolls_used=0).
    expect(mockRoll).toHaveBeenCalledWith(expect.objectContaining({ rolls_used: 0 }), [
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("backgrounding when NOT in an AI turn does not start a spurious replay", async () => {
    const { queryByText } = renderVsGame();

    // Background and foreground with no AI turn running.
    await act(async () => {
      fireAppState("background");
      fireAppState("active");
    });

    expect(queryByText("Computer's Turn")).toBeNull();
  });
});
