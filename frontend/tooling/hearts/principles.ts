/**
 * Hearts principle checker (#3161, epic #3156) — the sim gate's per-decision
 * check of the conservative CPU against docs/hearts/CONSERVATIVE_AI.md.
 *
 * Given one decision — what the acting seat saw (its hand, the trick so far,
 * the completed tricks, points per seat, trick number, hearts broken) and the
 * card it chose; for a pass, its 13-card pre-pass hand and the 3 cards it
 * passed — `checkDecision` returns the principle the choice breaks, if any.
 *
 * How it decides: it walks the §2.4 procedure for the decision (Leading,
 * Following, Discarding or Passing) step by step, in the doc's priority
 * order (§2.3). The first step that names a card is the one the choice is
 * judged by, so a lower-priority principle never flags a play that a higher
 * one required. A choice that breaks that step is one violation, filed under
 * one of two kinds of check (`CHECKS` lists them all):
 *
 * - **predicate** checks flag a property of the chosen card that the
 *   principle forbids, whatever the exact expected card is: following trick 1
 *   below the highest legal club (P2), playing over the winning card while
 *   holding a card that would lose (P1), Q♠ into a trick it wins (P5), A♠/K♠
 *   led while Q♠ is live (P5), not discarding a legal Q♠ (P5), spending the
 *   guard heart during a moon threat (P7), Q♠ dropped where it completes a
 *   moon (P7), keeping or passing Q♠/A♠/K♠ against the spade protection
 *   rule (P5).
 * - **procedure** checks require the chosen card to equal the card the step
 *   names, computed by this module's own small implementation of §2.4: the
 *   P3/P9 lead order, the P6 discard order, the P1 "highest loser" / "highest
 *   winner", the P7 guard plays, the P8 pass.
 *
 * Blame: `principleId` is the principle whose rule the choice breaks (a
 * P5 or P7 filter step counts: leading Q♠ is a P5 violation). `attributedTo`
 * is the §2.3 attribution of the expected card — the principle of the §2.4
 * step that names it — and is what the rulebook's `principle` field holds, so
 * a reported position pastes straight into the rulebook (`toRulebookYaml`).
 *
 * Independence: like oracle.ts, this module imports only the engine's rules
 * and types — nothing from ai.ts, aiConsiderations.ts, aiWeights.ts or
 * conservative/ — so it never shares a bug with the CPU it checks
 * (principles.test.ts enforces this by scanning the imports). It was
 * written from the doc alone.
 */

import { getValidPlays } from "../../src/game/hearts/engine";
import type {
  Card,
  HeartsState,
  PassDirection,
  Suit,
  TrickCard,
} from "../../src/game/hearts/types";

// ---------------------------------------------------------------------------
// Decisions and violations
// ---------------------------------------------------------------------------

export type PrincipleId =
  | "P1-DUCK"
  | "P2-FREE-TRICK"
  | "P3-SHED"
  | "P5-QUEEN"
  | "P6-DISCARD"
  | "P7-MOON-GUARD"
  | "P8-PASS"
  | "P9-EXIT";

/** A completed trick: its leader and the cards in play order. */
export interface CompletedTrick {
  readonly lead: number;
  readonly cards: readonly Card[];
}

/** A card play, as the acting seat saw it (§3) plus its choice. */
export interface PlayDecision {
  readonly kind: "play";
  readonly seat: number;
  /** 1–13. */
  readonly trickNumber: number;
  readonly hand: readonly Card[];
  /** Completed tricks this hand, in order. */
  readonly played: readonly CompletedTrick[];
  /** The current trick so far, in play order. */
  readonly trick: readonly TrickCard[];
  readonly heartsBroken: boolean;
  /** Points taken this hand per seat, from completed tricks only. */
  readonly points: readonly number[];
  readonly chosen: Card;
}

/** A pass: the 13 cards dealt and the 3 passed. */
export interface PassDecision {
  readonly kind: "pass";
  readonly seat: number;
  readonly direction: PassDirection;
  readonly hand: readonly Card[];
  readonly chosen: readonly Card[];
}

export type Decision = PlayDecision | PassDecision;

export type CheckKind = "predicate" | "procedure";

