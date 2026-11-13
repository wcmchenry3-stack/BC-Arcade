/**
 * #3581: Blackjack's card and chip motion and the sounds timed to it, on the screen. Every
 * moment is checked on the fake clock against the owner-approved timings (#3575, the mockup's
 * cues): the opening deal 180 ms apart, the hole card's flip before the dealer's draws, the
 * dealer ~600 ms a card, the result ~300 ms after the last card lands, the chips ~420 ms after
 * the result and the chip count after them; a split's net chime, then each hand 300 ms apart.
 * Input stays live (a tap lands the motion and is never dropped), Reduce Motion is instant with
 * the sounds 100 ms apart (#3751), and nothing replays on restore; New Game, unmount and the player
 * leaving cancel what is still due.
 */
import React from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { createSeededRng, newGame, setRng, toViewState } from "../../game/blackjack/engine";
import type { Card, EngineState } from "../../game/blackjack/engine";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { REDUCE_MOTION_SOUND_GAP_MS } from "../../components/blackjack/useBlackjackMotion";
import {
  CHIP_BET_MS,
  COLLECT_MS,
  NUDGE_MS,
  PAYOUT_MS,
  SKIP_HOLD_MS,
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
/**
 * A deck dealt in this order (the engine deals from the end), then 2♣s. At least 78 cards, the
 * 6-deck reshuffle threshold, so a next hand (Rebet) deals on from it and never from a fresh,
 * random shoe (#3720 round 2: a 69-card deck made two tests flaky).
 */
const deck = (...order: Card[]): Card[] => [
  ...Array.from({ length: 80 }, () => card("2", "♣")),
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
const disabled = (label: RegExp) =>
  screen.getByLabelText(label).props.accessibilityState?.disabled === true;
/** A tap on the felt (it lands any motion at once). */
const tapFelt = () =>
  act(async () => {
    await fireEvent.press(screen.getByTestId("blackjack-table-area"));
  });
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
  // A shoe that must be shuffled still shuffles the same way every run.
  setRng(createSeededRng(3581));
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
  setRng(Math.random);
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
    expect(within(screen.getByTestId("dealer-card-0")).getByTestId("minimal-back")).toBeTruthy();
    expect(screen.queryByTestId("dealer-card-0-outline")).toBeNull();
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
    // The engine settled at once; the felt waits for the dealer, under greyed actions (owner
    // decision, #3720): the dock shows no result before the felt does.
    expect(screen.queryByText("Rebet")).toBeNull();
    expect(disabled(/^Hit/)).toBe(true);
    expect(disabled(/^Stand/)).toBe(true);

    await advance(599);
    expect(shows("dealer-card-2")).toBe(false);
    await advance(1);
    expect(shows("dealer-card-2")).toBe(true);
    await advance(539);
    expect(resultShown()).toBe(false);
    await advance(1);
    expect(resultShown()).toBe(true);
    expect(screen.getByTestId("result-outcome").props.children).toBe("You Lose");
    expect(screen.getByText("Rebet")).toBeTruthy();
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

  // #3621 (owner decisions, #3739): the sting lands with the second card, and the result shows at
  // the flip's end (no 300 ms wait), with no overlay.
  it("a natural: the deal, the sting as the second card lands, the flip, the result at its end and the payout", async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(1099);
    expect(resultShown()).toBe(false);
    await advance(1);
    expect(resultShown()).toBe(true);
    expect(screen.queryByTestId(/^animation-overlay/, HIDDEN_TOO)).toBeNull();
    await settle();
    expect(soundsSince(at).filter(([n]) => n !== "blackjack.chipBet")).toEqual([
      ["blackjack.cardDeal", 0],
      ["blackjack.cardDeal", 180],
      ["blackjack.cardDeal", 360],
      ["blackjack.cardDeal", 540],
      ["blackjack.blackjack", 600],
      ["blackjack.cardFlip", 780],
      ["blackjack.chipPayout", 1520],
    ]);
  });
});

