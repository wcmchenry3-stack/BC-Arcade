/**
 * Shared fixtures for the Blackjack `engine.<cluster>.test.ts` files (#2955). Not a test file.
 */
import { EngineState, Card, DEFAULT_RULES, DEFAULT_RUN_CONFIG } from "../../engine";

// Helpers ------------------------------------------------------------------

export function c(suit: string, rank: string): Card {
  return { suit, rank };
}

export function emptySplitState() {
  return {
    player_hands: [] as Card[][],
    hand_bets: [] as number[],
    hand_outcomes: [] as (string | null)[],
    hand_payouts: [] as number[],
    active_hand_index: 0,
    split_count: 0,
    split_from_aces: [] as boolean[],
  };
}

export function stateInPlayer(chips = 1000, bet = 100): EngineState {
  return {
    ...DEFAULT_RUN_CONFIG,
    milestones_reached: [],
    hitLowChips: false,
    comebackEmitted: false,
    chips,
    bet,
    phase: "player",
    outcome: null,
    payout: 0,
    lastWin: null,
    deck: Array(20).fill(c("♠", "5")), // safe 5s — won't over-bust
    player_hand: [c("♠", "7"), c("♥", "8")], // 15
    dealer_hand: [c("♦", "6"), c("♣", "9")], // 15
    doubled: false,
    rules: DEFAULT_RULES,
    ...emptySplitState(),
  };
}

export function stateInResult(
  chips = 1000,
  bet = 100,
  outcome: EngineState["outcome"] = "push",
  payout = 0
): EngineState {
  return {
    ...DEFAULT_RUN_CONFIG,
    milestones_reached: [],
    hitLowChips: false,
    comebackEmitted: false,
    chips,
    bet,
    phase: "result",
    outcome,
    payout,
    lastWin: null,
    deck: Array(30).fill(c("♠", "5")),
    player_hand: [c("♠", "7"), c("♥", "8")],
    dealer_hand: [c("♦", "6"), c("♣", "9")],
    doubled: false,
    rules: DEFAULT_RULES,
    ...emptySplitState(),
  };
}

export function splitSetup(opts?: {
  chips?: number;
  bet?: number;
  player?: Card[];
  dealer?: Card[];
  deck?: Card[];
}): EngineState {
  return {
    ...DEFAULT_RUN_CONFIG,
    milestones_reached: [],
    hitLowChips: false,
    comebackEmitted: false,
    chips: opts?.chips ?? 1000,
    bet: opts?.bet ?? 100,
    phase: "player",
    outcome: null,
    payout: 0,
    lastWin: null,
    deck: opts?.deck ?? Array(20).fill(c("♠", "3")),
    player_hand: opts?.player ?? [c("♠", "8"), c("♥", "8")],
    dealer_hand: opts?.dealer ?? [c("♦", "6"), c("♣", "9")],
    doubled: false,
    rules: DEFAULT_RULES,
    ...emptySplitState(),
  };
}
