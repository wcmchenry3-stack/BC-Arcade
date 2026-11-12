/**
 * The one Blackjack table (#3580): bet, play, result and the next hand on one
 * screen; the result dock's Change / Rebet / 2× and their bet rules; the
 * result kept clear of the hands; the split layout chosen by hand count.
 */
import React, { useEffect } from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider, useBlackjackGame } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame, loadRuns, saveGame } from "../../game/blackjack/storage";
import { newGame, newHand, placeBet } from "../../game/blackjack/engine";
import { DOCK_HEIGHT } from "../../game/blackjack/layout";
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

/** The Beginner table: 5–25, chips 5 / 10 / 25. */
const BEGINNER = { startingChips: 100, runGoal: 250, betMin: 5, betMax: 25 };

/**
 * A deck dealt from the end: the first hand is player 10♠ 5♥ against the
 * dealer's 7♣ 9♥ (a stand: the dealer draws a 2, 15 loses to 18); every later card is a 2♣.
 */
function knownDeck(): Card[] {
  const filler = Array.from({ length: 100 }, () => card("2", "♣"));
  return [...filler, card("9", "♥"), card("5", "♥"), card("7", "♣"), card("10", "♠")];
}

// The game context as the screen sees it, kept current by Spy after each render.
const spied: { ctx?: ReturnType<typeof useBlackjackGame> } = {};
function Spy() {
  const value = useBlackjackGame();
  useEffect(() => {
    spied.ctx = value;
  });
  return null;
}
const engine = () => spied.ctx?.engine;

function nav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
  } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"] & {
    navigate: jest.Mock;
    replace: jest.Mock;
  };
}

async function mountOn(state: EngineState) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const n = nav();
  await render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackTableScreen navigation={n} />
        <Spy />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return n;
}

const press = (label: string | RegExp) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });

const disabled = (label: string | RegExp) =>
  screen.getByLabelText(label).props.accessibilityState?.disabled === true;

/** A settled single hand at the Beginner table. */
function resultState(o: Partial<EngineState> = {}): EngineState {
  return {
    ...newGame(knownDeck(), BEGINNER),
    phase: "result",
    chips: 90,
    bet: 10,
    outcome: "lose",
    payout: -10,
    player_hand: [card("10"), card("8", "♥")],
    dealer_hand: [card("10", "♦"), card("K", "♣")],
    ...o,
  };
}

afterEach(() => {
  (loadGame as jest.Mock).mockResolvedValue(null);
  // A test that turned Reduce Motion on leaves it off for the next, even if it failed (#3720 review).
  jest.restoreAllMocks();
  resetReduceMotionForTests();
});

describe("a full hand on one screen", () => {
  it("bet → deal → stand → result → Rebet → next hand dealt, with no screen swap", async () => {
    // The flow, not the motion (#3581, BlackjackTableScreen.motion.test.tsx): with Reduce Motion
    // the result shows at the instant of the Stand.
    resetReduceMotionForTests();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const n = await mountOn(newGame(knownDeck(), BEGINNER));
    await screen.findByText("Deal");

    await press(/add 10 to bet/i);
    await press(/deal cards with 10-chip bet/i);
    expect(await screen.findByText("Hit")).toBeTruthy();

    await press(/^Stand/);
    expect(await screen.findByText("Rebet")).toBeTruthy();
    // A plain loss gets its own feedback on the felt.
    expect(screen.getByTestId("result-outcome").props.children).toBe("You Lose");
    expect(screen.getByTestId("result-detail").props.children).toBe("15 against the dealer's 18");
    expect(engine()?.chips).toBe(90);

    await press(/^Rebet — deal again with 10 chips/);
    // The next hand is dealt at the same stake, on the same screen.
    await waitFor(() => expect(engine()?.phase).not.toBe("result"));
    await waitFor(() => expect(engine()?.phase).not.toBe("betting"));
    expect(engine()?.bet).toBe(10);
    // An ordinary round to the context: it was counted and logged as round 2.
    expect(engine()?.round).toBe(2);

    expect(n.replace).not.toHaveBeenCalled();
    expect(n.navigate).not.toHaveBeenCalled();
  });
});

