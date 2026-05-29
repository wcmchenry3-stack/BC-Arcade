/**
 * Regression test for GH #1842 — CPU dice snap to new value after roll animation.
 *
 * Invariant: when aiRollingIndices is non-empty (animation active), aiGameState.dice
 * must already hold the rolled values. In the broken code engineRoll was called 1000 ms
 * AFTER setAiRollingIndices, so the die finished spinning on the old value and then
 * snapped silently to the new one.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
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
  ones: null, twos: null, threes: null, fours: null, fives: null, sixes: null,
  three_of_a_kind: null, four_of_a_kind: null, full_house: null,
  small_straight: null, large_straight: null, yacht: null, chance: null,
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

describe("GameScreen VS mode — CPU animation ordering (GH #1842)", () => {
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

  it("CPU dice already show rolled values when rolling animation starts — no post-animation snap (#1842)", async () => {
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

    // At this point the AI turn loop's synchronous prefix has run and then
    // suspended at the first `await delay(...)`. No timers have advanced.
    //
    // BROKEN (pre-fix): setAiRollingIndices([0,1,2,3,4]) was called before
    //   engineRoll, so dice are still blank → accessibilityLabel "showing blank".
    //
    // FIXED: engineRoll + setAiGameState are called synchronously BEFORE
    //   setAiRollingIndices, so dice are already [6,6,6,6,6] when the
    //   animation starts → accessibilityLabel "showing 6".
    const diceButtons = getAllByTestId(/^yacht-die-[0-4]$/);
    expect(diceButtons).toHaveLength(5);
    for (const die of diceButtons) {
      expect(die.props.accessibilityLabel).toMatch(/showing 6/);
    }
  });
});
