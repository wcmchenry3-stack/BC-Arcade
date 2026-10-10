/**
 * Hand-built Hearts positions for the HeartsScreen flow suite (#2957). Not a
 * test file. A saved game is returned by the mocked `loadGame`, so a test
 * starts from exactly the position it names.
 */
import type { Card, HeartsState, Rank, Suit } from "../../../game/hearts/types";

export const heartsCard = (suit: Suit, rank: Rank): Card => ({ suit, rank });

/** A hand in progress, human to play, nobody holding anything; override what a test needs. */
export function heartsPlay(overrides: Partial<HeartsState> = {}): HeartsState {
  return {
    _v: 3,
    aiDifficulty: "schemer",
    phase: "playing",
    handNumber: 4,
    passDirection: "none",
    cumulativeScores: [0, 0, 0, 0],
    handScores: [0, 0, 0, 0],
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: true,
    heartsBroken: true,
    isComplete: false,
    winnerIndex: null,
    events: [],
    tricksPlayedInHand: 4,
    currentLeaderIndex: 0,
    currentPlayerIndex: 0,
    currentTrick: [],
    playerHands: [[], [], [], []],
    wonCards: [[], [], [], []],
    ...overrides,
  };
}

/** Every heart plus the Queen of Spades: what a player who shot the moon holds. */
export function moonHaul(): Card[] {
  return [
    ...(Array.from({ length: 13 }, (_, i) => heartsCard("hearts", (i + 1) as Rank)) as Card[]),
    heartsCard("spades", 12),
  ];
}

/** A hand just finished (the scorecard shows between hands), West holding `wonCards[1]`. */
export function heartsDealing(overrides: Partial<HeartsState> = {}): HeartsState {
  return heartsPlay({
    phase: "dealing",
    handNumber: 1,
    passDirection: "left",
    cumulativeScores: [5, 10, 6, 5],
    handScores: [5, 10, 6, 5],
    scoreHistory: [[5, 10, 6, 5]],
    tricksPlayedInHand: 13,
    ...overrides,
  });
}