export interface Violation {
  /** Which check fired (a key of `CHECKS`). */
  readonly check: CheckId;
  readonly kind: CheckKind;
  /** The principle whose rule the choice breaks. */
  readonly principleId: PrincipleId;
  /** §2.3 attribution of the expected card (the rulebook `principle`). */
  readonly attributedTo: PrincipleId;
  /** The card (or 3 pass cards) §2.4 names. */
  readonly expected: Card | readonly Card[];
  readonly chosen: Card | readonly Card[];
  readonly position: Decision;
  /** One plain-English sentence. */
  readonly reason: string;
}

interface CheckSpec {
  readonly kind: CheckKind;
  readonly principle: PrincipleId;
  /** What the check flags. */
  readonly description: string;
}

/** Every check this module can report. The docs (TESTING.md) mirror this list. */
export const CHECKS = {
  "lead.moon-guard": {
    kind: "procedure",
    principle: "P7-MOON-GUARD",
    description: "Moon threat and its highest heart cannot be beaten, but it did not lead it.",
  },
  "lead.queen": {
    kind: "predicate",
    principle: "P5-QUEEN",
    description: "Led Q♠ while it had another legal card.",
  },
  "lead.spade-honour": {
    kind: "predicate",
    principle: "P5-QUEEN",
    description: "Led A♠ or K♠ while Q♠ was live and it had another legal card.",
  },
  "lead.shed": {
    kind: "procedure",
    principle: "P3-SHED",
    description: "Held a DANGEROUS non-heart but did not lead the most dangerous one.",
  },
  "lead.exit": {
    kind: "procedure",
    principle: "P9-EXIT",
    description: "Nothing dangerous to lead, and it did not lead the card least likely to win.",
  },
  "follow.moon-complete-queen": {
    kind: "predicate",
    principle: "P7-MOON-GUARD",
    description: "Dropped Q♠ under A♠/K♠ on a trick X could take when that completes X's moon.",
  },
  "follow.moon-complete-cover": {
    kind: "procedure",
    principle: "P7-MOON-GUARD",
    description: "Kept Q♠ in the moon-complete case but did not play its highest other spade.",
  },
  "follow.queen-under-honour": {
    kind: "predicate",
    principle: "P5-QUEEN",
    description: "A♠/K♠ was winning a spade trick and it did not drop Q♠.",
  },
  "follow.moon-guard-take": {
    kind: "procedure",
    principle: "P7-MOON-GUARD",
    description:
      "Moon threat, X winning a trick with points, and it could take it safely, but it did not.",
  },
  "follow.free-trick": {
    kind: "predicate",
    principle: "P2-FREE-TRICK",
    description:
      "On a free trick (trick 1, or last seat with no points) it did not play its highest led-suit card other than Q♠.",
  },
  "follow.over-when-could-duck": {
    kind: "predicate",
    principle: "P1-DUCK",
    description: "Played over the winning card while it held a led-suit card that would lose.",
  },
  "follow.moon-guard-keep": {
    kind: "predicate",
    principle: "P7-MOON-GUARD",
    description:
      "Moon threat and X can still overtake, but it ducked with its guard heart while it had another loser.",
  },
  "follow.duck-highest": {
    kind: "procedure",
    principle: "P1-DUCK",
    description: "Ducked, but not with the highest card that loses.",
  },
  "follow.queen-into-win": {
    kind: "predicate",
    principle: "P5-QUEEN",
    description: "Played Q♠ into a trick it was winning while it held another legal card.",
  },
  "follow.spade-honour-under-queen": {
    kind: "predicate",
    principle: "P5-QUEEN",
    description:
      "Won a spade trick with A♠/K♠ while Q♠ was out and could still drop on it, holding another spade.",
  },
  "follow.win-highest": {
    kind: "procedure",
    principle: "P1-DUCK",
    description: "Could not lose the trick, and did not win with its highest allowed card.",
  },
  "discard.moon-complete-queen": {
    kind: "predicate",
    principle: "P7-MOON-GUARD",
    description: "Discarded Q♠ onto a trick X could take when that completes X's moon.",
  },
  "discard.queen": {
    kind: "predicate",
    principle: "P5-QUEEN",
    description: "Void, holding a legal Q♠, and discarded something else.",
  },
  "discard.spade-honour": {
    kind: "procedure",
    principle: "P5-QUEEN",
    description: "Void, Q♠ live, and it did not discard A♠ (then K♠).",
  },
  "discard.moon-guard-keep": {
    kind: "predicate",
    principle: "P7-MOON-GUARD",
    description: "Moon threat, and it discarded its guard heart.",
  },
  "discard.high-heart": {
    kind: "procedure",
    principle: "P6-DISCARD",
    description: "Did not discard its highest HIGH heart.",
  },
  "discard.most-dangerous": {
    kind: "procedure",
    principle: "P6-DISCARD",
    description: "Did not discard its most dangerous card.",
  },
  "pass.queen-spades": {
    kind: "predicate",
    principle: "P5-QUEEN",
    description:
      "Kept Q♠/A♠/K♠ with spades unprotected, or passed one with spades protected (P5 inside P8).",
  },
  "pass.order": {
    kind: "procedure",
    principle: "P8-PASS",
    description: "Did not pass the first three cards of the P8 list.",
  },
} as const satisfies Record<string, CheckSpec>;

