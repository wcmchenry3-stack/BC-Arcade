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
import type { Card, Rank, Suit, TrickCard } from "./types";

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

/**
 * Among `higher` (a count already restricted to unseen, higher-ranked cards in
 * `suit`), how many are cards we *know* we passed away this hand (#2237)?
 * These are certain, specific-opponent threats — not "could be anywhere" —
 * so computePWin's void-fraction heuristic (built for genuine uncertainty)
 * should not dilute them.
 */
function countKnownHigherAmongPassed(
  card: Card,
  suit: Suit,
  seenKeys: ReadonlySet<string>,
  passedCards: readonly Card[]
): number {
  const cardRank = aceHigh(card.rank);
  let count = 0;
  for (const pc of passedCards) {
    if (pc.suit !== suit) continue;
    if (aceHigh(pc.rank) <= cardRank) continue;
    if (seenKeys.has(`${pc.suit}:${pc.rank}`)) continue; // already played
    count++;
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
  const { seenKeys, hand, currentTrick, ledSuit, voidLedger, passedCards } = infoSet;

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

  // Pass-memory refinement (#2237): the void-fraction bonus above models
  // "could be anywhere among 3 opponents" uncertainty. Higher-ranked outstanding
  // cards we know we passed away this hand aren't uncertain — they're a specific,
  // certain threat from whichever opponent received our pass. Scale the void
  // bonus down to only the genuinely-unknown share of `higher` so a void
  // elsewhere in the table doesn't wrongly discount a threat we already know is real.
  const knownHigher = countKnownHigherAmongPassed(card, card.suit, seenKeys, passedCards);
  const unknownFractionOfHigher = Math.max(0, higher - knownHigher) / higher; // higher > 0: guarded above

  return Math.min(1.0, basePWin + voidFraction * unknownFractionOfHigher * (1.0 - basePWin));
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
 * Decomposed from: the legacy rule-based Q♠-protection thresholds across all
 * three pass modes, the "dump Q♠ on void discard" follow path, the endgame
 * Q♠ guard in the legacy Hard AI, and the lead guard (never lead K♠/A♠ while
 * Q♠ is out).
 *
 * 1.0: no Q♠ risk (Q♠ already gone, or this card cannot cause self-take).
 * 0.0: near-certain Q♠ self-take (e.g. leading Q♠ into an active spade suit).
 */
export const rateQueenSpadesRisk: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const { hand, seenKeys, currentTrick, ledSuit, passedCards, passedToPlayerIndex } = infoSet;

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
  if (ledSuit === null && card.suit === "spades" && (card.rank === 13 || card.rank === 1)) {
    // Pass-memory refinement (#2237): if we passed Q♠ away, we know exactly who
    // holds it (until it's played), rather than treating it as "outstanding,
    // unknown location". That alone doesn't change the odds of a forced reveal —
    // but if we *also* passed the other cover card (K♠/A♠) to that same
    // opponent in the same pass, we know for certain they're holding a second
    // spade and aren't forced to reveal Q♠ the moment we lead its partner.
    // Without that corroborating cover, a known-but-uncovered holder is a more
    // concrete threat than the fully unknown-location baseline.
    const passedQueen = passedToPlayerIndex !== null && passedCards.some(isQueenOfSpades);
    if (passedQueen) {
      const otherCoverRank = card.rank === 13 ? 1 : 13; // leading K♠ → A♠ is the cover, and vice versa
      // Only counts as cover if it's still unplayed — a passed cover card the
      // recipient has since discarded no longer protects them from a forced reveal.
      const recipientHasCover = passedCards.some(
        (pc) =>
          pc.suit === "spades" &&
          pc.rank === otherCoverRank &&
          !seenKeys.has(`${pc.suit}:${pc.rank}`)
      );
      return recipientHasCover ? 0.45 : 0.15;
    }
    return 0.25;
  }

  return 1.0;
};

// ---------------------------------------------------------------------------
// rateMoonThreat
// ---------------------------------------------------------------------------

/**
 * Moon-defense thresholds (#2235). Always-on engine behaviour (#2269): the
 * personas differ only through their `moonThreat` weight.
 */
export const MOON_DEFENSE = {
  /** A lone point-holder is treated as a threat from this many points... */
  minThreatPoints: 2,
  /** ...rising linearly to a full threat at this many (the old gate was all-or-nothing at 4). */
  fullThreatPoints: 4,
};

/** The trick card currently winning a non-empty trick (highest of the led suit). */
export function currentTrickWinner(trick: readonly TrickCard[]): TrickCard {
  const ledSuit = trick[0]!.card.suit;
  let winner = trick[0]!;
  for (const tc of trick) {
    if (tc.card.suit === ledSuit && aceHigh(tc.card.rank) > aceHigh(winner.card.rank)) winner = tc;
  }
  return winner;
}

/**
 * The opponent who holds every point taken this hand, or null when nobody
 * has points, several players do, or it's this player (no threat to block).
 */
export function moonShooter(infoSet: HeartsInfoSet): number | null {
  const { pointsPerPlayer, playerIndex } = infoSet;
  const total = pointsPerPlayer.reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  for (let i = 0; i < 4; i++) {
    if ((pointsPerPlayer[i] ?? 0) === total) return i === playerIndex ? null : i;
  }
  return null;
}

/**
 * Probability that none of `seats` holds a card of `suit` ranked above
 * `aboveRank` (ace-high). Outstanding cards (not seen, not in hand) we
 * passed away this hand are with their known recipient (#2237); the rest
 * are equally likely to be with any opponent not known void in the suit.
 */
function pNoHigherCardIn(
  infoSet: HeartsInfoSet,
  seats: readonly number[],
  suit: Suit,
  aboveRank: number
): number {
  const { seenKeys, hand, passedCards, passedToPlayerIndex, voidLedger, playerIndex } = infoSet;
  const inHand = new Set(hand.map((c) => `${c.suit}:${c.rank}`));
  const passed = new Set(passedCards.map((c) => `${c.suit}:${c.rank}`));
  const holders = [0, 1, 2, 3].filter((p) => p !== playerIndex && !voidLedger[p]?.[suit]);
  const eligible = seats.filter((p) => holders.includes(p)).length;
  let p = 1;
  for (const rank of ALL_RANKS) {
    if (aceHigh(rank) <= aboveRank) continue;
    const key = `${suit}:${rank}`;
    if (seenKeys.has(key) || inHand.has(key)) continue;
    if (passed.has(key) && passedToPlayerIndex !== null) {
      if (seats.includes(passedToPlayerIndex)) return 0; // we know they hold it
      continue;
    }
    if (holders.length > 0) p *= 1 - eligible / holders.length;
  }
  return p;
}

/** Seats still to play in the current trick after this player. */
function seatsAfterMe(infoSet: HeartsInfoSet): number[] {
  const { currentTrick, playerIndex } = infoSet;
  const leader = currentTrick.length > 0 ? currentTrick[0]!.playerIndex : playerIndex;
  const order = [0, 1, 2, 3].map((i) => (leader + i) % 4);
  return order.slice(order.indexOf(playerIndex) + 1);
}

/**
 * Probability the trick ends with a non-shooter winning it, given this
 * player's card doesn't win. `topRank`/`suit` describe the card to beat:
 * the current winner when following, this player's own lead when leading.
 */
function pTrickAvoidsShooter(
  infoSet: HeartsInfoSet,
  shooter: number,
  suit: Suit,
  topRank: number,
  shooterIsWinning: boolean
): number {
  const later = seatsAfterMe(infoSet);
  const shooterPlayed = !later.includes(shooter);
  if (shooterPlayed) {
    if (!shooterIsWinning) return 1; // the shooter can't come back
    // A non-shooter still to play overtakes (and, with points in the trick,
    // defends by doing so) if they hold a higher card of the suit.
    return 1 - pNoHigherCardIn(infoSet, later, suit, topRank);
  }
  // The shooter plays after us and takes the trick with any higher card.
  return pNoHigherCardIn(infoSet, [shooter], suit, topRank);
}

interface MoonOutlook {
  readonly shooter: number;
  readonly threat: number;
  readonly trickPoints: number;
  /** Following: chance the trick avoids the shooter if our card doesn't win. */
  readonly pAvoidFollowing: number;
}

// Per-decision context, shared by every candidate card of one info set.
const outlookCache = new WeakMap<HeartsInfoSet, MoonOutlook | null>();

function moonOutlook(infoSet: HeartsInfoSet): MoonOutlook | null {
  if (outlookCache.has(infoSet)) return outlookCache.get(infoSet)!;
  let outlook: MoonOutlook | null = null;
  const shooter = moonShooter(infoSet);
  const shooterPts = shooter === null ? 0 : (infoSet.pointsPerPlayer[shooter] ?? 0);
  const { minThreatPoints, fullThreatPoints } = MOON_DEFENSE;
  if (shooter !== null && shooterPts >= minThreatPoints) {
    const threat = Math.min(
      1,
      (shooterPts - minThreatPoints + 1) / (fullThreatPoints - minThreatPoints + 1)
    );
    const { currentTrick, ledSuit } = infoSet;
    const trickPoints = currentTrick.reduce((s, tc) => s + cardPoints(tc.card), 0);
    let pAvoidFollowing = 0;
    if (ledSuit !== null) {
      const winner = currentTrickWinner(currentTrick);
      pAvoidFollowing = pTrickAvoidsShooter(
        infoSet,
        shooter,
        ledSuit,
        aceHigh(winner.card.rank),
        winner.playerIndex === shooter
      );
    }
    outlook = { shooter, threat, trickPoints, pAvoidFollowing };
  }
  outlookCache.set(infoSet, outlook);
  return outlook;
}

/**
 * Score = how well this card defends against an opponent's moon (#2235).
 *
 * A moon is broken the moment any other player takes a point, so a card is
 * judged on where the trick's points — including any already in it — end
 * up:
 * - with a non-shooter (this player winning the trick, or the trick going
 *   to someone else) the moon is blocked: high score;
 * - with the shooter the moon is fed: low score, so the player keeps its
 *   hearts and Q♠ — its stoppers — and discards safe cards instead.
 * The trick's destination is estimated from who still has to play and
 * where the higher cards can be (pass memory and known voids included). A
 * trick with no points is neutral whatever is played. The old version
 * rewarded any point dump while a lone opponent held 4+ points, including
 * onto the shooter's own winning trick.
 *
 * Detection is graded: the threat rises from `minThreatPoints` to full at
 * `fullThreatPoints`, and the score is blended towards neutral by it.
 *
 * 1.0: best block. 0.5: neutral (no threat, or no points at stake). 0.0: feeds the moon.
 */
export const rateMoonThreat: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const outlook = moonOutlook(infoSet);
  if (outlook === null) return 0.5;
  const points = outlook.trickPoints + cardPoints(card);
  if (points === 0) return 0.5; // nothing at stake either way

  const pWin = computePWin(card, infoSet);
  const pAvoid =
    infoSet.ledSuit === null
      ? pTrickAvoidsShooter(infoSet, outlook.shooter, card.suit, aceHigh(card.rank), false)
      : outlook.pAvoidFollowing;
  const pBlock = pWin + (1 - pWin) * pAvoid;
  // More points at stake matter more (Q♠ onto the shooter is the worst case).
  const size = Math.min(0.45, 0.35 + 0.1 * (points / 13));
  const raw = 0.5 + (2 * pBlock - 1) * size;
  return 0.5 + outlook.threat * (raw - 0.5);
};

