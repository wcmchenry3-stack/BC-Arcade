/**
 * Yacht replay recording on the screen (#3282): both players' turns of a vs
 * game are recorded, units follow the round (so a restored game continues the
 * numbering), the app going to the background saves synchronously, and the
 * kill switch turns the whole thing off.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { AppState } from "react-native";
import GameScreen from "../GameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { YachtScorecardProvider } from "../../game/yacht/ScorecardContext";
import { createSeededRng, setRng } from "../../game/yacht/engine";
import type { GameState } from "../../game/yacht/types";

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

type Saved = { type: string; data: Record<string, unknown> };
const mockEnqueueEvents = jest.fn() as unknown as jest.Mock<undefined, [string, Saved[]]>;
jest.mock("../../game/_shared/gameEventClient", () => {
  const { lazy, mockGameEventClient } = mockScreenDeps();
  return mockGameEventClient({
    startGame: jest.fn().mockReturnValue("test-game-id"),
    enqueueEvents: lazy(() => mockEnqueueEvents),
    completeGame: lazy(() => mockCompleteGame),
  });
});
const mockCompleteGame = jest.fn();

// scoreEvs asks the oracle for the computer's EVs: spied, to prove it is not asked with recording off.
const mockScoreEvs = jest.fn();
jest.mock("../../game/yacht/ai", () => {
  const actual = jest.requireActual("../../game/yacht/ai");
  return {
    ...actual,
    scoreEvs: (...args: unknown[]) => {
      mockScoreEvs(...args);
      return actual.scoreEvs(...args);
    },
  };
});

// emitTurn can be made to throw, to prove a recording failure never stops play.
const mockEmitTurnThrows = jest.fn(() => false);
jest.mock("../../game/yacht/replay", () => {
  const actual = jest.requireActual("../../game/yacht/replay");
  return {
    ...actual,
    emitTurn: (...args: unknown[]) => {
      if (mockEmitTurnThrows()) throw new Error("recorder down");
      return actual.emitTurn(...args);
    },
  };
});

// The kill switch (#3279 will drive it from the server): a test flips it per game.
const mockRecordingEnabled = jest.fn((_gameType: string) => true);
jest.mock("../../game/_shared/eventQueueConfig", () => ({
  ...jest.requireActual("../../game/_shared/eventQueueConfig"),
  isRecordingEnabled: (gameType: string) => mockRecordingEnabled(gameType),
}));

const NULL_SCORES = {
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

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rolls_used: 0,
    round: 1,
    scores: { ...NULL_SCORES },
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

/** A restored vs game: the player has rolled once at `round`; the computer is a turn behind. */
async function renderRestoredVs(round: number) {
  return render(
    <ThemeProvider>
      <YachtScorecardProvider>
        <GameScreen
          navigation={mockNav}
          route={
            {
              params: {
                initialState: makeState({ dice: [1, 1, 1, 1, 1], rolls_used: 1, round }),
                aiDifficulty: "easy" as const,
                aiState: makeState({ round }),
              },
            } as unknown as Parameters<typeof GameScreen>[0]["route"]
          }
        />
      </YachtScorecardProvider>
    </ThemeProvider>
  );
}

let appStateListeners: ((state: string) => void)[];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockRecordingEnabled.mockImplementation(() => true);
  setRng(createSeededRng(21));
  appStateListeners = [];
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_event: string, handler: (state: string) => void) => {
      appStateListeners.push(handler);
      return { remove: jest.fn() };
    }
  );
});

afterEach(() => {
  jest.useRealTimers();
  setRng(Math.random);
});

/** Runs the timers (idle saves, the computer's paced turn) to the end. */
async function playOut() {
  for (let i = 0; i < 30; i++) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
  }
}

function savedTurns(): Saved[] {
  return mockEnqueueEvents.mock.calls.flatMap((c) => c[1]);
}