// Review round 1, #1: Rebet / 2× are one transition (newHand + placeBet).
describe("Rebet / 2× as one transition", () => {
  const saved = () => (saveGame as jest.Mock).mock.calls.map((c) => c[0] as EngineState);

  it("goes from the result straight to the deal: no betting frame is rendered or saved", async () => {
    await mountOn(resultState());
    (saveGame as jest.Mock).mockClear();
    await press(/^Rebet — deal again with 10 chips/);
    expect(saved().map((s) => s.phase)).not.toContain("betting");
    expect(saved()).toHaveLength(1);
    expect(engine()?.bet).toBe(10);
    // Counted as an ordinary round: the first bet of this session's game is round 1.
    expect(engine()?.round).toBe(1);
  });

  it("a Rebet then 2× double tap deals once, at the first tap's bet", async () => {
    await mountOn(resultState());
    const rebet = screen.getByLabelText(/^Rebet — deal again with 10 chips/);
    const double = screen.getByLabelText(/^Double the bet — deal again with 20 chips/);
    (saveGame as jest.Mock).mockClear();
    await act(async () => {
      fireEvent.press(rebet);
      fireEvent.press(double);
    });
    expect(saved()).toHaveLength(1);
    expect(engine()?.bet).toBe(10);
    expect(engine()?.round).toBe(1);
    // No error from the ignored second tap.
    expect(spied.ctx?.error).toBeNull();
  });

  // Review round 3, #7: once a hand is dealt, no bet is left building in the dock.
  it.each([
    ["Rebet", /^Rebet — deal again with 10 chips/],
    ["2×", /^Double the bet — deal again with 20 chips/],
  ])("%s leaves no stale bet for the next betting phase", async (_name, label) => {
    await mountOn(resultState());
    await press(label);
    expect(engine()?.phase).not.toBe("betting");
    // Back to betting by another path (the dev panel here): the dock starts empty.
    await act(async () => {
      spied.ctx!.devSetEngine((s) => ({
        ...s,
        phase: "betting",
        bet: 0,
        player_hand: [],
        dealer_hand: [],
        outcome: null,
        payout: 0,
      }));
    });
    expect(await screen.findByLabelText(/deal cards with 0-chip bet/i)).toBeTruthy();
  });

  it("a Deal leaves no stale bet either", async () => {
    await mountOn(newGame(knownDeck(), BEGINNER));
    await press("Add 10 to bet");
    await press(/deal cards with 10-chip bet/i);
    await screen.findByText("Hit");
    await act(async () => {
      spied.ctx!.devSetEngine((s) => ({
        ...s,
        phase: "betting",
        bet: 0,
        player_hand: [],
        dealer_hand: [],
      }));
    });
    expect(await screen.findByLabelText(/deal cards with 0-chip bet/i)).toBeTruthy();
  });

  it("a step that throws leaves nothing applied and nothing armed", async () => {
    await mountOn(resultState());
    (saveGame as jest.Mock).mockClear();
    let applied = true;
    await act(async () => {
      applied = spied.ctx!.applySteps(
        [
          newHand,
          () => {
            throw new Error("boom");
          },
        ],
        ["result"]
      );
    });
    expect(applied).toBe(false);
    expect(engine()?.phase).toBe("result");
    expect(saved()).toHaveLength(0);
    expect(spied.ctx?.error).toBe("boom");
    // A later move to betting deals nothing by itself.
    await press(/^Change bet/);
    await screen.findByText("Deal");
    expect(engine()?.phase).toBe("betting");
    expect(engine()?.bet).toBe(0);
  });
});

// Review round 1, #2: the table picker is explicit state, not inferred from the chips.
describe("table pick pending", () => {
  it("after Keep Playing, chips back at the opening stack: Change opens betting, not the picker", async () => {
    await mountOn(
      resultState({ runGoal: null, reachedRunGoal: 250, chips: 100, startingChips: 100 })
    );
    await press(/^Change bet/);
    expect(await screen.findByText("Deal")).toBeTruthy();
    expect(screen.queryByText("CHOOSE A TABLE")).toBeNull();
    expect(spied.ctx?.tablePickPending).toBe(false);
  });

  it("is set by New Game and cleared by a table pick", async () => {
    await mountOn(resultState());
    await act(async () => {
      await spied.ctx!.handlePlayAgain();
    });
    expect(await screen.findByText("CHOOSE A TABLE")).toBeTruthy();
    await press(/select beginner table/i);
    expect(await screen.findByText("Deal")).toBeTruthy();
    expect(spied.ctx?.tablePickPending).toBe(false);
  });
});

