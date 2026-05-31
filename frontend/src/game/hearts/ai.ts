/**
 * Hearts AI (#606, #1168).
 *
 * Pure TypeScript rule-based strategy for the 3 computer opponents.
 * Supports Cautious / Schemer / Daring personas via the `difficulty` parameter.
 * No randomness beyond deterministic tie-breaking. No React/AsyncStorage.
 */

import { getValidPlays } from "./engine";
import type { AiPersona, Card, HeartsState, PassDirection, TrickCard } from "./types";

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

/** Returns true when playerIndex's pass lands on seat 0 for the given direction. */
function passingToSeat0(playerIndex: number, direction: PassDirection): boolean {
  if (direction === "none") return false;
  const offset = direction === "left" ? 1 : direction === "right" ? 3 : 2;
  return (playerIndex + offset) % 4 === 0;
}

function passSafeFilter(selected: Card[]): (c: Card) => boolean {
  return (c: Card) => {
    if (selected.some((s) => s.suit === c.suit && s.rank === c.rank)) return false;
    if (c.suit === "clubs" && c.rank === 2) return false;
    if (c.suit === "clubs" && c.rank > 1 && c.rank < 6) return false;
    return true;
  };
}

/**
 * After high-priority cards fill some pass slots, use remaining slots to void a short suit.
 * Finds the shortest eligible suit whose total remaining cards fit within `limit` slots and
 * pushes those cards into `selected`.
 *
 * Uses a looser filter than passSafeFilter: allows clubs <6 so low clubs can complete a void
 * (they're normally deprioritised as filler but are fine to pass for void purposes).
 *
 * @param maxSuitSize - Both tiers pass `3` (Medium) or `3 - selected.length` (Hard); the binding
 *   constraint is always `remaining = 3 - selected.length`, so the effective limit is `remaining`.
 */
function voidOneSuit(
  hand: Card[],
  selected: Card[],
  has2Clubs: boolean,
  keepingQSpade: boolean,
  maxSuitSize: number
): void {
  const remaining = 3 - selected.length;
  if (remaining <= 0 || maxSuitSize <= 0) return;
  const limit = Math.min(remaining, maxSuitSize);

  const bySuit = new Map<string, Card[]>();
  for (const c of hand) {
    if (c.suit === "clubs" && c.rank === 2) continue;
    if (selected.some((s) => s.suit === c.suit && s.rank === c.rank)) continue;
    const group = bySuit.get(c.suit) ?? [];
    group.push(c);
    bySuit.set(c.suit, group);
  }

  let best: Card[] | null = null;
  for (const [suit, cards] of bySuit) {
    if (suit === "clubs" && has2Clubs) continue;
    if (suit === "spades" && keepingQSpade) continue;
    if (cards.length > limit) continue;
    if (best === null || cards.length < best.length) best = cards;
  }

  if (best !== null) {
    for (const c of best) {
      if (selected.length >= 3) break;
      selected.push(c);
    }
  }
}

/** Easy: pass the first 3 safe cards with no strategic logic. Never passes 2♣. */
function selectCardsToPassEasy(hand: Card[]): Card[] {
  const safe = hand.filter((c) => !(c.suit === "clubs" && c.rank === 2));
  return safe.slice(0, 3);
}

/**
 * Medium: select exactly 3 cards to pass. Priority order:
 * 1. Q♠ — pass unless protected; protection threshold varies by direction (#1595):
 *    - "right"/"across": pass even with A♠ or K♠ (Q♠ travels far enough to be safe).
 *      Note: "right" (1 seat) and "across" (2 seats) are treated identically for simplicity.
 *    - "left": keep Q♠ if holding either A♠ or K♠ (left neighbor plays close — higher risk)
 *    - "none": baseline — pass unless holding both A♠ and K♠
 * 2. A♥ only (highest danger heart — always wins heart tricks, most likely to cause damage)
 * 3. Void creation — use remaining slots to eliminate a short suit (≤ 3 cards) (#1636, #1645)
 *    Only A♥ precedes void — K♥/Q♥/J♥ fill slots AFTER voiding. A void provides guaranteed
 *    discard opportunities for the entire hand; a single extra danger heart is less valuable.
 * 4. K♥, Q♥, J♥ — remaining danger hearts fill slots after void
 * 4.5. A♠, K♠ — if not needed to protect Q♠
 * 5. A♣, K♣ — high clubs are dangerous since clubs cycle early
 * 6. Highest remaining safe card (never 2♣ or clubs below 6)
 */
