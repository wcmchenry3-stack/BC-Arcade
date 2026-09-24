import { createSeededRng, getRng, setRng } from "../../engine";
import type { Card, HeartsState, Rank, Suit } from "../../types";
import { RANKS, SUITS } from "../../types";
import { pimcChooseCard, pimcValues, type PimcConfig } from "../engine";

const c = (suit: Suit, rank: number): Card => ({ suit, rank: rank as Rank });
const key = (card: Card) => `${card.suit}:${card.rank}`;

afterEach(() => setRng(Math.random));

/**
 * Two tricks left, seat 0 to lead 2♠ or K♠. Everything else is already in
 * the won piles, so the six unseen cards are exactly the opponents' hands.
 * Leading K♠ lets whoever holds Q♠ duck it under the king.
 */
function queenEndgame(): HeartsState {
  const hands: Card[][] = [
    [c("spades", 2), c("spades", 13)],
    [c("spades", 12), c("diamonds", 3)],
    [c("spades", 5), c("diamonds", 4)],
    [c("spades", 6), c("diamonds", 5)],
  ];
  const inHands = new Set(hands.flat().map(key));
  const rest: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) if (!inHands.has(`${suit}:${rank}`)) rest.push(c(suit, rank));
  return {
    _v: 3,
    aiDifficulty: "schemer",
    phase: "playing",
    handNumber: 1,
    passDirection: "none",
    playerHands: hands,
    cumulativeScores: [0, 0, 0, 0],
    handScores: [0, 0, 13, 0],
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: true,
    currentTrick: [],
    currentLeaderIndex: 0,
    currentPlayerIndex: 0,
    wonCards: [[], [], rest, []],
    heartsBroken: true,
    tricksPlayedInHand: 11,
    isComplete: false,
    winnerIndex: null,
  };
}

const HAND: PimcConfig = {
  samples: 12,
  horizon: "hand",
  inference: true,
  rolloutPersona: "schemer",
};

describe("pimcValues", () => {
  it("values every legal card, and nothing else", () => {
    const values = pimcValues(queenEndgame(), HAND, createSeededRng(1));
    expect(values.map((v) => key(v.card)).sort()).toEqual(["spades:13", "spades:2"]);
  });

  it("sees the Q♠ danger in a known endgame: leads 2♠, not K♠", () => {
    const values = pimcValues(queenEndgame(), HAND, createSeededRng(2));
    const cost = (k: string) => values.find((v) => key(v.card) === k)!.cost;
    expect(cost("spades:13")).toBeGreaterThan(cost("spades:2"));
    expect(key(pimcChooseCard(queenEndgame(), HAND, createSeededRng(2)))).toBe("spades:2");
  });

  it("is repeatable for the same sampling seed", () => {
    const a = pimcValues(queenEndgame(), HAND, createSeededRng(7));
    const b = pimcValues(queenEndgame(), HAND, createSeededRng(7));
    expect(b).toEqual(a);
  });

  it("returns a forced card without sampling", () => {
    const state = { ...queenEndgame(), currentTrick: [{ card: c("diamonds", 9), playerIndex: 3 }] };
    // Seat 0 has no diamonds, so both spades are legal; make it forced instead.
    const forced = {
      ...state,
      playerHands: [[c("diamonds", 2)], ...state.playerHands.slice(1)],
    } as HeartsState;
    const values = pimcValues(forced, HAND, () => {
      throw new Error("should not sample");
    });
    expect(values).toEqual([{ card: c("diamonds", 2), cost: 0 }]);
  });

  it("leaves the engine RNG as it found it", () => {
    const mine = createSeededRng(123);
    setRng(mine);
    pimcValues(queenEndgame(), HAND, createSeededRng(3));
    expect(getRng()).toBe(mine);
  });
});
