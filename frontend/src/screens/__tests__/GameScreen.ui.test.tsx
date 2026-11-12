import React from "react";
import { render, fireEvent, act, within } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import GameScreen from "../GameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { YachtScorecardProvider } from "../../game/yacht/ScorecardContext";
import type { GameState } from "../../game/yacht/types";

// The thumb-tray UI (#3748): one scorecard, the action bar with New Game and the solo Hint, the
// computer's-turn display and the end card for both players.

const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: mockShellNavigate }), { actual: true })
);

// Every roll shows five 6s.
jest.mock("../../game/yacht/engine", () => {
  const actual = jest.requireActual("../../game/yacht/engine");
  return {
    ...actual,
    roll: (state: GameState) => ({
      ...state,
      dice: [6, 6, 6, 6, 6],
      held: [false, false, false, false, false],
      rolls_used: state.rolls_used + 1,
      // as the real engine does: the screen's tumble and the Hint's "rolling" lock follow it
      events: [{ type: "diceRoll", rolledIndices: [0, 1, 2, 3, 4] }],
    }),
  };
});

jest.mock("../../game/yacht/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadGame: jest.fn().mockResolvedValue(null),
  loadLastMode: jest.fn().mockResolvedValue(null),
  saveLastMode: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({ startGame: jest.fn().mockReturnValue("yacht-game-id") })
);
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());

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

const BLANK = Object.fromEntries(CATEGORIES.map((c) => [c, null]));

