/**
 * Yacht zero confirm on the screen (#4092): the first tap on an open row that would score 0 arms
 * it (nothing is committed), the second tap on the same row scores it. Anything else disarms. A
 * non-zero row scores in one tap. The computer's turn never arms, and input stays locked while
 * the dice tumble.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import GameScreen from "../GameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { YachtScorecardProvider } from "../../game/yacht/ScorecardContext";
import type { GameState } from "../../game/yacht/types";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { inputLockMaxMs } from "../../game/yacht/motion";

const mockShellNavigate = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: mockShellNavigate }), { actual: true })
);

// Every roll shows 6s on the dice it rolls, and keeps the held ones, as the engine does.
jest.mock("../../game/yacht/engine", () => {
  const actual = jest.requireActual("../../game/yacht/engine");
  return {
    ...actual,
    roll: (state: GameState, held: boolean[]) => {
      const rolledIndices = [0, 1, 2, 3, 4].filter((i) => !held[i]);
      return {
        ...state,
        dice: state.dice.map((d, i) => (held[i] ? d : 6)),
        held: [...held],
        rolls_used: state.rolls_used + 1,
        events: [{ type: "diceRoll", rolledIndices }],
      };
    },
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

/** Round 1, one roll used, dice 6 6 6 2 3: Ones, Full House, Yacht and the straights score 0. */
function state(over: Partial<GameState> = {}): GameState {
  return {
    dice: [6, 6, 6, 2, 3],
    held: [false, false, false, false, false],
    rolls_used: 1,
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

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function renderGame(params: Record<string, unknown>) {
  const r = await render(
    <ThemeProvider>
      <YachtScorecardProvider>
        <GameScreen
          navigation={mockNav as unknown as Parameters<typeof GameScreen>[0]["navigation"]}
          route={{ params } as unknown as Parameters<typeof GameScreen>[0]["route"]}
        />
      </YachtScorecardProvider>
    </ThemeProvider>
  );
  await advance(0);
  const pick = r.queryByTestId("yacht-mode-solo");
  if (pick) await act(async () => fireEvent.press(pick));
  return r;
}
type Rendered = Awaited<ReturnType<typeof renderGame>>;

const press = (r: Rendered, testID: string) =>
  act(async () => {
    await fireEvent.press(r.getByTestId(testID));
  });

const armed = (r: Rendered, key: string) =>
  r.queryByTestId(`yacht-row-${key}-armed`, HIDDEN) !== null;
const scored = (r: Rendered, key: string) =>
  r.queryByTestId(`score-row-check-${key}`, HIDDEN) !== null;
const isHeld = (r: Rendered, i: number) =>
  r.getByTestId(`yacht-die-${i}`).props.accessibilityState.checked === true;

const HIDDEN = { includeHiddenElements: true };
let announce: jest.SpyInstance;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetReduceMotionForTests();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a zero takes two taps (#4092)", () => {
  it("the first tap arms the row and commits nothing; the second scores the 0", async () => {
    const r = await renderGame({ initialState: state() });
    expect(armed(r, "ones")).toBe(false);

    await press(r, "score-row-ones");
    expect(armed(r, "ones")).toBe(true);
    expect(r.getByTestId("yacht-armed-row-bar")).toBeTruthy();
    expect(r.getByText("Tap again to score 0", HIDDEN)).toBeTruthy();
    // Nothing is committed: still round 1, the row open, the dice as they were.
    expect(r.getByText("Round 1 / 13")).toBeTruthy();
    expect(scored(r, "ones")).toBe(false);

    await press(r, "score-row-ones");
    expect(r.getByText("Round 2 / 13")).toBeTruthy();
    expect(scored(r, "ones")).toBe(true);
    expect(armed(r, "ones")).toBe(false);
  });

  it("a row that scores points is scored in one tap, as before", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "score-row-sixes");
    expect(r.getByText("Round 2 / 13")).toBeTruthy();
    expect(scored(r, "sixes")).toBe(true);
  });

  it("the armed row announces itself: label, hint text and a spoken announcement", async () => {
    const r = await renderGame({ initialState: state() });
    expect(r.getByTestId("score-row-full_house").props.accessibilityLabel).toBe(
      "Full House (25): open, would score 0, double-tap to score"
    );
    await press(r, "score-row-full_house");
    expect(r.getByTestId("score-row-full_house").props.accessibilityLabel).toBe(
      "Full House (25): would score 0. Tap again to score 0"
    );
    expect(announce).toHaveBeenCalledWith("Full House (25): would score 0. Tap again to score 0");
  });

  it("arming a second zero row moves the arm", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "score-row-ones");
    await press(r, "score-row-full_house");
    expect(armed(r, "ones")).toBe(false);
    expect(armed(r, "full_house")).toBe(true);
    expect(r.getByText("Round 1 / 13")).toBeTruthy();
    // The first row now needs two taps again.
    await press(r, "score-row-ones");
    expect(scored(r, "ones")).toBe(false);
    expect(armed(r, "ones")).toBe(true);
  });

  it("tapping a row with points disarms and scores that row, not the armed one", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "score-row-ones");
    await press(r, "score-row-sixes");
    expect(scored(r, "sixes")).toBe(true);
    expect(scored(r, "ones")).toBe(false);
    // The new turn starts disarmed.
    expect(armed(r, "ones")).toBe(false);
    expect(r.getByText("Round 2 / 13")).toBeTruthy();
  });

  it("a die tap disarms, and changes only that die's hold", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "score-row-ones");
    expect(armed(r, "ones")).toBe(true);
    await press(r, "yacht-die-0");
    expect(armed(r, "ones")).toBe(false);
    expect(isHeld(r, 0)).toBe(true);
    expect(r.getByText("Round 1 / 13")).toBeTruthy();
    // Back on the row: armed again, then the second tap scores it.
    await press(r, "score-row-ones");
    expect(armed(r, "ones")).toBe(true);
    await press(r, "score-row-ones");
    expect(scored(r, "ones")).toBe(true);
  });

  it("Hint disarms and leaves the turn as it was", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "score-row-ones");
    await press(r, "yacht-hint-button");
    expect(armed(r, "ones")).toBe(false);
    expect(r.getByText("Round 1 / 13")).toBeTruthy();
    expect(scored(r, "ones")).toBe(false);
  });

  it("Roll disarms; the re-roll is the only thing that changes", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "score-row-ones");
    await press(r, "yacht-roll-button");
    expect(armed(r, "ones")).toBe(false);
    await advance(inputLockMaxMs(5));
    expect(armed(r, "ones")).toBe(false);
    expect(r.getByText("Round 1 / 13")).toBeTruthy();
    expect(r.getByText("Roll (1 left)")).toBeTruthy();
    // After the re-roll (all 6s) Ones is a zero again and takes two taps.
    await press(r, "score-row-ones");
    expect(scored(r, "ones")).toBe(false);
    expect(armed(r, "ones")).toBe(true);
  });

  it("a game reset (New Game) starts with nothing armed", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "score-row-ones");
    expect(armed(r, "ones")).toBe(true);
    await act(async () => {
      await fireEvent.press(r.getByTestId("yacht-new-game-button"));
    });
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: /start new game/i }));
    });
    await advance(0);
    expect(armed(r, "ones")).toBe(false);
  });

  it("input stays locked while the dice tumble: no arming, no committing", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "yacht-roll-button");
    // Tumbling: the rows are inert.
    expect(r.getByTestId("score-row-ones").props.accessibilityState.disabled).toBe(true);
    await press(r, "score-row-ones");
    expect(armed(r, "ones")).toBe(false);
    await press(r, "score-row-ones");
    expect(scored(r, "ones")).toBe(false);
    expect(r.getByText("Round 1 / 13")).toBeTruthy();
    // Landed: the first tap arms, as ever.
    await advance(inputLockMaxMs(5));
    await press(r, "score-row-ones");
    expect(armed(r, "ones")).toBe(true);
    expect(scored(r, "ones")).toBe(false);
  });

  it("an armed row is not committed by a second tap during a tumble (arm, then roll lock)", async () => {
    const r = await renderGame({ initialState: state() });
    await press(r, "score-row-ones");
    await press(r, "yacht-roll-button");
    await press(r, "score-row-ones");
    expect(scored(r, "ones")).toBe(false);
    expect(armed(r, "ones")).toBe(false);
  });
});

describe("a game against the computer (#4092)", () => {
  function vs() {
    return {
      initialState: state(),
      aiDifficulty: "easy" as const,
      aiState: state({ rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    };
  }

  it("the computer's turn never arms, and nothing stays armed when the turn passes", async () => {
    const r = await renderGame(vs());
    await press(r, "score-row-ones");
    expect(armed(r, "ones")).toBe(true);
    // Score a row with points: the turn passes to the computer.
    await press(r, "score-row-sixes");
    expect(armed(r, "ones")).toBe(false);
    // During the computer's turn a press arms nothing.
    await press(r, "score-row-full_house");
    expect(armed(r, "full_house")).toBe(false);
    expect(armed(r, "ones")).toBe(false);
    // Once it has played, it is your turn again, with nothing armed.
    for (let i = 0; i < 20; i++) await advance(1000);
    expect(r.queryByTestId("yacht-armed-row-bar")).toBeNull();
  });
});
