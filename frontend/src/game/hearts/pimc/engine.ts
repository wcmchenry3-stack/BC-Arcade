/**
 * Hearts PIMC engine (#2587): Perfect-Information Monte Carlo over sampled
 * deals, the "strong engine" #2283 builds the difficulty levels from.
 *
 * For a decision the engine samples `samples` complete deals consistent with
 * what the player knows (`sampler.ts`), plays each legal card on each deal
 * and finishes the trick (`horizon: "trick"`) or the hand (`"hand"`) with
 * the utility AI as everyone's rollout policy. A card's value is its mean
 * cost over the deals; the cheapest card is played. Every card sees the
 * same deals (common random numbers), so the comparison between cards isn't
 * swamped by deal-to-deal noise.
 *
 * The #2240 spike (docs/HEARTS_PIMC_SPIKE.md) found +6.8pp win share for
 * this approach over the utility AI alone, with a biased sampler; this
 * version samples exactly.
 *
 * Rollouts are noise-free: ai.ts draws the engine RNG only for its noise
 * gate (`rng() < NOISE_RATE`), so rollouts run with the engine RNG pinned
 * just below 1 and the caller's RNG is restored afterwards.
 */

import { selectCardToPlay } from "../ai";
import { buildHeartsInfoSet } from "../aiInfoSet";
import { getRng, getValidPlays, playCard, setRng } from "../engine";
import type { AiPersona, Card, HeartsState } from "../types";
import { DealSampler, dealConstraints } from "./sampler";

export interface PimcConfig {
  /** Deals sampled per decision. */
  readonly samples: number;
  /** How far each rollout plays: the rest of the trick, or the rest of the hand. */
  readonly horizon: "trick" | "hand";
  /** Sample with voids and pass memory (true) or hand sizes only (false). */
  readonly inference: boolean;
  /** Whose play model the rollouts use for every seat. */
  readonly rolloutPersona: AiPersona;
}

/**
 * End-of-hand rollouts with inference, 32 deals a move. Measured against a
 * Schemer field on duplicate deals (docs/HEARTS_PIMC_SPIKE.md, #2587):
 * - vs Daring on the same cards: +21pp win share at 8 deals, +23pp at 16,
 *   +33pp at 32 (Node: 11 / 20 / 38 ms a move);
 * - 64 deals over 32: +4.2 ± 3.8pp — diminishing returns;
 * - inference (voids, pass memory) over hand sizes only: +4.5 ± 2.4pp,
 *   −0.27 ± 0.08 points a hand — with an exact sampler it helps, unlike the
 *   spike's biased one;
 * - trick-only rollouts are fast (1 ms) but weaker than Daring: they can't
 *   tell a high losing card from a low one, so they lose duck-high (#2236).
 * The on-device timing (debug panel) decides the final count.
 */
export const DEFAULT_PIMC_CONFIG: PimcConfig = {
  samples: 32,
  horizon: "hand",
  inference: true,
  rolloutPersona: "schemer",
};

export interface CardValue {
  readonly card: Card;
  /** Mean cost over the sampled deals (lower is better). */
  readonly cost: number;
}

const NO_NOISE = (): number => 0.999999;

function points(c: Card): number {
  if (c.suit === "hearts") return 1;
  return c.suit === "spades" && c.rank === 12 ? 13 : 0;
}

/**
 * The seat's cost once a hand is over: its moon-adjusted score minus the
 * table mean (a moon counts −19.5 for the shooter, +6.5 for the others).
 */
function handCost(wonCards: readonly (readonly Card[])[], seat: number): number {
  const raw = wonCards.map((cards) => cards.reduce((s, c) => s + points(c), 0));
  const shooter = raw.indexOf(26);
  const scored = shooter >= 0 ? raw.map((_, i) => (i === shooter ? 0 : 26)) : raw;
  return scored[seat]! - scored.reduce((a, b) => a + b, 0) / 4;
}

/** Play `card`, then roll out to the horizon; returns the seat's cost. */
function rollout(state: HeartsState, seat: number, card: Card, config: PimcConfig): number {
  const before = state.handScores[seat] ?? 0;
  const trickNo = state.tricksPlayedInHand;
  let s = playCard(state, seat, card);
  const done = (x: HeartsState) =>
    x.phase !== "playing" ||
    x.tricksPlayedInHand >= 13 ||
    (config.horizon === "trick" && x.tricksPlayedInHand > trickNo);
  while (!done(s)) {
    const p = s.currentPlayerIndex;
    const hand = [...(s.playerHands[p] ?? [])];
    s = playCard(s, p, selectCardToPlay(hand, [...s.currentTrick], s, p, config.rolloutPersona));
  }
  return config.horizon === "trick"
    ? (s.handScores[seat] ?? 0) - before
    : handCost(s.wonCards, seat);
}

/**
 * Every legal card for the seat to act, valued over sampled deals. `rng`
 * drives the sampling only; the engine RNG is left as it was found.
 */
export function pimcValues(
  state: HeartsState,
  config: PimcConfig = DEFAULT_PIMC_CONFIG,
  rng: () => number = Math.random
): CardValue[] {
  const seat = state.currentPlayerIndex;
  const legal = getValidPlays(state, seat);
  if (legal.length <= 1) return legal.map((card) => ({ card, cost: 0 }));

  const info = buildHeartsInfoSet(
    [...(state.playerHands[seat] ?? [])],
    [...state.currentTrick],
    state,
    seat
  );
  let sampler = new DealSampler(dealConstraints(state, info, config.inference));
  // Inference can only contradict itself if a void or pass inference is
  // wrong; fall back to hand sizes alone rather than failing the move.
  if (sampler.count <= 0) sampler = new DealSampler(dealConstraints(state, info, false));

  const totals = legal.map(() => 0);
  const outer = getRng();
  try {
    for (let i = 0; i < config.samples; i++) {
      const deal = { ...state, playerHands: sampler.sample(rng) };
      setRng(NO_NOISE);
      legal.forEach((card, j) => {
        totals[j] = totals[j]! + rollout(deal, seat, card, config);
      });
      setRng(outer);
    }
  } finally {
    setRng(outer);
  }
  return legal.map((card, j) => ({ card, cost: totals[j]! / config.samples }));
}

/** The engine's move: the legal card with the lowest mean cost (first on ties). */
export function pimcChooseCard(
  state: HeartsState,
  config: PimcConfig = DEFAULT_PIMC_CONFIG,
  rng: () => number = Math.random
): Card {
  const values = pimcValues(state, config, rng);
  return values.reduce((best, v) => (v.cost < best.cost ? v : best)).card;
}
