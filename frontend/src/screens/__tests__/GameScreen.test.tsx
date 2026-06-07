import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import GameScreen from "../GameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { YachtScorecardProvider } from "../../game/yacht/ScorecardContext";
import { saveGame, clearGame } from "../../game/yacht/storage";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock yacht storage — no-op persistence
// ---------------------------------------------------------------------------
jest.mock("../../game/yacht/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadGame: jest.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Mock gameEventClient — record every call for instrumentation tests
// ---------------------------------------------------------------------------
type EnqueueArgs = [string, { type: string; data: Record<string, unknown> }];
type CompleteArgs = [string, Record<string, unknown>, Record<string, unknown>];
const mockStartGame = jest.fn(() => "game-uuid-test");
const mockEnqueueEvent = jest.fn() as unknown as jest.Mock<undefined, EnqueueArgs>;
const mockCompleteGame = jest.fn() as unknown as jest.Mock<undefined, CompleteArgs>;
jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: {
    startGame: (...args: unknown[]) => (mockStartGame as jest.Mock)(...args),
    enqueueEvent: (...args: unknown[]) => (mockEnqueueEvent as unknown as jest.Mock)(...args),
    completeGame: (...args: unknown[]) => (mockCompleteGame as unknown as jest.Mock)(...args),
    init: jest.fn().mockResolvedValue(undefined),
    reportBug: jest.fn(),
    getQueueStats: jest.fn(),
    clearAll: jest.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    rolls_used: 0,
    round: 1,
    scores: {
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
    },
    game_over: false,
    upper_subtotal: 0,
    upper_bonus: 0,
    yacht_bonus_count: 0,
    yacht_bonus_total: 0,
    total_score: 0,
    ...overrides,
  };
}

const mockNavigation = { navigate: jest.fn(), goBack: jest.fn() } as unknown as Parameters<
  typeof GameScreen
>[0]["navigation"];

async function renderScreen(stateOverrides: Record<string, unknown> = {}) {
  const initialState = makeState(stateOverrides);
  const result = await render(
    <ThemeProvider>
      <YachtScorecardProvider>
        <GameScreen
          navigation={mockNavigation}
          route={
            { params: { initialState } } as unknown as Parameters<typeof GameScreen>[0]["route"]
          }
        />
      </YachtScorecardProvider>
    </ThemeProvider>
  );
  // Fresh games show a mode picker modal. Auto-select Solo so existing tests
  // aren't affected by the VS-mode overlay blocking accessibility queries.
  const soloBtn = result.queryByRole("button", { name: /^solo$/i });
  if (soloBtn) {
    await fireEvent.press(soloBtn);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GameScreen", () => {
  it("renders the round header", async () => {
    const { getByText } = await renderScreen();
    expect(getByText(/round.*1/i)).toBeTruthy();
  });

  it("rolling updates rolls_used and enables scoring", async () => {
    const { getByRole } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    // After a roll, the button label includes the remaining rolls count (2)
    expect(getByRole("button", { name: /roll dice/i })).toBeTruthy();
  });

  it("scoring a category after a roll advances the round", async () => {
    const { getByRole, getByText } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    expect(getByText(/round.*2/i)).toBeTruthy();
  });

  it("game over modal is not visible initially", async () => {
    const { queryByText } = await renderScreen();
    expect(queryByText(/game over/i)).toBeNull();
  });

  it("game over modal appears when game_over is true", async () => {
    const { getByText, getAllByText } = await renderScreen({ game_over: true, total_score: 250 });
    expect(getByText(/game over/i)).toBeTruthy();
    // Score appears in both the hero display and the scorecard total row
    expect(getAllByText("250").length).toBeGreaterThan(0);
  });

  it("play again button starts a new game in place", async () => {
const { getByRole, getByText, queryByRole } = await renderScreen({ game_over: true, total_score: 100 });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });
    // Play Again now shows the mode selector; pick Solo to start the fresh game.
    await act(async () => {
      const soloBtn = queryByRole("button", { name: /^solo$/i });
      if (soloBtn) fireEvent.press(soloBtn);
    });
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    expect(getByText(/round.*1/i)).toBeTruthy();
  });

  it("dismiss button navigates back to HomeScreen", async () => {
    const { getByRole } = await renderScreen({ game_over: true, total_score: 200 });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /dismiss/i }));
    });
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("⋯ menu Scoreboard item navigates to ScoreboardScreen with yacht gameKey", async () => {
    (mockNavigation.navigate as jest.Mock).mockClear();
    const { getByLabelText, getByText } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByLabelText("More options")); // open ⋯ menu
    });
    await act(async () => {
      await fireEvent.press(getByText("Scoreboard")); // tap Scoreboard item
    });
    expect(mockNavigation.navigate).toHaveBeenCalledWith("Scoreboard", { gameKey: "yacht" });
  });
});

