/**
 * #3581: Blackjack's card and chip motion and the sounds timed to it, on the screen. Every
 * moment is checked on the fake clock against the owner-approved timings (#3575, the mockup's
 * cues): the opening deal 180 ms apart, the hole card's flip before the dealer's draws, the
 * dealer ~600 ms a card, the result ~300 ms after the last card lands, the chips ~420 ms after
 * the result and the chip count after them; a split's net chime, then each hand 300 ms apart.
 * Input stays live (a tap lands the motion and is never dropped), Reduce Motion is instant with
 * the sounds at the instant, and nothing replays on restore; New Game, unmount and the player
 * leaving cancel what is still due.
 */
import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame, toViewState } from "../../game/blackjack/engine";
import type { Card, EngineState } from "../../game/blackjack/engine";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import {
  CHIP_BET_MS,
  COLLECT_MS,
  NUDGE_MS,
  PAYOUT_MS,
} from "../../components/blackjack/blackjackMotion";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: jest.fn() }), { actual: true })
);
jest.mock("../../game/blackjack/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  loadGame: jest.fn().mockResolvedValue(null),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());

/** Every sound played, with the fake clock's time. */
const mockLog: { name: string; at: number }[] = [];
jest.mock("../../game/_shared/useSound", () => {
  const players = new Map<string, { play: () => boolean; stop: () => void }>();
  return {
    useSound: (name: string) => {
      if (!players.has(name)) {
        players.set(name, {
          play: () => {
            mockLog.push({ name, at: Date.now() });
            return true;
          },
          stop: () => undefined,
        });
      }
      return players.get(name);
    },
  };
});

const T0 = 1_700_000_000_000;
const HIDDEN_TOO = { includeHiddenElements: true };

const card = (rank: string, suit = "♠"): Card => ({ rank, suit });
/** A deck dealt in this order (the engine deals from the end), then 2♣s. */
const deck = (...order: Card[]): Card[] => [
  ...Array.from({ length: 60 }, () => card("2", "♣")),
  ...[...order].reverse(),
];

/** The Beginner table: 5–25, 100 chips, the goal 250. */
const BEGINNER = { startingChips: 100, runGoal: 250, betMin: 5, betMax: 25 };

// Each round's cards in the order they are dealt: player, dealer hole, player, dealer up.
/** 15 against the dealer's 16, who draws a 2: 18 wins (one draw, a plain loss). */
const LOSE = [card("10"), card("7", "♣"), card("5", "♥"), card("9", "♥")];
/** 19 against the dealer's 14, who draws 2, 2: 18 (two draws, a win). */
const WIN = [card("10"), card("10", "♣"), card("9", "♥"), card("4", "♦")];
/** 18 against the dealer's 16, who draws a 2: 18 (a push). */
const PUSH = [card("10"), card("10", "♣"), card("8", "♥"), card("6", "♦")];
/** 16, and the Hit is a K: a bust. */
const BUST = [card("10"), card("7", "♣"), card("6", "♥"), card("9", "♥"), card("K", "♦")];
/** A natural: A K against 16. */
const NATURAL = [card("A"), card("7", "♣"), card("K", "♥"), card("9", "♥")];
/** A pair of 8s against the dealer's 17; the split deals a 10 (18, a win) and a 5 (13, a loss). */
const SPLIT = [
  card("8"),
  card("10", "♣"),
  card("8", "♥"),
  card("7", "♦"),
  card("10", "♦"),
  card("5", "♣"),
];

/** The navigation's focus listeners, so a test can take the player away. */
const listeners = new Map<string, Array<() => void>>();
function nav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
    isFocused: () => true,
    addListener: (event: string, handler: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return () =>
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((h) => h !== handler)
        );
    },
  } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"] & {
    replace: jest.Mock;
  };
}
const fire = (event: string) =>
  act(async () => {
    (listeners.get(event) ?? []).forEach((h) => h());
  });

async function mountOn(state: EngineState) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const n = nav();
  const view = await render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackTableScreen navigation={n} />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { view, nav: n };
}

/** A new game at the Beginner table, betting, with this round's cards on top. */
const betting = (order: Card[]) => newGame(deck(...order), BEGINNER);

