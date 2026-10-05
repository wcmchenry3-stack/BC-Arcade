/**
 * Tests for the client-side Blackjack engine: splitting (`canSplit`, `split`) and play on split
 * hands.
 *
 * Ports backend/tests/test_blackjack_game.py so the two engines behave identically. Split out of
 * the former `engine.test.ts` (#2955) by exported-function cluster of `engine.ts`; describe blocks
 * moved whole, shared fixtures live in `helpers/engineFixtures.ts`.
 */
import { newGame, hit, stand, doubleDown, split, canSplit, newHand, EngineState } from "../engine";
import { c, splitSetup } from "./helpers/engineFixtures";

// --- split ----------------------------------------------------------------

describe("split", () => {
  it("wrong phase throws", () => {
    expect(() => split(newGame())).toThrow("Not in player phase");
  });

  it("creates two hands from a pair", () => {
    const s = splitSetup({ deck: [c("♠", "3"), c("♥", "5")] });
    const next = split(s);
    expect(next.split_count).toBe(1);
    expect(next.player_hands).toHaveLength(2);
    expect(next.player_hands[0]).toHaveLength(2);
    expect(next.player_hands[1]).toHaveLength(2);
    expect(next.player_hands[0]?.[0]?.rank).toBe("8");
    expect(next.player_hands[1]?.[0]?.rank).toBe("8");
  });

  it("creates matching bets", () => {
    const next = split(splitSetup({ chips: 500, bet: 100 }));
    expect(next.hand_bets).toEqual([100, 100]);
  });

  it("rejects different ranks", () => {
    const s = splitSetup({ player: [c("♠", "7"), c("♥", "8")] });
    expect(() => split(s)).toThrow("cannot be split");
  });

  it("rejects when not two cards", () => {
    const s = splitSetup({ player: [c("♠", "8"), c("♥", "8"), c("♦", "2")] });
    expect(() => split(s)).toThrow("cannot be split");
  });

  it("rejects insufficient chips", () => {
    const s = splitSetup({ chips: 150, bet: 100 });
    expect(() => split(s)).toThrow("Insufficient chips");
  });

  it("allows split with exact chips", () => {
    const next = split(splitSetup({ chips: 200, bet: 100 }));
    expect(next.split_count).toBe(1);
  });

  it("splits 10-value cards (K+J)", () => {
    const s = splitSetup({ player: [c("♠", "K"), c("♥", "J")] });
    const next = split(s);
    expect(next.player_hands[0]?.[0]?.rank).toBe("K");
    expect(next.player_hands[1]?.[0]?.rank).toBe("J");
  });

  it("stays in player phase after split", () => {
    const next = split(splitSetup());
    expect(next.phase).toBe("player");
    expect(next.active_hand_index).toBe(0);
  });

  it("canSplit returns true for pair", () => {
    expect(canSplit(splitSetup())).toBe(true);
  });

  it("canSplit returns false for non-pair", () => {
    expect(canSplit(splitSetup({ player: [c("♠", "7"), c("♥", "8")] }))).toBe(false);
  });
});

describe("split hit/stand", () => {
  it("hit adds card to active split hand", () => {
    const s = split(splitSetup({ deck: [c("♠", "3"), c("♥", "5"), c("♦", "2")] }));
    const initial = s.player_hands[0]?.length ?? 0;
    const next = hit(s);
    expect(next.player_hands[0]).toHaveLength(initial + 1);
  });

  it("stand advances to next hand", () => {
    const s = split(splitSetup());
    expect(s.active_hand_index).toBe(0);
    const next = stand(s);
    expect(next.active_hand_index).toBe(1);
  });

  it("stand on last hand triggers dealer and result", () => {
    let s = split(
      splitSetup({
        deck: [c("♠", "3"), c("♥", "5"), c("♦", "10")],
        dealer: [c("♦", "6"), c("♣", "9")],
      })
    );
    s = stand(s); // hand 0 done
    s = stand(s); // hand 1 done → dealer plays → result
    expect(s.phase).toBe("result");
    expect(s.outcome).not.toBeNull();
  });

  it("bust on split hand settles and advances", () => {
    let s = split(
      splitSetup({ player: [c("♠", "K"), c("♥", "K")], deck: [c("♠", "3"), c("♥", "5")] })
    );
    // Override hand 0 to make bustable, override deck with bust card
    s = {
      ...s,
      player_hands: [[c("♠", "K"), c("♥", "5")], s.player_hands[1] ?? []],
      deck: [c("♠", "Q")],
    };
    const next = hit(s);
    expect(next.hand_outcomes[0]).toBe("lose");
    expect(next.active_hand_index).toBe(1);
  });
});

