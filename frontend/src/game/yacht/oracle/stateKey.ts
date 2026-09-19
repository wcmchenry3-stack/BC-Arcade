/**
 * Yacht oracle — compact scorecard-state encoding + engine-rule-faithful
 * scoring transitions (#2243).
 *
 * This is the single source of truth for "what state does scoring category C
 * with dice D from state S transition to, and what does it score" — shared
 * by BOTH the offline solver (frontend/src/game/yacht/oracleBuild/solver.ts,
 * not shipped) and the runtime oracle (./oracle.ts, shipped). Building both
 * sides on the SAME module — which itself calls straight into engine.ts's
 * real `calculateScore`/`calculateJokerScore` rather than reimplementing
 * scoring — is what prevents the "solver drifts from the shipped rules"
 * risk called out in #2243: a rule mismatch shifts optimal EV by ~9 points,
 * which is exactly the kind of bug a parallel reimplementation invites.
 *
 * State model
 * ───────────
 * A scorecard's *future* value (what the oracle computes) depends only on:
 *   - which categories are still open (a 12-bit mask; "yacht" is pulled out
 *     into its own 3-value field below, not a plain fill bit — see why),
 *   - the running upper-section subtotal, capped at 63 (bonus threshold —
 *     capping is lossless for this purpose: once >=63 the exact excess never
 *     matters again, see `successorAfterScore`),
 *   - whether "yacht" has been filled with 50 (unlocks the Joker rule for
 *     future 5-of-a-kind rolls, `engine.ts`'s `jokerActive`) or with 0 (it
 *     was zeroed against a non-yacht roll — Joker never unlocks) or is still
 *     open. A plain "yacht filled?" bit can't distinguish the 50-vs-0 case,
 *     and that distinction changes future legal-category rules (Joker
 *     priority) and scoring formulas (`calculateJokerScore`) — hence the
 *     3-value `YachtStatus` field instead of a 13th mask bit.
 * Already-locked-in category *values* are NOT part of the state — they're
 * sunk cost that can't affect future optimal play, exactly the reduction
 * that makes the state space tractable (~786K slots, not exponential in
 * actual scores).
 *
 * Pure module: no React, no IO, no Math.random.
 */

import type { Category } from "../engine";
import {
  CATEGORIES,
  UPPER_CATEGORIES,
  LOWER_CATEGORIES,
  FACE_TO_UPPER,
  calculateScore,
  calculateJokerScore,
  isYacht,
} from "../engine";
import type { GameState } from "../types";

// ---------------------------------------------------------------------------
// Category layout
// ---------------------------------------------------------------------------

/**
 * All categories except "yacht", in CATEGORIES order — indices 0-5 are the
 * upper section (ones..sixes), indices 6-11 are the lower section minus
 * yacht. Mask bit `i` corresponds to `NON_YACHT_CATEGORIES[i]`.
 */
export const NON_YACHT_CATEGORIES: readonly Category[] = CATEGORIES.filter((c) => c !== "yacht");

const CATEGORY_TO_BIT: ReadonlyMap<Category, number> = new Map(
  NON_YACHT_CATEGORIES.map((c, i) => [c, i])
);

const UPPER_MASK_ALL = 0b111111; // bits 0-5: ones..sixes, all filled

// ---------------------------------------------------------------------------
// Yacht slot status (replaces a 13th mask bit — see module doc)
// ---------------------------------------------------------------------------

export const YACHT_OPEN = 0;
export const YACHT_FILLED_50 = 1;
export const YACHT_FILLED_0 = 2;
export type YachtStatus = typeof YACHT_OPEN | typeof YACHT_FILLED_50 | typeof YACHT_FILLED_0;

// ---------------------------------------------------------------------------
// Key encoding: key = (mask, yachtStatus, upperCapped) packed into one int
// ---------------------------------------------------------------------------

export const UPPER_CAP = 63;
const UPPER_CAP_SLOTS = UPPER_CAP + 1; // 0..63
const YACHT_STATUS_SLOTS = 3;
const MASK_SLOTS = 1 << NON_YACHT_CATEGORIES.length; // 4096