const press = (label: string | RegExp) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/** Puts 10 on the circle and deals. Returns the deal's time. */
async function dealTen(): Promise<number> {
  await press("Add 10 to bet");
  const at = Date.now();
  await press(/deal cards with 10-chip bet/i);
  return at;
}

/** The sounds played from `since` on, as [name, ms after `since`] (a variation as its sound). */
const soundsSince = (since: number) =>
  mockLog
    .filter((e) => e.at >= since)
    .map((e) => [e.name.replace(/[23]$/, ""), e.at - since] as const);
const named = (since: number, name: string) =>
  soundsSince(since)
    .filter(([n]) => n === name)
    .map(([, at]) => at);

const shows = (testID: string) => screen.queryByTestId(testID) !== null;
const resultShown = () => screen.queryByTestId("blackjack-felt-result") !== null;
const hudChips = () =>
  Number(
    /Goal progress: (\d+) of/.exec(
      screen.getByLabelText(/^Goal progress:/).props.accessibilityLabel as string
    )![1]
  );

/** Plays the deal out (the motion settles). */
const settle = () => advance(5000);

let reduceMotionListeners: Array<(enabled: boolean) => void> = [];
const setReduceMotion = (on: boolean) =>
  act(async () => {
    reduceMotionListeners.forEach((l) => l(on));
  });

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
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
  mockLog.length = 0;
  jest.useFakeTimers({ now: T0 });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("the opening deal", () => {
  it("deals player, dealer hole (face down), player, dealer up, 180 ms apart, a sound at each launch", async () => {
    await mountOn(betting(LOSE));
    const at = await dealTen();
    expect(named(at, "blackjack.cardDeal")).toEqual([0]);
    expect(shows("hand-0-card-0")).toBe(true);
    expect(shows("dealer-card-0")).toBe(false);

    await advance(180);
    expect(shows("dealer-card-0")).toBe(true);
    expect(screen.getByTestId("dealer-card-0-outline")).toBeTruthy();
    expect(shows("hand-0-card-1")).toBe(false);

    await advance(180);
    expect(shows("hand-0-card-1")).toBe(true);
    expect(shows("dealer-card-1")).toBe(false);

    await advance(180);
    expect(shows("dealer-card-1")).toBe(true);
    expect(named(at, "blackjack.cardDeal")).toEqual([0, 180, 360, 540]);
    // The hole card stays down, the dealer's total hidden.
    expect(screen.getByLabelText("Dealer score hidden")).toBeTruthy();
    await settle();
    expect(named(at, "blackjack.cardDeal")).toHaveLength(4);
  });

  it("a chip tapped from the tray slides into the circle with its sound", async () => {
    await mountOn(betting(LOSE));
    const at = Date.now();
    await press("Add 10 to bet");
    expect(named(at, "blackjack.chipBet")).toEqual([0]);
    expect(screen.getByTestId("felt-chip-bet", HIDDEN_TOO)).toBeTruthy();
    await advance(CHIP_BET_MS);
    expect(screen.queryByTestId("felt-chip-bet", HIDDEN_TOO)).toBeNull();
  });
});