function selectCardsToPassMedium(hand: Card[], direction: PassDirection): Card[] {
  const selected: Card[] = [];

  const has = (suit: string, rank: number) => hand.some((c) => c.suit === suit && c.rank === rank);

  const has2Clubs = hand.some((c) => c.suit === "clubs" && c.rank === 2);
  const spades = hand.filter((c) => c.suit === "spades");
  const hasQSpades = spades.some(isQueenOfSpades);
  const hasASpades = has("spades", 1);
  const hasKSpades = has("spades", 13);
  const voidInSpades = spades.length === 0;

  // Direction changes how boldly we pass Q♠.
  // "right"/"across": Q♠ lands on an opponent who plays farther from us — pass freely.
  // "left": left neighbor plays adjacent to us and gets more opportunities to dump Q♠ back;
  //         keep Q♠ if we hold any high-spade cover (A♠ or K♠ alone suffices).
  // "none": no pass this hand — use baseline protection (A♠ and K♠ both required).
  const qSpadeProtected =
    direction === "right" || direction === "across"
      ? false // always willing to pass Q♠ when it goes far
      : direction === "left"
        ? hasASpades || hasKSpades // keep Q♠ if we have any high-spade protection
        : hasASpades && hasKSpades; // "none": baseline protection check

  if (hasQSpades && !qSpadeProtected && !voidInSpades) {
    selected.push({ suit: "spades", rank: 12 });
  }

  const safe = passSafeFilter(selected);

  // 2. A♥ only — always wins heart tricks; the single most dangerous heart to hold.
  const aceHearts = hand.filter((c) => c.suit === "hearts" && c.rank === 1 && safe(c));
  for (const c of aceHearts) {
    if (selected.length >= 3) break;
    selected.push(c);
  }

  // 3. Void creation — fires before remaining danger hearts so it gets more slots (#1645).
  // Loop to handle e.g. singleton + doubleton in separate eligible suits.
  // Don't target spades when keeping Q♠ — A♠/K♠ are needed as cover cards.
  const keepingQSpade = hasQSpades && !selected.some(isQueenOfSpades);
  {
    let prevLen = -1;
    while (selected.length < 3 && selected.length !== prevLen) {
      prevLen = selected.length;
      voidOneSuit(hand, selected, has2Clubs, keepingQSpade, 3);
    }
  }

  // 4. Remaining danger hearts — K♥, Q♥, J♥ fill slots after void creation.
  const remainingDangerHearts = hand
    .filter((c) => c.suit === "hearts" && c.rank >= 11 && safe(c))
    .sort((a, b) => b.rank - a.rank);
  for (const c of remainingDangerHearts) {
    if (selected.length >= 3) break;
    selected.push(c);
  }

  // 4.5. A♠/K♠ — if not needed to protect Q♠.
  if (selected.length < 3 && !hasQSpades) {
    for (const rank of [1, 13] as const) {
      if (selected.length >= 3) break;
      const card = hand.find((c) => c.suit === "spades" && c.rank === rank && safe(c));
      if (card) selected.push(card);
    }
  }

  // 5. A♣/K♣ fill any remaining slots.
  if (selected.length < 3) {
    for (const rank of [1, 13] as const) {
      if (selected.length >= 3) break;
      const card = hand.find((c) => c.suit === "clubs" && c.rank === rank && safe(c));
      if (card) selected.push(card);
    }
  }

  // 6. Filler: highest remaining safe card.
  // When protecting Q♠, exclude Q♠ itself plus K♠/A♠ cover cards — the void-suit step above
  // skips them intentionally, and passing them here would strip the cover Q♠ needs on future
  // spade leads.
  if (selected.length < 3) {
    const candidates = hand
      .filter(safe)
      .filter(
        (c) =>
          !(
            keepingQSpade &&
            c.suit === "spades" &&
            (c.rank === 1 || c.rank === 12 || c.rank === 13)
          )
      )
      .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
    for (const c of candidates) {
      if (selected.length >= 3) break;
      selected.push(c);
    }
  }

  return selected.slice(0, 3);
}

