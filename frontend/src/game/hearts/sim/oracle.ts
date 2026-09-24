/**
 * Hearts reference evaluator for the regret metric (#2239).
 *
 * The AI plays from its own hand only (`HeartsInfoSet`). The harness deals
 * every hand, so after the fact it can grade a decision with all four hands
 * visible — chess's "average centipawn loss", with a perfect-information
 * rollout standing in for the engine.
 *
 * For a decision, `evaluatePlays` tries every legal card on the true state and
 * finishes the hand with `rolloutPlay` for all four seats. A card's cost is the
 * acting seat's moon-adjusted hand score minus the table's mean (`handCost`):
 * without a moon that is its own points − 6.5, so differences between cards
 * are plain points (Q♠ = 13, a heart = 1); a moon counts −19.5 for the
 * shooter and +6.5 for everyone else, the swing it makes to the standings.
 *
 * Independence: this module imports the engine's rules only — nothing from
 * ai.ts, aiConsiderations.ts or aiWeights.ts — so the reference never shares
 * a heuristic, weight or bug with the policies it grades. It is deliberately
 * simple (a greedy one-card lookahead over a greedy rollout, not a search):
 * #2239 asks for a reference meaningfully stronger than the AI, which perfect
 * information plus lookahead gives, not an optimal one. Each card's value is
 * an average of sampled rollouts (`DEFAULT_ORACLE_CONFIG`), so an individual
 * decision's regret is an estimate; averages over thousands of decisions are
 * what the report reads.
 *
 * Pure and repeatable: the randomized rollouts draw from a private generator
 * seeded by the cards in play — never the engine's RNG — and there is no
 * clock, so the same decision always gets the same values.
 */

import { getValidPlays, isQueenOfSpades, playCard } from "../engine";
import type { Card, HeartsState } from "../types";

const hi = (c: Card): number => (c.rank === 1 ? 14 : c.rank);
const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
const highest = (cards: readonly Card[]): Card =>
  cards.reduce((best, c) => (hi(c) > hi(best) ? c : best));
const lowest = (cards: readonly Card[]): Card =>
  cards.reduce((best, c) => (hi(c) < hi(best) ? c : best));

function points(c: Card): number {
  if (c.suit === "hearts") return 1;
  return isQueenOfSpades(c) ? 13 : 0;
}

/** Whether another seat still holds Q♠ (it has been neither played nor dealt to `seat`). */
function queenOutElsewhere(state: HeartsState, seat: number): boolean {
  return state.playerHands.some((h, i) => i !== seat && h.some(isQueenOfSpades));
}

/** Rollout tuning: the moon commitment threshold, and how many randomized rollouts to average. */
export interface OracleConfig {
  /** Points a lone point-holder must have before rollouts play the moon out. */
  readonly moonCommit: number;
  /** Rollouts averaged per card (1 = the single greedy rollout). */
  readonly rollouts: number;
  /** In rollouts after the first, the chance each play is a uniform legal card. */
  readonly epsilon: number;
}

/**
 * 16 rollouts at ε 0.2: a player that plays this reference's best card wins
 * 73% of games against a Schemer field, where Daring wins 34% (seed 2238,
 * 100 blocks; docs/TESTING.md). In a 20-block pilot on the same field, one
 * greedy rollout alone managed 49% and 8 rollouts at ε 0.15 72.5%.
 */
export const DEFAULT_ORACLE_CONFIG: OracleConfig = { moonCommit: 10, rollouts: 16, epsilon: 0.2 };

/** The seat holding every point taken so far, if it holds at least `min` of them. */
function loneShooter(state: HeartsState, min: number): number | null {
  let shooter: number | null = null;
  for (let i = 0; i < 4; i++) {
    if ((state.handScores[i] ?? 0) === 0) continue;
    if (shooter !== null) return null;
    shooter = i;
  }
  return shooter !== null && (state.handScores[shooter] ?? 0) >= min ? shooter : null;
}

/** Current winner of a non-empty trick. */
function trickWinner(state: HeartsState): { seat: number; rank: number } {
  const trick = state.currentTrick;
  const led = trick[0]!.card.suit;
  let seat = trick[0]!.playerIndex;
  let rank = hi(trick[0]!.card);
  for (const t of trick) {
    if (t.card.suit === led && hi(t.card) > rank) {
      rank = hi(t.card);
      seat = t.playerIndex;
    }
  }
  return { seat, rank };
}

