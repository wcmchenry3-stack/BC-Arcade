/**
 * The one table rendered at real phone sizes (#3580, review round 2 V1/V2).
 *
 * The screen is rendered with the window at each size, its felt is laid out
 * at the size the real chrome leaves it (`estimateFeltSize`: the header, HUD
 * strip, dock, tab bar and GameShell's padding; at 320×568 and 375×667 this is
 * the felt measured in the web build), and every card, label and the result
 * the screen actually draws must sit inside the felt without overlapping.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame } from "../../game/blackjack/engine";
import type { Card, EngineState } from "../../game/blackjack/engine";
import { estimateFeltSize, FELT_BORDER, MIN_CARD_WIDTH } from "../../game/blackjack/layout";
import { APP_HEADER_HEIGHT } from "../../components/shared/AppHeader";

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

// The window the screen sees (react-native's useWindowDimensions reads this module).
const mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const c = (rank: string, suit = "♠"): Card => ({ rank, suit });
const BEGINNER = { startingChips: 100, runGoal: 250, betMin: 5, betMax: 25 };

const PHONES = [
  { name: "320×568", width: 320, height: 568, insetTop: 0, insetBottom: 0 },
  { name: "375×667", width: 375, height: 667, insetTop: 0, insetBottom: 0 },
  { name: "390×844", width: 390, height: 844, insetTop: 47, insetBottom: 34 },
];

function base(): EngineState {
  return {
    ...newGame(
      Array.from({ length: 60 }, () => c("2", "♣")),
      BEGINNER
    ),
    chips: 120,
  };
}

const SCENES: [string, () => EngineState][] = [
  [
    "a 6-card single hand at the result",
    () => ({
      ...base(),
      phase: "result",
      bet: 10,
      outcome: "win",
      payout: 10,
      player_hand: [c("2"), c("3", "♥"), c("A"), c("2", "♦"), c("4"), c("5", "♥")],
      dealer_hand: [c("2", "♣"), c("3", "♦"), c("A", "♣"), c("2", "♥"), c("4", "♦"), c("K")],
    }),
  ],
  [
    "a 2-hand split while playing",
    () => ({
      ...base(),
      phase: "player",
      bet: 10,
      player_hand: [c("8"), c("8", "♥")],
      dealer_hand: [c("6", "♦"), c("10", "♣")],
      split_count: 1,
      player_hands: [
        [c("8"), c("3"), c("Q", "♦")],
        [c("8", "♥"), c("2", "♣")],
      ],
      hand_bets: [10, 10],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      split_from_aces: [false, false],
      active_hand_index: 1,
    }),
  ],
  [
    "a 4-hand split at the result",
    () => {
      const five = (r: string) => [c(r), c("2", "♥"), c("2", "♦"), c("3", "♣"), c("4")];
      return {
        ...base(),
        phase: "result",
        bet: 5,
        chips: 140,
        player_hand: [c("8"), c("8", "♥")],
        dealer_hand: [c("6", "♦"), c("10", "♣"), c("8", "♥")],
        split_count: 3,
        player_hands: [five("8"), five("8"), five("8"), five("8")],
        hand_bets: [5, 5, 5, 5],
        hand_outcomes: ["win", "win", "win", "win"],
        hand_payouts: [5, 5, 5, 5],
        split_from_aces: [false, false, false, false],
        active_hand_index: 4,
      };
    },
  ],
];

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxOf(id: string): Box {
  const s = StyleSheet.flatten(screen.getByTestId(id).props.style) as {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  return { id, x: s.left, y: s.top, width: s.width, height: s.height };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(PHONES)("the table at $name", (phone) => {
  it.each(SCENES)("%s: nothing is clipped or overlapped", async (_name, scene) => {
    mockWindow.width = phone.width;
    mockWindow.height = phone.height;
    (loadGame as jest.Mock).mockResolvedValue(scene());
    await render(
      <ThemeProvider>
        <BlackjackGameProvider>
          <BlackjackTableScreen
            navigation={
              {
                navigate: jest.fn(),
                replace: jest.fn(),
                popToTop: jest.fn(),
                goBack: jest.fn(),
              } as never
            }
          />
        </BlackjackGameProvider>
      </ThemeProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    const inner = estimateFeltSize({
      screenWidth: phone.width,
      screenHeight: phone.height,
      insetTop: phone.insetTop,
      insetBottom: phone.insetBottom,
      headerHeight: APP_HEADER_HEIGHT,
    });
    await act(async () => {
      fireEvent(screen.getByTestId("blackjack-felt"), "layout", {
        nativeEvent: {
          layout: {
            x: 0,
            y: 0,
            width: inner.width + 2 * FELT_BORDER,
            height: inner.height + 2 * FELT_BORDER,
          },
        },
      });
    });

    // Every card the screen draws, by hand.
    const ids = screen
      .getAllByTestId(/^(dealer|hand-\d)-card-\d+$/)
      .map((n) => n.props.testID as string);
    const cards = ids.map(boxOf);
    const handOf = (id: string) => id.replace(/-card-\d+$/, "");
    const labels = screen
      .queryAllByTestId(/^hand-label-\d$/)
      .map((n) => boxOf(n.props.testID as string));
    const result = screen.queryByTestId("blackjack-felt-result")
      ? boxOf("blackjack-felt-result")
      : null;

    for (const b of [...cards, ...labels, ...(result ? [result] : [])]) {
      expect({ id: b.id, x: b.x, y: b.y }).toEqual({
        id: b.id,
        x: expect.any(Number),
        y: expect.any(Number),
      });
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(inner.width + 0.001);
      expect(b.y + b.height).toBeLessThanOrEqual(inner.height + 0.001);
    }
    // Sized for this phone (the window size reached the screen), never below the minimum.
    for (const card of cards) {
      expect(card.width).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
      expect(card.width).toBeLessThanOrEqual(Math.min(78, phone.width * 0.2));
    }
    // Four hands are never side by side in portrait: rows, or a 2×2 grid.
    if (labels.length === 4) {
      expect(labels[2]!.y).toBeGreaterThan(labels[0]!.y);
      // Rows and the grid keep each label to one line: the payout as a signed
      // number (the full text stays in the label's accessibility name), and a
      // one-line result banner with no detail line under it.
      expect(screen.getAllByTestId("hand-payout").map((n) => n.props.children)).toEqual([
        "+5",
        "+5",
        "+5",
        "+5",
      ]);
      expect(screen.getByLabelText(/^Hand 1, .*\+5 chips$/)).toBeTruthy();
      expect(screen.queryByTestId("result-detail")).toBeNull();
    }
    // Cards of different hands never overlap; the result and labels cover no card.
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        if (handOf(cards[i]!.id) !== handOf(cards[j]!.id)) {
          expect(overlaps(cards[i]!, cards[j]!)).toBe(false);
        }
      }
      if (result) expect(overlaps(result, cards[i]!)).toBe(false);
      for (const l of labels) expect(overlaps(l, cards[i]!)).toBe(false);
    }
    for (let i = 0; i < labels.length; i++) {
      if (result) expect(overlaps(result, labels[i]!)).toBe(false);
      for (let j = i + 1; j < labels.length; j++) {
        expect(overlaps(labels[i]!, labels[j]!)).toBe(false);
      }
    }
  });
});

// #3720: each hand's stake is a chip (decorative) beside its amount, in place of the "●" text.
// The widest row labels are a 4-hand split's, at 375×667.
describe("the stake at 375×667 with 4 split hands in play", () => {
  it("is a chip beside the amount, which shrinks to fit; the labels stay on the felt, apart", async () => {
    mockWindow.width = 375;
    mockWindow.height = 667;
    const two = (r: string) => [c(r), c("9", "♥")];
    (loadGame as jest.Mock).mockResolvedValue({
      ...base(),
      phase: "player",
      bet: 25,
      chips: 140,
      player_hand: [c("8"), c("8", "♥")],
      dealer_hand: [c("6", "♦"), c("10", "♣")],
      split_count: 3,
      player_hands: [two("8"), two("8"), two("8"), two("8")],
      hand_bets: [25, 25, 25, 25],
      hand_outcomes: [null, null, null, null],
      hand_payouts: [0, 0, 0, 0],
      split_from_aces: [false, false, false, false],
      active_hand_index: 2,
    } as EngineState);
    await render(
      <ThemeProvider>
        <BlackjackGameProvider>
          <BlackjackTableScreen
            navigation={
              {
                navigate: jest.fn(),
                replace: jest.fn(),
                popToTop: jest.fn(),
                goBack: jest.fn(),
              } as never
            }
          />
        </BlackjackGameProvider>
      </ThemeProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryAllByText(/●/)).toHaveLength(0);
    const bets = screen.getAllByTestId("hand-bet");
    expect(bets.map((b) => b.props.children)).toEqual([25, 25, 25, 25]);
    for (const b of bets) {
      expect(b.props.numberOfLines).toBe(1);
      expect(b.props.adjustsFontSizeToFit).toBe(true);
    }
    // The chip is decorative: hidden from screen readers; the label still says the bet.
    const chips = screen.getAllByTestId("hand-stake-chip", { includeHiddenElements: true });
    expect(chips).toHaveLength(4);
    for (const chip of chips) expect(chip.props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByLabelText(/^Hand 1, Player score 17, Bet 25 chips$/)).toBeTruthy();
    // The labels stay on the felt and apart (their rects come from the geometry, unchanged).
    const labels = screen.getAllByTestId(/^hand-label-\d$/).map((n) => boxOf(n.props.testID));
    const inner = estimateFeltSize({
      screenWidth: 375,
      screenHeight: 667,
      insetTop: 0,
      insetBottom: 0,
      headerHeight: APP_HEADER_HEIGHT,
    });
    for (const l of labels) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x + l.width).toBeLessThanOrEqual(inner.width + 0.001);
    }
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(overlaps(labels[i]!, labels[j]!)).toBe(false);
      }
    }
  });
});