/**
 * Hard: dangerous-cards-first passing with aggressive void creation (#1636).
 *
 * Moon-viable mode (#1637): if dealt 5+ hearts + Q♠, keep both for a moon attempt.
 * Pass the LOWEST eligible non-hearts (keep Aces/Kings for trick control) and fill with
 * lowest hearts as a last resort; hearts and Q♠ are untouched (#1647).
 *
 * Standard mode priority:
 *   1. Q♠ (always pass unless spade-void).
 *   2. Void creation: use ALL remaining slots to eliminate the shortest eligible suit (#1645).
 *      Immediately after Q♠ so it always gets 2 slots — enough to void a doubleton in ~87%
 *      of hands. Danger hearts fill the slots that remain after voiding.
 *   3. A♥, K♥, Q♥, J♥ (high hearts, highest first) — fill remaining after void.
 *      Going "right": also include 10♥ as an extra danger card (#1595).
 *   4. A♠, K♠ (if Q♠ not present).
 *   4.5. A♣, K♣ — fill remaining slots.
 *   5. Fill any remaining slots with the highest safe cards.
 */
function selectCardsToPassHard(
  hand: Card[],
  direction: PassDirection,
  playerIndex: number
): Card[] {
  const selected: Card[] = [];

  const has2Clubs = hand.some((c) => c.suit === "clubs" && c.rank === 2);
  const heartsInHand = hand.filter((c) => c.suit === "hearts").length;

  const spades = hand.filter((c) => c.suit === "spades");
  const hasQSpades = spades.some(isQueenOfSpades);
  const voidInSpades = spades.length === 0;

  // Adversarial targeting (#1638): when passing to seat 0, always send Q♠ — skip moon-viable.
  // Standard mode already passes Q♠ first, so only moon-viable needs suppressing.
  const targetingHuman = passingToSeat0(playerIndex, direction);

  // Moon-viable passing (#1637): 5+ hearts + Q♠ → keep both, pass lowest non-hearts.
  // strongMoon bypasses adversarial targeting: a moon attempt is impossible without Q♠,
  // so passing it to the human prevents any attempt. At 7+ hearts the completion odds
  // justify keeping Q♠ over the guaranteed adversarial damage.
  const moonViable = heartsInHand >= 5 && hasQSpades; // hasQSpades implies !voidInSpades
  const strongMoon = heartsInHand >= 7 && hasQSpades;
  if (moonViable && (!targetingHuman || strongMoon)) {
    const notSel = (c: Card) => !selected.some((s) => s.suit === c.suit && s.rank === c.rank);
    const moonSafe = (c: Card) =>
      c.suit !== "hearts" &&
      !isQueenOfSpades(c) &&
      !(c.suit === "clubs" && c.rank === 2) &&
      !(c.suit === "clubs" && c.rank > 1 && c.rank < 6) &&
      notSel(c);

    // Pass LOWEST non-hearts first — keep Aces and Kings for trick control (#1647).
    // High cards (A♣, K♦, etc.) are needed to win every trick in a moon attempt.
    const candidates = hand.filter(moonSafe).sort((a, b) => aceHigh(a.rank) - aceHigh(b.rank));
    for (const c of candidates) {
      if (selected.length >= 3) break;
      selected.push(c);
    }

    // Last resort: not enough non-hearts to fill 3 slots (e.g., 7+ hearts dealt).
    // Pass lowest hearts — give up the least valuable cards for the moon attempt.
    if (selected.length < 3) {
      const lowestHearts = hand
        .filter(
          (c) =>
            c.suit === "hearts" && !selected.some((s) => s.suit === c.suit && s.rank === c.rank)
        )
        .sort((a, b) => aceHigh(a.rank) - aceHigh(b.rank));
      for (const c of lowestHearts) {
        if (selected.length >= 3) break;
        selected.push(c);
      }
    }

    return selected.slice(0, 3);
  }

  // Standard Hard passing — Q♠ first, then danger cards.

  // 1. Q♠ — Hard always passes Q♠ regardless of direction.
  if (hasQSpades && !voidInSpades) {
    selected.push({ suit: "spades", rank: 12 });
  }

  const safe = passSafeFilter(selected);

  // 2. Void creation — immediately after Q♠; loop until no more voids fire (#1645).
  // Handles: Q♠ + two singletons (uses all 3 slots), no-Q♠ + doubleton + singleton, etc.
  // Hard always passes Q♠ in standard mode so keepingQSpade is never true here.
  {
    let prevLen = -1;
    while (selected.length < 3 && selected.length !== prevLen) {
      prevLen = selected.length;
      voidOneSuit(hand, selected, has2Clubs, false, 3 - selected.length);
    }
  }

  // 3. High hearts — fill slots remaining after void. Going right, include 10♥ (#1595).
  const heartDangerThreshold = direction === "right" ? 10 : 11;
  const dangerHearts = hand
    .filter(
      (c) => c.suit === "hearts" && (c.rank === 1 || c.rank >= heartDangerThreshold) && safe(c)
    )
    .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
  for (const c of dangerHearts) {
    if (selected.length >= 3) break;
    selected.push(c);
  }

  // 4. High spades if no Q♠.
  if (selected.length < 3 && !hasQSpades) {
    for (const rank of [1, 13] as const) {
      if (selected.length >= 3) break;
      const card = hand.find((c) => c.suit === "spades" && c.rank === rank && safe(c));
      if (card) selected.push(card);
    }
  }

  // 4.5. A♣, K♣ — fill remaining slots.
  if (selected.length < 3) {
    for (const rank of [1, 13] as const) {
      if (selected.length >= 3) break;
      const card = hand.find((c) => c.suit === "clubs" && c.rank === rank && safe(c));
      if (card) selected.push(card);
    }
  }

  // 5. Fill remaining slots with highest safe cards.
  if (selected.length < 3) {
    const candidates = hand.filter(safe).sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
    for (const c of candidates) {
      if (selected.length >= 3) break;
      selected.push(c);
    }
  }

  return selected.slice(0, 3);
}

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
  if (difficulty === "cautious") return selectCardsToPassEasy(hand);
  if (difficulty === "daring") return selectCardsToPassHard(hand, direction, playerIndex);
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