function state(over: Partial<GameState> = {}): GameState {
  return {
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rolls_used: 0,
    round: 1,
    scores: { ...BLANK },
    game_over: false,
    upper_subtotal: 0,
    upper_bonus: 0,
    yacht_bonus_count: 0,
    yacht_bonus_total: 0,
    total_score: 0,
    ...over,
  };
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

/** A solo game. A fresh game opens the mode picker: pick Solo, as a player would. */
async function solo(over: Partial<GameState> = {}) {
  const r = await renderGame({ initialState: state(over) });
  const pick = r.queryByTestId("yacht-mode-solo");
  if (pick) await fireEvent.press(pick);
  return r;
}
const vs = (player: Partial<GameState> = {}, cpu: Partial<GameState> = {}) =>
  renderGame({
    initialState: state(player),
    aiDifficulty: "easy" as const,
    aiState: state(cpu),
  });

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function finishCpuTurn() {
  for (let i = 0; i < 20; i++) await advance(1000);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the layout: scorecard on top, thumb tray below (#3748)", () => {
  it("solo shows all 13 rows at once: no Upper / Lower tabs", async () => {
    const r = await solo();
    for (const key of CATEGORIES) expect(r.getByTestId(`score-row-${key}`)).toBeTruthy();
    expect(r.queryByRole("tab")).toBeNull();
    expect(r.queryByText("CPU")).toBeNull();
  });

  it("vs shows the same table with the computer's column", async () => {
    const r = await vs();
    for (const key of CATEGORIES) expect(r.getByTestId(`score-row-${key}`)).toBeTruthy();
    expect(r.getByText("CPU")).toBeTruthy();
  });

  it("the tray holds the dice, Roll and the action bar, and sits after the scorecard", async () => {
    const r = await solo();
    const tray = within(r.getByTestId("yacht-tray"));
    expect(tray.getAllByTestId(/^yacht-die-[0-4]$/)).toHaveLength(5);
    expect(tray.getByTestId("yacht-roll-button")).toBeTruthy();
    expect(tray.getByTestId("yacht-action-bar")).toBeTruthy();
    // The scorecard is before the tray in the tree (on top).
    const tree = JSON.stringify(r.toJSON());
    expect(tree.indexOf("yacht-scorecard")).toBeGreaterThan(-1);
    expect(tree.indexOf("yacht-scorecard")).toBeLessThan(tree.indexOf("yacht-tray"));
  });

  it("has no New Game row of its own: New Game is a button of the action bar", async () => {
    const r = await solo();
    const newGame = r.getAllByRole("button", { name: "New Game" });
    expect(newGame).toHaveLength(1);
    expect(
      within(r.getByTestId("yacht-action-bar")).getByRole("button", { name: "New Game" })
    ).toBe(newGame[0]);
    expect(r.getByTestId("yacht-new-game-button")).toBe(newGame[0]);
  });

  it("New Game in the action bar behaves as before: confirm when a game is under way", async () => {
    const r = await solo({ round: 2, rolls_used: 1, dice: [1, 2, 3, 4, 5] });
    await fireEvent.press(r.getByTestId("yacht-new-game-button"));
    expect(r.getByText("Start new game?")).toBeTruthy();
  });

  it("keeps the Round pill", async () => {
    const r = await solo({ round: 5 });
    expect(r.getByText("Round 5 / 13")).toBeTruthy();
  });
});

describe("the Hint is solo only", () => {
  it("solo has Hint and New Game; vs has New Game alone", async () => {
    const s = await solo();
    expect(s.getByTestId("yacht-hint-button")).toBeTruthy();
    await s.unmount();
    const v = await vs();
    expect(v.queryByTestId("yacht-hint-button")).toBeNull();
    expect(v.queryByRole("button", { name: "Show a hint" })).toBeNull();
    expect(v.getByTestId("yacht-new-game-button")).toBeTruthy();
  });

  it("vs shows no hint ring or row even when it has dice to look at", async () => {
    const v = await vs({ rolls_used: 1, dice: [6, 6, 6, 2, 3] });
    expect(v.queryByTestId("yacht-die-0-hint-ring")).toBeNull();
    expect(v.queryByTestId("yacht-hint-row-bar")).toBeNull();
  });
});

describe("the Hint (solo)", () => {
  it("before the last roll, rings the dice to keep and says so, for 2 s", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const r = await solo({ rolls_used: 1, dice: [6, 6, 6, 2, 3] });
    await fireEvent.press(r.getByTestId("yacht-hint-button"));
    expect(r.getByTestId("yacht-hint-message")).toHaveTextContent(
      "Hint: keep the highlighted dice"
    );
    for (const i of [0, 1, 2]) expect(r.getByTestId(`yacht-die-${i}-hint-ring`)).toBeTruthy();
    expect(r.queryByTestId("yacht-die-3-hint-ring")).toBeNull();
    expect(announce).toHaveBeenCalledWith("Hint: keep the highlighted dice");
    await advance(1999);
    expect(r.getByTestId("yacht-hint-message")).toBeTruthy();
    await advance(1);
    expect(r.queryByTestId("yacht-hint-message")).toBeNull();
    expect(r.queryByTestId("yacht-die-0-hint-ring")).toBeNull();
    expect(r.getByText("Tap dice to hold")).toBeTruthy();
  });

  it("after the third roll, marks the best row and names it", async () => {
    const r = await solo({ rolls_used: 3, dice: [1, 2, 3, 4, 5] });
    await fireEvent.press(r.getByTestId("yacht-hint-button"));
    expect(r.getByTestId("yacht-hint-message")).toHaveTextContent(
      "Hint: score Large Straight (40)"
    );
    expect(
      within(r.getByTestId("score-row-large_straight")).getByTestId("yacht-hint-row-bar")
    ).toBeTruthy();
    expect(r.getAllByTestId("yacht-hint-row-bar")).toHaveLength(1);
    await advance(2000);
    expect(r.queryByTestId("yacht-hint-row-bar")).toBeNull();
  });

  it("when the best play is to stop before the last roll, marks the row too", async () => {
    const r = await solo({ rolls_used: 1, dice: [5, 5, 5, 5, 5] });
    await fireEvent.press(r.getByTestId("yacht-hint-button"));
    expect(within(r.getByTestId("score-row-yacht")).getByTestId("yacht-hint-row-bar")).toBeTruthy();
    expect(r.queryByTestId("yacht-die-0-hint-ring")).toBeNull();
  });

  it("has no hint to give before the first roll: a 'no hint' toast for 2 s", async () => {
    const r = await solo();
    await fireEvent.press(r.getByTestId("yacht-hint-button"));
    expect(r.getByTestId("yacht-no-hint-toast")).toHaveTextContent("No hint available");
    expect(r.queryByTestId("yacht-hint-message")).toBeNull();
    await advance(2000);
    expect(r.queryByTestId("yacht-no-hint-toast")).toBeNull();
  });

  it("changes nothing in the game: no roll, no score, same round", async () => {
    const r = await solo({ rolls_used: 1, dice: [6, 6, 6, 2, 3], round: 4 });
    await fireEvent.press(r.getByTestId("yacht-hint-button"));
    expect(r.getByText("Round 4 / 13")).toBeTruthy();
    expect(within(r.getByTestId("yacht-roll-button")).getByText("Roll (2 left)")).toBeTruthy();
  });

  it("is cleared by a roll, a hold and a score", async () => {
    const r = await solo({ rolls_used: 1, dice: [6, 6, 6, 2, 3] });
    // hold
    await fireEvent.press(r.getByTestId("yacht-hint-button"));
    expect(r.getByTestId("yacht-hint-message")).toBeTruthy();
    await fireEvent.press(r.getByTestId("yacht-die-4"));
    expect(r.queryByTestId("yacht-hint-message")).toBeNull();
    // roll
    await fireEvent.press(r.getByTestId("yacht-hint-button"));
    expect(r.getByTestId("yacht-hint-message")).toBeTruthy();
    await fireEvent.press(r.getByTestId("yacht-roll-button"));
    expect(r.queryByTestId("yacht-hint-message")).toBeNull();
    // score
    await advance(500);
    await fireEvent.press(r.getByTestId("yacht-hint-button"));
    expect(r.getByTestId("yacht-hint-message")).toBeTruthy();
    await fireEvent.press(r.getByTestId("score-row-sixes"));
    expect(r.queryByTestId("yacht-hint-message")).toBeNull();
    expect(r.queryByTestId("yacht-hint-row-bar")).toBeNull();
  });

  describe("is disabled", () => {
    it("while the dice are rolling", async () => {
      const r = await solo({ rolls_used: 1, dice: [1, 2, 3, 4, 5] });
      expect(r.getByTestId("yacht-hint-button").props.accessibilityState.disabled).toBe(false);
      await fireEvent.press(r.getByTestId("yacht-roll-button"));
      expect(r.getByTestId("yacht-hint-button").props.accessibilityState.disabled).toBe(true);
      // A press while rolling shows nothing.
      await fireEvent.press(r.getByTestId("yacht-hint-button"));
      expect(r.queryByTestId("yacht-hint-message")).toBeNull();
      expect(r.queryByTestId("yacht-no-hint-toast")).toBeNull();
      await advance(500);
      expect(r.getByTestId("yacht-hint-button").props.accessibilityState.disabled).toBe(false);
    });

    it("when the game is over", async () => {
      const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 1]));
      const r = await solo({
        game_over: true,
        rolls_used: 3,
        dice: [1, 2, 3, 4, 5],
        scores,
        round: 13,
      });
      // The end card is open over the board: look past it.
      const hint = r.getByTestId("yacht-hint-button", { includeHiddenElements: true });
      expect(hint.props.accessibilityState.disabled).toBe(true);
    });
  });
});

