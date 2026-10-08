/**
 * Deck construction and shuffling (#2986). The RNG is always passed in — each
 * engine keeps its own `createRngSlot` / `createSeededRng` (see
 * `_shared/seededRng.ts`), so there is no shared random state here.
 */

import type { RandomSource } from "../seededRng";
import { RANKS, SUITS, type PlayingCard } from "./types";

/** Ordered 52-card deck: suits in `SUITS` order, each Ace→King. Seeded deals depend on this order. */
export function createDeck(): PlayingCard[] {
  const deck: PlayingCard[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * Fisher-Yates in place against `rng`, drawing once per index from the end
 * down to 1. Returns the same array. The draw order is part of every seeded
 * deal (the backend `gen_*_seeds.py` scripts mirror it), so do not change it.
 */
export function fisherYates<T>(deck: T[], rng: RandomSource): T[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = deck[i];
    const b = deck[j];
    if (a !== undefined && b !== undefined) {
      deck[i] = b;
      deck[j] = a;
    }
  }
  return deck;
}