/** Easy: always play the lowest valid card; blocks obvious moonshot attempts. */
function selectCardToPlayEasy(
  hand: Card[],
  trick: TrickCard[],
  state: HeartsState,
  playerIndex: number
): Card {
  void hand;
  const valid = getValidPlays(state, playerIndex);
  if (valid.length === 1) return valid[0]!;

  const moonTarget = detectPotentialMoon(state);

  // Basic moon blocking — dump highest point card when an opponent is threatening
  if (moonTarget !== null && moonTarget !== playerIndex) {
    const pointCards = valid
      .filter((c) => cardPoints(c) > 0)
      .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
    if (pointCards.length > 0) return pointCards[0]!;
  }

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

  // First trick: play highest club — burns dangerous high clubs before they can win later tricks.
  // inSuit is always clubs on trick 1 (leader is forced to play 2♣ by getValidPlays).
  if (state.tricksPlayedInHand === 0) return highest(inSuit) ?? valid[0]!;

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

  // Moon blocking — dump highest safe point card on the moon-shooter's trick.
  // Skip when leading: we'd start the trick and could win it back (e.g. Q♠ discarded to our lead).
  // When following, skip any card that would win a trick already containing Q♠ (self-take),
  // or that is Q♠ and would win the spade trick outright.
  if (moonTarget !== null && moonTarget !== playerIndex && !isLeading) {
    const first = trick[0]!;
    const ledSuit = first.card.suit;
    const inSuit = valid.filter((c) => c.suit === ledSuit);
    const isVoid = inSuit.length === 0;
    const qInTrick = trick.some((tc) => isQueenOfSpades(tc.card));
    let currentWinRank = 0;
    for (const tc of trick) {
      if (tc.card.suit === ledSuit && aceHigh(tc.card.rank) > currentWinRank)
        currentWinRank = aceHigh(tc.card.rank);
    }
    const pointCards = valid
      .filter((c) => {
        if (cardPoints(c) === 0) return false;
        if (isVoid) return true; // off-suit discard can't win the trick
        const rank = aceHigh(c.rank);
        if (isQueenOfSpades(c) && rank > currentWinRank) return false; // Q♠ self-win on spade trick
        if (qInTrick && rank > currentWinRank) return false; // would take a trick with Q♠ in it
        return true;
      })
      .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
    if (pointCards.length > 0) return pointCards[0]!;
  }

  if (isLeading) {
    const seenMedium = new Set<string>();
    for (const pile of state.wonCards) {
      for (const c of pile) seenMedium.add(`${c.suit}:${c.rank}`);
    }
    for (const tc of state.currentTrick) seenMedium.add(`${tc.card.suit}:${tc.card.rank}`);
    return chooseLead(valid, seenMedium.has("spades:12"));
  }

  // First trick: play highest club — burns dangerous high clubs before they can win later tricks.
  if (state.tricksPlayedInHand === 0) {
    const clubs = valid.filter((c) => c.suit === "clubs");
    if (clubs.length > 0) return highest(clubs) ?? valid[0]!;
  }

  return chooseFollow(valid, trick);
}