describe("split payout", () => {
  it("independent outcomes per hand (one win, one lose)", () => {
    // Hand 0: K+K(dealt)=20, Hand 1: K+8=18, Dealer: 10+9=19
    let s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "K"), c("♥", "K")],
        dealer: [c("♦", "10"), c("♣", "9")],
        deck: [c("♠", "8"), c("♥", "K")],
      })
    );
    s = stand(s);
    s = stand(s);
    expect(s.hand_outcomes[0]).toBe("win");
    expect(s.hand_outcomes[1]).toBe("lose");
    expect(s.payout).toBe(0);
    expect(s.chips).toBe(1000);
  });

  it("both hands win", () => {
    let s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "K"), c("♥", "K")],
        dealer: [c("♦", "6"), c("♣", "7")],
        deck: [c("♠", "10"), c("♥", "9"), c("♦", "10")],
      })
    );
    s = stand(s);
    s = stand(s);
    expect(s.hand_outcomes[0]).toBe("win");
    expect(s.hand_outcomes[1]).toBe("win");
    expect(s.payout).toBe(200);
    expect(s.chips).toBe(1200);
  });

  it("both hands lose", () => {
    let s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "5"), c("♥", "5")],
        dealer: [c("♦", "10"), c("♣", "10")],
        deck: [c("♠", "2"), c("♥", "3")],
      })
    );
    s = stand(s);
    s = stand(s);
    expect(s.hand_outcomes[0]).toBe("lose");
    expect(s.hand_outcomes[1]).toBe("lose");
    expect(s.payout).toBe(-200);
    expect(s.chips).toBe(800);
  });

  it("split 21 pays even money not 3:2", () => {
    // Split aces: A+K=21, A+5=16. Dealer 10+7=17.
    const s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "A"), c("♥", "A")],
        dealer: [c("♦", "10"), c("♣", "7")],
        deck: [c("♠", "5"), c("♥", "K")],
      })
    );
    // Aces auto-stand → result
    expect(s.phase).toBe("result");
    expect(s.hand_payouts[0]).toBe(100); // even money, not 150
    expect(s.hand_outcomes[0]).toBe("win");
    expect(s.hand_outcomes[1]).toBe("lose");
  });
});

describe("split aces", () => {
  it("auto-stands and reaches result", () => {
    const s = split(
      splitSetup({
        player: [c("♠", "A"), c("♥", "A")],
        dealer: [c("♦", "10"), c("♣", "7")],
        deck: [c("♠", "5"), c("♥", "K")],
      })
    );
    expect(s.active_hand_index).toBeGreaterThanOrEqual(2);
    expect(s.phase).toBe("result");
  });

  it("each hand gets exactly one card", () => {
    const s = split(
      splitSetup({
        player: [c("♠", "A"), c("♥", "A")],
        deck: [c("♠", "5"), c("♥", "K")],
      })
    );
    expect(s.player_hands[0]).toHaveLength(2);
    expect(s.player_hands[1]).toHaveLength(2);
  });

  it("cannot hit on split aces", () => {
    // Manually build a split-ace state in player phase
    const s: EngineState = {
      ...splitSetup(),
      player_hands: [
        [c("♠", "A"), c("♥", "5")],
        [c("♥", "A"), c("♠", "K")],
      ],
      hand_bets: [100, 100],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      active_hand_index: 0,
      split_count: 1,
      split_from_aces: [true, true],
    };
    expect(() => hit(s)).toThrow("Cannot hit on split aces");
  });

  it("cannot double down on split aces", () => {
    const s: EngineState = {
      ...splitSetup(),
      player_hands: [
        [c("♠", "A"), c("♥", "5")],
        [c("♥", "A"), c("♠", "K")],
      ],
      hand_bets: [100, 100],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      active_hand_index: 0,
      split_count: 1,
      split_from_aces: [true, true],
    };
    expect(() => doubleDown(s)).toThrow("Cannot double down on split aces");
  });
});

