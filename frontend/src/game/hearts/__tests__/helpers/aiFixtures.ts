/**
 * Shared fixtures for the Hearts `ai.<cluster>.test.ts` files (#2955). Not a test file.
 */
import type { Card, HeartsState, Rank, Suit } from "../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function c(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

export function mkState(overrides: Partial<HeartsState> = {}): HeartsState {
  return {
    _v: 3,
    aiDifficulty: "schemer",
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
    currentPlayerIndex: 0,
    wonCards: [[], [], [], []],
    heartsBroken: true,
    tricksPlayedInHand: 1,
    isComplete: false,
    winnerIndex: null,
    ...overrides,
  };
}
