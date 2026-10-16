/**
 * Simulator-only opponents for the whole-game report (#3162). They live in
 * tooling, not app code: neither is a persona the app plays.
 *
 * - `randomLegalPolicy`: a uniformly random legal card, and a random pass.
 *   The sanity baseline: any real strategy must beat it. It draws from the
 *   engine's RNG, which the harness switches to the seat's own seeded noise
 *   stream before every decision, so games replay exactly.
 * - `moonShooterPolicy`: always tries to take every point. It keeps high
 *   hearts, Q♠, K♠ and the aces when passing, leads and follows with its
 *   highest legal card to win tricks, and dumps its lowest non-point card
 *   when it cannot follow. No RNG.
 */

import { getRng, getValidPlays, isQueenOfSpades } from "../../src/game/hearts/engine";
import type { Card } from "../../src/game/hearts/types";
import type { HeartsPolicy } from "./harness";

/** Ace-high rank, 2..14. */
const high = (c: Card): number => (c.rank === 1 ? 14 : c.rank);

const isPoint = (c: Card): boolean => c.suit === "hearts" || isQueenOfSpades(c);

export function randomLegalPolicy(): HeartsPolicy {
  return {
    label: "random-legal",
    pass: (hand) => {
      const rest = [...hand];
      const out: Card[] = [];
      for (let i = 0; i < 3; i++) {
        out.push(rest.splice(Math.floor(getRng()() * rest.length), 1)[0]!);
      }
      return out;
    },
    play: (_hand, _trick, state, seat) => {
      const legal = getValidPlays(state, seat);
      return legal[Math.min(legal.length - 1, Math.floor(getRng()() * legal.length))]!;
    },
  };
}

export function moonShooterPolicy(): HeartsPolicy {
  /** Cards that win tricks or score: kept when passing. */
  const keep = (c: Card): boolean =>
    high(c) === 14 ||
    isQueenOfSpades(c) ||
    (c.suit === "hearts" && high(c) >= 9) ||
    (c.suit === "spades" && high(c) >= 13);
  return {
    label: "moon-shooter",
    pass: (hand) =>
      [...hand].sort((a, b) => Number(keep(a)) - Number(keep(b)) || high(a) - high(b)).slice(0, 3),
    play: (_hand, trick, state, seat) => {
      const legal = getValidPlays(state, seat);
      const led = trick[0]?.card.suit;
      if (trick.length === 0 || legal.every((c) => c.suit === led)) {
        // Lead or follow: the highest card wins the most tricks (hearts first on a tie).
        return [...legal].sort(
          (a, b) => high(b) - high(a) || Number(b.suit === "hearts") - Number(a.suit === "hearts")
        )[0]!;
      }
      // Cannot follow: keep the points, throw the lowest non-point card.
      return [...legal].sort(
        (a, b) => Number(isPoint(a)) - Number(isPoint(b)) || high(a) - high(b)
      )[0]!;
    },
  };
}