// Codex on ready: the picker no longer remounts the screen, so run history must be
// reloaded when it opens, or a table earned this run stays locked until a relaunch.
describe("table unlocks without a remount", () => {
  afterEach(() => {
    (loadRuns as jest.Mock).mockResolvedValue([]);
  });

  it("New Game after a won run shows the next table unlocked", async () => {
    const wonBeginner = {
      table: "beginner",
      startingChips: 100,
      finalChips: 300,
      runGoal: 250,
      completed: true,
      outcome: "win",
      handsPlayed: 5,
      biggestWin: 50,
      lowestChips: 90,
      startedAt: 1,
      endedAt: 2,
    };
    // At mount the run isn't saved yet; it is by the time New Game opens the picker.
    (loadRuns as jest.Mock).mockResolvedValueOnce([]).mockResolvedValue([wonBeginner]);
    await mountOn(resultState({ runGoal: null, reachedRunGoal: 250, chips: 300 }));
    await act(async () => {
      await spied.ctx!.handlePlayAgain();
    });
    expect(await screen.findByText("CHOOSE A TABLE")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(/select intermediate table/i)).toBeTruthy());
    expect(screen.queryByLabelText(/intermediate table locked/i)).toBeNull();
  });
});

// Review round 1, #7: the dock keeps one height; an error does not move it.
describe("the dock", () => {
  const dockHeight = () =>
    (StyleSheet.flatten(screen.getByTestId("blackjack-dock").props.style) as { height?: number })
      .height;

  it("has the same height while betting, playing and after the result", async () => {
    await mountOn(newGame(knownDeck(), BEGINNER));
    await screen.findByText("Deal");
    expect(dockHeight()).toBe(DOCK_HEIGHT);
    await press("Add 10 to bet");
    await press(/deal cards with 10-chip bet/i);
    await screen.findByText("Hit");
    expect(dockHeight()).toBe(DOCK_HEIGHT);
    await press(/^Stand/);
    await screen.findByText("Rebet");
    expect(dockHeight()).toBe(DOCK_HEIGHT);
  });

  it("shows an engine error over the felt, not in the dock", async () => {
    await mountOn(newGame(knownDeck(), BEGINNER));
    await screen.findByText("Deal");
    await act(async () => {
      spied.ctx!.apply(() => {
        throw new Error("Something went wrong");
      });
    });
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(
      within(screen.getByTestId("blackjack-dock")).queryByText("Something went wrong")
    ).toBeNull();
    expect(dockHeight()).toBe(DOCK_HEIGHT);
  });
});

// The betting dock: what BettingPanel's tests checked, now on the table.
describe("betting dock", () => {
  const betting = (o: Partial<EngineState> = {}) => ({ ...newGame(knownDeck(), BEGINNER), ...o });

  it("Deal is disabled with no bet", async () => {
    await mountOn(betting());
    expect(disabled(/deal cards with 0-chip bet/i)).toBe(true);
  });

  it("offers the table's chips and adds them up", async () => {
    await mountOn(betting());
    expect(screen.getByLabelText("Add 5 to bet")).toBeTruthy();
    expect(screen.getByLabelText("Add 10 to bet")).toBeTruthy();
    expect(screen.getByLabelText("Add 25 to bet")).toBeTruthy();
    await press("Add 10 to bet");
    await press("Add 5 to bet");
    expect(screen.getByLabelText("Current bet: 15 chips")).toBeTruthy();
    expect(disabled(/deal cards with 15-chip bet/i)).toBe(false);
  });

  it("Clear resets the bet", async () => {
    await mountOn(betting());
    await press("Add 5 to bet");
    await press(/clear bet/i);
    expect(screen.getByLabelText(/deal cards with 0-chip bet/i)).toBeTruthy();
  });

  it("a chip that would pass the stack or the table maximum is disabled", async () => {
    await mountOn(betting({ chips: 10 }));
    expect(disabled("25-chip not available")).toBe(true);
    await press("Add 10 to bet");
    expect(disabled("5-chip not available")).toBe(true);
  });

  it("shows the table limits", async () => {
    await mountOn(betting());
    expect(screen.getByText(/Table Limits/)).toBeTruthy();
  });
});