// ---------------------------------------------------------------------------
// rateTactics (#2236)
// ---------------------------------------------------------------------------

/**
 * Standard Hearts plays the other considerations don't express (#2236).
 * Engine-level, not persona flavour (#2269): the same for every persona,
 * added at a fixed weight (TACTICS_WEIGHT in aiWeights.ts). Each can be
 * switched off on its own; the sim validated them one at a time — a seat
 * with the tactic against the same seat without it, same cards and field
 * (Schemer, 3,000 blocks): (a) +35.2pp win share, −1.88 points a hand;
 * (b) +4.3pp, −0.25; (c) +3.3pp, −0.21.
 *
 * #2236's fourth tactic, (d) keeping low "exit" cards in two suits for the
 * last tricks, is not here: it did cut all-high endgame leads (17% → 8%),
 * but cost 1.2-2.2pp of win share in every variant tried, since holding
 * low cards means shedding high ones later, into point tricks.
 */
export const PLAY_TACTICS = {
  /** (a) Can't win the trick → play the highest such card (#1500's rule). */
  duckHigh: true,
  /**
   * (b) Last to play, and every legal card wins or the trick holds no
   * points (a free win) → play the highest card of the suit.
   */
  forcedWinHigh: true,
  /** (c) Lead low spades to force Q♠ out, when safe (no Q♠, A♠ or K♠ held). */
  spadeFlush: true,
};

