/**
 * Hearts engine (#604).
 *
 * Pure TypeScript. No React, AsyncStorage, HTTP, timers, or other
 * side-effect imports. The UI replaces the entire HeartsState object
 * on each transition — state is immutable.
 */

import type { AiPreset, Card, HeartsState, PassDirection, Rank, TrickCard } from "./types";
import { RANKS, SUITS } from "./types";

// ---------------------------------------------------------------------------
// Seedable RNG — tests can pin shuffles via setRng(createSeededRng(seed)).
// ---------------------------------------------------------------------------

export type RandomSource = () => number;

let _rng: RandomSource = Math.random;

export function setRng(fn: RandomSource): void {
  _rng = fn;
}

export function createSeededRng(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Deck helpers
// ---------------------------------------------------------------------------

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(_rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

function dealHands(): readonly (readonly Card[])[] {
  const deck = shuffle(createDeck());
  return [deck.slice(0, 13), deck.slice(13, 26), deck.slice(26, 39), deck.slice(39, 52)];
}

function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function isQueenOfSpades(c: Card): boolean {
  return c.suit === "spades" && c.rank === 12;
}

function find2ClubsHolder(hands: readonly (readonly Card[])[]): number {
  for (let i = 0; i < hands.length; i++) {
    if (hands[i]?.some((c) => c.suit === "clubs" && c.rank === 2)) return i;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the pass direction for a given 1-based hand number.
 * Cycle: left → right → across → none → repeat.
 */
export function getPassDirection(handNumber: number): PassDirection {
  const dirs: readonly PassDirection[] = ["left", "right", "across", "none"];
  return dirs[(handNumber - 1) % 4]!;
}

/** Initial game state for a fresh game (hand 1). */
export function dealGame(difficulty: AiPreset = "schemer"): HeartsState {
  const hands = dealHands();
  const passDirection = getPassDirection(1);
  const leaderIndex = passDirection === "none" ? find2ClubsHolder(hands) : 0;
  return {
    _v: 3,
    aiDifficulty: difficulty,
    phase: passDirection === "none" ? "playing" : "passing",
    handNumber: 1,
    passDirection,
    playerHands: hands,
    cumulativeScores: [0, 0, 0, 0],
    handScores: [0, 0, 0, 0],
    scoreHistory: [],
    passSelections: [[], [], [], []],
    passingComplete: false,
    currentTrick: [],
    currentLeaderIndex: leaderIndex,
    currentPlayerIndex: leaderIndex,
    wonCards: [[], [], [], []],
    heartsBroken: false,
    tricksPlayedInHand: 0,
    isComplete: false,
    winnerIndex: null,
  };
}

/**
 * Deal a new hand in an ongoing game (preserves cumulativeScores).
 * Called from the "dealing" phase to transition to "passing"/"playing".
 */
export function dealNextHand(state: HeartsState): HeartsState {
  const handNumber = state.handNumber + 1;
  const passDirection = getPassDirection(handNumber);
  const hands = dealHands();
  const leaderIndex = passDirection === "none" ? find2ClubsHolder(hands) : 0;
  return {
    ...state,
    phase: passDirection === "none" ? "playing" : "passing",
    handNumber,
    passDirection,
    playerHands: hands,
    handScores: [0, 0, 0, 0],
    passSelections: [[], [], [], []],
    passingComplete: false,
    currentTrick: [],
    currentLeaderIndex: leaderIndex,
    currentPlayerIndex: leaderIndex,
    wonCards: [[], [], [], []],
    heartsBroken: false,
    tricksPlayedInHand: 0,
    events: [],
  };
}

/**
 * Toggle a card in/out of a player's pass selection (max 3).
 * Does nothing if the card is not in the player's hand or 3 are already selected
 * and the card is not already selected.
 */
export function selectPassCard(state: HeartsState, playerIndex: number, card: Card): HeartsState {
  const current = [...(state.passSelections[playerIndex] ?? [])];
  const existingIdx = current.findIndex((c) => cardEquals(c, card));
  if (existingIdx >= 0) {
    current.splice(existingIdx, 1);
  } else if (current.length < 3) {
    current.push(card);
  }
  const newSelections = state.passSelections.map((s, i) => (i === playerIndex ? current : [...s]));
  return { ...state, passSelections: newSelections };
}

/**
 * Exchange selected cards per pass direction and transition to "playing".
 * Throws if any player (in a non-"none" hand) has fewer than 3 cards selected.
 */
export function commitPass(state: HeartsState): HeartsState {
  if (state.passDirection === "none") {
    const leaderIndex = find2ClubsHolder(state.playerHands);
    return {
      ...state,
      phase: "playing",
      passingComplete: true,
      currentLeaderIndex: leaderIndex,
      currentPlayerIndex: leaderIndex,
    };
  }

  for (let i = 0; i < 4; i++) {
    if ((state.passSelections[i]?.length ?? 0) < 3) {
      throw new Error(`Player ${i} has not selected 3 cards to pass`);
    }
  }

  const offset = state.passDirection === "left" ? 1 : state.passDirection === "right" ? 3 : 2; // across

  const newHands: Card[][] = state.playerHands.map((h) => [...h]);

  // Remove passed cards from each sender
  for (let i = 0; i < 4; i++) {
    const sel = state.passSelections[i] ?? [];
    newHands[i] = (newHands[i] ?? []).filter((c) => !sel.some((s) => cardEquals(c, s)));
  }

  // Add passed cards to each recipient
  for (let from = 0; from < 4; from++) {
    const to = (from + offset) % 4;
    const sel = state.passSelections[from] ?? [];
    newHands[to] = [...(newHands[to] ?? []), ...sel];
  }

  const leaderIndex = find2ClubsHolder(newHands);

  return {
    ...state,
    phase: "playing",
    playerHands: newHands,
    passSelections: [[], [], [], []],
    passingComplete: true,
    currentLeaderIndex: leaderIndex,
    currentPlayerIndex: leaderIndex,
  };
}

/**
 * Returns all legal cards a player may play in the current game state.
 *
 * Rules:
 * - Trick 0 leader must play 2♣.
 * - Trick 0 followers must follow clubs; if void, may play anything except ♥ or Q♠
 *   (unless the entire hand is ♥/Q♠).
 * - Later leads: may play any suit; hearts banned until broken (unless hand is all hearts).
 * - Later follows: must follow led suit; if void, may play anything.
 */
export function getValidPlays(state: HeartsState, playerIndex: number): Card[] {
  const hand = [...(state.playerHands[playerIndex] ?? [])];
  const isFirstTrick = state.tricksPlayedInHand === 0;
  const isLeading = state.currentTrick.length === 0;

  if (isLeading) {
    if (isFirstTrick) {
      return hand.filter((c) => c.suit === "clubs" && c.rank === 2);
    }
    if (!state.heartsBroken) {
      const nonHearts = hand.filter((c) => c.suit !== "hearts");
      return nonHearts.length > 0 ? nonHearts : hand;
    }
    return hand;
  }

  // Following — must follow led suit if possible
  const ledSuit = state.currentTrick[0]?.card.suit;
  if (!ledSuit) return hand;

  const suitCards = hand.filter((c) => c.suit === ledSuit);
  if (suitCards.length > 0) return suitCards;

  // Void in led suit
  if (isFirstTrick) {
    const safe = hand.filter((c) => c.suit !== "hearts" && !isQueenOfSpades(c));
    return safe.length > 0 ? safe : hand;
  }

  return hand;
}

/**
 * Play a card for a player. Validates the card is a legal play.
 * Automatically resolves the trick and hand when complete.
 */
export function playCard(state: HeartsState, playerIndex: number, card: Card): HeartsState {
  const validPlays = getValidPlays(state, playerIndex);
  if (!validPlays.some((c) => cardEquals(c, card))) {
    throw new Error(`Invalid play: ${card.suit} ${card.rank} for player ${playerIndex}`);
  }

  const newHands = state.playerHands.map((h, i) =>
    i === playerIndex ? h.filter((c) => !cardEquals(c, card)) : [...h]
  );

  const newTrick: TrickCard[] = [...state.currentTrick, { card, playerIndex }];
  const newHeartsBroken = state.heartsBroken || card.suit === "hearts";
  const newEvents = [
    ...(state.events ?? []),
    ...(!state.heartsBroken && card.suit === "hearts" ? ([{ type: "heartsBroken" }] as const) : []),
    ...(isQueenOfSpades(card) ? ([{ type: "queenOfSpadesPlayed" }] as const) : []),
  ];

  let next: HeartsState = {
    ...state,
    playerHands: newHands,
    currentTrick: newTrick,
    heartsBroken: newHeartsBroken,
    currentPlayerIndex: (playerIndex + 1) % 4,
    events: newEvents,
  };

  if (newTrick.length === 4) {
    next = resolveTrick(next, newTrick);
  }

  return next;
}

function resolveTrick(state: HeartsState, trick: readonly TrickCard[]): HeartsState {
  // Ace is high in Hearts; Rank stores it as 1, so treat 1 as 14 when comparing.
  const aceHigh = (r: Rank): number => (r === 1 ? 14 : r);

  const first = trick[0]!;
  const ledSuit = first.card.suit;

  let winnerPlayerIndex = first.playerIndex;
  let winnerRank: Rank = first.card.rank;

  for (let i = 1; i < trick.length; i++) {
    const tc = trick[i]!;
    if (tc.card.suit === ledSuit && aceHigh(tc.card.rank) > aceHigh(winnerRank)) {
      winnerRank = tc.card.rank;
      winnerPlayerIndex = tc.playerIndex;
    }
  }

  const trickCards = trick.map((tc) => tc.card);

  const pointsWon = trickCards.reduce((sum, c) => {
    if (c.suit === "hearts") return sum + 1;
    if (isQueenOfSpades(c)) return sum + 13;
    return sum;
  }, 0);

  const newWonCards = state.wonCards.map((wc, i) =>
    i === winnerPlayerIndex ? [...wc, ...trickCards] : [...wc]
  );

  const newHandScores = state.handScores.map((s, i) =>
    i === winnerPlayerIndex ? (s ?? 0) + pointsWon : (s ?? 0)
  );

  const newTricksPlayed = state.tricksPlayedInHand + 1;

  const queenEvent = trickCards.some(isQueenOfSpades)
    ? ([{ type: "queenOfSpades", takerSeat: winnerPlayerIndex }] as const)
    : ([] as const);

  // Only fire the moonShot event when the moon is NEWLY clinched this trick
  // (null → non-null transition). Subsequent tricks keep detectMoon non-null
  // for the same shooter, so without this guard every trick after clinch would
  // re-emit and replay the animation.
  const prevMoonShooter = detectMoon(state.wonCards);
  const moonShooterMidHand = prevMoonShooter === null ? detectMoon(newWonCards) : null;
  const moonEvent =
    moonShooterMidHand !== null && newTricksPlayed < 13
      ? ([{ type: "moonShot", shooter: moonShooterMidHand }] as const)
      : ([] as const);

  let next: HeartsState = {
    ...state,
    currentTrick: [],
    currentLeaderIndex: winnerPlayerIndex,
    currentPlayerIndex: winnerPlayerIndex,
    wonCards: newWonCards,
    handScores: newHandScores,
    tricksPlayedInHand: newTricksPlayed,
    events: [...(state.events ?? []), ...queenEvent, ...moonEvent],
  };

  if (newTricksPlayed === 13) {
    next = { ...next, phase: "hand_end" };
    // Pass whether the mid-hand moonShot event was already fired so
    // applyHandScoring skips re-emitting it (the AI loop clears events between
    // tricks, so state.events alone cannot be trusted for this check).
    next = applyHandScoring(next, prevMoonShooter !== null);
  }

  return next;
}

/**
 * Returns the player index who shot the moon (took all 13 ♥ + Q♠),
 * or null if no moon was shot this hand.
 */
export function detectMoon(wonCards: readonly (readonly Card[])[]): number | null {
  for (let i = 0; i < wonCards.length; i++) {
    const cards = wonCards[i] ?? [];
    const hearts = cards.filter((c) => c.suit === "hearts").length;
    const hasQ = cards.some(isQueenOfSpades);
    if (hearts === 13 && hasQ) return i;
  }
  return null;
}

/**
 * Apply hand scores to cumulative totals, detect moon, check game over.
 * Transitions phase to "dealing" (show score screen) or "game_over".
 * Call dealNextHand() after this to start the next hand.
 *
 * Appends the post-moon applied delta to scoreHistory so the per-round table
 * stays consistent with cumulativeScores across remounts (#745).
 */
export function applyHandScoring(state: HeartsState, midHandAlreadyFired = false): HeartsState {
  const moonShooter = detectMoon(state.wonCards);

  const newCumulative = state.cumulativeScores.map((s, i) => {
    const base = s ?? 0;
    if (moonShooter !== null) {
      return moonShooter === i ? base : base + 26;
    }
    return base + (state.handScores[i] ?? 0);
  });

  const appliedDelta = newCumulative.map((c, i) => c - (state.cumulativeScores[i] ?? 0));
  const newScoreHistory = [...state.scoreHistory, appliedDelta];

  // midHandAlreadyFired covers the case where the AI loop clears events between
  // tricks — state.events alone can't be trusted if it was wiped since clinch.
  const alreadyFired =
    midHandAlreadyFired || (state.events ?? []).some((e) => e.type === "moonShot");
  const moonEvent =
    moonShooter !== null && !alreadyFired
      ? ([{ type: "moonShot", shooter: moonShooter }] as const)
      : ([] as const);

  if (isGameOver(newCumulative)) {
    return {
      ...state,
      cumulativeScores: newCumulative,
      scoreHistory: newScoreHistory,
      phase: "game_over",
      isComplete: true,
      winnerIndex: getWinner(newCumulative),
      events: [...(state.events ?? []), ...moonEvent],
    };
  }

  return {
    ...state,
    cumulativeScores: newCumulative,
    scoreHistory: newScoreHistory,
    phase: "dealing",
    events: [...(state.events ?? []), ...moonEvent],
  };
}

/** Returns true when any player has reached or exceeded 100 points. */
export function isGameOver(scores: readonly number[]): boolean {
  return scores.some((s) => (s ?? 0) >= 100);
}

/** Returns the index of the player with the lowest score (ties: lowest index). */
export function getWinner(scores: readonly number[]): number {
  let minScore = Infinity;
  let minIdx = 0;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i] ?? Infinity;
    if (s < minScore) {
      minScore = s;
      minIdx = i;
    }
  }
  return minIdx;
}