/** Total addressable table size (dense; not all slots are reachable — see solver.ts's pruning during the retrograde sweep). */
export const TABLE_SIZE = MASK_SLOTS * YACHT_STATUS_SLOTS * UPPER_CAP_SLOTS; // 786,432

export interface DecodedState {
  readonly mask: number;
  readonly yachtStatus: YachtStatus;
  readonly upperCapped: number;
}

export function encodeKey(mask: number, yachtStatus: YachtStatus, upperCapped: number): number {
  return (mask * YACHT_STATUS_SLOTS + yachtStatus) * UPPER_CAP_SLOTS + upperCapped;
}

export function decodeKey(key: number): DecodedState {
  const upperCapped = key % UPPER_CAP_SLOTS;
  const rest = Math.floor(key / UPPER_CAP_SLOTS);
  const yachtStatus = (rest % YACHT_STATUS_SLOTS) as YachtStatus;
  const mask = Math.floor(rest / YACHT_STATUS_SLOTS);
  return { mask, yachtStatus, upperCapped };
}

export function isAllUpperFilled(mask: number): boolean {
  return (mask & UPPER_MASK_ALL) === UPPER_MASK_ALL;
}

/** True when every category (including yacht) has been scored — no more turns. */
export function isTerminalKey(key: number): boolean {
  const { mask, yachtStatus } = decodeKey(key);
  return mask === MASK_SLOTS - 1 && yachtStatus !== YACHT_OPEN;
}

/** The scorecard-state key at the very start of a game (nothing scored). */
export const INITIAL_KEY = encodeKey(0, YACHT_OPEN, 0);

/**
 * Derive a table key from a real (possibly partially-filled) GameState
 * scorecard. Used by the runtime oracle to look up the current live game,
 * and by tests to cross-validate stateKey.ts against engine.ts directly.
 */
export function keyFromGameState(scores: GameState["scores"]): number {
  let mask = 0;
  let upperCapped = 0;
  for (let i = 0; i < NON_YACHT_CATEGORIES.length; i++) {
    const cat = NON_YACHT_CATEGORIES[i]!;
    const v = scores[cat];
    if (v === null || v === undefined) continue;
    mask |= 1 << i;
    if (UPPER_CATEGORIES.has(cat)) upperCapped += v;
  }
  upperCapped = Math.min(upperCapped, UPPER_CAP);

  const yachtValue = scores.yacht;
  const yachtStatus: YachtStatus =
    yachtValue === null || yachtValue === undefined
      ? YACHT_OPEN
      : yachtValue === 50
        ? YACHT_FILLED_50
        : YACHT_FILLED_0;

  return encodeKey(mask, yachtStatus, isAllUpperFilled(mask) ? 0 : upperCapped);
}

// ---------------------------------------------------------------------------
// Legal category choices — mirrors engine.ts's possibleScores/jokerPossibleScores
// ---------------------------------------------------------------------------

/**
 * Which categories may legally be scored right now, given the current state
 * and the dice about to be locked in. Mirrors `possibleScores`/
 * `jokerPossibleScores` in engine.ts exactly, including the Joker rule's
 * three-tier priority (mandatory matching-upper, then open-lower-except-
 * yacht, then any open upper) — this is NOT "any open category" whenever
 * Joker is active, and getting that restriction wrong would let the solver
 * consider moves that aren't actually legal in the shipped game.
 */
export function legalCategoriesFor(key: number, dice: readonly number[]): readonly Category[] {
  const { mask, yachtStatus } = decodeKey(key);
  const openNonYacht = NON_YACHT_CATEGORIES.filter(
    (c) => (mask & (1 << CATEGORY_TO_BIT.get(c)!)) === 0
  );
  const yachtOpen = yachtStatus === YACHT_OPEN;

  const joker = isYacht(dice) && yachtStatus === YACHT_FILLED_50;
  if (!joker) {
    return yachtOpen ? [...openNonYacht, "yacht"] : openNonYacht;
  }

  // Joker priority 1: the upper category matching the rolled face, if open.
  const face = dice[0];
  const upperCat = face !== undefined ? FACE_TO_UPPER[face] : undefined;
  if (upperCat !== undefined && openNonYacht.includes(upperCat)) {
    return [upperCat];
  }

  // Priority 2: any open lower category except yacht (yacht is never in
  // openNonYacht by construction, so the LOWER_CATEGORIES filter already
  // excludes it — matches jokerPossibleScores's explicit `cat !== "yacht"`).
  const openLower = openNonYacht.filter((c) => LOWER_CATEGORIES.has(c));
  if (openLower.length > 0) return openLower;

  // Priority 3: any remaining open upper category.
  return openNonYacht.filter((c) => UPPER_CATEGORIES.has(c));
}

