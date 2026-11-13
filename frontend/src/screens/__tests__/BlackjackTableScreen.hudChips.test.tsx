/**
 * The HUD strip keeps the chip total after Keep Playing (#3617): the goal clears, the table name
 * and chips stay, and only the "/ goal" text and the progress bar go.
 */
import React from "react";
import { AccessibilityInfo } from "react-native";
import { act, render, screen } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame, placeBet } from "../../game/blackjack/engine";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import type { Card, EngineState } from "../../game/blackjack/engine";

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

const card = (rank: string, suit = "♠"): Card => ({ rank, suit });
const BEGINNER = { startingChips: 100, runGoal: 250, betMin: 5, betMax: 25 };

/** Dealt from the end: player 10 5 against the dealer's 7 9; every later card is a 2. */
function knownDeck(): Card[] {
  const filler = Array.from({ length: 100 }, () => card("2", "♣"));
  return [...filler, card("9", "♥"), card("5", "♥"), card("7", "♣"), card("10", "♠")];
}

/** The state after Keep Playing: no goal, with the goal that was reached remembered. */
const keptPlaying = (): EngineState => ({
  ...newGame(knownDeck(), { ...BEGINNER, runGoal: null }),
  chips: 260,
  reachedRunGoal: 250,
});

const playingState = (base: EngineState): EngineState => placeBet(base, 10);

const resultState = (base: EngineState): EngineState => ({
  ...base,
  phase: "result",
  chips: 250,
  bet: 10,
  outcome: "lose",
  payout: -10,
  player_hand: [card("10"), card("8", "♥")],
  dealer_hand: [card("10", "♦"), card("K", "♣")],
});

async function mountOn(state: EngineState) {
  (loadGame as jest.Mock).mockResolvedValue(state);
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
            } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"]
          }
        />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  // The strip, not the motion: with Reduce Motion the chips show at once.
  resetReduceMotionForTests();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
});

afterEach(() => {
  (loadGame as jest.Mock).mockResolvedValue(null);
  jest.restoreAllMocks();
  resetReduceMotionForTests();
});

describe("HUD chip total with no goal (Keep Playing)", () => {
  it("shows the chips while betting, with no goal text and no bar", async () => {
    await mountOn(keptPlaying());
    expect(await screen.findByText("Deal")).toBeTruthy();
    expect(screen.getByTestId("blackjack-hud-chips").props.children).toBe("260");
    expect(screen.getByLabelText("Chips: 260")).toBeTruthy();
    expect(screen.queryByTestId("blackjack-goal-bar")).toBeNull();
    expect(screen.queryByText(/\/\s*250/)).toBeNull();
    expect(screen.getByText("BEGINNER", { includeHiddenElements: true })).toBeTruthy();
  });

  it("shows the chips during play", async () => {
    await mountOn(playingState(keptPlaying()));
    expect(await screen.findByText("Hit")).toBeTruthy();
    expect(screen.getByTestId("blackjack-hud-chips")).toBeTruthy();
    expect(screen.getByLabelText(/^Chips: 260$/)).toBeTruthy();
    expect(screen.queryByTestId("blackjack-goal-bar")).toBeNull();
  });

  it("shows the chips at the result", async () => {
    await mountOn(resultState(keptPlaying()));
    expect(await screen.findByText("Rebet")).toBeTruthy();
    expect(screen.getByTestId("blackjack-hud-chips").props.children).toBe("250");
    expect(screen.getByLabelText("Chips: 250")).toBeTruthy();
    expect(screen.queryByTestId("blackjack-goal-bar")).toBeNull();
  });
});

describe("HUD with a goal", () => {
  it("shows the chips, the goal and the progress bar", async () => {
    await mountOn(newGame(knownDeck(), BEGINNER));
    expect(await screen.findByText("Deal")).toBeTruthy();
    expect(screen.getByTestId("blackjack-goal-bar")).toBeTruthy();
    expect(screen.getByLabelText("Goal progress: 100 of 250 chips")).toBeTruthy();
    expect(screen.getByText(/\/\s*250/)).toBeTruthy();
  });
});