describe("a split", () => {
  // Owner decision (#3720, as the mockup): only the hand to play is dealt its second card (~720 ms);
  // the new hand shows one card until its turn.
  it("slides the pair apart, the stake follows, then the hand to play gets its second card", async () => {
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
    await advance(419);
    expect(shows("hand-0-card-1")).toBe(false);
    await advance(1);
    expect(shows("hand-0-card-1")).toBe(true);
    await settle();
    expect(shows("hand-1-card-1")).toBe(false);
    expect(soundsSince(at)).toEqual([
      ["blackjack.chipBet", 300],
      ["blackjack.cardDeal", 720],
    ]);
  });

  it("each split hand is dealt its second card when it becomes the hand to play", async () => {
    await mountOn(betting(SPLIT));
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    // Hand 2 shows one card: its label counts one 8.
    expect(screen.getByTestId("hand-label-1").props.accessibilityLabel).toMatch(/Player score 8\b/);
    const at = Date.now();
    await press(/^Stand/);
    await advance(349);
    expect(shows("hand-1-card-1")).toBe(false);
    await advance(1);
    expect(shows("hand-1-card-1")).toBe(true);
    await advance(240);
    expect(screen.getByTestId("hand-label-1").props.accessibilityLabel).toMatch(
      /Player score 13\b/
    );
    expect(soundsSince(at)).toEqual([["blackjack.cardDeal", 350]]);
  });

  it("one chime, then each hand's result and chips 300 ms apart", async () => {
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
    // Net even: a push on the felt; a win and a loss play the mixed chime (#3770), not the push.
    // No hand's own result shows yet.
    // #3720 review: the banner is the net from the start and never changes as the hands reveal.
    // The strip under the dealer shows the net alone (owner decision, #3784), its label naming the
    // net push and summing the round up (#3581 spec: "1 win · 2 lost").
    const banner = () => screen.getByTestId("result-net").props.children;
    const tags = () => screen.queryAllByTestId("hand-tag").map((n) => n.props.children);
    expect(banner()).toBe("No change");
    expect(screen.getByTestId("result-net").props.accessibilityLabel).toBe(
      "Push. Won: 1 · Lost: 1. Payout: 0 chips"
    );
    expect(screen.queryAllByTestId("hand-payout")).toHaveLength(0);
    expect(tags()).toEqual([]);
    await advance(419);
    expect(tags()).toEqual([]);
    await advance(1);
    // Hand 1's WIN tag pops with its chips, then hand 2's LOSE 300 ms later.
    expect(tags()).toEqual(["Win"]);
    expect(screen.getAllByTestId("hand-payout").map((n) => n.props.children)).toEqual(["+10"]);
    expect(banner()).toBe("No change");
    await advance(299);
    expect(tags()).toEqual(["Win"]);
    await advance(1);
    expect(tags()).toEqual(["Win", "Lose"]);
    expect(screen.getAllByTestId("hand-payout").map((n) => n.props.children)).toEqual([
      "+10",
      "-10",
    ]);
    expect(banner()).toBe("No change");
    await advance(COLLECT_MS);
    expect(banner()).toBe("No change");
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.mixed", 620],
      ["blackjack.chipPayout", 1040],
      ["blackjack.chipCollect", 1340],
    ]);
  });
});

