/**
 * #3764: a hand that reaches 21 stands on its own, on the screen. A hit to 21 plays as one
 * timeline with no tap in between (the card lands, then the dealer's turn: the hole card's flip,
 * any draws, the result and the chips), the same sounds as a hit followed by a Stand. On a split,
 * the hand on 21 is done and play moves to the next hand. Hit and Stand are never offered on a
 * hand showing 21, at any moment of the motion. Under Reduce Motion it is all instant and the
 * sounds play in order, each once, 100 ms apart (#3751).
 */
import React from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { createSeededRng, newGame, setRng } from "../../game/blackjack/engine";
import type { Card, EngineState } from "../../game/blackjack/engine";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { REDUCE_MOTION_SOUND_GAP_MS } from "../../components/blackjack/useBlackjackMotion";
import {
  CHIP_DELAY_MS,
  DEAL_FLIGHT_MS,
  DEALER_PACE_MS,
  RESULT_DELAY_MS,
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

const card = (rank: string, suit = "♠"): Card => ({ rank, suit });
/** A deck dealt in this order (the engine deals from the end), then 2♣s. */
const deck = (...order: Card[]): Card[] => [
  ...Array.from({ length: 80 }, () => card("2", "♣")),
  ...[...order].reverse(),
];

/** The Beginner table: 5–25, 100 chips, the goal 250. */
const BEGINNER = { startingChips: 100, runGoal: 250, betMin: 5, betMax: 25 };

/** 7 4 against the dealer's 16 (10 in the hole, 6 up); the Hit is a 10 (21), the dealer draws a 2. */
const HIT_TO_21 = [
  card("7"),
  card("10", "♣"),
  card("4", "♥"),
  card("6", "♦"),
  card("10", "♦"),
  card("2", "♥"),
];
/**
 * A pair of 8s against the dealer's 15 (6 in the hole, 9 up). The split deals hand 1 a 3 and hand
 * 2 a 2; hand 1 hits a K (21), hand 2 hits an A (21); the dealer draws a 5 (20).
 */
const SPLIT_TO_21 = [
  card("8"),
  card("6", "♣"),
  card("8", "♥"),
  card("9", "♦"),
  card("3", "♦"),
  card("2", "♣"),
  card("K", "♣"),
  card("A", "♥"),
  card("5", "♦"),
];

async function mountOn(state: EngineState) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
    isFocused: () => true,
    addListener: () => () => undefined,
  } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"];
  await render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackTableScreen navigation={navigation} />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const betting = (order: Card[]) => newGame(deck(...order), BEGINNER);
const press = (label: string | RegExp) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
async function dealTen() {
  await press("Add 10 to bet");
  await press(/deal cards with 10-chip bet/i);
}
const settle = () => advance(5000);
const soundsSince = (since: number) =>
  mockLog
    .filter((e) => e.at >= since)
    .map((e) => [e.name.replace(/[23]$/, ""), e.at - since] as const);
const resultShown = () => screen.queryByTestId("blackjack-felt-result") !== null;

/** Hit is on the dock and can be pressed. */
function canHit(): boolean {
  const btn = screen.queryByLabelText(/^Hit/);
  return btn !== null && btn.props.accessibilityState?.disabled !== true;
}
function canStand(): boolean {
  const btn = screen.queryByLabelText(/^Stand/);
  return btn !== null && btn.props.accessibilityState?.disabled !== true;
}

/** The hand the felt outlines as the one to play: a split's outlined box, else the one hand. */
function handToPlay(): number {
  const boxes = screen.queryAllByTestId(/^hand-box-\d+$/);
  if (boxes.length === 0) return 0;
  return boxes.findIndex((b) => {
    const inner = b.children[0];
    if (inner === undefined || typeof inner === "string") return false;
    return StyleSheet.flatten(inner.props.style)?.borderColor !== "transparent";
  });
}
const scoreOf = (i: number) =>
  Number(
    /Player score (\d+)/.exec(
      screen.getByTestId(`hand-label-${i}`).props.accessibilityLabel as string
    )![1]
  );

/**
 * Steps the clock `ms` in 10 ms ticks, checking at each that Hit and Stand are never offered on a
 * hand showing 21.
 */
