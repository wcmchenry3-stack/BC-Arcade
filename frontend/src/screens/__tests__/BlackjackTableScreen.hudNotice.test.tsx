/**
 * BlackjackTableScreen run notices in the HUD strip (#3797): the milestone, comeback and all-in
 * notices replace the table tag for their hold and never draw over the felt (the dealer's cards,
 * the result banner, the player's cards).
 */

import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render, screen, within } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame, placeBet } from "../../game/blackjack/engine";
import type { Card, EngineState } from "../../game/blackjack/engine";
import type { BlackjackGameEvent } from "../../game/blackjack/types";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";

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
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => []));

const card = (rank: string, suit = "♠"): Card => ({ rank, suit });

/** A hand in the player's phase: 9 and 7 against a dealer 6, a 100-chip bet. */
function playerPhase(overrides: Partial<EngineState> = {}): EngineState {
  return {
    ...placeBet(newGame(), 100),
    phase: "player",
    chips: 900,
    bet: 100,
    outcome: null,
    payout: 0,
    player_hand: [card("9"), card("7", "♥")],
    dealer_hand: [card("6", "♦"), card("10", "♣")],
    player_hands: [],
    hand_bets: [],
    hand_outcomes: [],
    hand_payouts: [],
    active_hand_index: 0,
    split_count: 0,
    split_from_aces: [],
    events: undefined,
    ...overrides,
  };
}

const withEvents = (...events: BlackjackGameEvent[]) => playerPhase({ events, runGoal: 5000 });

function navigationProp() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
  } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"];
}

async function mountOn(state: EngineState | null) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  await render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackTableScreen navigation={navigationProp()} />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

const notice = () => screen.queryByTestId("blackjack-hud-notice");
const tag = () => screen.queryByTestId("blackjack-hud-tag", { includeHiddenElements: true });
const felt = () => within(screen.getByTestId("blackjack-table-area"));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  resetReduceMotionForTests();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("HUD notices", () => {
  it("the table tag shows when there is no notice", async () => {
    await mountOn(withEvents());
    expect(tag()).toBeTruthy();
    expect(notice()).toBeNull();
  });

  it("a milestone replaces the tag in the HUD strip, then the tag returns", async () => {
    await mountOn(withEvents({ type: "milestone", value: 2000 }));
    const chip = screen.getByTestId("blackjack-hud-notice");
    expect(within(chip).getByText("Milestone: 2000")).toBeTruthy();
    expect(tag()).toBeNull();
    // The chips and goal on the right stay visible.
    expect(screen.getByTestId("blackjack-hud-chips")).toBeTruthy();
    await advance(1799);
    expect(notice()).toBeTruthy();
    await advance(1);
    expect(notice()).toBeNull();
    expect(tag()).toBeTruthy();
  });

  it("announces the full sentence, politely", async () => {
    await mountOn(withEvents({ type: "milestone", value: 2000 }));
    const chip = screen.getByTestId("blackjack-hud-notice");
    expect(chip.props.accessibilityLabel).toBe("Milestone reached: 2000 chips!");
    expect(chip.props.accessibilityLiveRegion).toBe("polite");
  });

  it("a comeback shows in the HUD strip, then the tag returns", async () => {
    await mountOn(withEvents({ type: "comeback" }));
    const chip = screen.getByTestId("blackjack-hud-notice");
    expect(within(chip).getByText("What a comeback!")).toBeTruthy();
    expect(chip.props.accessibilityLabel).toBe("Comeback: chips recovered");
    expect(tag()).toBeNull();
    await advance(2800);
    expect(notice()).toBeNull();
    expect(tag()).toBeTruthy();
  });

  it("an all-in shows in the HUD strip, then the tag returns", async () => {
    await mountOn(withEvents({ type: "allIn" }));
    const chip = screen.getByTestId("blackjack-hud-notice");
    expect(within(chip).getByText("All In!")).toBeTruthy();
    expect(chip.props.accessibilityLabel).toBe("All in wager");
    await advance(1300);
    expect(notice()).toBeNull();
    expect(tag()).toBeTruthy();
  });

  it("when notices coincide: comeback over milestone over all-in", async () => {
    await mountOn(
      withEvents({ type: "allIn" }, { type: "milestone", value: 2000 }, { type: "comeback" })
    );
    expect(screen.getAllByTestId("blackjack-hud-notice")).toHaveLength(1);
    expect(screen.getByText("What a comeback!")).toBeTruthy();
    await advance(1800);
    expect(screen.getByText("What a comeback!")).toBeTruthy();
    await advance(1000);
    expect(notice()).toBeNull();
  });

  it("a milestone outranks an all-in", async () => {
    await mountOn(withEvents({ type: "allIn" }, { type: "milestone", value: 2000 }));
    expect(screen.getByText("Milestone: 2000")).toBeTruthy();
    expect(screen.queryByText("All In!")).toBeNull();
  });

  it("is drawn in the HUD strip and nothing is drawn over the felt", async () => {
    await mountOn(
      withEvents({ type: "allIn" }, { type: "milestone", value: 2000 }, { type: "comeback" })
    );
    const hud = within(screen.getByTestId("blackjack-hud"));
    expect(hud.getByTestId("blackjack-hud-notice")).toBeTruthy();
    expect(felt().queryByTestId("blackjack-hud-notice")).toBeNull();
    expect(felt().queryByText("What a comeback!")).toBeNull();
    expect(felt().queryByLabelText("Comeback: chips recovered")).toBeNull();
    expect(felt().queryByLabelText("All in wager")).toBeNull();
    expect(felt().queryByLabelText(/^Milestone reached/)).toBeNull();
  });

  it("a milestone pulses the goal bar while its chip shows", async () => {
    await mountOn(withEvents({ type: "milestone", value: 2000 }));
    expect(screen.getByTestId("blackjack-goal-pulse")).toBeTruthy();
    await advance(1800);
    expect(screen.queryByTestId("blackjack-goal-pulse")).toBeNull();
  });

  it("an all-in does not pulse the goal bar", async () => {
    await mountOn(withEvents({ type: "allIn" }));
    expect(screen.queryByTestId("blackjack-goal-pulse")).toBeNull();
  });

  it("under Reduce Motion there is no pulse, only the chip", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await mountOn(withEvents({ type: "milestone", value: 2000 }));
    expect(notice()).toBeTruthy();
    expect(screen.queryByTestId("blackjack-goal-pulse")).toBeNull();
  });
});