export type CheckId = keyof typeof CHECKS;

// ---------------------------------------------------------------------------
// Cards (§2.1)
// ---------------------------------------------------------------------------

/** Rank value: A = 14. */
const rv = (c: Card): number => (c.rank === 1 ? 14 : c.rank);
const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
const has = (cards: readonly Card[], c: Card): boolean => cards.some((x) => same(x, c));
const without = (cards: readonly Card[], drop: readonly Card[]): Card[] =>
  cards.filter((c) => !has(drop, c));

const QS: Card = { suit: "spades", rank: 12 };
const KS: Card = { suit: "spades", rank: 13 };
const AS: Card = { suit: "spades", rank: 1 };
const isQS = (c: Card): boolean => same(c, QS);

/** Suit tie-break: ♣, ♦, ♠, ♥ — the first in this order wins a tie. */
const SUIT_ORDER: Readonly<Record<Suit, number>> = { clubs: 0, diamonds: 1, spades: 2, hearts: 3 };

/** Highest / lowest by rank value, ties (different suits) to the suit tie-break. */
function highest(cards: readonly Card[]): Card {
  return [...cards].sort((a, b) => rv(b) - rv(a) || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit])[0]!;
}
function lowest(cards: readonly Card[]): Card {
  return [...cards].sort((a, b) => rv(a) - rv(b) || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit])[0]!;
}

const ALL_CARDS: readonly Card[] = (["clubs", "diamonds", "spades", "hearts"] as const).flatMap(
  (suit) => ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const).map((rank) => ({ suit, rank }))
);

const points = (c: Card): number => (c.suit === "hearts" ? 1 : isQS(c) ? 13 : 0);

/** The §2.1 card terms, judged against the cards out from one seat's view. */
class View {
  readonly out: readonly Card[];

  constructor(
    readonly hand: readonly Card[],
    played: readonly Card[]
  ) {
    this.out = ALL_CARDS.filter((c) => !has(hand, c) && !has(played, c));
  }

  below(c: Card): number {
    return this.out.filter((o) => o.suit === c.suit && rv(o) < rv(c)).length;
  }
  above(c: Card): number {
    return this.out.filter((o) => o.suit === c.suit && rv(o) > rv(c)).length;
  }
  isLow(c: Card): boolean {
    return this.below(c) <= 3;
  }
  guarded(suit: Suit): boolean {
    const cards = this.hand.filter((c) => c.suit === suit);
    const low = cards.filter((c) => this.isLow(c)).length;
    return low >= 2 && low >= cards.length - low;
  }
  dangerous(c: Card): boolean {
    return !this.isLow(c) && !this.guarded(c.suit);
  }
  highHeart(c: Card): boolean {
    return c.suit === "hearts" && !this.isLow(c) && this.above(c) <= 3;
  }
  /** The first card in danger order. */
  mostDangerous(cards: readonly Card[]): Card {
    const key = (c: Card) => [this.dangerous(c) ? 1 : 0, this.below(c), rv(c)];
    return [...cards].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
      return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    })[0]!;
  }
}

// ---------------------------------------------------------------------------
// §2.4 procedures
// ---------------------------------------------------------------------------

/**
 * What §2.4 says about one decision: the card(s) it names, the principle
 * credited (§2.3), the check a different choice fails, and — for filter
 * steps — cards that would be a violation of their own.
 */
