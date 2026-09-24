import { detectMoonAttempt, selectCardsToPass } from "../ai";
import { MOON_HAND_RULES, assessMoonHand } from "../moonHand";
import type { Card, HeartsState, Rank, Suit } from "../types";

function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

function mkState(overrides: Partial<HeartsState> = {}): HeartsState {
  return {
    _v: 3,
    aiDifficulty: "daring",
    phase: "playing",
    handNumber: 1,
    passDirection: "left",
    playerHands: [[], [], [], []],
    cumulativeScores: [0, 0, 0, 0],
    handScores: [0, 0, 0, 0],
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: true,
    currentTrick: [],
    currentLeaderIndex: 0,
    currentPlayerIndex: 1,
    wonCards: [[], [], [], []],
    heartsBroken: false,
    tricksPlayedInHand: 0,
    isComplete: false,
    winnerIndex: null,
    ...overrides,
  };
}

/** Viable: 4 top hearts, Q♠, A♦-led diamonds of 3, no weak suit. */
const viableHand = [
  c("hearts", 1),
  c("hearts", 13),
  c("hearts", 12),
  c("hearts", 11),
  c("spades", 12),
  c("spades", 13),
  c("diamonds", 1),
  c("diamonds", 9),
  c("diamonds", 4),
  c("clubs", 13),
  c("clubs", 12),
  c("clubs", 3),
  c("clubs", 2),
];

describe("assessMoonHand (#2234)", () => {
  it("rates a hand on top hearts, spade control, a strong side suit and weak suits", () => {
    expect(assessMoonHand(viableHand)).toEqual({
      topHearts: 4,
      totalHearts: 4,
      spadeControl: true,
      strongSideSuit: true,
      strongSuit: "diamonds",
      weakSuits: 0,
      viable: true,
    });
  });

  it("does not trigger on six low hearts (2♥-7♥) + Q♠ — heart count alone is not enough", () => {
    const hand = [
      c("hearts", 2),
      c("hearts", 3),
      c("hearts", 4),
      c("hearts", 5),
      c("hearts", 6),
      c("hearts", 7),
      c("spades", 12),
      c("diamonds", 1),
      c("diamonds", 9),
      c("diamonds", 4),
      c("clubs", 13),
      c("clubs", 12),
      c("clubs", 2),
    ];
    const a = assessMoonHand(hand);
    expect(a.topHearts).toBe(0);
    expect(a.viable).toBe(false);
  });

  it("triggers on a four-heart hand when all four are top hearts, with Q♠ and a strong side suit", () => {
    expect(assessMoonHand(viableHand).totalHearts).toBe(4);
    expect(assessMoonHand(viableHand).viable).toBe(true);
  });

  it("no longer requires Q♠: protected A♠+K♠ count as spade control", () => {
    const hand = viableHand.map((card) =>
      card.suit === "spades" && card.rank === 12 ? c("spades", 1) : card
    ); // A♠ K♠, no Q♠
    const a = assessMoonHand(hand);
    expect(a.spadeControl).toBe(true);
    expect(a.viable).toBe(true);
  });

  it("has no spade control with neither Q♠ nor A♠+K♠", () => {
    const hand = viableHand.map((card) =>
      card.suit === "spades" ? c("spades", card.rank === 12 ? 3 : 2) : card
    );
    expect(assessMoonHand(hand).spadeControl).toBe(false);
    expect(assessMoonHand(hand).viable).toBe(false);
  });

  it("counts a captured Q♠ and captured top hearts", () => {
    const inHand = [
      c("hearts", 1),
      c("hearts", 13),
      c("diamonds", 1),
      c("diamonds", 9),
      c("diamonds", 4),
    ];
    const captured = [c("spades", 12), c("hearts", 12), c("hearts", 11)];
    const a = assessMoonHand(inHand, captured);
    expect(a).toMatchObject({ topHearts: 4, totalHearts: 4, spadeControl: true, viable: true });
  });

  it("needs its side suit led by the ace and at least three long", () => {
    const noAce = viableHand.map((card) =>
      card.suit === "diamonds" && card.rank === 1 ? c("diamonds", 10) : card
    );
    expect(assessMoonHand(noAce).strongSideSuit).toBe(false);
    const short = viableHand.filter((card) => !(card.suit === "diamonds" && card.rank === 4));
    expect(assessMoonHand(short).strongSideSuit).toBe(false);
  });

  it("counts side suits with nothing that can win a trick as weak, and allows at most one", () => {
    const base = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("spades", 12),
    ];
    const strongDiamonds = [c("diamonds", 1), c("diamonds", 9), c("diamonds", 4)];
    const weakClubs = [c("clubs", 9), c("clubs", 8), c("clubs", 2)]; // best 9♣ < J
    // Spades Q-7-5: Q♠ can win a trick, so spades are not weak.
    const oneWeak = [...base, c("spades", 7), c("spades", 5), ...strongDiamonds, ...weakClubs];
    expect(assessMoonHand(oneWeak)).toMatchObject({ weakSuits: 1, viable: true });
    // Spades 10♠ alone: nothing that wins a trick → a second weak suit.
    const twoWeak = [
      ...base.filter((x) => x.suit === "hearts"),
      c("spades", 10), // spades best 10♠ < J → weak
      ...strongDiamonds,
      ...weakClubs,
    ];
    expect(assessMoonHand(twoWeak)).toMatchObject({ weakSuits: 2, viable: false });
  });
});

