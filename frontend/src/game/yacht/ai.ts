/**
 * Yacht AI engine — hold and score strategies for Easy / Medium / Hard.
 *
 * Mirrors frontend/src/game/hearts/ai.ts. Pure functions, no React, no side
 * effects. All randomness is handled by the caller (GameScreen) via the
 * existing engine.roll() + engine.score() functions.
 *
 * Win-rate targets (human vs AI, validated by scripts/simulate-yacht.ts):
 *   Easy   ~65%  — greedy/reactive, no bonus awareness
 *   Medium ~50%  — heuristic strategist, bonus tracking, protects Chance
 *   Hard   ~35%  — EV-optimized holds on final roll, adversarial scoring
 */

import { AiDifficulty, GameState } from "./types";
import { UPPER_CATEGORIES, Category, possibleScores } from "./engine";
import { maxImmediateScore } from "./aiHelpers";

// ─── Local maps ──────────────────────────────────────────────────────────────

const UPPER_FACE: Partial<Record<Category, number>> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
};

const FACE_TO_CAT: Record<number, Category> = {
  1: "ones",
  2: "twos",
  3: "threes",
  4: "fours",
  5: "fives",
  6: "sixes",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function faceCounts(dice: readonly number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of dice) m.set(d, (m.get(d) ?? 0) + 1);
  return m;
}

function diceSum(dice: readonly number[]): number {
  return dice.reduce((a, b) => a + b, 0);
}

function upperSubtotal(scores: GameState["scores"]): number {
  let s = 0;
  for (const cat of UPPER_CATEGORIES) {
    const v = scores[cat];
    if (v !== null && v !== undefined) s += v;
  }
  return s;
}

function isOpen(scores: GameState["scores"], cat: Category): boolean {
  return scores[cat] === null || scores[cat] === undefined;
}

/** True when the current roll is a Joker (all-same dice with yacht already scored). */
function isJokerRoll(dice: readonly number[], scores: GameState["scores"]): boolean {
  const c = faceCounts(dice);
  return c.size === 1 && (dice[0] ?? 0) > 0 && scores.yacht === 50;
}

/** Returns the highest-scoring category from a pre-computed legal move set. */
function bestInLegal(legal: Record<string, number>): Category | null {
  let bestCat: Category | null = null;
  let bestVal = -1;
  for (const [cat, val] of Object.entries(legal)) {
    if (val > bestVal) {
      bestVal = val;
      bestCat = cat as Category;
    }
  }
  return bestCat;
}

function mostFrequentFace(dice: readonly number[]): number {
  const counts = faceCounts(dice);
  let maxCnt = 0;
  let face = dice[0] ?? 1;
  for (const [f, cnt] of counts) {
    if (cnt > maxCnt || (cnt === maxCnt && f > face)) {
      maxCnt = cnt;
      face = f;
    }
  }
  return face;
}

function holdFace(dice: readonly number[], face: number): boolean[] {
  return dice.map((d) => d === face);
}

function holdForRun(dice: readonly number[], runFaces: Set<number>): boolean[] {
  const held = [false, false, false, false, false];
  const seen = new Set<number>();
  for (let i = 0; i < dice.length; i++) {
    const d = dice[i]!;
    if (runFaces.has(d) && !seen.has(d)) {
      held[i] = true;
      seen.add(d);
    }
  }
  return held;
}

function longestRunFaces(dice: readonly number[], minLength: number): Set<number> | null {
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  let run: number[] = unique[0] !== undefined ? [unique[0]] : [];
  let best: number[] = [];
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === unique[i - 1]! + 1) {
      run.push(unique[i]!);
    } else {
      if (run.length > best.length) best = run;
      run = [unique[i]!];
    }
  }
  if (run.length > best.length) best = run;
  return best.length >= minLength ? new Set(best) : null;
}

// ─── Expected-value helpers (used by Hard hold strategy) ─────────────────────

/**
 * Expected score when `keptIndices` dice are held and the rest are rerolled once.
 * Enumerates all 6^(free) outcomes — tractable when free ≤ 5.
 *
 * Exported for parity testing against the precomputed probability tables in
 * probTables.ts (GH #2025, story A1).  Do NOT use outside of tests/probTables.
 */