/**
 * The rollout policy: a greedy player that sees every hand.
 *
 * - Moon: once a lone seat holds every point taken and at least
 *   `moonCommit` of them, it plays to win every trick (high leads and
 *   follows, low non-point discards) and the others play to take a point
 *   off it (their highest card when it is winning a trick with points;
 *   hearts discarded only onto someone else's trick).
 * - Otherwise: follow with the highest card that still loses (the highest
 *   card when last and forced to win, never Q♠ by choice); discard Q♠, then
 *   A♠/K♠ while Q♠ is out, then the highest heart, then the highest card;
 *   lead the lowest card some opponent can beat, clear of A♠/K♠/Q♠ while Q♠
 *   is out.
 */
export function rolloutPlay(
  state: HeartsState,
  seat: number,
  config: OracleConfig = DEFAULT_ORACLE_CONFIG
): Card {
  const legal = getValidPlays(state, seat);
  if (legal.length === 1) return legal[0]!;
  const trick = state.currentTrick;
  const shooter = loneShooter(state, config.moonCommit);

  if (shooter === seat) {
    if (trick.length === 0) return highest(legal);
    if (legal[0]!.suit === trick[0]!.card.suit) return highest(legal);
    const junk = legal.filter((c) => points(c) === 0);
    return lowest(junk.length > 0 ? junk : legal);
  }

  if (trick.length === 0) {
    if (shooter !== null) return highest(legal);
    const qsOut = queenOutElsewhere(state, seat);
    const others = state.playerHands.filter((_, i) => i !== seat).flat();
    const beatable = legal.filter(
      (c) =>
        !(c.suit === "spades" && hi(c) >= 12 && (qsOut || isQueenOfSpades(c))) &&
        others.some((o) => o.suit === c.suit && hi(o) > hi(c))
    );
    return lowest(beatable.length > 0 ? beatable : legal);
  }

  const led = trick[0]!.card.suit;
  const winner = trickWinner(state);
  if (legal[0]!.suit === led) {
    if (shooter !== null && winner.seat === shooter) {
      const over = legal.filter((c) => hi(c) > winner.rank);
      if (over.length > 0) return highest(over);
    }
    const losers = legal.filter((c) => hi(c) < winner.rank);
    if (losers.length > 0) return highest(losers);
    if (trick.length === 3) {
      const safe = legal.filter((c) => !isQueenOfSpades(c));
      return highest(safe.length > 0 ? safe : legal);
    }
    return lowest(legal);
  }

  if (shooter !== null && winner.seat === shooter) {
    const junk = legal.filter((c) => points(c) === 0);
    if (junk.length > 0) return highest(junk);
  }
  const queen = legal.find(isQueenOfSpades);
  if (queen) return queen;
  if (queenOutElsewhere(state, seat)) {
    const bigSpades = legal.filter((c) => c.suit === "spades" && hi(c) > 12);
    if (bigSpades.length > 0) return highest(bigSpades);
  }
  const hearts = legal.filter((c) => c.suit === "hearts");
  return highest(hearts.length > 0 ? hearts : legal);
}

/**
 * Each seat's hand cost once a hand is complete: its moon-adjusted score
 * minus the mean of all four (lower is better). `wonCards` holds every card
 * taken this hand.
 */
export function handCost(wonCards: readonly (readonly Card[])[]): number[] {
  const raw = wonCards.map((cards) => cards.reduce((s, c) => s + points(c), 0));
  const shooter = raw.indexOf(26);
  const scored = shooter >= 0 ? raw.map((_, i) => (i === shooter ? 0 : 26)) : raw;
  const mean = scored.reduce((a, b) => a + b, 0) / 4;
  return scored.map((s) => s - mean);
}

/** A small deterministic generator (mulberry32) for randomized rollouts. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Finish the current hand for every seat; returns `handCost`. With `rand`,
 * each play is a uniform legal card with probability `config.epsilon`.
 */
