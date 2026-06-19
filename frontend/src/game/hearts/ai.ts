/**
 * Hearts AI (#606, #1168).
 *
 * Utility-AI strategy for the 3 computer opponents.
 * Supports Cautious / Schemer / Daring personas via the `difficulty` parameter.
 * No React/AsyncStorage.
 */

import { getValidPlays, getRng } from "./engine";
import type { AiPersona, Card, HeartsState, PassDirection, TrickCard } from "./types";
import { buildHeartsInfoSet, buildHeartsPassInfoSet } from "./aiInfoSet";
import {
  rateMinimizeImmediatePoints,
  rateQueenSpadesRisk,
  rateMoonThreat,
  rateMoonAttemptProgress,
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
} from "./aiWeights";
import type { PlayWeights } from "./aiWeights";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isQueenOfSpades(c: Card): boolean {
  return c.suit === "spades" && c.rank === 12;
}

const aceHigh = (rank: number): number => (rank === 1 ? 14 : rank);

/**
 * Returns the player index currently winning a non-empty trick.
 * Highest card in the led suit wins; off-suit cards cannot win.
 */
function currentTrickWinner(trick: readonly TrickCard[]): number {
  const first = trick[0]!;
  const ledSuit = first.card.suit;
  let winnerIdx = first.playerIndex;
  let winnerRank = aceHigh(first.card.rank);
  for (let i = 1; i < trick.length; i++) {
    const tc = trick[i]!;
    if (tc.card.suit === ledSuit && aceHigh(tc.card.rank) > winnerRank) {
      winnerRank = aceHigh(tc.card.rank);
      winnerIdx = tc.playerIndex;
    }
  }
  return winnerIdx;
}

// ---------------------------------------------------------------------------
// Passing strategy
// ---------------------------------------------------------------------------

/** Returns true when playerIndex's pass lands on seat 0 for the given direction. */
function passingToSeat0(playerIndex: number, direction: PassDirection): boolean {
  if (direction === "none") return false;
  const offset = direction === "left" ? 1 : direction === "right" ? 3 : 2;
  return (playerIndex + offset) % 4 === 0;
}

// ---------------------------------------------------------------------------
// Utility AI — pass selection (A7 #2031)
// ---------------------------------------------------------------------------