// ---------------------------------------------------------------------------
// Shared fixture — fully-completed game state
// ---------------------------------------------------------------------------

function makeGameOverState(): Record<string, unknown> {
  return {
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rolls_used: 0,
    round: 14, // engine advances past 13 after the last score
    scores: {
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
      yacht: 50,
      chance: 21,
    },
    game_over: true,
    upper_subtotal: 63,
    upper_bonus: 35,
    yacht_bonus_count: 0,
    yacht_bonus_total: 0,
    total_score: 284,
  };
}

// ---------------------------------------------------------------------------
// GH #225 — "Play Again" reset correctness
// ---------------------------------------------------------------------------

describe("GameScreen — Play Again reset (GH #225)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Play Again resets round to 1", async () => {
const { getByRole, getByText, queryByRole } = await renderScreen(makeGameOverState());
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });
    await act(async () => {
      const soloBtn = queryByRole("button", { name: /^solo$/i });
      if (soloBtn) fireEvent.press(soloBtn);
    });
    expect(getByText(/round.*1/i)).toBeTruthy();
  });

  it("Play Again resets all score categories to null", async () => {
    const { getByRole, queryByText } = await renderScreen(makeGameOverState());
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });
    // After reset, no category should show a filled score — modal is gone too
    expect(queryByText(/game over/i)).toBeNull();
    // Total score should be 0
    expect(queryByText("284")).toBeNull();
  });

  it("Play Again calls clearGame before saveGame to avoid the race condition", async () => {
    const callOrder: string[] = [];
    (clearGame as jest.Mock).mockImplementation(async () => {
      callOrder.push("clearGame");
    });
    (saveGame as jest.Mock).mockImplementation(async () => {
      callOrder.push("saveGame");
    });

    // Mount and flush the initial useEffect (which calls saveGame with the
    // game-over state). We only care about the ordering triggered by "Play Again".
    const { getByRole } = await renderScreen(makeGameOverState());
    await act(async () => {
      await Promise.resolve(); // flush initial saveGame from useEffect
    });
    callOrder.length = 0; // reset tracker — only track calls from "Play Again" onward

    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });

    // clearGame must have been called
    expect(clearGame).toHaveBeenCalled();
    // saveGame must have been called (via useEffect on the new state)
    await waitFor(() => expect(saveGame).toHaveBeenCalled());
    // clearGame MUST appear before saveGame in the call order
    const clearIdx = callOrder.indexOf("clearGame");
    const saveIdx = callOrder.indexOf("saveGame");
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(saveIdx).toBeGreaterThan(clearIdx);
  });

  it("Play Again saves a fresh state (round:1, game_over:false, scores null)", async () => {
    const { getByRole } = await renderScreen(makeGameOverState());
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });

    await waitFor(() => expect(saveGame).toHaveBeenCalled());
    const savedState = (saveGame as jest.Mock).mock.calls.at(-1)?.[0];
    expect(savedState.round).toBe(1);
    expect(savedState.game_over).toBe(false);
    // Every score category should be null
    for (const v of Object.values(savedState.scores)) {
      expect(v).toBeNull();
    }
  });

  it("Play Again resets total_score to 0", async () => {
    const { getByRole } = await renderScreen(makeGameOverState());
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });

    await waitFor(() => expect(saveGame).toHaveBeenCalled());
    const savedState = (saveGame as jest.Mock).mock.calls.at(-1)?.[0];
    expect(savedState.total_score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GH #393 — New Game button branches
// ---------------------------------------------------------------------------

describe("GameScreen — New Game button (GH #393)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fresh game: tapping New Game resets immediately without showing confirm modal", async () => {
    // round=1, rolls_used=0, all scores null → isInProgress() = false
    const { getByRole, queryByText } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /new game/i }));
    });
    // Confirm modal must NOT appear
    expect(queryByText("Start new game?")).toBeNull();
    // clearGame is called (startNewGame ran)
    expect(clearGame).toHaveBeenCalled();
  });

  it("in-progress game: tapping New Game shows confirm modal", async () => {
    // round=2 → isInProgress() = true
    const { getByRole, getByText } = await renderScreen({ round: 2 });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /new game/i }));
    });
    expect(getByText("Start new game?")).toBeTruthy();
  });

  it("confirm modal 'Start new game' calls startNewGame and closes modal", async () => {
const { getByRole, queryByText, queryByRole } = await renderScreen({ round: 2 });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /new game/i }));
    });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /start new game/i }));
    });
    // startNewGame shows the mode selector; pick Solo to complete the reset.
    await act(async () => {
      const soloBtn = queryByRole("button", { name: /^solo$/i });
      if (soloBtn) fireEvent.press(soloBtn);
    });
    // Modal closes
    expect(queryByText("Start new game?")).toBeNull();
    // startNewGame ran → clearGame called, round reset to 1
    expect(clearGame).toHaveBeenCalled();
    expect(getByRole("button", { name: /roll dice/i })).toBeTruthy();
  });

  it("confirm modal 'Cancel' does not call startNewGame and closes modal", async () => {
    const { getByRole, queryByText, getByText } = await renderScreen({ round: 2 });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /new game/i }));
    });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /^cancel$/i }));
    });
    // Modal closes
    expect(queryByText("Start new game?")).toBeNull();
    // startNewGame did NOT run — clearGame not called, round still 2
    expect(clearGame).not.toHaveBeenCalled();
    expect(getByText(/round.*2/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GH #263 — scorecard visual reset (upper & lower sections)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// #368 — gameEventClient instrumentation
// ---------------------------------------------------------------------------

const RESERVED_KEYS = ["game_id", "event_index", "event_type"];

describe("GameScreen — gameEventClient instrumentation (#368)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStartGame.mockReturnValue("game-uuid-test");
  });

  it("calls startGame('yacht') on mount", async () => {
    await renderScreen();
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(mockStartGame).toHaveBeenCalledWith("yacht", {}, {});
  });

  it("does not start a new session when mounted with a game_over state", async () => {
    await renderScreen({ game_over: true, total_score: 200 });
    expect(mockStartGame).not.toHaveBeenCalled();
  });

  it("emits a 'roll' event after rolling with expected payload shape", async () => {
    const { getByRole } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    const rollCall = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "roll");
    expect(rollCall).toBeDefined();
    const [gameId, event] = rollCall!;
    expect(gameId).toBe("game-uuid-test");
    expect(event.data).toEqual(
      expect.objectContaining({
        held: expect.any(Array),
        dice: expect.any(Array),
        rolls_used_after: 1,
      })
    );
    expect(event.data.held).toHaveLength(5);
    expect(event.data.dice).toHaveLength(5);
    for (const key of RESERVED_KEYS) {
      expect(event.data).not.toHaveProperty(key);
    }
  });

  it("emits a 'score' event with category, value, is_joker, and available_alternatives", async () => {
    const { getByRole } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    const scoreCall = mockEnqueueEvent.mock.calls.find((c) => c[1]?.type === "score");
    expect(scoreCall).toBeDefined();
    const [, event] = scoreCall!;
    expect(event.data.category).toBe("ones");
    expect(typeof event.data.value).toBe("number");
    expect(typeof event.data.is_joker).toBe("boolean");
    expect(event.data.is_joker).toBe(false);
    expect(event.data.available_alternatives).toBeTruthy();
    expect(typeof event.data.available_alternatives).toBe("object");
    for (const key of RESERVED_KEYS) {
      expect(event.data).not.toHaveProperty(key);
    }
  });

  it("capture ordering: a roll+score sequence emits roll before score", async () => {
    const { getByRole } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    const types = mockEnqueueEvent.mock.calls.map((c) => c[1]?.type);
    const rollIdx = types.indexOf("roll");
    const scoreIdx = types.indexOf("score");
    expect(rollIdx).toBeGreaterThanOrEqual(0);
    expect(scoreIdx).toBeGreaterThan(rollIdx);
  });

  it("fires completeGame with snake_case payload when game_over is reached", async () => {
    // Pre-fill the scorecard so scoring the final category triggers game_over.
    const almostDone = {
      dice: [1, 1, 1, 1, 1],
      held: [false, false, false, false, false],
      rolls_used: 1,
      round: 13,
      scores: {
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
        yacht: 50,
        chance: null,
      },
      game_over: false,
      upper_subtotal: 63,
      upper_bonus: 35,
      yacht_bonus_count: 0,
      yacht_bonus_total: 0,
      total_score: 228,
    };
    const { getByRole } = await renderScreen(almostDone);
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /chance/i }));
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const completeCall = mockCompleteGame.mock.calls[0];
    if (completeCall === undefined) throw new Error("Expected completeGame call");
    const [, summary, eventData] = completeCall;
    expect(summary).toEqual(
      expect.objectContaining({ finalScore: expect.any(Number), outcome: "completed" })
    );
    expect(eventData).toEqual(
      expect.objectContaining({
        final_score: expect.any(Number),
        upper_bonus: expect.any(Number),
        yacht_bonus_total: expect.any(Number),
        outcome: "completed",
      })
    );
    for (const key of RESERVED_KEYS) {
      expect(eventData).not.toHaveProperty(key);
    }
  });

  it("fires completeGame with abandoned outcome when the screen unmounts mid-game", async () => {
    const { getByRole, unmount } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    await unmount();
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    const abandonCall = mockCompleteGame.mock.calls[0];
    if (abandonCall === undefined) throw new Error("Expected completeGame call");
    const [, summary] = abandonCall;
    expect(summary.outcome).toBe("abandoned");
  });

  it("does not double-fire game_ended: completeGame on unmount is skipped after natural end", async () => {
    const { unmount } = await renderScreen({ game_over: true, total_score: 250 });
    await unmount();
    expect(mockCompleteGame).not.toHaveBeenCalled();
  });

  it("New Game mid-game abandons the old session and starts a new one", async () => {
    const { getByRole } = await renderScreen();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    mockStartGame.mockClear();
    mockStartGame.mockReturnValue("game-uuid-test-2");
    // Mid-game New Game opens the confirm modal; confirm it to trigger startNewGame.
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /new game/i }));
    });
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /start new game/i }));
    });
    expect(mockCompleteGame).toHaveBeenCalledTimes(1);
    expect(mockCompleteGame.mock.calls[0]?.[1]?.outcome).toBe("abandoned");
    expect(mockStartGame).toHaveBeenCalledWith("yacht", {}, {});
  });

  it("client failures do not block gameplay (enqueueEvent throws)", async () => {
    mockEnqueueEvent.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { getByRole, queryByText } = await renderScreen();
    // Instrumentation errors are isolated by useGameSync — they must not
    // crash the render tree, surface as a user-visible error, or prevent
    // the next event from being recorded.
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /roll dice/i }));
    });
    expect(queryByText("boom")).toBeNull();
    // Round is still 1 (no score yet) and a subsequent successful enqueue works.
    mockEnqueueEvent.mockClear();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /ones/i }));
    });
    expect(mockEnqueueEvent).toHaveBeenCalled();
  });
});