export function evForHold(
  dice: readonly number[],
  keptIndices: readonly number[],
  scores: GameState["scores"]
): number {
  const keptValues = keptIndices.map((i) => dice[i]!);
  const freeCount = 5 - keptIndices.length;
  const curUpperSubtotal = upperSubtotal(scores);
  if (freeCount === 0) return maxImmediateScore(keptValues, scores, curUpperSubtotal);

  const outcomes = Math.pow(6, freeCount);
  let total = 0;

  for (let mask = 0; mask < outcomes; mask++) {
    const freeRoll: number[] = [];
    let rem = mask;
    for (let j = 0; j < freeCount; j++) {
      freeRoll.push((rem % 6) + 1);
      rem = Math.floor(rem / 6);
    }
    total += maxImmediateScore([...keptValues, ...freeRoll], scores, curUpperSubtotal);
  }

  return total / outcomes;
}

// ─── Hold strategies ─────────────────────────────────────────────────────────

function holdEasy(dice: readonly number[]): boolean[] {
  // Hold the most-frequent face; ties go to highest face.
  return holdFace(dice, mostFrequentFace(dice));
}

function holdMedium(dice: readonly number[], scores: GameState["scores"]): boolean[] {
  const counts = faceCounts(dice);
  const toBonus = Math.max(0, 63 - upperSubtotal(scores));
  const straightOpen = isOpen(scores, "large_straight") || isOpen(scores, "small_straight");

  // 4+ of a kind: lock those
  for (const [face, cnt] of counts) {
    if (cnt >= 4) return holdFace(dice, face);
  }

  // Full house already in hand (3+2): keep all — only if full_house is still open
  const sortedCnts = [...counts.values()].sort((a, b) => b - a);
  if (sortedCnts[0] === 3 && (sortedCnts[1] ?? 0) >= 2 && isOpen(scores, "full_house")) {
    return [true, true, true, true, true];
  }

  // 5-run: keep all — only if a straight category is still open
  if (longestRunFaces(dice, 5) && straightOpen) return [true, true, true, true, true];

  // Trips: hold the 3
  for (const [face, cnt] of counts) {
    if (cnt === 3) return holdFace(dice, face);
  }

  // 4-run: hold the run to complete a large straight — only if a straight is open
  const run4 = longestRunFaces(dice, 4);
  if (run4 && straightOpen) return holdForRun(dice, run4);

  // Upper bonus pursuit: hold the best open upper face.
  // Threshold: ≥2 of any face, or ≥1 for high-value faces (5,6) whose par scores
  // (15, 18) contribute the most to reaching 63. Single high-value dice beat a
  // 3-run because the 3-run leads to only small_straight (30 pts) while the bonus
  // itself is worth 35 pts deferred.
  if (toBonus > 0) {
    let bestFace = 0;
    let bestCnt = 0;
    for (const [face, cnt] of counts) {
      const cat = FACE_TO_CAT[face];
      if (cat && isOpen(scores, cat) && (cnt > bestCnt || (cnt === bestCnt && face > bestFace))) {
        bestCnt = cnt;
        bestFace = face;
      }
    }
    const minCnt = bestFace >= 5 ? 1 : 2;
    if (bestFace > 0 && bestCnt >= minCnt) return holdFace(dice, bestFace);
  }

  // 3-run: keep for potential small/large straight — only if a straight is open
  const run3 = longestRunFaces(dice, 3);
  if (run3 && straightOpen) return holdForRun(dice, run3);

  // Highest pair
  let bestPairFace = 0;
  for (const [face, cnt] of counts) {
    if (cnt >= 2 && face > bestPairFace) bestPairFace = face;
  }
  if (bestPairFace > 0) return holdFace(dice, bestPairFace);

  // Fallback: hold single highest die
  const maxFace = Math.max(...dice);
  const held = [false, false, false, false, false];
  for (let i = 0; i < dice.length; i++) {
    if (dice[i] === maxFace) {
      held[i] = true;
      break;
    }
  }
  return held;
}

