/**
 * The conservative CPU's play procedures (#3159): docs/hearts/CONSERVATIVE_AI.md
 * §2.4 Leading / Following / Discarding, one function per procedure and one
 * block per numbered step. Legality comes only from the engine's
 * `getValidPlays`; every step chooses among those cards. No RNG.
 *
 * Attribution (§2.3): a decision is credited to the step that names the card.
 * Filter steps (lead 2, discard 1 and 4, follow 5's guard, follow 6b) only
 * remove candidates and get no credit. A single legal card has no principle.
 */

import { getValidPlays, isQueenOfSpades } from "../engine";
import type { Card, HeartsState } from "../types";
import {
  type PrincipleId,
  type View,
  above,
  below,
  canOvertake,
  first,
  guardHeart,
  has,
  highest,
  holdsQueen,
  isDangerous,
  isHighHeart,
  isSpadeHonour,
  label,
  lowest,
  moonComplete,
  moonThreat,
  mostDangerous,
  playersAfter,
  queenLive,
  queenOut,
  rankValue,
  suitOrder,
  trickPoints,
  viewOf,
  winning,
  without,
  xWinsOrCanOvertake,
} from "./terms";

export interface PlayDecision {
  readonly card: Card;
  /** The §2.4 step that named the card; null when only one card was legal. */
  readonly principle: PrincipleId | null;
  /** One plain-English sentence (developer-facing; not shown to players). */
  readonly reason: string;
}

const pick = (card: Card, principle: PrincipleId, reason: string): PlayDecision => ({
  card,
  principle,
  reason: `${label(card)}: ${reason}`,
});

/** The conservative CPU's card for `seat` (§2.3, §2.4). */
export function choosePlay(state: HeartsState, seat: number): PlayDecision {
  const legal = getValidPlays(state, seat);
  if (legal.length === 0) throw new Error(`conservative CPU: seat ${seat} has no legal play`);
  if (legal.length === 1) {
    return {
      card: legal[0]!,
      principle: null,
      reason: `${label(legal[0]!)}: the only legal card.`,
    };
  }
  const v = viewOf(state, seat);
  if (v.trick.length === 0) return lead(v, legal);
  const led = v.trick[0]!.card.suit;
  return legal.some((c) => c.suit === led) ? follow(v, legal) : discard(v, legal);
}

// ── Leading ─────────────────────────────────────────────────────────────────

function lead(v: View, legal: readonly Card[]): PlayDecision {
  // 1. P7: with a moon threat, lead G when no out heart can beat it.
  const g = guardHeart(v);
  if (moonThreat(v) !== null && g && has(legal, g) && above(v, g) === 0) {
    return pick(g, "P7-MOON-GUARD", "a sure-winning heart takes a point from the moon threat.");
  }

  // 2. P5 (filter): never lead Q♠, nor A♠/K♠ while Q♠ is live.
  let candidates = without(legal, (c) => isQueenOfSpades(c) || (queenLive(v) && isSpadeHonour(c)));
  if (candidates.length === 0) candidates = without(legal, isQueenOfSpades);

  // 3. P3: lead the most dangerous non-heart.
  const dangerous = candidates.filter((c) => c.suit !== "hearts" && isDangerous(v, c));
  if (dangerous.length > 0) {
    const card = mostDangerous(v, dangerous)!;
    return pick(card, "P3-SHED", "the most dangerous non-heart is led while it can still lose.");
  }

  // 4. P9: among cards an out card can beat, the fewest out cards below, then lowest rank.
  const beatable = candidates.filter((c) => above(v, c) >= 1);
  if (beatable.length > 0) {
    const card = first(
      beatable,
      (a, b) =>
        below(v, a) - below(v, b) || rankValue(a) - rankValue(b) || suitOrder(a) - suitOrder(b)
    )!;
    return pick(card, "P9-EXIT", "nothing is dangerous, so it exits with its surest loser.");
  }

  // 5. P9: every card would win; lead the lowest non-heart, else the lowest heart.
  const nonHearts = candidates.filter((c) => c.suit !== "hearts");
  const card = lowest(nonHearts.length > 0 ? nonHearts : candidates)!;
  return pick(card, "P9-EXIT", "every card would win, so it leads its lowest.");
}

// ── Following ───────────────────────────────────────────────────────────────

/** What every following step looks at: the led-suit cards, W and the players after. */
interface Follow {
  readonly v: View;
  /** The CPU's led-suit cards (following: every legal card). */
  readonly suit: readonly Card[];
  readonly w: { card: Card; seat: number };
  readonly after: number;
  readonly spadesLed: boolean;
}

function follow(v: View, legal: readonly Card[]): PlayDecision {
  const w = winning(v);
  const f: Follow = {
    v,
    suit: legal,
    w,
    after: playersAfter(v),
    spadesLed: w.card.suit === "spades",
  };
  return queenUnderHonour(f) ?? moonTake(f) ?? freeTrick(f) ?? duck(f) ?? forcedWin(f);
}

