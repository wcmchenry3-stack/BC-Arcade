/**
 * Hearts consideration evaluators for the utility AI (#2030, story A6).
 *
 * Pure functions — no React, no IO, no Math.random, no Date.now.
 * Each accepts a HeartsInfoSet plus a candidate Card and returns a normalized
 * score in [0.0, 1.0]:  0.0 = highly undesirable, 1.0 = highly desirable.
 *
 * All six functions are decomposed from the existing rule chains in ai.ts.
 * Strategy knowledge is preserved; branching priority structure is discarded.
 *
 * Play considerations (action = Card to play):
 *   rateMinimizeImmediatePoints — avoid winning point-laden tricks
 *   rateQueenSpadesRisk         — avoid self-taking Q♠ (13 pts)
 *   rateMoonThreat              — block an opponent's moon attempt
 *   rateMoonAttemptProgress     — advance our own moon run (Daring)
 *
 * Pass considerations (action = Card to include in the pass selection):
 *   rateSuitVoidingUtility      — progress toward a useful suit void
 *   ratePassingQuality          — composite danger-card / void priority
 */

import type { Consideration } from "../_shared/utilityAi/types";
import type { HeartsInfoSet } from "./aiInfoSet";
import type { Card, Rank, Suit } from "./types";

// ---------------------------------------------------------------------------
// Internal helpers (exported for unit tests)
// ---------------------------------------------------------------------------

const aceHigh = (rank: number): number => (rank === 1 ? 14 : rank);

function isQueenOfSpades(c: Card): boolean {
  return c.suit === "spades" && c.rank === 12;
}

function cardPoints(c: Card): number {
  if (c.suit === "hearts") return 1;
  if (isQueenOfSpades(c)) return 13;
  return 0;
}

const ALL_RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** Count cards in `suit` with strictly higher rank than `card` that are not yet
 *  seen and not currently in the acting player's hand. */
function countHigherOutstanding(
  card: Card,
  suit: Suit,
  seenKeys: ReadonlySet<string>,
  hand: readonly Card[]
): number {
  const cardRank = aceHigh(card.rank);
  const handKeys = new Set(hand.map((c) => `${c.suit}:${c.rank}`));
  let count = 0;
  for (const rank of ALL_RANKS) {
    if (aceHigh(rank) <= cardRank) continue;
    const key = `${suit}:${rank}`;
    if (!seenKeys.has(key) && !handKeys.has(key)) count++;
  }
  return count;
}

/** Highest ace-high rank currently winning the trick in `ledSuit`. */
function currentTrickWinRank(trick: HeartsInfoSet["currentTrick"], ledSuit: Suit): number {
  let best = 0;
  for (const tc of trick) {
    if (tc.card.suit === ledSuit) {
      const r = aceHigh(tc.card.rank);
      if (r > best) best = r;
    }
  }
  return best;
}

/**
 * Estimated probability that `card` wins the current trick.
 *
 * When following: card must be in led suit and beat the current winner;
 * score decreases linearly with outstanding higher cards.
 *
 * When leading: score decreases linearly with outstanding higher cards in
 * the led suit, then increases with the fraction of opponents known void
 * (void opponents cannot follow, so they cannot beat us in that suit).
 *
 * Invariant: returns 1.0 when all higher cards in the relevant suit are
 * accounted for (in seenKeys or in hand).  Returns 0.0 when the card
 * cannot possibly win (wrong suit when following, or already beaten).
 */
export function computePWin(card: Card, infoSet: HeartsInfoSet): number {
  const { seenKeys, hand, currentTrick, ledSuit, voidLedger } = infoSet;

  if (ledSuit !== null) {
    if (card.suit !== ledSuit) return 0; // off-suit never wins

    const winRank = currentTrickWinRank(currentTrick, ledSuit);
    if (aceHigh(card.rank) <= winRank) return 0; // already beaten by current winner

    const higher = countHigherOutstanding(card, ledSuit, seenKeys, hand);
    if (higher === 0) return 1.0;

    const maxHigher = 14 - aceHigh(card.rank); // ranks strictly above this card (up to A=14)
    return Math.max(0, 1.0 - higher / Math.max(1, maxHigher));
  }

  // Leading
  const higher = countHigherOutstanding(card, card.suit, seenKeys, hand);
  if (higher === 0) return 1.0;

  const maxHigher = 14 - aceHigh(card.rank);
  const basePWin = Math.max(0, 1.0 - higher / Math.max(1, maxHigher));

  // Void bonus: void opponents cannot follow suit and therefore cannot beat us.
  // Exclude self (playerIndex) — the engine never marks the acting player void.
  const knownVoidCount = [0, 1, 2, 3].filter(
    (p) => p !== infoSet.playerIndex && voidLedger[p]?.[card.suit]
  ).length;
  const voidFraction = knownVoidCount / 3; // at most 3 opponents
  return Math.min(1.0, basePWin + voidFraction * (1.0 - basePWin));
}

