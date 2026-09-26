/**
 * Determinization for the PIMC engine (#2587): sample complete deals of the
 * cards a player can't see, consistent with everything it knows.
 *
 * What the acting player knows (`dealConstraints`):
 * - its own hand and every card already played (`seenKeys`);
 * - how many cards each opponent still holds (public: tricks played and who
 *   has played to the current trick);
 * - suits each opponent is known void in (`voidLedger`);
 * - the cards it passed and to whom (#2237): until played, the recipient
 *   holds them.
 *
 * `DealSampler` draws uniformly from *every* deal that fits — exactly. The
 * #2240 spike's sampler assigned cards one at a time (most constrained suit
 * first, then a random eligible opponent), which is a feasibility heuristic,
 * not a uniform sampler: it lost to plain uniform-random deals by 8pp, most
 * likely from that bias. Here, the number of valid deals is counted per
 * suit split (a small dynamic programme over the opponents' remaining
 * capacities: at most 14 × 14 states per suit), and a deal is drawn by
 * picking each suit's split in proportion to the deals it leads to, then
 * shuffling that suit's cards into it.
 *
 * Pure: randomness comes from the `rng` passed in, never the engine's RNG.
 */

import type { HeartsInfoSet } from "../aiInfoSet";
import type { Card, HeartsState, Suit } from "../types";
import { RANKS, SUITS } from "../types";

const key = (c: Card): string => `${c.suit}:${c.rank}`;

/** What a seat knows about the cards it can't see. */
export interface DealConstraints {
  /** The acting seat. */
  readonly seat: number;
  /** The three opponents, in seat order. */
  readonly opponents: readonly [number, number, number];
  /** Unseen cards not pinned to anyone, by suit (SUITS order). */
  readonly unknown: readonly (readonly Card[])[];
  /** Cards known to be in each seat's hand (index = seat; the acting seat's own hand included). */
  readonly pinned: readonly (readonly Card[])[];
  /** Free slots per opponent after its pinned cards (index = position in `opponents`). */
  readonly capacity: readonly [number, number, number];
  /** voids[j][s]: opponent j is known void in suit s (SUITS order). */
  readonly voids: readonly (readonly boolean[])[];
}

/** Each seat's remaining hand size, from public trick progress only. */
function handSizes(state: HeartsState): number[] {
  const atTrickStart = 13 - state.tricksPlayedInHand;
  const played = new Set(state.currentTrick.map((t) => t.playerIndex));
  return [0, 1, 2, 3].map((p) => (played.has(p) ? atTrickStart - 1 : atTrickStart));
}

/**
 * The constraints a seat's own information imposes. With `useInference`
 * false, voids and pass memory are ignored — only hand sizes (the ablation
 * arm, "uniform").
 */
export function dealConstraints(
  state: HeartsState,
  info: HeartsInfoSet,
  useInference = true
): DealConstraints {
  const seat = info.playerIndex;
  const opponents = [0, 1, 2, 3].filter((p) => p !== seat) as unknown as [number, number, number];
  const own = new Set(info.hand.map(key));
  const pinned: Card[][] = [[], [], [], []];
  pinned[seat] = [...info.hand];
  const pinnedKeys = new Set<string>();
  if (useInference && info.passedToPlayerIndex !== null) {
    for (const c of info.passedCards) {
      if (info.seenKeys.has(key(c))) continue; // already played
      pinned[info.passedToPlayerIndex]!.push(c);
      pinnedKeys.add(key(c));
    }
  }
  const unknown: Card[][] = SUITS.map(() => []);
  SUITS.forEach((suit, s) => {
    for (const rank of RANKS) {
      const c: Card = { suit, rank };
      const k = key(c);
      if (!own.has(k) && !info.seenKeys.has(k) && !pinnedKeys.has(k)) unknown[s]!.push(c);
    }
  });
  const sizes = handSizes(state);
  const capacity = opponents.map((p) => sizes[p]! - pinned[p]!.length) as unknown as [
    number,
    number,
    number,
  ];
  const voids = opponents.map((p) =>
    SUITS.map((suit: Suit) => useInference && info.voidLedger[p]?.[suit] === true)
  );
  return { seat, opponents, unknown, pinned, capacity, voids };
}