describe("result dock: Change, Rebet, 2×", () => {
  it("2× deals double the last bet", async () => {
    await mountOn(resultState());
    expect(disabled(/^Double the bet — deal again with 20 chips/)).toBe(false);
    await press(/^Double the bet — deal again with 20 chips/);
    await waitFor(() => expect(engine()?.bet).toBe(20));
    expect(engine()?.phase === "player" || engine()?.phase === "result").toBe(true);
  });

  it("Rebet deals the stake before a double down", async () => {
    await mountOn(resultState({ bet: 20, doubled: true, chips: 80 }));
    await press(/^Rebet — deal again with 10 chips/);
    await waitFor(() => expect(engine()?.phase).not.toBe("betting"));
    expect(engine()?.bet).toBe(10);
  });

  it("2× is off above the table maximum; Rebet stays on", async () => {
    await mountOn(resultState({ bet: 15 }));
    expect(disabled(/^Double the bet/)).toBe(true);
    expect(disabled(/^Rebet/)).toBe(false);
  });

  it("both are off when the stack cannot cover them", async () => {
    await mountOn(resultState({ bet: 25, chips: 20 }));
    expect(disabled(/^Rebet/)).toBe(true);
    expect(disabled(/^Double the bet/)).toBe(true);
  });

  it("below the table minimum the tray offers the all-in only", async () => {
    await mountOn(resultState({ bet: 5, chips: 3 }));
    expect(disabled(/^Rebet/)).toBe(true);
    expect(disabled(/^Double the bet/)).toBe(true);
    expect(screen.getByLabelText("Add 3 to bet")).toBeTruthy();
    expect(screen.queryByLabelText("Add 5 to bet")).toBeNull();
  });

  it("Change opens betting with no bet; Deal waits for chips", async () => {
    await mountOn(resultState());
    await press(/^Change bet/);
    await screen.findByText("Deal");
    expect(engine()?.phase).toBe("betting");
    expect(disabled(/deal cards with 0-chip bet/i)).toBe(true);
  });

  it("a chip in the result tray starts the next bet with it", async () => {
    await mountOn(resultState());
    await press("Add 25 to bet");
    await screen.findByText("Deal");
    expect(engine()?.phase).toBe("betting");
    expect(disabled(/deal cards with 25-chip bet/i)).toBe(false);
  });

  it("is all off once the chips have run out (under the out-of-chips card)", async () => {
    await mountOn(resultState({ chips: 0 }));
    const off = (label: RegExp) =>
      screen.getByLabelText(label, { includeHiddenElements: true }).props.accessibilityState
        ?.disabled;
    expect(off(/^Change bet/)).toBe(true);
    expect(off(/^Rebet/)).toBe(true);
    expect(off(/^Double the bet/)).toBe(true);
  });
});

/** The rect a felt child is drawn at (absolute left/top/width/height). */
function rectOf(testID: string) {
  const s = StyleSheet.flatten(screen.getByTestId(testID).props.style) as {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  return { x: s.left, y: s.top, width: s.width, height: s.height };
}

/** Lay the felt out at the size it has on a 375×667 phone with the chip tray. */
async function layoutFelt(width = 359, height = 367) {
  await act(async () => {
    fireEvent(screen.getByTestId("blackjack-felt"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width, height } },
    });
  });
}