export interface Prescription {
  readonly expected: Card | readonly Card[];
  readonly attributedTo: PrincipleId;
  /** The step's check for any choice other than `expected`. */
  readonly check: CheckId;
  /** Filter checks: choosing one of these cards fails that check first. */
  readonly forbidden?: readonly { readonly cards: readonly Card[]; readonly check: CheckId }[];
  /** Step-specific predicate: a choice matching it fails `check` with this check id instead. */
  readonly refine?: (chosen: Card) => CheckId | null;
}

/** The state `getValidPlays` needs for a play decision (only the acting seat's hand is known). */
function stateFor(d: PlayDecision): HeartsState {
  const playerHands: Card[][] = [[], [], [], []];
  playerHands[d.seat] = [...d.hand];
  return {
    _v: 3,
    aiDifficulty: "conservative",
    phase: "playing",
    handNumber: 1,
    passDirection: "left",
    playerHands,
    cumulativeScores: [0, 0, 0, 0],
    handScores: [...d.points],
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: true,
    currentTrick: [...d.trick],
    currentLeaderIndex: d.trick[0]?.playerIndex ?? d.seat,
    currentPlayerIndex: d.seat,
    wonCards: [[], [], [], []],
    heartsBroken: d.heartsBroken,
    tricksPlayedInHand: d.trickNumber - 1,
    isComplete: false,
    winnerIndex: null,
  };
}

/** The legal cards for a play decision, per the engine. */
export function legalCards(d: PlayDecision): Card[] {
  return getValidPlays(stateFor(d), d.seat);
}

/** Whether the seat holds the led suit (a follow), leads, or is void (a discard). */
export function playKind(d: PlayDecision): "lead" | "follow" | "discard" {
  if (d.trick.length === 0) return "lead";
  const led = d.trick[0]!.card.suit;
  return d.hand.some((c) => c.suit === led) ? "follow" : "discard";
}

/** Shared play context: the §2.1 terms that depend on the trick and the points. */
function playContext(d: PlayDecision) {
  const playedCards = [...d.played.flatMap((t) => t.cards), ...d.trick.map((t) => t.card)];
  const view = new View(d.hand, playedCards);
  const holdsQ = has(d.hand, QS);
  const qLive = !has(playedCards, QS);
  const qOut = qLive && !holdsQ;
  const trickPoints = d.trick.reduce((s, t) => s + points(t.card), 0);
  const trickHearts = d.trick.filter((t) => t.card.suit === "hearts").length;
  const after = 3 - d.trick.length;
  const led = d.trick[0]?.card.suit;
  const inLed = d.trick.filter((t) => t.card.suit === led);
  const winning = inLed.length ? inLed.reduce((b, t) => (rv(t.card) > rv(b.card) ? t : b)) : null;
  const W = winning?.card ?? null;
  const winner = winning?.playerIndex ?? null;

  // Moon threat (§2.1): points taken, all by one opponent X, X ≥ 10.
  const holders = [0, 1, 2, 3].filter((s) => (d.points[s] ?? 0) > 0);
  const X =
    holders.length === 1 && holders[0] !== d.seat && (d.points[holders[0]!] ?? 0) >= 10
      ? holders[0]!
      : null;
  const hearts = d.hand.filter((c) => c.suit === "hearts");
  const G = hearts.length ? highest(hearts) : null;
  const moonComplete = X !== null && holdsQ && (d.points[X] ?? 0) + trickHearts === 13;
  const seatsAfter = Array.from({ length: after }, (_, k) => (d.seat + k + 1) % 4);
  const xCanOvertake = X !== null && W !== null && seatsAfter.includes(X) && view.above(W) >= 1;
  const xWinning = X !== null && winner === X;
  return {
    view,
    holdsQ,
    qLive,
    qOut,
    trickPoints,
    after,
    led,
    W,
    X,
    G,
    moonComplete,
    xCanOvertake,
    xWinning,
  };
}