const LOG_FACT: number[] = [0];
for (let n = 1; n <= 52; n++) LOG_FACT[n] = LOG_FACT[n - 1]! + Math.log(n);

/** Ways to deal k distinct cards as a0 / a1 / a2: k! / (a0! a1! a2!). */
function multinomial(k: number, a0: number, a1: number, a2: number): number {
  return Math.exp(LOG_FACT[k]! - LOG_FACT[a0]! - LOG_FACT[a1]! - LOG_FACT[a2]!);
}

/** Uniform sampling over every deal consistent with a set of constraints. */
export class DealSampler {
  private readonly memo = new Map<number, number>();
  /** Cards still to deal from suit s onwards. */
  private readonly tail: number[];
  /** Number of consistent deals (a float: it can exceed 2^53). 0 means the constraints contradict. */
  readonly count: number;

  constructor(readonly constraints: DealConstraints) {
    const n = constraints.unknown.map((cards) => cards.length);
    this.tail = [0, 0, 0, 0, 0];
    for (let s = 3; s >= 0; s--) this.tail[s] = this.tail[s + 1]! + n[s]!;
    const [c0, c1, c2] = constraints.capacity;
    this.count =
      c0 >= 0 && c1 >= 0 && c2 >= 0 && c0 + c1 + c2 === this.tail[0] ? this.ways(0, c0, c1) : 0;
  }

  /** Deals of suits s.. with r0 / r1 free slots left for opponents 0 / 1 (opponent 2 takes the rest). */
  private ways(s: number, r0: number, r1: number): number {
    const r2 = this.tail[s]! - r0 - r1;
    if (s === 4) return r0 === 0 && r1 === 0 && r2 === 0 ? 1 : 0;
    const id = (s * 16 + r0) * 16 + r1;
    const hit = this.memo.get(id);
    if (hit !== undefined) return hit;
    let total = 0;
    for (const [a0, a1, a2] of this.splits(s, r0, r1, r2)) {
      total += multinomial(a0 + a1 + a2, a0, a1, a2) * this.ways(s + 1, r0 - a0, r1 - a1);
    }
    this.memo.set(id, total);
    return total;
  }

  /** Every legal way to split suit s among the opponents, given their free slots. */
  private *splits(
    s: number,
    r0: number,
    r1: number,
    r2: number
  ): Generator<[number, number, number]> {
    const k = this.constraints.unknown[s]!.length;
    const v = this.constraints.voids;
    for (let a0 = 0; a0 <= Math.min(k, r0); a0++) {
      if (a0 > 0 && v[0]![s]) break;
      for (let a1 = 0; a1 <= Math.min(k - a0, r1); a1++) {
        if (a1 > 0 && v[1]![s]) break;
        const a2 = k - a0 - a1;
        if (a2 > r2 || (a2 > 0 && v[2]![s])) continue;
        yield [a0, a1, a2];
      }
    }
  }

  /**
   * One deal: every seat's full hand (the acting seat's own hand included).
   * Throws if the constraints contradict (`count` is 0).
   */
  sample(rng: () => number): Card[][] {
    if (this.count <= 0) throw new Error("DealSampler: no deal fits the constraints");
    const { opponents, unknown, pinned } = this.constraints;
    const hands = pinned.map((h) => [...h]);
    let [r0, r1] = this.constraints.capacity;
    for (let s = 0; s < 4; s++) {
      const r2 = this.tail[s]! - r0! - r1!;
      const options = [...this.splits(s, r0!, r1!, r2)];
      const weights = options.map(
        ([a0, a1, a2]) =>
          multinomial(a0 + a1 + a2, a0, a1, a2) * this.ways(s + 1, r0! - a0, r1! - a1)
      );
      let r = rng() * weights.reduce((a, b) => a + b, 0);
      let pick = options.length - 1;
      for (let i = 0; i < options.length; i++) {
        r -= weights[i]!;
        if (r < 0) {
          pick = i;
          break;
        }
      }
      const [a0, a1] = options[pick]!;
      const cards = shuffle(unknown[s]!, rng);
      hands[opponents[0]]!.push(...cards.slice(0, a0));
      hands[opponents[1]]!.push(...cards.slice(a0, a0 + a1));
      hands[opponents[2]]!.push(...cards.slice(a0 + a1));
      r0 = r0! - a0;
      r1 = r1! - a1;
    }
    return hands;
  }
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