describe("detectMoonAttempt (#2234)", () => {
  it("fires for Daring with a viable hand while it holds every point taken", () => {
    const state = mkState({ playerHands: [[], viableHand, [], []] });
    expect(detectMoonAttempt(viableHand, state, 1, "daring")).toBe(true);
  });

  it("never fires for the other personas", () => {
    const state = mkState({ playerHands: [[], viableHand, [], []] });
    expect(detectMoonAttempt(viableHand, state, 1, "schemer")).toBe(false);
    expect(detectMoonAttempt(viableHand, state, 1, "cautious")).toBe(false);
  });

  it("does not fire once another player has taken points (the moon is impossible)", () => {
    const state = mkState({ playerHands: [[], viableHand, [], []], handScores: [1, 0, 0, 0] });
    expect(detectMoonAttempt(viableHand, state, 1, "daring")).toBe(false);
  });

  it("stays committed through the last tricks after capturing ≥ 13 points, whatever the hand now rates", () => {
    // Three cards left (below the old 5-card cutoff), low hearts only.
    const hand = [c("hearts", 2), c("hearts", 3), c("clubs", 4)];
    const won = [c("spades", 12), c("hearts", 1), c("hearts", 13)];
    const state = mkState({
      playerHands: [[], hand, [], []],
      handScores: [0, MOON_HAND_RULES.commitPoints + 2, 0, 0],
      wonCards: [[], won, [], []],
      tricksPlayedInHand: 10,
    });
    expect(assessMoonHand(hand, won).viable).toBe(false);
    expect(detectMoonAttempt(hand, state, 1, "daring")).toBe(true);
  });

  it("is not committed below the commitment threshold", () => {
    const hand = [c("hearts", 2), c("hearts", 3), c("clubs", 4)];
    const won = [c("hearts", 1), c("hearts", 13)];
    const state = mkState({
      playerHands: [[], hand, [], []],
      handScores: [0, 2, 0, 0],
      wonCards: [[], won, [], []],
      tricksPlayedInHand: 10,
    });
    expect(detectMoonAttempt(hand, state, 1, "daring")).toBe(false);
  });
});

describe("moon attempts across the hand (#2234 review)", () => {
  it("keeps attempting after the side-suit ace is gone: shape is judged on the full hand only", () => {
    // Opening hand: 7 hearts (5 top), Q♠, A♦-3♦-2♦ — viable. Two tricks later
    // it has played A♦ and one more card, still holding every point (none yet).
    const opening = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 10),
      c("hearts", 9),
      c("hearts", 8),
      c("spades", 12),
      c("diamonds", 1),
      c("diamonds", 3),
      c("diamonds", 2),
      c("clubs", 13),
      c("clubs", 4),
    ];
    const start = mkState({ playerHands: [[], opening, [], []] });
    expect(detectMoonAttempt(opening, start, 1, "daring")).toBe(true);

    const later = opening.filter(
      (x) => !(x.suit === "diamonds" && x.rank === 1) && !(x.suit === "clubs" && x.rank === 4)
    );
    const mid = mkState({ playerHands: [[], later, [], []], tricksPlayedInHand: 2 });
    expect(assessMoonHand(later).strongSideSuit).toBe(false); // the shape is gone...
    expect(detectMoonAttempt(later, mid, 1, "daring")).toBe(true); // ...the attempt isn't
  });

  it("does not pass away the side suit that made the hand viable", () => {
    // Before #2234's review fix the moon pass gave away 3♦ 4♦ (lowest
    // non-hearts), leaving A♦ alone and the kept hand no longer viable.
    const hand = [
      c("hearts", 1),
      c("hearts", 13),
      c("hearts", 12),
      c("hearts", 11),
      c("hearts", 6),
      c("spades", 12),
      c("spades", 7),
      c("diamonds", 1),
      c("diamonds", 4),
      c("diamonds", 3),
      c("clubs", 13),
      c("clubs", 9),
      c("clubs", 2),
    ];
    expect(assessMoonHand(hand).viable).toBe(true);
    const passed = selectCardsToPass(hand, "across", "daring", 1);
    expect(passed.some((p) => p.suit === "diamonds")).toBe(false); // side suit kept
    expect(passed).not.toContainEqual(c("spades", 12));
    const kept = hand.filter((x) => !passed.some((p) => p.suit === x.suit && p.rank === x.rank));
    expect(assessMoonHand(kept).viable).toBe(true);
  });
});
