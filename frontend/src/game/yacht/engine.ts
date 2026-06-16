/**
 * Client-side Yacht engine.
 *
 * Ported from backend/yacht/game.py. Pure functions, immutable state.
 * After this port, the Yacht screens make zero HTTP requests during
 * gameplay — Math.random() drives the dice locally.
 *
 * Parity with the backend is verified by porting every backend test case
 * in __tests__/engine.test.ts.
 */

import { GameEvent, GameState } from "./types";

export const CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const UPPER_CATEGORIES: ReadonlySet<Category> = new Set([
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
]);

export const LOWER_CATEGORIES: ReadonlySet<Category> = new Set([
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
]);

const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS_VALUE = 35;
const YACHT_BONUS_VALUE = 100;

const FACE_TO_UPPER: Record<number, Category> = {
  1: "ones",
  2: "twos",
  3: "threes",
  4: "fours",
  5: "fives",
  6: "sixes",
};

// ---------------------------------------------------------------------------
// Seedable RNG
//
// Die rolls go through `_rng` so tests and e2e flows can pin the dice
// sequence with `setRng(createSeededRng(seed))`. Default is Math.random for
// normal gameplay. Tests that call setRng must restore Math.random in
// afterEach to avoid leaking determinism into later tests.
// ---------------------------------------------------------------------------

export type RandomSource = () => number;

let _rng: RandomSource = Math.random;

export function setRng(fn: RandomSource): void {
  _rng = fn;
}

export function getRng(): RandomSource {
  return _rng;
}

/**
 * LCG (same parameters as Cascade's, Twenty48's, and Blackjack's seeded
 * RNGs). Deterministic for a given seed. Not cryptographic — testing only.
 */
export function createSeededRng(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Pure scoring functions
// ---------------------------------------------------------------------------

function counts(dice: readonly number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of dice) m.set(d, (m.get(d) ?? 0) + 1);
  return m;
}

function diceCount(dice: readonly number[], face: number): number {
  let n = 0;
  for (const d of dice) if (d === face) n += 1;
  return n;
}

function sumDice(dice: readonly number[]): number {
  return dice.reduce((a, b) => a + b, 0);
}

function hasRun(uniqueSorted: readonly number[], length: number): boolean {
  let run = 1;
  for (let i = 1; i < uniqueSorted.length; i++) {
    const curr = uniqueSorted[i];
    const prev = uniqueSorted[i - 1];
    if (curr !== undefined && prev !== undefined && curr === prev + 1) {
      run += 1;
      if (run >= length) return true;
    } else {
      run = 1;
    }
  }
  return run >= length;
}

export function calculateScore(category: Category, dice: readonly number[]): number {
  const c = counts(dice);

  switch (category) {
    case "ones":
      return diceCount(dice, 1) * 1;
    case "twos":
      return diceCount(dice, 2) * 2;
    case "threes":
      return diceCount(dice, 3) * 3;
    case "fours":
      return diceCount(dice, 4) * 4;
    case "fives":
      return diceCount(dice, 5) * 5;
    case "sixes":
      return diceCount(dice, 6) * 6;
    case "three_of_a_kind": {
      for (const v of c.values()) if (v >= 3) return sumDice(dice);
      return 0;
    }
    case "four_of_a_kind": {
      for (const v of c.values()) if (v >= 4) return sumDice(dice);
      return 0;
    }
    case "full_house": {
      const vals = [...c.values()].sort((a, b) => a - b);
      return vals.length === 2 && vals[0] === 2 && vals[1] === 3 ? 25 : 0;
    }
    case "small_straight": {
      const unique = [...new Set(dice)].sort((a, b) => a - b);
      return hasRun(unique, 4) ? 30 : 0;
    }
    case "large_straight": {
      const unique = [...new Set(dice)].sort((a, b) => a - b);
      return hasRun(unique, 5) ? 40 : 0;
    }
    case "yacht":
      return c.size === 1 ? 50 : 0;
    case "chance":
      return sumDice(dice);
  }
}

