/**
 * Client-side Blackjack engine.
 *
 * Ported from backend/blackjack/game.py. Pure functions, immutable state.
 * After this port, BlackjackScreen runs the engine locally and makes no
 * HTTP requests during gameplay.
 *
 * Internal engine state carries the full deck and both hands (plus
 * `_doubled` flag). `toViewState()` produces a `BlackjackState` matching
 * the existing UI type, concealing the dealer's hole card during the
 * player phase (mirrors backend's conceal behavior).
 */

import { createRngSlot, createSeededRng } from "../_shared/seededRng";
import { BlackjackGameEvent, BlackjackState, CardResponse, GameRules, HandResponse } from "./types";

const SUITS = ["♠", "♥", "♦", "♣"] as const;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

const RANK_VALUES: Record<string, number> = {
  A: 11,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 10,
  Q: 10,
  K: 10,
};

const RESHUFFLE_THRESHOLD = 15;
const MAX_SPLITS = 3;

export interface Card {
  suit: string;
  rank: string;
}

export const DEFAULT_RULES: GameRules = {
  hit_soft_17: false,
  deck_count: 6,
  penetration: 0.75,
};

export interface RunConfig {
  startingChips: number;
  /** null = no goal; game runs until chips are exhausted (legacy mode). */
  runGoal: number | null;
  betMin: number;
  betMax: number;
  milestones: readonly number[];
  rules?: GameRules;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  startingChips: 1000,
  runGoal: null,
  betMin: 5,
  betMax: 500,
  milestones: [],
};

/**
 * Full engine state — kept in memory + AsyncStorage. The UI never sees
 * this directly; it consumes `toViewState(engineState)` instead.
 */
