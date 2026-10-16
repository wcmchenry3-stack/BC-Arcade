/**
 * The conservative CPU's terms (#3159): docs/hearts/CONSERVATIVE_AI.md §2.1,
 * one function per term. Knowledge is limited to §3 (`View`).
 */

import { isQueenOfSpades } from "../engine";
import type { Card, HeartsState, Suit } from "../types";

/** The principle IDs of §2.2. P4 never names a card in play; it names pass picks (§2.4 Passing step 3). */
export type PrincipleId =
  | "P1-DUCK"
  | "P2-FREE-TRICK"
  | "P3-SHED"
  | "P4-DANGER"
  | "P5-QUEEN"
  | "P6-DISCARD"
  | "P7-MOON-GUARD"
  | "P8-PASS"
  | "P9-EXIT";

/** The §3 tuning constants. */
export const LOW_MAX_BELOW = 3;
export const HIGH_HEART_MAX_ABOVE = 3;
export const PROTECTED_MIN_SPADES = 3;
export const MOON_THRESHOLD = 10;

/** What the CPU knows (§3). `played` is empty when passing, so every card not in hand is out. */
export interface View {
  readonly seat: number;
  readonly hand: readonly Card[];
  /** 1–13. */
  readonly trickNumber: number;
  readonly trick: readonly { readonly card: Card; readonly playerIndex: number }[];
  /** Completed tricks this hand plus the current trick. */
  readonly played: readonly Card[];
  readonly handScores: readonly number[];
}

/** Builds the §3 view from engine state: hand, trick number, current trick, played cards, hand scores. */
export function viewOf(state: HeartsState, seat: number): View {
  return {
    seat,
    hand: state.playerHands[seat] ?? [],
    trickNumber: state.tricksPlayedInHand + 1,
    trick: state.currentTrick,
    played: [...state.wonCards.flat(), ...state.currentTrick.map((t) => t.card)],
    handScores: state.handScores,
  };
}

/** The view used for passing: the original 13 against an unplayed deck. */
export function passView(hand: readonly Card[]): View {
  return { seat: 0, hand, trickNumber: 0, trick: [], played: [], handScores: [0, 0, 0, 0] };
}

// ── Cards ──────────────────────────────────────────────────────────────────

/** Rank value: Ace (engine rank 1) is 14. */
export const rankValue = (c: Card): number => (c.rank === 1 ? 14 : c.rank);

const SAME = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
export const has = (cards: readonly Card[], c: Card): boolean => cards.some((x) => SAME(x, c));
export const without = (cards: readonly Card[], drop: (c: Card) => boolean): Card[] =>
  cards.filter((c) => !drop(c));

export const isSpadeHonour = (c: Card): boolean =>
  c.suit === "spades" && (c.rank === 1 || c.rank === 13);

const SUIT_ORDER: Readonly<Record<Suit, number>> = { clubs: 0, diamonds: 1, spades: 2, hearts: 3 };
/** Suit tie-break: ♣, ♦, ♠, ♥ comes first. */
export const suitOrder = (c: Card): number => SUIT_ORDER[c.suit];

/** The first card in `cards` under a strict comparator (negative = a first). Never depends on hand order. */
export function first(cards: readonly Card[], cmp: (a: Card, b: Card) => number): Card | undefined {
  return [...cards].sort(cmp)[0];
}
export const highest = (cards: readonly Card[]): Card | undefined =>
  first(cards, (a, b) => rankValue(b) - rankValue(a) || suitOrder(a) - suitOrder(b));
export const lowest = (cards: readonly Card[]): Card | undefined =>
  first(cards, (a, b) => rankValue(a) - rankValue(b) || suitOrder(a) - suitOrder(b));

const FULL_DECK: readonly Card[] = (["clubs", "diamonds", "spades", "hearts"] as const).flatMap(
  (suit) => ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const).map((rank) => ({ suit, rank }))
);

// ── Counting (§2.1 Played / Out / below / above) ────────────────────────────

/** Out: neither in the CPU's hand nor played. The CPU's own passed cards count as out. */
export function isOut(v: View, c: Card): boolean {
  return !has(v.hand, c) && !has(v.played, c);
}
function outInSuit(v: View, suit: Suit): Card[] {
  return FULL_DECK.filter((c) => c.suit === suit && isOut(v, c));
}
export function below(v: View, c: Card): number {
  return outInSuit(v, c.suit).filter((o) => rankValue(o) < rankValue(c)).length;
}
export function above(v: View, c: Card): number {
  return outInSuit(v, c.suit).filter((o) => rankValue(o) > rankValue(c)).length;
}

// ── Danger (§2.1 LOW / GUARDED / DANGEROUS / danger order / HIGH heart) ──────

export const isLow = (v: View, c: Card): boolean => below(v, c) <= LOW_MAX_BELOW;