// #3720 review: a total counted a card at its launch, and the dealer's total showed as the hole
// card began to turn. A card counts as it lands; the dealer's total once the turn has ended.
describe("totals", () => {
  const playerTotal = () =>
    /Player score (\d+)/.exec(
      screen.getByTestId("hand-label-0").props.accessibilityLabel as string
    )?.[1];
  const dealerLabel = () =>
    screen.getByLabelText(/^Dealer score/).props.accessibilityLabel as string;

  it("a dealt card counts in its hand's total as it lands, not as it is launched", async () => {
    await mountOn(betting(LOSE));
    await dealTen();
    expect(playerTotal()).toBe("0");
    await advance(239);
    expect(playerTotal()).toBe("0");
    await advance(1);
    expect(playerTotal()).toBe("10");
    // The second card launches at 360 and lands at 600.
    await advance(359);
    expect(playerTotal()).toBe("10");
    await advance(1);
    expect(playerTotal()).toBe("15");
  });

  it("the dealer's total shows once the hole card has turned, and each draw counts as it lands", async () => {
    await mountOn(betting(LOSE));
    await dealTen();
    await settle();
    await press(/^Stand/);
    expect(dealerLabel()).toBe("Dealer score hidden");
    await advance(319);
    expect(dealerLabel()).toBe("Dealer score hidden");
    await advance(1);
    expect(dealerLabel()).toBe("Dealer score 16");
    // The draw launches at 600 and lands at 840.
    await advance(519);
    expect(dealerLabel()).toBe("Dealer score 16");
    await advance(1);
    expect(dealerLabel()).toBe("Dealer score 18");
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

  // Owner decision (#3720): a skip shows how the hand ended (the dealer's cards, the banner with its
  // chime, the chips and the count) and holds SKIP_HOLD_MS before the next action runs.
  it("a tap on the felt during the dealer's turn shows the result, holds 400 ms, then the next action runs", async () => {
    // The first round's dealer draws the 2♣; the next round is dealt the same cards.
    await mountOn(betting([...LOSE, card("2", "♣"), ...LOSE]));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(300);
    await tapFelt();
    expect(resultShown()).toBe(true);
    expect(shows("dealer-card-2")).toBe(true);
    expect(hudChips()).toBe(90);
    expect(named(at, "blackjack.lose")).toEqual([300]);
    // The result's dock shows; a Rebet now waits for the beat.
    await advance(100);
    await press(/^Rebet — deal again with 10 chips/);
    expect(named(at, "blackjack.cardDeal")).toEqual([]);
    expect(resultShown()).toBe(true);
    await advance(299);
    expect(named(at, "blackjack.cardDeal")).toEqual([]);
    await advance(1);
    expect(named(at, "blackjack.cardDeal")).toEqual([300 + SKIP_HOLD_MS]);
    await settle();
    expect(named(at, "blackjack.lose")).toEqual([300]);
    expect(named(at, "blackjack.chipCollect")).toEqual([]);
    expect(named(at, "blackjack.cardFlip")).toEqual([0]);
  });

  // #3720 round 2: the beat is to flash a result the player had not seen; once the banner shows,
  // a Rebet lands the chips (and the count) and deals at once.
  it("a Rebet once the banner shows lands the chips and deals at once; the chime once", async () => {
    await mountOn(betting([...LOSE, card("2", "♣"), ...LOSE]));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(1140);
    expect(resultShown()).toBe(true);
    expect(hudChips()).toBe(100);
    await advance(60);
    await press(/^Rebet — deal again with 10 chips/);
    expect(hudChips()).toBe(90);
    expect(screen.queryByTestId(/^felt-chip-/, HIDDEN_TOO)).toBeNull();
    expect(named(at, "blackjack.cardDeal").filter((t) => t > 600)).toEqual([1200]);
    await settle();
    expect(named(at, "blackjack.lose")).toEqual([1140]);
    expect(named(at, "blackjack.chipCollect")).toEqual([]);
  });

  it("Reduce Motion turned on with a split hand's card held back draws it", async () => {
    await mountOn(betting(SPLIT));
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    expect(shows("hand-1-card-1")).toBe(false);
    await setReduceMotion(true);
    expect(shows("hand-1-card-1")).toBe(true);
    expect(screen.getByTestId("hand-label-1").props.accessibilityLabel).toMatch(
      /Player score 13\b/
    );
  });

  it("leaving during the beat drops the action that waited for it", async () => {
    await mountOn(betting([...LOSE, card("2", "♣"), ...LOSE]));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(300);
    await tapFelt();
    await press(/^Rebet — deal again with 10 chips/);
    await fire("blur");
    await settle();
    expect(named(at, "blackjack.cardDeal")).toEqual([]);
    expect(screen.getByText("Rebet")).toBeTruthy();
  });
});

// #3720: as the split summary strip mounted, every hand jumped down (rows keep no result band while
// the player plays). The band is kept free from the dealer's turn on, so the strip moves nothing.
describe("the split summary strip moves no hand", () => {
  /** 8s to split twice: hands 8♠ 10♦ (18), 8♦ 9♣ (17), 8♥ 5♣ (13) against the dealer's 17. */
  const THREE = [
    card("8"),
    card("10", "♣"),
    card("8", "♥"),
    card("7", "♦"),
    card("8", "♦"),
    card("5", "♣"),
    card("10", "♦"),
    card("9", "♣"),
  ];
  /** Each drawn card's place, by testID. */
  const places = () =>
    Object.fromEntries(
      screen.queryAllByTestId(/^(dealer|hand-\d)-card-\d+$/).map((n) => {
        const st = StyleSheet.flatten(n.props.style) as { left: number; top: number };
        return [n.props.testID as string, [st.left, st.top]];
      })
    );

  it("a 3-hand split's cards are where they were when the strip shows", async () => {
    await mountOn(betting(THREE));
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    await press(/^Split —/);
    await settle();
    await press(/^Stand/);
    await settle();
    await press(/^Stand/);
    await settle();
    expect(screen.getAllByTestId(/^hand-label-\d$/)).toHaveLength(3);
    // The last Stand plays the dealer: 17, no draw; the result 300 ms after the flip ends.
    await press(/^Stand/);
    await advance(619);
    expect(resultShown()).toBe(false);
    const before = places();
    await advance(1);
    expect(resultShown()).toBe(true);
    // 3–4 hands: the strip shows the net alone; its label reads the summary (#3781).
    expect(screen.getByTestId("result-net").props.children).toBe("No change");
    expect(screen.getByLabelText("Push. Won: 1 · Lost: 1 · Push: 1. Payout: 0 chips")).toBeTruthy();
    expect(places()).toEqual(before);
    await settle();
    expect(places()).toEqual(before);
  });
});

describe("the dock during a result's motion (owner decision, #3720)", () => {
  /** A natural against the dealer's 16; and a natural against the dealer's natural (a push). */
  const NATURAL_PUSH = [card("A"), card("A", "♣"), card("K", "♥"), card("K", "♦")];

  it.each([
    ["a natural", NATURAL, "Blackjack! 3:2"],
    ["a natural against the dealer's natural", NATURAL_PUSH, "Push"],
  ])(
    "%s: greyed actions until the banner shows, then the result's dock",
    async (_n, cards, outcome) => {
      await mountOn(betting(cards));
      await dealTen();
      expect(disabled(/^Hit/)).toBe(true);
      expect(disabled(/^Stand/)).toBe(true);
      // A player's natural shows its result at the flip's end (#3621).
      await advance(1099);
      expect(resultShown()).toBe(false);
      expect(screen.queryByText("Rebet")).toBeNull();
      expect(disabled(/^Hit/)).toBe(true);
      await advance(1);
      expect(screen.getByTestId("result-outcome").props.children).toBe(outcome);
      expect(screen.getByText("Rebet")).toBeTruthy();
      expect(screen.queryByLabelText(/^Hit/)).toBeNull();
    }
  );
});

describe("Reduce Motion", () => {
  it("is instant, with each sound once, 100 ms apart (#3751)", async () => {
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
    // #3751: in order, 100 ms apart.
    expect(soundsSince(stand)).toEqual([["blackjack.cardFlip", 0]]);
    await settle();
    expect(soundsSince(stand)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.cardDeal", 100],
      ["blackjack.win", 200],
      ["blackjack.chipPayout", 300],
    ]);
    // The deal's four cards: one deal sound; the dealer's draws: one more, with the result.
    expect(named(at, "blackjack.cardDeal")).toEqual([0, 1100]);
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

// #3751 (owner decision): under Reduce Motion everything is instant, but an action's sounds play in
// their timeline order, 100 ms apart, the first at the instant.
describe("Reduce Motion spaces an action's sounds 100 ms apart (#3751)", () => {
  const GAP = REDUCE_MOTION_SOUND_GAP_MS;

  /** Mounts with Reduce Motion on, deals a ten and lets the deal's own sounds play out. */
  async function reduced(cards: Card[], chips = BEGINNER.startingChips) {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await mountOn(newGame(deck(...cards), { ...BEGINNER, startingChips: chips }));
    await dealTen();
    await advance(1000);
  }
  /** Presses `label` and returns the time it was pressed. */
  async function action(label: RegExp) {
    const at = Date.now();
    await press(label);
    return at;
  }

  it("is 100 ms", () => {
    expect(GAP).toBe(100);
  });

  it.each([
    [
      "a plain win",
      WIN,
      /^Stand/,
      [
        ["blackjack.cardFlip", 0],
        ["blackjack.cardDeal", 100],
        ["blackjack.win", 200],
        ["blackjack.chipPayout", 300],
      ],
    ],
    [
      "a loss",
      LOSE,
      /^Stand/,
      [
        ["blackjack.cardFlip", 0],
        ["blackjack.cardDeal", 100],
        ["blackjack.lose", 200],
        ["blackjack.chipCollect", 300],
      ],
    ],
    [
      "a push",
      PUSH,
      /^Stand/,
      [
        ["blackjack.cardFlip", 0],
        ["blackjack.cardDeal", 100],
        ["blackjack.push", 200],
        ["blackjack.chipNudge", 300],
      ],
    ],
    [
      "a bust",
      BUST,
      /^Hit/,
      [
        ["blackjack.cardDeal", 0],
        ["blackjack.cardFlip", 100],
        ["blackjack.bust", 200],
        ["blackjack.chipCollect", 300],
      ],
    ],
  ])(
    "a dealer turn, %s: its sounds in order, 100 ms apart, each once",
    async (_n, cards, btn, want) => {
      await reduced(cards);
      const at = await action(btn);
      // Instant, though the sounds are not: the round is settled at once.
      expect(resultShown()).toBe(true);
      expect(soundsSince(at)).toEqual([want[0]]);
      await advance(GAP - 1);
      expect(soundsSince(at)).toEqual([want[0]]);
      await advance(1);
      expect(soundsSince(at)).toEqual([want[0], want[1]]);
      await settle();
      expect(soundsSince(at)).toEqual(want);
    }
  );

  it("a natural: the deal, the sting, the flip, the payout, 100 ms apart", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    expect(resultShown()).toBe(true);
    expect(soundsSince(at)).toEqual([
      ["blackjack.chipBet", 0],
      ["blackjack.cardDeal", 0],
    ]);
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.chipBet", 0],
      ["blackjack.cardDeal", 0],
      ["blackjack.blackjack", 100],
      ["blackjack.cardFlip", 200],
      ["blackjack.chipPayout", 300],
    ]);
  });

  it("a split: its own sounds, then the dealer's turn and the chips, 100 ms apart", async () => {
    await reduced(SPLIT);
    const split = await action(/^Split —/);
    await settle();
    // The split's own sounds: the second bet's chip, then the deal.
    expect(soundsSince(split)).toEqual([
      ["blackjack.chipBet", 0],
      ["blackjack.cardDeal", GAP],
    ]);
    await action(/^Stand/);
    await settle();
    const last = await action(/^Stand/);
    await settle();
    expect(soundsSince(last)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.mixed", GAP],
      ["blackjack.chipPayout", 2 * GAP],
      ["blackjack.chipCollect", 3 * GAP],
    ]);
  });

  it("the round is settled at once: the out-of-chips card does not wait for the sounds", async () => {
    await reduced(LOSE, 10);
    const at = await action(/^Stand/);
    // The card (testID "blackjack-result") shows straight away, before the chime or the chips.
    expect(screen.getByTestId("blackjack-result")).toBeTruthy();
    expect(soundsSince(at)).toEqual([["blackjack.cardFlip", 0]]);
    expect(named(at, "blackjack.lose")).toEqual([]);
    await advance(GAP);
    expect(screen.getByTestId("blackjack-result")).toBeTruthy();
  });

  // The felt's tap overlay is on only while spaced sounds are due, so a tap can land them (#3751).
  describe("the felt's tap overlay", () => {
    const overlayOn = () =>
      screen.getByTestId("blackjack-table-area").props.accessibilityState?.disabled !== true;

    it("is on mid-sequence and off once the sequence ends", async () => {
      await reduced(WIN);
      expect(overlayOn()).toBe(false);
      await action(/^Stand/);
      expect(overlayOn()).toBe(true);
      await advance(GAP);
      expect(overlayOn()).toBe(true);
      await advance(2 * GAP);
      expect(overlayOn()).toBe(false);
    });

    it("is off after a tap lands the sounds", async () => {
      await reduced(WIN);
      await action(/^Stand/);
      await advance(50);
      expect(overlayOn()).toBe(true);
      await tapFelt();
      expect(overlayOn()).toBe(false);
    });

    it("is off after the next action lands them", async () => {
      await reduced([...WIN, card("2", "♣"), card("2", "♣"), ...WIN]);
      await action(/^Stand/);
      await advance(50);
      await press(/^Rebet — deal again with 10 chips/);
      await settle();
      expect(overlayOn()).toBe(false);
    });

    it("is off after leaving mid-sequence", async () => {
      await reduced(WIN);
      await action(/^Stand/);
      await advance(50);
      expect(overlayOn()).toBe(true);
      await fire("blur");
      expect(overlayOn()).toBe(false);
    });

    it("is off after New Game mid-sequence", async () => {
      await reduced(WIN);
      await action(/^Stand/);
      await advance(50);
      expect(overlayOn()).toBe(true);
      await press("More options");
      await act(async () => {
        await fireEvent.press(screen.getByText("New Game"));
      });
      await press("Start New");
      await settle();
      // New Game goes back to the table pick: no felt, so no overlay is left on.
      expect(screen.queryByTestId("blackjack-table-area")).toBeNull();
    });

    it("is never on for a one-sound action: it plays at the instant", async () => {
      // A plain Hit that does not bust: one deal sound.
      await reduced([card("5"), card("7", "♣"), card("4", "♥"), card("9", "♥"), card("2", "♦")]);
      const at = await action(/^Hit/);
      expect(soundsSince(at)).toEqual([["blackjack.cardDeal", 0]]);
      expect(overlayOn()).toBe(false);
    });
  });

  it("a tap mid-sequence drops the rest; the result chime still plays, once, at once", async () => {
    await reduced(WIN);
    const at = await action(/^Stand/);
    await advance(50);
    await tapFelt();
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.win", 50],
    ]);
  });

  it("a tap after the chime has played plays nothing more, and drops the chips", async () => {
    await reduced(WIN);
    const at = await action(/^Stand/);
    await advance(250);
    await tapFelt();
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.cardDeal", 100],
      ["blackjack.win", 200],
    ]);
  });

  it("a natural tapped before its sting: the sting plays once", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(10);
    await tapFelt();
    await settle();
    expect(named(at, "blackjack.blackjack")).toEqual([10]);
    expect(named(at, "blackjack.cardFlip")).toEqual([]);
    expect(named(at, "blackjack.chipPayout")).toEqual([]);
  });

  it("the next action mid-sequence drops the rest, plays the chime once, then its own sounds", async () => {
    await reduced([...WIN, card("2", "♣"), card("2", "♣"), ...WIN]);
    const at = await action(/^Stand/);
    await advance(50);
    await press(/^Rebet — deal again with 10 chips/);
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.win", 50],
      ["blackjack.cardDeal", 50],
    ]);
  });

  it("leaving mid-sequence drops every sound still due, the chime too", async () => {
    await reduced(WIN);
    const at = await action(/^Stand/);
    await advance(50);
    await fire("blur");
    await settle();
    await fire("focus");
    await settle();
    expect(soundsSince(at)).toEqual([["blackjack.cardFlip", 0]]);
  });

  it("an action while away plays nothing, spaced or not", async () => {
    await reduced(WIN);
    await fire("blur");
    const at = await action(/^Stand/);
    await settle();
    expect(soundsSince(at)).toEqual([]);
    expect(resultShown()).toBe(true);
  });

  it("unmounting mid-sequence plays nothing more", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const { view } = await mountOn(betting(WIN));
    await dealTen();
    await advance(1000);
    const at = await action(/^Stand/);
    await advance(50);
    await act(async () => view.unmount());
    await settle();
    expect(soundsSince(at)).toEqual([["blackjack.cardFlip", 0]]);
  });

  it("New Game mid-sequence plays nothing more", async () => {
    await reduced(WIN);
    const at = await action(/^Stand/);
    await advance(50);
    await press("More options");
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game"));
    });
    await press("Start New");
    await settle();
    expect(soundsSince(at)).toEqual([["blackjack.cardFlip", 0]]);
  });

  it("the result chime plays exactly once however the sequence ends", async () => {
    await reduced(WIN);
    const at = await action(/^Stand/);
    await settle();
    expect(named(at, "blackjack.win")).toHaveLength(1);
    await settle();
    expect(named(at, "blackjack.win")).toHaveLength(1);
  });

  it("restoring a settled round plays nothing, spaced or not", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const engine = betting(LOSE);
    await mountOn({
      ...engine,
      phase: "result",
      bet: 10,
      chips: 90,
      outcome: "lose",
      payout: -10,
      player_hand: [card("10"), card("5", "♥")],
      dealer_hand: [card("7", "♣"), card("9", "♥"), card("2", "♣")],
      events: [{ type: "cardDeal" }, { type: "loss" }],
    });
    await settle();
    expect(mockLog).toEqual([]);
  });

  it("turned on mid-motion plays only the result chime still due, at once: nothing to space", async () => {
    await mountOn(betting(WIN));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(50);
    await setReduceMotion(true);
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.win", 50],
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

// #3582 (owner decisions, audition 2026-11-13): the run's cues play with their toasts (the round
// settled: every hand's chips landed), not at a fixed offset from the chime; under Reduce Motion
// they join the spaced sounds after the chips. One per round, comeback over milestone. A round cut
// short (a tap, Rebet) drops its cue: the toast still shows, but the cue would stack on the chime
// played at once, or on the next deal.
describe("the run's cues (#3582)", () => {
  const GAP = REDUCE_MOTION_SOUND_GAP_MS;
  const milestoneToast = (chips: number) =>
    screen.queryByText(`Milestone reached: ${chips} chips!`);
  const comebackBanner = () => screen.queryByText("What a comeback!");
  /** WIN settles (its payout landed) this long after the Stand. */
  const WIN_SETTLED = 2160 + PAYOUT_MS;
  /**
   * 8s split twice against 17 (no draw): three hands of 18, each a win, 10 a hand. The chime at
   * 620, the chips at 1040, 1340 and 1640; the third payout lands at 2000.
   */
  const SPLIT3 = [
    card("8"),
    card("10", "♣"),
    card("8", "♥"),
    card("7", "♦"),
    card("8", "♦"),
    card("10", "♦"),
    card("10", "♥"),
    card("10"),
  ];
  const SPLIT3_SETTLED = 1640 + PAYOUT_MS;

  /** Splits, splits again and stands the first two hands: the third is left to play. */
  async function splitThree() {
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    await press(/^Split —/);
    await settle();
    await press(/^Stand/);
    await settle();
    await press(/^Stand/);
    await settle();
  }
  /** Stands and returns the time of the tap. */
  async function standNow() {
    const at = Date.now();
    await press(/^Stand/);
    return at;
  }
  /** At the run's low point: below 25% of the start once, now 70 of 100 (75 is the comeback). */
  const low = (order: Card[], milestones: number[] = []): EngineState => ({
    ...newGame(deck(...order), { ...BEGINNER, milestones }),
    chips: 70,
    hitLowChips: true,
  });
  const feltTapOn = () =>
    screen.getByTestId("blackjack-table-area").props.accessibilityState?.disabled !== true;

  it("a win that crosses a milestone: one tick, with the toast, after the chips", async () => {
    await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [105] }));
    await dealTen();
    await settle();
    const at = await standNow();
    await advance(WIN_SETTLED - 1);
    expect(milestoneToast(105)).toBeNull();
    expect(named(at, "blackjack.milestone")).toEqual([]);
    await advance(1);
    expect(milestoneToast(105)).toBeTruthy();
    expect(named(at, "blackjack.milestone")).toEqual([WIN_SETTLED]);
    await settle();
    // ~0.8 s after the chime, after the payout; once.
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.cardDeal", 600],
      ["blackjack.cardDeal", 1200],
      ["blackjack.win", 1740],
      ["blackjack.chipPayout", 2160],
      ["blackjack.milestone", WIN_SETTLED],
    ]);
  });

  it("a 3-hand split: the tick waits for the third hand's chips, with the toast", async () => {
    await mountOn(newGame(deck(...SPLIT3), { ...BEGINNER, milestones: [125] }));
    await splitThree();
    const at = await standNow();
    await advance(SPLIT3_SETTLED - 1);
    expect(milestoneToast(125)).toBeNull();
    expect(named(at, "blackjack.milestone")).toEqual([]);
    await advance(1);
    expect(milestoneToast(125)).toBeTruthy();
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.win", 620],
      ["blackjack.chipPayout", 1040],
      ["blackjack.chipPayout", 1340],
      ["blackjack.chipPayout", 1640],
      ["blackjack.milestone", SPLIT3_SETTLED],
    ]);
    // ~1.4 s after the chime: no fixed offset fits both this and a single hand's ~0.8 s.
    expect(SPLIT3_SETTLED - 620).toBeGreaterThan(1300);
  });

  it("a comeback: its cue with the banner, after the chips", async () => {
    await mountOn(low(WIN));
    await dealTen();
    await settle();
    const at = await standNow();
    await advance(WIN_SETTLED - 1);
    expect(comebackBanner()).toBeNull();
    await advance(1);
    expect(comebackBanner()).toBeTruthy();
    await settle();
    expect(named(at, "blackjack.comeback")).toEqual([WIN_SETTLED]);
    expect(named(at, "blackjack.milestone")).toEqual([]);
  });

  it("one cue a round: a comeback and a milestone together play the comeback only", async () => {
    await mountOn(low(WIN, [75]));
    await dealTen();
    await settle();
    const at = await standNow();
    await advance(WIN_SETTLED);
    // Both toasts show; one cue sounds.
    expect(comebackBanner()).toBeTruthy();
    expect(milestoneToast(75)).toBeTruthy();
    await settle();
    expect(named(at, "blackjack.comeback")).toEqual([WIN_SETTLED]);
    expect(named(at, "blackjack.milestone")).toEqual([]);
  });

  it("one cue a round: two milestones crossed together play one tick", async () => {
    await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [102, 105] }));
    await dealTen();
    await settle();
    const at = await standNow();
    await settle();
    expect(named(at, "blackjack.milestone")).toEqual([WIN_SETTLED]);
  });

  it("the round that wins the run plays no run cue (the victory screen replaces the table)", async () => {
    const { nav: n } = await mountOn(
      newGame(deck(...WIN), { ...BEGINNER, milestones: [105], runGoal: 105 })
    );
    await dealTen();
    await settle();
    const at = await standNow();
    await settle();
    expect(named(at, "blackjack.milestone")).toEqual([]);
    expect(named(at, "blackjack.comeback")).toEqual([]);
    expect(n.replace).toHaveBeenCalledWith("BlackjackVictory");
  });

  it("the next round's milestone ticks again (one a round, not one a run)", async () => {
    // The first dealer draws the two 2s; the next round is dealt the same cards.
    const order = [...WIN, card("2", "♣"), card("2", "♣"), ...WIN];
    await mountOn(newGame(deck(...order), { ...BEGINNER, milestones: [105, 115] }));
    await dealTen();
    await settle();
    const first = await standNow();
    await settle();
    expect(named(first, "blackjack.milestone")).toEqual([WIN_SETTLED]);
    await press(/^Rebet — deal again with 10 chips/);
    await settle();
    const second = await standNow();
    await settle();
    expect(named(second, "blackjack.milestone")).toEqual([WIN_SETTLED]);
  });

  it("restoring a settled round with a milestone and a comeback plays nothing", async () => {
    const engine = newGame(deck(...WIN), { ...BEGINNER, milestones: [105] });
    await mountOn({
      ...engine,
      phase: "result",
      bet: 10,
      chips: 110,
      outcome: "win",
      payout: 10,
      player_hand: [card("10"), card("9", "♥")],
      dealer_hand: [card("10", "♣"), card("4", "♦"), card("2", "♣"), card("2", "♣")],
      events: [{ type: "milestone", value: 105 }, { type: "comeback" }],
    });
    expect(milestoneToast(105)).toBeTruthy();
    await settle();
    expect(mockLog).toEqual([]);
  });

  describe("under Reduce Motion: after the chips, in the spaced queue", () => {
    beforeEach(() => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    });

    it("a win that crosses a milestone: flip, draw, chime, payout, then the tick", async () => {
      await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [105] }));
      await dealTen();
      await settle();
      const at = await standNow();
      // The round settles at once: the toast shows, its cue waits its turn.
      expect(milestoneToast(105)).toBeTruthy();
      expect(named(at, "blackjack.milestone")).toEqual([]);
      await settle();
      expect(soundsSince(at)).toEqual([
        ["blackjack.cardFlip", 0],
        ["blackjack.cardDeal", GAP],
        ["blackjack.win", 2 * GAP],
        ["blackjack.chipPayout", 3 * GAP],
        ["blackjack.milestone", 4 * GAP],
      ]);
    });

    it("the round that wins the run plays no run cue", async () => {
      await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [105], runGoal: 105 }));
      await dealTen();
      await settle();
      const at = await standNow();
      await settle();
      expect(named(at, "blackjack.milestone")).toEqual([]);
      expect(named(at, "blackjack.comeback")).toEqual([]);
      expect(named(at, "blackjack.win")).not.toEqual([]);
    });

    it("a 3-hand split: the chime, the payout, then the tick", async () => {
      await mountOn(newGame(deck(...SPLIT3), { ...BEGINNER, milestones: [125] }));
      await splitThree();
      const at = await standNow();
      await settle();
      expect(soundsSince(at)).toEqual([
        ["blackjack.cardFlip", 0],
        ["blackjack.win", GAP],
        ["blackjack.chipPayout", 2 * GAP],
        ["blackjack.milestone", 3 * GAP],
      ]);
    });

    it("a comeback with a milestone: the comeback only, after the chips", async () => {
      await mountOn(low(WIN, [75]));
      await dealTen();
      await settle();
      const at = await standNow();
      await settle();
      expect(soundsSince(at)).toEqual([
        ["blackjack.cardFlip", 0],
        ["blackjack.cardDeal", GAP],
        ["blackjack.win", 2 * GAP],
        ["blackjack.chipPayout", 3 * GAP],
        ["blackjack.comeback", 4 * GAP],
      ]);
    });

    it("the felt's tap stays on until the cue has played", async () => {
      await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [105] }));
      await dealTen();
      await settle();
      await standNow();
      await advance(3 * GAP + 50);
      expect(feltTapOn()).toBe(true);
      await advance(GAP);
      expect(feltTapOn()).toBe(false);
    });

    it("a tap before the cue's turn drops it; the toast stays", async () => {
      await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [105] }));
      await dealTen();
      await settle();
      const at = await standNow();
      await advance(3 * GAP + 50);
      await tapFelt();
      await settle();
      expect(named(at, "blackjack.milestone")).toEqual([]);
      expect(milestoneToast(105)).toBeTruthy();
    });

    it("a Rebet before the cue's turn drops it: it never lands on the next deal", async () => {
      await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [105] }));
      await dealTen();
      await settle();
      const at = await standNow();
      await advance(3 * GAP + 50);
      await press(/^Rebet — deal again with 10 chips/);
      await settle();
      expect(named(at, "blackjack.milestone")).toEqual([]);
    });
  });

  // The hold-or-drop rule (owner rule 3): drop. A tap before the result shows plays the chime at
  // once, and the next action runs SKIP_HOLD_MS later; a Rebet once the banner shows deals at once.
  // Either way the cue's slot (after the chips) is gone: played then, it would sit on the chime or
  // on the next deal's tosses.
  describe("a round cut short drops its cue", () => {
    it("a tap during the dealer's turn: the chime and the toast at once, no cue, now or later", async () => {
      await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [105] }));
      await dealTen();
      await settle();
      const at = await standNow();
      await advance(300);
      await tapFelt();
      expect(named(at, "blackjack.win")).toEqual([300]);
      expect(milestoneToast(105)).toBeTruthy();
      expect(named(at, "blackjack.milestone")).toEqual([]);
      // The beat, then the next deal: the cue is never played.
      await advance(100);
      await press(/^Rebet — deal again with 10 chips/);
      await advance(SKIP_HOLD_MS - 100);
      expect(named(at, "blackjack.cardDeal")).toEqual([300 + SKIP_HOLD_MS]);
      await settle();
      expect(named(at, "blackjack.milestone")).toEqual([]);
    });

    it("a Rebet once the banner shows: the chips land, the deal starts, no cue", async () => {
      await mountOn(newGame(deck(...WIN), { ...BEGINNER, milestones: [105] }));
      await dealTen();
      await settle();
      const at = await standNow();
      await advance(1800);
      expect(resultShown()).toBe(true);
      await press(/^Rebet — deal again with 10 chips/);
      expect(milestoneToast(105)).toBeTruthy();
      await settle();
      expect(named(at, "blackjack.milestone")).toEqual([]);
      expect(named(at, "blackjack.win")).toEqual([1740]);
    });

    it("leaving mid-motion drops it; coming back plays nothing", async () => {
      await mountOn(low(WIN));
      await dealTen();
      await settle();
      const at = await standNow();
      await advance(1800);
      await fire("blur");
      await settle();
      await fire("focus");
      await settle();
      expect(named(at, "blackjack.comeback")).toEqual([]);
    });

    it("New Game mid-motion drops it", async () => {
      await mountOn(low(WIN));
      await dealTen();
      await settle();
      const at = await standNow();
      await advance(1800);
      await press("More options");
      await act(async () => {
        await fireEvent.press(screen.getByText("New Game"));
      });
      await press("Start New");
      await settle();
      expect(named(at, "blackjack.comeback")).toEqual([]);
    });
  });
});

