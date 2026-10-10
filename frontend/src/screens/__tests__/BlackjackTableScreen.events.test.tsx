/**
 * BlackjackTableScreen game events and actions (#2957): the sound and overlay
 * each engine event raises, the player's Stand / Double Down / Split buttons,
 * the New Game confirmation, and the result banners of a split hand. Each test
 * resumes a hand-built engine state through the mocked storage.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame, placeBet } from "../../game/blackjack/engine";
import type { Card, EngineState } from "../../game/blackjack/engine";
import type { BlackjackGameEvent } from "../../game/blackjack/types";
import { playedCount } from "../../test-utils/mockScreenDeps";

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

// Sounds by name, so a test can tell which one played.
const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));

const played = (name: string) => playedCount(mockPlayed, name);

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

const withEvents = (...events: BlackjackGameEvent[]) => playerPhase({ events });

function navigationProp() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
  } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"];
}

async function mountOn(state: EngineState | null, nav = navigationProp()) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const view = await render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackTableScreen navigation={nav} />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { view, nav };
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

const pressLabel = (label: string | RegExp) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockPlayed.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("event sounds", () => {
  it.each<[BlackjackGameEvent["type"], string]>([
    ["cardDeal", "blackjack.cardDeal"],
    ["bust", "blackjack.bust"],
    ["win", "blackjack.win"],
    ["push", "blackjack.push"],
  ])("a %s event plays its sound", async (type, sound) => {
    await mountOn(withEvents({ type } as BlackjackGameEvent));
    expect(played(sound)).toBe(1);
  });

  it("a bust that leaves the player nearly broke plays the same sound", async () => {
    await mountOn(playerPhase({ chips: 100, startingChips: 1000, events: [{ type: "bust" }] }));
    expect(played("blackjack.bust")).toBe(1);
  });

  it("plays an event's sound once, not again on a later render", async () => {
    const { view } = await mountOn(withEvents({ type: "win" }));
    await view.rerender(
      <ThemeProvider>
        <BlackjackGameProvider>
          <BlackjackTableScreen navigation={navigationProp()} />
        </BlackjackGameProvider>
      </ThemeProvider>
    );
    expect(played("blackjack.win")).toBe(1);
  });
});

describe("blackjack celebration", () => {
  // The overlay stays mounted while hidden; it takes touches only while it shows.
  const celebration = () =>
    screen.getByTestId(/^animation-overlay/, { includeHiddenElements: true });

  it("plays the sound and shows the celebration, until it is skipped", async () => {
    await mountOn(withEvents({ type: "blackjack" }));
    expect(played("blackjack.blackjack")).toBe(1);
    expect(celebration().props.pointerEvents).toBe("auto");

    await pressLabel("Skip celebration");
    expect(celebration().props.pointerEvents).toBe("none");
  });

  it("ends by itself", async () => {
    jest.useFakeTimers();
    await mountOn(withEvents({ type: "blackjack" }));
    expect(celebration().props.pointerEvents).toBe("auto");
    await advance(2500);
    expect(celebration().props.pointerEvents).toBe("none");
  });
});

describe("run toasts", () => {
  it("a milestone shows its chip count", async () => {
    await mountOn(withEvents({ type: "milestone", value: 2000 }));
    expect(screen.getByText("Milestone reached: 2000 chips!")).toBeTruthy();
  });

  it("a comeback shows a banner that goes away by itself", async () => {
    jest.useFakeTimers();
    await mountOn(withEvents({ type: "comeback" }));
    expect(screen.getByLabelText("Comeback: chips recovered")).toBeTruthy();
    expect(screen.getByText("What a comeback!")).toBeTruthy();
    await advance(2799);
    expect(screen.getByText("What a comeback!")).toBeTruthy();
    await advance(1);
    expect(screen.queryByText("What a comeback!")).toBeNull();
  });

  it("an all-in shows a badge that goes away by itself", async () => {
    jest.useFakeTimers();
    await mountOn(withEvents({ type: "allIn" }));
    expect(screen.getByLabelText("All in wager")).toBeTruthy();
    await advance(1299);
    expect(screen.getByText("All In!")).toBeTruthy();
    await advance(1);
    expect(screen.queryByText("All In!")).toBeNull();
  });
});

describe("player actions", () => {
  const finished = () => screen.queryByLabelText("Start the next hand");

  it("Stand ends the hand", async () => {
    await mountOn(playerPhase());
    expect(finished()).toBeNull();
    await pressLabel(/^Stand/);
    expect(finished()).toBeTruthy();
  });

  it("Double Down takes one card and ends the hand", async () => {
    await mountOn(playerPhase());
    await pressLabel(/^Double down/);
    expect(finished()).toBeTruthy();
  });

  it("Split turns a pair into two hands", async () => {
    // The deck is set so the two new cards (5 for the first hand, 4 for the second)
    // make no new pair: the first hand cannot be split again.
    await mountOn(
      playerPhase({
        player_hand: [card("8"), card("8", "♥")],
        deck: [card("2", "♣"), card("2", "♦"), card("4", "♣"), card("5", "♣")],
      })
    );
    expect(screen.getByLabelText(/^Split —/).props.accessibilityState.disabled).toBe(false);
    await pressLabel(/^Split —/);
    // Two hands now, the first being played.
    await waitFor(() => expect(screen.getByLabelText(/^Split not available/)).toBeTruthy());
    expect(finished()).toBeNull();
  });

  it("offers no Split or Double Down on a hand that cannot use them", async () => {
    await mountOn(playerPhase({ chips: 50 }));
    expect(screen.getByLabelText(/^Split not available/)).toBeTruthy();
    expect(screen.getByLabelText(/^Double down not available/)).toBeTruthy();
  });
});

describe("split hand result", () => {
  it("shows one banner per hand, each with its own outcome and payout", async () => {
    await mountOn(
      playerPhase({
        phase: "result",
        chips: 1000,
        split_count: 1,
        player_hands: [
          [card("8"), card("10", "♥")],
          [card("8", "♥"), card("9", "♦")],
        ],
        hand_bets: [50, 50],
        hand_outcomes: ["win", "lose"],
        hand_payouts: [50, -50],
      })
    );
    expect(screen.getAllByTestId("result-outcome").map((n) => n.props.children)).toEqual([
      "You Win!",
      "You Lose",
    ]);
    expect(screen.getByText("+50 chips")).toBeTruthy();
    expect(screen.getByText("-50 chips")).toBeTruthy();
  });

  it("falls back to a push when a hand has no recorded outcome", async () => {
    await mountOn(
      playerPhase({
        phase: "result",
        chips: 1000,
        split_count: 1,
        player_hands: [
          [card("8"), card("10", "♥")],
          [card("8", "♥"), card("9", "♦")],
        ],
        hand_bets: [50, 50],
        hand_outcomes: [],
        hand_payouts: [],
      })
    );
    expect(screen.getAllByText("Push")).toHaveLength(2);
    expect(screen.getAllByText("No change")).toHaveLength(2);
  });
});

describe("New Game", () => {
  const pill = () => screen.getByLabelText("New Game");

  it("asks first when a hand is in play, and cancelling keeps the game", async () => {
    const { nav } = await mountOn(playerPhase());
    await act(async () => {
      await fireEvent.press(pill());
    });
    expect(screen.getByText("Start new game?")).toBeTruthy();

    await pressLabel("Cancel");
    expect(screen.queryByText("Start new game?")).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("starts over on the betting screen once confirmed", async () => {
    const { nav } = await mountOn(playerPhase());
    await act(async () => {
      await fireEvent.press(pill());
    });
    await pressLabel("Start new game");
    expect(screen.queryByText("Start new game?")).toBeNull();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting"));
  });

  it("goes straight back to betting from the table before a bet", async () => {
    const { nav } = await mountOn(null);
    (nav.replace as jest.Mock).mockClear();
    await act(async () => {
      await fireEvent.press(pill());
    });
    expect(screen.queryByText("Start new game?")).toBeNull();
    expect(nav.replace).toHaveBeenCalledWith("BlackjackBetting");
  });
});

describe("leaving the table", () => {
  it("goes back to the lobby from the header", async () => {
    const { nav } = await mountOn(playerPhase());
    await pressLabel("Go back to home screen");
    expect(nav.popToTop).toHaveBeenCalledTimes(1);
  });
});