/** Steps 1-2: spades led, the CPU holds Q♠ and W is A♠/K♠. */
function queenUnderHonour({ v, suit, w, spadesLed }: Follow): PlayDecision | undefined {
  if (!spadesLed || !isSpadeHonour(w.card) || !holdsQueen(v)) return undefined;
  // 1. P7: never drop Q♠ when that completes X's moon.
  const complete = moonComplete(v);
  if (complete !== null && xWinsOrCanOvertake(v, complete)) {
    const card = highest(without(suit, isQueenOfSpades))!;
    return pick(card, "P7-MOON-GUARD", "dropping the queen here would complete the moon.");
  }
  // 2. P5: Q♠ cannot win; drop it.
  const queen = suit.find(isQueenOfSpades)!;
  return pick(queen, "P5-QUEEN", "the queen cannot win under a higher spade, so it goes now.");
}

/** Step 3, P7: take a pointed trick X is winning, as last player or with a certain winner. */
function moonTake({ v, suit, w, after, spadesLed }: Follow): PlayDecision | undefined {
  const x = moonThreat(v);
  if (x === null || w.seat !== x || trickPoints(v) === 0) return undefined;
  const shieldHonours = spadesLed && queenOut(v) && after >= 1;
  const h = highest(
    without(suit, (c) => isQueenOfSpades(c) || (shieldHonours && isSpadeHonour(c)))
  );
  if (h && rankValue(h) > rankValue(w.card) && (after === 0 || above(v, h) === 0)) {
    return pick(h, "P7-MOON-GUARD", "taking a point from the moon threat stops the moon.");
  }
  return undefined;
}

/** Step 4, P2: trick 1, or last to a trick with no points, is free: shed the highest. */
function freeTrick({ v, suit, after }: Follow): PlayDecision | undefined {
  if (v.trickNumber !== 1 && !(after === 0 && trickPoints(v) === 0)) return undefined;
  const card = highest(without(suit, isQueenOfSpades)) ?? suit[0]!;
  return pick(card, "P2-FREE-TRICK", "the trick cannot hold points, so it sheds its highest.");
}

/** Step 5, P1: duck with the highest card that still loses (P7 filter keeps G first). */
function duck({ v, suit, w }: Follow): PlayDecision | undefined {
  let losers = suit.filter((c) => rankValue(c) < rankValue(w.card));
  if (losers.length === 0) return undefined;
  const x = moonThreat(v);
  const g = guardHeart(v);
  if (x !== null && canOvertake(v, x) && g && has(losers, g) && losers.length >= 2) {
    losers = without(losers, (c) => c.suit === g.suit && c.rank === g.rank);
  }
  return pick(highest(losers)!, "P1-DUCK", "the highest card that still loses the trick.");
}

/** Step 6: every led-suit card beats W. */
function forcedWin({ v, suit, after, spadesLed }: Follow): PlayDecision {
  // a. Candidates: the led-suit cards other than Q♠.
  let candidates = without(suit, isQueenOfSpades);
  // b. P5 (filter): no A♠/K♠ where another player could drop Q♠ on it.
  if (spadesLed && after >= 1 && queenOut(v)) {
    const safe = without(candidates, isSpadeHonour);
    if (safe.length === 0) {
      const card = lowest(candidates.filter(isSpadeHonour))!;
      return pick(card, "P5-QUEEN", "it must win; the lower spade honour gives the queen less.");
    }
    candidates = safe;
  }
  // c. P1: win with the highest.
  return pick(highest(candidates)!, "P1-DUCK", "it cannot lose, so it wins with its highest card.");
}

// ── Discarding ──────────────────────────────────────────────────────────────

function discard(v: View, legal: readonly Card[]): PlayDecision {
  let candidates: Card[] = [...legal];

  // 1. P7 (filter): no Q♠ on a trick that would complete X's moon.
  const complete = moonComplete(v);
  if (complete !== null && xWinsOrCanOvertake(v, complete)) {
    candidates = without(candidates, isQueenOfSpades);
  }

  // 2. P5: the queen, the first time it cannot win.
  const queen = candidates.find(isQueenOfSpades);
  if (queen) return pick(queen, "P5-QUEEN", "void in the led suit, it sheds the queen.");

  // 3. P5: A♠, then K♠, while Q♠ is live.
  if (queenLive(v)) {
    for (const rank of [1, 13] as const) {
      const card = candidates.find((c) => c.suit === "spades" && c.rank === rank);
      if (card) return pick(card, "P5-QUEEN", "a spade honour attracts the unplayed queen.");
    }
  }

  // 4. P7 (filter): keep G while there is a moon threat.
  const g = guardHeart(v);
  if (moonThreat(v) !== null && g && candidates.length > 1) {
    candidates = without(candidates, (c) => c.suit === g.suit && c.rank === g.rank);
  }

  // 5. P6: the highest HIGH heart.
  const highHeart = highest(candidates.filter((c) => isHighHeart(v, c)));
  if (highHeart) return pick(highHeart, "P6-DISCARD", "its highest high heart goes next.");

  // 6. P6 (via P4): the most dangerous card.
  const card = mostDangerous(v, candidates)!;
  return pick(card, "P6-DISCARD", "the card most likely to be forced to win later.");
}
