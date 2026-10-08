/**
 * Shared playing-card types (#2986) for the French-suited 52-card games
 * (Solitaire, FreeCell, Hearts). Pure data, no side effects.
 *
 * Blackjack's cards (`rank: string`, suit glyphs) are a different domain and
 * deliberately not built on this.
 */

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];

/** 1 = Ace, 11 = Jack, 12 = Queen, 13 = King. Numeric so rank arithmetic
 * (foundation ascends A→K, tableau descends K→A) stays obvious. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** A card with no game-specific state. Games extend it (Solitaire adds `faceUp`). */
export interface PlayingCard {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** Red suits (hearts, diamonds) must alternate with black (spades, clubs) in a tableau. */
export function cardColor(card: Pick<PlayingCard, "suit">): "red" | "black" {
  return card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
}
