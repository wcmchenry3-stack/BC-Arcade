/**
 * Yacht motion on the screen (#3749): input is locked while your dice tumble (audit bug 8), the
 * tumble ends from the motion constant and its timer is cleared (bug 9), the result card waits for
 * the end beat (win 1.0 s, loss and tie 0.6 s), which waits for a YACHT! celebration (bug 1), the
 * computer's last turn plays at 2x, a game reopened on it shows the card at once, the solo best
 * decides win or tie, and Reduce Motion is read live.
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
import * as Reanimated from "react-native-reanimated";
import {
  CPU_SCORE_BEAT_MS,
  INPUT_LOCK_FALLBACK_MS,
  JACKPOT_DONE_MS,
  LOSS_BEAT_MS,
  TIE_BEAT_MS,
  WIN_BEAT_MS,
  cpuRollMs,
  inputLockMaxMs,
  tumbleTotalMs,
} from "../../game/yacht/motion";

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
const BEST_KEY = "yacht_best_score_v1";

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

/** The last round: `open` left to score, `total` points in Three of a Kind, every other row 0. */
function lastRound(open: string, total: number, over: Partial<GameState> = {}): GameState {
  const scores = Object.fromEntries(
    CATEGORIES.map((c) => [c, c === open ? null : c === "three_of_a_kind" ? total : 0])
  );
  return state({
    round: 13,
    rolls_used: 1,
    dice: [6, 6, 6, 6, 6],
    scores,
    total_score: total,
    ...over,
  });
}

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), popToTop: jest.fn() };

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
  // The stored best (read at mount) and the mode picker.
  await advance(0);
  const pick = r.queryByTestId("yacht-mode-solo");
  if (pick) await act(async () => fireEvent.press(pick));
  return r;
}
type Rendered = Awaited<ReturnType<typeof renderGame>>;

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const press = (r: Rendered, testID: string) =>
  act(async () => {
    await fireEvent.press(r.getByTestId(testID));
  });

const cardShown = (r: Rendered) => r.queryByTestId("yacht-result-title") !== null;
const isHeld = (r: Rendered, i: number) =>
  r.getByTestId(`yacht-die-${i}`).props.accessibilityState.checked === true;
const hintDisabled = (r: Rendered) =>
  r.getByTestId("yacht-hint-button").props.accessibilityState.disabled === true;

let reduceMotionListeners: Array<(enabled: boolean) => void> = [];
const setReduceMotion = (on: boolean) =>
  act(async () => {
    reduceMotionListeners.forEach((l) => l(on));
  });