function calculateJokerScore(category: Category, dice: readonly number[]): number {
  if (UPPER_CATEGORIES.has(category)) return calculateScore(category, dice);
  switch (category) {
    case "three_of_a_kind":
      return sumDice(dice);
    case "four_of_a_kind":
      return sumDice(dice);
    case "full_house":
      return 25;
    case "small_straight":
      return 30;
    case "large_straight":
      return 40;
    case "chance":
      return sumDice(dice);
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

function upperSubtotal(scores: GameState["scores"]): number {
  let s = 0;
  for (const cat of UPPER_CATEGORIES) {
    const v = scores[cat];
    if (v !== null && v !== undefined) s += v;
  }
  return s;
}

function upperBonus(scores: GameState["scores"]): number {
  for (const cat of UPPER_CATEGORIES) {
    if (scores[cat] === null || scores[cat] === undefined) return 0;
  }
  return upperSubtotal(scores) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_VALUE : 0;
}

function totalScore(scores: GameState["scores"], yachtBonusCount: number): number {
  let filled = 0;
  for (const v of Object.values(scores)) {
    if (v !== null && v !== undefined) filled += v;
  }
  return filled + upperBonus(scores) + yachtBonusCount * YACHT_BONUS_VALUE;
}

/**
 * Recompute derived fields (upper_subtotal, upper_bonus, yacht_bonus_total,
 * total_score) from a state's base fields. Useful for tests that construct
 * states by hand and for storage hydration.
 */
export function computeDerived(state: GameState): GameState {
  return withDerived({
    dice: state.dice,
    held: state.held,
    rolls_used: state.rolls_used,
    round: state.round,
    scores: state.scores,
    yacht_bonus_count: state.yacht_bonus_count,
    game_over: state.game_over,
  });
}

function withDerived(base: {
  dice: number[];
  held: boolean[];
  rolls_used: number;
  round: number;
  scores: GameState["scores"];
  yacht_bonus_count: number;
  game_over: boolean;
  events?: readonly GameEvent[];
}): GameState {
  return {
    ...base,
    upper_subtotal: upperSubtotal(base.scores),
    upper_bonus: upperBonus(base.scores),
    yacht_bonus_total: base.yacht_bonus_count * YACHT_BONUS_VALUE,
    total_score: totalScore(base.scores, base.yacht_bonus_count),
  };
}

// ---------------------------------------------------------------------------
// Yacht / Joker helpers
// ---------------------------------------------------------------------------

function isYacht(dice: readonly number[]): boolean {
  return counts(dice).size === 1 && dice[0] !== 0;
}

function jokerActive(state: GameState): boolean {
  return isYacht(state.dice) && state.scores.yacht === 50;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isInProgress(state: GameState): boolean {
  if (state.round > 1) return true;
  if (state.rolls_used > 0) return true;
  for (const cat of CATEGORIES) {
    if (state.scores[cat] != null) return true;
  }
  return false;
}

export function newGame(): GameState {
  const scores: GameState["scores"] = {};
  for (const cat of CATEGORIES) scores[cat] = null;
  return withDerived({
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rolls_used: 0,
    round: 1,
    scores,
    yacht_bonus_count: 0,
    game_over: false,
  });
}

export function roll(
  state: GameState,
  heldInput: readonly boolean[],
  opts?: { dice?: number[] }
): GameState {
  if (state.rolls_used >= 3) throw new Error("No rolls remaining this turn.");
  if (state.game_over) throw new Error("Game is over.");

  // First roll of a turn rerolls everything.
  const held = state.rolls_used === 0 ? [false, false, false, false, false] : [...heldInput];
  if (held.length !== 5) throw new Error("'held' must have exactly 5 booleans.");

  const nextDice = [...state.dice];
  const rolledIndices: number[] = [];
  for (let i = 0; i < 5; i++) {
    if (!held[i]) {
      nextDice[i] = opts?.dice != null ? opts.dice[i]! : 1 + Math.floor(_rng() * 6);
      rolledIndices.push(i);
    }
  }

  return withDerived({
    dice: nextDice,
    held,
    rolls_used: state.rolls_used + 1,
    round: state.round,
    scores: state.scores,
    yacht_bonus_count: state.yacht_bonus_count,
    game_over: state.game_over,
    events: [{ type: "diceRoll", rolledIndices }],
  });
}

/** Toggle a die's held state (only valid after at least one roll). Emits dieHold or dieRelease. */
export function toggleHold(state: GameState, index: number): GameState {
  if (state.rolls_used === 0 || state.game_over) return state;
  if (index < 0 || index >= 5) return state;
  const newHeld = [...state.held];
  newHeld[index] = !newHeld[index];
  const eventType = newHeld[index] ? ("dieHold" as const) : ("dieRelease" as const);
  return { ...state, held: newHeld, events: [{ type: eventType, index }] };
}

export function score(state: GameState, category: Category): GameState {
  if (state.game_over) throw new Error("Game is over.");
  if (!CATEGORIES.includes(category)) throw new Error("Unknown scoring category.");
  if (state.scores[category] !== null && state.scores[category] !== undefined) {
    throw new Error("Category already scored.");
  }
  if (state.rolls_used === 0) throw new Error("Must roll at least once before scoring.");

  const joker = jokerActive(state);
  let nextYachtBonusCount = state.yacht_bonus_count;
  let scoreValue: number;

  if (joker) {
    nextYachtBonusCount += 1;
    const face = state.dice[0];
    if (face === undefined) throw new Error("Unexpected: dice array is empty");
    const upperCat = FACE_TO_UPPER[face];
    if (upperCat === undefined) throw new Error(`Unknown die face: ${face}`);

    if (state.scores[upperCat] === null || state.scores[upperCat] === undefined) {
      // Priority 1: MUST use corresponding upper category
      if (category !== upperCat) {
        throw new Error("Joker rule: must score in the corresponding upper category.");
      }
    } else {
      // Priority 2: any open lower-section category (except yacht)
      const openLower: Category[] = [];
      for (const cat of LOWER_CATEGORIES) {
        if (cat !== "yacht" && (state.scores[cat] === null || state.scores[cat] === undefined)) {
          openLower.push(cat);
        }
      }
      if (openLower.length > 0) {
        // User picked upper while a lower is open → reject
        if (UPPER_CATEGORIES.has(category)) {
          throw new Error("Joker rule: must score in an open lower-section category.");
        }
      }
      // Priority 3: any open upper (handled implicitly by letting the category through)
    }

    scoreValue = calculateJokerScore(category, state.dice);
  } else {
    scoreValue = calculateScore(category, state.dice);
  }

  const nextScores = { ...state.scores, [category]: scoreValue };
  const nextRound = state.round + 1;
  const nextGameOver = nextRound > 13;

  // Collect score events for this action.
  const scoreEvents: GameEvent[] = [];
  if (category === "yacht" && scoreValue === 50) scoreEvents.push({ type: "yacht" });
  if (nextYachtBonusCount > state.yacht_bonus_count) scoreEvents.push({ type: "joker" });
  if (category === "large_straight" && scoreValue > 0) scoreEvents.push({ type: "largeStraight" });
  if (category === "small_straight" && scoreValue > 0) scoreEvents.push({ type: "smallStraight" });
  // upperBonus fires exactly once: when the upper total first reaches ≥ 63.
  const prevUpperTotal = upperSubtotal(state.scores);
  const nextUpperTotal = upperSubtotal(nextScores);
  if (prevUpperTotal < UPPER_BONUS_THRESHOLD && nextUpperTotal >= UPPER_BONUS_THRESHOLD) {
    scoreEvents.push({ type: "upperBonus" });
  }

  return withDerived({
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rolls_used: 0,
    round: nextRound,
    scores: nextScores,
    yacht_bonus_count: nextYachtBonusCount,
    game_over: nextGameOver,
    events: scoreEvents.length > 0 ? scoreEvents : undefined,
  });
}

export function possibleScores(state: GameState): Record<string, number> {
  if (state.rolls_used === 0) return {};
  if (jokerActive(state)) return jokerPossibleScores(state);

  const out: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    if (state.scores[cat] === null || state.scores[cat] === undefined) {
      out[cat] = calculateScore(cat, state.dice);
    }
  }
  return out;
}

function jokerPossibleScores(state: GameState): Record<string, number> {
  const face = state.dice[0];
  if (face === undefined) return {};
  const upperCat = FACE_TO_UPPER[face];
  if (upperCat === undefined) return {};

  // Priority 1: mandatory upper
  if (state.scores[upperCat] === null || state.scores[upperCat] === undefined) {
    return { [upperCat]: calculateJokerScore(upperCat, state.dice) };
  }

  // Priority 2: open lower (except yacht)
  const openLower: Record<string, number> = {};
  for (const cat of LOWER_CATEGORIES) {
    if (cat !== "yacht" && (state.scores[cat] === null || state.scores[cat] === undefined)) {
      openLower[cat] = calculateJokerScore(cat, state.dice);
    }
  }
  if (Object.keys(openLower).length > 0) return openLower;

  // Priority 3: open upper
  const openUpper: Record<string, number> = {};
  for (const cat of UPPER_CATEGORIES) {
    if (state.scores[cat] === null || state.scores[cat] === undefined) {
      openUpper[cat] = calculateJokerScore(cat, state.dice);
    }
  }
  return openUpper;
}
