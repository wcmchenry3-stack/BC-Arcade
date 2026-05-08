/**
 * Hearts AI (#606, #1168).
 *
 * Pure TypeScript rule-based strategy for the 3 computer opponents.
 * Supports Easy / Medium / Hard difficulty via the `difficulty` parameter.
 * No randomness beyond deterministic tie-breaking. No React/AsyncStorage.
 */

import { getValidPlays } from "./engine";
import type { AiDifficulty, Card, HeartsState, PassDirection, TrickCard } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isQueenOfSpades(c: Card): boolean {
  return c.suit === "spades" && c.rank === 12;
}

function cardPoints(c: Card): number {
  if (c.suit === "hearts") return 1;
  if (isQueenOfSpades(c)) return 13;
  return 0;
}

function trickPoints(trick: readonly TrickCard[]): number {
  return trick.reduce((sum, tc) => sum + cardPoints(tc.card), 0);
}

const aceHigh = (rank: number): number => (rank === 1 ? 14 : rank);

/** Highest card in array, or undefined if empty. */
function highest(cards: Card[]): Card | undefined {
  return cards.reduce<Card | undefined>((best, c) => {
    if (!best) return c;
    return aceHigh(c.rank) > aceHigh(best.rank) ? c : best;
  }, undefined);
}

/** Lowest card in array, or undefined if empty. */
function lowest(cards: Card[]): Card | undefined {
  return cards.reduce<Card | undefined>((best, c) => {
    if (!best) return c;
    return aceHigh(c.rank) < aceHigh(best.rank) ? c : best;
  }, undefined);
}

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