/**
 * Utility-AI pass selection. Scores every card by a weighted sum of
 * ratePassingQuality + rateSuitVoidingUtility and greedily picks the top 3.
 *
 * Daring moon-viable override (heartsInHand ≥ 6 + Q♠): keeps the old
 * threshold exactly and selects by inverse-rank utility (lowest non-hearts
 * pass first), which is equivalent to the rule-based moon-viable logic.
 *
 * Noise (Cautious 25 %, Schemer 10 %, Daring 0 %): applied once per decision
 * before picking — a noise hit draws 3 random valid cards instead of top-3.
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
  // Checked before any mode override so noise fires regardless of persona or
  // mode. For Daring, NOISE_RATE === 0 → short-circuits without consuming RNG.
  const rng = getRng();
  const noiseRate = NOISE_RATE[difficulty];
  if (noiseRate > 0 && rng() < noiseRate) {
    const pool = [...eligible];
    const result: Card[] = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const idx = Math.floor(rng() * pool.length);
      result.push(pool.splice(idx, 1)[0]!);
    }
    return result;
  }

  // ── Moon-viable override (Daring only) ───────────────────────────────────
  // Threshold mirrors selectCardsToPassHard: 6+ hearts + Q♠ → keep both,
  // pass lowest eligible non-hearts for trick control (#1637, #1647).
  if (difficulty === "daring") {
    const heartsInHand = hand.filter((c) => c.suit === "hearts").length;
    const hasQSpades = hand.some(isQueenOfSpades);
    const targetingHuman = passingToSeat0(playerIndex, direction);
    const moonViable = heartsInHand >= 6 && hasQSpades;
    const strongMoon = heartsInHand >= 7 && hasQSpades;

    if (moonViable && (!targetingHuman || strongMoon)) {
      // moonPassScore: 1.0 for rank-2, 0.0 for Ace. Sorted descending so lowest-rank
      // cards appear first — matches the rule-based "pass lowest non-hearts" (#1647).
      const moonPassScore = (c: Card): number => 1.0 - (aceHigh(c.rank) - 2) / 12;

      // `rank >= 3 && rank <= 5` combined with the 2♣ exclusion above is equivalent
      // to the rule-based `rank > 1 && rank < 6` filter (clubs 2–5 excluded total).
      const candidates = hand
        .filter(
          (c) =>
            c.suit !== "hearts" &&
            !isQueenOfSpades(c) &&
            !(c.suit === "clubs" && c.rank === 2) &&
            !(c.suit === "clubs" && c.rank >= 3 && c.rank <= 5)
        )
        .sort((a, b) => moonPassScore(b) - moonPassScore(a));

      const selected = candidates.slice(0, 3);

      // Last resort: lowest hearts fill any remaining slots.
      if (selected.length < 3) {
        const selectedKeys = new Set(selected.map((c) => `${c.suit}:${c.rank}`));
        const lowestHearts = hand
          .filter((c) => c.suit === "hearts" && !selectedKeys.has(`${c.suit}:${c.rank}`))
          .sort((a, b) => aceHigh(a.rank) - aceHigh(b.rank));
        for (const c of lowestHearts) {
          if (selected.length >= 3) break;
          selected.push(c);
        }
      }

      return selected.slice(0, 3);
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

  return scored.slice(0, 3).map((s) => s.card);
}

// ---------------------------------------------------------------------------
// Utility AI — play selection (A7 #2031)
// ---------------------------------------------------------------------------

/**
 * Utility-AI play selection. Scores every legal card by a weighted sum of
 * the four play considerations and returns the argmax (with optional noise).
 *
 * Moon-attempt activation: preserves the exact earlyMoon / midMoon thresholds
 * from the rule-based Daring play logic — when either fires, DARING_MOON_PLAY_WEIGHTS
 * (moonProgress: 100.0) dominates, hardcoding moon behavior at the activation
 * boundary while keeping card selection utility-driven (calibration-drift guard).
 *
 * Noise: Cautious 25 %, Schemer 10 %, Daring 0 % (seeded RNG via getRng()).
 */
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

  // ── Moon-attempt detection (exact thresholds from selectCardToPlayHard) ──
  let isMoonAttempt = false;
  if (difficulty === "daring") {
    const heartsInHand = hand.filter((c) => c.suit === "hearts").length;
    const heartsWon = (state.wonCards[playerIndex] ?? []).filter((c) => c.suit === "hearts").length;
    const totalHearts = heartsInHand + heartsWon;
    const myHasQ =
      hand.some(isQueenOfSpades) || (state.wonCards[playerIndex] ?? []).some(isQueenOfSpades);
    const totalPointsTaken = state.handScores.reduce((s, v) => s + (v ?? 0), 0);
    const myPoints = state.handScores[playerIndex] ?? 0;
    // earlyMoon: 7+ hearts + Q♠ at trick start (hand.length ≥ 8)
    const earlyMoon = heartsInHand >= 7 && myHasQ && heartsWon === 0 && hand.length >= 8;
    // midMoon: 6+ hearts total + Q♠ + we hold all points taken so far.
    // NOTE: fires trivially when totalPointsTaken === 0 — myPoints(0) === 0 always.
    // This is intentional (matching selectCardToPlayHard): a player with 6+ hearts + Q♠
    // should play moon-attempt mode from trick 1, even before earlyMoon's 7+ threshold.
    const midMoon = totalHearts >= 6 && myHasQ && myPoints === totalPointsTaken && hand.length >= 5;
    isMoonAttempt = earlyMoon || midMoon;
  }

  // ── Endgame detection (Daring only) ──────────────────────────────────────
  // Mirrors the inEndgame guard in selectCardToPlayHard (maxScore ≥ 65).
  const inEndgame =
    difficulty === "daring" &&
    !isMoonAttempt &&
    Math.max(...state.cumulativeScores.map((s) => s ?? 0)) >= 65;

  // ── Adversarial targeting detection (Daring only) ─────────────────────────
  // Mirrors selectCardToPlayHard: void in led suit + seat 0 winning the current
  // trick → use DARING_ADVERSARIAL weights to prefer dumping Q♠/hearts on the human.
  // Guard: playerIndex !== 0 (Hard is never seat 0 in real play; without this,
  // a simulation placing Hard at seat 0 would withhold Q♠ indefinitely).
  const isAdversarial = (() => {
    if (difficulty !== "daring" || isMoonAttempt || inEndgame || playerIndex === 0) return false;
    if (trick.length === 0) return false;
    const first = trick[0]!;
    const inSuit = valid.filter((c) => c.suit === first.card.suit);
    if (inSuit.length > 0) return false;
    return currentTrickWinner(trick) === 0;
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
    const amGameLeader = myScore <= Math.min(...allScores);
    const trickState = state.currentTrick;
    if (!amGameLeader && trickState.length > 0 && valid.some(isQueenOfSpades)) {
      const first = trickState[0]!;
      const inSuit = valid.filter((c) => c.suit === first.card.suit);
      if (inSuit.length === 0) {
        const winnerIdx = (() => {
          let best = first.playerIndex;
          let bestRank = aceHigh(first.card.rank);
          for (const tc of trickState) {
            if (tc.card.suit === first.card.suit && aceHigh(tc.card.rank) > bestRank) {
              bestRank = aceHigh(tc.card.rank);
              best = tc.playerIndex;
            }
          }
          return best;
        })();
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
        weights.moonProgress * rateMoonAttemptProgress(infoSet, card),
    }))
    .sort((a, b) => b.score - a.score);

  // ── Noise ─────────────────────────────────────────────────────────────────
  const rng = getRng();
  const noiseRate = NOISE_RATE[difficulty];
  if (noiseRate > 0 && rng() < noiseRate) {
    return valid[Math.floor(rng() * valid.length)]!;
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