// ---------------------------------------------------------------------------
// rateMinimizeImmediatePoints
// ---------------------------------------------------------------------------

/**
 * Score = how well this card avoids capturing points in the current trick.
 *
 * Decomposed from: chooseFollow tries-to-lose-on-point-tricks, chooseDiscard
 * dumps highest heart / Q♠, chooseLead / chooseLeadHard avoid leading hearts.
 *
 * 1.0: card cannot win the trick, or the trick contains zero points.
 * 0.0: card is certain to win a trick worth 26 pts (maximum danger).
 */
export const rateMinimizeImmediatePoints: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const pWin = computePWin(card, infoSet);
  if (pWin === 0) return 1.0;

  const trickPts = infoSet.currentTrick.reduce((s, tc) => s + cardPoints(tc.card), 0);
  const totalPts = trickPts + cardPoints(card);
  if (totalPts === 0) return 1.0;

  // Expected points captured, normalised by the theoretical max of 26
  const danger = (pWin * totalPts) / 26;
  return Math.max(0, 1.0 - danger);
};

// ---------------------------------------------------------------------------
// rateSuitVoidingUtility
// ---------------------------------------------------------------------------

/**
 * Score = how much playing/passing this card advances a void in its suit.
 *
 * Decomposed from: voidOneSuit (pass logic) and the shortest-suit discard
 * preference in chooseDiscard / chooseLead (holding Q♠).
 *
 * 1.0: card is the last of its suit in hand — playing it creates an immediate void.
 * 0.0: suit has ≥4 remaining cards — voiding is not achievable in the near term.
 */
export const rateSuitVoidingUtility: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const suitCount = infoSet.hand.filter((c) => c.suit === card.suit).length;
  if (suitCount === 1) return 1.0; // immediate void
  // Linear: 2 remaining → 0.67, 3 → 0.33, 4+ → 0
  return Math.max(0, 1.0 - (suitCount - 1) / 3);
};

// ---------------------------------------------------------------------------
// rateQueenSpadesRisk
// ---------------------------------------------------------------------------

/**
 * Score = how safe this card is with respect to self-taking Q♠ (13 pts).
 *
 * Decomposed from: qSpadeProtected direction thresholds (all three pass modes),
 * the "dump Q♠ on void discard" path in chooseFollow, the endgame Q♠ guard in
 * selectCardToPlayHard, and the lead guard (never lead K♠/A♠ while Q♠ is out).
 *
 * 1.0: no Q♠ risk (Q♠ already gone, or this card cannot cause self-take).
 * 0.0: near-certain Q♠ self-take (e.g. leading Q♠ into an active spade suit).
 */
export const rateQueenSpadesRisk: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const { hand, seenKeys, currentTrick, ledSuit } = infoSet;

  // Q♠ is "gone" only when it has been collected into a completed trick (wonCards),
  // not when it is merely in the current (still-active) trick.
  const qInCurrentTrick = currentTrick.some((tc) => isQueenOfSpades(tc.card));
  const qGone = seenKeys.has("spades:12") && !qInCurrentTrick;
  if (qGone) return 1.0; // Q♠ safely collected — no further Q♠ risk

  const holdingQ = hand.some(isQueenOfSpades);

  if (isQueenOfSpades(card)) {
    if (ledSuit === null) {
      // Leading Q♠: starts a spade trick — almost certain self-take
      return 0.05;
    }
    if (card.suit !== ledSuit) {
      // Off-suit void discard of Q♠: safe dump → excellent
      return 1.0;
    }
    // In-suit spade follow: safe only when Q♠ cannot take the trick.
    // pWin=0 with outstanding K♠/A♠ still means Q♠ may win if those cards don't appear —
    // treat "currently leading" as risky (0.5) rather than safe (1.0).
    const winRank = currentTrickWinRank(currentTrick, "spades");
    if (aceHigh(card.rank) <= winRank) return 1.0; // already beaten — safe dump
    const pWin = computePWin(card, infoSet);
    return Math.max(0, 0.5 - pWin * 0.5);
  }

  // Q♠ is in the current trick — winning it costs us 13 pts
  if (qInCurrentTrick) {
    const pWin = computePWin(card, infoSet);
    return Math.max(0, 1.0 - pWin);
  }

  if (holdingQ) {
    // Holding Q♠: assess whether this play creates exposure
    if (card.suit === "spades" && ledSuit === null) {
      // Leading spades with Q♠ in hand risks forced spade leads that trap Q♠.
      // Decomposed from chooseLeadHard: avoid leading K♠/A♠ while Q♠ outstanding.
      if (card.rank === 1 || card.rank === 13) return 0.25; // burns Q♠ cover
      return 0.5;
    }
    return 0.8; // holding Q♠ but this play doesn't directly expose it
  }

  // Q♠ outstanding but we don't hold it — leading K♠/A♠ risks having Q♠ discarded onto us.
  // Matches chooseLeadHard: avoid leading K♠/A♠ while Q♠ is still live.
  if (ledSuit === null && (card.suit === "spades") && (card.rank === 13 || card.rank === 1)) {
    return 0.25;
  }

  return 1.0;
};