function holdHard(
  dice: readonly number[],
  scores: GameState["scores"],
  rollsUsed: number
): boolean[] {
  if (rollsUsed !== 2) {
    // Only the final hold (rollsUsed === 2) warrants full EV enumeration.
    // For earlier holds — or if called unexpectedly at rollsUsed === 0 —
    // fall back to the medium heuristic. 2-step lookahead is O(6^10) and
    // infeasible at runtime. The holdMedium already-scored-category guards
    // (full_house, straights) therefore apply to Hard rolls 1 and 2 as well.
    return holdMedium(dice, scores);
  }

  const toBonus = Math.max(0, 63 - upperSubtotal(scores));
  // Bonus proximity: the single-roll EV model can't see multi-turn bonus accumulation.
  // When within 30 pts of the bonus, inflate the effective EV of holding same-face
  // upper dice so the EV comparison favours bonus building over 4-run pursuit.
  // Linear scale: 0 tolerance at toBonus=30, full 35 pts at toBonus=0.
  const bonusTolerance = toBonus > 0 && toBonus <= 30 ? (35 * (30 - toBonus)) / 30 : 0;

  // rollsUsed === 2: one roll remaining — enumerate all 32 hold patterns and
  // pick the one with highest adjusted expected score across all 6^(free) outcomes.
  let bestHeld: boolean[] = [false, false, false, false, false];
  let bestEV = -Infinity;

  for (let mask = 0; mask < 32; mask++) {
    const keptIndices: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (mask & (1 << i)) keptIndices.push(i);
    }
    const ev = evForHold(dice, keptIndices, scores);

    // Apply proximity tolerance to mono-face upper-die holds (e.g. hold all 6s).
    // Excludes mixed patterns like 4-runs whose faces span multiple upper cats.
    let adjustedEV = ev;
    if (bonusTolerance > 0 && keptIndices.length > 0) {
      const face = dice[keptIndices[0]!]!;
      const cat = FACE_TO_CAT[face];
      if (cat !== undefined && isOpen(scores, cat) && keptIndices.every((i) => dice[i] === face)) {
        adjustedEV = ev + bonusTolerance;
      }
    }

    if (adjustedEV > bestEV) {
      bestEV = adjustedEV;
      bestHeld = [false, false, false, false, false];
      for (const i of keptIndices) bestHeld[i] = true;
    }
  }

  return bestHeld;
}

// ─── Score strategies ─────────────────────────────────────────────────────────
//
// All three functions receive `legal` — the output of engine.possibleScores(state).
// This is the single source of truth for which categories are legally available
// (it enforces Joker priority rules) and the scores already account for
// calculateJokerScore when a Joker is active.

function scoreEasy(dice: readonly number[], legal: Record<string, number>): Category {
  // Use Chance early when sum is decent (no strategy — purely reactive).
  const open = Object.keys(legal) as Category[];
  const s = diceSum(dice);
  if ("chance" in legal && s >= 20 && open.length > 6) return "chance";
  return bestInLegal(legal) ?? open[0]!;
}