export function isGuarded(v: View, suit: Suit): boolean {
  const mine = v.hand.filter((c) => c.suit === suit);
  const low = mine.filter((c) => isLow(v, c)).length;
  return low >= 2 && low >= mine.length - low;
}

export const isDangerous = (v: View, c: Card): boolean => !isLow(v, c) && !isGuarded(v, c.suit);

/** Danger order: DANGEROUS first, then larger below, then higher rank, then the suit tie-break. */
export function dangerOrder(v: View): (a: Card, b: Card) => number {
  return (a, b) =>
    Number(isDangerous(v, b)) - Number(isDangerous(v, a)) ||
    below(v, b) - below(v, a) ||
    rankValue(b) - rankValue(a) ||
    suitOrder(a) - suitOrder(b);
}
export const mostDangerous = (v: View, cards: readonly Card[]): Card | undefined =>
  first(cards, dangerOrder(v));

export const isHighHeart = (v: View, c: Card): boolean =>
  c.suit === "hearts" && !isLow(v, c) && above(v, c) <= HIGH_HEART_MAX_ABOVE;

/** Spades PROTECTED (passing only): at least 3 spades below the queen. */
export const spadesProtected = (hand: readonly Card[]): boolean =>
  hand.filter((c) => c.suit === "spades" && rankValue(c) < 12).length >= PROTECTED_MIN_SPADES;

// ── The queen ───────────────────────────────────────────────────────────────

const QUEEN: Card = { suit: "spades", rank: 12 };
export const queenLive = (v: View): boolean => !has(v.played, QUEEN);
export const queenOut = (v: View): boolean => queenLive(v) && !has(v.hand, QUEEN);
export const holdsQueen = (v: View): boolean => has(v.hand, QUEEN);

// ── The current trick ───────────────────────────────────────────────────────

const ledSuit = (v: View): Suit | undefined => v.trick[0]?.card.suit;

/** Hearts (1 each) plus Q♠ (13) in the current trick. */
export function trickPoints(v: View): number {
  return v.trick.reduce(
    (s, t) => s + (t.card.suit === "hearts" ? 1 : isQueenOfSpades(t.card) ? 13 : 0),
    0
  );
}
export const trickHearts = (v: View): number =>
  v.trick.filter((t) => t.card.suit === "hearts").length;

/** Players still to play after the CPU (0 = it plays last). */
export const playersAfter = (v: View): number => 3 - v.trick.length;

/** Winning card W and its player: the highest card of the led suit so far. */
export function winning(v: View): { card: Card; seat: number } {
  const led = ledSuit(v);
  const inSuit = v.trick.filter((t) => t.card.suit === led);
  const top = inSuit.reduce((a, b) => (rankValue(b.card) > rankValue(a.card) ? b : a));
  return { card: top.card, seat: top.playerIndex };
}

// ── The moon (§2.1 Moon threat / G / Moon complete / X can overtake) ─────────

/** The opponent X behind a moon threat, or null. Only completed tricks count. */
export function moonThreat(v: View): number | null {
  const takers = v.handScores.flatMap((p, seat) => (p > 0 ? [seat] : []));
  if (takers.length !== 1) return null;
  const x = takers[0]!;
  return x !== v.seat && v.handScores[x]! >= MOON_THRESHOLD ? x : null;
}

/** Guard heart G: the CPU's highest heart. */
export const guardHeart = (v: View): Card | undefined =>
  highest(v.hand.filter((c) => c.suit === "hearts"));

/** Moon complete: a threat by X, the CPU holds Q♠, and X's points plus this trick's hearts make 13. */
export function moonComplete(v: View): number | null {
  const x = moonThreat(v);
  if (x === null || !holdsQueen(v)) return null;
  return v.handScores[x]! + trickHearts(v) === 13 ? x : null;
}

/** X can overtake: X plays after the CPU in this trick and some out card of the led suit beats W. */
export function canOvertake(v: View, x: number): boolean {
  const after = Array.from({ length: playersAfter(v) }, (_, i) => (v.seat + 1 + i) % 4);
  return after.includes(x) && above(v, winning(v).card) >= 1;
}

/** X is winning the trick now, or can overtake it. */
export const xWinsOrCanOvertake = (v: View, x: number): boolean =>
  winning(v).seat === x || canOvertake(v, x);

// ── Explanations ────────────────────────────────────────────────────────────

const RANK_LABEL: Readonly<Record<number, string>> = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const SUIT_LABEL: Readonly<Record<Suit, string>> = {
  clubs: "♣",
  diamonds: "♦",
  spades: "♠",
  hearts: "♥",
};
/** "Q♠", "10♦": for the developer-facing `reason` strings (never shown to players). */
export const label = (c: Card): string => `${RANK_LABEL[c.rank] ?? c.rank}${SUIT_LABEL[c.suit]}`;
