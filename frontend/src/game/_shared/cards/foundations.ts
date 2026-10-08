/**
 * Suit-keyed foundation piles (#2986), shared by Solitaire and FreeCell. Each
 * pile ascends Ace→King in one suit.
 */

import { SUITS, type PlayingCard, type Rank, type Suit } from "./types";

/** 4 foundation piles keyed by suit; each is ascending A→K. */
export type Foundations<C extends PlayingCard = PlayingCard> = Readonly<Record<Suit, readonly C[]>>;

export function emptyFoundations<C extends PlayingCard = PlayingCard>(): Foundations<C> {
  return { spades: [], hearts: [], diamonds: [], clubs: [] };
}

/** `foundations` with `suit`'s pile replaced by `pile`. */
export function withFoundation<C extends PlayingCard>(
  foundations: Foundations<C>,
  suit: Suit,
  pile: readonly C[]
): Foundations<C> {
  return { ...foundations, [suit]: pile };
}

/** True once the foundations hold the whole deck (`deckSize` cards). */
export function isWin(foundations: Foundations, deckSize: number): boolean {
  let total = 0;
  for (const suit of SUITS) {
    total += foundations[suit].length;
  }
  return total === deckSize;
}

/** An Ace starts an empty pile; otherwise the next rank of the top card's suit. */
export function canStackOnFoundation(moving: PlayingCard, pile: readonly PlayingCard[]): boolean {
  if (pile.length === 0) return moving.rank === 1;
  const top = pile[pile.length - 1];
  if (top === undefined) return false;
  return moving.suit === top.suit && moving.rank === ((top.rank + 1) as Rank);
}