function scoreMedium(
  dice: readonly number[],
  scores: GameState["scores"],
  legal: Record<string, number>
): Category {
  const open = Object.keys(legal) as Category[];
  const upper = upperSubtotal(scores);
  const toBonus = Math.max(0, 63 - upper);
  const s = diceSum(dice);
  const counts = faceCounts(dice);

  // Yacht — always take 50 pts
  if ("yacht" in legal && legal["yacht"] === 50) return "yacht";

  // Joker: yacht is already scored when isJokerRoll is true, so the Yacht branch above is
  // unreachable for jokers. jokerPossibleScores enforces priority rules; just pick highest value.
  if (isJokerRoll(dice, scores)) return bestInLegal(legal) ?? open[0]!;

  // Bonus-closing: scoring this upper cat reaches ≥ 63; the deferred +35 beats most combos.
  // cnt >= 3 of any face makes a legal large straight impossible, so this safely fires before
  // the large_straight check below without ever sacrificing 40 pts for a weak bonus-closer.
  if (toBonus > 0) {
    for (const cat of ["sixes", "fives", "fours", "threes", "twos", "ones"] as Category[]) {
      if (cat in legal) {
        const face = UPPER_FACE[cat]!;
        const cnt = counts.get(face) ?? 0;
        if (cnt >= 3 && upper + cnt * face >= 63) return cat;
      }
    }
  }

  // Large straight — always take 40 pts
  if ("large_straight" in legal && (legal["large_straight"] ?? 0) > 0) return "large_straight";

  // Four of a kind — take when sum is high
  if ("four_of_a_kind" in legal && (legal["four_of_a_kind"] ?? 0) > 20) return "four_of_a_kind";

  // Full house — always take
  if ("full_house" in legal && (legal["full_house"] ?? 0) > 0) return "full_house";

  // Upper bonus pursuit at par (≥3×face); scored before three_of_a_kind to secure the bonus path
  if (toBonus > 0) {
    for (const cat of ["sixes", "fives", "fours", "threes"] as Category[]) {
      if (cat in legal) {
        const face = UPPER_FACE[cat]!;
        if ((counts.get(face) ?? 0) >= 3) return cat;
      }
    }
  }

  // Three of a kind — take when sum is decent
  if ("three_of_a_kind" in legal && (legal["three_of_a_kind"] ?? 0) > 15) return "three_of_a_kind";

  // Small straight — take 30 pts
  if ("small_straight" in legal && (legal["small_straight"] ?? 0) > 0) return "small_straight";

  // Chance — use when sum is solid and enough rounds remain
  if ("chance" in legal && s >= 22 && open.length > 4) return "chance";

  // Sacrifice: only when the bonus is mathematically unreachable
  const openUpperCats = (
    ["ones", "twos", "threes", "fours", "fives", "sixes"] as Category[]
  ).filter((c) => c in legal);
  const maxReachable = upper + openUpperCats.reduce((acc, c) => acc + (UPPER_FACE[c] ?? 0) * 5, 0);
  if (maxReachable < 63) {
    if ("ones" in legal) return "ones";
    if ("twos" in legal) return "twos";
  }

  return bestInLegal(legal) ?? open[0]!;
}