function prescribeLead(d: PlayDecision, legal: readonly Card[]): Prescription {
  const { view, X, G, qLive } = playContext(d);
  // 1. P7: a moon threat and an unbeatable guard heart.
  if (X !== null && G && has(legal, G) && view.above(G) === 0) {
    return { expected: G, attributedTo: "P7-MOON-GUARD", check: "lead.moon-guard" };
  }
  // 2. P5 (filter).
  let cands = without(legal, qLive ? [QS, AS, KS] : [QS]);
  if (cands.length === 0) cands = without(legal, [QS]);
  const forbidden = [
    { cards: [QS].filter((c) => has(legal, c) && !has(cands, c)), check: "lead.queen" as const },
    {
      cards: [AS, KS].filter((c) => has(legal, c) && !has(cands, c)),
      check: "lead.spade-honour" as const,
    },
  ];
  // 3. P3: the most dangerous DANGEROUS non-heart.
  const danger = cands.filter((c) => c.suit !== "hearts" && view.dangerous(c));
  if (danger.length) {
    return {
      expected: view.mostDangerous(danger),
      attributedTo: "P3-SHED",
      check: "lead.shed",
      forbidden,
    };
  }
  // 4. P9: among cards some out card beats, fewest below, then lowest rank, then suit.
  const beatable = cands.filter((c) => view.above(c) >= 1);
  if (beatable.length) {
    const pick = [...beatable].sort(
      (a, b) =>
        view.below(a) - view.below(b) || rv(a) - rv(b) || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]
    )[0]!;
    return { expected: pick, attributedTo: "P9-EXIT", check: "lead.exit", forbidden };
  }
  // 5. P9: every card wins — lowest non-heart, else lowest heart.
  const nonHearts = cands.filter((c) => c.suit !== "hearts");
  return {
    expected: lowest(nonHearts.length ? nonHearts : cands),
    attributedTo: "P9-EXIT",
    check: "lead.exit",
    forbidden,
  };
}

function prescribeFollow(d: PlayDecision, legal: readonly Card[]): Prescription {
  const c = playContext(d);
  const { view, W, holdsQ, after, X, G } = c;
  const w = W!;
  const spadesLed = c.led === "spades";
  const honourWinning = spadesLed && (same(w, KS) || same(w, AS));

  // 1. P7, moon complete: keep the queen, play the highest other spade.
  if (honourWinning && holdsQ && c.moonComplete && (c.xWinning || c.xCanOvertake)) {
    return {
      expected: highest(without(legal, [QS])),
      attributedTo: "P7-MOON-GUARD",
      check: "follow.moon-complete-cover",
      refine: (ch) => (isQS(ch) ? "follow.moon-complete-queen" : null),
    };
  }
  // 2. P5: the queen cannot win under A♠/K♠.
  if (honourWinning && holdsQ) {
    return { expected: QS, attributedTo: "P5-QUEEN", check: "follow.queen-under-honour" };
  }
  // 3. P7: take a pointed trick X is winning, as last seat or with a certain winner.
  if (X !== null && c.xWinning && c.trickPoints > 0) {
    const drop = spadesLed && c.qOut && after >= 1 ? [QS, AS, KS] : [QS];
    const hs = without(legal, drop);
    if (hs.length) {
      const h = highest(hs);
      if (rv(h) > rv(w) && (after === 0 || view.above(h) === 0)) {
        return { expected: h, attributedTo: "P7-MOON-GUARD", check: "follow.moon-guard-take" };
      }
    }
  }
  // 4. P2: a free trick — the highest led-suit card other than Q♠.
  if (d.trickNumber === 1 || (after === 0 && c.trickPoints === 0)) {
    const nonQ = without(legal, [QS]);
    return {
      expected: nonQ.length ? highest(nonQ) : QS,
      attributedTo: "P2-FREE-TRICK",
      check: "follow.free-trick",
    };
  }
  // 5. P1: the highest card that loses (P7 filter: keep the guard heart).
  const lower = legal.filter((x) => rv(x) < rv(w));
  if (lower.length) {
    const guardOff =
      X !== null && c.xCanOvertake && G !== null && has(lower, G) && lower.length >= 2;
    const cands = guardOff ? without(lower, [G]) : lower;
    return {
      expected: highest(cands),
      attributedTo: "P1-DUCK",
      check: "follow.duck-highest",
      forbidden: guardOff ? [{ cards: [G], check: "follow.moon-guard-keep" }] : [],
      refine: (ch) => (rv(ch) > rv(w) ? "follow.over-when-could-duck" : null),
    };
  }
  // 6. Every card beats W.
  const cands = without(legal, [QS]);
  const forbidden: { cards: Card[]; check: CheckId }[] = [
    { cards: [QS].filter((x) => has(legal, x)), check: "follow.queen-into-win" },
  ];
  if (spadesLed && after >= 1 && c.qOut) {
    const filtered = without(cands, [AS, KS]);
    if (filtered.length === 0) {
      return {
        expected: has(cands, KS) ? KS : AS,
        attributedTo: "P5-QUEEN",
        check: "follow.spade-honour-under-queen",
        forbidden,
      };
    }
    forbidden.push({
      cards: [AS, KS].filter((x) => has(cands, x)),
      check: "follow.spade-honour-under-queen",
    });
    return {
      expected: highest(filtered),
      attributedTo: "P1-DUCK",
      check: "follow.win-highest",
      forbidden,
    };
  }
  return {
    expected: highest(cands),
    attributedTo: "P1-DUCK",
    check: "follow.win-highest",
    forbidden,
  };
}