let announce: jest.SpyInstance;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetReduceMotionForTests();
  reduceMotionListeners = [];
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
    event: string,
    handler: (enabled: boolean) => void
  ) => {
    if (event === "reduceMotionChanged") reduceMotionListeners.push(handler);
    return { remove: () => undefined };
  }) as never);
  // The card announces itself once it is shown: a card that flashed up would be heard.
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("your roll: the tumble locks input until the dice land (audit bugs 8 and 9)", () => {
  async function rolled() {
    const r = await renderGame({ initialState: state({ rolls_used: 1, dice: [6, 6, 6, 2, 3] }) });
    await press(r, "yacht-roll-button");
    return r;
  }

  it("Roll, the dice, the score rows and Hint are inert while the dice tumble", async () => {
    const r = await rolled();
    expect(r.getByText("Roll (1 left)")).toBeTruthy();
    // Each says so to a screen reader (and to a test driver), though it keeps its look.
    for (const id of ["yacht-roll-button", "yacht-die-0", "score-row-sixes", "yacht-hint-button"]) {
      expect(r.getByTestId(id).props.accessibilityState.disabled).toBe(true);
    }
    // Roll again: nothing.
    await press(r, "yacht-roll-button");
    expect(r.getByText("Roll (1 left)")).toBeTruthy();
    // Hold a die: nothing.
    await press(r, "yacht-die-0");
    expect(isHeld(r, 0)).toBe(false);
    // Score a row: nothing.
    await press(r, "score-row-sixes");
    expect(r.getByText("Round 1 / 13")).toBeTruthy();
    // Hint: nothing.
    await press(r, "yacht-hint-button");
    expect(r.queryByTestId("yacht-hint-message")).toBeNull();
    expect(r.queryByTestId("yacht-no-hint-toast")).toBeNull();
  });

  it("everything works again the moment the last die reports it has landed", async () => {
    // Each die's tumble reports its end: kept here, to land them by hand.
    const landings: Array<(finished: boolean) => void> = [];
    jest.spyOn(Reanimated, "withTiming").mockImplementation(((
      value: number,
      _config?: unknown,
      done?: (finished: boolean) => void
    ) => {
      if (done) landings.push(done);
      return value;
    }) as never);
    const r = await rolled();
    expect(landings).toHaveLength(5);
    // Four have landed, one is still in the air (a tumble that started late): still locked.
    await act(async () => landings.slice(0, 4).forEach((land) => land(true)));
    await press(r, "yacht-die-0");
    expect(isHeld(r, 0)).toBe(false);
    expect(r.getByTestId("yacht-roll-button").props.accessibilityState.disabled).toBe(true);
    // The last lands: everything takes a press again, with no time having passed.
    await act(async () => landings[4]!(true));
    for (const id of ["yacht-roll-button", "score-row-sixes", "yacht-hint-button"]) {
      expect(r.getByTestId(id).props.accessibilityState.disabled).toBe(false);
    }
    await press(r, "yacht-die-0");
    expect(isHeld(r, 0)).toBe(true);
    await press(r, "yacht-roll-button");
    expect(r.getByText("Roll (0 left)")).toBeTruthy();
  });

  it("the lock's safety net ends from the motion constant for the dice rolled (bug 9)", async () => {
    // No animation runs here, so no die reports its landing: the safety net releases the lock.
    const r = await renderGame({ initialState: state({ rolls_used: 1, dice: [6, 6, 6, 2, 3] }) });
    await press(r, "yacht-die-0");
    await press(r, "yacht-die-1");
    await press(r, "yacht-die-2");
    await press(r, "yacht-roll-button");
    // Two dice rolled: one tumble and one stagger, then the net's margin.
    expect(hintDisabled(r)).toBe(true);
    await advance(400);
    expect(hintDisabled(r)).toBe(true);
    await advance(inputLockMaxMs(2) - 401);
    expect(hintDisabled(r)).toBe(true);
    await advance(1);
    expect(hintDisabled(r)).toBe(false);
    expect(inputLockMaxMs(2)).toBe(tumbleTotalMs(2) + INPUT_LOCK_FALLBACK_MS);
  });

  it("its timer is cleared when the screen goes away mid-tumble (bug 9)", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const r = await rolled();
    const i = setSpy.mock.calls.findIndex((c) => c[1] === inputLockMaxMs(5));
    expect(i).toBeGreaterThanOrEqual(0);
    const timer = setSpy.mock.results[i]!.value;
    await act(async () => r.unmount());
    expect(clearSpy).toHaveBeenCalledWith(timer);
  });

  it("Reduce Motion turned on mid-tumble lands the dice and unlocks input at once", async () => {
    const r = await rolled();
    await setReduceMotion(true);
    await press(r, "yacht-die-0");
    expect(isHeld(r, 0)).toBe(true);
  });

  it("under Reduce Motion there is no tumble and no lock", async () => {
    const r = await renderGame({ initialState: state({ rolls_used: 1, dice: [6, 6, 6, 2, 3] }) });
    await setReduceMotion(true);
    await press(r, "yacht-roll-button");
    expect(hintDisabled(r)).toBe(false);
    await press(r, "score-row-sixes");
    expect(r.getByText("Round 2 / 13")).toBeTruthy();
  });
});

