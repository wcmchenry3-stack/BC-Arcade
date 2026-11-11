/**
 * #3581: a seeded fuzz of Blackjack's motion on the screen, like Solitaire's and FreeCell's. Each
 * seed plays rounds with random actions at random times, many of them mid-motion (input stays
 * live: a tap lands the motion and goes on). Once the last motion settles, every card the engine
 * holds is drawn at its place in the table's geometry, nothing is left moving, the chip count is
 * the engine's, and no sound played more than it may: one result chime per round settled (a
 * split hand's own bust aside), and no more deal sounds than cards dealt.
 */
import React, { useEffect } from "react";
import { AccessibilityInfo, Dimensions, StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider, useBlackjackGame } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame, toViewState, type Card, type EngineState } from "../../game/blackjack/engine";
import { computeTableGeometry, estimateFeltSize, showsResult } from "../../game/blackjack/layout";
import { APP_HEADER_HEIGHT } from "../../components/shared/AppHeader";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { createSeededRng } from "../../game/_shared/seededRng";

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

const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));

const spied: { ctx?: ReturnType<typeof useBlackjackGame> } = {};
function Spy() {
  const value = useBlackjackGame();
  useEffect(() => {
    spied.ctx = value;
  });
  return null;
}

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
/** A seeded shoe, pairs of 8s made likely so splits come up. */
function shoe(rng: () => number): Card[] {
  return Array.from({ length: 400 }, () => ({
    rank: rng() < 0.25 ? "8" : RANKS[Math.floor(rng() * RANKS.length)]!,
    suit: ["♠", "♥", "♦", "♣"][Math.floor(rng() * 4)]!,
  }));
}

const press = (label: string | RegExp) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const live = (label: RegExp) => {
  const node = screen.queryByLabelText(label);
  return node !== null && node.props.accessibilityState?.disabled !== true;
};

const count = (re: RegExp) => mockPlayed.filter((n) => re.test(n)).length;

/** Every card the engine holds is drawn, at its place in the geometry (the felt's estimate). */
function expectTableMatches(engine: EngineState) {
  const v = toViewState(engine);
  const window = Dimensions.get("window");
  const felt = estimateFeltSize({
    screenWidth: window.width,
    screenHeight: window.height,
    insetTop: 0,
    insetBottom: 0,
    headerHeight: APP_HEADER_HEIGHT,
  });
  const betting = v.phase === "betting";
  const geometry = computeTableGeometry({
    feltWidth: felt.width,
    feltHeight: felt.height,
    screenWidth: window.width,
    screenHeight: window.height,
    dealerCards: betting ? 0 : v.dealer_hand.cards.length,
    handCards: betting ? [] : v.player_hands.map((h) => h.cards.length),
    activeHandIndex: v.phase === "player" ? v.active_hand_index : null,
    showResult: showsResult(v.phase),
  });
  const placeOf = (testID: string) => {
    const s = StyleSheet.flatten(screen.getByTestId(testID).props.style) as {
      left: number;
      top: number;
    };
    return [s.left, s.top];
  };
  const drawn = screen.queryAllByTestId(/^(dealer|hand-\d)-card-\d+$/).length;
  if (betting) {
    expect(drawn).toBe(0);
    return;
  }
  const dealerShown = geometry.dealer.collapsed ? 0 : v.dealer_hand.cards.length;
  expect(drawn).toBe(dealerShown + v.player_hands.reduce((a, h) => a + h.cards.length, 0));
  for (let i = 0; i < dealerShown; i++) {
    const f = geometry.dealer.fan;
    expect(placeOf(`dealer-card-${i}`)).toEqual([f.x + i * f.step, f.y]);
  }
  v.player_hands.forEach((h, k) =>
    h.cards.forEach((_, i) => {
      const f = geometry.hands[k]!.fan;
      expect(placeOf(`hand-${k}-card-${i}`)).toEqual([f.x + i * f.step, f.y]);
    })
  );
  // The result shows exactly when the engine settled the round; no chip is left moving.
  expect(screen.queryByTestId("blackjack-felt-result") !== null).toBe(showsResult(v.phase));
  expect(screen.queryByTestId(/^felt-chip-/, { includeHiddenElements: true })).toBeNull();
  // The hole card is face down exactly while the player plays.
  expect(screen.queryByTestId("dealer-card-0-outline") !== null).toBe(v.phase === "player");
}

beforeEach(() => {
  mockPlayed.length = 0;
  resetReduceMotionForTests();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.useFakeTimers({ now: 1_700_000_000_000 });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("fuzz: random play with taps mid-motion", () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("seed %i", async (seed) => {
    const rng = createSeededRng(seed * 104729);
    const start = newGame(shoe(rng), {
      startingChips: 5000,
      runGoal: 100000,
      betMin: 5,
      betMax: 25,
    });
    (loadGame as jest.Mock).mockResolvedValue(start);
    await render(
      <ThemeProvider>
        <BlackjackGameProvider>
          <BlackjackTableScreen
            navigation={
              {
                navigate: jest.fn(),
                goBack: jest.fn(),
                replace: jest.fn(),
                popToTop: jest.fn(),
              } as never
            }
          />
          <Spy />
        </BlackjackGameProvider>
      </ThemeProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    let settledRounds = 0;
    let dealt = 0;
    let splitHands = 0;
    for (let step = 0; step < 40; step++) {
      const before = spied.ctx!.engine!;
      if (live(/^Rebet —/)) {
        await press(/^Rebet —/);
      } else if (live(/^Hit/)) {
        const options = [/^Hit/, /^Stand/];
        if (live(/^Double down —/)) options.push(/^Double down —/);
        if (live(/^Split —/)) options.push(/^Split —/, /^Split —/);
        await press(options[Math.floor(rng() * options.length)]!);
      } else if (live(/deal cards with 10-chip bet/i)) {
        await press(/deal cards with 10-chip bet/i);
      } else {
        await press("Add 10 to bet");
      }
      const after = spied.ctx!.engine!;
      const cardsOf = (s: EngineState) =>
        s.dealer_hand.length +
        (s.split_count > 0
          ? s.player_hands.reduce((a, h) => a + h.length, 0)
          : s.player_hand.length);
      if (after !== before) {
        const newRound = before.phase !== "player";
        dealt += newRound ? cardsOf(after) : cardsOf(after) - cardsOf(before);
        if (showsResult(after.phase) && !showsResult(before.phase)) settledRounds++;
        splitHands = Math.max(splitHands, after.player_hands.length);
      }
      // Often mid-motion (0–700 ms), sometimes after it has settled.
      await advance(rng() < 0.2 ? 0 : Math.floor(rng() * (rng() < 0.7 ? 700 : 3000)));
    }
    await advance(6000);
    expectTableMatches(spied.ctx!.engine!);
    // No sound played more than it may.
    const chimes = count(/^blackjack\.(win|lose|push|blackjack)$/);
    const busts = count(/^blackjack\.bust$/);
    expect(chimes + busts).toBeGreaterThanOrEqual(settledRounds);
    expect(chimes).toBeLessThanOrEqual(settledRounds);
    expect(count(/^blackjack\.cardDeal\d?$/)).toBeLessThanOrEqual(dealt);
    expect(count(/^blackjack\.cardFlip\d?$/)).toBeLessThanOrEqual(settledRounds);
    expect(count(/^blackjack\.chip(Payout|Collect|Nudge)$/)).toBeLessThanOrEqual(
      settledRounds * Math.max(1, splitHands)
    );
  });
});