describe("the dealer's turn", () => {
  it("a loss: flip, one draw at 600 ms, the result 300 ms after it lands, then the stake swept", async () => {
    await mountOn(betting(LOSE));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    expect(soundsSince(at)).toEqual([["blackjack.cardFlip", 0]]);
    expect(shows("dealer-card-2")).toBe(false);
    expect(resultShown()).toBe(false);
    // The engine settled at once; the felt waits for the dealer.
    expect(screen.getByText("Rebet")).toBeTruthy();

    await advance(599);
    expect(shows("dealer-card-2")).toBe(false);
    await advance(1);
    expect(shows("dealer-card-2")).toBe(true);
    await advance(539);
    expect(resultShown()).toBe(false);
    await advance(1);
    expect(resultShown()).toBe(true);
    expect(screen.getByTestId("result-outcome").props.children).toBe("You Lose");
    // The chip count waits for the chips.
    expect(hudChips()).toBe(100);
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.cardDeal", 600],
      ["blackjack.lose", 1140],
      ["blackjack.chipCollect", 1560],
    ]);
    expect(hudChips()).toBe(90);
  });

  it("the chip count updates when the chips land, not before", async () => {
    await mountOn(betting(LOSE));
    await dealTen();
    await settle();
    await press(/^Stand/);
    await advance(1560);
    expect(screen.getByTestId("felt-chip-collect", HIDDEN_TOO)).toBeTruthy();
    expect(hudChips()).toBe(100);
    await advance(COLLECT_MS - 1);
    expect(hudChips()).toBe(100);
    await advance(1);
    expect(hudChips()).toBe(90);
    expect(screen.queryByTestId("felt-chip-collect", HIDDEN_TOO)).toBeNull();
  });

  it("a win: two draws ~600 ms apart, the chime after the last landing, the payout 420 ms later", async () => {
    await mountOn(betting(WIN));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(2160 + PAYOUT_MS - 1);
    expect(hudChips()).toBe(100);
    await advance(1);
    expect(hudChips()).toBe(110);
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.cardDeal", 600],
      ["blackjack.cardDeal", 1200],
      ["blackjack.win", 1740],
      ["blackjack.chipPayout", 2160],
    ]);
  });

  it("a push: the stake nudges", async () => {
    await mountOn(betting(PUSH));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(1560);
    expect(screen.getByTestId("felt-chip-nudge", HIDDEN_TOO)).toBeTruthy();
    await advance(NUDGE_MS);
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.cardDeal", 600],
      ["blackjack.push", 1140],
      ["blackjack.chipNudge", 1560],
    ]);
  });

  it("a bust: the hit card lands, the hole card turns, then the bust", async () => {
    await mountOn(betting(BUST));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Hit/);
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardDeal", 0],
      ["blackjack.cardFlip", 240],
      ["blackjack.bust", 860],
      ["blackjack.chipCollect", 1280],
    ]);
  });

  it("a natural: the deal, the flip as the last card lands, the blackjack chime and its payout", async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(1399);
    expect(resultShown()).toBe(false);
    expect(screen.queryByTestId("animation-overlay", HIDDEN_TOO)?.props.pointerEvents).not.toBe(
      "auto"
    );
    await advance(1);
    expect(resultShown()).toBe(true);
    // The celebration shows with the result.
    expect(screen.getByTestId(/^animation-overlay/, HIDDEN_TOO).props.pointerEvents).toBe("auto");
    await settle();
    expect(soundsSince(at).filter(([n]) => n !== "blackjack.chipBet")).toEqual([
      ["blackjack.cardDeal", 0],
      ["blackjack.cardDeal", 180],
      ["blackjack.cardDeal", 360],
      ["blackjack.cardDeal", 540],
      ["blackjack.cardFlip", 780],
      ["blackjack.blackjack", 1400],
      ["blackjack.chipPayout", 1820],
    ]);
  });
});

describe("a split", () => {
  it("slides the pair apart, the second stake follows, then each hand gets its card", async () => {
    await mountOn(betting(SPLIT));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Split —/);
    // The second 8 is the same card, moved: hand 2 shows it at once, nothing is dealt yet.
    expect(shows("hand-1-card-0")).toBe(true);
    expect(shows("hand-0-card-1")).toBe(false);
    expect(soundsSince(at)).toEqual([]);
    await advance(300);
    expect(screen.getByTestId("felt-chip-split", HIDDEN_TOO)).toBeTruthy();
    await advance(160);
    expect(shows("hand-0-card-1")).toBe(true);
    expect(shows("hand-1-card-1")).toBe(false);
    await advance(180);
    expect(shows("hand-1-card-1")).toBe(true);
    expect(soundsSince(at)).toEqual([
      ["blackjack.chipBet", 300],
      ["blackjack.cardDeal", 460],
      ["blackjack.cardDeal", 640],
    ]);
  });

  it("one net chime, then each hand's result and chips 300 ms apart", async () => {
    await mountOn(betting(SPLIT));
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    await press(/^Stand/);
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    // The dealer has 17: no draw. The result 300 ms after the flip ends.
    await advance(620);
    expect(resultShown()).toBe(true);
    // Net even: a push on the felt; no hand's own result shows yet.
    expect(screen.getByTestId("result-outcome").props.children).toBe("Push");
    expect(screen.queryAllByTestId("hand-payout")).toHaveLength(0);
    await advance(420);
    expect(screen.getAllByTestId("hand-payout").map((n) => n.props.children)).toEqual([
      "+10 chips",
    ]);
    await advance(300);
    expect(screen.getAllByTestId("hand-payout").map((n) => n.props.children)).toEqual([
      "+10 chips",
      "-10 chips",
    ]);
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.push", 620],
      ["blackjack.chipPayout", 1040],
      ["blackjack.chipCollect", 1340],
    ]);
  });
});