describe("the computer's turn (audit bugs 3 and 4)", () => {
  async function startCpuTurn() {
    const r = await vs({ dice: [1, 1, 1, 1, 1], rolls_used: 1 });
    await act(async () => {
      await fireEvent.press(r.getByTestId("score-row-ones"));
    });
    return r;
  }

  it("shows its own hint text and Roll reads 'Computer's Turn', not a count", async () => {
    const r = await startCpuTurn();
    expect(r.getByText("Computer is rolling…")).toBeTruthy();
    expect(r.queryByText("Tap dice to hold")).toBeNull();
    const roll = r.getByTestId("yacht-roll-button");
    expect(within(roll).getByText("Computer's Turn")).toBeTruthy();
    expect(roll.props.accessibilityState.disabled).toBe(true);
    expect(r.queryByText(/Roll \(\d left\)/)).toBeNull();
  });

  it("shows its dice at full opacity (audit bug 2)", async () => {
    const r = await startCpuTurn();
    for (let i = 0; i < 5; i++) {
      const die = r.getByTestId(`yacht-die-${i}`);
      const style = Object.assign({}, ...[die.props.style].flat(5).filter(Boolean));
      expect(style.opacity).toBeUndefined();
    }
  });

  it("highlights the row it just scored, and the highlight stays until you roll", async () => {
    const r = await startCpuTurn();
    expect(r.queryByTestId("yacht-cpu-row-bar")).toBeNull();
    await finishCpuTurn();
    expect(r.getByText("Your Turn")).toBeTruthy();
    const bars = r.getAllByTestId("yacht-cpu-row-bar");
    expect(bars).toHaveLength(1);
    // It is the row the computer filled: it shows a number in its column.
    const rowTestId = bars[0]!.parent!.props.testID as string;
    expect(rowTestId).toMatch(/^score-row-/);
    // Then your own roll takes the highlight away.
    await act(async () => {
      await fireEvent.press(r.getByTestId("yacht-roll-button"));
    });
    expect(r.queryByTestId("yacht-cpu-row-bar")).toBeNull();
  });

  it("highlights nothing for a computer score restored from a save", async () => {
    const r = await vs(
      { round: 2, rolls_used: 0 },
      { round: 2, scores: { ...BLANK, chance: 21 }, total_score: 21 }
    );
    expect(r.queryByTestId("yacht-cpu-row-bar")).toBeNull();
  });

  it("solo never has one", async () => {
    const r = await solo({ dice: [1, 1, 1, 1, 1], rolls_used: 1 });
    await act(async () => {
      await fireEvent.press(r.getByTestId("score-row-ones"));
    });
    expect(r.queryByTestId("yacht-cpu-row-bar")).toBeNull();
    expect(r.queryByText("Computer is rolling…")).toBeNull();
  });
});