describe("the end beat (solo): a new best is a win (1.0 s), else a tie (0.6 s)", () => {
  /** Scores the last row (Chance, 30 with five 6s). */
  async function finishSolo(total: number) {
    const r = await renderGame({ initialState: lastRound("chance", total) });
    await press(r, "score-row-chance");
    return r;
  }

  it("a new best: the card waits the win beat, with no flash before it", async () => {
    await AsyncStorage.setItem(BEST_KEY, "100");
    const r = await finishSolo(100); // 130 > 100
    expect(cardShown(r)).toBe(false);
    await advance(WIN_BEAT_MS - 1);
    expect(cardShown(r)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
    await advance(1);
    expect(cardShown(r)).toBe(true);
    expect(await AsyncStorage.getItem(BEST_KEY)).toBe("130");
  });

  it("not a new best: the card waits the tie beat, and the best stays", async () => {
    await AsyncStorage.setItem(BEST_KEY, "500");
    const r = await finishSolo(100);
    await advance(TIE_BEAT_MS - 1);
    expect(cardShown(r)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
    await advance(1);
    expect(cardShown(r)).toBe(true);
    expect(await AsyncStorage.getItem(BEST_KEY)).toBe("500");
  });

  it("the first finished game (no best stored) is a new best: the win beat", async () => {
    const r = await finishSolo(0);
    await advance(TIE_BEAT_MS);
    expect(cardShown(r)).toBe(false);
    await advance(WIN_BEAT_MS - TIE_BEAT_MS);
    expect(cardShown(r)).toBe(true);
    expect(await AsyncStorage.getItem(BEST_KEY)).toBe("30");
  });

  it("a last-score Yacht: the celebration plays out, then the beat, then the card (bug 1)", async () => {
    await AsyncStorage.setItem(BEST_KEY, "999");
    const r = await renderGame({ initialState: lastRound("yacht", 0) });
    await press(r, "score-row-yacht");
    // The whole celebration, with no card over it.
    await advance(JACKPOT_DONE_MS - 1);
    expect(cardShown(r)).toBe(false);
    // Then the tie beat (50 is not a best), and only then the card.
    await advance(1 + TIE_BEAT_MS - 1);
    expect(cardShown(r)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
    await advance(1);
    expect(cardShown(r)).toBe(true);
  });

  it("New Game during the beat clears it: no card for the old game", async () => {
    const r = await finishSolo(100);
    await press(r, "yacht-new-game-button");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Start new game" }));
    });
    await advance(WIN_BEAT_MS * 2);
    expect(cardShown(r)).toBe(false);
    expect(r.getByTestId("yacht-mode-card")).toBeTruthy();
  });

  it("the screen going away mid-beat clears the beat's timer", async () => {
    const setSpy = jest.spyOn(global, "setTimeout");
    const clearSpy = jest.spyOn(global, "clearTimeout");
    const r = await finishSolo(100);
    const i = setSpy.mock.calls.findIndex((c) => c[1] === WIN_BEAT_MS);
    expect(i).toBeGreaterThanOrEqual(0);
    const timer = setSpy.mock.results[i]!.value;
    await act(async () => r.unmount());
    expect(clearSpy).toHaveBeenCalledWith(timer);
  });

  it("Reduce Motion turned on mid-beat shows the card at once; off again replays nothing", async () => {
    const r = await finishSolo(100);
    await advance(100);
    expect(cardShown(r)).toBe(false);
    await setReduceMotion(true);
    await advance(0);
    expect(cardShown(r)).toBe(true);
    await setReduceMotion(false);
    await advance(WIN_BEAT_MS);
    expect(cardShown(r)).toBe(true);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("under Reduce Motion the card shows as the game ends: no beat", async () => {
    const r = await renderGame({ initialState: lastRound("chance", 100) });
    await setReduceMotion(true);
    await press(r, "score-row-chance");
    await advance(0);
    expect(cardShown(r)).toBe(true);
  });
});

describe("the end beat (vs): after the computer's last score", () => {
  /** You finish ahead or behind (Chance, 30); the computer's only open row is Chance (30). */
  async function finishVs(playerTotal: number, cpuTotal: number) {
    const r = await renderGame({
      initialState: lastRound("chance", playerTotal),
      aiDifficulty: "easy" as const,
      aiState: lastRound("chance", cpuTotal, { rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    });
    await press(r, "score-row-chance");
    return r;
  }

  /** Plays the computer's last turn in 5 ms steps; returns how long it took. */
  async function cpuTurn(r: Rendered): Promise<number> {
    let t = 0;
    while (r.queryByText("Computer's Turn") && t < 20_000) {
      await advance(5);
      t += 5;
    }
    return t;
  }

  it("its last turn plays at 2x, then the win beat, then the card", async () => {
    const r = await finishVs(100, 0);
    expect(r.getByText("Computer's Turn")).toBeTruthy();
    // A roll of five and the score beat (it keeps five 6s for Chance), at 2x.
    const ms = await cpuTurn(r);
    expect(ms).toBe((cpuRollMs(5) + CPU_SCORE_BEAT_MS) / 2);
    expect(cardShown(r)).toBe(false);
    await advance(WIN_BEAT_MS - 5);
    expect(cardShown(r)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
    await advance(5);
    expect(cardShown(r)).toBe(true);
  });

  it("your last score a Yacht: the computer plays meanwhile, and the beat waits for the celebration (bug 1)", async () => {
    const r = await renderGame({
      initialState: lastRound("yacht", 100),
      aiDifficulty: "easy" as const,
      aiState: lastRound("chance", 0, { rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    });
    await press(r, "score-row-yacht");
    // The computer's fast last turn is over well inside the celebration.
    expect(await cpuTurn(r)).toBeLessThan(JACKPOT_DONE_MS);
    await advance(JACKPOT_DONE_MS - 1 - (cpuRollMs(5) + CPU_SCORE_BEAT_MS) / 2);
    expect(cardShown(r)).toBe(false);
    // The celebration ends; then the win beat; then the card.
    await advance(1 + WIN_BEAT_MS - 1);
    expect(cardShown(r)).toBe(false);
    expect(announce).not.toHaveBeenCalled();
    await advance(1);
    expect(cardShown(r)).toBe(true);
  });

  it.each([
    ["a loss", 0, 100, LOSS_BEAT_MS],
    ["a tie", 50, 50, TIE_BEAT_MS],
  ])("%s: the 0.6 s beat", async (_name, you, cpu, beat) => {
    const r = await finishVs(you, cpu);
    await cpuTurn(r);
    await advance(beat - 5);
    expect(cardShown(r)).toBe(false);
    await advance(5);
    expect(cardShown(r)).toBe(true);
  });

  it("under Reduce Motion its last turn is a quarter as long (2x, pauses halved) and the card shows at once", async () => {
    const r = await renderGame({
      initialState: lastRound("chance", 100),
      aiDifficulty: "easy" as const,
      aiState: lastRound("chance", 0, { rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    });
    await setReduceMotion(true);
    await press(r, "score-row-chance");
    const ms = await cpuTurn(r);
    const quarter = (cpuRollMs(5) + CPU_SCORE_BEAT_MS) / 4;
    expect(ms).toBeGreaterThanOrEqual(quarter);
    expect(ms).toBeLessThan(quarter + 5);
    await advance(0);
    expect(cardShown(r)).toBe(true);
  });

  it("a game reopened on the computer's last turn scores it at once and shows the card: no beat", async () => {
    const finished = lastRound("chance", 130);
    const r = await renderGame({
      initialState: {
        ...finished,
        scores: { ...finished.scores, chance: 30 },
        game_over: true,
        round: 14,
      },
      aiDifficulty: "easy" as const,
      aiState: lastRound("chance", 0, { rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    });
    expect(r.queryByText("Computer's Turn")).toBeNull();
    expect(cardShown(r)).toBe(true);
  });
});

describe("the tray during the end beat (owner, review round 1)", () => {
  /** The die faces the tray shows, from their labels. */
  const faces = (r: Rendered) =>
    [0, 1, 2, 3, 4].map((i) =>
      Number(/showing (\d)/.exec(r.getByTestId(`yacht-die-${i}`).props.accessibilityLabel)?.[1])
    );

  it("solo: the final dice stay, the hint reads 'Game over' and Roll is disabled", async () => {
    const r = await renderGame({
      initialState: lastRound("chance", 100, { dice: [2, 3, 4, 5, 6] }),
    });
    await press(r, "score-row-chance");
    expect(cardShown(r)).toBe(false);
    expect(faces(r)).toEqual([2, 3, 4, 5, 6]);
    expect(r.getByTestId("yacht-game-over-hint")).toHaveTextContent("Game over");
    expect(r.queryByText(/Press Roll/)).toBeNull();
    expect(r.queryByText("Roll (3 left)")).toBeNull();
    expect(r.getByTestId("yacht-roll-button").props.accessibilityState.disabled).toBe(true);
  });

  it("vs: after the computer's last score its final dice stay, with 'Game over'", async () => {
    const r = await renderGame({
      initialState: lastRound("chance", 100, { dice: [2, 2, 2, 2, 2] }),
      aiDifficulty: "easy" as const,
      aiState: lastRound("chance", 0, { rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    });
    await press(r, "score-row-chance");
    // Its turn: "Computer is rolling…", not "Game over".
    expect(r.queryByTestId("yacht-game-over-hint")).toBeNull();
    for (let t = 0; t < 5000 && r.queryByText("Computer's Turn"); t += 5) await advance(5);
    expect(cardShown(r)).toBe(false);
    expect(faces(r)).toEqual([6, 6, 6, 6, 6]);
    expect(r.getByTestId("yacht-game-over-hint")).toBeTruthy();
    expect(r.getByTestId("yacht-roll-button").props.accessibilityState.disabled).toBe(true);
  });
});

describe("the solo best not read yet (review round 1)", () => {
  it("the beat waits for it, so its outcome is right: a new best is still a win", async () => {
    let answer: (v: string | null) => void = () => undefined;
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockImplementation((key: string) =>
        key === BEST_KEY ? new Promise((resolve) => (answer = resolve)) : Promise.resolve(null)
      );
    const setItem = jest.spyOn(AsyncStorage, "setItem");
    const r = await renderGame({ initialState: lastRound("chance", 100) });
    await press(r, "score-row-chance");
    // However long the read takes, the card waits for it.
    await advance(5000);
    expect(cardShown(r)).toBe(false);
    // 130 beats 10: the win beat, then the card.
    await act(async () => answer("10"));
    await advance(WIN_BEAT_MS - 1);
    expect(cardShown(r)).toBe(false);
    await advance(1);
    expect(cardShown(r)).toBe(true);
    expect(setItem).toHaveBeenCalledWith(BEST_KEY, "130");
  });
});