/**
 * Score = how well this card follows the standard tactics above. 0.5 is
 * neutral; each tactic moves it by at most ±0.3, so tactics break ties and
 * nudge close calls without overriding point or Q♠ safety.
 */
export const rateTactics: Consideration<HeartsInfoSet, Card> = (infoSet, card) => {
  const { hand, currentTrick, ledSuit, seenKeys } = infoSet;
  const rankFrac = (aceHigh(card.rank) - 2) / 12; // 0 for a 2, 1 for an ace
  let score = 0.5;

  if (ledSuit !== null) {
    const winRank = currentTrickWinRank(currentTrick, ledSuit);
    const last = currentTrick.length === 3;
    const trickPoints = currentTrick.reduce((sum, tc) => sum + cardPoints(tc.card), 0);
    const inSuit = hand.filter((c) => c.suit === ledSuit);
    // (b) Forced or free win: last to play, following suit, and either every
    // card of the suit wins or the trick holds no points (so winning costs
    // nothing) — play the highest card of the suit and keep the low ones as
    // exits. On trick 1 this is the old "play your highest club" rule.
    const forcedOrFree =
      last &&
      inSuit.length > 0 &&
      (trickPoints === 0 || inSuit.every((c) => aceHigh(c.rank) > winRank));
    if (PLAY_TACTICS.forcedWinHigh && forcedOrFree) {
      if (card.suit === ledSuit) score += 0.3 * rankFrac;
    } else if (PLAY_TACTICS.duckHigh) {
      // (a) Duck high: of the cards already beaten (or off-suit), shed the
      // highest — it's a future liability, and losing with it costs nothing.
      // "Beaten" is strict: a card that still beats the current winner may
      // take the trick even if higher cards are outstanding.
      // Not while a lone opponent holds every point: shedding high cards then
      // throws away the stoppers needed to take a point and break the moon
      // (and a high heart or Q♠ may land on the shooter's trick). Measured:
      // with duck-high on for the defenders, Daring's moon success against a
      // Schemer field rose from 5% to 21%; guarding only point cards left 13%.
      const beaten = card.suit !== ledSuit || aceHigh(card.rank) < winRank;
      if (beaten && moonShooter(infoSet) === null) score += 0.3 * rankFrac;
    }
  } else {
    // (c) Spade flush: Q♠ still out, not ours, and no A♠/K♠ it could be
    // dumped on — a low spade lead makes its holder follow or reveal it.
    if (PLAY_TACTICS.spadeFlush && card.suit === "spades" && aceHigh(card.rank) < 12) {
      const held = (rank: number) => hand.some((c) => c.suit === "spades" && c.rank === rank);
      const queenOut = !seenKeys.has("spades:12") && !held(12);
      if (queenOut && !held(1) && !held(13)) score += 0.25;
    }
  }

  return Math.max(0, Math.min(1, score));
};

// ---------------------------------------------------------------------------
// rateMoonAttemptProgress
// ---------------------------------------------------------------------------

/**
 * Score = how well this card advances collecting all 26 points (moon run).
 *
 * Decomposed from: the earlyMoon / midMoon play sequences in the legacy Hard AI
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