describe("resplit", () => {
  it("allows up to 3 splits (4 hands)", () => {
    let s = split(
      splitSetup({
        chips: 1000,
        bet: 100,
        player: [c("♠", "8"), c("♥", "8")],
        deck: Array(20)
          .fill(c("♦", "3"))
          .concat([c("♣", "8"), c("♣", "8"), c("♣", "8"), c("♣", "8"), c("♣", "8"), c("♣", "8")]),
      })
    );
    expect(s.split_count).toBe(1);
    // Force hand 0 to be a pair for resplit
    s = { ...s, player_hands: [[c("♠", "8"), c("♦", "8")], s.player_hands[1] ?? []] };
    s = split(s);
    expect(s.split_count).toBe(2);
    s = { ...s, player_hands: [[c("♠", "8"), c("♣", "8")], ...s.player_hands.slice(1)] };
    s = split(s);
    expect(s.split_count).toBe(3);
    expect(s.player_hands).toHaveLength(4);
  });

  it("rejects fourth split", () => {
    const s: EngineState = {
      ...splitSetup({ chips: 1000, bet: 100 }),
      player_hands: [
        [c("♠", "8"), c("♥", "8")],
        [c("♦", "8"), c("♣", "3")],
        [c("♠", "3"), c("♥", "5")],
        [c("♦", "5"), c("♣", "7")],
      ],
      hand_bets: [100, 100, 100, 100],
      hand_outcomes: [null, null, null, null],
      hand_payouts: [0, 0, 0, 0],
      active_hand_index: 0,
      split_count: 3,
      split_from_aces: [false, false, false, false],
    };
    expect(() => split(s)).toThrow("Maximum number of splits");
  });
});

describe("split then double down", () => {
  it("DD on split hand doubles per-hand bet", () => {
    let s = split(
      splitSetup({
        chips: 500,
        bet: 100,
        player: [c("♠", "8"), c("♥", "8")],
        dealer: [c("♦", "10"), c("♣", "7")],
        deck: [c("♠", "3"), c("♥", "5"), c("♦", "8")],
      })
    );
    s = doubleDown(s);
    expect(s.active_hand_index).toBeGreaterThanOrEqual(1);
    expect(s.hand_bets[0]).toBe(200);
  });

  it("DD on split rejects insufficient chips", () => {
    const s = split(splitSetup({ chips: 200, bet: 100, deck: [c("♠", "3"), c("♥", "5")] }));
    // Total wagered = 200, free stack = 0
    expect(() => doubleDown(s)).toThrow("Insufficient chips");
  });
});

describe("newHand resets split", () => {
  it("clears all split state", () => {
    let s = split(
      splitSetup({
        player: [c("♠", "8"), c("♥", "8")],
        dealer: [c("♦", "10"), c("♣", "7")],
        deck: [c("♠", "3"), c("♥", "5")],
      })
    );
    s = stand(s);
    s = stand(s);
    expect(s.phase).toBe("result");
    const fresh = newHand(s);
    expect(fresh.phase).toBe("betting");
    expect(fresh.split_count).toBe(0);
    expect(fresh.player_hands).toEqual([]);
    expect(fresh.hand_bets).toEqual([]);
  });
});