describe("the felt", () => {
  it("shows the result between the dealer and the player, covering neither", async () => {
    await mountOn(
      resultState({
        player_hand: [card("2"), card("3"), card("A"), card("2", "♦"), card("4"), card("5", "♥")],
        dealer_hand: [
          card("2", "♣"),
          card("3", "♦"),
          card("A", "♣"),
          card("2", "♥"),
          card("4", "♦"),
          card("K"),
        ],
        outcome: "win",
        payout: 10,
      })
    );
    await layoutFelt();
    const result = rectOf("blackjack-felt-result");
    const dealerLast = rectOf("dealer-card-5");
    const playerLabel = rectOf("hand-label-0");
    const playerFirst = rectOf("hand-0-card-0");
    expect(result.y).toBeGreaterThanOrEqual(dealerLast.y + dealerLast.height);
    expect(result.y + result.height).toBeLessThanOrEqual(playerLabel.y);
    expect(playerLabel.y + playerLabel.height).toBeLessThanOrEqual(playerFirst.y);
    // "Dealer busts with 22"
    expect(screen.getByTestId("result-detail").props.children).toBe("Dealer busts with 22");
  });

  it("hides the dealer's total until the hole card turns", async () => {
    await mountOn({
      ...placeBet(newGame(knownDeck(), BEGINNER), 10),
    });
    expect(screen.getByLabelText("Dealer score hidden")).toBeTruthy();
    // The hole card is a real card back from the shared PlayingCard, outlined
    // by the table so it reads against the felt (review round 1, #6).
    expect(screen.getByLabelText("Face-down card")).toBeTruthy();
    expect(screen.getByTestId("dealer-card-0-outline")).toBeTruthy();
    expect(screen.queryByTestId("dealer-card-1-outline")).toBeNull();
  });

  // Review round 1, #3: one show-result predicate; the victory felt shows the result too.
  it("shows the result on the felt in the victory phase", async () => {
    const n = await mountOn(
      resultState({ phase: "victory", outcome: "win", payout: 25, chips: 260 })
    );
    expect(screen.getByTestId("blackjack-felt-result")).toBeTruthy();
    expect(screen.getByTestId("result-outcome").props.children).toBe("You Win!");
    expect(n.replace).toHaveBeenCalledWith("BlackjackVictory");
  });

  function splitState(hands: Card[][], active: number): EngineState {
    return {
      ...newGame(knownDeck(), BEGINNER),
      phase: "player",
      chips: 100,
      bet: 5,
      player_hand: [card("8"), card("8", "♥")],
      dealer_hand: [card("6", "♦"), card("10", "♣")],
      split_count: hands.length - 1,
      player_hands: hands,
      hand_bets: hands.map(() => 5),
      hand_outcomes: hands.map(() => null),
      hand_payouts: hands.map(() => 0),
      split_from_aces: hands.map(() => false),
      active_hand_index: active,
    };
  }

  it("two split hands are fans side by side", async () => {
    await mountOn(
      splitState(
        [
          [card("8"), card("3"), card("Q", "♦")],
          [card("8", "♥"), card("2", "♣")],
        ],
        1
      )
    );
    await layoutFelt(359, 417);
    const a = rectOf("hand-box-0");
    const b = rectOf("hand-box-1");
    expect(a.y).toBe(b.y);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    // The first hand is played: dimmed; the active one is not.
    const opacity = (text: string) =>
      (StyleSheet.flatten(screen.getByText(text).props.style) as { opacity?: number }).opacity;
    expect(opacity("Hand 1")).toBeLessThan(1);
    expect(opacity("Hand 2")).toBeUndefined();
  });

  it("four split hands are full-width rows, the active one larger", async () => {
    const five = (r: string) => [
      card(r),
      card("2", "♥"),
      card("2", "♦"),
      card("3", "♣"),
      card("4"),
    ];
    await mountOn(splitState([five("8"), five("8"), five("8"), five("8")], 3));
    await layoutFelt(359, 417);
    const rows = [0, 1, 2, 3].map((i) => rectOf(`hand-box-${i}`));
    for (let i = 1; i < 4; i++)
      expect(rows[i]!.y).toBeGreaterThan(rows[i - 1]!.y + rows[i - 1]!.height - 1);
    for (const r of rows) expect(r.width).toBeGreaterThan(359 * 0.9);
    expect(rows[3]!.height).toBeGreaterThan(rows[0]!.height);
    expect(screen.getByLabelText(/^Hand 4, Player score 19, Bet 5 chips/)).toBeTruthy();
  });
});
