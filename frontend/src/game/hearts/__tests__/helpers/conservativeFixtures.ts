/**
 * Position builder for the conservative CPU tests (#3159), in the rulebook's
 * notation (docs/hearts/CONSERVATIVE_AI.md §5): cards are "10D", "QS", "AH".
 * Not a test file.
 */
import type { Card, HeartsState, Rank, Suit } from "../../types";

const SUIT: Readonly<Record<string, Suit>> = {
  C: "clubs",
  D: "diamonds",
  S: "spades",
  H: "hearts",
};
const FACE: Readonly<Record<string, number>> = { A: 1, J: 11, Q: 12, K: 13 };

/** "10D" → { suit: "diamonds", rank: 10 }; "AS" → ace of spades (rank 1). */
export function card(s: string): Card {
  const rank = FACE[s.slice(0, -1)] ?? Number(s.slice(0, -1));
  return { suit: SUIT[s.slice(-1)]!, rank: rank as Rank };
}

/** "4C 9C KC" → cards. */
export const cards = (s: string): Card[] => s.split(/\s+/).filter(Boolean).map(card);

/** The rulebook name of a card: "QS", "10D". */
export function name(c: Card): string {
  const face = { 1: "A", 11: "J", 12: "Q", 13: "K" }[c.rank as 1 | 11 | 12 | 13] ?? String(c.rank);
  return face + c.suit[0]!.toUpperCase();
}

export interface Position {
  readonly seat: number;
  readonly trickNumber: number;
  readonly hand: string;
  /** Completed tricks: leader seat and the cards in play order. */
  readonly played?: readonly { readonly lead: number; readonly cards: string }[];
  /** The current trick so far, in play order: [seat, card]. */
  readonly trick?: readonly (readonly [number, string])[];
  readonly heartsBroken?: boolean;
  /** Points per seat from completed tricks. */
  readonly points?: readonly number[];
}

const rv = (c: Card): number => (c.rank === 1 ? 14 : c.rank);

/** Builds the engine state a §5 position describes (only the CPU seat's hand is known). */
export function positionState(p: Position): HeartsState {
  const wonCards: Card[][] = [[], [], [], []];
  for (const t of p.played ?? []) {
    const cs = cards(t.cards);
    let best = 0;
    cs.forEach((c, i) => {
      if (c.suit === cs[0]!.suit && rv(c) > rv(cs[best]!)) best = i;
    });
    wonCards[(t.lead + best) % 4]!.push(...cs);
  }
  const playerHands: Card[][] = [[], [], [], []];
  playerHands[p.seat] = cards(p.hand);
  const trick = (p.trick ?? []).map(([seat, c]) => ({ card: card(c), playerIndex: seat }));
  return {
    _v: 3,
    aiDifficulty: "conservative",
    phase: "playing",
    handNumber: 1,
    passDirection: "left",
    playerHands,
    cumulativeScores: [0, 0, 0, 0],
    handScores: p.points ?? [0, 0, 0, 0],
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: true,
    currentTrick: trick,
    currentLeaderIndex: trick[0]?.playerIndex ?? p.seat,
    currentPlayerIndex: p.seat,
    wonCards,
    heartsBroken: p.heartsBroken ?? false,
    tricksPlayedInHand: p.trickNumber - 1,
    isComplete: false,
    winnerIndex: null,
  };
}

/** The same position with the CPU's hand in another order. */
export function withHandOrder(state: HeartsState, seat: number, order: (h: Card[]) => Card[]) {
  const playerHands = state.playerHands.map((h, i) => (i === seat ? order([...h]) : h));
  return { ...state, playerHands };
}