// ---------------------------------------------------------------------------
// rateMoonThreat
// ---------------------------------------------------------------------------

/**
 * Score = how effectively this card blocks an opponent's moon attempt.
 *
 * Decomposed from: the moon-blocking dump sequences in selectCardToPlayMedium /
 * selectCardToPlayHard — dump highest safe point card on the moon-shooter's trick
 * when following, prefer low leads that won't feed the shooter when leading.
 *
 * 1.0: optimal block (safe high-value point dump onto the shooter's winning trick).
 * 0.5: neutral (no moon threat, or card has no blocking effect).
 * 0.0: counter-productive (would win back a point trick, helping the shooter).
 */
export const rateMoonThreat: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const { pointsPerPlayer, playerIndex, ledSuit } = infoSet;

  const totalPts = pointsPerPlayer.reduce((s, v) => s + v, 0);
  if (totalPts < 4) return 0.5; // insufficient signal for a moon threat

  // Moon threat: exactly one opponent holds all points taken so far
  let threatFound = false;
  for (let i = 0; i < 4; i++) {
    if (i === playerIndex) continue;
    const pts = pointsPerPlayer[i] ?? 0;
    if (pts > 0 && pts === totalPts) {
      threatFound = true;
      break;
    }
  }
  if (!threatFound) return 0.5;

  const pts = cardPoints(card);
  const pWin = computePWin(card, infoSet);
  const isVoid = ledSuit !== null && card.suit !== ledSuit;

  if (ledSuit === null) {
    // Leading during a moon threat: avoid starting point tricks the shooter can take
    return pts > 0 ? 0.2 : 0.6;
  }

  if (isVoid) {
    // Off-suit discard onto the shooter's trick: dumping points is ideal blocking
    // Q♠ (13 pts) is worth maximally dumping; each heart (1 pt) is still useful
    if (pts > 0) return 0.7 + (pts / 26) * 0.3;
    return 0.5; // non-point discard: neutral
  }

  // Following in led suit: dump points only when we won't win the trick back
  if (pts > 0) {
    return 0.5 + (1.0 - pWin) * 0.45; // safe dump → up to 0.95; self-win → ~0.5
  }
  return 0.5;
};

// ---------------------------------------------------------------------------
// rateMoonAttemptProgress
// ---------------------------------------------------------------------------

/**
 * Score = how well this card advances collecting all 26 points (moon run).
 *
 * Decomposed from: the earlyMoon / midMoon play sequences in selectCardToPlayHard
 * — lead highest non-hearts for trick control, win every point trick, dump junk
 * when void, protect hearts/Q♠ from being discarded.
 *
 * The weight broker (A7) applies this consideration only for Daring persona and
 * when moon-attempt mode is active.  Here we rate the card's raw moon-run value
 * without gating on whether the player is actually in moon mode.
 *
 * 1.0: perfect moon-run move (win a fully point-laden trick).
 * 0.5: neutral (e.g. winning a 0-pt trick for board control).
 * 0.05: catastrophic (discarding a heart/Q♠ during a void, losing it forever).
 */