/** Group cards by suit, returning an array of [suit, cards] sorted by count desc. */
function bySuitDescending(cards: Card[]): Array<[string, Card[]]> {
  const map = new Map<string, Card[]>();
  for (const c of cards) {
    const group = map.get(c.suit) ?? [];
    group.push(c);
    map.set(c.suit, group);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

// ---------------------------------------------------------------------------
// Passing strategy
// ---------------------------------------------------------------------------

function passSafeFilter(selected: Card[]): (c: Card) => boolean {
  return (c: Card) => {
    if (selected.some((s) => s.suit === c.suit && s.rank === c.rank)) return false;
    if (c.suit === "clubs" && c.rank === 2) return false;
    if (c.suit === "clubs" && c.rank < 6) return false;
    return true;
  };
}

/** Easy: pass the first 3 safe cards with no strategic logic. Never passes 2♣. */
function selectCardsToPassEasy(hand: Card[]): Card[] {
  const safe = hand.filter((c) => !(c.suit === "clubs" && c.rank === 2));
  return safe.slice(0, 3);
}

/**
 * Medium: select exactly 3 cards to pass. Priority order:
 * 1. Q♠ — unless protected (holding A♠ + K♠) or void in spades
 * 2. A♥, K♥ — highest hearts first
 * 3. A♠, K♠ — if not needed to protect Q♠
 * 4. High cards of suit being voided (longest suit)
 * 5. Never pass: 2♣ or clubs below 6
 */
function selectCardsToPassMedium(hand: Card[], direction: PassDirection): Card[] {
  void direction;
  const selected: Card[] = [];

  const has = (suit: string, rank: number) => hand.some((c) => c.suit === suit && c.rank === rank);

  const spades = hand.filter((c) => c.suit === "spades");
  const hasQSpades = spades.some(isQueenOfSpades);
  const hasASpades = has("spades", 1);
  const hasKSpades = has("spades", 13);
  const qSpadeProtected = hasASpades && hasKSpades;
  const voidInSpades = spades.length === 0;

  if (hasQSpades && !qSpadeProtected && !voidInSpades) {
    selected.push({ suit: "spades", rank: 12 });
  }

  const safe = passSafeFilter(selected);

  const dangerHearts = hand
    .filter((c) => c.suit === "hearts" && (c.rank === 1 || c.rank >= 11) && safe(c))
    .sort((a, b) => {
      const ra = a.rank === 1 ? 14 : a.rank;
      const rb = b.rank === 1 ? 14 : b.rank;
      return rb - ra;
    });
  for (const c of dangerHearts) {
    if (selected.length >= 3) break;
    selected.push(c);
  }

  if (selected.length < 3 && !hasQSpades) {
    for (const rank of [1, 13] as const) {
      if (selected.length >= 3) break;
      const card = hand.find((c) => c.suit === "spades" && c.rank === rank && safe(c));
      if (card) selected.push(card);
    }
  }

  if (selected.length < 3) {
    const candidates = hand.filter(safe).sort((a, b) => {
      const ra = a.rank === 1 ? 14 : a.rank;
      const rb = b.rank === 1 ? 14 : b.rank;
      if (rb !== ra) return rb - ra;
      if (a.suit === "clubs" && b.suit !== "clubs") return 1;
      if (b.suit === "clubs" && a.suit !== "clubs") return -1;
      return 0;
    });
    for (const c of candidates) {
      if (selected.length >= 3) break;
      selected.push(c);
    }
  }

  return selected.slice(0, 3);
}

/**
 * Hard: dangerous-cards-first passing with opportunistic void creation.
 *
 * Priority:
 *   1. Q♠ (always pass, even when protected — unlike Medium).
 *   2. A♥, K♥, Q♥, J♥ (high hearts, highest first).
 *   3. A♠, K♠ (if Q♠ not present).
 *   4. If any slots remain, complete a void in the shortest eligible suit (1 card only,
 *      not 2♣ holder's clubs). Voiding a suit gives Hard a free discard opportunity on
 *      every future lead of that suit without sacrificing a dangerous-card slot.
 *   5. Fill any remaining slots with the highest safe cards.
 */
function selectCardsToPassHard(hand: Card[], direction: PassDirection): Card[] {
  void direction;
  const selected: Card[] = [];

  const has = (suit: string, rank: number) => hand.some((c) => c.suit === suit && c.rank === rank);
  const has2Clubs = has("clubs", 2);

  const spades = hand.filter((c) => c.suit === "spades");
  const hasQSpades = spades.some(isQueenOfSpades);
  const voidInSpades = spades.length === 0;

  // 1. Q♠ (pass even when holding A♠ + K♠)
  if (hasQSpades && !voidInSpades) {
    selected.push({ suit: "spades", rank: 12 });
  }

  const safe = passSafeFilter(selected);

  // 2. High hearts
  const dangerHearts = hand
    .filter((c) => c.suit === "hearts" && (c.rank === 1 || c.rank >= 11) && safe(c))
    .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
  for (const c of dangerHearts) {
    if (selected.length >= 3) break;
    selected.push(c);
  }

  // 3. High spades if no Q♠
  if (selected.length < 3 && !hasQSpades) {
    for (const rank of [1, 13] as const) {
      if (selected.length >= 3) break;
      const card = hand.find((c) => c.suit === "spades" && c.rank === rank && safe(c));
      if (card) selected.push(card);
    }
  }

  // 4. Opportunistic void: if exactly 1 slot remains, use it to void a single-card suit.
  if (selected.length === 2) {
    const notSelected = (c: Card) => !selected.some((s) => s.suit === c.suit && s.rank === c.rank);
    const bySuit = new Map<string, Card[]>();
    for (const c of hand) {
      if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
      bySuit.get(c.suit)!.push(c);
    }
    for (const [suit, cards] of bySuit) {
      if (suit === "clubs" && has2Clubs) continue;
      if (cards.length === 1 && notSelected(cards[0]!)) {
        selected.push(cards[0]!);
        break;
      }
    }
  }

  // 5. Fill remaining slots with highest safe cards
  if (selected.length < 3) {
    const notSelected = (c: Card) => !selected.some((s) => s.suit === c.suit && s.rank === c.rank);
    const candidates = hand.filter((c) => safe(c) && notSelected(c)).sort((a, b) => {
      const diff = aceHigh(b.rank) - aceHigh(a.rank);
      if (diff !== 0) return diff;
      if (a.suit === "clubs" && b.suit !== "clubs") return 1;
      if (b.suit === "clubs" && a.suit !== "clubs") return -1;
      return 0;
    });
    for (const c of candidates) {
      if (selected.length >= 3) break;
      selected.push(c);
    }
  }

  return selected.slice(0, 3);
}

/**
 * Select exactly 3 cards to pass.
 * `difficulty` defaults to "medium" (current behaviour) so existing callers are unchanged.
 */
export function selectCardsToPass(
  hand: Card[],
  direction: PassDirection,
  difficulty: AiDifficulty = "medium"
): Card[] {
  if (difficulty === "easy") return selectCardsToPassEasy(hand);
  if (difficulty === "hard") return selectCardsToPassHard(hand, direction);
  return selectCardsToPassMedium(hand, direction);
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

// ---------------------------------------------------------------------------
// Play strategy
// ---------------------------------------------------------------------------

/** Easy: always play the lowest valid card; no strategic logic. */
function selectCardToPlayEasy(
  hand: Card[],
  trick: TrickCard[],
  state: HeartsState,
  playerIndex: number
): Card {
  void hand;
  const valid = getValidPlays(state, playerIndex);
  if (valid.length === 1) return valid[0]!;

  const isLeading = trick.length === 0;

  if (isLeading) {
    return lowest(valid) ?? valid[0]!;
  }

  const first = trick[0];
  if (!first) return valid[0]!;
  const ledSuit = first.card.suit;
  const inSuit = valid.filter((c) => c.suit === ledSuit);

  // Void in led suit — discard lowest
  if (inSuit.length === 0) return lowest(valid) ?? valid[0]!;

  return lowest(inSuit) ?? valid[0]!;
}

/**
 * Medium: choose a card to play. Always returns a card from getValidPlays.
 *
 * Priority when void (discarding):
 *   1. Dump Q♠ if unprotected
 *   2. Dump highest ♥
 *   3. Dump highest card of longest suit (work toward voiding)
 *
 * Priority when following suit:
 *   - Trick safe (no points) and last to play → play highest to exhaust high cards
 *   - Trick has points → play highest card that still loses
 *   - Would win regardless → play lowest
 *
 * Priority when leading:
 *   - Moon blocking: dump hearts/Q♠ immediately
 *   - First trick: 2♣ (forced by getValidPlays)
 *   - Hearts not broken: lead lowest of longest non-heart suit
 *   - Otherwise: lead lowest non-dangerous card
 */
function selectCardToPlayMedium(
  hand: Card[],
  trick: TrickCard[],
  state: HeartsState,
  playerIndex: number
): Card {
  void hand;
  const valid = getValidPlays(state, playerIndex);
  if (valid.length === 1) return valid[0]!;

  const moonTarget = detectPotentialMoon(state);
  const isLeading = trick.length === 0;

  // Moon blocking — dump points cards ASAP
  if (moonTarget !== null && moonTarget !== playerIndex) {
    const pointCards = valid
      .filter((c) => cardPoints(c) > 0)
      .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
    if (pointCards.length > 0) return pointCards[0]!;
  }

  if (isLeading) {
    return chooseLead(valid);
  }

  return chooseFollow(valid, trick);
}

/**
 * Hard: extends Medium with moon-attempt mode and card counting.
 * When the AI holds 8+ hearts and Q♠ with no points yet taken, it switches
 * to moon-shot mode: preserve hearts/Q♠ and discard everything else.
 * Card counting: infers seen cards from wonCards + currentTrick to identify
 * safe spade leads once all high spades have been played.
 */
function selectCardToPlayHard(
  hand: Card[],
  trick: TrickCard[],
  state: HeartsState,
  playerIndex: number
): Card {
  const valid = getValidPlays(state, playerIndex);
  if (valid.length === 1) return valid[0]!;

  const moonTarget = detectPotentialMoon(state);
  const isLeading = trick.length === 0;

  // Detect if this AI player should attempt a moon shot
  const myHearts = hand.filter((c) => c.suit === "hearts").length;
  const myHasQ = hand.some(isQueenOfSpades);
  const totalPointsTaken = state.handScores.reduce((s, v) => s + (v ?? 0), 0);
  const isMoonAttempt = myHearts >= 8 && myHasQ && totalPointsTaken === 0;

  // Moon blocking (skip if we're the one attempting)
  if (moonTarget !== null && moonTarget !== playerIndex && !isMoonAttempt) {
    const pointCards = valid
      .filter((c) => cardPoints(c) > 0)
      .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
    if (pointCards.length > 0) return pointCards[0]!;
  }

  // Moon attempt mode: keep hearts and Q♠, discard everything else
  if (isMoonAttempt) {
    if (isLeading) {
      const nonHearts = valid.filter((c) => c.suit !== "hearts" && !isQueenOfSpades(c));
      if (nonHearts.length > 0) return lowest(nonHearts) ?? valid[0]!;
    }
    const first = trick[0];
    if (first) {
      const inSuit = valid.filter((c) => c.suit === first.card.suit);
      if (inSuit.length === 0) {
        const nonHearts = valid.filter((c) => c.suit !== "hearts" && !isQueenOfSpades(c));
        if (nonHearts.length > 0) return highest(nonHearts) ?? valid[0]!;
      }
    }
  }

  // Game-timing awareness: once anyone is in endgame range, think about whether
  // ending the game NOW is good or bad for us.
  const scores = state.cumulativeScores;
  const myScore = scores[playerIndex] ?? 0;
  const allScores = scores.map((s) => s ?? 0);
  const maxScore = Math.max(...allScores);
  const amGameLeader = myScore <= Math.min(...allScores);
  const inEndgame = maxScore >= 65 && !isMoonAttempt;

  if (inEndgame && !isLeading) {
    const first = trick[0];
    if (first) {
      const inSuit = valid.filter((c) => c.suit === first.card.suit);
      if (inSuit.length === 0) {
        // We're void — choose discard strategically.
        const trickWinner = currentTrickWinner(trick);
        const winnerScore = allScores[trickWinner] ?? 0;

        // Offensive: score leader is winning — dump highest point card to push them toward 100.
        let scoreLeaderIndex = -1;
        let scoreLeaderScore = -1;
        for (let i = 0; i < 4; i++) {
          if (i === playerIndex) continue;
          const s = allScores[i] ?? 0;
          if (s > scoreLeaderScore) {
            scoreLeaderScore = s;
            scoreLeaderIndex = i;
          }
        }
        if (trickWinner === scoreLeaderIndex) {
          const pointCards = valid
            .filter((c) => cardPoints(c) > 0)
            .sort((a, b) => cardPoints(b) - cardPoints(a) || aceHigh(b.rank) - aceHigh(a.rank));
          if (pointCards.length > 0) return pointCards[0]!;
        }

        // Timing guard: if dumping Q♠ would push the trick winner to 100+ and end the game
        // while we're NOT the game leader, hold Q♠ back — don't hand someone else the win.
        const hasQ = valid.some(isQueenOfSpades);
        if (!amGameLeader && hasQ && winnerScore + 13 >= 100) {
          const withoutQ = valid.filter((c) => !isQueenOfSpades(c));
          // Prefer a non-point card; fall back to lowest point card if forced
          const nonPoint = withoutQ.filter((c) => cardPoints(c) === 0);
          if (nonPoint.length > 0) return lowest(nonPoint) ?? withoutQ[0]!;
          const lowestHeart = withoutQ
            .filter((c) => c.suit === "hearts")
            .sort((a, b) => aceHigh(a.rank) - aceHigh(b.rank));
          if (lowestHeart.length > 0) return lowestHeart[0]!;
          if (withoutQ.length > 0) return withoutQ[0]!;
        }
      }
    }
  }

  // Card counting: track seen cards to inform smarter leading decisions.
  const seenKeys = new Set<string>();
  for (const pile of state.wonCards) {
    for (const c of pile) seenKeys.add(`${c.suit}:${c.rank}`);
  }
  for (const tc of state.currentTrick) seenKeys.add(`${tc.card.suit}:${tc.card.rank}`);

  if (isLeading) {
    return chooseLeadHard(valid, seenKeys);
  }

  return chooseFollow(valid, trick);
}

/**
 * Choose a card to play.
 * `difficulty` defaults to "medium" (current behaviour) so existing callers are unchanged.
 */
export function selectCardToPlay(
  hand: Card[],
  trick: TrickCard[],
  state: HeartsState,
  playerIndex: number,
  difficulty: AiDifficulty = "medium"
): Card {
  if (difficulty === "easy") return selectCardToPlayEasy(hand, trick, state, playerIndex);
  if (difficulty === "hard") return selectCardToPlayHard(hand, trick, state, playerIndex);
  return selectCardToPlayMedium(hand, trick, state, playerIndex);
}

function chooseLead(valid: Card[]): Card {
  // Avoid leading hearts or Q♠ unless forced
  const safe = valid.filter((c) => c.suit !== "hearts" && !isQueenOfSpades(c));
  const pool = safe.length > 0 ? safe : valid;

  // Lead lowest of longest non-heart suit (exhaust safe suits first)
  const suitGroups = bySuitDescending(pool);
  const longestGroup = suitGroups[0];
  if (longestGroup) {
    const card = lowest(longestGroup[1]);
    if (card) return card;
  }

  return lowest(pool) ?? valid[0]!;
}

/**
 * Hard lead: same as Medium but prefers to lead the suit where high cards
 * are known to be exhausted (card counting via seenKeys).
 */
function chooseLeadHard(valid: Card[], seenKeys: Set<string>): Card {
  const qSpadeGone = seenKeys.has("spades:12");

  // If Q♠ is gone, K♠/A♠ are safe to lead — include them in safe pool
  const safe = valid.filter((c) => {
    if (c.suit === "hearts") return false;
    if (isQueenOfSpades(c)) return false;
    // K♠ or A♠ are safe to lead only once Q♠ has been played
    if (c.suit === "spades" && (c.rank === 13 || c.rank === 1) && !qSpadeGone) return false;
    return true;
  });
  const pool = safe.length > 0 ? safe : valid;

  const suitGroups = bySuitDescending(pool);
  const longestGroup = suitGroups[0];
  if (longestGroup) {
    const card = lowest(longestGroup[1]);
    if (card) return card;
  }

  return lowest(pool) ?? valid[0]!;
}

function chooseFollow(valid: Card[], trick: readonly TrickCard[]): Card {
  const first = trick[0];
  if (!first) return valid[0]!;

  const ledSuit = first.card.suit;
  const inSuit = valid.filter((c) => c.suit === ledSuit);
  const isVoid = inSuit.length === 0;

  if (isVoid) {
    return chooseDiscard(valid);
  }

  // Following suit
  const isLastToPlay = trick.length === 3;
  const pts = trickPoints(trick);

  // Find the highest card currently winning the trick in led suit
  let winningRank = 0;
  for (const tc of trick) {
    if (tc.card.suit === ledSuit && aceHigh(tc.card.rank) > winningRank) {
      winningRank = aceHigh(tc.card.rank);
    }
  }

  // Cards that would lose (ace-high rank < winning rank)
  const losing = inSuit.filter((c) => aceHigh(c.rank) < winningRank);

  if (pts === 0 && isLastToPlay) {
    // Safe trick, last to play — exhaust high cards
    return highest(inSuit) ?? valid[0]!;
  }

  if (pts > 0) {
    // Trick has points — try to lose
    if (losing.length > 0) {
      // Play highest card that still loses
      return highest(losing) ?? valid[0]!;
    }
    // Must win — play lowest to minimize damage
    return lowest(inSuit) ?? valid[0]!;
  }

  // No points, not last — play lowest to stay safe
  return lowest(inSuit) ?? valid[0]!;
}

function chooseDiscard(valid: Card[]): Card {
  // 1. Dump Q♠ if in valid plays
  const qSpades = valid.find(isQueenOfSpades);
  if (qSpades) return qSpades;

  // 2. Dump highest heart
  const hearts = valid
    .filter((c) => c.suit === "hearts")
    .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
  if (hearts.length > 0) return hearts[0]!;

  // 3. Dump highest card of longest suit
  const groups = bySuitDescending(valid);
  const longestGroup = groups[0];
  if (longestGroup) {
    const card = highest(longestGroup[1]);
    if (card) return card;
  }

  return valid[0]!;
}
