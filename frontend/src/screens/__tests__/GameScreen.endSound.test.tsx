/**
 * Yacht's end-of-game sounds (#3750): the end beat's `onStart` plays one sound for the outcome,
 * when the beat starts (the chord then lands as the card shows). Vs: win, loss or tie from the
 * totals; solo: win on a new best, otherwise tie. Never on a restore or a remount, once per game,
 * and after a last-score jackpot's celebration, never stacked on it.
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
import {
  CPU_JACKPOT_SOUND_MS,
  JACKPOT_DONE_MS,
  TIE_BEAT_MS,
  WIN_BEAT_MS,
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

// Every sound records its plays by registry key.
const mockPlays: string[] = [];
jest.mock("../../game/_shared/useSound", () => ({
  useSound: (key: string) => ({ play: () => (mockPlays.push(key), true), stop: jest.fn() }),
}));
jest.mock("../../game/_shared/useSoundVariants", () => ({
  useSoundVariants: (keys: readonly string[]) => ({
    play: () => (mockPlays.push(keys[0]!), true),
  }),
}));

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

let reduceMotionListeners: Array<(enabled: boolean) => void> = [];
const setReduceMotion = (on: boolean) =>
  act(async () => {
    reduceMotionListeners.forEach((l) => l(on));
  });

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
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const END = ["yacht.win", "yacht.loss", "yacht.tie"];
const endPlays = () => mockPlays.filter((k) => END.includes(k));

beforeEach(() => {
  mockPlays.length = 0;
});

describe("the end sound (solo): a new best is a win, otherwise a tie", () => {
  async function finishSolo(total: number) {
    const r = await renderGame({ initialState: lastRound("chance", total) });
    await press(r, "score-row-chance");
    return r;
  }

  it("a new best plays yacht.win once, as the beat starts (before the card)", async () => {
    await AsyncStorage.setItem(BEST_KEY, "100");
    const r = await finishSolo(100);
    expect(endPlays()).toEqual(["yacht.win"]);
    expect(cardShown(r)).toBe(false);
    await advance(WIN_BEAT_MS + 5000);
    expect(cardShown(r)).toBe(true);
    expect(endPlays()).toEqual(["yacht.win"]);
  });

  it("not a new best plays yacht.tie once", async () => {
    await AsyncStorage.setItem(BEST_KEY, "500");
    await finishSolo(100);
    expect(endPlays()).toEqual(["yacht.tie"]);
    await advance(TIE_BEAT_MS + 5000);
    expect(endPlays()).toEqual(["yacht.tie"]);
  });

  it("a last-score Yacht plays the jackpot, then the end sound only after the celebration", async () => {
    await AsyncStorage.setItem(BEST_KEY, "999");
    const r = await renderGame({ initialState: lastRound("yacht", 0) });
    await press(r, "score-row-yacht");
    expect(mockPlays).toContain("yacht.yacht");
    expect(endPlays()).toEqual([]);
    await advance(JACKPOT_DONE_MS - 1);
    expect(endPlays()).toEqual([]);
    await advance(1);
    expect(endPlays()).toEqual(["yacht.tie"]); // 50 is not a best
    // One end sound, after the jackpot: the jackpot was played first and only once.
    expect(mockPlays.filter((k) => k === "yacht.yacht")).toHaveLength(1);
    expect(mockPlays.indexOf("yacht.yacht")).toBeLessThan(mockPlays.indexOf("yacht.tie"));
    await advance(TIE_BEAT_MS + 5000);
    expect(endPlays()).toEqual(["yacht.tie"]);
    expect(cardShown(r)).toBe(true);
  });

  it("under Reduce Motion it still plays (it is audio, not motion), at once", async () => {
    await AsyncStorage.setItem(BEST_KEY, "100");
    const r = await renderGame({ initialState: lastRound("chance", 100) });
    await setReduceMotion(true);
    await press(r, "score-row-chance");
    expect(endPlays()).toEqual(["yacht.win"]);
    await advance(0);
    expect(cardShown(r)).toBe(true);
    await advance(5000);
    expect(endPlays()).toEqual(["yacht.win"]);
  });

  it("New Game during the beat plays nothing more", async () => {
    await AsyncStorage.setItem(BEST_KEY, "500");
    const r = await finishSolo(100);
    expect(endPlays()).toEqual(["yacht.tie"]);
    await press(r, "yacht-new-game-button");
    await act(async () => {
      await fireEvent.press(r.getByRole("button", { name: "Start new game" }));
    });
    await advance(WIN_BEAT_MS * 2);
    expect(endPlays()).toEqual(["yacht.tie"]);
  });
});

describe("the end sound: a restore and a remount", () => {
  it("a game reopened finished (a restore) is silent, and so is a remount", async () => {
    const finished = lastRound("chance", 130);
    const params = {
      initialState: {
        ...finished,
        scores: { ...finished.scores, chance: 30 },
        game_over: true,
        round: 14,
      },
    };
    const r = await renderGame(params);
    expect(cardShown(r)).toBe(true);
    await r.unmount();
    await renderGame(params);
    await advance(5000);
    expect(mockPlays.filter((k) => END.includes(k))).toEqual([]);
  });
});

describe("the end sound (vs): the outcome decides", () => {
  async function finishVs(playerTotal: number, cpuTotal: number) {
    const r = await renderGame({
      initialState: lastRound("chance", playerTotal),
      aiDifficulty: "easy" as const,
      aiState: lastRound("chance", cpuTotal, { rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    });
    await press(r, "score-row-chance");
    // Nothing yet: the computer has still to play its last turn.
    expect(endPlays()).toEqual([]);
    for (let t = 0; r.queryByText("Computer's Turn") && t < 20_000; t += 5) await advance(5);
    return r;
  }

  it.each([
    ["a win", 100, 0, "yacht.win"],
    ["a loss", 0, 100, "yacht.loss"],
    ["a tie", 50, 50, "yacht.tie"],
  ])("%s plays %s once, as the computer's last score lands", async (_n, you, cpu, key) => {
    const r = await finishVs(you, cpu);
    expect(endPlays()).toEqual([key]);
    await advance(WIN_BEAT_MS + 5000);
    expect(cardShown(r)).toBe(true);
    expect(endPlays()).toEqual([key]);
  });

  it("your last score a Yacht: the end sound waits for the celebration, one sound only", async () => {
    await renderGame({
      initialState: lastRound("yacht", 100),
      aiDifficulty: "easy" as const,
      aiState: lastRound("chance", 0, { rolls_used: 0, dice: [0, 0, 0, 0, 0] }),
    }).then((r) => press(r, "score-row-yacht"));
    await advance(JACKPOT_DONE_MS - 1);
    expect(endPlays()).toEqual([]);
    await advance(1);
    expect(endPlays()).toEqual(["yacht.win"]);
    await advance(5000);
    expect(endPlays()).toEqual(["yacht.win"]);
  });

  describe("the computer's last score is a yacht: one sound at a time", () => {
    /** You finish ahead with Chance; the computer's only open row is Yacht, with five 6s. */
    async function finishWithCpuYacht() {
      const r = await renderGame({
        initialState: lastRound("chance", 100),
        aiDifficulty: "easy" as const,
        aiState: lastRound("yacht", 0, { rolls_used: 3 }),
      });
      await press(r, "score-row-chance");
      for (let t = 0; r.queryByText("Computer's Turn") && t < 20_000; t += 5) await advance(5);
      return r;
    }

    it("its yacht sound plays first; the end sound only after it", async () => {
      const r = await finishWithCpuYacht();
      expect(mockPlays).toContain("yacht.cpuYacht");
      expect(endPlays()).toEqual([]);
      expect(cardShown(r)).toBe(false);
      await advance(CPU_JACKPOT_SOUND_MS - 1);
      expect(endPlays()).toEqual([]);
      await advance(1);
      expect(endPlays()).toEqual(["yacht.win"]);
      expect(mockPlays.indexOf("yacht.cpuYacht")).toBeLessThan(mockPlays.indexOf("yacht.win"));
      expect(cardShown(r)).toBe(false);
      await advance(WIN_BEAT_MS + 5000);
      expect(cardShown(r)).toBe(true);
      expect(endPlays()).toEqual(["yacht.win"]);
    });

    it("under Reduce Motion it still waits for the sound, then shows the card", async () => {
      const r = await renderGame({
        initialState: lastRound("chance", 100),
        aiDifficulty: "easy" as const,
        aiState: lastRound("yacht", 0, { rolls_used: 3 }),
      });
      await setReduceMotion(true);
      await press(r, "score-row-chance");
      for (let t = 0; r.queryByText("Computer's Turn") && t < 20_000; t += 5) await advance(5);
      expect(mockPlays).toContain("yacht.cpuYacht");
      expect(endPlays()).toEqual([]);
      expect(cardShown(r)).toBe(false);
      await advance(CPU_JACKPOT_SOUND_MS);
      expect(endPlays()).toEqual(["yacht.win"]);
      await advance(0);
      expect(cardShown(r)).toBe(true);
    });
  });

  it("a game reopened on the computer's last turn is silent", async () => {
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
    expect(cardShown(r)).toBe(true);
    await advance(5000);
    expect(endPlays()).toEqual([]);
  });
});