describe("input stays live", () => {
  it("a Hit during the opening deal lands the deal at once and deals its card", async () => {
    await mountOn(betting(BUST));
    const at = await dealTen();
    await advance(200);
    expect(shows("hand-0-card-1")).toBe(false);
    await press(/^Hit/);
    // Every card of the deal is down, and the hit's card is dealt: nothing was dropped.
    expect(shows("hand-0-card-1")).toBe(true);
    expect(shows("dealer-card-1")).toBe(true);
    expect(shows("hand-0-card-2")).toBe(true);
    await settle();
    // The deal's later cards make no sound once landed; the hit's card and its bust do.
    expect(named(at, "blackjack.cardDeal")).toEqual([0, 180, 200]);
    expect(named(at, "blackjack.bust")).toEqual([200 + 860]);
  });

  it("a Rebet during the dealer's turn lands it, sounds its result once, and deals the next hand", async () => {
    // The first round's dealer draws the 2♣; the next round is dealt the same cards.
    await mountOn(betting([...LOSE, card("2", "♣"), ...LOSE]));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(300);
    await press(/^Rebet — deal again with 10 chips/);
    // The skipped result is heard once, at the tap; the next hand is being dealt.
    expect(named(at, "blackjack.lose")).toEqual([300]);
    expect(named(at, "blackjack.cardDeal")).toEqual([300]);
    await settle();
    expect(named(at, "blackjack.lose")).toEqual([300]);
    expect(named(at, "blackjack.chipCollect")).toEqual([]);
    expect(named(at, "blackjack.cardFlip")).toEqual([0]);
    expect(shows("dealer-card-1")).toBe(true);
    expect(hudChips()).toBe(90);
  });
});

describe("Reduce Motion", () => {
  it("is instant, with each sound once at the instant", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await mountOn(betting(WIN));
    const at = await dealTen();
    expect(shows("dealer-card-1")).toBe(true);
    expect(screen.queryByTestId("felt-chip-bet", HIDDEN_TOO)).toBeNull();
    await advance(1000);
    const stand = Date.now();
    await press(/^Stand/);
    expect(resultShown()).toBe(true);
    expect(shows("dealer-card-3")).toBe(true);
    expect(hudChips()).toBe(110);
    expect(soundsSince(stand)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.cardDeal", 0],
      ["blackjack.win", 0],
      ["blackjack.chipPayout", 0],
    ]);
    await settle();
    // The deal's four cards: one deal sound; the dealer's draws: one more, with the result.
    expect(named(at, "blackjack.cardDeal")).toEqual([0, 1000]);
  });

  it("turned on mid-motion lands everything at once; nothing still due plays later", async () => {
    await mountOn(betting(WIN));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(700);
    await setReduceMotion(true);
    expect(resultShown()).toBe(true);
    expect(shows("dealer-card-3")).toBe(true);
    expect(hudChips()).toBe(110);
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.cardDeal", 600],
      ["blackjack.win", 700],
    ]);
  });
});

