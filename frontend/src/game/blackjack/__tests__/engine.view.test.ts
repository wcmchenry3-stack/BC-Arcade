/**
 * Tests for the client-side Blackjack engine: `toViewState`.
 *
 * Ports backend/tests/test_blackjack_game.py so the two engines behave identically. Split out of
 * the former `engine.test.ts` (#2955) by exported-function cluster of `engine.ts`; describe blocks
 * moved whole, shared fixtures live in `helpers/engineFixtures.ts`.
 */
import { newGame, split, toViewState, EngineState } from "../engine";
import { c, stateInPlayer, stateInResult, splitSetup } from "./helpers/engineFixtures";

// --- View state projection -----------------------------------------------

describe("toViewState", () => {
  it("conceals dealer hole card during player phase", () => {
    const view = toViewState(stateInPlayer());
    expect(view.dealer_hand.cards[0]).toEqual({ rank: "?", suit: "?", face_down: true });
    expect(view.dealer_hand.value).toBe(0);
    expect(view.player_hand.value).toBe(15);
  });

  it("reveals dealer hand during result phase", () => {
    const view = toViewState(stateInResult());
    expect(view.dealer_hand.cards[0]?.face_down).toBe(false);
    expect(view.dealer_hand.value).toBeGreaterThan(0);
  });

  it("sets game_over when chips=0 and phase=result", () => {
    const broke: EngineState = { ...stateInResult(0, 100), chips: 0 };
    expect(toViewState(broke).game_over).toBe(true);
  });

  it("game_over false when chips>0", () => {
    expect(toViewState(stateInResult()).game_over).toBe(false);
  });

  it("player_hand.soft is true for a soft hand", () => {
    const soft: EngineState = {
      ...stateInPlayer(),
      player_hand: [c("♠", "A"), c("♥", "6")], // soft 17
    };
    expect(toViewState(soft).player_hand.soft).toBe(true);
    expect(toViewState(soft).player_hand.value).toBe(17);
  });

  it("dealer_hand.soft is false when concealed (hole card hidden)", () => {
    const soft: EngineState = {
      ...stateInPlayer(),
      dealer_hand: [c("♦", "A"), c("♣", "6")], // soft 17 but concealed
    };
    const view = toViewState(soft);
    expect(view.dealer_hand.soft).toBe(false);
    expect(view.dealer_hand.value).toBe(0);
  });

  it("dealer_hand.soft is true when revealed in result phase", () => {
    const soft: EngineState = {
      ...stateInResult(),
      dealer_hand: [c("♦", "A"), c("♣", "6")], // soft 17
    };
    expect(toViewState(soft).dealer_hand.soft).toBe(true);
    expect(toViewState(soft).dealer_hand.value).toBe(17);
  });

  it("last_win is null on a fresh game", () => {
    expect(toViewState(newGame()).last_win).toBeNull();
  });

  it("last_win reflects lastWin from engine state", () => {
    const s: EngineState = { ...stateInResult(), lastWin: 150 };
    expect(toViewState(s).last_win).toBe(150);
  });

  it("last_win is negative for a loss", () => {
    const s: EngineState = { ...stateInResult(), lastWin: -100 };
    expect(toViewState(s).last_win).toBe(-100);
  });

  it("double_down_available only in player phase with 2 cards and chips >= 2*bet", () => {
    // chips=500, bet=100 → chips >= 200 ✓
    expect(toViewState(stateInPlayer(500, 100)).double_down_available).toBe(true);
    // boundary: chips=200, bet=100 ✓
    expect(toViewState(stateInPlayer(200, 100)).double_down_available).toBe(true);
    // chips=150, bet=100 → not enough free stack
    expect(toViewState(stateInPlayer(150, 100)).double_down_available).toBe(false);
    // 3 cards → not available
    const three: EngineState = {
      ...stateInPlayer(500, 100),
      player_hand: [c("♠", "5"), c("♥", "5"), c("♦", "5")],
    };
    expect(toViewState(three).double_down_available).toBe(false);
  });
});

describe("toViewState with split", () => {
  it("includes split fields", () => {
    const s = split(splitSetup({ deck: [c("♠", "3"), c("♥", "5")] }));
    const view = toViewState(s);
    expect(view.player_hands).toHaveLength(2);
    expect(view.hand_bets).toEqual([100, 100]);
    expect(view.active_hand_index).toBe(0);
    expect(view.split_available).toBeDefined();
  });

  it("split_available is true for pair with chips", () => {
    const view = toViewState(splitSetup());
    expect(view.split_available).toBe(true);
  });

  it("split_available is false for non-pair", () => {
    const view = toViewState(splitSetup({ player: [c("♠", "7"), c("♥", "8")] }));
    expect(view.split_available).toBe(false);
  });
});