async function stepChecking(ms: number) {
  for (let t = 0; t < ms; t += 10) {
    await advance(10);
    if (canHit() || canStand()) expect(scoreOf(handToPlay())).not.toBe(21);
  }
}

let reduceMotion = false;

beforeEach(() => {
  setRng(createSeededRng(3764));
  jest.clearAllMocks();
  resetReduceMotionForTests();
  reduceMotion = false;
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(() => Promise.resolve(reduceMotion));
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((() => ({ remove: () => undefined })) as never);
  mockLog.length = 0;
  jest.useFakeTimers({ now: T0 });
});

afterEach(() => {
  setRng(Math.random);
  jest.useRealTimers();
  jest.restoreAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("a single hand hit to 21", () => {
  it("plays straight through: the card lands, the flip, the dealer's draw, the result, the chips", async () => {
    await mountOn(betting(HIT_TO_21));
    await dealTen();
    await settle();
    expect(canHit()).toBe(true);
    const at = Date.now();
    await press(/^Hit/);
    // The card is dealt; Hit and Stand are greyed while the motion plays.
    expect(canHit()).toBe(false);
    expect(canStand()).toBe(false);
    expect(resultShown()).toBe(false);
    await stepChecking(5000);
    // No tap: the round settled on its own.
    expect(resultShown()).toBe(true);
    expect(screen.getByTestId("result-outcome").props.children).toBe("You Win!");
    expect(scoreOf(0)).toBe(21);
    const flip = DEAL_FLIGHT_MS;
    const result = flip + DEALER_PACE_MS + DEAL_FLIGHT_MS + RESULT_DELAY_MS;
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardDeal", 0],
      ["blackjack.cardFlip", flip],
      ["blackjack.cardDeal", flip + DEALER_PACE_MS],
      ["blackjack.win", result],
      ["blackjack.chipPayout", result + CHIP_DELAY_MS],
    ]);
    // The result's dock replaces the actions: no Hit or Stand on the 21.
    expect(screen.queryByLabelText(/^Hit/)).toBeNull();
    expect(screen.queryByLabelText(/^Stand/)).toBeNull();
  });

  it("under Reduce Motion: instant, its sounds in order, each once, 100 ms apart", async () => {
    reduceMotion = true;
    await mountOn(betting(HIT_TO_21));
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Hit/);
    expect(resultShown()).toBe(true);
    expect(screen.queryByLabelText(/^Hit/)).toBeNull();
    await settle();
    // Each sound once, in timeline order (#3751): the hit's deal stands for the dealer's draw too.
    const gap = REDUCE_MOTION_SOUND_GAP_MS;
    expect(soundsSince(at)).toEqual([
      ["blackjack.cardDeal", 0],
      ["blackjack.cardFlip", gap],
      ["blackjack.win", 2 * gap],
      ["blackjack.chipPayout", 3 * gap],
    ]);
  });
});

describe("split hands hit to 21", () => {
  it("the hand on 21 is done and play moves on; the last one plays the dealer, no tap between", async () => {
    await mountOn(betting(SPLIT_TO_21));
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    expect(handToPlay()).toBe(0);
    await press(/^Hit/);
    await stepChecking(2000);
    // Hand 1 is on 21 and done: hand 2 (8 2) is the one to play.
    expect(scoreOf(0)).toBe(21);
    expect(handToPlay()).toBe(1);
    expect(scoreOf(1)).toBe(10);
    expect(canHit()).toBe(true);
    const at = Date.now();
    await press(/^Hit/);
    await stepChecking(5000);
    expect(resultShown()).toBe(true);
    expect(scoreOf(1)).toBe(21);
    const sounds = soundsSince(at).map(([n]) => n);
    expect(sounds.slice(0, 3)).toEqual([
      "blackjack.cardDeal",
      "blackjack.cardFlip",
      "blackjack.cardDeal",
    ]);
    expect(sounds).toContain("blackjack.win");
  });
});