// ---------------------------------------------------------------------------
// Scoring transition — mirrors engine.ts's score()/withDerived exactly
// ---------------------------------------------------------------------------

export interface ScoreTransition {
  readonly nextKey: number;
  /** Points earned by this single action, including the upper bonus if this transition completes the upper section at >=63. */
  readonly scoreDelta: number;
}

/**
 * Score `category` with `dice` from `key`. Caller must ensure `category` is
 * in `legalCategoriesFor(key, dice)` — this function does not re-validate
 * legality (the solver and runtime oracle both only ever call it with
 * already-legal categories, by construction of how they enumerate choices).
 */
export function successorAfterScore(
  key: number,
  category: Category,
  dice: readonly number[]
): ScoreTransition {
  const { mask, yachtStatus, upperCapped } = decodeKey(key);
  const joker = isYacht(dice) && yachtStatus === YACHT_FILLED_50;

  // "yacht" never uses the joker formula on itself — calculateScore's yacht
  // case is already exactly right (50 if 5-of-a-kind, else 0), and joker can
  // only be active once yacht is filled (not open), so category==="yacht"
  // and joker===true are mutually exclusive by construction anyway.
  const rawScore =
    category === "yacht"
      ? calculateScore("yacht", dice)
      : joker
        ? calculateJokerScore(category, dice)
        : calculateScore(category, dice);

  let scoreDelta = rawScore;

  // Yacht/joker bonus: engine.ts's score() increments yacht_bonus_count on
  // EVERY joker-active scoring action (not just scoring "yacht" itself,
  // which can't happen while joker is active anyway — see above), and
  // yacht_bonus_total (yacht_bonus_count × 100) is a component of
  // total_score separate from the category's own recorded value. Missing
  // this was a real bug caught by cross-validating against the real engine
  // end-to-end (oracle/__tests__/stateKey.test.ts) — it shifted the solved
  // optimal EV from the published ~254.59 (joker+bonus rule) down to ~246,
  // matching the *no-joker* published figure instead.
  if (joker) {
    scoreDelta += 100; // YACHT_BONUS_VALUE (engine.ts)
  }

  let newMask = mask;
  let newUpperCapped = upperCapped;
  let newYachtStatus: YachtStatus = yachtStatus;

  if (category === "yacht") {
    newYachtStatus = rawScore === 50 ? YACHT_FILLED_50 : YACHT_FILLED_0;
  } else {
    newMask = mask | (1 << CATEGORY_TO_BIT.get(category)!);
    if (UPPER_CATEGORIES.has(category)) {
      // Lossless capping (see module doc): min(cappedOld + s, 63) === min(realOld + s, 63).
      newUpperCapped = Math.min(upperCapped + rawScore, UPPER_CAP);
    }
  }

  // Upper bonus: awarded exactly once, at the transition that completes the
  // upper section, IFF the (capped) subtotal has reached the threshold —
  // matches engine.ts's upperBonus(), which returns 0 unless every upper
  // category is filled.
  const wasAllUpperFilled = isAllUpperFilled(mask);
  const nowAllUpperFilled = isAllUpperFilled(newMask);
  if (!wasAllUpperFilled && nowAllUpperFilled && newUpperCapped >= UPPER_CAP) {
    scoreDelta += 35; // UPPER_BONUS_VALUE (engine.ts)
  }

  // Once the upper section is complete, its exact capped subtotal can never
  // affect a future decision again (no more upper categories to score into,
  // and the bonus is now permanently fixed) — normalize to a single
  // canonical value so those states don't needlessly fragment into 64
  // otherwise-identical table entries.
  const upperCappedForKey = nowAllUpperFilled ? 0 : newUpperCapped;

  return {
    nextKey: encodeKey(newMask, newYachtStatus, upperCappedForKey),
    scoreDelta,
  };
}
