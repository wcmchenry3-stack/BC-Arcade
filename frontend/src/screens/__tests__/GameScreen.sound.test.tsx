/**
 * #3578: the dice roll sound plays for the player's rolls and for each of the computer's rolls
 * (on its tumble starting), and a computer turn restored from a save doesn't replay one. Holding
 * and releasing a die play their own sounds. Each score plays one sound from the scoring ladder,
 * yours or the computer's.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import GameScreen from "../GameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { YachtScorecardProvider } from "../../game/yacht/ScorecardContext";
import type { GameState } from "../../game/yacht/types";

// Count engine rolls while keeping the real engine (its events drive the player's sounds).
const mockRoll = jest.fn();
jest.mock("../../game/yacht/engine", () => {
  const actual = jest.requireActual("../../game/yacht/engine");
  return {
    ...actual,
    roll: (...args: unknown[]) => {
      mockRoll(...args);
      return actual.roll(...args);
    },
  };
});

// Every sound records its plays by registry key (the first key, for a set of variations).
const mockPlays: string[] = [];
// Every key a player is created for on the latest render (an empty key creates none).
const mockLoaded = new Set<string>();
jest.mock("../../game/_shared/useSound", () => ({
  useSound: (key: string) => {
    if (key) mockLoaded.add(key);
    return { play: () => (mockPlays.push(key), true), stop: jest.fn() };
  },
}));
jest.mock("../../game/_shared/useSoundVariants", () => ({
  useSoundVariants: (keys: readonly string[]) => ({
    play: () => (mockPlays.push(keys[0]!), true),
  }),
}));

const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: mockShellNavigate }), { actual: true })
);
jest.mock("../../game/yacht/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadGame: jest.fn().mockResolvedValue(null),
  loadLastMode: jest.fn().mockResolvedValue(null),
  saveLastMode: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({ startGame: jest.fn().mockReturnValue("test-game-id") })
);

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

const mockNav = { navigate: jest.fn(), goBack: jest.fn() } as unknown as Parameters<
  typeof GameScreen
>[0]["navigation"];

function renderVsGame(player: Partial<GameState>, ai: Partial<GameState>) {
  return render(
    <ThemeProvider>
      <YachtScorecardProvider>
        <GameScreen
          navigation={mockNav}
          route={
            {
              params: {
                initialState: makeGameState(player),
                aiDifficulty: "easy" as const,
                aiState: makeGameState(ai),
              },
            } as unknown as Parameters<typeof GameScreen>[0]["route"]
          }
        />
      </YachtScorecardProvider>
    </ThemeProvider>
  );
}

/** Run the computer's paced turn to the end (each delay is scheduled after the last resolves). */
async function finishAiTurn() {
  for (let i = 0; i < 30; i++) {
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
  }
}

const rollSounds = () => mockPlays.filter((k) => k === "yacht.diceRoll").length;

describe("GameScreen dice roll sound (#3578)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPlays.length = 0;
    mockLoaded.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("plays when the player rolls", async () => {
    const { getByRole } = await renderVsGame({}, {});
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /Roll dice/i }));
    });
    expect(rollSounds()).toBe(1);
  });

  it("plays once for each of the computer's rolls", async () => {
    const { getByRole, getByText } = await renderVsGame(
      { dice: [1, 1, 1, 1, 1], rolls_used: 1 },
      {}
    );
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    await finishAiTurn();
    expect(getByText("Your Turn")).toBeTruthy();
    expect(mockRoll.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(rollSounds()).toBe(mockRoll.mock.calls.length);
  });

  it("does not replay a roll for a computer turn restored from a save", async () => {
    await renderVsGame(
      { round: 2, rolls_used: 0, scores: { ...ALL_NULL_SCORES, ones: 3 } },
      {
        round: 1,
        rolls_used: 3,
        dice: [2, 2, 3, 3, 3],
        events: [{ type: "diceRoll", rolledIndices: [0, 1, 2, 3, 4] }],
      }
    );
    await finishAiTurn();
    expect(mockRoll).not.toHaveBeenCalled();
    expect(rollSounds()).toBe(0);
  });

  it("holding a die plays the hold, releasing it plays the release", async () => {
    const { getByTestId } = await renderVsGame({ dice: [1, 2, 3, 4, 5], rolls_used: 1 }, {});
    await act(async () => {
      await fireEvent.press(getByTestId("yacht-die-0"));
    });
    expect(mockPlays).toEqual(["yacht.dieHold"]);
    await act(async () => {
      await fireEvent.press(getByTestId("yacht-die-0"));
    });
    expect(mockPlays).toEqual(["yacht.dieHold", "yacht.dieRelease"]);
  });

  it("your score plays the commit; the computer's score plays its own set", async () => {
    const { getByRole, getByText } = await renderVsGame(
      { dice: [1, 1, 1, 1, 1], rolls_used: 1 },
      {}
    );
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    expect(mockPlays).toEqual(["yacht.scoreCommit", "yacht.diceRoll"]);
    await finishAiTurn();
    expect(getByText("Your Turn")).toBeTruthy();
    const cpuScore = mockPlays.filter((k) => k.startsWith("yacht.cpu"));
    expect(cpuScore).toHaveLength(1);
    expect(mockPlays.filter((k) => k.startsWith("yacht.score"))).toEqual(["yacht.scoreCommit"]);
  });

  it("a milestone replaces your commit", async () => {
    const { getByRole } = await renderVsGame({ dice: [1, 2, 3, 4, 5], rolls_used: 1 }, {});
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /Lg\. Straight/ }));
    });
    expect(mockPlays[0]).toBe("yacht.largeStraight");
    expect(mockPlays).not.toContain("yacht.scoreCommit");
  });

  it("does not replay the computer's last score for a game restored from a save", async () => {
    await renderVsGame(
      { round: 2, rolls_used: 0, scores: { ...ALL_NULL_SCORES, ones: 3 } },
      {
        round: 2,
        scores: { ...ALL_NULL_SCORES, ones: 2 },
        events: [{ type: "scored", category: "ones", value: 2 }],
      }
    );
    await finishAiTurn();
    expect(mockPlays.filter((k) => k.startsWith("yacht.cpu"))).toEqual([]);
  });

  it("your yacht plays its fanfare, not the commit", async () => {
    const { getByRole } = await renderVsGame({ dice: [4, 4, 4, 4, 4], rolls_used: 1 }, {});
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /Yacht! \(50\)/ }));
    });
    expect(mockPlays[0]).toBe("yacht.yacht");
    expect(mockPlays).not.toContain("yacht.scoreCommit");
  });

  it("a solo game loads none of the computer's sounds; a VS game loads them", async () => {
    await render(
      <ThemeProvider>
        <YachtScorecardProvider>
          <GameScreen
            navigation={mockNav}
            route={
              {
                params: { initialState: makeGameState({}), aiDifficulty: null, aiState: null },
              } as unknown as Parameters<typeof GameScreen>[0]["route"]
            }
          />
        </YachtScorecardProvider>
      </ThemeProvider>
    );
    expect([...mockLoaded].filter((k) => k.startsWith("yacht.cpu"))).toEqual([]);
    expect(mockLoaded).toContain("yacht.scoreCommit");

    mockLoaded.clear();
    await renderVsGame({}, {});
    expect([...mockLoaded].filter((k) => k.startsWith("yacht.cpu"))).toHaveLength(8);
  });
});