// #3770 (owner decision, B1): a split that won a hand and lost one plays the mixed chime, whatever
// the net; the banner keeps the net, and only a plain win flashes the felt.
describe("a mixed split (#3770)", () => {
  /** 8s split twice against 17: hands of 18, 13 and 18 (win, loss, win): net +10. */
  const MIXED3 = [
    card("8"),
    card("10", "♣"),
    card("8", "♥"),
    card("7", "♦"),
    card("8", "♦"),
    card("10", "♦"),
    card("10", "♥"),
    card("5"),
  ];

  it("a net win (win, loss, win): the mixed chime, the banner a net win", async () => {
    await mountOn(betting(MIXED3));
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    await press(/^Split —/);
    await settle();
    await press(/^Stand/);
    await settle();
    await press(/^Stand/);
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await settle();
    // 3 hands: the banner shows the net alone (#3781), named a win with the hands' summary.
    expect(screen.getByTestId("result-net").props.children).toBe("+10 chips");
    expect(screen.getByTestId("result-net").props.accessibilityLabel).toMatch(
      /^You Win!\. Won: 2 · Lost: 1\./
    );
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.mixed", 620],
      ["blackjack.chipPayout", 1040],
      ["blackjack.chipCollect", 1340],
      ["blackjack.chipPayout", 1640],
    ]);
  });

  it("a tap before the result: the mixed chime plays once, at once", async () => {
    await mountOn(betting(SPLIT));
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    await press(/^Stand/);
    await settle();
    const at = Date.now();
    await press(/^Stand/);
    await advance(200);
    await tapFelt();
    await settle();
    expect(named(at, "blackjack.mixed")).toEqual([200]);
    expect(named(at, "blackjack.push")).toEqual([]);
  });
});

