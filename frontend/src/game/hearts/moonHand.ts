/**
 * Moon-shot hand evaluation (#2234).
 *
 * Replaces the old heart-count triggers ("6-7 hearts + Q♠") with a check of
 * whether the hand can actually control the board. A moon needs every trick
 * that carries points, so what matters is how many of those tricks the hand
 * can win, not how many hearts it holds:
 *
 * - top hearts: A/K/Q/J/10♥ win heart tricks; a pile of low hearts loses them;
 * - spade control: Q♠ in hand (or already captured), or A♠+K♠ to absorb it
 *   if it is dumped;
 * - a strong side suit (its ace plus length) to keep the lead;
 * - few weak suits: a side suit with nothing that can win a trick lets
 *   opponents win tricks the hand needs to take points in.
 *
 * Persona-independent: it rates the hand, not a persona's taste for moons
 * (per #2269, moon viability is core engine logic). Today only Daring acts
 * on it (ai.ts); the other personas never attempt moons.
 */

import { isQueenOfSpades } from "./engine";
import type { Card, Suit } from "./types";

const aceHigh = (rank: number): number => (rank === 1 ? 14 : rank);

/**
 * Thresholds, chosen by the duplicate-deal sweep on #2234 (sim/harness.ts).
 * Findings that shaped them:
 * - Starting a moon from the opening hand costs Daring points in almost
 *   every kind of hand (−2.7 points per hand relative to the table on
 *   average, 80,000 paired deals); even 4-5 top hearts only break even.
 *   So the hand-quality gate is strict and rarely fires.
 * - Staying in the attempt once Daring has captured ≥ 13 points and still
 *   holds every point taken is what wins games: Daring − Schemer win share
 *   rose from +1.4pp to +7.3pp, and paired moon success from 7.3% to 9.7%.
 *   Commitment at 5 or 10 points measured the same within noise; 13 (Q♠ or
 *   thirteen hearts already taken) spends the fewest hands in moon mode.
 * - The old triggers stopped attempting with fewer than 5 cards left, which
 *   abandoned nearly finished moons; there is no card-count cutoff now.
 * - Committing on Q♠ alone looks risky, but also requiring 2 top hearts
 *   measured worse (Daring − Schemer +6.4pp vs +7.3pp), so it isn't required.
 * - Side-suit shape (strong suit, weak suits) is judged only on the full
 *   13-card hand, before the player's first card: it changes with every card
 *   played (leading the side-suit ace would otherwise end the attempt), while
 *   top hearts and spade control — held or captured — stay true as long as
 *   the attempt is alive. The state has no memory of an attempt in
 *   progress, so these stable criteria are what keep it going.
 */
export const MOON_HAND_RULES = {
  /** Hearts held + captured that must be top hearts (A/K/Q/J/10♥). */
  minTopHearts: 4,
  /** Rank (ace-high) from which a heart counts as a top heart. */
  topHeartMinRank: 10,
  /** Length of an ace-led side suit that counts as "strong". */
  strongSideSuitLength: 3,
  /** A side suit is weak when its best card is below this rank (ace-high). */
  weakSuitBelowRank: 11,
  /** Most weak side suits a viable hand may hold. */
  maxWeakSuits: 1,
  /**
   * Once the player holds every point taken so far and at least this many,
   * it stays in the attempt whatever the hand now rates. 0 = no commitment.
   */
  commitPoints: 13,
  /** Pass phase: top hearts needed to keep Q♠ even when passing to the human. */
  strongPassTopHearts: 5,
};

export interface MoonHandAssessment {
  readonly topHearts: number;
  readonly totalHearts: number;
  readonly spadeControl: boolean;
  readonly strongSideSuit: boolean;
  /** The longest ace-led side suit of at least the strong length, if any. */
  readonly strongSuit: Suit | null;
  readonly weakSuits: number;
  /** All four criteria hold. */
  readonly viable: boolean;
}

const SIDE_SUITS: readonly Suit[] = ["spades", "diamonds", "clubs"];

/**
 * Rate a hand for a moon shot. `captured` is what the player has already won
 * this hand (empty before the first trick); captured hearts and Q♠ count
 * towards the hearts and spade-control criteria.
 */
export function assessMoonHand(
  hand: readonly Card[],
  captured: readonly Card[] = [],
  checkStructure = true,
  rules: typeof MOON_HAND_RULES = MOON_HAND_RULES
): MoonHandAssessment {
  const hearts = [...hand, ...captured].filter((c) => c.suit === "hearts");
  const topHearts = hearts.filter((c) => aceHigh(c.rank) >= rules.topHeartMinRank).length;
  // Held or already captured: a captured A♠/K♠/Q♠ was won by this player,
  // so its control has been used, not lost.
  const own = [...hand, ...captured];
  const spadeControl =
    own.some(isQueenOfSpades) ||
    (own.some((c) => c.suit === "spades" && c.rank === 1) &&
      own.some((c) => c.suit === "spades" && c.rank === 13));

  let strongSuit: Suit | null = null;
  let strongLength = 0;
  let weakSuits = 0;
  for (const suit of SIDE_SUITS) {
    const cards = hand.filter((c) => c.suit === suit);
    if (cards.length === 0) continue;
    const best = Math.max(...cards.map((c) => aceHigh(c.rank)));
    if (best === 14 && cards.length >= rules.strongSideSuitLength && cards.length > strongLength) {
      strongSuit = suit;
      strongLength = cards.length;
    }
    if (best < rules.weakSuitBelowRank) weakSuits++;
  }
  const strongSideSuit = strongSuit !== null;

  return {
    topHearts,
    totalHearts: hearts.length,
    spadeControl,
    strongSideSuit,
    strongSuit,
    weakSuits,
    viable:
      topHearts >= rules.minTopHearts &&
      spadeControl &&
      (!checkStructure || (strongSideSuit && weakSuits <= rules.maxWeakSuits)),
  };
}