/**
 * Hard: extends Medium with moon-attempt mode and card counting (#1637).
 * Moon-attempt fires in two modes:
 *   Early: dealt 5+ hearts + Q♠ at the start of a hand — commits from trick 1.
 *   Mid-game: accumulated 5+ hearts + Q♠ and holds every point taken so far.
 * Tracking across wonCards lets the attempt persist after winning the first hearts.
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

  // Detect if this AI player should attempt a moon shot (#1637).
  // Track hearts + Q♠ across both hand and already-won cards so moon mode persists
  // through tricks the AI wins. Require 5+ tricks remaining for feasibility.
  const heartsInHand = hand.filter((c) => c.suit === "hearts").length;
  const heartsWon = (state.wonCards[playerIndex] ?? []).filter((c) => c.suit === "hearts").length;
  const totalHearts = heartsInHand + heartsWon;
  const myHasQ =
    hand.some(isQueenOfSpades) || (state.wonCards[playerIndex] ?? []).some(isQueenOfSpades);
  const totalPointsTaken = state.handScores.reduce((s, v) => s + (v ?? 0), 0);
  const myPoints = state.handScores[playerIndex] ?? 0;
  // Early moon: dealt 5+ hearts + Q♠ — commit from trick 1 before points accumulate.
  // Active for the first 5 tricks (hand.length >= 8); hands off to midMoon after.
  const earlyMoon = heartsInHand >= 5 && myHasQ && heartsWon === 0 && hand.length >= 8;
  // Mid-game moon: accumulated 5+ hearts + Q♠ and hold every point taken so far.
  const midMoon = totalHearts >= 5 && myHasQ && myPoints === totalPointsTaken && hand.length >= 5;
  const isMoonAttempt = earlyMoon || midMoon;

  // Moon blocking — dump highest safe point card on the moon-shooter's trick.
  // Skip when leading (we'd start the trick and could win it back) or moon-attempting ourselves.
  // When following, skip cards that would win a trick already containing Q♠, or Q♠ itself
  // if it would win the spade trick outright — both cause Q♠ self-take.
  if (moonTarget !== null && moonTarget !== playerIndex && !isMoonAttempt && !isLeading) {
    const first = trick[0]!;
    const ledSuit = first.card.suit;
    const inSuit = valid.filter((c) => c.suit === ledSuit);
    const isVoid = inSuit.length === 0;
    const qInTrick = trick.some((tc) => isQueenOfSpades(tc.card));
    let currentWinRank = 0;
    for (const tc of trick) {
      if (tc.card.suit === ledSuit && aceHigh(tc.card.rank) > currentWinRank)
        currentWinRank = aceHigh(tc.card.rank);
    }
    const pointCards = valid
      .filter((c) => {
        if (cardPoints(c) === 0) return false;
        if (isVoid) return true; // off-suit discard can't win the trick
        const rank = aceHigh(c.rank);
        if (isQueenOfSpades(c) && rank > currentWinRank) return false; // Q♠ self-win on spade trick
        if (qInTrick && rank > currentWinRank) return false; // would take a trick with Q♠ in it
        return true;
      })
      .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
    if (pointCards.length > 0) return pointCards[0]!;
  }

  // Moon attempt mode: keep hearts and Q♠, discard everything else.
  if (isMoonAttempt) {
    if (isLeading) {
      const nonHearts = valid.filter((c) => c.suit !== "hearts" && !isQueenOfSpades(c));
      if (nonHearts.length > 0) {
        // Lead HIGHEST non-heart to WIN the trick and keep the lead.
        // Controlling the lead exhausts suits quickly, forcing opponents to discard hearts.
        return highest(nonHearts) ?? valid[0]!;
      }
      // Only hearts/Q♠ remain — lead highest heart to force wins.
      const heartsOnly = valid
        .filter((c) => c.suit === "hearts")
        .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
      if (heartsOnly.length > 0) return heartsOnly[0]!;
    }
    const first = trick[0];
    if (first) {
      const inSuit = valid.filter((c) => c.suit === first.card.suit);
      if (inSuit.length === 0) {
        // Void in led suit — dump highest junk, never hearts or Q♠.
        const junk = valid.filter((c) => c.suit !== "hearts" && !isQueenOfSpades(c));
        if (junk.length > 0) return highest(junk) ?? valid[0]!;
        // All remaining are hearts/Q♠ — give up lowest heart to minimize damage.
        const heartsOnly = valid
          .filter((c) => c.suit === "hearts")
          .sort((a, b) => aceHigh(a.rank) - aceHigh(b.rank));
        return heartsOnly[0] ?? valid[0]!;
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

  // Adversarial targeting (#1638): when void in led suit, prefer dumping Q♠/high hearts on
  // seat 0 (human). When another AI is winning the trick, save Q♠/hearts for seat 0's tricks.
  // Guard playerIndex !== 0: in the real game Hard is never seat 0 (human); without this guard
  // a simulation placing Hard at seat 0 causes Hard to withhold Q♠ indefinitely (no seat-0
  // trick ever fires for Hard's own void plays), tanking its own score.
  if (!isMoonAttempt && !inEndgame && !isLeading && playerIndex !== 0) {
    const first = trick[0];
    if (first) {
      const followSuit = valid.filter((c) => c.suit === first.card.suit);
      if (followSuit.length === 0) {
        const winner = currentTrickWinner(trick);
        if (winner === 0) {
          // Seat 0 is winning — dump Q♠ first, then highest heart.
          const q = valid.find(isQueenOfSpades);
          if (q) return q;
          const heartsDesc = valid
            .filter((c) => c.suit === "hearts")
            .sort((a, b) => aceHigh(b.rank) - aceHigh(a.rank));
          if (heartsDesc.length > 0) return heartsDesc[0]!;
          // No Q♠ or hearts to target with — fall through to normal discard.
        } else {
          // Another AI is winning — prefer non-point discard; save Q♠/hearts for seat 0.
          const nonPts = valid.filter((c) => cardPoints(c) === 0);
          if (nonPts.length > 0) return highest(nonPts) ?? valid[0]!;
          // Only point cards remain — dump lowest heart, keep Q♠ in reserve.
          const heartsAsc = valid
            .filter((c) => c.suit === "hearts")
            .sort((a, b) => aceHigh(a.rank) - aceHigh(b.rank));
          if (heartsAsc.length > 0) return heartsAsc[0]!;
          // No hearts either — must play Q♠ (no safe alternative); fall through.
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

  // First trick: play highest club — burns dangerous high clubs before they can win later tricks.
  if (state.tricksPlayedInHand === 0) {
    const clubs = valid.filter((c) => c.suit === "clubs");
    if (clubs.length > 0) return highest(clubs) ?? valid[0]!;
  }

  return chooseFollow(valid, trick, isMoonAttempt);
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
  if (difficulty === "cautious") return selectCardToPlayEasy(hand, trick, state, playerIndex);
  if (difficulty === "daring") return selectCardToPlayHard(hand, trick, state, playerIndex);
  return selectCardToPlayMedium(hand, trick, state, playerIndex);
}

function chooseLead(valid: Card[], qSpadeGone: boolean): Card {
  // Avoid leading hearts, Q♠, and (until Q♠ is gone) K♠/A♠.
  const safe = valid.filter((c) => {
    if (c.suit === "hearts" || isQueenOfSpades(c)) return false;
    if (c.suit === "spades" && (c.rank === 13 || c.rank === 1) && !qSpadeGone) return false;
    return true;
  });
  const pool = safe.length > 0 ? safe : valid;

  // When holding Q♠, lead shortest non-spade suit to create a void faster (more Q♠ discard opportunities).
  // Otherwise lead longest suit (exhaust safe suits first).
  const holdingQ = valid.some(isQueenOfSpades);
  const leadPool = holdingQ ? pool.filter((c) => c.suit !== "spades") : pool;
  const suitGroups = bySuitDescending(leadPool.length > 0 ? leadPool : pool);
  const targetGroup = holdingQ ? suitGroups[suitGroups.length - 1] : suitGroups[0];
  if (targetGroup) {
    const card = lowest(targetGroup[1]);
    if (card) return card;
  }

  return lowest(pool) ?? valid[0]!;
}

/**
 * Hard lead: same as Medium but uses card counting (seenKeys) to infer safe suits.
 */
