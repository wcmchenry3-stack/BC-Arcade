/**
 * Hearts AI unit tests (#606): `selectCardToPlay` discards when void in the led suit
 * (`chooseDiscard`).
 *
 * Part of the `selectCardToPlay` cluster of `ai.ts`, split by describe group so no file passes the
 * ~1,000-line layout rule (#2955). Describe blocks moved whole; shared fixtures live in
 * `helpers/aiFixtures.ts`.
 */
import { selectCardToPlay } from "../ai";
import { setRng } from "../engine";
import type { TrickCard } from "../types";
import { c, mkState } from "./helpers/aiFixtures";

// Pin RNG to suppress cognitive noise (NOISE_RATE: Cautious 55%, Schemer 19%) so tests
// are deterministic — noise fires only when rng() < noiseRate, never at 0.99.
beforeEach(() => setRng(() => 0.99));

// ---------------------------------------------------------------------------
// selectCardToPlay — void (discarding)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — void in led suit", () => {
  it("discards Q♠ when void and Q♠ is a valid play", () => {
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 7), playerIndex: 1 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    expect(pick).toEqual(c("spades", 12));
  });

  it("discards highest heart when void and no Q♠", () => {
    const hand = [c("hearts", 5), c("hearts", 11), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 7), playerIndex: 1 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    // Utility AI discards a heart (any heart is valid; not penalised for suit choice)
    expect(pick.suit).toBe("hearts");
  });

  it("discards highest card of longest suit when no hearts or Q♠", () => {
    const hand = [c("diamonds", 5), c("diamonds", 10), c("spades", 3)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 7), playerIndex: 1 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], [], [], hand],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 3,
    });
    const pick = selectCardToPlay(hand, trick, state, 3);
    // Utility AI discards a non-point card (no hearts or Q♠ to penalise)
    expect([c("diamonds", 5), c("diamonds", 10), c("spades", 3)]).toContainEqual(pick);
  });
});

// ---------------------------------------------------------------------------
// Daring AI — score-aware endgame
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, score-aware endgame", () => {
  it("dumps Q♠ on score leader when void and score leader is winning the trick", () => {
    // Player 0 has the highest score (70) and is winning the trick.
    // Daring (player 1) is void in clubs and should dump Q♠ to push player 0 toward 100.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 8), playerIndex: 0 },
      { card: c("clubs", 3), playerIndex: 2 },
      { card: c("clubs", 5), playerIndex: 3 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 8,
      currentPlayerIndex: 1,
      cumulativeScores: [70, 20, 10, 15],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).toEqual(c("spades", 12));
  });

  it("holds Q♠ when dumping would push trick winner to 100+ and Daring is not the game leader", () => {
    // Player 2 (score 88) is winning the trick; 88 + 13 = 101 ≥ 100 would end the game.
    // Daring (player 1, score 50) is not the game leader (player 0 has lowest score 30).
    // Player 3 is the score leader (92) but is NOT winning the trick — offensive dump doesn't fire.
    // Daring should hold Q♠ and discard a safe card instead.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 4), playerIndex: 3 },
      { card: c("clubs", 6), playerIndex: 0 },
      { card: c("clubs", 9), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 8,
      currentPlayerIndex: 1,
      cumulativeScores: [30, 50, 88, 92],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).not.toEqual(c("spades", 12));
  });
});

// ---------------------------------------------------------------------------
// Daring AI — adversarial targeting (#1638)
// ---------------------------------------------------------------------------

describe("selectCardToPlay — Daring difficulty, adversarial void discard", () => {
  it("dumps Q♠ on seat 0 when seat 0 is winning the trick and Daring is void", () => {
    // Player 1 (Daring) is void in clubs and holds Q♠ + hearts.
    // Seat 0 is winning with K♣. Dump Q♠ on any void opportunity (not gated on position).
    const hand = [c("spades", 12), c("hearts", 5), c("hearts", 9), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 13), playerIndex: 0 }, // seat 0 winning
      { card: c("clubs", 3), playerIndex: 2 },
      { card: c("clubs", 4), playerIndex: 3 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // Seat 0 is winning — adversarial: dump Q♠ on human.
    expect(pick).toEqual(c("spades", 12));
  });

  it("dumps Q♠ immediately when void, even when an AI (not seat 0) is winning", () => {
    // Player 1 (Daring) is void in clubs. Seat 2 is winning with K♣ (not seat 0).
    // Adversarial mode only fires when seat 0 is winning; here it does not, so
    // normal Daring weights apply — Q♠ off-suit dump scores highest (1.0 vs 0.8 for hearts).
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 0 },
      { card: c("clubs", 13), playerIndex: 2 }, // seat 2 winning
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    expect(pick).toEqual(c("spades", 12));
  });
});

describe("selectCardToPlay — Daring difficulty, adversarial void discard (edge cases)", () => {
  it("falls through to normal discard when seat 0 is winning but Daring holds no Q♠ or hearts", () => {
    // Player 1 holds only non-point cards — nothing to target seat 0 with.
    // Should fall through and discard normally (highest non-point card).
    const hand = [c("diamonds", 10), c("clubs", 9), c("diamonds", 6)];
    const trick: TrickCard[] = [
      { card: c("spades", 13), playerIndex: 0 }, // seat 0 winning with K♠
      { card: c("spades", 3), playerIndex: 2 },
    ];
    const state = mkState({
      playerHands: [[], hand, [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 1,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 1, "daring");
    // No Q♠ or hearts to dump — adversarial block falls through; normal discard fires.
    expect(pick.suit).not.toBe("hearts");
    expect(pick).not.toEqual(c("spades", 12));
  });

  it("does not apply adversarial targeting when Daring is seat 0 (never happens in real game)", () => {
    // Regression: Daring at seat 0 must NOT save Q♠ waiting for a 'seat 0 win' that can never
    // fire from its own void plays — it would hold Q♠ indefinitely and hurt its own score.
    // Daring at seat 0 should dump Q♠ normally (chooseDiscard) regardless of who is winning.
    const hand = [c("spades", 12), c("hearts", 5), c("diamonds", 7)];
    const trick: TrickCard[] = [
      { card: c("clubs", 3), playerIndex: 1 },
      { card: c("clubs", 13), playerIndex: 2 }, // seat 2 winning — not seat 0
    ];
    const state = mkState({
      playerHands: [hand, [], [], []],
      currentTrick: trick,
      tricksPlayedInHand: 3,
      currentPlayerIndex: 0,
      heartsBroken: true,
      handScores: [0, 0, 0, 0],
      wonCards: [[], [], [], []],
      cumulativeScores: [10, 10, 10, 10],
    });
    const pick = selectCardToPlay(hand, trick, state, 0, "daring");
    // Adversarial targeting inactive for playerIndex=0; chooseDiscard dumps Q♠ normally.
    expect(pick).toEqual(c("spades", 12));
  });
});