export interface EngineState {
  chips: number;
  bet: number;
  phase: "betting" | "player" | "result" | "victory";
  outcome: "blackjack" | "win" | "lose" | "push" | null;
  payout: number;
  /** Net chip delta from the previously completed hand. Null until at least one hand resolves. */
  lastWin: number | null;
  deck: Card[];
  player_hand: Card[];
  dealer_hand: Card[];
  doubled: boolean;
  // Split state
  player_hands: Card[][];
  hand_bets: number[];
  hand_outcomes: (string | null)[];
  hand_payouts: number[];
  active_hand_index: number;
  split_count: number;
  split_from_aces: boolean[];
  rules: GameRules;
  events?: readonly BlackjackGameEvent[];
  // Run-mode fields
  runGoal: number | null;
  startingChips: number;
  betMin: number;
  betMax: number;
  milestones: readonly number[];
  milestones_reached: number[];
  /** True once chips have dropped below 25% of startingChips during this run. */
  hitLowChips: boolean;
  /** True after the comeback event has been emitted once for this run. */
  comebackEmitted: boolean;
  /**
   * The goal this run already reached (#2628). Keep Playing clears `runGoal`,
   * so this is how a saved or resumed run still knows it was won. Absent until
   * the player chooses Keep Playing, and on saves from older builds.
   */
  reachedRunGoal?: number;
  /**
   * The replay recorder's round number (#3284): the rounds this run has dealt,
   * counted by the game context (never by the engine, which ignores it). It is
   * saved with the game so a run resumed after a kill carries on numbering its
   * recorded rounds. Absent on saves from older builds and before the first bet.
   */
  round?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function handValue(cards: readonly Card[]): number {
  if (cards.length === 0) return 0;
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += RANK_VALUES[c.rank] ?? 0;
    if (c.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function isNaturalBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

/**
 * The dealer peeks (#3741, standard rules): with an Ace or a ten-value card up
 * (`dealer_hand[1]`; `dealer_hand[0]` is the hole card), the dealer checks for a
 * natural before the player acts. Every dealer natural shows one of these, so
 * every one is found at the deal.
 *
 * Every two-card 21 is an Ace and a ten-value card, so one of them is always the
 * up card: `dealerPeeks(h) && isNaturalBlackjack(h)` equals
 * `isNaturalBlackjack(h)`. The helper is kept to state the rule as dealt.
 */
function dealerPeeks(dealerHand: readonly Card[]): boolean {
  const up = dealerHand[1];
  return up !== undefined && (up.rank === "A" || RANK_VALUES[up.rank] === 10);
}

/**
 * A hand's outcome against the dealer's finished hand (the player's not bust).
 * A natural beats any 21 that is not one (#3741): a 3-card 21, or a split
 * hand's ace and ten, loses to the dealer's natural.
 *
 * The player's hand is never a natural here: a player natural always settles in
 * `placeBet`, so no case for it is needed. And with the peek the dealer's natural
 * settles there too; the natural check below is a guard (a pre-#3741 save is
 * settled on load, `settleUnpeekedDealerNatural`).
 */
function compareHands(player: readonly Card[], dealer: readonly Card[]): "win" | "lose" | "push" {
  const pv = handValue(player);
  const dv = handValue(dealer);
  if (dv > 21 || pv > dv) return "win";
  if (pv < dv) return "lose";
  return isNaturalBlackjack(dealer) ? "lose" : "push";
}

/**
 * Returns true when at least one Ace in the hand is counted as 11.
 * A+6 = soft 17; A+6+K = hard 17 (Ace forced to 1).
 */
export function isSoftHand(cards: readonly Card[]): boolean {
  if (cards.length === 0) return false;
  let rawTotal = 0;
  let numAces = 0;
  for (const c of cards) {
    rawTotal += RANK_VALUES[c.rank] ?? 0;
    if (c.rank === "A") numAces += 1;
  }
  if (numAces === 0) return false;
  const best = handValue(cards);
  // Number of Aces that had to be reduced from 11 → 1 to stay ≤ 21
  const reductions = (rawTotal - best) / 10;
  return best <= 21 && numAces > reductions;
}

function cardsCanSplit(cards: readonly Card[]): boolean {
  if (cards.length !== 2) return false;
  const cardA = cards[0];
  const cardB = cards[1];
  if (cardA === undefined || cardB === undefined) return false;
  const a = cardA.rank;
  const b = cardB.rank;
  if (a === b) return true;
  return (RANK_VALUES[a] ?? 0) === 10 && (RANK_VALUES[b] ?? 0) === 10;
}

// ---------------------------------------------------------------------------
// Seedable RNG
//
// The deck shuffle goes through `rngSlot.rng` so tests and e2e flows can pin the
// deal sequence with `setRng(createSeededRng(seed))`. Default is Math.random
// for normal gameplay. Tests that call setRng must restore Math.random in
// afterEach to avoid leaking determinism into later tests.
// ---------------------------------------------------------------------------

const rngSlot = createRngSlot();
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export const setRng = rngSlot.setRng;
/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export { createSeededRng };

function freshShuffledDeck(deckCount: number = 1): Card[] {
  const deck: Card[] = [];
  for (let d = 0; d < deckCount; d++) {
    for (const s of SUITS) {
      for (const r of RANKS) {
        deck.push({ suit: s, rank: r });
      }
    }
  }
  // Fisher–Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rngSlot.rng() * (i + 1));
    const tmp = deck[i];
    const dj = deck[j];
    if (tmp !== undefined && dj !== undefined) {
      deck[i] = dj;
      deck[j] = tmp;
    }
  }
  return deck;
}

/**
 * Draw one card from a deck. Returns the new deck (with one fewer card)
 * and the drawn card. Auto-reshuffles if the deck runs dry mid-draw.
 */
function deal(deck: Card[], deckCount: number = 1): { deck: Card[]; card: Card } {
  const working = deck.length === 0 ? freshShuffledDeck(deckCount) : deck;
  const next = [...working];
  const card = next.pop()!;
  return { deck: next, card };
}

// ---------------------------------------------------------------------------
// Milestone helpers
// ---------------------------------------------------------------------------

function advanceMilestonesReached(s: EngineState, newChips: number): number[] {
  if (s.milestones.length === 0) return s.milestones_reached;
  const newly = s.milestones.filter((t) => !s.milestones_reached.includes(t) && newChips >= t);
  return newly.length > 0 ? [...s.milestones_reached, ...newly] : s.milestones_reached;
}

function pendingMilestoneEvents(prev: EngineState, next: EngineState): BlackjackGameEvent[] {
  if (prev.milestones_reached.length === next.milestones_reached.length) return [];
  return next.milestones_reached
    .filter((t) => !prev.milestones_reached.includes(t))
    .map((value) => ({ type: "milestone" as const, value }));
}

function pendingComebackEvents(prev: EngineState, next: EngineState): BlackjackGameEvent[] {
  if (next.comebackEmitted && !prev.comebackEmitted) return [{ type: "comeback" as const }];
  return [];
}

function applyLowChipsTracking(
  s: EngineState,
  newChips: number
): Pick<EngineState, "hitLowChips" | "comebackEmitted"> {
  const threshold25 = s.startingChips * 0.25;
  const threshold75 = s.startingChips * 0.75;
  const hitLowChips = s.hitLowChips || newChips < threshold25;
  const triggerComeback = !s.comebackEmitted && hitLowChips && newChips >= threshold75;
  return { hitLowChips, comebackEmitted: s.comebackEmitted || triggerComeback };
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function outcomeEvent(outcome: "blackjack" | "win" | "lose" | "push"): BlackjackGameEvent {
  if (outcome === "blackjack") return { type: "blackjack" };
  if (outcome === "win") return { type: "win" };
  if (outcome === "lose") return { type: "loss" };
  return { type: "push" };
}

// ---------------------------------------------------------------------------
// View projection
// ---------------------------------------------------------------------------

function handResponse(cards: readonly Card[], concealHole: boolean): HandResponse {
  const cardResponses: CardResponse[] = cards.map((c, i) => {
    if (concealHole && i === 0) {
      return { rank: "?", suit: "?", face_down: true };
    }
    return { rank: c.rank, suit: c.suit, face_down: false };
  });
  const value = concealHole ? 0 : handValue(cards);
  const soft = concealHole ? false : isSoftHand(cards);
  return { cards: cardResponses, value, soft };
}

export function canSplit(s: EngineState): boolean {
  if (s.phase !== "player") return false;
  if (s.split_count >= MAX_SPLITS) return false;
  const isSplit = s.split_count > 0;
  let hand: readonly Card[];
  let handBet: number;
  let totalWagered: number;
  if (isSplit) {
    const h = s.player_hands[s.active_hand_index];
    const hb = s.hand_bets[s.active_hand_index];
    if (h === undefined || hb === undefined) return false;
    hand = h;
    handBet = hb;
    totalWagered = s.hand_bets.reduce((a, b) => a + b, 0);
  } else {
    hand = s.player_hand;
    handBet = s.bet;
    totalWagered = s.bet;
  }
  if (!cardsCanSplit(hand)) return false;
  const freeStack = s.chips - totalWagered;
  return freeStack >= handBet;
}

export function toViewState(s: EngineState): BlackjackState {
  const concealing = s.phase === "player";
  const isSplit = s.split_count > 0;

  let double_down_available = false;
  if (s.phase === "player") {
    if (isSplit) {
      const hand = s.player_hands[s.active_hand_index];
      const handBet = s.hand_bets[s.active_hand_index];
      const isAceHand = s.split_from_aces[s.active_hand_index];
      if (hand !== undefined && handBet !== undefined) {
        const totalWagered = s.hand_bets.reduce((a, b) => a + b, 0);
        const freeStack = s.chips - totalWagered;
        double_down_available = hand.length === 2 && !isAceHand && freeStack >= handBet;
      }
    } else {
      double_down_available = s.player_hand.length === 2 && s.chips >= s.bet * 2;
    }
  }

  const game_over = s.chips === 0 && s.phase === "result";

  let player_hands_view: HandResponse[];
  if (isSplit) {
    player_hands_view = s.player_hands.map((h) => handResponse(h, false));
  } else {
    player_hands_view = s.player_hand.length > 0 ? [handResponse(s.player_hand, false)] : [];
  }

  return {
    phase: s.phase,
    chips: s.chips,
    bet: s.bet,
    player_hand: isSplit
      ? handResponse(
          s.player_hands[Math.min(s.active_hand_index, s.player_hands.length - 1)] ?? s.player_hand,
          false
        )
      : handResponse(s.player_hand, false),
    dealer_hand: handResponse(s.dealer_hand, concealing),
    outcome: s.outcome,
    payout: s.payout,
    last_win: s.lastWin,
    game_over,
    double_down_available,
    split_available: canSplit(s),
    player_hands: player_hands_view,
    hand_bets: isSplit ? [...s.hand_bets] : s.bet ? [s.bet] : [],
    active_hand_index: s.active_hand_index,
    hand_outcomes: isSplit ? [...s.hand_outcomes] : s.outcome !== null ? [s.outcome] : [],
    hand_payouts: isSplit ? [...s.hand_payouts] : s.payout !== 0 ? [s.payout] : [],
    rules: s.rules,
    events: s.events,
    run_goal: s.runGoal,
    run_starting_chips: s.startingChips,
    run_complete: s.phase === "victory",
  };
}

// ---------------------------------------------------------------------------
// Public API — pure state transitions
// ---------------------------------------------------------------------------

function emptySplitState(): Pick<
  EngineState,
  | "player_hands"
  | "hand_bets"
  | "hand_outcomes"
  | "hand_payouts"
  | "active_hand_index"
  | "split_count"
  | "split_from_aces"
> {
  return {
    player_hands: [],
    hand_bets: [],
    hand_outcomes: [],
    hand_payouts: [],
    active_hand_index: 0,
    split_count: 0,
    split_from_aces: [],
  };
}

export function newGame(deck?: Card[], runConfig?: Partial<RunConfig>): EngineState {
  const rc = { ...DEFAULT_RUN_CONFIG, ...runConfig };
  const r = rc.rules ?? DEFAULT_RULES;
  return {
    chips: rc.startingChips,
    bet: 0,
    phase: "betting",
    outcome: null,
    payout: 0,
    lastWin: null,
    deck: deck ?? freshShuffledDeck(r.deck_count),
    player_hand: [],
    dealer_hand: [],
    doubled: false,
    rules: r,
    runGoal: rc.runGoal,
    startingChips: rc.startingChips,
    betMin: rc.betMin,
    betMax: rc.betMax,
    milestones: rc.milestones ?? [],
    milestones_reached: [],
    hitLowChips: false,
    comebackEmitted: false,
    ...emptySplitState(),
  };
}

function settleWith(s: EngineState, outcome: "blackjack" | "win" | "lose" | "push"): EngineState {
  let delta = 0;
  if (outcome === "blackjack") delta = Math.ceil(s.bet * 1.5);
  else if (outcome === "win") delta = s.bet;
  else if (outcome === "lose") delta = -s.bet;
  // push: delta 0
  const newChips = Math.max(0, s.chips + delta);
  const phase = s.runGoal !== null && newChips >= s.runGoal ? "victory" : "result";
  return {
    ...s,
    outcome,
    payout: delta,
    chips: newChips,
    phase,
    milestones_reached: advanceMilestonesReached(s, newChips),
    ...applyLowChipsTracking(s, newChips),
  };
}

/**
 * The bets `placeBet` accepts from this stack at this table: from the table
 * minimum (or all-in, on a short stack below it) up to the table maximum or
 * the stack, whichever is less. Null when the run has no chips to bet. The UI
 * reads this to offer only bets the engine will take (#3580).
 */
export function legalBetRange(
  s: Pick<EngineState, "chips" | "betMin" | "betMax">
): { min: number; max: number } | null {
  if (s.chips <= 0) return null;
  // Short stack (0 < chips < betMin): the only legal bet is all-in.
  return { min: s.chips < s.betMin ? s.chips : s.betMin, max: Math.min(s.betMax, s.chips) };
}

/**
 * A game saved mid-hand by a build from before the peek (#3741), against a
 * dealer natural the peek would have found: settled now as the peek would have
 * settled it at the deal. The rule (applied on load, by the game context's load
 * path, `BlackjackGameContext.tsx`, which records the round like any other):
 *
 * - Only a save still in the player's phase with a dealer natural changes; any
 *   other save (betting, settled, or a dealer hand that is not a natural) is
 *   returned as it is.
 * - The hand goes back to its two dealt cards, with no split and no double, and
 *   settles for the original bet only. So a save already split, or with cards
 *   hit, never loses more than that bet (a single hand's double settles at once,
 *   so no doubled save is in this phase).
 * - Chips, victory, milestones and the low-chips tracking update as for any
 *   settlement; no events (a restored round replays nothing).
 */
export function settleUnpeekedDealerNatural(s: EngineState): EngineState {
  if (s.phase !== "player" || !isNaturalBlackjack(s.dealer_hand)) return s;
  // `player_hand` is the two cards dealt and any hit on them: a split and its
  // re-splits only change `player_hands`, so its first two are the dealt pair.
  const dealt = s.player_hand.slice(0, 2);
  const restored: EngineState = {
    ...s,
    player_hand: dealt,
    doubled: false,
    ...emptySplitState(),
  };
  // A push only if the dealt pair is a natural. No real save reaches it: old
  // builds also settled a player natural in `placeBet`, so it never reached the
  // player's phase. Kept as a guard.
  const settled = settleWith(restored, isNaturalBlackjack(dealt) ? "push" : "lose");
  return { ...settled, events: undefined };
}

export function placeBet(s: EngineState, amount: number): EngineState {
  if (s.phase !== "betting") throw new Error("Not in betting phase.");
  // A run with no chips is over; a zero wager is never a valid bet.
  const range = legalBetRange(s);
  if (range === null) throw new Error("No chips to bet.");
  if (amount <= 0) throw new Error("Bet must be greater than zero.");
  const effectiveMin = range.min;
  if (amount < effectiveMin || amount > s.betMax) {
    throw new Error(`Bet must be between ${effectiveMin} and ${s.betMax}.`);
  }
  if (amount > s.chips) throw new Error("Insufficient chips.");

  // Deal player, dealer, player, dealer
  let deck = s.deck;
  const playerHand: Card[] = [];
  const dealerHand: Card[] = [];
  for (let i = 0; i < 2; i++) {
    let r = deal(deck, s.rules.deck_count);
    deck = r.deck;
    playerHand.push(r.card);
    r = deal(deck, s.rules.deck_count);
    deck = r.deck;
    dealerHand.push(r.card);
  }

  const afterDeal: EngineState = {
    ...s,
    bet: amount,
    doubled: false,
    outcome: null,
    payout: 0,
    deck,
    player_hand: playerHand,
    dealer_hand: dealerHand,
    events: undefined,
    ...emptySplitState(),
  };

  const allInEvents: BlackjackGameEvent[] = amount === s.chips ? [{ type: "allIn" as const }] : [];

  // Naturals settle at the deal: the player's, and the dealer's found by the
  // peek (#3741). The dealer's natural costs only the original bet, since no
  // double or split could be taken; natural against natural is a push.
  const playerNatural = isNaturalBlackjack(playerHand);
  const dealerNatural = dealerPeeks(dealerHand) && isNaturalBlackjack(dealerHand);
  if (playerNatural || dealerNatural) {
    const outcome = dealerNatural ? (playerNatural ? "push" : "lose") : "blackjack";
    const settled = settleWith(afterDeal, outcome);
    const msEvents = pendingMilestoneEvents(afterDeal, settled);
    const cbEvents = pendingComebackEvents(afterDeal, settled);
    return {
      ...settled,
      events: [
        ...allInEvents,
        { type: "cardDeal" },
        { type: "cardDeal" },
        outcomeEvent(outcome),
        ...msEvents,
        ...cbEvents,
      ],
    };
  }
  return {
    ...afterDeal,
    phase: "player",
    events: [...allInEvents, { type: "cardDeal" }, { type: "cardDeal" }],
  };
}

function dealerShouldDraw(hand: readonly Card[], hitSoft17: boolean): boolean {
  const dv = handValue(hand);
  if (dv < 17) return true;
  if (dv === 17 && hitSoft17 && isSoftHand(hand)) return true;
  return false;
}

function dealerPlay(s: EngineState): EngineState {
  let working = s;
  while (dealerShouldDraw(working.dealer_hand, working.rules.hit_soft_17)) {
    const { deck, card } = deal(working.deck, working.rules.deck_count);
    working = { ...working, deck, dealer_hand: [...working.dealer_hand, card] };
  }
  return working;
}

function determineAndSettle(s: EngineState): EngineState {
  return settleWith(s, compareHands(s.player_hand, s.dealer_hand));
}

// ---------------------------------------------------------------------------
// Split-specific helpers
// ---------------------------------------------------------------------------

function settleHand(s: EngineState, idx: number, outcome: "win" | "lose" | "push"): EngineState {
  const bet = s.hand_bets[idx] ?? 0;
  let delta = 0;
  if (outcome === "win") delta = bet;
  else if (outcome === "lose") delta = -bet;
  const newOutcomes = [...s.hand_outcomes];
  newOutcomes[idx] = outcome;
  const newPayouts = [...s.hand_payouts];
  newPayouts[idx] = delta;
  return { ...s, hand_outcomes: newOutcomes, hand_payouts: newPayouts };
}

function finishIfAllHandsDone(s: EngineState): EngineState {
  if (s.active_hand_index < s.player_hands.length) return s;

  let working = s;
  const unsettled = working.hand_outcomes
    .map((o, i) => (o === null ? i : -1))
    .filter((i) => i >= 0);

  if (unsettled.length > 0) {
    working = dealerPlay(working);
    for (const i of unsettled) {
      // A split hand's ace and ten make 21, not a natural.
      const ph = working.player_hands[i] ?? [];
      working = settleHand(working, i, compareHands(ph, working.dealer_hand));
    }
  }

  const totalPayout = working.hand_payouts.reduce((a, b) => a + b, 0);
  const wins = working.hand_outcomes.filter((o) => o === "win").length;
  const losses = working.hand_outcomes.filter((o) => o === "lose").length;

  let overallOutcome: "win" | "lose" | "push";
  if (wins > 0 && losses === 0) overallOutcome = "win";
  else if (losses > 0 && wins === 0) overallOutcome = "lose";
  else if (wins === 0 && losses === 0) overallOutcome = "push";
  else if (totalPayout > 0) overallOutcome = "win";
  else if (totalPayout < 0) overallOutcome = "lose";
  else overallOutcome = "push";

  const finalChips = Math.max(0, working.chips + totalPayout);
  const finalPhase =
    working.runGoal !== null && finalChips >= working.runGoal ? "victory" : "result";
  return {
    ...working,
    payout: totalPayout,
    chips: finalChips,
    outcome: overallOutcome,
    phase: finalPhase,
    milestones_reached: advanceMilestonesReached(working, finalChips),
    ...applyLowChipsTracking(working, finalChips),
  };
}

/**
 * A hand on 21 stands on its own (#3764): from the hand to play, every split hand already on 21
 * (one dealt 21 by the split, like a split 10 that drew an Ace) is passed over. Split aces are
 * never the hand to play (they get one card each and are passed at the split), so this never
 * touches them.
 */
function passTwentyOnes(s: EngineState): EngineState {
  let i = s.active_hand_index;
  while (
    i < s.player_hands.length &&
    (s.hand_outcomes[i] ?? null) === null &&
    handValue(s.player_hands[i] ?? []) === 21
  ) {
    i++;
  }
  return i === s.active_hand_index ? s : { ...s, active_hand_index: i };
}

function advanceHand(s: EngineState): EngineState {
  return finishIfAllHandsDone(passTwentyOnes({ ...s, active_hand_index: s.active_hand_index + 1 }));
}

/**
 * The events of a split action that may have settled the round: `lead` (the action's own), then,
 * when the round settled, its outcome, and any milestone or comeback it reached.
 */
function splitRoundEvents(
  prev: EngineState,
  next: EngineState,
  lead: readonly BlackjackGameEvent[]
): BlackjackGameEvent[] {
  if (next.phase === "player" || next.outcome === null) return [...lead];
  return [
    ...lead,
    outcomeEvent(next.outcome as "win" | "lose" | "push"),
    ...pendingMilestoneEvents(prev, next),
    ...pendingComebackEvents(prev, next),
  ];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function hit(s: EngineState): EngineState {
  if (s.phase !== "player") throw new Error("Not in player phase.");

  if (s.split_count > 0) {
    if (s.split_from_aces[s.active_hand_index]) {
      throw new Error("Cannot hit on split aces.");
    }
    const { deck, card } = deal(s.deck);
    const newHands = s.player_hands.map((h, i) => (i === s.active_hand_index ? [...h, card] : h));
    const busted = handValue(newHands[s.active_hand_index] ?? []) > 21;
    const events: BlackjackGameEvent[] = [{ type: "cardDeal" }];
    if (busted) events.push({ type: "bust" });
    let next: EngineState = { ...s, deck, player_hands: newHands, events };
    if (busted) {
      next = settleHand(next, s.active_hand_index, "lose");
      const advanced = advanceHand(next);
      const msEvents = pendingMilestoneEvents(s, advanced);
      const cbEvents = pendingComebackEvents(s, advanced);
      const extras = [...msEvents, ...cbEvents];
      return { ...advanced, events: extras.length > 0 ? [...events, ...extras] : events };
    }
    if (handValue(newHands[s.active_hand_index] ?? []) === 21) {
      // 21 stands on its own (#3764): the next hand is played, or the dealer after the last.
      const advanced = advanceHand(next);
      return { ...advanced, events: splitRoundEvents(s, advanced, events) };
    }
    return next;
  }

  const { deck, card } = deal(s.deck);
  const next: EngineState = {
    ...s,
    deck,
    player_hand: [...s.player_hand, card],
  };
  if (handValue(next.player_hand) > 21) {
    const settled = settleWith(next, "lose");
    const msEvents = pendingMilestoneEvents(next, settled);
    const cbEvents = pendingComebackEvents(next, settled);
    return {
      ...settled,
      events: [{ type: "cardDeal" }, { type: "bust" }, ...msEvents, ...cbEvents],
    };
  }
  if (handValue(next.player_hand) === 21) {
    // 21 stands on its own (#3764): the dealer's turn and the settlement, as a Stand plays them.
    const stood = stand(next);
    return { ...stood, events: [{ type: "cardDeal" }, ...(stood.events ?? [])] };
  }
  return { ...next, events: [{ type: "cardDeal" }] };
}

export function stand(s: EngineState): EngineState {
  if (s.phase !== "player") throw new Error("Not in player phase.");
  if (s.split_count > 0) {
    const next = advanceHand({ ...s, events: undefined });
    if (next.phase === "result" && next.outcome !== null) {
      const msEvents = pendingMilestoneEvents(s, next);
      const cbEvents = pendingComebackEvents(s, next);
      return {
        ...next,
        events: [outcomeEvent(next.outcome as "win" | "lose" | "push"), ...msEvents, ...cbEvents],
      };
    }
    return next;
  }
  const next = determineAndSettle(dealerPlay({ ...s, events: undefined }));
  const msEvents = pendingMilestoneEvents(s, next);
  const cbEvents = pendingComebackEvents(s, next);
  return {
    ...next,
    events: [outcomeEvent(next.outcome as "win" | "lose" | "push"), ...msEvents, ...cbEvents],
  };
}

/**
 * A game saved by a build from before #3764 with the hand to play already on 21 (it then waited
 * for a Stand): stood now, as the load path's choice (`BlackjackGameContext.tsx`, which records
 * the stand as the round's action). A single hand settles with the dealer's turn; a split hand
 * moves play on to the next hand (or the dealer). Any other save is returned as it is. No events:
 * a restored round replays nothing.
 */
export function standOnTwentyOne(s: EngineState): EngineState {
  if (s.phase !== "player") return s;
  const hand = s.split_count > 0 ? s.player_hands[s.active_hand_index] : s.player_hand;
  if (hand === undefined || handValue(hand) !== 21) return s;
  return { ...stand(s), events: undefined };
}

export function doubleDown(s: EngineState): EngineState {
  if (s.phase !== "player") throw new Error("Not in player phase.");

  if (s.split_count > 0) {
    const idx = s.active_hand_index;
    const hand = s.player_hands[idx];
    const handBet = s.hand_bets[idx];
    if (hand === undefined || handBet === undefined) {
      throw new Error("Invalid split state: hand index out of bounds");
    }

    if (s.split_from_aces[idx]) {
      throw new Error("Cannot double down on split aces.");
    }
    if (hand.length !== 2) {
      throw new Error("Double down only allowed on initial two cards.");
    }
    const totalWagered = s.hand_bets.reduce((a, b) => a + b, 0);
    const freeStack = s.chips - totalWagered;
    if (freeStack < handBet) {
      throw new Error("Insufficient chips to double down.");
    }

    const { deck, card } = deal(s.deck);
    const newHands = s.player_hands.map((h, i) => (i === idx ? [...h, card] : h));
    const newBets = [...s.hand_bets];
    newBets[idx] = handBet * 2;

    const busted = handValue(newHands[idx] ?? []) > 21;
    const splitDoubleEvents: BlackjackGameEvent[] = [{ type: "cardDeal" }];
    if (busted) splitDoubleEvents.push({ type: "bust" });
    let next: EngineState = {
      ...s,
      deck,
      player_hands: newHands,
      hand_bets: newBets,
      events: splitDoubleEvents,
    };
    if (busted) {
      next = settleHand(next, idx, "lose");
    }
    const advanced = advanceHand(next);
    const msEvents = pendingMilestoneEvents(s, advanced);
    const cbEvents = pendingComebackEvents(s, advanced);
    if (advanced.phase === "result" && advanced.outcome !== null && !busted) {
      return {
        ...advanced,
        events: [
          ...splitDoubleEvents,
          outcomeEvent(advanced.outcome as "win" | "lose" | "push"),
          ...msEvents,
          ...cbEvents,
        ],
      };
    }
    return { ...advanced, events: [...splitDoubleEvents, ...msEvents, ...cbEvents] };
  }

  if (s.player_hand.length !== 2) {
    throw new Error("Double down only allowed on initial two cards.");
  }
  if (s.chips < s.bet * 2) throw new Error("Insufficient chips to double down.");

  const { deck, card } = deal(s.deck, s.rules.deck_count);
  const afterDouble: EngineState = {
    ...s,
    bet: s.bet * 2,
    doubled: true,
    deck,
    player_hand: [...s.player_hand, card],
    events: undefined,
  };

  if (handValue(afterDouble.player_hand) > 21) {
    const settled = settleWith(afterDouble, "lose");
    const msEvents = pendingMilestoneEvents(afterDouble, settled);
    const cbEvents = pendingComebackEvents(afterDouble, settled);
    return {
      ...settled,
      events: [{ type: "cardDeal" }, { type: "bust" }, ...msEvents, ...cbEvents],
    };
  }
  const settled = determineAndSettle(dealerPlay(afterDouble));
  const msEvents = pendingMilestoneEvents(s, settled);
  const cbEvents = pendingComebackEvents(s, settled);
  return {
    ...settled,
    events: [
      { type: "cardDeal" },
      outcomeEvent(settled.outcome as "win" | "lose" | "push"),
      ...msEvents,
      ...cbEvents,
    ],
  };
}

export function split(s: EngineState): EngineState {
  if (s.phase !== "player") throw new Error("Not in player phase.");
  if (s.split_count >= MAX_SPLITS) throw new Error("Maximum number of splits reached.");
  s = { ...s, events: undefined };

  const isSplit = s.split_count > 0;
  const hand: readonly Card[] = isSplit
    ? (s.player_hands[s.active_hand_index] ?? s.player_hand)
    : s.player_hand;
  const handBet: number = isSplit ? (s.hand_bets[s.active_hand_index] ?? s.bet) : s.bet;

  if (!cardsCanSplit(hand)) throw new Error("Hand cannot be split.");

  const totalWagered = isSplit ? s.hand_bets.reduce((a, b) => a + b, 0) : s.bet;
  const freeStack = s.chips - totalWagered;
  if (freeStack < handBet) throw new Error("Insufficient chips to split.");

  const cardA = hand[0];
  const cardB = hand[1];
  if (cardA === undefined || cardB === undefined) {
    throw new Error("Invalid hand: expected 2 cards for split.");
  }
  const isAceSplit = cardA.rank === "A";

  let next: EngineState;

  if (!isSplit) {
    // First split: migrate to multi-hand mode
    let dk = s.deck;
    let r = deal(dk, s.rules.deck_count);
    dk = r.deck;
    const hand0 = [cardA, r.card];
    r = deal(dk, s.rules.deck_count);
    dk = r.deck;
    const hand1 = [cardB, r.card];

    next = {
      ...s,
      deck: dk,
      split_count: 1,
      player_hands: [hand0, hand1],
      hand_bets: [handBet, handBet],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      active_hand_index: 0,
      split_from_aces: [isAceSplit, isAceSplit],
    };
  } else {
    // Resplit: split the active hand
    const idx = s.active_hand_index;
    let dk = s.deck;
    let r = deal(dk, s.rules.deck_count);
    dk = r.deck;
    const newHand0 = [cardA, r.card];
    r = deal(dk, s.rules.deck_count);
    dk = r.deck;
    const newHand1 = [cardB, r.card];

    const newHands = [...s.player_hands];
    newHands[idx] = newHand0;
    newHands.splice(idx + 1, 0, newHand1);
    const newBets = [...s.hand_bets];
    newBets.splice(idx + 1, 0, handBet);
    const newOutcomes = [...s.hand_outcomes];
    newOutcomes.splice(idx + 1, 0, null);
    const newPayouts = [...s.hand_payouts];
    newPayouts.splice(idx + 1, 0, 0);
    const newAces = [...s.split_from_aces];
    newAces[idx] = isAceSplit;
    newAces.splice(idx + 1, 0, isAceSplit);

    next = {
      ...s,
      deck: dk,
      split_count: s.split_count + 1,
      player_hands: newHands,
      hand_bets: newBets,
      hand_outcomes: newOutcomes,
      hand_payouts: newPayouts,
      split_from_aces: newAces,
    };
  }

  if (isAceSplit) {
    const idx = next.active_hand_index;
    for (const i of [idx, idx + 1]) {
      if (handValue(next.player_hands[i] ?? []) > 21) {
        next = settleHand(next, i, "lose");
      }
    }
    next = { ...next, active_hand_index: idx + 2 };
    return finishIfAllHandsDone(next);
  }

  // A hand the split dealt 21 stands on its own (#3764): play moves on, maybe to the dealer.
  const played = finishIfAllHandsDone(passTwentyOnes(next));
  if (played === next) return next;
  const events = splitRoundEvents(s, played, []);
  return { ...played, events: events.length > 0 ? events : undefined };
}

function reshuffleThreshold(rules: GameRules): number {
  const totalCards = rules.deck_count * 52;
  return Math.max(RESHUFFLE_THRESHOLD, Math.floor(totalCards * (1 - rules.penetration)));
}

export function newHand(s: EngineState): EngineState {
  if (s.phase !== "result" && s.phase !== "victory") throw new Error("Not in result phase.");
  const deck =
    s.deck.length < reshuffleThreshold(s.rules) ? freshShuffledDeck(s.rules.deck_count) : s.deck;
  return {
    ...s,
    phase: "betting",
    bet: 0,
    outcome: null,
    payout: 0,
    lastWin: s.payout,
    doubled: false,
    deck,
    player_hand: [],
    dealer_hand: [],
    events: undefined,
    ...emptySplitState(),
  };
}