// #3582 (owner decision, AI2): the all-in cue is a timeline cue at 0 on the deal's motion, under the
// card tosses, on the cue clock: leaving, New Game and a tap drop it like every other sound.
describe("the all-in (#3582)", () => {
  const GAP = REDUCE_MOTION_SOUND_GAP_MS;
  /** Ten chips left, all of them bet. */
  const allIn = () => newGame(deck(...LOSE), { ...BEGINNER, startingChips: 10 });

  it("plays at the deal, with the first card, once", async () => {
    await mountOn(allIn());
    const at = await dealTen();
    expect(screen.getByLabelText("All in wager")).toBeTruthy();
    await settle();
    expect(named(at, "blackjack.allIn")).toEqual([0]);
    expect(named(at, "blackjack.cardDeal")).toEqual([0, 180, 360, 540]);
  });

  it("is not played for a bet short of the whole stack", async () => {
    await mountOn(betting(LOSE));
    const at = await dealTen();
    await settle();
    expect(named(at, "blackjack.allIn")).toEqual([]);
  });

  it("a deal while away plays nothing", async () => {
    await mountOn(allIn());
    await press("Add 10 to bet");
    await fire("blur");
    const at = Date.now();
    await press(/deal cards with 10-chip bet/i);
    await settle();
    expect(named(at, "blackjack.allIn")).toEqual([]);
  });

  describe("under Reduce Motion: spaced after the deal's sound", () => {
    beforeEach(() => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    });

    it("the deal, then the all-in 100 ms later", async () => {
      await mountOn(allIn());
      const at = await dealTen();
      await settle();
      expect(soundsSince(at)).toEqual([
        ["blackjack.chipBet", 0],
        ["blackjack.cardDeal", 0],
        ["blackjack.allIn", GAP],
      ]);
    });

    it("leaving before it plays cancels it", async () => {
      await mountOn(allIn());
      const at = await dealTen();
      await advance(GAP / 2);
      await fire("blur");
      await settle();
      expect(named(at, "blackjack.allIn")).toEqual([]);
    });

    it("New Game before it plays cancels it", async () => {
      await mountOn(allIn());
      const at = await dealTen();
      await advance(GAP / 2);
      await press("More options");
      await act(async () => {
        await fireEvent.press(screen.getByText("New Game"));
      });
      await press("Start New");
      await settle();
      expect(named(at, "blackjack.allIn")).toEqual([]);
    });

    it("a tap before it plays drops it", async () => {
      await mountOn(allIn());
      const at = await dealTen();
      await advance(GAP / 2);
      await tapFelt();
      await settle();
      expect(named(at, "blackjack.allIn")).toEqual([]);
    });
  });
});
