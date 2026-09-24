/**
 * Hearts AI (#606, #1168).
 *
 * Utility-AI strategy for the 3 computer opponents.
 * Supports Cautious / Schemer / Daring personas via the `difficulty` parameter.
 * No React/AsyncStorage.
 */

import { getValidPlays, getRng } from "./engine";
import { passOffset } from "./types";
import type { AiPersona, Card, HeartsState, PassDirection, TrickCard } from "./types";
import { buildHeartsInfoSet, buildHeartsPassInfoSet } from "./aiInfoSet";
import { MOON_HAND_RULES, assessMoonHand } from "./moonHand";
import {
  currentTrickWinner,
  rateMinimizeImmediatePoints,
  rateQueenSpadesRisk,
  rateMoonThreat,
  rateMoonAttemptProgress,
  rateTactics,
  ratePassingQuality,
  rateSuitVoidingUtility,
} from "./aiConsiderations";
import {
  CAUTIOUS_PLAY_WEIGHTS,
  SCHEMER_PLAY_WEIGHTS,
  DARING_PLAY_WEIGHTS,
  DARING_MOON_PLAY_WEIGHTS,
  DARING_ENDGAME_PLAY_WEIGHTS,
  DARING_ADVERSARIAL_PLAY_WEIGHTS,
  CAUTIOUS_PASS_WEIGHTS,
  SCHEMER_PASS_WEIGHTS,
  DARING_PASS_WEIGHTS,
  NOISE_RATE,
  MISTAKE_SPREAD,
} from "./aiWeights";
import type { PlayWeights } from "./aiWeights";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Weighted pick for a plausible mistake (#2283): each option is weighted
 * exp(−(best − score) / spread), so cards scoring close to the best one are
 * likely and clear blunders are rare. `spread` is in utility-score units;
 * Infinity makes every option equally likely (the old uniform noise).
 */
function pickNearBest<T>(
  options: readonly { item: T; score: number }[],
  best: number,
  spread: number,
  rng: () => number
): number {
  const weights = options.map((o) =>
    Number.isFinite(spread) ? Math.exp(-(best - o.score) / spread) : 1
  );
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

function isQueenOfSpades(c: Card): boolean {
  return c.suit === "spades" && c.rank === 12;
}

const aceHigh = (rank: number): number => (rank === 1 ? 14 : rank);

// ---------------------------------------------------------------------------
// Passing strategy
// ---------------------------------------------------------------------------

/** Returns true when playerIndex's pass lands on seat 0 for the given direction. */
function passingToSeat0(playerIndex: number, direction: PassDirection): boolean {
  const offset = passOffset(direction);
  if (offset === null) return false; // "none": no exchange occurs
  return (playerIndex + offset) % 4 === 0;
}

// ---------------------------------------------------------------------------
// Utility AI — pass selection (A7 #2031)
// ---------------------------------------------------------------------------

/**
 * Utility-AI pass selection. Scores every card by a weighted sum of
 * ratePassingQuality + rateSuitVoidingUtility and greedily picks the top 3.
 *
 * Daring moon-viable override (a hand that rates viable in moonHand.ts,
 * #2234): passes the lowest cards it doesn't need for control, keeping
 * hearts, Q♠, aces, K♠ and the strong side suit.
 *
 * Noise (NOISE_RATE): drawn once per decision; a hit makes a sloppy pass —
 * 3 cards weighted towards the top of the ranking (MISTAKE_SPREAD), not top-3.
 */
export function selectCardsToPassUtility(
  hand: Card[],
  direction: PassDirection,
  difficulty: AiPersona,
  playerIndex: number
): Card[] {
  // 2♣–5♣ are never eligible to pass (2♣ opens trick 1; 3♣–5♣ are safe early leads).
  const eligible = hand.filter((c) => !(c.suit === "clubs" && c.rank >= 2 && c.rank <= 5));

  // ── Noise gate ───────────────────────────────────────────────────────────
  // Drawn before any mode override so noise fires regardless of persona or
  // mode. For Daring, NOISE_RATE === 0 → short-circuits without consuming RNG.
  // A hit makes a plausible mistake, picked below once the cards are scored.
  const rng = getRng();
  const noiseRate = NOISE_RATE[difficulty];
  const sloppy = noiseRate > 0 && rng() < noiseRate;

  // ── Moon-viable override (Daring only) ───────────────────────────────────
  // A hand that rates viable for a moon (moonHand.ts, #2234) passes away the
  // lowest cards it doesn't need and keeps its control: hearts, Q♠, aces,
  // K♠ (with A♠, spade control without Q♠), and the whole strong side suit.
  // Low hearts fill the pass only when nothing else is left. If what it
  // would keep no longer rates viable, it passes normally instead. When the
  // pass goes to the human, only a strong hand keeps Q♠; otherwise the normal
  // targeting pass below applies (#1637, #1647).
  if (difficulty === "daring" && !sloppy) {
    const moon = assessMoonHand(hand);
    const targetingHuman = passingToSeat0(playerIndex, direction);
    const strongMoon = moon.viable && moon.topHearts >= MOON_HAND_RULES.strongPassTopHearts;

    if (moon.viable && (!targetingHuman || strongMoon)) {
      const isControl = (c: Card): boolean =>
        c.suit === "hearts" ||
        isQueenOfSpades(c) ||
        c.rank === 1 ||
        (c.suit === "spades" && c.rank === 13) ||
        c.suit === moon.strongSuit;
      // `rank >= 3 && rank <= 5` combined with the 2♣ exclusion above is equivalent
      // to the rule-based `rank > 1 && rank < 6` filter (clubs 2–5 excluded total).
      const candidates = hand
        .filter(
          (c) =>
            !isControl(c) &&
            !(c.suit === "clubs" && c.rank === 2) &&
            !(c.suit === "clubs" && c.rank >= 3 && c.rank <= 5)
        )
        .sort((a, b) => aceHigh(a.rank) - aceHigh(b.rank)); // lowest first (#1647)

      const selected = candidates.slice(0, 3);

      // Last resort: lowest hearts fill any remaining slots.
      if (selected.length < 3) {
        const lowestHearts = hand
          .filter((c) => c.suit === "hearts")
          .sort((a, b) => aceHigh(a.rank) - aceHigh(b.rank));
        for (const c of lowestHearts) {
          if (selected.length >= 3) break;
          selected.push(c);
        }
      }

      const kept = hand.filter(
        (c) => !selected.some((p) => p.suit === c.suit && p.rank === c.rank)
      );
      if (selected.length === 3 && assessMoonHand(kept).viable) return selected;
    }
  }

  // ── Normal pass mode ──────────────────────────────────────────────────────
  const passInfoSet = buildHeartsPassInfoSet(hand as readonly Card[], direction, playerIndex);

  const weights =
    difficulty === "cautious"
      ? CAUTIOUS_PASS_WEIGHTS
      : difficulty === "daring"
        ? DARING_PASS_WEIGHTS
        : SCHEMER_PASS_WEIGHTS;

  const scored = eligible
    .map((card) => ({
      card,
      score:
        weights.passingQuality * ratePassingQuality(passInfoSet, card) +
        weights.suitVoiding * rateSuitVoidingUtility(passInfoSet, card),
    }))
    .sort((a, b) => b.score - a.score);

  if (sloppy) {
    // A sloppy pass: three cards drawn without replacement, weighted towards
    // the top of the ranking rather than uniformly (#2283).
    const pool = scored.map((s) => ({ item: s.card, score: s.score }));
    const best = pool[0]?.score ?? 0;
    const result: Card[] = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      result.push(
        pool.splice(pickNearBest(pool, best, MISTAKE_SPREAD[difficulty], rng), 1)[0]!.item
      );
    }
    return result;
  }

  return scored.slice(0, 3).map((s) => s.card);
}

// ---------------------------------------------------------------------------
// Utility AI — play selection (A7 #2031)
// ---------------------------------------------------------------------------

/**
 * Utility-AI play selection. Scores every legal card by a weighted sum of
 * the five play considerations and returns the argmax (with optional noise).
 *
 * Moon-attempt activation: when detectMoonAttempt fires (a hand-quality
 * check, moonHand.ts — #2234), DARING_MOON_PLAY_WEIGHTS (moonProgress: 100.0)
 * dominates, hardcoding moon behavior at the activation boundary while
 * keeping card selection utility-driven (calibration-drift guard).
 *
 * Noise (NOISE_RATE, seeded RNG via getRng()): a hit plays a plausible
 * mistake — another card, weighted towards near-best scores (MISTAKE_SPREAD).
 */
/**
 * Returns true when `playerIndex` is in an active moon attempt this trick.
 * Daring only. A moon is possible only while this player holds every point
 * taken so far; within that, the hand must rate viable (moonHand.ts: top
 * hearts and spade control, plus — on the full opening hand — a strong side
 * suit and at most one weak suit, #2234),
 * or the player must already be committed (`commitPoints`: it has captured
 * enough points that shooting is the way to recover them). Exported so the
 * sim gate harness (sim/harness.ts) instruments the real trigger instead of
 * re-implementing it (#2204).
 */
export function detectMoonAttempt(
  hand: Card[],
  state: HeartsState,
  playerIndex: number,
  difficulty: AiPersona
): boolean {
  if (difficulty !== "daring") return false;
  const totalPointsTaken = state.handScores.reduce((s, v) => s + (v ?? 0), 0);
  const myPoints = state.handScores[playerIndex] ?? 0;
  if (myPoints !== totalPointsTaken) return false; // someone else has points
  if (MOON_HAND_RULES.commitPoints > 0 && myPoints >= MOON_HAND_RULES.commitPoints) return true;
  // Side-suit shape only counts on the full hand (before this player's first
  // card): it changes with every card played. See MOON_HAND_RULES.
  const fullHand = hand.length === 13;
  return assessMoonHand(hand, state.wonCards[playerIndex] ?? [], fullHand).viable;
}

export function selectCardToPlayUtility(
  hand: Card[],
  trick: TrickCard[],
  state: HeartsState,
  playerIndex: number,
  difficulty: AiPersona
): Card {
  const valid = getValidPlays(state, playerIndex);
  if (valid.length === 1) return valid[0]!;

  const infoSet = buildHeartsInfoSet(hand, trick, state, playerIndex);

  // ── Moon-attempt detection (moonHand.ts, #2234) ──
  const isMoonAttempt = detectMoonAttempt(hand, state, playerIndex, difficulty);

  // ── Endgame detection (Daring only) ──────────────────────────────────────
  // Mirrors the inEndgame guard in the legacy Hard AI (maxScore ≥ 65).
  const inEndgame =
    difficulty === "daring" &&
    !isMoonAttempt &&
    Math.max(...state.cumulativeScores.map((s) => s ?? 0)) >= 65;

  // ── Adversarial targeting detection (Daring only) ─────────────────────────
  // Mirrors the legacy Hard AI: void in led suit + seat 0 winning the current
  // trick → use DARING_ADVERSARIAL weights to prefer dumping Q♠/hearts on the human.
  // Guard: playerIndex !== 0 (Hard is never seat 0 in real play; without this,
  // a simulation placing Hard at seat 0 would withhold Q♠ indefinitely).
  const isAdversarial = (() => {
    if (difficulty !== "daring" || isMoonAttempt || inEndgame || playerIndex === 0) return false;
    if (trick.length === 0) return false;
    const first = trick[0]!;
    const inSuit = valid.filter((c) => c.suit === first.card.suit);
    if (inSuit.length > 0) return false;
    return currentTrickWinner(trick).playerIndex === 0;
  })();

  // ── Weight selection ──────────────────────────────────────────────────────
  const weights: PlayWeights = isMoonAttempt
    ? DARING_MOON_PLAY_WEIGHTS
    : inEndgame
      ? DARING_ENDGAME_PLAY_WEIGHTS
      : isAdversarial
        ? DARING_ADVERSARIAL_PLAY_WEIGHTS
        : difficulty === "cautious"
          ? CAUTIOUS_PLAY_WEIGHTS
          : difficulty === "schemer"
            ? SCHEMER_PLAY_WEIGHTS
            : DARING_PLAY_WEIGHTS;

  // ── Endgame Q♠ guard ─────────────────────────────────────────────────────
  // If dumping Q♠ would push the trick winner to 100+ and we are not the game
  // leader, remove Q♠ from candidates — don't hand the win to someone else.
  let candidates = valid;
  if (inEndgame && !isMoonAttempt) {
    const scores = state.cumulativeScores;
    const allScores = scores.map((s) => s ?? 0);
    const myScore = allScores[playerIndex] ?? 0;
    // When all players are tied amGameLeader is true for everyone, so no one withholds Q♠ —
    // correct behaviour: in a genuine tie there is no reason to hold back.
    const amGameLeader = myScore <= Math.min(...allScores);
    const trickState = state.currentTrick;
    if (!amGameLeader && trickState.length > 0 && valid.some(isQueenOfSpades)) {
      const first = trickState[0]!;
      const inSuit = valid.filter((c) => c.suit === first.card.suit);
      if (inSuit.length === 0) {
        const winnerIdx = currentTrickWinner(trickState).playerIndex;
        const winnerScore = allScores[winnerIdx] ?? 0;
        if (winnerScore + 13 >= 100) {
          const withoutQ = valid.filter((c) => !isQueenOfSpades(c));
          if (withoutQ.length > 0) candidates = withoutQ;
        }
      }
    }
  }

  // ── Score candidates ──────────────────────────────────────────────────────
  const scored = candidates
    .map((card) => ({
      card,
      score:
        weights.minimizePoints * rateMinimizeImmediatePoints(infoSet, card) +
        weights.queenSpadesRisk * rateQueenSpadesRisk(infoSet, card) +
        weights.moonThreat * rateMoonThreat(infoSet, card) +
        weights.moonProgress * rateMoonAttemptProgress(infoSet, card) +
        weights.tactics * rateTactics(infoSet, card),
    }))
    .sort((a, b) => b.score - a.score);

  // ── Noise: a plausible mistake ────────────────────────────────────────────
  // A hit plays another card than the best one, weighted towards cards that
  // score nearly as well (#2283) — a near-miss a weaker player would make,
  // not a uniformly random card. No draw when there is no alternative.
  const rng = getRng();
  const noiseRate = NOISE_RATE[difficulty];
  if (noiseRate > 0 && scored.length > 1 && rng() < noiseRate) {
    const others = scored.slice(1).map((s) => ({ item: s.card, score: s.score }));
    return others[pickNearBest(others, scored[0]!.score, MISTAKE_SPREAD[difficulty], rng)]!.item;
  }

  return scored[0]!.card;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select exactly 3 cards to pass.
 * `difficulty` defaults to "schemer" (current behaviour) so existing callers are unchanged.
 * `playerIndex` defaults to 0 (human seat) — seat 0 never passes so the default never
 * triggers adversarial targeting; pass the actual AI seat index (1–3) for Daring targeting.
 */
export function selectCardsToPass(
  hand: Card[],
  direction: PassDirection,
  difficulty: AiPersona = "schemer",
  playerIndex = 0
): Card[] {
  return selectCardsToPassUtility(hand, direction, difficulty, playerIndex);
}

// ---------------------------------------------------------------------------
// Moon detection
// ---------------------------------------------------------------------------

/**
 * Returns the player index who is on track to shoot the moon, or null.
 * Fires when a player has ≥ 4 hearts (or Q♠) and no other player has
 * taken any points yet this hand.
 */
export function detectPotentialMoon(state: HeartsState): number | null {
  const totalPointsTaken = state.handScores.reduce((s, v) => s + (v ?? 0), 0);
  if (totalPointsTaken === 0) return null;

  for (let i = 0; i < 4; i++) {
    const myPoints = state.handScores[i] ?? 0;
    if (myPoints === 0) continue;
    // This player has all the points so far
    if (myPoints === totalPointsTaken) {
      const myCards = state.wonCards[i] ?? [];
      const hearts = myCards.filter((c) => c.suit === "hearts").length;
      const hasQ = myCards.some(isQueenOfSpades);
      if (hearts + (hasQ ? 1 : 0) >= 4) return i;
    }
  }
  return null;
}

/**
 * Choose a card to play.
 * `difficulty` defaults to "schemer" (current behaviour) so existing callers are unchanged.
 */
export function selectCardToPlay(
  hand: Card[],
  trick: TrickCard[],
  state: HeartsState,
  playerIndex: number,
  difficulty: AiPersona = "schemer"
): Card {
  return selectCardToPlayUtility(hand, trick, state, playerIndex, difficulty);
}