describe("GameScreen — replay recording (#3282)", () => {
  it("records the player's turn and then the computer's, each as one event with its actor and unit", async () => {
    const { getByRole } = await renderRestoredVs(5);
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    await playOut();

    const turns = savedTurns();
    expect(turns.map((t) => t.type)).toEqual(["turn_completed", "turn_completed"]);
    // One storage write per turn: two saves of one event each.
    expect(mockEnqueueEvents.mock.calls.map((c) => c[1].length)).toEqual([1, 1]);
    const [human, cpu] = turns.map((t) => t.data);
    // Units continue from the restored round (2r-1 and 2r), not from 1.
    expect(human).toEqual(
      expect.objectContaining({ unit: 9, r: 5, actor: { seat: 0, kind: "human" } })
    );
    expect(cpu).toEqual(
      expect.objectContaining({ unit: 10, r: 5, actor: { seat: 1, kind: "cpu" } })
    );
    expect(human).not.toHaveProperty("ev");
    expect(cpu!.ev).toHaveLength(2);
    expect((cpu!.rolls as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("saves at once when the app goes to the background, not at the next idle moment", async () => {
    const { getByRole } = await renderRestoredVs(5);
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    // The player's turn is waiting for its idle save: no timers have run.
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    await act(async () => {
      appStateListeners.forEach((h) => h("background"));
    });
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEvents.mock.calls[0]![1][0]!.data).toEqual(
      expect.objectContaining({ unit: 9, r: 5 })
    );
  });

  it("the kill switch off: nothing is recorded or saved, and the game plays on", async () => {
    mockRecordingEnabled.mockImplementation(() => false);
    const { getByRole, getAllByText } = await renderRestoredVs(5);
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    await act(async () => {
      appStateListeners.forEach((h) => h("background"));
    });
    await playOut();
    expect(mockRecordingEnabled).toHaveBeenCalledWith("yacht");
    expect(mockEnqueueEvents).not.toHaveBeenCalled();
    // The computer still took its turn.
    expect(getAllByText(/round 6/i).length).toBeGreaterThan(0);
    // And nothing was built for the replay: the oracle was not asked for EVs.
    expect(mockScoreEvs).not.toHaveBeenCalled();
  });

  it("with recording on, the oracle is asked for the computer's EVs once per turn", async () => {
    const { getByRole } = await renderRestoredVs(5);
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    await playOut();
    expect(mockScoreEvs).toHaveBeenCalledTimes(1);
  });

  it("a recording failure on the player's turn does not stop the computer's turn", async () => {
    mockEmitTurnThrows.mockReturnValueOnce(true);
    const { getByRole, getAllByText } = await renderRestoredVs(5);
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    await playOut();
    // The computer played (round 6 shows) and its turn was recorded.
    expect(getAllByText(/round 6/i).length).toBeGreaterThan(0);
    expect(savedTurns().map((t) => t.data.unit)).toEqual([10]);
  });

  it("a recording failure on a solo game's last turn still completes the game", async () => {
    mockEmitTurnThrows.mockReturnValueOnce(true);
    const lastTurn = makeState({
      dice: [1, 1, 1, 1, 1],
      rolls_used: 1,
      round: 13,
      scores: {
        ...NULL_SCORES,
        ones: 3,
        twos: 6,
        threes: 9,
        fours: 12,
        fives: 15,
        sixes: 18,
        three_of_a_kind: 20,
        four_of_a_kind: 0,
        full_house: 25,
        small_straight: 30,
        large_straight: 40,
        yacht: 0,
      },
    });
    const { getByRole } = await render(
      <ThemeProvider>
        <YachtScorecardProvider>
          <GameScreen
            navigation={mockNav}
            route={
              {
                params: { initialState: lastTurn, aiDifficulty: undefined },
              } as unknown as Parameters<typeof GameScreen>[0]["route"]
            }
          />
        </YachtScorecardProvider>
      </ThemeProvider>
    );
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /chance/i }));
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ outcome: "completed" })
    );
  });
});