function chooseLeadHard(valid: Card[], seenKeys: Set<string>): Card {
  const qSpadeGone = seenKeys.has("spades:12");

  // Avoid leading hearts, Q♠, and (until Q♠ is gone) K♠/A♠.
  const safe = valid.filter((c) => {
    if (c.suit === "hearts") return false;
    if (isQueenOfSpades(c)) return false;
    if (c.suit === "spades" && (c.rank === 13 || c.rank === 1) && !qSpadeGone) return false;
    return true;
  });
  const pool = safe.length > 0 ? safe : valid;

  // Q♠ is last resort — exclude it so it never surfaces as the lowest of any group.
  const poolWithoutQ = pool.filter((c) => !isQueenOfSpades(c));
  const pickFrom = poolWithoutQ.length > 0 ? poolWithoutQ : pool;

  // When holding Q♠, lead shortest non-spade suit to create a void faster (more Q♠ discard opportunities).
  const holdingQ = valid.some(isQueenOfSpades);
  const leadPool = holdingQ ? pickFrom.filter((c) => c.suit !== "spades") : pickFrom;
  const suitGroups = bySuitDescending(leadPool.length > 0 ? leadPool : pickFrom);
  const targetGroup = holdingQ ? suitGroups[suitGroups.length - 1] : suitGroups[0];
  if (targetGroup) {
    const card = lowest(targetGroup[1]);
    if (card) return card;
  }

  return lowest(pickFrom) ?? valid[0]!;
}