export const rateMoonAttemptProgress: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const pts = cardPoints(card);
  const pWin = computePWin(card, infoSet);
  const { ledSuit, currentTrick } = infoSet;
  const isVoid = ledSuit !== null && card.suit !== ledSuit;

  if (isVoid) {
    // Off-suit void discard: dump non-point junk; losing a heart/Q♠ kills a moon run
    if (pts === 0) return 0.9 + aceHigh(card.rank) / 140; // rank bonus: exhaust higher junk first
    return 0.05;
  }

  if (ledSuit === null) {
    // Leading: want to win and maintain trick control
    if (card.suit === "hearts" || isQueenOfSpades(card)) {
      return pWin * 0.75;
    }
    return 0.3 + pWin * 0.65;
  }

  // Following in led suit
  if (pts > 0) {
    if (pWin === 0) return 0.0; // can't win this pts trick — don't waste it
    // Q♠ in an otherwise 0-pt trick: save it for tricks that already have hearts
    const trickPts = currentTrick.reduce((s, tc) => s + cardPoints(tc.card), 0);
    if (isQueenOfSpades(card) && trickPts === 0) return pWin * 0.3;
    return pWin * 0.95; // win point tricks to collect all 26
  }
  // 0-pt trick
  if (pWin === 0) return 0.1; // neutral, Q♠-preserving
  // Small rank penalty: prefer lowest winning card to conserve high cards for later
  return pWin * 0.65 - aceHigh(card.rank) / 1400;
};

// ---------------------------------------------------------------------------
// ratePassingQuality
// ---------------------------------------------------------------------------

/**
 * Composite pass quality score for a single candidate card.
 *
 * Decomposed from all three pass-strategy implementations (selectCardsToPassEasy /
 * Medium / Hard): Q♠ direction-aware thresholds, danger-heart ranking,
 * first-trick club safety, A♣/K♣ danger, short-suit priority, cover-card
 * preservation when keeping Q♠.
 *
 * 1.0: ideal pass candidate (unprotected Q♠, A♥, high danger heart).
 * 0.0: must never pass (2♣).
 *
 * Callers must weight this consideration at 0 during `passDirection === "none"`
 * hands — no pass occurs, so any non-zero weight would incorrectly influence play.
 */
export const ratePassingQuality: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const { hand, passDirection } = infoSet;

  // 2♣ must never be passed — engine requires it to open the first trick
  if (card.suit === "clubs" && card.rank === 2) return 0.0;

  // Low clubs (3♣–5♣): safe early leads; low pass priority
  if (card.suit === "clubs" && card.rank >= 3 && card.rank <= 5) return 0.35;

  const spades = hand.filter((c) => c.suit === "spades");
  const hasQSpades = spades.some(isQueenOfSpades);
  const hasASpades = spades.some((c) => c.rank === 1);
  const hasKSpades = spades.some((c) => c.rank === 13);
  const voidInSpades = spades.length === 0;

  if (isQueenOfSpades(card)) {
    if (voidInSpades) return 0.5; // void in spades — Q♠ pass is moot but not dangerous
    // Direction-aware protection thresholds (decomposed from Medium/Hard pass logic)
    const fullyProtected =
      passDirection === "left"
        ? hasASpades || hasKSpades // keep Q♠ with any cover when passing left
        : passDirection === "none"
          ? hasASpades && hasKSpades // baseline: need both covers to keep Q♠
          : false; // right/across: always pass Q♠ (travels safely)
    return fullyProtected ? 0.05 : 0.95;
  }

  if (card.suit === "hearts") {
    // Danger hearts ranked by win probability — A♥ always wins heart tricks
    if (card.rank === 1) return 0.9;
    if (card.rank === 13) return 0.8;
    if (card.rank === 12) return 0.75;
    if (card.rank === 11) return 0.7;
    if (card.rank === 10) {
      // 10♥ is an extra danger card when passing right (decomposed from Hard's heartDangerThreshold)
      return passDirection === "right" ? 0.65 : 0.4;
    }
    return 0.3; // lower hearts: not especially dangerous
  }

  if (card.suit === "spades") {
    if (hasQSpades) {
      // Holding Q♠: K♠ and A♠ are cover cards — keeping them is the entire point
      if (card.rank === 1 || card.rank === 13) return 0.15;
    }
    // Without Q♠: A♠/K♠ can win dangerous spade tricks themselves
    if (card.rank === 1 || card.rank === 13) return 0.65;
    return 0.3;
  }

  if (card.suit === "clubs") {
    // A♣/K♣ are dangerous — clubs cycle early and high clubs often take point tricks
    if (card.rank === 1 || card.rank === 13) return 0.6;
    // Mid clubs: filler material; scaled slightly by rank
    return Math.min(0.45, 0.2 + aceHigh(card.rank) / 28);
  }

  // Diamonds: generally safe; scale lightly by rank
  return Math.min(0.55, 0.1 + aceHigh(card.rank) / 28);
};