function prescribeDiscard(d: PlayDecision, legal: readonly Card[]): Prescription {
  const c = playContext(d);
  const { view, X, G, qLive } = c;
  const forbidden: { cards: Card[]; check: CheckId }[] = [];
  let cands = [...legal];
  // 1. P7 (filter): never complete X's moon with the queen.
  if (c.moonComplete && (c.xWinning || c.xCanOvertake) && has(cands, QS)) {
    cands = without(cands, [QS]);
    forbidden.push({ cards: [QS], check: "discard.moon-complete-queen" });
  }
  // 2. P5: the queen.
  if (has(cands, QS)) {
    return { expected: QS, attributedTo: "P5-QUEEN", check: "discard.queen", forbidden };
  }
  // 3. P5: A♠, then K♠, while the queen is live.
  if (qLive) {
    const honour = [AS, KS].find((x) => has(cands, x));
    if (honour) {
      return {
        expected: honour,
        attributedTo: "P5-QUEEN",
        check: "discard.spade-honour",
        forbidden,
      };
    }
  }
  // 4. P7 (filter): keep the guard heart.
  if (X !== null && G && has(cands, G)) {
    cands = without(cands, [G]);
    forbidden.push({ cards: [G], check: "discard.moon-guard-keep" });
  }
  // 5. P6: the highest HIGH heart.
  const high = cands.filter((x) => view.highHeart(x));
  if (high.length) {
    return {
      expected: highest(high),
      attributedTo: "P6-DISCARD",
      check: "discard.high-heart",
      forbidden,
    };
  }
  // 6. P6: the most dangerous card.
  return {
    expected: view.mostDangerous(cands),
    attributedTo: "P6-DISCARD",
    check: "discard.most-dangerous",
    forbidden,
  };
}

/** §2.4 Passing (P8): the first three cards of the list, in P8 order. */
function prescribePass(d: PassDecision): Prescription {
  const view = new View(d.hand, []);
  const protectedSpades =
    d.hand.filter((c) => c.suit === "spades" && rv(c) >= 2 && rv(c) <= 11).length >= 3;
  const honours = [QS, AS, KS].filter((c) => has(d.hand, c));
  const list: Card[] = protectedSpades ? [] : [...honours];
  const pool = without(d.hand, honours);
  const highHearts = pool.filter((c) => view.highHeart(c)).sort((a, b) => rv(b) - rv(a));
  list.push(...highHearts);
  let rest = without(pool, highHearts);
  while (rest.length) {
    const next = view.mostDangerous(rest);
    list.push(next);
    rest = without(rest, [next]);
  }
  return {
    expected: list.slice(0, 3),
    attributedTo: "P8-PASS",
    check: "pass.order",
    forbidden: [
      // Unprotected: keeping any of them is a P5 break; protected: passing one is.
      { cards: protectedSpades ? honours : [], check: "pass.queen-spades" },
    ],
  };
}

/**
 * §2.4's answer for a decision, or null when it has a single legal card (a
 * forced play is credited to no principle and cannot break one).
 */
export function prescribe(d: Decision): Prescription | null {
  if (d.kind === "pass") return prescribePass(d);
  const legal = legalCards(d);
  if (legal.length <= 1) return null;
  const kind = playKind(d);
  if (kind === "lead") return prescribeLead(d, legal);
  if (kind === "follow") return prescribeFollow(d, legal);
  return prescribeDiscard(d, legal);
}