describe("nothing replays", () => {
  it("restoring a settled round with its events plays nothing and moves nothing", async () => {
    const engine = betting(LOSE);
    const settled: EngineState = {
      ...engine,
      phase: "result",
      bet: 10,
      chips: 90,
      outcome: "lose",
      payout: -10,
      player_hand: [card("10"), card("5", "♥")],
      dealer_hand: [card("7", "♣"), card("9", "♥"), card("2", "♣")],
      events: [{ type: "cardDeal" }, { type: "loss" }],
    };
    await mountOn(settled);
    expect(resultShown()).toBe(true);
    expect(shows("dealer-card-2")).toBe(true);
    expect(hudChips()).toBe(90);
    await settle();
    expect(mockLog).toEqual([]);
    expect(screen.queryByTestId(/^felt-chip-/, HIDDEN_TOO)).toBeNull();
  });

  it("restoring a hand in play shows its cards at once, silently", async () => {
    const engine = betting(LOSE);
    const playing: EngineState = {
      ...engine,
      phase: "player",
      bet: 10,
      player_hand: [card("10"), card("5", "♥")],
      dealer_hand: [card("7", "♣"), card("9", "♥")],
    };
    expect(toViewState(playing).phase).toBe("player");
    await mountOn(playing);
    expect(shows("dealer-card-1")).toBe(true);
    expect(shows("hand-0-card-1")).toBe(true);
    await settle();
    expect(mockLog).toEqual([]);
  });
});

describe("cancelled cues", () => {
  it("leaving mid-motion lands it silently; coming back replays nothing", async () => {
    await mountOn(betting(WIN));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(300);
    await fire("blur");
    expect(resultShown()).toBe(true);
    await settle();
    await fire("focus");
    await settle();
    expect(soundsSince(at)).toEqual([["blackjack.cardFlip", 0]]);
  });

  it("unmounting mid-motion plays nothing more", async () => {
    const { view } = await mountOn(betting(WIN));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(300);
    await act(async () => view.unmount());
    await settle();
    expect(soundsSince(at)).toEqual([["blackjack.cardFlip", 0]]);
  });

  it("New Game mid-motion plays nothing more", async () => {
    await mountOn(betting(WIN));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(300);
    await press("More options");
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game"));
    });
    await press("Start New");
    await settle();
    expect(soundsSince(at)).toEqual([["blackjack.cardFlip", 0]]);
  });

  it("the out-of-chips result waits for the last hand's stake to be swept", async () => {
    const engine = newGame(deck(...LOSE), { ...BEGINNER, startingChips: 10 });
    await mountOn(engine);
    await dealTen();
    await settle();
    await press(/^Stand/);
    await advance(1560 + COLLECT_MS - 1);
    expect(screen.queryByTestId("blackjack-result")).toBeNull();
    await advance(1);
    expect(screen.getByTestId("blackjack-result")).toBeTruthy();
  });

  // #3720 review: in the render that commits the Stand the motion had not planned yet, so the
  // card showed for one commit, its haptic and announcement firing ~1.5 s early, then again.
  it("the out-of-chips card's haptic and announcement fire once, after the round settles", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);
    const notify = jest.spyOn(Haptics, "notificationAsync").mockResolvedValue(undefined);
    const impact = jest.spyOn(Haptics, "impactAsync").mockResolvedValue(undefined);
    const feedback = () => notify.mock.calls.length + impact.mock.calls.length;
    const engine = newGame(deck(...LOSE), { ...BEGINNER, startingChips: 10 });
    await mountOn(engine);
    await dealTen();
    await settle();
    announce.mockClear();
    await press(/^Stand/);
    expect(announce).not.toHaveBeenCalled();
    expect(feedback()).toBe(0);
    await advance(1560 + COLLECT_MS - 1);
    expect(announce).not.toHaveBeenCalled();
    expect(feedback()).toBe(0);
    await advance(1);
    await settle();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(feedback()).toBe(1);
  });

  it("the run's toasts wait for the round to settle", async () => {
    const engine = newGame(deck(...WIN), { ...BEGINNER, milestones: [105] });
    await mountOn(engine);
    await dealTen();
    await settle();
    await press(/^Stand/);
    const toast = () => screen.queryByText("Milestone reached: 105 chips!");
    await advance(2160 + PAYOUT_MS - 1);
    expect(toast()).toBeNull();
    await advance(1);
    expect(toast()).toBeTruthy();
  });

  it("the run's goal opens the victory screen once the winning hand has paid", async () => {
    const engine = newGame(deck(...WIN), { ...BEGINNER, runGoal: 105 });
    const { nav: n } = await mountOn(engine);
    await dealTen();
    await settle();
    await press(/^Stand/);
    await advance(2160 + PAYOUT_MS - 1);
    expect(n.replace).not.toHaveBeenCalled();
    await advance(1);
    expect(n.replace).toHaveBeenCalledWith("BlackjackVictory");
  });
});