export function rolloutHand(
  state: HeartsState,
  config: OracleConfig = DEFAULT_ORACLE_CONFIG,
  rand?: () => number
): number[] {
  let s = state;
  while (s.phase === "playing" && s.tricksPlayedInHand < 13) {
    const seat = s.currentPlayerIndex;
    let card: Card;
    if (rand && rand() < config.epsilon) {
      const legal = getValidPlays(s, seat);
      card = legal[Math.floor(rand() * legal.length)]!;
    } else {
      card = rolloutPlay(s, seat, config);
    }
    s = playCard(s, seat, card);
  }
  return handCost(s.wonCards);
}

export interface PlayValue {
  readonly card: Card;
  /** The acting seat's hand cost after playing `card` (lower is better). */
  readonly cost: number;
}

/** A seed from the cards still in play, so a decision always gets the same rollouts. */
function stateSeed(state: HeartsState): number {
  let h = 2166136261;
  for (let seat = 0; seat < 4; seat++) {
    for (const c of state.playerHands[seat]!)
      h = Math.imul(h ^ (c.rank * 4 + c.suit.length + seat * 64), 16777619);
  }
  for (const t of state.currentTrick)
    h = Math.imul(h ^ (t.card.rank * 7 + t.playerIndex), 16777619);
  return h >>> 0;
}

/**
 * Every legal card for the seat to act, valued by perfect-information
 * rollouts: the greedy rollout, plus `rollouts − 1` randomized ones on
 * common random numbers (every card sees the same streams).
 */
export function evaluatePlays(
  state: HeartsState,
  config: OracleConfig = DEFAULT_ORACLE_CONFIG
): PlayValue[] {
  const seat = state.currentPlayerIndex;
  const seed = stateSeed(state);
  return getValidPlays(state, seat).map((card) => {
    const next = playCard(state, seat, card);
    let total = rolloutHand(next, config)[seat]!;
    for (let k = 1; k < config.rollouts; k++) {
      total += rolloutHand(next, config, stream(seed + k * 0x9e3779b9))[seat]!;
    }
    return { card, cost: total / config.rollouts };
  });
}

// ---------------------------------------------------------------------------
// Regret and blunder bands
// ---------------------------------------------------------------------------

/**
 * Regret thresholds in points (see docs/TESTING.md). A heart is 1 point and
 * Q♠ 13, so "minor" is a stray heart or two, "blunder" is Q♠- or moon-sized.
 */
export interface RegretBands {
  /** Upper bound (exclusive) of "minor". */
  readonly minor: number;
  /** Upper bound (exclusive) of "mistake"; this and above is "blunder". */
  readonly mistake: number;
}

export const DEFAULT_REGRET_BANDS: RegretBands = { minor: 3, mistake: 10 };

export type RegretBand = "optimal" | "minor" | "mistake" | "blunder";

export const REGRET_BANDS: readonly RegretBand[] = ["optimal", "minor", "mistake", "blunder"];

/**
 * `regret <= 0` is optimal with no epsilon: the played card's cost and the
 * best cost come from the same `evaluatePlays` array.
 */
export function bandForRegret(
  regret: number,
  bands: RegretBands = DEFAULT_REGRET_BANDS
): RegretBand {
  if (regret <= 0) return "optimal";
  if (regret < bands.minor) return "minor";
  if (regret < bands.mistake) return "mistake";
  return "blunder";
}

export interface DecisionRegret {
  readonly played: Card;
  readonly best: Card;
  /** Played card's cost − best card's cost, in points (≥ 0). */
  readonly regret: number;
  readonly band: RegretBand;
}

/** Grade one decision from already-computed play values. */
export function regretFromValues(
  values: readonly PlayValue[],
  played: Card,
  bands: RegretBands = DEFAULT_REGRET_BANDS
): DecisionRegret {
  const chosen = values.find((v) => same(v.card, played));
  if (!chosen) throw new Error(`regretFromValues: ${played.suit} ${played.rank} is not legal`);
  const best = values.reduce((b, v) => (v.cost < b.cost ? v : b));
  const regret = chosen.cost - best.cost;
  return { played, best: best.card, regret, band: bandForRegret(regret, bands) };
}

/** Grade the card the seat to act chose, against the perfect-information reference. */
export function decisionRegret(
  state: HeartsState,
  played: Card,
  bands: RegretBands = DEFAULT_REGRET_BANDS,
  config: OracleConfig = DEFAULT_ORACLE_CONFIG
): DecisionRegret {
  return regretFromValues(evaluatePlays(state, config), played, bands);
}