function scoreHard(
  dice: readonly number[],
  scores: GameState["scores"],
  opponentScore: number,
  legal: Record<string, number>
): Category {
  const open = Object.keys(legal) as Category[];
  const counts = faceCounts(dice);
  const s = diceSum(dice);
  const upper = upperSubtotal(scores);
  const toBonus = Math.max(0, 63 - upper);

  const myScore = Object.values(scores).reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const trailing = myScore < opponentScore - 30;
  const leading = myScore > opponentScore + 50;

  // Always take Yacht
  if ("yacht" in legal && legal["yacht"] === 50) return "yacht";

  // Joker: yacht is already scored when isJokerRoll is true, so the Yacht branch above is
  // unreachable for jokers. jokerPossibleScores enforces priority rules; just pick highest value.
  if (isJokerRoll(dice, scores)) return bestInLegal(legal) ?? open[0]!;

  // Always take Large Straight
  if ("large_straight" in legal && (legal["large_straight"] ?? 0) > 0) return "large_straight";

  // Bonus-closing: scoring this upper cat reaches ≥ 63; the deferred +35 outweighs any combo.
  // Hard uses cnt >= 2 for high-value faces (≥5) because 2×5+35=45 and 2×6+35=47 both beat
  // full_house (25). Medium requires cnt >= 3 because it lacks the EV context to judge looser
  // holds safely.
  if (toBonus > 0) {
    for (const cat of ["sixes", "fives", "fours", "threes", "twos", "ones"] as Category[]) {
      if (cat in legal) {
        const face = UPPER_FACE[cat]!;
        const cnt = counts.get(face) ?? 0;
        if ((cnt >= 3 || (face >= 5 && cnt >= 2)) && upper + cnt * face >= 63) return cat;
      }
    }
  }

  // Trailing: take high-variance plays before medium-value ones.
  // Floor of 16 avoids counting four-1s (score=4) as a meaningful high-variance play.
  if (trailing) {
    if ("four_of_a_kind" in legal && (legal["four_of_a_kind"] ?? 0) > 16) return "four_of_a_kind";
    if ("full_house" in legal && (legal["full_house"] ?? 0) > 0) return "full_house";
    if ("small_straight" in legal && (legal["small_straight"] ?? 0) > 0) return "small_straight";
  }

  // Leading: lock in sure points
  if (leading) {
    for (const cat of ["sixes", "fives", "fours", "threes", "twos", "ones"] as Category[]) {
      if (cat in legal) {
        const face = UPPER_FACE[cat]!;
        if ((counts.get(face) ?? 0) >= 3) return cat;
      }
    }
    if ("chance" in legal && s >= 20) return "chance";
  }

  // Four of a kind
  if ("four_of_a_kind" in legal && (legal["four_of_a_kind"] ?? 0) > 18) return "four_of_a_kind";

  // Full house — scored before par pursuit because no upper cat at par (≤18 pts for 3×face ≤6)
  // beats the guaranteed 25. Par pursuit below only fires when full_house is unavailable.
  if ("full_house" in legal && (legal["full_house"] ?? 0) > 0) return "full_house";

  // Upper bonus pursuit at par — fires only when full_house is not in hand
  if (toBonus > 0) {
    for (const cat of ["sixes", "fives", "fours", "threes", "twos", "ones"] as Category[]) {
      if (cat in legal) {
        const face = UPPER_FACE[cat]!;
        const cnt = counts.get(face) ?? 0;
        if (cnt >= 3 || (face >= 5 && cnt >= 2)) return cat;
      }
    }
  }

  // Three of a kind with high sum
  if ("three_of_a_kind" in legal && (legal["three_of_a_kind"] ?? 0) >= 18) return "three_of_a_kind";

  // Small straight
  if ("small_straight" in legal && (legal["small_straight"] ?? 0) > 0) return "small_straight";

  // Chance: use when sum is high, or few open categories remain
  if ("chance" in legal && (s >= 24 || (open.length <= 3 && s >= 18))) return "chance";

  // Sacrifice: only when bonus is mathematically unreachable
  const openUpperCats = (
    ["ones", "twos", "threes", "fours", "fives", "sixes"] as Category[]
  ).filter((c) => c in legal);
  const maxPossibleUpperFromRemaining = openUpperCats.reduce(
    (acc, c) => acc + (UPPER_FACE[c] ?? 0) * 5,
    0
  );
  if (upper + maxPossibleUpperFromRemaining < 63) {
    if ("ones" in legal) return "ones";
    if ("twos" in legal) return "twos";
  }

  return bestInLegal(legal) ?? open[0]!;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns which dice the AI should hold before its next roll.
 *
 * Call after each roll (when state.rolls_used is 1 or 2). Returns a boolean[]
 * parallel to state.dice — true means keep that die.
 */
export function holdStrategy(state: GameState, difficulty: AiDifficulty): boolean[] {
  const { dice, scores, rolls_used } = state;
  switch (difficulty) {
    case "easy":
      return holdEasy(dice);
    case "medium":
      return holdMedium(dice, scores);
    case "hard":
      return holdHard(dice, scores, rolls_used);
  }
}

/**
 * Returns the category the AI should score into.
 *
 * Call when the AI decides to stop rolling (rolls_used >= 3 or elects to bank).
 * Uses engine.possibleScores() as the legal move set — this enforces Joker
 * priority rules automatically, preventing illegal category selections.
 * `opponentScore` is the human player's current total, used by Hard for
 * adversarial awareness (high-variance plays when trailing, conservative when
 * leading).
 */
export function scoreStrategy(
  state: GameState,
  difficulty: AiDifficulty,
  opponentScore = 0
): Category {
  const { dice, scores } = state;
  // possibleScores is the single source of truth for legal categories — it
  // handles Joker priority rules so we never suggest an illegal move.
  const legal = possibleScores(state);
  switch (difficulty) {
    case "easy":
      return scoreEasy(dice, legal);
    case "medium":
      return scoreMedium(dice, scores, legal);
    case "hard":
      return scoreHard(dice, scores, opponentScore, legal);
  }
}