describe("GameScreen — scorecard visual reset (GH #263)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Play Again resets all upper section rows to 'not available'", async () => {
const { getByRole, queryByRole } = await renderScreen(makeGameOverState());
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });
    await act(async () => {
      const soloBtn = queryByRole("button", { name: /^solo$/i });
      if (soloBtn) fireEvent.press(soloBtn);
    });
    // rollsUsed=0 after reset → canScore=false → every ScoreRow shows "not available"
    for (const cat of ["Ones", "Twos", "Threes", "Fours", "Fives", "Sixes"]) {
      expect(getByRole("button", { name: new RegExp(`${cat}:.*not available`, "i") })).toBeTruthy();
    }
  });

  it("Play Again resets all lower section rows to 'not available'", async () => {
const { getByRole, queryByRole } = await renderScreen(makeGameOverState());
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });
    await act(async () => {
      const soloBtn = queryByRole("button", { name: /^solo$/i });
      if (soloBtn) fireEvent.press(soloBtn);
    });
    for (const cat of [
      "Three of a Kind",
      "Four of a Kind",
      "Full House",
      "Sm. Straight",
      "Lg. Straight",
      "Yacht!",
      "Chance",
    ]) {
      expect(getByRole("button", { name: new RegExp(`${cat}.*not available`, "i") })).toBeTruthy();
    }
  });

  it("Play Again resets upper bonus display to 0 / 63 progress", async () => {
const { getByRole, getByText, queryByText, queryByRole } = await renderScreen(makeGameOverState());
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });
    await act(async () => {
      const soloBtn = queryByRole("button", { name: /^solo$/i });
      if (soloBtn) fireEvent.press(soloBtn);
    });
    // After reset: upper_subtotal=0, upper_bonus=0 → progress display ("0 / 63")
    expect(getByText("0 / 63")).toBeTruthy();
    // The "achieved" check mark must not be visible after reset
    expect(queryByText(/\u2713/)).toBeNull();
  });

  it("Play Again logs Sentry breadcrumbs for the reset event", async () => {
    const { getByRole } = await renderScreen(makeGameOverState());
    const { addBreadcrumb } = jest.requireMock("@sentry/react-native") as {
      addBreadcrumb: jest.Mock;
    };
    addBreadcrumb.mockClear();
    await act(async () => {
      await fireEvent.press(getByRole("button", { name: /play again/i }));
    });
    // Should have two breadcrumbs: one before reset, one after
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/resetting/) })
    );
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/reset complete/) })
    );
  });
});