/** Lowest card scoring 0 points, or undefined if every card in the array scores points. */
function lowestNonPoint(cards: Card[]): Card | undefined {
  return lowest(cards.filter((c) => cardPoints(c) === 0));
}

function chooseFollow(valid: Card[], trick: readonly TrickCard[], isMoonAttempt = false): Card {
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
    // If Q♠ is a losing card (K♠ or A♠ covering), dump it — it won't come back to us
    const qSpade = inSuit.find(isQueenOfSpades);
    if (!isMoonAttempt && qSpade && aceHigh(qSpade.rank) < winningRank) return qSpade;
    // Moon attempt: win with lowest possible card to conserve high cards for future trick control.
    // pts === 0 implies all inSuit cards have 0 points, so no cardPoints filter needed.
    if (isMoonAttempt) {
      const winningCards = inSuit.filter((c) => aceHigh(c.rank) > winningRank);
      if (winningCards.length > 0) return lowest(winningCards) ?? valid[0]!;
      return lowest(inSuit) ?? valid[0]!; // can't win — minimize waste
    }
    // Safe trick, last to play — exhaust high cards, but never dump a point card onto ourselves
    const safeInSuit = inSuit.filter((c) => cardPoints(c) === 0);
    if (safeInSuit.length > 0) return highest(safeInSuit) ?? valid[0]!;
    return lowest(inSuit) ?? valid[0]!;
  }

  if (pts > 0) {
    if (isMoonAttempt) {
      // Moon attempt: WIN point tricks — play lowest card that beats the current winner.
      const winning = inSuit.filter((c) => aceHigh(c.rank) > winningRank);
      if (winning.length > 0) return lowest(winning) ?? valid[0]!;
      // Can't win — play lowest in-suit (moon shot likely failing; save high cards).
      return lowest(inSuit) ?? valid[0]!;
    }
    // Trick has points — try to lose
    if (losing.length > 0) {
      // Shed Q♠ before K♠: Q♠ is more dangerous even though K♠ has higher rank
      const qSpade = losing.find(isQueenOfSpades);
      if (qSpade) return qSpade;
      return highest(losing) ?? valid[0]!;
    }
    // Must win a point trick — play lowest non-point winner to avoid self-dumping Q♠
    return lowestNonPoint(inSuit) ?? lowest(inSuit) ?? valid[0]!;
  }

  // Moon attempt: win every trick to maintain control, even 0-pt ones (#1647).
  if (isMoonAttempt) {
    const winning = inSuit.filter((c) => aceHigh(c.rank) > winningRank);
    // Guard Q♠ when not last — a later K♠/A♠ could take it and kill the attempt.
    // If Q♠ is the ONLY winner, accept the risk rather than cede board control.
    const safeWinning = isLastToPlay ? winning : winning.filter((c) => !isQueenOfSpades(c));
    const pickFrom = safeWinning.length > 0 ? safeWinning : winning;
    if (pickFrom.length > 0) return lowest(pickFrom) ?? valid[0]!;
    return lowest(inSuit) ?? valid[0]!; // can't win — minimize card loss
  }

  // No points, not last — exhaust highest card that still loses
  if (losing.length > 0) {
    const qSpade = losing.find(isQueenOfSpades);
    if (qSpade) return qSpade;
    return highest(losing) ?? valid[0]!;
  }
  // When forced to win a 0-pt trick, prefer non-point winners to avoid self-dumping Q♠
  return lowestNonPoint(inSuit) ?? lowest(inSuit) ?? valid[0]!;
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