/** A final-round state: every category scored except `open`, left to play. */
function lastRound(open: string, scores: Record<string, number>, over: Partial<GameState> = {}) {
  const filled = Object.fromEntries(
    CATEGORIES.map((c) => [c, c === open ? null : (scores[c] ?? 0)])
  );
  return state({
    round: 13,
    rolls_used: 1,
    dice: [6, 6, 6, 6, 6],
    scores: filled,
    ...over,
  });
}

const UPPER_105 = { ones: 5, twos: 10, threes: 15, fours: 20, fives: 25, sixes: 30 };

describe("the end card (#3748)", () => {
  it("solo: a scored Yacht is the subtitle, not the upper bonus (audit bug 12)", async () => {
    const r = await renderGame({
      initialState: lastRound("yacht", UPPER_105, { upper_subtotal: 105, upper_bonus: 35 }),
    });
    await act(async () => {
      await fireEvent.press(r.getByTestId("score-row-yacht"));
    });
    const card = within(r.getByTestId("yacht-result"));
    expect(card.getByText("Yacht! +50 points")).toBeTruthy();
    expect(card.queryByText("+35 Upper Bonus included!")).toBeNull();
  });

  it("solo: without a Yacht, the upper bonus is the subtitle", async () => {
    const r = await renderGame({
      initialState: lastRound("chance", UPPER_105, { upper_subtotal: 105, upper_bonus: 35 }),
    });
    await act(async () => {
      await fireEvent.press(r.getByTestId("score-row-chance"));
    });
    expect(
      within(r.getByTestId("yacht-result")).getByText("+35 Upper Bonus included!")
    ).toBeTruthy();
  });

  it("solo keeps the Upper / Lower / Bonus stats", async () => {
    const r = await renderGame({ initialState: lastRound("chance", UPPER_105) });
    await act(async () => {
      await fireEvent.press(r.getByTestId("score-row-chance"));
    });
    const card = within(r.getByTestId("yacht-result"));
    expect(card.getByText("Upper")).toBeTruthy();
    expect(card.getByText("Lower")).toBeTruthy();
    expect(card.getByText("Bonus")).toBeTruthy();
  });

  it("vs: the player-only Upper / Lower / Bonus stats are replaced by both players' subtotals (audit bug 13)", async () => {
    const r = await renderGame({
      initialState: lastRound("chance", UPPER_105),
      aiDifficulty: "easy" as const,
      aiState: lastRound("chance", { sixes: 18 }, { rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    });
    await act(async () => {
      await fireEvent.press(r.getByTestId("score-row-chance"));
    });
    await finishCpuTurn();
    const card = within(r.getByTestId("yacht-result"));
    expect(card.queryByText("Upper")).toBeNull();
    expect(card.queryByText("Lower")).toBeNull();
    expect(card.getByTestId("yacht-final-upper-subtotal")).toBeTruthy();
    expect(card.getByTestId("yacht-final-lower-subtotal")).toBeTruthy();
    // You outscored the computer in the Sixes row, and the row says so.
    expect(card.getByTestId("yacht-final-row-sixes").props.accessibilityLabel).toBe(
      "Sixes: you 30, computer 18, you win the row"
    );
  });
});