function sameSet(a: readonly Card[], b: readonly Card[]): boolean {
  return a.length === b.length && a.every((c) => has(b, c));
}

/** The violation a decision commits, if any (at most one: the first §2.4 step it breaks). */
export function checkDecision(d: Decision): Violation | null {
  const p = prescribe(d);
  if (!p) return null;
  let check: CheckId | null = null;
  if (d.kind === "pass") {
    const expected = p.expected as readonly Card[];
    const honoursHeld = [QS, AS, KS].filter((c) => has(d.hand, c));
    const keptUnprotected = honoursHeld.some((c) => has(expected, c) && !has(d.chosen, c));
    const passedProtected = p.forbidden!.some((f) => f.cards.some((c) => has(d.chosen, c)));
    if (keptUnprotected || passedProtected) check = "pass.queen-spades";
    else if (!sameSet(expected, d.chosen)) check = "pass.order";
  } else {
    const expected = p.expected as Card;
    if (!same(expected, d.chosen)) {
      check =
        p.forbidden?.find((f) => has(f.cards, d.chosen))?.check ?? p.refine?.(d.chosen) ?? p.check;
    }
  }
  if (!check) return null;
  const spec = CHECKS[check];
  return {
    check,
    kind: spec.kind,
    principleId: spec.principle,
    attributedTo: p.attributedTo,
    expected: p.expected,
    chosen: d.chosen,
    position: d,
    reason: spec.description,
  };
}

// ---------------------------------------------------------------------------
// Rulebook serialization (§5)
// ---------------------------------------------------------------------------

const SUIT_LETTER: Readonly<Record<Suit, string>> = {
  clubs: "C",
  diamonds: "D",
  spades: "S",
  hearts: "H",
};
const FACE: Readonly<Record<number, string>> = { 1: "A", 11: "J", 12: "Q", 13: "K" };

/** The rulebook name of a card: "QS", "10D". */
export function cardName(c: Card): string {
  return (FACE[c.rank] ?? String(c.rank)) + SUIT_LETTER[c.suit];
}

const list = (cards: readonly Card[]): string => `[${cards.map(cardName).join(", ")}]`;

/**
 * A violation as a §5 rulebook position (one yaml mapping), so it can be
 * pasted into docs/hearts/CONSERVATIVE_AI.md. `expected` and `principle` are
 * §2.4's answer, not the CPU's choice; `reason` names the check that fired
 * and the card the CPU played — edit it before pasting.
 */
export function toRulebookYaml(v: Violation, id: string): string {
  const d = v.position;
  const expected = Array.isArray(v.expected) ? v.expected : [v.expected as Card];
  const chosen = Array.isArray(v.chosen) ? v.chosen : [v.chosen as Card];
  const reason = `${v.check}: ${v.reason} It played ${chosen.map(cardName).join(", ")}.`;
  const lines = [`id: ${id}`];
  if (d.kind === "pass") {
    lines.push(
      "decision: pass",
      `seat: ${d.seat}`,
      "trick_number: 0",
      `pass_direction: ${d.direction}`,
      `hand: ${list(d.hand)}`,
      "played: []",
      "trick: []",
      "hearts_broken: false",
      "queen_played: false",
      "points: [0, 0, 0, 0]"
    );
  } else {
    const all = [...d.played.flatMap((t) => t.cards), ...d.trick.map((t) => t.card)];
    lines.push(
      `decision: ${playKind(d)}`,
      `seat: ${d.seat}`,
      `trick_number: ${d.trickNumber}`,
      `hand: ${list(d.hand)}`
    );
    if (d.played.length === 0) lines.push("played: []");
    else {
      lines.push("played:");
      for (const t of d.played) lines.push(`  - { lead: ${t.lead}, cards: ${list(t.cards)} }`);
    }
    lines.push(
      `trick: [${d.trick.map((t) => `{ seat: ${t.playerIndex}, card: ${cardName(t.card)} }`).join(", ")}]`,
      `hearts_broken: ${d.heartsBroken}`,
      `queen_played: ${has(all, QS)}`,
      `points: [${[0, 1, 2, 3].map((s) => d.points[s] ?? 0).join(", ")}]`
    );
  }
  lines.push(
    `expected: ${list(expected)}`,
    `principle: ${v.attributedTo}`,
    `reason: ${JSON.stringify(reason)}`
  );
  return lines.join("\n");
}