// #3764 review (the owner's recording, case 5, and its round-ending twin): a split hand dealt 21
// that play passes over. The dock is sampled every 10 ms: Hit and Stand are never offered while
// the outlined hand shows 21, and the outline leaves the 21 as its card lands.
describe("split hands dealt 21", () => {
  /** One sample of the felt and the dock. */
  interface Sample {
    t: number;
    active: number;
    scores: number[];
    hand2Cards: number;
    canAct: boolean;
  }
  /** Samples every 10 ms for `ms` from `since`, checking the dock rule at each. */
  async function sample(since: number, ms: number): Promise<Sample[]> {
    const out: Sample[] = [];
    for (let t = 0; t < ms; t += 10) {
      await advance(10);
      const boxes = screen.queryAllByTestId(/^hand-box-\d+$/).length;
      const active = handToPlay();
      const scores = Array.from({ length: boxes }, (_, i) => scoreOf(i));
      const canAct = canHit() || canStand();
      if (canAct) expect(scores[active]).not.toBe(21);
      const hand2Cards = screen.queryAllByTestId(/^hand-1-card-\d+$/).length;
      out.push({ t: Date.now() - since, active, scores, hand2Cards, canAct });
    }
    return out;
  }
  const firstAt = (log: Sample[], ok: (s: Sample) => boolean) => log.find(ok)?.t ?? null;

  it("split 10s, hand 1 dealt A (21): the outline moves to hand 2 as the Ace lands, then its 7 is dealt", async () => {
    // 10♠ 10♦ against 9♣ (hole) 7♥; the split deals A♣ to hand 1 and 7♠ to hand 2.
    await mountOn(
      betting([
        card("10"),
        card("9", "♣"),
        card("10", "♦"),
        card("7", "♥"),
        card("A", "♣"),
        card("7"),
      ])
    );
    await dealTen();
    await settle();
    const at = Date.now();
    await press(/^Split —/);
    const log = await sample(at, 2500);
    const aceLands = firstAt(log, (x) => x.scores[0] === 21);
    const outlineMoves = firstAt(log, (x) => x.active === 1);
    const sevenShows = firstAt(log, (x) => x.hand2Cards === 2);
    const sevenLands = firstAt(log, (x) => x.scores[1] === 17);
    expect([aceLands, outlineMoves, sevenShows, sevenLands]).toEqual([960, 960, 1310, 1550]);
    // Hand 1 is never outlined showing 21.
    log.forEach((x) => {
      if (x.active === 0) expect(x.scores[0]).not.toBe(21);
    });
    // Hit and Stand stay live (a tap lands the motion and acts on the hand to play, #3575), and
    // the hand to play is the one outlined from the Ace's landing on.
    expect(log.every((x) => x.canAct)).toBe(true);
    expect(soundsSince(at)).toEqual([
      ["blackjack.chipBet", 300],
      ["blackjack.cardDeal", 720],
      ["blackjack.cardDeal", 1310],
    ]);
  });

  it("split 10s, hand 2 dealt A and held: a Stand on hand 1 outlines hand 2 and deals its Ace before the flip", async () => {
    // 10 10 against 6♣ (hole) 9♦; the split deals 5♦ to hand 1 and A♣ to hand 2; the dealer draws a 2.
    await mountOn(
      betting([
        card("10"),
        card("6", "♣"),
        card("10", "♥"),
        card("9", "♦"),
        card("5", "♦"),
        card("A", "♣"),
        card("2"),
      ])
    );
    await dealTen();
    await settle();
    await press(/^Split —/);
    await settle();
    expect(handToPlay()).toBe(0);
    const at = Date.now();
    await press(/^Stand/);
    const log = await sample(at, 3000);
    // Hand 2 is outlined at once; its Ace is dealt 350 ms later, lands at 590; then the flip.
    expect(firstAt(log, (x) => x.active === 1)).toBe(10);
    expect(firstAt(log, (x) => x.hand2Cards === 2)).toBe(350);
    expect(firstAt(log, (x) => x.scores[1] === 21)).toBe(590);
    const sounds = soundsSince(at);
    expect(sounds.slice(0, 3)).toEqual([
      ["blackjack.cardDeal", 350],
      ["blackjack.cardFlip", 590],
      ["blackjack.cardDeal", 1190],
    ]);
    // The round is over: Hit and Stand are greyed throughout, and the result shows.
    expect(log.some((x) => x.canAct)).toBe(false);
    expect(resultShown()).toBe(true);
  });
});
