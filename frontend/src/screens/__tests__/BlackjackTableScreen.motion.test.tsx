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
    // Net even: a push on the felt, with the push chime; no hand's own result shows yet.
    // #3720 review: the banner is the net from the start and never changes as the hands reveal.
    // The strip under the dealer sums the round up (#3581 spec: "1 win · 2 lost"), its label naming
    // the net push the chime plays.
    const banner = () => screen.getByTestId("result-outcome").props.children;
    const tags = () => screen.queryAllByTestId("hand-tag").map((n) => n.props.children);
    expect(banner()).toBe("Won: 1 · Lost: 1");
    expect(screen.getByTestId("result-outcome").props.accessibilityLabel).toMatch(/^Push\./);
    expect(screen.queryAllByTestId("hand-payout")).toHaveLength(0);
    expect(tags()).toEqual([]);
    await advance(419);
    expect(tags()).toEqual([]);
    await advance(1);
    // Hand 1's WIN tag pops with its chips, then hand 2's LOSE 300 ms later.
    expect(tags()).toEqual(["Win"]);
    expect(screen.getAllByTestId("hand-payout").map((n) => n.props.children)).toEqual([
      "+10 chips",
    ]);
    expect(banner()).toBe("Won: 1 · Lost: 1");
    await advance(299);
    expect(tags()).toEqual(["Win"]);
    await advance(1);
    expect(tags()).toEqual(["Win", "Lose"]);
    expect(screen.getAllByTestId("hand-payout").map((n) => n.props.children)).toEqual([
      "+10 chips",
      "-10 chips",
    ]);
    expect(banner()).toBe("Won: 1 · Lost: 1");
    await advance(COLLECT_MS);
    expect(banner()).toBe("Won: 1 · Lost: 1");
    await settle();
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardFlip", 0],
      ["blackjack.push", 620],
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
    expect(screen.getByTestId("result-outcome").props.children).toBe("Won: 1 · Lost: 1 · Push: 1");
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
