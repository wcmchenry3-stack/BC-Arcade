/**
 * BlackjackTableScreen's off-table report (#3653): the dealer's and the player's
 * fans against the measured felt. A felt too narrow for an 11-card hand even at the
 * narrowest card is reported; a phone's felt is not, nor is the first-frame estimate.
 */
import React from "react";
import * as Sentry from "@sentry/react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame } from "../../game/blackjack/engine";
import type { Card, EngineState } from "../../game/blackjack/engine";
import {
  computeTableGeometry,
  estimateFeltSize,
  FELT_BORDER,
  MIN_CARD_WIDTH,
} from "../../game/blackjack/layout";
import { APP_HEADER_HEIGHT } from "../../components/shared/AppHeader";
import { resetSentryThrottle } from "../../game/_shared/sentryThrottle";

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

const mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const capture = Sentry.captureMessage as jest.Mock;
const offTableCalls = () => capture.mock.calls.filter((call) => call[0] === "cards.offTable");

const c = (rank: string, suit = "♠"): Card => ({ rank, suit });
const BEGINNER = { startingChips: 100, runGoal: 250, betMin: 5, betMax: 25 };

/** The player's turn with an 11-card hand (2s and aces: 17). */
function elevenCards(): EngineState {
  return {
    ...newGame(
      Array.from({ length: 60 }, () => c("2", "♣")),
      BEGINNER
    ),
    chips: 120,
    phase: "player",
    bet: 10,
    player_hand: Array.from({ length: 11 }, (_, i) => c(i % 2 ? "A" : "2", "♥")),
    dealer_hand: [c("6", "♦"), c("10", "♣")],
  };
}

async function mount(state: EngineState) {
  (loadGame as jest.Mock).mockResolvedValue(state);
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
}

/** The felt's inner size arriving through onLayout (its border on each side added). */
async function layoutFelt(width: number, height: number) {
  await act(async () => {
    fireEvent(screen.getByTestId("blackjack-felt"), "layout", {
      nativeEvent: {
        layout: { x: 0, y: 0, width: width + 2 * FELT_BORDER, height: height + 2 * FELT_BORDER },
      },
    });
  });
}

beforeEach(() => {
  mockWindow.width = 390;
  mockWindow.height = 844;
  resetSentryThrottle();
  capture.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("BlackjackTableScreen reports cards off the felt (#3653)", () => {
  it("sends nothing for a phone's felt", async () => {
    await mount(elevenCards());
    const inner = estimateFeltSize({
      screenWidth: 390,
      screenHeight: 844,
      insetTop: 0,
      insetBottom: 0,
      headerHeight: APP_HEADER_HEIGHT,
    });
    await layoutFelt(inner.width, inner.height);
    expect(screen.getAllByTestId(/^hand-0-card-\d+$/)).toHaveLength(11);
    expect(offTableCalls()).toEqual([]);
  });

  it("never checks the first-frame estimate", async () => {
    // A window so narrow that the estimated felt cannot hold the hand.
    mockWindow.width = 150;
    await mount(elevenCards());
    expect(offTableCalls()).toEqual([]);
  });

  it("reports a measured felt too narrow for the hand, with the layout's numbers", async () => {
    await mount(elevenCards());
    await layoutFelt(150, 300);
    expect(offTableCalls()).toHaveLength(1);
    const [, { tags, extra }] = offTableCalls()[0];
    const g = computeTableGeometry({
      feltWidth: 150,
      feltHeight: 300,
      screenWidth: 390,
      screenHeight: 844,
      dealerCards: 2,
      handCards: [11],
      activeHandIndex: 0,
      showResult: false,
    });
    const fan = g.hands[0]!.fan;
    expect(fan.cardWidth).toBe(MIN_CARD_WIDTH);
    // Centred: the fan's excess over the felt splits evenly between the two sides.
    const over = (fan.width - 150) / 2;
    expect(over).toBeGreaterThan(3);
    expect(tags).toEqual({
      game: "blackjack",
      edge: "right",
      deck: "minimal",
      largeCards: "false",
      platform: "ios",
    });
    expect(extra).toMatchObject({
      overflow: Math.round((fan.x + fan.width - 150) * 10) / 10,
      containerWidth: 150,
      containerHeight: 300,
      cardWidth: MIN_CARD_WIDTH,
      cardHeight: fan.cardHeight,
      step: fan.step,
      compression: g.mode,
      handLengths: [11],
      dealerLength: 2,
    });
  });
});
